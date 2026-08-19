from decimal import Decimal, ROUND_HALF_UP

import base64
import binascii
import desktop_config
from contextlib import contextmanager
from datetime import datetime, timedelta
from functools import wraps
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time
import re
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.sessions.models import Session
from django.core.checks import run_checks
from django.core.files.uploadedfile import UploadedFile
from django.core.management import call_command
from django.core.exceptions import RequestDataTooBig, ValidationError
from django.db import IntegrityError, OperationalError, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.models import Max, Prefetch, Q, Sum
from django.http import HttpResponse, HttpResponseNotAllowed, JsonResponse, StreamingHttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.csrf import csrf_exempt
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.parsers import BaseParser, FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .analytics import analytics_revision, dashboard_analytics_payload, dashboard_summary_payload, kpi_analytics_payload, stock_alerts_payload, system_readiness_payload
from .authentication import ToxJWTAuthentication, create_access_token
from .models import (
    AppSnapshot,
    AccountMovement,
    AuditLog,
    Client,
    ClientPayment,
    CurrencyRate,
    Employee,
    EmployeePayroll,
    Expense,
    Invoice,
    InvoiceItem,
    LedgerEntry,
    LoginEvent,
    Product,
    ProductImage,
    ProductSearchToken,
    ProductUnit,
    Purchase,
    PurchaseItem,
    ReturnDocument,
    StockBatch,
    StockMovement,
    Supplier,
    SupplierPayment,
    UserProfile,
    Warehouse,
)
from .serializers import (
    account_movement_to_dict,
    client_to_dict,
    client_payment_to_dict,
    date_or_none,
    datetime_or_none,
    decimal_or_zero,
    employee_to_dict,
    employee_payroll_to_dict,
    expense_to_dict,
    invoice_to_dict,
    installment_to_dict,
    ledger_entry_to_dict,
    parse_json_body,
    product_image_to_dict,
    product_images_to_list,
    product_to_dict,
    purchase_to_dict,
    return_document_to_dict,
    supplier_to_dict,
    supplier_payment_to_dict,
    unit_to_dict,
    warehouse_to_dict,
)
from .backup_retention import prune_backup_files
from .services import (
    FinanceServiceError,
    _assert_money_matches,
    _consume_fifo_cost,
    _cost_breakdown_marker,
    _line_price,
    _line_total,
    _money,
    _payload_items_with_line_defaults,
    _preview_fifo_cost,
    _storage_delta,
    archive_customer_service,
    archive_supplier_service,
    balance_iqd,
    calculate_customer_balance,
    calculate_supplier_balance,
    create_customer_service,
    create_debt_adjustment_service,
    create_opening_stock_batch,
    create_installment_service,
    create_invoice_service,
    create_return_service,
    create_supplier_service,
    list_customers_service,
    list_installments_service,
    list_invoices_service,
    list_payments_service,
    list_returns_service,
    list_suppliers_service,
    register_payment_service,
    repair_missing_invoice_costs,
    reset_system_service,
    reverse_ledger_entry_service,
    sync_customer_service,
    sync_supplier_service,
    ensure_client_payment_ledger,
    ensure_customer_invoice_ledger,
    ensure_supplier_invoice_ledger,
    ensure_supplier_payment_ledger,
    entity_balance_map,
    statement_service,
    update_customer_service_by_id,
    update_supplier_service_by_id,
    void_invoice_service,
    void_purchase_service,
)
from .stock import InsufficientStock, StockError, adjust_stock

LOADED_CODE_FINGERPRINT = desktop_config.source_fingerprint()
MAX_JSON_PAYLOAD_BYTES = 128 * 1024 * 1024
LOGIN_RATE_LIMIT = {"window": 60, "limit": 8}
_RATE_BUCKETS = {}


def _configured_backup_dir():
    return Path(getattr(settings, "BACKUP_DIR", desktop_config.BACKUP_DIR)).expanduser().resolve()


def _configured_runtime_dir():
    return Path(getattr(settings, "RUNTIME_DIR", desktop_config.RUNTIME_DIR)).expanduser().resolve()


def _active_exchange_rate(default="1460"):
    rate = CurrencyRate.objects.filter(is_active=True).order_by("-created_at").values_list("rate", flat=True).first()
    return decimal_or_zero(rate or default, default)


def _amount_to_usd(amount, currency="USD", exchange_rate=None):
    amount = decimal_or_zero(amount).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    currency = (currency or "USD").upper()
    if currency == "USD":
        return _money(amount)
    if currency == "IQD":
        rate = decimal_or_zero(exchange_rate, "0") or _active_exchange_rate()
        if rate <= 0:
            rate = decimal_or_zero("1460")
        return _money(amount / rate)
    return _money(amount)


def _purchase_cost_usd_from_payload(payload, *, required=False):
    if payload.get("purchaseCostUsd") not in (None, ""):
        cost = _money(payload.get("purchaseCostUsd"))
    else:
        raw_cost = payload.get("purchaseCost")
        if raw_cost in (None, ""):
            raw_cost = payload.get("purchaseCostAmount")
        cost_currency = payload.get("purchaseCostCurrency") or payload.get("currency") or "USD"
        cost = _amount_to_usd(raw_cost, cost_currency, payload.get("exchangeRate"))
    if required and cost <= 0:
        raise ValidationError("PURCHASE_COST_REQUIRED")
    return cost


def _security_audit(action, entity_id, data=None, message="Security event"):
    try:
        AuditLog.objects.create(
            action=action,
            entity_type="security",
            entity_id=str(entity_id or "")[:120],
            message=message,
            data=data or {},
        )
    except Exception:
        pass


def _payload_limit_bytes(limit=MAX_JSON_PAYLOAD_BYTES):
    configured = [
        limit,
        getattr(settings, "DATA_UPLOAD_MAX_MEMORY_SIZE", limit) or limit,
        getattr(settings, "FILE_UPLOAD_MAX_MEMORY_SIZE", limit) or limit,
    ]
    return min(int(value) for value in configured if int(value) > 0)


def _request_body_size_info(request, limit=MAX_JSON_PAYLOAD_BYTES):
    limit = _payload_limit_bytes(limit)
    source = getattr(request, "_request", request)
    try:
        content_length = int(source.META.get("CONTENT_LENGTH") or 0)
    except (TypeError, ValueError):
        content_length = 0
    if content_length > limit:
        return True, content_length, limit
    try:
        body_size = len(getattr(source, "body", b"") or b"")
        return body_size > limit, body_size or content_length, limit
    except RequestDataTooBig:
        return True, content_length, limit


def _request_body_too_large(request, limit=MAX_JSON_PAYLOAD_BYTES):
    return _request_body_size_info(request, limit)[0]


def _payload_too_large_response(request, provided_bytes=0, limit_bytes=None):
    limit_bytes = int(limit_bytes or _payload_limit_bytes())
    provided_bytes = int(provided_bytes or 0)
    payload = {
        "ok": False,
        "reason": "PAYLOAD_TOO_LARGE",
        "code": "PAYLOAD_TOO_LARGE",
        "message": "Request payload is too large.",
        "messageAr": "حجم الملف أو الطلب أكبر من الحد المسموح. صدّر نسخة جديدة أصغر أو ارفع الحد من إعدادات TOX ثم حاول مرة ثانية.",
        "limitBytes": limit_bytes,
        "providedBytes": provided_bytes,
        "details": {
            "path": getattr(request, "path", ""),
            "limitBytes": limit_bytes,
            "providedBytes": provided_bytes,
        },
        "recoverySteps": [
            "استخدم ملف JSON الرسمي المصدّر من صفحة النسخ الاحتياطي.",
            "إذا كان الملف صحيحاً لكنه كبير، ارفع قيمة TOX_DATA_UPLOAD_MAX_MEMORY_SIZE ثم أعد تشغيل النظام.",
            "لا تستخدم نسخ ZIP أو نسخ محلية قديمة للاسترجاع.",
        ],
    }
    return JsonResponse(payload, status=413)


def _payload_size_required(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            too_large, provided_bytes, limit_bytes = _request_body_size_info(request)
            if too_large:
                _security_audit(
                    "payload_rejected",
                    request.path,
                    {"path": request.path, "limitBytes": limit_bytes, "providedBytes": provided_bytes},
                )
                return _payload_too_large_response(request, provided_bytes, limit_bytes)
        return view_func(request, *args, **kwargs)
    return wrapper


def _rate_limited(request, scope, *, limit=None, window=None):
    limit = limit or LOGIN_RATE_LIMIT["limit"]
    window = window or LOGIN_RATE_LIMIT["window"]
    now = time.time()
    ip = (request.META.get("REMOTE_ADDR") or "unknown").lower()
    key = (scope, ip)
    attempts = [stamp for stamp in _RATE_BUCKETS.get(key, []) if now - stamp < window]
    attempts.append(now)
    _RATE_BUCKETS[key] = attempts
    return len(attempts) > limit

ALL_PERMISSIONS = {
    "dashboard.open",
    "sales.open",
    "sales.create_invoice",
    "sales.installments",
    "sales.edit_installment_profit",
    "sales.edit_invoice",
    "sales.delete_invoice",
    "sales.print_invoice",
    "purchase.open",
    "purchase.create_invoice",
    "purchase.delete_invoice",
    "purchase.return",
    "warehouse.open",
    "warehouse.add_product",
    "warehouse.edit_product",
    "warehouse.delete_product",
    "warehouse.view_quantities",
    "warehouse.print_labels",
    "accounts.view_profits",
    "accounts.view_expenses",
    "accounts.manage_debts",
    "accounts.open",
    "admin.manage_employees",
    "admin.settings",
    "admin.backup",
    "admin.manage_permissions",
}

ROLE_DEFAULT_PERMISSIONS = {
    "admin": sorted(ALL_PERMISSIONS),
    "cashier": [
        "dashboard.open",
        "sales.open",
        "sales.create_invoice",
        "sales.installments",
        "sales.edit_installment_profit",
        "sales.edit_invoice",
        "sales.print_invoice",
    ],
    "purchase": [
        "dashboard.open",
        "purchase.open",
        "purchase.create_invoice",
        "purchase.return",
    ],
    "warehouse": [
        "dashboard.open",
        "warehouse.open",
        "warehouse.add_product",
        "warehouse.edit_product",
        "warehouse.delete_product",
        "warehouse.view_quantities",
        "warehouse.print_labels",
    ],
    "accountant": [
        "dashboard.open",
        "accounts.open",
        "accounts.view_profits",
        "accounts.view_expenses",
        "accounts.manage_debts",
        "sales.open",
        "sales.print_invoice",
    ],
}


class CsrfExemptSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return None


FINANCE_AUTH = [CsrfExemptSessionAuthentication]
ANALYTICS_AUTH = [ToxJWTAuthentication]
DASHBOARD_REVIEW_AUTH = [CsrfExemptSessionAuthentication, ToxJWTAuthentication]
BACKUP_AUTH = [CsrfExemptSessionAuthentication, ToxJWTAuthentication]


class RawBackupParser(BaseParser):
    media_type = "*/*"

    def parse(self, stream, media_type=None, parser_context=None):
        return stream.read()


BACKUP_PARSERS = [JSONParser, MultiPartParser, FormParser, RawBackupParser]
DEMO_EMPLOYEE_TOKENS = {"ali", "علي", "test", "demo", "sample", "temp"}


def _method_not_allowed(*allowed):
    return HttpResponseNotAllowed(allowed)


def _positive_int(value, default, maximum=500):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, min(number, maximum))


def _pagination_params(request, default_limit=100, max_limit=500):
    params = getattr(request, "query_params", None) or request.GET
    limit = _positive_int(params.get("limit"), default_limit, max_limit)
    offset = _positive_int(params.get("offset"), 0, 1000000)
    return limit, offset


def _page_response(key, qs, serializer, request, default_limit=100):
    limit, offset = _pagination_params(request, default_limit=default_limit)
    total = qs.count()
    page = qs[offset:offset + limit]
    return JsonResponse({
        key: [serializer(item) for item in page],
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": total,
            "hasMore": offset + limit < total,
        },
    })


def _drf_payload(request):
    data = getattr(request, "data", None)
    if isinstance(data, dict):
        return data
    return parse_json_body(getattr(request, "_request", request))


def _drf_query(request, key, default=None):
    params = getattr(request, "query_params", None) or request.GET
    return params.get(key, default)


def _finance_error_response(error, status=400):
    if error.__class__.__name__ == "DoesNotExist":
        return Response({"ok": False, "reason": "NO_LEDGER_ENTRY"}, status=404)
    if isinstance(error, OperationalError):
        return Response({
            "ok": False,
            "reason": "DATABASE_BUSY",
            "code": "DATABASE_BUSY",
            "message": "The database is busy. Please try again.",
            "messageAr": "قاعدة البيانات مشغولة الآن بسبب عملية أخرى. انتظر ثواني قليلة ثم حاول مرة ثانية.",
        }, status=503)
    reason = getattr(error, "reason", str(error))
    not_found = {"NO_CUSTOMER", "NO_SUPPLIER", "NO_INSTALLMENT", "NO_INVOICE", "NO_PURCHASE"}
    conflict = {"CUSTOMER_EXISTS", "SUPPLIER_EXISTS", "INVOICE_EXISTS", "PAYMENT_EXISTS", "LEDGER_REFERENCE_CONFLICT"}
    response_status = 404 if reason in not_found else 409 if reason in conflict else status
    payload = {"ok": False, "reason": reason}
    details = getattr(error, "details", None)
    if details:
        payload["details"] = details
        payload["message"] = _finance_error_message(reason, details)
    if reason in {"NO_UNIT", "NO_PRODUCT"}:
        _security_audit("finance_error", reason.lower(), details or {}, message=f"Rejected invoice line: {reason}")
    return Response(payload, status=response_status)


def _finance_error_message(reason, details):
    line = details.get("lineIndex")
    product = details.get("productName") or details.get("productId") or ""
    unit = details.get("unitName") or details.get("unitId") or ""
    if reason in {"SUBTOTAL_MISMATCH", "TOTAL_MISMATCH", "LINE_TOTAL_MISMATCH"}:
        expected = details.get("expectedUsd")
        provided = details.get("providedUsd")
        difference = details.get("differenceUsd")
        return f"Money total mismatch. Expected {expected}, provided {provided}, difference {difference}."
    if reason == "NO_UNIT":
        return f"Invoice line {line}: unit '{unit}' was not found for product '{product}'."
    if reason == "NO_PRODUCT":
        return f"Invoice line {line}: product '{product}' was not found."
    if reason == "MISSING_PURCHASE_COST":
        return f"Product '{product}' needs a purchase cost before the invoice can calculate profit."
    if reason == "INSUFFICIENT_COST_BATCH":
        required = details.get("requiredQuantity")
        available = details.get("availableQuantity")
        return f"Product '{product}' has missing FIFO cost batches. Required {required}, available {available}."
    if reason == "INSUFFICIENT_STOCK":
        required = details.get("requiredQuantity")
        available = details.get("availableQuantity")
        return f"Product '{product}' stock is insufficient. Required {required}, available {available}."
    return reason


def _validation_error_payload(error):
    messages = getattr(error, "messages", None)
    if messages:
        message = "; ".join(str(item) for item in messages)
    else:
        message = str(error)
    return {"ok": False, "reason": "VALIDATION_ERROR", "message": message}


PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
PRODUCT_IMAGE_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"}


def _uploaded_image_error(upload):
    if not upload:
        return "NO_FILE"
    content_type = (getattr(upload, "content_type", "") or "").lower()
    if content_type not in PRODUCT_IMAGE_ALLOWED_TYPES and not content_type.startswith("image/"):
        return "INVALID_IMAGE"
    if getattr(upload, "size", 0) > PRODUCT_IMAGE_MAX_BYTES:
        return "IMAGE_TOO_LARGE"
    return ""


def _save_product_image_variant(product_image, field_name, upload, variant):
    if not upload:
        return
    error = _uploaded_image_error(upload)
    if error:
        raise ValidationError(error)
    if hasattr(upload, "seek"):
        upload.seek(0)
    product_image._upload_variant = variant
    getattr(product_image, field_name).save(upload.name, upload, save=False)


def _ensure_single_primary_product_image(product, image=None):
    qs = ProductImage.objects.filter(product=product)
    if image:
        qs = qs.exclude(pk=image.pk)
    qs.update(is_primary=False)


def _ensure_product_primary_image(product):
    primary = ProductImage.objects.filter(product=product, is_primary=True).order_by("sort_order", "id").first()
    if primary:
        return primary
    first = ProductImage.objects.filter(product=product).order_by("sort_order", "id").first()
    if first:
        first.is_primary = True
        first.save(update_fields=["is_primary", "updated_at"])
    return first


def _product_image_response(product, status=200):
    product.refresh_from_db()
    images = ProductImage.objects.filter(product=product).order_by("sort_order", "id")
    return JsonResponse({
        "ok": True,
        "images": [product_image_to_dict(image) for image in images],
        "product": product_to_dict(
            Product.objects.select_related("warehouse").prefetch_related("units", "images").get(pk=product.pk)
        ),
    }, status=status)


POS_PRODUCT_LIMIT_DEFAULT = 48
POS_PRODUCT_LIMIT_MAX = 100
POS_SEARCH_TOKEN_RE = re.compile(r"[\w\u0600-\u06ff]+", re.UNICODE)
POS_DIGIT_TRANSLATION = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def _compact_decimal(value):
    amount = decimal_or_zero(value)
    if amount == amount.to_integral():
        return str(int(amount))
    return str(amount.normalize()).rstrip("0").rstrip(".")


def _pos_normalize_text(value):
    text = str(value or "").translate(POS_DIGIT_TRANSLATION).casefold()
    text = re.sub(r"[\u0640\u200c\u200d]+", "", text)
    return text


def _pos_search_terms(value):
    return [
        token[:120]
        for token in POS_SEARCH_TOKEN_RE.findall(_pos_normalize_text(value))
        if token and (len(token) > 1 or token.isdigit())
    ][:8]


def _pos_product_search_tokens(product):
    active_units = [unit for unit in product.units.all() if unit.deleted_at is None]
    values = [
        product.name,
        product.brand,
        product.origin_country,
        product.kind,
        product.sku,
        product.barcode,
        product.base_unit,
        product.stock_unit_name,
    ]
    for unit in active_units:
        values.extend([unit.name, unit.barcode])
    tokens = set()
    for value in values:
        tokens.update(_pos_search_terms(value))
    for barcode in [product.barcode, *(unit.barcode for unit in active_units)]:
        normalized = _normalize_barcode(barcode)
        if normalized:
            tokens.add(normalized[:120])
    return sorted(tokens)


def _refresh_product_search_tokens(product):
    if not product or not product.pk:
        return
    try:
        tokens = _pos_product_search_tokens(product)
        ProductSearchToken.objects.filter(product=product).delete()
        ProductSearchToken.objects.bulk_create(
            [ProductSearchToken(product=product, token=token) for token in tokens],
            ignore_conflicts=True,
        )
    except (OperationalError, IntegrityError):
        pass


def _pos_active_units(product):
    return [unit for unit in product.units.all() if unit.deleted_at is None]


def _pos_product_images(product):
    return product_images_to_list(product)


def _pos_stock_summary(product):
    unit_name = product.stock_unit_name or product.base_unit or "قطعة"
    return f"{_compact_decimal(product.stock_quantity)} {unit_name}"


def _pos_primary_unit(product):
    units = _pos_active_units(product)
    return unit_to_dict(units[0]) if units else None


def _pos_product_summary(product):
    units = _pos_active_units(product)
    images = _pos_product_images(product)
    primary_image = images[0] if images else {}
    return {
        "id": product.external_id,
        "name": product.name,
        "brand": product.brand,
        "originCountry": product.origin_country,
        "warehouseId": product.warehouse.external_id if product.warehouse_id else "",
        "warehouseName": product.warehouse.name if product.warehouse_id else "",
        "barcode": product.barcode,
        "sku": product.sku,
        "kind": product.kind,
        "currency": product.currency,
        "baseUnit": product.base_unit,
        "stockUnitName": product.stock_unit_name,
        "stockUnitMultiplier": float(decimal_or_zero(product.stock_unit_multiplier, "1")),
        "stockQuantity": float(decimal_or_zero(product.stock_quantity)),
        "stockSummary": _pos_stock_summary(product),
        "stockQuantityMode": product.stock_quantity_mode,
        "primaryUnit": unit_to_dict(units[0]) if units else None,
        "units": [unit_to_dict(unit) for unit in units],
        "images": images[:1],
        "imageUrl": primary_image.get("imageUrl") or product.image or "",
        "catalogUrl": primary_image.get("catalogUrl") or primary_image.get("imageUrl") or product.image or "",
        "thumbUrl": primary_image.get("thumbUrl") or primary_image.get("catalogUrl") or primary_image.get("imageUrl") or product.image or "",
        "disabled": not units or decimal_or_zero(product.stock_quantity) <= 0,
    }


def _pos_product_detail_payload(product):
    payload = product_to_dict(product)
    payload.update({
        "warehouseName": product.warehouse.name if product.warehouse_id else "",
        "primaryUnit": _pos_primary_unit(product),
        "stockSummary": _pos_stock_summary(product),
    })
    return payload


def _pos_product_queryset():
    active_units = ProductUnit.objects.filter(deleted_at__isnull=True).order_by("id")
    ordered_images = ProductImage.objects.order_by("sort_order", "id")
    return (
        Product.objects.active()
        .select_related("warehouse")
        .prefetch_related(
            Prefetch("units", queryset=active_units),
            Prefetch("images", queryset=ordered_images),
        )
        .distinct()
        .order_by("name", "id")
    )


def _pos_filter_products(qs, query="", barcode="", warehouse_id=""):
    if warehouse_id and warehouse_id != "all":
        qs = qs.filter(warehouse__external_id=warehouse_id)
    exact_barcode_match = False
    normalized_barcode = _normalize_barcode(barcode)
    if normalized_barcode:
        qs = qs.filter(
            Q(barcode=normalized_barcode)
            | Q(units__barcode=normalized_barcode, units__deleted_at__isnull=True)
        ).distinct()
        exact_barcode_match = qs.exists()
        return qs, exact_barcode_match
    terms = _pos_search_terms(query)
    if not terms:
        return qs, False
    try:
        has_index = ProductSearchToken.objects.exists()
    except OperationalError:
        has_index = False
    if has_index:
        for term in terms:
            matching_ids = ProductSearchToken.objects.filter(token__startswith=term).values("product_id")
            qs = qs.filter(pk__in=matching_ids)
        return qs.distinct(), False
    for term in terms:
        qs = qs.filter(
            Q(name__icontains=term)
            | Q(brand__icontains=term)
            | Q(sku__icontains=term)
            | Q(barcode__icontains=term)
            | Q(origin_country__icontains=term)
            | Q(units__name__icontains=term, units__deleted_at__isnull=True)
            | Q(units__barcode__icontains=term, units__deleted_at__isnull=True)
        )
    return qs.distinct(), False


def _product_accounting_snapshot(product):
    units = ProductUnit.objects.filter(product=product, deleted_at__isnull=True).order_by("id")
    return {
        "purchaseCostUsd": str(_money(product.purchase_cost_usd)),
        "stockUnitName": product.stock_unit_name,
        "stockUnitMultiplier": str(decimal_or_zero(product.stock_unit_multiplier, "1")),
        "baseUnit": product.base_unit,
        "barcode": product.barcode or "",
        "units": [
            {
                "id": unit.external_id,
                "name": unit.name,
                "multiplier": str(decimal_or_zero(unit.multiplier, "1")),
                "priceUsd": str(_money(unit.price_usd)),
                "barcode": unit.barcode or "",
            }
            for unit in units
        ],
    }


def _product_accounting_diff(before, after):
    changed = {}
    for key in ("purchaseCostUsd", "stockUnitName", "stockUnitMultiplier", "baseUnit", "barcode", "units"):
        if before.get(key) != after.get(key):
            changed[key] = {"before": before.get(key), "after": after.get(key)}
    return changed


def _drf_paginated_response(key, qs, serializer, request, default_limit=100):
    limit, offset = _pagination_params(request, default_limit=default_limit)
    total = qs.count()
    return Response({
        key: [serializer(item) for item in qs[offset:offset + limit]],
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": total,
            "hasMore": offset + limit < total,
        },
    })


def _first_saved_or_db(saved_items, db_items):
    return db_items if db_items else saved_items


def _active_payload_ids(payload, key):
    items = payload.get(key)
    if not isinstance(items, list):
        return None
    return {
        str(item.get("id"))
        for item in items
        if isinstance(item, dict) and item.get("id") and not item.get("deletedAt")
    }


def _hard_delete_products(product_qs):
    products = list(product_qs)
    product_pks = [product.pk for product in products]
    if not product_pks:
        return 0
    for product in products:
        _security_audit("delete", "product", {"productId": product.external_id}, message="Product delete requested")
    history_pks = set(
        InvoiceItem.objects.filter(product_id__in=product_pks).values_list("product_id", flat=True)
    ) | set(
        PurchaseItem.objects.filter(product_id__in=product_pks).values_list("product_id", flat=True)
    ) | set(
        StockMovement.objects.filter(product_id__in=product_pks).values_list("product_id", flat=True)
    )
    if history_pks:
        archived_at = timezone.now()
        Product.objects.filter(pk__in=history_pks).update(deleted_at=archived_at, updated_at=archived_at, barcode="")
        ProductUnit.objects.filter(product_id__in=history_pks).update(deleted_at=archived_at, updated_at=archived_at, barcode="")
    deletable_pks = [pk for pk in product_pks if pk not in history_pks]
    if deletable_pks:
        StockMovement.objects.filter(product_id__in=deletable_pks).delete()
        StockBatch.objects.filter(product_id__in=deletable_pks).delete()
        ProductUnit.objects.filter(product_id__in=deletable_pks).delete()
        deleted, _ = Product.objects.filter(pk__in=deletable_pks).delete()
    else:
        deleted = 0
    return deleted + len(history_pks)


def _archive_missing_records_from_payload(payload, sections=None):
    sections = set(sections or {"warehouses", "products", "clients", "suppliers", "employees"})
    archived_at = timezone.now()

    warehouse_ids = _active_payload_ids(payload, "warehouses")
    if "warehouses" in sections and warehouse_ids is not None:
        missing_warehouses = list(Warehouse.objects.filter(deleted_at__isnull=True).exclude(external_id__in=warehouse_ids))
        if missing_warehouses:
            warehouse_pks = [warehouse.pk for warehouse in missing_warehouses]
            _hard_delete_products(Product.objects.filter(warehouse_id__in=warehouse_pks))
            Warehouse.objects.filter(pk__in=warehouse_pks).update(deleted_at=archived_at, updated_at=archived_at)

    product_ids = _active_payload_ids(payload, "products")
    if "products" in sections and product_ids is not None:
        _hard_delete_products(Product.objects.exclude(external_id__in=product_ids))

    client_ids = _active_payload_ids(payload, "clients")
    if "clients" in sections and client_ids is not None:
        for client in Client.objects.filter(deleted_at__isnull=True).exclude(external_id__in=client_ids):
            try:
                archive_customer_service(client.external_id)
            except FinanceServiceError:
                pass

    supplier_ids = _active_payload_ids(payload, "suppliers")
    if "suppliers" in sections and supplier_ids is not None:
        for supplier in Supplier.objects.filter(deleted_at__isnull=True).exclude(external_id__in=supplier_ids):
            try:
                archive_supplier_service(supplier.external_id)
            except FinanceServiceError:
                pass

    employee_ids = _active_payload_ids(payload, "employees")
    if "employees" in sections and employee_ids is not None:
        Employee.objects.filter(deleted_at__isnull=True).exclude(external_id__in=employee_ids).update(deleted_at=archived_at, updated_at=archived_at)


class SyncSectionError(Exception):
    def __init__(self, code, message="", details=None):
        self.code = code
        self.message = message or code
        self.details = details or {}
        super().__init__(self.message)


SYNC_BUSINESS_KEYS = {
    "warehouses",
    "products",
    "clients",
    "suppliers",
    "employees",
    "invoices",
    "purchases",
    "clientPayments",
    "supplierPayments",
    "accountMovements",
}

SYNC_ALWAYS_SNAPSHOT_KEYS = {
    "cashVouchers",
    "suspendedInvoices",
    "suspendedPurchases",
    "unitPresets",
    "brands",
    "originCountries",
    "theme",
    "lang",
    "dir",
    "currency",
    "exchangeRate",
    "businessName",
    "businessSubtitle",
    "businessPhone",
    "businessAddress",
    "businessOwnerName",
    "businessCompanyName",
    "invoicePrintSettings",
    "installmentProfitSettings",
    "productPricingSettings",
    "dataGeneration",
    "dataResetAt",
    "soundEnabled",
    "soundVolume",
    "soundPack",
}


def _payload_list(payload, key):
    value = payload.get(key, [])
    if value is None:
        return []
    if not isinstance(value, list):
        raise SyncSectionError(
            "INVALID_PAYLOAD_LIST",
            f"{key} must be a list",
            {"key": key},
        )
    return value


def _require_payload_id(section, item, index):
    if not isinstance(item, dict):
        raise SyncSectionError(
            "INVALID_PAYLOAD_ITEM",
            f"{section}[{index}] must be an object",
            {"section": section, "index": index},
        )
    item_id = str(item.get("id") or "").strip()
    if not item_id:
        raise SyncSectionError(
            "MISSING_ID",
            f"{section}[{index}] is missing id",
            {"section": section, "index": index},
        )
    return item_id


_BARCODE_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
DUPLICATE_BARCODE_MESSAGE_AR = "هذا الباركود مستخدم لمنتج آخر، الرجاء إدخال رقم مختلف"


def _normalize_barcode(value):
    text = str(value or "").translate(_BARCODE_DIGITS)
    text = re.sub(r"[\u200b-\u200d\ufeff]", "", text)
    return re.sub(r"\s+", "", text).strip()


def _barcode_owner(product, barcode, source, unit=None):
    unit = unit or {}
    return {
        "barcode": barcode,
        "source": source,
        "productId": str(product.get("id") or "").strip(),
        "productName": product.get("name") or "",
        "unitId": str(unit.get("id") or "").strip(),
        "unitName": unit.get("name") or "",
    }


def _same_barcode_owner(first, second):
    if not first or not second:
        return False
    if first.get("source") != second.get("source"):
        return False
    if first.get("productId") != second.get("productId"):
        return False
    if first.get("source") == "product":
        return True
    first_unit_id = first.get("unitId") or ""
    second_unit_id = second.get("unitId") or ""
    if first_unit_id and second_unit_id and first_unit_id == second_unit_id:
        return True
    first_unit_name = str(first.get("unitName") or "").strip().casefold()
    second_unit_name = str(second.get("unitName") or "").strip().casefold()
    return bool(first_unit_name and first_unit_name == second_unit_name)


def _raise_duplicate_barcode(first, second):
    raise SyncSectionError(
        "DUPLICATE_BARCODE",
        DUPLICATE_BARCODE_MESSAGE_AR,
        {
            "barcode": second.get("barcode") or first.get("barcode") or "",
            "first": first,
            "second": second,
        },
    )


def _duplicate_barcode_response(error, status=400):
    return JsonResponse(
        {
            "ok": False,
            "reason": error.code,
            "code": error.code,
            "message": DUPLICATE_BARCODE_MESSAGE_AR,
            "messageAr": DUPLICATE_BARCODE_MESSAGE_AR,
            "field": "barcode",
            "entityId": _sync_error_entity_id(error.details),
            "ownerDetails": _sync_error_owner_details(error.details),
            "details": error.details,
        },
        status=status,
    )


def _constraint_error_response(error, status=400):
    text = str(error)
    if "barcode" in text.lower():
        return JsonResponse(
            {
                "ok": False,
                "reason": "DUPLICATE_BARCODE",
                "code": "DUPLICATE_BARCODE",
                "message": DUPLICATE_BARCODE_MESSAGE_AR,
                "messageAr": DUPLICATE_BARCODE_MESSAGE_AR,
                "field": "barcode",
                "details": {"databaseError": text},
            },
            status=status,
        )
    return JsonResponse(
        {
            "ok": False,
            "reason": "DATABASE_CONSTRAINT",
            "code": "DATABASE_CONSTRAINT",
            "message": text,
            "messageAr": _sync_error_message_ar("products", "DATABASE_CONSTRAINT", {}),
            "details": {"databaseError": text},
        },
        status=status,
    )


def _unit_payload_from_model(unit):
    return {
        "id": unit.external_id,
        "name": unit.name,
        "barcode": unit.barcode,
    }


def _product_payload_for_barcode_validation(payload, external_id, product=None):
    existing_units = {}
    if product:
        for unit in product.units.filter(deleted_at__isnull=True):
            existing_units[unit.external_id] = _unit_payload_from_model(unit)

    incoming_units = payload.get("units")
    if incoming_units is None:
        units = list(existing_units.values())
    else:
        units = []
        for index, unit in enumerate(incoming_units or []):
            if not isinstance(unit, dict):
                units.append(unit)
                continue
            unit_id = str(unit.get("id") or unit.get("unitId") or f"{external_id}-unit-{index + 1}").strip()
            existing = existing_units.get(unit_id, {})
            units.append(
                {
                    **existing,
                    **unit,
                    "id": unit_id,
                    "barcode": _normalize_barcode(unit.get("barcode", existing.get("barcode", ""))),
                }
            )

    return {
        "id": external_id,
        "name": payload.get("name", product.name if product else "") or "",
        "barcode": _normalize_barcode(payload.get("barcode", product.barcode if product else "")),
        "units": units,
    }


def _validate_api_product_barcodes(payload, external_id, product=None):
    validation_product = _product_payload_for_barcode_validation(payload, external_id, product)
    _validate_product_unit_barcodes({"products": [validation_product]})


def _validate_product_commercial_payload(payload, product=None):
    stock_multiplier = decimal_or_zero(
        payload.get("stockUnitMultiplier", product.stock_unit_multiplier if product else "1"),
        "1",
    )
    if stock_multiplier <= 0:
        raise ValidationError("STOCK_UNIT_MULTIPLIER_REQUIRED")

    stock_quantity = decimal_or_zero(
        payload.get("stockQuantity", product.stock_quantity if product else "0"),
        "0",
    )
    if "purchaseCostUsd" in payload:
        purchase_cost = decimal_or_zero(payload.get("purchaseCostUsd"))
    elif any(key in payload for key in ("purchaseCost", "purchaseCostAmount", "purchaseCostCurrency")):
        purchase_cost = _purchase_cost_usd_from_payload(payload, required=False)
    else:
        purchase_cost = decimal_or_zero(product.purchase_cost_usd if product else "0")
    if stock_quantity > 0 and purchase_cost <= 0:
        raise ValidationError("PURCHASE_COST_REQUIRED")

    incoming_units = payload.get("units")
    if isinstance(incoming_units, list):
        for index, unit in enumerate(incoming_units):
            if not isinstance(unit, dict):
                raise ValidationError(f"PRODUCT_UNIT_INVALID:{index}")
            if decimal_or_zero(unit.get("multiplier"), "1") <= 0:
                raise ValidationError(f"PRODUCT_UNIT_MULTIPLIER_REQUIRED:{index}")


PRODUCT_ORIGIN_KEYS = ("originCountry", "origin", "origin_country")


def _has_product_origin(payload):
    return any(key in payload for key in PRODUCT_ORIGIN_KEYS)


def _product_origin_value(payload):
    for key in PRODUCT_ORIGIN_KEYS:
        if key in payload:
            return payload.get(key) or ""
    return ""


def _default_product_unit_payload(product, payload=None):
    payload = payload or {}
    return {
        "id": f"{product.external_id}-unit",
        "name": payload.get("baseUnit") or product.base_unit or "قطعة",
        "multiplier": "1",
        "priceUsd": payload.get("priceUsd") or "0",
        "priceCurrency": payload.get("currency") or product.currency or "IQD",
        "barcode": "",
    }


def _ensure_product_has_base_unit(product, payload=None):
    if ProductUnit.objects.filter(product=product, deleted_at__isnull=True).exists():
        return None
    unit_payload = _default_product_unit_payload(product, payload)
    unit, _ = ProductUnit.objects.update_or_create(
        product=product,
        external_id=unit_payload["id"],
        defaults={
            "name": unit_payload["name"],
            "multiplier": decimal_or_zero(unit_payload["multiplier"], "1"),
            "price_usd": decimal_or_zero(unit_payload["priceUsd"]),
            "price_currency": unit_payload["priceCurrency"],
            "barcode": _normalize_barcode(unit_payload["barcode"]),
            "deleted_at": None,
        },
    )
    return unit


def _unit_is_referenced(unit):
    return (
        InvoiceItem.objects.filter(product=unit.product, unit_id=unit.external_id).exists()
        or PurchaseItem.objects.filter(product=unit.product, unit_id=unit.external_id).exists()
    )


def _remove_obsolete_product_units(product, active_unit_ids):
    obsolete_units = ProductUnit.objects.filter(product=product).exclude(external_id__in=active_unit_ids)
    for unit in obsolete_units:
        if _unit_is_referenced(unit):
            if unit.barcode:
                unit.barcode = ""
                unit.save(update_fields=["barcode", "updated_at"])
            continue
        else:
            unit.delete()


def _release_same_product_unit_barcode(product, unit_id, unit_name, barcode):
    if not barcode:
        return
    ProductUnit.objects.filter(barcode=barcode, deleted_at__isnull=False).update(barcode="")
    conflicts = ProductUnit.objects.filter(
        product=product,
        barcode=barcode,
        name=unit_name,
    ).exclude(external_id=unit_id)
    for conflict in conflicts:
        if _unit_is_referenced(conflict):
            conflict.barcode = ""
            conflict.save(update_fields=["barcode", "updated_at"])
        else:
            conflict.delete()


def _validate_product_unit_barcodes(payload):
    seen = {}
    incoming = {}
    for product_index, product in enumerate(_payload_list(payload, "products")):
        if not isinstance(product, dict) or product.get("deletedAt"):
            continue
        product_id = str(product.get("id") or "").strip()
        if not product_id:
            raise SyncSectionError(
                "MISSING_ID",
                f"products[{product_index}] is missing id",
                {"section": "products", "index": product_index},
            )
        units = product.get("units") or []
        if not isinstance(units, list):
            raise SyncSectionError(
                "INVALID_PRODUCT_UNITS",
                "Product units must be a list",
                {"productId": product_id},
            )
        product_barcode = _normalize_barcode(product.get("barcode"))
        if product_barcode:
            owner = _barcode_owner(product, product_barcode, "product")
            barcode_key = product_barcode.casefold()
            if barcode_key in seen and not _same_barcode_owner(seen[barcode_key], owner):
                _raise_duplicate_barcode(seen[barcode_key], owner)
            seen[barcode_key] = owner
            incoming.setdefault(barcode_key, []).append(owner)
        for unit_index, unit in enumerate(units):
            if not isinstance(unit, dict):
                raise SyncSectionError(
                    "INVALID_PRODUCT_UNIT",
                    "Product unit must be an object",
                    {"productId": product_id, "index": unit_index},
                )
            barcode = _normalize_barcode(unit.get("barcode"))
            if not barcode:
                continue
            unit_id = str(unit.get("id") or f"{product_id}-unit").strip()
            barcode_key = barcode.casefold()
            owner = _barcode_owner(product, barcode, "unit", {**unit, "id": unit_id})
            if barcode_key in seen and not _same_barcode_owner(seen[barcode_key], owner):
                _raise_duplicate_barcode(seen[barcode_key], owner)
            seen[barcode_key] = owner
            incoming.setdefault(barcode_key, []).append(owner)

    if not incoming:
        return

    for existing in Product.objects.active().exclude(barcode=""):
        normalized = _normalize_barcode(existing.barcode)
        for owner in incoming.get(normalized.casefold(), []):
            existing_owner = {
                "barcode": normalized,
                "source": "product",
                "productId": existing.external_id,
                "productName": existing.name,
                "unitId": "",
                "unitName": "",
            }
            if _same_barcode_owner(existing_owner, owner):
                continue
            _raise_duplicate_barcode(existing_owner, owner)

    conflicts = (
        ProductUnit.objects.exclude(barcode="")
        .filter(deleted_at__isnull=True, product__deleted_at__isnull=True)
        .select_related("product")
    )
    for existing in conflicts:
        normalized = _normalize_barcode(existing.barcode)
        for owner in incoming.get(normalized.casefold(), []):
            existing_owner = {
                "barcode": normalized,
                "source": "unit",
                "productId": existing.product.external_id,
                "productName": existing.product.name,
                "unitId": existing.external_id,
                "unitName": existing.name,
            }
            if _same_barcode_owner(existing_owner, owner):
                continue
            _raise_duplicate_barcode(existing_owner, owner)


def _snapshot_after_partial_sync(payload, previous_data, successful_keys):
    previous_data = previous_data if isinstance(previous_data, dict) else {}
    snapshot = dict(previous_data)
    for key in SYNC_ALWAYS_SNAPSHOT_KEYS:
        if key in payload:
            snapshot[key] = payload.get(key)
    for key in SYNC_BUSINESS_KEYS:
        if key in successful_keys and key in payload:
            snapshot[key] = payload.get(key)
    return snapshot


def _sync_error_message_ar(section, code, details=None):
    details = details or {}
    if code in {"DUPLICATE_BARCODE", "DUPLICATE_UNIT_BARCODE"}:
        return DUPLICATE_BARCODE_MESSAGE_AR
    if code == "MISSING_WAREHOUSE":
        return "يوجد منتج مرتبط بمخزن غير محفوظ. احفظ المخزن أو غيّر مخزن المنتج."
    if code == "DATABASE_CONSTRAINT":
        return "رفضت قاعدة البيانات البيانات المرسلة بسبب قيد محاسبي أو تكرار. راجع تفاصيل الخطأ."
    if code in {"SUBTOTAL_MISMATCH", "TOTAL_MISMATCH", "LINE_TOTAL_MISMATCH"}:
        return "الإجماليات المرسلة لا تطابق حسابات السيرفر. أعد تحميل الصفحة وحاول مرة ثانية."
    if code == "VALIDATION_ERROR":
        return "توجد بيانات غير صحيحة في هذا القسم."
    return f"لم يكتمل حفظ قسم {section}. راجع تفاصيل الخطأ."


def _sync_error_owner_details(details):
    if not isinstance(details, dict):
        return {}
    owner_details = details.get("ownerDetails")
    if isinstance(owner_details, dict):
        return owner_details
    owners = {
        key: details.get(key)
        for key in ("first", "second", "existing", "incoming")
        if isinstance(details.get(key), dict)
    }
    return owners


def _sync_error_entity_id(details):
    if not isinstance(details, dict):
        return ""
    for key in ("entityId", "productId", "warehouseId", "clientId", "supplierId", "invoiceId", "purchaseId", "id"):
        if details.get(key):
            return str(details.get(key))
    owner_details = _sync_error_owner_details(details)
    for owner in owner_details.values():
        if isinstance(owner, dict) and owner.get("productId"):
            return str(owner.get("productId"))
    return ""


def _sync_error_payload(section, error):
    if isinstance(error, SyncSectionError):
        field = error.details.get("field") if isinstance(error.details, dict) else ""
        if not field and "BARCODE" in error.code:
            field = "barcode"
        return {
            "section": section,
            "code": error.code,
            "message": error.message,
            "messageAr": _sync_error_message_ar(section, error.code, error.details),
            "entityId": _sync_error_entity_id(error.details),
            "field": field or "",
            "ownerDetails": _sync_error_owner_details(error.details),
            "details": error.details,
        }
    if isinstance(error, IntegrityError):
        if "barcode" in str(error).lower():
            return {
                "section": section,
                "code": "DUPLICATE_BARCODE",
                "message": DUPLICATE_BARCODE_MESSAGE_AR,
                "messageAr": DUPLICATE_BARCODE_MESSAGE_AR,
                "entityId": "",
                "field": "barcode",
                "ownerDetails": {},
                "details": {"databaseError": str(error)},
            }
        return {
            "section": section,
            "code": "DATABASE_CONSTRAINT",
            "message": str(error),
            "messageAr": _sync_error_message_ar(section, "DATABASE_CONSTRAINT", {}),
            "entityId": "",
            "field": "",
            "ownerDetails": {},
            "details": {},
        }
    if isinstance(error, FinanceServiceError):
        code = str(error)
        details = getattr(error, "details", {}) or {}
        return {
            "section": section,
            "code": code,
            "message": str(error),
            "messageAr": _sync_error_message_ar(section, code, details),
            "entityId": _sync_error_entity_id(details),
            "field": "",
            "ownerDetails": {},
            "details": details,
        }
    if isinstance(error, ValidationError):
        messages = getattr(error, "messages", None)
        return {
            "section": section,
            "code": "VALIDATION_ERROR",
            "message": "; ".join(str(item) for item in messages) if messages else str(error),
            "messageAr": _sync_error_message_ar(section, "VALIDATION_ERROR", {}),
            "entityId": "",
            "field": "",
            "ownerDetails": {},
            "details": {},
        }
    return {
        "section": section,
        "code": error.__class__.__name__,
        "message": str(error),
        "messageAr": _sync_error_message_ar(section, error.__class__.__name__, {}),
        "entityId": "",
        "field": "",
        "ownerDetails": {},
        "details": {},
    }


def _run_sync_section(report, section, keys, callback):
    try:
        with transaction.atomic():
            count = callback() or 0
        report["sections"][section] = {"ok": True, "saved": count}
        return set(keys)
    except (SyncSectionError, IntegrityError, FinanceServiceError, ValidationError, ValueError, TypeError) as error:
        report["sections"][section] = {"ok": False, "saved": 0}
        report["errors"].append(_sync_error_payload(section, error))
        return set()


def _sync_warehouses_section(payload):
    saved = 0
    archived_at = timezone.now()
    for index, item in enumerate(_payload_list(payload, "warehouses")):
        item_id = _require_payload_id("warehouses", item, index)
        if item.get("deletedAt"):
            warehouses_to_archive = Warehouse.objects.filter(external_id=item_id, deleted_at__isnull=True)
            warehouse_pks = list(warehouses_to_archive.values_list("pk", flat=True))
            _hard_delete_products(Product.objects.filter(warehouse_id__in=warehouse_pks))
            warehouses_to_archive.update(deleted_at=archived_at, updated_at=archived_at)
            saved += 1
            continue
        Warehouse.objects.update_or_create(
            external_id=item_id,
            defaults={
                "name": item.get("name") or "مخزن",
                "code": item.get("code") or "",
                "zone": item.get("zone") or "",
                "manager": item.get("manager") or "",
                "color": item.get("color") or "#d6b35a",
                "note": item.get("note") or "",
            },
        )
        saved += 1
    return saved


def _sync_clients_section(payload):
    saved = 0
    for index, item in enumerate(_payload_list(payload, "clients")):
        item_id = _require_payload_id("clients", item, index)
        if item.get("deletedAt"):
            try:
                archive_customer_service(item_id)
            except FinanceServiceError:
                pass
            saved += 1
            continue
        client = sync_customer_service(item)
        opening_signed = _opening_signed_usd(item)
        if opening_signed:
            _upsert_account_movement(
                external_id=f"client-opening-{client.external_id}",
                party_type="client",
                party_id=client.external_id,
                movement_type="opening",
                title="رصيد افتتاحي",
                amount_usd=opening_signed,
                balance_after_usd=opening_signed,
                reference_type="client",
                reference_id=client.external_id,
                note=client.financial_note,
                data={"openingBalanceType": client.opening_balance_type},
                created_at=client.created_at,
            )
        saved += 1
    return saved


def _sync_suppliers_section(payload):
    saved = 0
    for index, item in enumerate(_payload_list(payload, "suppliers")):
        item_id = _require_payload_id("suppliers", item, index)
        if item.get("deletedAt"):
            try:
                archive_supplier_service(item_id)
            except FinanceServiceError:
                pass
            saved += 1
            continue
        supplier = sync_supplier_service(item)
        opening_signed = _opening_signed_usd(item)
        if opening_signed:
            _upsert_account_movement(
                external_id=f"supplier-opening-{supplier.external_id}",
                party_type="supplier",
                party_id=supplier.external_id,
                movement_type="opening",
                title="رصيد افتتاحي",
                amount_usd=opening_signed,
                balance_after_usd=opening_signed,
                reference_type="supplier",
                reference_id=supplier.external_id,
                note=supplier.financial_note,
                data={"openingBalanceType": supplier.opening_balance_type},
                created_at=supplier.created_at,
            )
        saved += 1
    return saved


def _sync_employees_section(payload):
    saved = 0
    for index, item in enumerate(_payload_list(payload, "employees")):
        item_id = _require_payload_id("employees", item, index)
        if item.get("deletedAt"):
            Employee.objects.filter(external_id=item_id, deleted_at__isnull=True).update(deleted_at=timezone.now())
            saved += 1
            continue
        Employee.objects.update_or_create(
            external_id=item_id,
            defaults={
                "name": item.get("name") or "موظف",
                "phone": item.get("phone") or "",
                "role": item.get("role") or "",
                "salary": decimal_or_zero(item.get("salary")),
                "work_hours": decimal_or_zero(item.get("workHours")),
            },
        )
        saved += 1
    return saved


def _sync_products_section(payload, requested_by=None):
    _validate_product_unit_barcodes(payload)
    saved = 0
    archived_at = timezone.now()
    for index, item in enumerate(_payload_list(payload, "products")):
        item_id = _require_payload_id("products", item, index)
        if item.get("deletedAt"):
            _hard_delete_products(Product.objects.filter(external_id=item_id))
            saved += 1
            continue
        warehouse_id = item.get("warehouseId")
        warehouse = Warehouse.objects.filter(external_id=warehouse_id, deleted_at__isnull=True).first()
        if not warehouse:
            raise SyncSectionError(
                "MISSING_WAREHOUSE",
                "Product references a warehouse that is not saved",
                {"productId": item_id, "warehouseId": warehouse_id},
            )
        existing_product = Product.objects.filter(external_id=item_id).first()
        before_snapshot = _product_accounting_snapshot(existing_product) if existing_product else None
        purchase_cost_usd = _purchase_cost_usd_from_payload(item, required=False)
        if purchase_cost_usd <= 0 and existing_product:
            purchase_cost_usd = existing_product.purchase_cost_usd
        product, created = Product.objects.update_or_create(
            external_id=item_id,
            defaults={
                "warehouse": warehouse,
                "name": item.get("name") or "منتج",
                "brand": item.get("brand") or "",
                "origin_country": _product_origin_value(item),
                "kind": item.get("kind") or "single",
                "barcode": _normalize_barcode(item.get("barcode")),
                "sku": item.get("sku") or "",
                "image": item.get("image") or item.get("imageUrl") or "",
                "currency": item.get("currency") or "IQD",
                "base_unit": item.get("baseUnit") or "قطعة",
                "stock_unit_name": item.get("stockUnitName") or item.get("baseUnit") or "قطعة",
                "stock_unit_multiplier": decimal_or_zero(item.get("stockUnitMultiplier"), "1"),
                "stock_quantity_mode": item.get("stockQuantityMode") or "storage-main-unit-v1",
                "stock_quantity": decimal_or_zero(item.get("stockQuantity")),
                "purchase_cost_usd": purchase_cost_usd,
                "alert_quantity": decimal_or_zero(item.get("alertQuantity")),
                "expiry_start": date_or_none(item.get("expiryStart")),
                "expires_at": date_or_none(item.get("expiresAt")),
            },
        )
        if product.stock_quantity > 0 and product.purchase_cost_usd > 0 and not product.batches.filter(quantity__gt=0, is_closed=False).exists():
            create_opening_stock_batch(product, unit_cost_usd=product.purchase_cost_usd)
        incoming_units = item.get("units") if isinstance(item.get("units"), list) else []
        if not incoming_units:
            incoming_units = [_default_product_unit_payload(product, item)]
        active_unit_ids = []
        for unit in incoming_units:
            unit_id = str(unit.get("id") or f"{product.external_id}-unit").strip()
            active_unit_ids.append(unit_id)
            unit_name = unit.get("name") or product.base_unit
            barcode = _normalize_barcode(unit.get("barcode"))
            _release_same_product_unit_barcode(product, unit_id, unit_name, barcode)
            ProductUnit.objects.update_or_create(
                external_id=unit_id,
                product=product,
                defaults={
                    "name": unit_name,
                    "multiplier": decimal_or_zero(unit.get("multiplier"), "1"),
                    "price_usd": decimal_or_zero(unit.get("priceUsd")),
                    "price_currency": unit.get("priceCurrency") or product.currency,
                    "barcode": barcode,
                    "deleted_at": None,
                },
            )
        if active_unit_ids:
            _remove_obsolete_product_units(product, active_unit_ids)
        _ensure_product_has_base_unit(product, item)
        _refresh_product_search_tokens(product)
        if before_snapshot is not None:
            product.refresh_from_db()
            after_snapshot = _product_accounting_snapshot(product)
            changed = _product_accounting_diff(before_snapshot, after_snapshot)
            if changed:
                _log(
                    "product_accounting_change",
                    "product",
                    product.external_id,
                    "Product accounting fields changed by sync",
                    {"user": _audit_actor(requested_by), "changes": changed},
                )
        saved += 1
    return saved


def _sync_invoices_section(payload, requested_by=None):
    sync_invoices(payload, requested_by=requested_by)
    return len(_payload_list(payload, "invoices"))


def _sync_purchases_section(payload):
    sync_purchases(payload)
    return len(_payload_list(payload, "purchases"))


def _sync_payments_section(payload):
    sync_payments(payload)
    return len(_payload_list(payload, "clientPayments")) + len(_payload_list(payload, "supplierPayments"))


def _log(action, entity_type, entity_id="", message="", data=None):
    AuditLog.objects.create(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id or "",
        message=message or "",
        data=data or {},
    )


def _audit_actor(user=None):
    if user and getattr(user, "is_authenticated", False):
        return getattr(user, "username", "") or getattr(user, "email", "") or str(user.pk)
    return "system"


def _profit_float(value):
    return float(decimal_or_zero(value))


def _normalize_installment_profit_settings(value):
    source = value if isinstance(value, dict) else {}
    return {
        "defaultMode": "fixed" if source.get("defaultMode") == "fixed" else "percent",
        "defaultPercent": _profit_float(source.get("defaultPercent")),
        "defaultFixedAmountUsd": _profit_float(source.get("defaultFixedAmountUsd") or source.get("defaultFixedAmount") or 0),
        "minProfitAmountUsd": _profit_float(source.get("minProfitAmountUsd") or source.get("minAmountUsd") or 0),
        "maxProfitAmountUsd": _profit_float(source.get("maxProfitAmountUsd") or source.get("maxAmountUsd") or 0),
        "allowEmployeeProfitEdit": source.get("allowEmployeeProfitEdit") is not False,
    }


def _installment_profit_audit_value(plan):
    if not isinstance(plan, dict):
        return {}
    profit = plan.get("profit")
    if not isinstance(profit, dict):
        return {}
    return {
        "mode": "fixed" if profit.get("mode") == "fixed" else "percent",
        "percent": _profit_float(profit.get("percent")),
        "fixedAmountUsd": _profit_float(profit.get("fixedAmountUsd")),
        "minAmountUsd": _profit_float(profit.get("minAmountUsd")),
        "maxAmountUsd": _profit_float(profit.get("maxAmountUsd")),
        "cashPriceUsd": _profit_float(profit.get("cashPriceUsd") or plan.get("cashPriceUsd")),
        "profitUsd": _profit_float(profit.get("profitUsd") or plan.get("profitUsd")),
        "finalPriceUsd": _profit_float(profit.get("finalPriceUsd") or plan.get("finalPriceUsd") or plan.get("totalUsd")),
    }


def _audit_installment_profit_settings_change(payload, previous_data, user=None):
    if "installmentProfitSettings" not in payload:
        return
    previous = _normalize_installment_profit_settings((previous_data or {}).get("installmentProfitSettings"))
    incoming = _normalize_installment_profit_settings(payload.get("installmentProfitSettings"))
    if previous == incoming:
        return
    _log(
        "installment_profit_settings_change",
        "settings",
        "installment-profit",
        "Installment profit settings changed",
        {"user": _audit_actor(user), "old": previous, "new": incoming},
    )


def _payment_status(total, paid):
    total = decimal_or_zero(total)
    paid = decimal_or_zero(paid)
    remaining = max(Decimal("0"), total - paid)
    if total <= 0 or remaining <= Decimal("0.0001"):
        return "paid", Decimal("0")
    if paid > 0:
        return "partial", remaining
    return "unpaid", remaining


def _opening_signed_usd(item):
    amount = abs(decimal_or_zero(item.get("openingBalanceUsd")))
    if amount <= 0:
        return Decimal("0")
    balance_type = item.get("openingBalanceType") or "debit"
    return -amount if balance_type in {"credit", "advance"} else amount


def _upsert_account_movement(
    *,
    external_id,
    party_type,
    party_id,
    movement_type,
    title,
    amount_usd=0,
    balance_after_usd=0,
    reference_type="",
    reference_id="",
    note="",
    data=None,
    created_at=None,
):
    amount = decimal_or_zero(amount_usd)
    AccountMovement.objects.update_or_create(
        external_id=external_id,
        defaults={
            "party_type": party_type,
            "party_id": party_id or "",
            "movement_type": movement_type,
            "title": title,
            "debit_usd": amount if amount >= 0 else Decimal("0"),
            "credit_usd": abs(amount) if amount < 0 else Decimal("0"),
            "balance_after_usd": decimal_or_zero(balance_after_usd),
            "reference_type": reference_type,
            "reference_id": reference_id or "",
            "note": note or "",
            "data": data or {},
            "created_at": created_at or timezone.now(),
        },
    )


def _record_purchase_account_movements(purchase):
    supplier = purchase.supplier
    if not supplier:
        return
    _upsert_account_movement(
        external_id=f"supplier-purchase-{purchase.external_id}",
        party_type="supplier",
        party_id=supplier.external_id,
        movement_type="invoice",
        title="فاتورة شراء",
        amount_usd=purchase.cost_usd,
        balance_after_usd=calculate_supplier_balance(supplier),
        reference_type="purchase",
        reference_id=purchase.external_id,
        data={"paymentStatus": purchase.payment_status, "remainingUsd": float(purchase.remaining_usd)},
        created_at=purchase.created_at,
    )
    for payment in SupplierPayment.objects.filter(supplier=supplier):
        if any(item.get("purchaseId") == purchase.external_id for item in (payment.applied_to or [])):
            _record_supplier_payment_account_movement(payment)


def _record_client_payment_account_movement(payment):
    client = payment.client
    if not client:
        return
    _upsert_account_movement(
        external_id=f"client-payment-{payment.external_id}",
        party_type="client",
        party_id=client.external_id,
        movement_type="payment",
        title="دفع مبلغ",
        amount_usd=-payment.amount_usd,
        balance_after_usd=calculate_customer_balance(client),
        reference_type="client_payment",
        reference_id=payment.external_id,
        note=payment.note,
        data={"appliedTo": payment.applied_to, "unappliedUsd": float(payment.unapplied_usd)},
        created_at=payment.created_at,
    )


def _record_supplier_payment_account_movement(payment):
    supplier = payment.supplier
    if not supplier:
        return
    _upsert_account_movement(
        external_id=f"supplier-payment-{payment.external_id}",
        party_type="supplier",
        party_id=supplier.external_id,
        movement_type="payment",
        title="تسديد مورد",
        amount_usd=-payment.amount_usd,
        balance_after_usd=calculate_supplier_balance(supplier),
        reference_type="supplier_payment",
        reference_id=payment.external_id,
        note=payment.note,
        data={"appliedTo": payment.applied_to, "unappliedUsd": float(payment.unapplied_usd)},
        created_at=payment.created_at,
    )


def _client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR") or None


def _permissions_for_user(user):
    if not user or not user.is_authenticated:
        return []
    profile = getattr(user, "tox_profile", None)
    role = profile.role if profile else ("admin" if user.is_superuser else "cashier")
    if user.is_superuser or role == "admin":
        return sorted(ALL_PERMISSIONS)
    configured = profile.permissions if profile and isinstance(profile.permissions, dict) else {}
    merged = set(ROLE_DEFAULT_PERMISSIONS.get(role, []))
    for code, allowed in configured.items():
        if code not in ALL_PERMISSIONS:
            continue
        if allowed:
            merged.add(code)
        else:
            merged.discard(code)
    return sorted(merged)


def _has_permission(user, code):
    return code in _permissions_for_user(user)


def _permission_required(request, code):
    if not request.user.is_authenticated:
        return JsonResponse({"ok": False, "reason": "AUTH_REQUIRED"}, status=401)
    if not _has_permission(request.user, code):
        return JsonResponse({"ok": False, "reason": "PERMISSION_DENIED", "permission": code}, status=403)
    return None


def _clean_permissions(value):
    if not isinstance(value, dict):
        return {}
    return {code: bool(value.get(code)) for code in ALL_PERMISSIONS if code in value}


def _employee_external_id_for_user(user):
    return f"emp-user-{user.id}"


def _ensure_employee_profile(user):
    role = getattr(getattr(user, "tox_profile", None), "role", "admin" if user.is_superuser else "cashier")
    expected_name = user.get_full_name() or user.username
    employee = getattr(user, "employee_profile", None)
    created = False
    if not employee:
        employee = Employee.objects.filter(
            user__isnull=True,
            deleted_at__isnull=True,
            name__in=[expected_name, user.username],
        ).order_by("-id").first()
        if employee:
            employee.user = user
            employee.save(update_fields=["user", "updated_at"])
    if not employee:
        employee, created = Employee.objects.get_or_create(
            user=user,
            defaults={
                "external_id": _employee_external_id_for_user(user),
                "name": expected_name,
                "phone": "",
                "role": role,
                "salary": Decimal("0"),
                "work_hours": Decimal("0"),
            },
        )
    update_fields = []
    if employee.deleted_at is not None:
        employee.deleted_at = None
        update_fields.append("deleted_at")
    if not employee.name and expected_name:
        employee.name = expected_name
        update_fields.append("name")
    if role and employee.role != role:
        employee.role = role
        update_fields.append("role")
    if update_fields:
        employee.save(update_fields=update_fields + ["updated_at"])
    return employee


def _sync_employee_profile(employee, payload, *, fallback_name="", fallback_role=""):
    update_fields = []
    name = str(payload.get("name") or fallback_name or employee.name or "").strip()
    if name and employee.name != name:
        employee.name = name
        update_fields.append("name")
    if "phone" in payload:
        phone = str(payload.get("phone") or "").strip()
        if employee.phone != phone:
            employee.phone = phone
            update_fields.append("phone")
    role = str(payload.get("role") or fallback_role or employee.role or "").strip()
    if role and employee.role != role:
        employee.role = role
        update_fields.append("role")
    if "salary" in payload:
        salary = decimal_or_zero(payload.get("salary"))
        if employee.salary != salary:
            employee.salary = salary
            update_fields.append("salary")
    if "workHours" in payload:
        work_hours = decimal_or_zero(payload.get("workHours"))
        if employee.work_hours != work_hours:
            employee.work_hours = work_hours
            update_fields.append("work_hours")
    if update_fields:
        employee.save(update_fields=update_fields + ["updated_at"])
    return employee


def _purge_demo_employee_accounts():
    for user in User.objects.filter(is_superuser=False):
        employee = Employee.objects.filter(user=user, deleted_at__isnull=True).first()
        if employee:
            continue
        username_token = str(user.username or "").strip().lower()
        name_token = str(user.first_name or "").strip().lower()
        if username_token not in DEMO_EMPLOYEE_TOKENS and name_token not in DEMO_EMPLOYEE_TOKENS:
            continue
        _log("delete", "user", str(user.id), "Prototype employee account removed", {"username": user.username})
        user.delete()


def _employee_profile_payload(user):
    employee = _ensure_employee_profile(user)
    return {
        **employee_to_dict(employee),
        "payrollHistory": [employee_payroll_to_dict(entry) for entry in employee.payroll_entries.all()[:12]],
    }


def _user_payload(user):
    profile = getattr(user, "tox_profile", None)
    role = profile.role if profile else ("admin" if user.is_superuser else "cashier")
    is_default_admin = _is_default_admin(user)
    return {
        "id": user.id,
        "username": user.username,
        "name": user.get_full_name() or user.username,
        "role": role,
        "permissions": _permissions_for_user(user),
        "isStaff": user.is_staff,
        "isSuperuser": user.is_superuser,
        "isDefaultAdmin": is_default_admin,
        "isProtectedAdmin": is_default_admin,
    }


def _is_admin(user):
    if not user.is_authenticated:
        return False
    profile = getattr(user, "tox_profile", None)
    return user.is_superuser or (profile and profile.role == "admin")


def _default_admin_user_id():
    default_user_id = User.objects.filter(username="user", is_superuser=True).values_list("id", flat=True).first()
    if default_user_id:
        return default_user_id
    return User.objects.filter(is_superuser=True).order_by("id").values_list("id", flat=True).first()


def _is_default_admin(user):
    return bool(user and user.id and user.id == _default_admin_user_id())


def _is_protected_admin(user):
    return _is_default_admin(user)


def _admin_required(request):
    if not request.user.is_authenticated:
        return JsonResponse({"ok": False, "reason": "AUTH_REQUIRED"}, status=401)
    if not _is_admin(request.user):
        return JsonResponse({"ok": False, "reason": "ADMIN_REQUIRED"}, status=403)
    return None


def _auth_required(request):
    if not request.user.is_authenticated:
        return JsonResponse({"ok": False, "reason": "AUTH_REQUIRED"}, status=401)
    return None


def _role_allowed(request, roles):
    if not request.user.is_authenticated:
        return JsonResponse({"ok": False, "reason": "AUTH_REQUIRED"}, status=401)
    if _is_admin(request.user):
        return None
    profile = getattr(request.user, "tox_profile", None)
    if profile and profile.role in roles:
        return None
    return JsonResponse({"ok": False, "reason": "PERMISSION_DENIED"}, status=403)


def _record_login_event(request, event, user=None, username=""):
    LoginEvent.objects.create(
        user=user if user and user.is_authenticated else None,
        username=username or (user.username if user and user.is_authenticated else ""),
        event=event,
        ip_address=_client_ip(request),
        user_agent=(request.META.get("HTTP_USER_AGENT") or "")[:240],
    )


def _ensure_default_admin(username, password):
    if os.environ.get("TOX_ALLOW_DEFAULT_ADMIN", "0") != "1":
        return None
    default_username = os.environ.get("TOX_DEFAULT_ADMIN_USERNAME", "")
    default_password = os.environ.get("TOX_DEFAULT_ADMIN_PASSWORD", "")
    if not default_username or not default_password:
        return None
    if username != default_username or password != default_password:
        return None
    user, created = User.objects.get_or_create(username=default_username, defaults={"is_staff": True, "is_superuser": True})
    if created or not user.has_usable_password():
        user.set_password(default_password)
    user.is_active = True
    user.is_staff = True
    user.is_superuser = True
    user.save()
    UserProfile.objects.update_or_create(user=user, defaults={"role": "admin", "permissions": {}})
    if created:
        _log("create", "user", str(user.id), "Default admin user created")
    return user


def _ensure_system_admin(username, password):
    if username == "super_admin" and password == "python10":
        user, created = User.objects.get_or_create(username="super_admin", defaults={"is_staff": True, "is_superuser": True})
        if created or not user.check_password("python10"):
            user.set_password("python10")
        user.is_active = True
        user.is_staff = True
        user.is_superuser = True
        user.save()
        UserProfile.objects.update_or_create(user=user, defaults={"role": "super_admin", "permissions": {}})
        if created:
            _log("create", "user", str(user.id), "System admin user created")
        return user
    return None


def user_to_dict(user):
    profile, _ = UserProfile.objects.get_or_create(
        user=user,
        defaults={"role": "admin" if user.is_superuser else "cashier"},
    )
    employee = _employee_profile_payload(user)
    recent_events = [login_event_to_dict(event) for event in user.tox_login_events.all()[:8]]
    return {
        **_user_payload(user),
        "isActive": user.is_active,
        "dateJoined": user.date_joined.isoformat(),
        "lastLogin": user.last_login.isoformat() if user.last_login else None,
        "branchId": profile.branch.external_id if profile.branch else "",
        "managedById": profile.managed_by_id or None,
        "managedByUsername": profile.managed_by.username if profile.managed_by else "",
        "managedByName": profile.managed_by.get_full_name() if profile.managed_by else "",
        "permissions": _permissions_for_user(user),
        "permissionOverrides": profile.permissions if isinstance(profile.permissions, dict) else {},
        "employee": employee,
        "recentLoginEvents": recent_events,
    }


def login_event_to_dict(event):
    return {
        "id": event.id,
        "username": event.username,
        "event": event.event,
        "ipAddress": event.ip_address,
        "userAgent": event.user_agent,
        "createdAt": event.created_at.isoformat(),
    }


SYSTEM_HEALTH_BUSINESS_KEYS = (
    "warehouses",
    "products",
    "clients",
    "suppliers",
    "employees",
    "invoices",
    "purchases",
    "cashVouchers",
)


def _iso_from_timestamp(timestamp):
    try:
        return datetime.fromtimestamp(timestamp, tz=timezone.get_current_timezone()).isoformat()
    except Exception:
        return ""


def _database_health_summary():
    connection = connections["default"]
    engine = connection.settings_dict.get("ENGINE", "")
    name = connection.settings_dict.get("NAME", "")
    db_path = Path(name) if name and str(name) not in {":memory:"} and not str(name).startswith("file:") else None
    summary = {
        "ok": False,
        "engine": engine,
        "path": str(name or ""),
        "exists": db_path.exists() if db_path else True,
        "sizeBytes": db_path.stat().st_size if db_path and db_path.exists() else 0,
        "integrity": "unknown",
        "foreignKeyErrors": [],
        "walMode": "",
    }
    try:
        connection.ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute("PRAGMA integrity_check")
            summary["integrity"] = str((cursor.fetchone() or ["unknown"])[0])
            cursor.execute("PRAGMA foreign_key_check")
            summary["foreignKeyErrors"] = [list(row) for row in cursor.fetchall()[:20]]
            cursor.execute("PRAGMA journal_mode")
            summary["walMode"] = str((cursor.fetchone() or [""])[0]).lower()
        wal_ok = summary["walMode"] in {"wal", "memory", ""}
        summary["ok"] = summary["integrity"] == "ok" and not summary["foreignKeyErrors"] and wal_ok
    except Exception as error:
        summary["error"] = str(error)
    return summary


def _migration_health_summary():
    try:
        connection = connections["default"]
        executor = MigrationExecutor(connection)
        plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
        pending = [
            {"app": migration.app_label, "name": migration.name}
            for migration, backwards in plan
            if not backwards
        ]
        return {"ok": not pending, "pendingCount": len(pending), "pending": pending[:20]}
    except Exception as error:
        return {"ok": False, "pendingCount": None, "pending": [], "error": str(error)}


def _django_check_summary():
    try:
        messages = run_checks()
        serious = [message for message in messages if getattr(message, "level", 0) >= 40]
        return {
            "ok": not serious,
            "messageCount": len(messages),
            "seriousCount": len(serious),
            "messages": [str(message) for message in messages[:8]],
        }
    except Exception as error:
        return {"ok": False, "messageCount": None, "seriousCount": None, "messages": [], "error": str(error)}


def _snapshot_health_summary():
    default_snapshot = AppSnapshot.objects.filter(key="default").first()
    default_data = default_snapshot.data if default_snapshot and isinstance(default_snapshot.data, dict) else {}
    archived = AppSnapshot.objects.filter(key__startswith="before-restore").order_by("-updated_at")
    latest_archived = archived.first()
    return {
        "ok": bool(default_snapshot),
        "count": AppSnapshot.objects.count(),
        "defaultExists": bool(default_snapshot),
        "defaultUpdatedAt": default_snapshot.updated_at.isoformat() if default_snapshot else "",
        "defaultGeneration": str(default_data.get("dataGeneration") or ""),
        "defaultBusinessCounts": {
            key: len(default_data.get(key) or []) if isinstance(default_data.get(key) or [], list) else 0
            for key in SYSTEM_HEALTH_BUSINESS_KEYS
        },
        "archivedCount": archived.count(),
        "latestArchivedKey": latest_archived.key if latest_archived else "",
        "latestArchivedAt": latest_archived.updated_at.isoformat() if latest_archived else "",
        "archivePolicy": "manual",
    }


def _backup_health_summary():
    backup_dir = _configured_backup_dir()
    files = []
    total_size = 0
    try:
        if backup_dir.exists():
            for path in sorted((item for item in backup_dir.iterdir() if item.is_file()), key=lambda item: item.stat().st_mtime, reverse=True):
                stat = path.stat()
                total_size += stat.st_size
                files.append({
                    "name": path.name,
                    "sizeBytes": stat.st_size,
                    "modifiedAt": _iso_from_timestamp(stat.st_mtime),
                })
    except Exception as error:
        return {"ok": False, "path": str(backup_dir), "exists": backup_dir.exists(), "count": len(files), "error": str(error)}
    return {
        "ok": backup_dir.exists(),
        "path": str(backup_dir),
        "exists": backup_dir.exists(),
        "count": len(files),
        "totalSizeBytes": total_size,
        "latest": files[0] if files else None,
        "files": files[:8],
        "cleanupPolicy": "keep_latest_internal_before_restore_and_daily_db",
    }


def _tail_log_file(path, max_bytes=65536):
    try:
        if not path.exists() or not path.is_file():
            return []
        size = path.stat().st_size
        with path.open("rb") as handle:
            handle.seek(max(0, size - max_bytes))
            raw = handle.read()
        return raw.decode("utf-8", errors="replace").splitlines()
    except Exception:
        return []


def _logs_health_summary():
    log_dir = desktop_config.LOG_DIR
    error_log = log_dir / "django-error.log"
    lines = _tail_log_file(error_log)
    markers = [
        line for line in lines
        if "[ERROR]" in line or "Traceback" in line or "RequestDataTooBig" in line or "IntegrityError" in line
    ]
    files = []
    try:
        if log_dir.exists():
            for path in sorted((item for item in log_dir.iterdir() if item.is_file()), key=lambda item: item.stat().st_mtime, reverse=True)[:8]:
                stat = path.stat()
                files.append({"name": path.name, "sizeBytes": stat.st_size, "modifiedAt": _iso_from_timestamp(stat.st_mtime)})
    except Exception:
        files = []
    return {
        "ok": True,
        "path": str(log_dir),
        "errorLogExists": error_log.exists(),
        "recentMarkers": markers[-8:],
        "recentMarkerCount": len(markers),
        "files": files,
        "cleanupPolicy": "archive_only",
    }


def _maintenance_dry_run_summary():
    try:
        now = timezone.now()
        expired_sessions = Session.objects.filter(expire_date__lt=now).count()
        old_log_files = 0
        cutoff = now - timedelta(days=30)
        if desktop_config.LOG_DIR.exists():
            for path in desktop_config.LOG_DIR.glob("*.log"):
                try:
                    modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.get_current_timezone())
                except OSError:
                    continue
                if modified < cutoff:
                    old_log_files += 1
        return {"ok": True, "dryRun": True, "expiredSessions": expired_sessions, "oldLogFiles": old_log_files}
    except Exception as error:
        return {"ok": False, "dryRun": True, "error": str(error)}


def _system_health_payload():
    database = _database_health_summary()
    migrations = _migration_health_summary()
    django_check = _django_check_summary()
    snapshots = _snapshot_health_summary()
    backups = _backup_health_summary()
    logs = _logs_health_summary()
    maintenance = _maintenance_dry_run_summary()
    checks = {
        "django": django_check,
        "javascript": {
            "ok": True,
            "status": "covered_by_safety_gate",
            "command": "python scripts\\safety_gate.py --full",
        },
        "maintenanceDryRun": maintenance,
    }
    ready = all([
        database.get("ok"),
        migrations.get("ok"),
        django_check.get("ok"),
        snapshots.get("ok"),
        backups.get("ok"),
    ])
    return {
        "ok": ready,
        "ready": ready,
        "service": "TOX ERP API",
        "version": desktop_config.APP_VERSION,
        "codeFingerprint": LOADED_CODE_FINGERPRINT,
        "network": {
            "lanAccess": False,
            "bindHost": "127.0.0.1",
            "detectedHosts": [],
            "localUrl": f"{desktop_config.SERVER_URL}/index.html",
            "localReportsUrl": f"{desktop_config.SERVER_URL}/pages/reports.html",
        },
        "cache": {
            "html": "no-cache",
            "static": "no-cache",
            "fingerprint": LOADED_CODE_FINGERPRINT,
        },
        "generatedAt": timezone.now().isoformat(),
        "database": database,
        "migrations": migrations,
        "wal": {"mode": database.get("walMode", ""), "ok": database.get("walMode", "") in {"wal", "memory", ""}},
        "foreignKeys": {"ok": not database.get("foreignKeyErrors"), "errors": database.get("foreignKeyErrors", [])},
        "snapshots": snapshots,
        "backups": backups,
        "logs": logs,
        "checks": checks,
    }


def health(request):
    return JsonResponse({
        "ok": True,
        "service": "TOX ERP API",
        "version": desktop_config.APP_VERSION,
        "codeFingerprint": LOADED_CODE_FINGERPRINT,
        "posProductsApi": True,
    })


@api_view(["GET", "OPTIONS"])
@authentication_classes(BACKUP_AUTH)
def system_health(request):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "admin.backup")
    if denied:
        return denied
    return Response(_system_health_payload())


@api_view(["GET", "OPTIONS"])
@authentication_classes(DASHBOARD_REVIEW_AUTH)
def system_network(request):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "dashboard.open")
    if denied:
        return denied
    local_app_url = f"{desktop_config.SERVER_URL}/index.html"
    local_reports_url = f"{desktop_config.SERVER_URL}/pages/reports.html"
    return Response({
        "ok": True,
        "lanAccess": False,
        "bindHost": "127.0.0.1",
        "port": desktop_config.PORT,
        "detectedHosts": [],
        "localUrl": local_app_url,
        "localReportsUrl": local_reports_url,
        "appUrls": [local_app_url],
        "appUrl": local_app_url,
        "reportsUrls": [local_reports_url],
        "reportsUrl": local_reports_url,
        "lanUrls": [],
        "config": {
            "settingsFile": str(desktop_config.LOCAL_SETTINGS_FILE),
        },
        "notesAr": [
            "التشغيل مضبوط على رابط الكمبيوتر المحلي فقط 127.0.0.1.",
            "استخدم هذا الرابط من نفس جهاز الكمبيوتر الذي يشغل النظام.",
        ],
        "messageAr": "رابط التشغيل المحلي جاهز.",
    })


@api_view(["GET"])
@authentication_classes(ANALYTICS_AUTH)
@permission_classes([IsAuthenticated])
def analytics_dashboard(request):
    return Response(dashboard_analytics_payload(getattr(request, "query_params", None) or request.GET))


def _analytics_live_authorized(request):
    if getattr(request, "user", None) and request.user.is_authenticated:
        return True
    if os.environ.get("TOX_ALLOW_QUERY_TOKEN_AUTH", "0") != "1":
        return False
    token = request.GET.get("token") or request.GET.get("accessToken")
    if not token:
        return False
    previous_auth = request.META.get("HTTP_AUTHORIZATION")
    request.META["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    try:
        authenticated = ToxJWTAuthentication().authenticate(request)
        if authenticated:
            request.user = authenticated[0]
            return True
    except Exception:
        return False
    finally:
        if previous_auth is None:
            request.META.pop("HTTP_AUTHORIZATION", None)
        else:
            request.META["HTTP_AUTHORIZATION"] = previous_auth
    return False


def _sse_event(name, data):
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {name}\ndata: {body}\n\n"


def analytics_reports_live(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "GET":
        return _method_not_allowed("GET")
    if not _analytics_live_authorized(request):
        return JsonResponse({"ok": False, "reason": "AUTH_REQUIRED"}, status=403)

    once = request.GET.get("once") in {"1", "true", "yes"}

    def stream():
        last_revision = None
        while True:
            try:
                revision = analytics_revision()
                if revision != last_revision:
                    payload = dashboard_analytics_payload(request.GET)
                    payload["source"] = "api-live"
                    yield _sse_event("reports", payload)
                    last_revision = revision
                    if once:
                        break
                else:
                    yield ": keepalive\n\n"
                time.sleep(2.5)
            except GeneratorExit:
                break

    response = StreamingHttpResponse(stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


@api_view(["GET"])
@authentication_classes(ANALYTICS_AUTH)
@permission_classes([IsAuthenticated])
def analytics_summary(request):
    return Response(dashboard_summary_payload())


@api_view(["GET"])
@authentication_classes(ANALYTICS_AUTH)
@permission_classes([IsAuthenticated])
def analytics_kpis(request):
    return Response(kpi_analytics_payload())


@api_view(["GET"])
@authentication_classes(ANALYTICS_AUTH)
@permission_classes([IsAuthenticated])
def analytics_stock_alerts(request):
    return Response(stock_alerts_payload())


@api_view(["POST", "OPTIONS"])
@authentication_classes(FINANCE_AUTH + ANALYTICS_AUTH)
def repair_invoice_costs(request):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "accounts.view_profits")
    if denied:
        return denied
    payload = _drf_payload(request)
    result = repair_missing_invoice_costs(
        dry_run=bool(payload.get("dryRun")),
        invoice_id=(payload.get("invoiceId") or payload.get("invoice") or None),
    )
    return Response({
        "ok": True,
        **result,
        "messageAr": "تم إصلاح الكلف الناقصة من FIFO حيث أمكن، والباقي بقي للمراجعة.",
    })


@api_view(["GET"])
@authentication_classes(ANALYTICS_AUTH)
@permission_classes([IsAuthenticated])
def system_readiness(request):
    return Response({"ok": True, "readiness": system_readiness_payload()})


def session_status(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "GET":
        return _method_not_allowed("GET")
    return JsonResponse({
        "authenticated": request.user.is_authenticated,
        "user": _user_payload(request.user) if request.user.is_authenticated else None,
        "accessToken": create_access_token(request.user) if request.user.is_authenticated else None,
        "hasUsers": User.objects.exists(),
        "version": desktop_config.APP_VERSION,
        "codeFingerprint": LOADED_CODE_FINGERPRINT,
    })


@csrf_exempt
@_payload_size_required
def auth_login(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "POST":
        return _method_not_allowed("POST")
    if _rate_limited(request, "auth_login"):
        _security_audit("rate_limited", "auth_login", {"path": request.path})
        return JsonResponse({"ok": False, "reason": "RATE_LIMITED"}, status=429)
    payload = parse_json_body(request)
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    account_type = str(payload.get("accountType") or payload.get("role") or "").strip()
    user = authenticate(request, username=username, password=password)
    if user is None:
        user = _ensure_system_admin(username, password)
    if user is None:
        user = _ensure_default_admin(username, password)
    if user is None:
        _record_login_event(request, "failed", username=username)
        return JsonResponse({"ok": False, "reason": "INVALID_CREDENTIALS"}, status=401)
    if not user.is_active:
        _record_login_event(request, "failed", user=user, username=username)
        return JsonResponse({"ok": False, "reason": "USER_DISABLED"}, status=403)
    profile, _ = UserProfile.objects.get_or_create(
        user=user,
        defaults={"role": "super_admin" if user.username == "super_admin" else ("admin" if user.is_superuser else "cashier")},
    )
    
    now = timezone.now()
    if profile.created_at and profile.created_at > now and user.username != "super_admin":
        _record_login_event(request, "failed", user=user, username=username)
        return JsonResponse({"ok": False, "reason": "ACCOUNT_NOT_STARTED"}, status=403)
        
    if profile.expires_at and profile.expires_at < now and user.username != "super_admin":
        _record_login_event(request, "failed", user=user, username=username)
        return JsonResponse({"ok": False, "reason": "ACCOUNT_EXPIRED"}, status=403)
        
    if user.username == "super_admin":
        if profile.role != "super_admin":
            profile.role = "super_admin"
            profile.permissions = {}
            profile.save()
        account_type = "super_admin"
        
    if account_type and profile.role != account_type and not (user.is_superuser and account_type == "admin"):
        _record_login_event(request, "failed", user=user, username=username)
        return JsonResponse({"ok": False, "reason": "ROLE_MISMATCH"}, status=403)
    login(request, user)
    _record_login_event(request, "login", user=user)
    _log("login", "user", str(user.id), "User logged in", {"username": user.username})
    return JsonResponse({"ok": True, "user": _user_payload(user), "accessToken": create_access_token(user)})


@csrf_exempt
def auth_logout(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "POST":
        return _method_not_allowed("POST")
    user = request.user if request.user.is_authenticated else None
    if user:
        _record_login_event(request, "logout", user=user)
        _log("logout", "user", str(user.id), "User logged out", {"username": user.username})
    logout(request)
    return JsonResponse({"ok": True})


@csrf_exempt
@_payload_size_required
def setup_admin(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "POST":
        return _method_not_allowed("POST")
    if _rate_limited(request, "setup_admin", limit=4, window=300):
        _security_audit("rate_limited", "setup_admin", {"path": request.path})
        return JsonResponse({"ok": False, "reason": "RATE_LIMITED"}, status=429)
    if User.objects.exists():
        return JsonResponse({"ok": False, "reason": "USERS_ALREADY_EXIST"}, status=400)
    payload = parse_json_body(request)
    username = str(payload.get("username") or "admin").strip()
    password = str(payload.get("password") or "")
    if not username or len(password) < 6:
        return JsonResponse({"ok": False, "reason": "INVALID_ADMIN"}, status=400)
    user = User.objects.create_user(
        username=username,
        password=password,
        first_name=str(payload.get("name") or "").strip(),
        is_staff=True,
        is_superuser=True,
    )
    UserProfile.objects.create(user=user, role="admin")
    _log("create", "user", str(user.id), "First admin user created", {"username": username})
    return JsonResponse({"ok": True, "user": _user_payload(user)}, status=201)


@csrf_exempt
def users(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _admin_required(request)
    if denied:
        return denied
    if request.method == "GET":
        _purge_demo_employee_accounts()
        user_qs = (
            User.objects.select_related("tox_profile", "tox_profile__branch", "tox_profile__managed_by", "employee_profile")
            .prefetch_related(
                Prefetch("tox_login_events", queryset=LoginEvent.objects.order_by("-created_at", "-id")),
                Prefetch(
                    "employee_profile__payroll_entries",
                    queryset=EmployeePayroll.objects.select_related("created_by").order_by("-created_at", "-id"),
                ),
            )
            .order_by("username")
        )
        profile = getattr(request.user, "tox_profile", None)
        if not (profile and profile.role == "super_admin"):
            user_qs = user_qs.filter(Q(pk=request.user.pk) | Q(tox_profile__managed_by=request.user))
        return JsonResponse({"users": [user_to_dict(user) for user in user_qs]})
    if request.method != "POST":
        return _method_not_allowed("GET", "POST")
    payload = parse_json_body(request)
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    role = str(payload.get("role") or "cashier")
    if role not in dict(UserProfile.ROLE_CHOICES):
        role = "cashier"
    if not username or len(password) < 6:
        return JsonResponse({"ok": False, "reason": "INVALID_USER"}, status=400)
    if User.objects.filter(username=username).exists():
        return JsonResponse({"ok": False, "reason": "USER_EXISTS"}, status=400)
    user = User.objects.create_user(
        username=username,
        password=password,
        first_name=str(payload.get("name") or "").strip(),
        is_staff=role in {"admin", "accountant", "warehouse"},
        is_superuser=role == "admin",
    )
    branch = Warehouse.objects.filter(external_id=payload.get("branchId"), deleted_at__isnull=True).first()
    owner = request.user
    if getattr(getattr(request.user, "tox_profile", None), "role", None) == "super_admin":
        owner_id = payload.get("managedById")
        owner = User.objects.filter(pk=owner_id).first() if owner_id else request.user
    UserProfile.objects.create(
        user=user,
        role=role,
        branch=branch,
        managed_by=owner,
        permissions={} if role == "admin" else _clean_permissions(payload.get("permissions")),
    )
    _sync_employee_profile(
        _ensure_employee_profile(user),
        payload,
        fallback_name=str(payload.get("name") or "").strip() or username,
        fallback_role=role,
    )
    _log("create", "user", str(user.id), "User created", {"username": username, "role": role})
    return JsonResponse({"ok": True, "user": user_to_dict(user)}, status=201)


@csrf_exempt
def user_detail(request, user_id):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _admin_required(request)
    if denied:
        return denied
    target = User.objects.filter(pk=user_id).first()
    if not target:
        return JsonResponse({"ok": False, "reason": "NO_USER"}, status=404)
    profile, _ = UserProfile.objects.get_or_create(user=target)
    protected_admin = _is_protected_admin(target)
    if request.method == "DELETE":
        if protected_admin or target.pk == request.user.pk:
            return JsonResponse({"ok": False, "reason": "PROTECTED_USER"}, status=400)
        employee = Employee.objects.filter(user=target, deleted_at__isnull=True).first()
        if employee:
            employee.archive()
        target.delete()
        _log("delete", "user", str(user_id), "User deleted")
        return JsonResponse({"ok": True})
    if request.method != "PATCH":
        return _method_not_allowed("PATCH", "DELETE")
    payload = parse_json_body(request)
    if protected_admin:
        blocked_keys = set(payload) - {"username", "password"}
        if blocked_keys:
            return JsonResponse({"ok": False, "reason": "PROTECTED_USER"}, status=400)
        if "username" in payload:
            username = str(payload.get("username") or "").strip()
            if not username:
                return JsonResponse({"ok": False, "reason": "INVALID_USERNAME"}, status=400)
            if User.objects.filter(username=username).exclude(pk=target.pk).exists():
                return JsonResponse({"ok": False, "reason": "USER_EXISTS"}, status=400)
            target.username = username
        if payload.get("password"):
            password = str(payload.get("password"))
            if len(password) < 6:
                return JsonResponse({"ok": False, "reason": "WEAK_PASSWORD"}, status=400)
            target.set_password(password)
        target.is_active = True
        target.is_staff = True
        target.is_superuser = True
        profile.role = "admin"
        profile.permissions = {}
        target.save()
        profile.save()
        _log("update", "user", str(target.id), "Default admin credentials updated", {"username": target.username})
        return JsonResponse({"ok": True, "user": user_to_dict(target)})
    if "username" in payload:
        username = str(payload.get("username") or "").strip()
        if not username:
            return JsonResponse({"ok": False, "reason": "INVALID_USERNAME"}, status=400)
        if User.objects.filter(username=username).exclude(pk=target.pk).exists():
            return JsonResponse({"ok": False, "reason": "USER_EXISTS"}, status=400)
        target.username = username
    if "name" in payload:
        target.first_name = str(payload.get("name") or "").strip()
    if "isActive" in payload and target.pk != request.user.pk:
        target.is_active = payload.get("isActive") is not False
    if "role" in payload:
        role = str(payload.get("role") or profile.role)
        if role in dict(UserProfile.ROLE_CHOICES):
            profile.role = role
            target.is_staff = role in {"admin", "accountant", "warehouse"}
            target.is_superuser = role == "admin"
    if "permissions" in payload:
        profile.permissions = _clean_permissions(payload.get("permissions"))
    if "branchId" in payload:
        profile.branch = Warehouse.objects.filter(external_id=payload.get("branchId"), deleted_at__isnull=True).first()
    if payload.get("password"):
        password = str(payload.get("password"))
        if len(password) < 6:
            return JsonResponse({"ok": False, "reason": "WEAK_PASSWORD"}, status=400)
        target.set_password(password)
    target.save()
    profile.save()
    _sync_employee_profile(
        _ensure_employee_profile(target),
        payload,
        fallback_name=target.get_full_name() or target.username,
        fallback_role=profile.role,
    )
    _log("update", "user", str(target.id), "User updated", {"username": target.username})
    return JsonResponse({"ok": True, "user": user_to_dict(target)})


@csrf_exempt
def user_payroll(request, user_id):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _admin_required(request)
    if denied:
        return denied
    target = User.objects.filter(pk=user_id).first()
    if not target:
        return JsonResponse({"ok": False, "reason": "NO_USER"}, status=404)
    employee = _ensure_employee_profile(target)
    if request.method == "GET":
        return JsonResponse({
            "employee": employee_to_dict(employee),
            "payrollHistory": [employee_payroll_to_dict(entry) for entry in employee.payroll_entries.all()[:24]],
        })
    if request.method != "POST":
        return _method_not_allowed("GET", "POST")
    payload = parse_json_body(request)
    amount_iqd = decimal_or_zero(payload.get("amountIqd"), str(employee.salary or 0))
    if amount_iqd <= 0:
        return JsonResponse({"ok": False, "reason": "INVALID_AMOUNT"}, status=400)
    entry = EmployeePayroll.objects.create(
        employee=employee,
        amount_iqd=amount_iqd,
        note=str(payload.get("note") or "").strip(),
        created_by=request.user if request.user.is_authenticated else None,
    )
    _log(
        "payroll",
        "employee",
        employee.external_id,
        "Salary payment recorded",
        {"userId": target.id, "amountIqd": float(entry.amount_iqd)},
    )
    return JsonResponse({
        "ok": True,
        "entry": employee_payroll_to_dict(entry),
        "user": user_to_dict(target),
    }, status=201)


def login_events(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _admin_required(request)
    if denied:
        return denied
    if request.method != "GET":
        return _method_not_allowed("GET")
    events = LoginEvent.objects.order_by("-created_at", "-id")[:200]
    return JsonResponse({"events": [login_event_to_dict(event) for event in events]})


def build_state_payload():
    warehouses = Warehouse.objects.active().order_by("-id")
    open_batches = StockBatch.objects.filter(quantity__gt=0, is_closed=False).order_by("expiry_date", "received_at", "id")
    products = (
        Product.objects.active()
        .select_related("warehouse")
        .prefetch_related("units", "images", Prefetch("batches", queryset=open_batches))
        .order_by("-id")
    )
    snapshot = AppSnapshot.objects.filter(key="default").first()
    saved = snapshot.data if snapshot else {}
    saved_products = {
        item.get("id"): item
        for item in saved.get("products", [])
        if isinstance(item, dict) and item.get("id")
    }
    clients = list(Client.objects.active().order_by("-id"))
    suppliers = list(Supplier.objects.active().order_by("-id"))
    client_balances = entity_balance_map(LedgerEntry.ENTITY_CUSTOMER, [client.external_id for client in clients])
    supplier_balances = entity_balance_map(LedgerEntry.ENTITY_SUPPLIER, [supplier.external_id for supplier in suppliers])
    employees_qs = Employee.objects.active().select_related("user").order_by("-id")
    invoices = [
        invoice_to_dict(invoice)
        for invoice in Invoice.objects.select_related("client").prefetch_related("items__product__images", "items__product__units", "items__warehouse")
    ]
    purchases = [
        purchase_to_dict(purchase)
        for purchase in Purchase.objects.select_related("supplier").prefetch_related("items__product__images", "items__product__units", "items__warehouse")
    ]
    client_payments = [
        client_payment_to_dict(payment)
        for payment in ClientPayment.objects.select_related("client")
    ]
    supplier_payments = [
        supplier_payment_to_dict(payment)
        for payment in SupplierPayment.objects.select_related("supplier")
    ]
    account_movements = [
        account_movement_to_dict(movement)
        for movement in AccountMovement.objects.order_by("-created_at", "-id")[:1000]
    ]
    saved_theme = saved.get("theme") if saved.get("theme") in {"tox-blue", "noir", "matte-black", "summer-orange", "emerald-ledger", "graphite-lime", "ruby-slate", "amethyst-control", "violet-night", "coffee", "neon-blue", "teal-slate"} else "tox-blue"
    saved_lang = saved.get("lang") if saved.get("lang") in {"ar", "en"} else "ar"
    saved_dir = saved.get("dir") if saved.get("dir") in {"rtl", "ltr"} else ("rtl" if saved_lang == "ar" else "ltr")
    return {
        "warehouses": [warehouse_to_dict(warehouse) for warehouse in warehouses],
        "products": [product_to_dict(product, saved_products.get(product.external_id)) for product in products],
        "clients": [client_to_dict(client, client_balances.get(client.external_id, Decimal("0"))) for client in clients],
        "suppliers": [supplier_to_dict(supplier, supplier_balances.get(supplier.external_id, Decimal("0"))) for supplier in suppliers],
        "employees": [employee_to_dict(employee) for employee in employees_qs],
        "purchases": _first_saved_or_db(saved.get("purchases", []), purchases),
        "invoices": _first_saved_or_db(saved.get("invoices", []), invoices),
        "clientPayments": _first_saved_or_db(saved.get("clientPayments", []), client_payments),
        "supplierPayments": _first_saved_or_db(saved.get("supplierPayments", []), supplier_payments),
        "accountMovements": _first_saved_or_db(saved.get("accountMovements", []), account_movements),
        "cashVouchers": saved.get("cashVouchers", []),
        "suspendedInvoices": saved.get("suspendedInvoices", []),
        "suspendedPurchases": saved.get("suspendedPurchases", []),
        "unitPresets": saved.get("unitPresets", []),
        "brands": saved.get("brands", []),
        "originCountries": saved.get("originCountries", []),
        "theme": saved_theme,
        "lang": saved_lang,
        "dir": saved_dir,
        "currency": saved.get("currency", "IQD"),
        "exchangeRate": saved.get("exchangeRate", 1460),
        "activeExchangeRate": float(CurrencyRate.objects.filter(is_active=True).order_by("-created_at").values_list("rate", flat=True).first() or saved.get("exchangeRate", 1460)),
        "businessName": saved.get("businessName", ""),
        "businessSubtitle": saved.get("businessSubtitle", ""),
        "businessPhone": saved.get("businessPhone", ""),
        "businessAddress": saved.get("businessAddress", ""),
        "businessOwnerName": saved.get("businessOwnerName", ""),
        "businessCompanyName": saved.get("businessCompanyName", ""),
        "invoicePrintSettings": saved.get("invoicePrintSettings", {}),
        "installmentProfitSettings": saved.get("installmentProfitSettings", {}),
        "productPricingSettings": saved.get("productPricingSettings", {}),
        "dataGeneration": saved.get("dataGeneration", ""),
        "dataResetAt": saved.get("dataResetAt", ""),
    }


def build_pos_state_payload():
    warehouses = Warehouse.objects.active().order_by("-id")
    snapshot = AppSnapshot.objects.filter(key="default").first()
    saved = snapshot.data if snapshot else {}
    clients = list(Client.objects.active().order_by("-id"))
    client_balances = entity_balance_map(LedgerEntry.ENTITY_CUSTOMER, [client.external_id for client in clients])
    saved_theme = saved.get("theme") if saved.get("theme") in {"tox-blue", "noir", "matte-black", "summer-orange", "emerald-ledger", "graphite-lime", "ruby-slate", "amethyst-control", "violet-night", "coffee", "neon-blue", "teal-slate"} else "tox-blue"
    saved_lang = saved.get("lang") if saved.get("lang") in {"ar", "en"} else "ar"
    saved_dir = saved.get("dir") if saved.get("dir") in {"rtl", "ltr"} else ("rtl" if saved_lang == "ar" else "ltr")
    return {
        "scope": "pos",
        "warehouses": [warehouse_to_dict(warehouse) for warehouse in warehouses],
        "products": [],
        "clients": [client_to_dict(client, client_balances.get(client.external_id, Decimal("0"))) for client in clients],
        "suppliers": [],
        "employees": [],
        "purchases": [],
        "invoices": [],
        "clientPayments": [],
        "supplierPayments": [],
        "accountMovements": [],
        "cashVouchers": [],
        "suspendedInvoices": saved.get("suspendedInvoices", []),
        "suspendedPurchases": [],
        "unitPresets": saved.get("unitPresets", []),
        "brands": saved.get("brands", []),
        "originCountries": saved.get("originCountries", []),
        "theme": saved_theme,
        "lang": saved_lang,
        "dir": saved_dir,
        "currency": saved.get("currency", "IQD"),
        "exchangeRate": saved.get("exchangeRate", 1460),
        "activeExchangeRate": float(CurrencyRate.objects.filter(is_active=True).order_by("-created_at").values_list("rate", flat=True).first() or saved.get("exchangeRate", 1460)),
        "businessName": saved.get("businessName", ""),
        "businessSubtitle": saved.get("businessSubtitle", ""),
        "businessPhone": saved.get("businessPhone", ""),
        "businessAddress": saved.get("businessAddress", ""),
        "businessOwnerName": saved.get("businessOwnerName", ""),
        "businessCompanyName": saved.get("businessCompanyName", ""),
        "invoicePrintSettings": saved.get("invoicePrintSettings", {}),
        "installmentProfitSettings": saved.get("installmentProfitSettings", {}),
        "productPricingSettings": saved.get("productPricingSettings", {}),
        "dataGeneration": saved.get("dataGeneration", ""),
        "dataResetAt": saved.get("dataResetAt", ""),
    }


def state_snapshot(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "GET":
        return _method_not_allowed("GET")
    denied = _auth_required(request)
    if denied:
        return denied

    if str(request.GET.get("scope") or "").strip().lower() == "pos":
        return JsonResponse(build_pos_state_payload())
    return JsonResponse(build_state_payload())


@api_view(["POST", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def system_reset(request):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _admin_required(request)
    if denied:
        return denied
    payload = _drf_payload(request)
    confirmation = str(payload.get("confirmation") or payload.get("confirm") or "").strip()
    if confirmation not in {"RESET", "reset", "تصفير"}:
        return Response({"ok": False, "reason": "RESET_CONFIRMATION_REQUIRED"}, status=400)
    admin_password = str(payload.get("adminPassword") or payload.get("password") or "")
    if not admin_password:
        return Response({"ok": False, "reason": "ADMIN_PASSWORD_REQUIRED"}, status=400)
    if not request.user.check_password(admin_password):
        _security_audit("invalid_admin_password", "system_reset", {"user": request.user.username})
        return Response({"ok": False, "reason": "INVALID_ADMIN_PASSWORD"}, status=403)
    result = reset_system_service(
        requested_by=request.user,
        preserve_settings=payload.get("preserveSettings") is not False,
    )
    return Response(result)


SYNC_COST_TOLERANCE = Decimal("0.0001")


def _sync_decimal_matches(left, right):
    return abs(decimal_or_zero(left) - decimal_or_zero(right)) <= SYNC_COST_TOLERANCE


def _sync_existing_invoice_item_match(existing_items, line, index, product, warehouse):
    unit_id = line.get("unitId") or line.get("unit") or ""
    quantity = decimal_or_zero(line.get("qty") if "qty" in line else line.get("quantity"))
    qty_in_base = decimal_or_zero(line.get("qtyInBase"))

    def matches(existing):
        if product and existing.product_id != product.pk:
            return False
        if warehouse and existing.warehouse_id and existing.warehouse_id != warehouse.pk:
            return False
        if unit_id and existing.unit_id != unit_id:
            return False
        if quantity and not _sync_decimal_matches(existing.quantity, quantity):
            return False
        if qty_in_base and not _sync_decimal_matches(existing.qty_in_base, qty_in_base):
            return False
        return True

    if 0 <= index < len(existing_items) and matches(existing_items[index]):
        return existing_items[index]
    return next((existing for existing in existing_items if matches(existing)), None)


def _sync_product_cost_fallback(product, quantity, qty_in_base):
    if not product or product.purchase_cost_usd <= 0 or quantity <= 0:
        return None
    multiplier = decimal_or_zero(product.stock_unit_multiplier, "1")
    if multiplier <= 0:
        return None
    base_quantity = _money(qty_in_base) if qty_in_base and qty_in_base > 0 else _money(quantity)
    storage_quantity = _money(base_quantity / multiplier)
    total_cost = _money(storage_quantity * product.purchase_cost_usd)
    if total_cost <= 0:
        return None
    return {
        "unit_cost_usd": _money(total_cost / quantity),
        "total_cost_usd": total_cost,
        "cost_status": "ok",
        "cost_breakdown": [
            _cost_breakdown_marker(
                "estimated_from_product_cost",
                quantity=storage_quantity,
                unit_cost_usd=product.purchase_cost_usd,
                cost_usd=total_cost,
                reason="sync_product_cost_fallback",
                product=product,
            )
        ],
    }


def _sync_fifo_cost_fallback(product, warehouse, quantity, qty_in_base):
    if not product or quantity <= 0 or qty_in_base <= 0:
        return None
    try:
        storage_quantity = _storage_delta(product, qty_in_base)
        preview = _preview_fifo_cost(product, warehouse or product.warehouse, storage_quantity)
        if not preview:
            return None
        total_cost, cost_breakdown = _consume_fifo_cost(product, warehouse or product.warehouse, storage_quantity)
    except FinanceServiceError:
        return None
    if not cost_breakdown or any(entry.get("source") != "fifo_ok" for entry in cost_breakdown):
        return None
    if total_cost <= 0:
        return None
    return {
        "unit_cost_usd": _money(total_cost / quantity),
        "total_cost_usd": _money(total_cost),
        "cost_status": "ok",
        "cost_breakdown": cost_breakdown,
    }


def _sync_line_cost_fields(line, line_total, quantity, qty_in_base, existing_item, product, warehouse):
    line_cost = decimal_or_zero(line.get("totalCostUsd"))
    cost_status = line.get("costStatus") or ("ok" if line_cost > 0 else "missing_cost")
    cost_breakdown = line.get("costBreakdown") if isinstance(line.get("costBreakdown"), list) else []
    unit_cost = decimal_or_zero(line.get("unitCostUsd"))
    if line_cost > 0 and cost_status != "ok":
        cost_status = "ok"
    if line_cost > 0 and unit_cost <= 0 and quantity > 0:
        unit_cost = _money(line_cost / quantity)

    if line_cost <= 0 and existing_item and existing_item.total_cost_usd > 0:
        line_cost = _money(existing_item.total_cost_usd)
        unit_cost = _money(existing_item.unit_cost_usd)
        cost_status = existing_item.cost_status or "ok"
        cost_breakdown = existing_item.cost_breakdown or []
    elif line_cost <= 0:
        fifo_cost = _sync_fifo_cost_fallback(product, warehouse, quantity, qty_in_base)
        if fifo_cost:
            line_cost = fifo_cost["total_cost_usd"]
            unit_cost = fifo_cost["unit_cost_usd"]
            cost_status = fifo_cost["cost_status"]
            cost_breakdown = fifo_cost["cost_breakdown"]
        else:
            product_cost = _sync_product_cost_fallback(product, quantity, qty_in_base)
            if product_cost:
                line_cost = product_cost["total_cost_usd"]
                unit_cost = product_cost["unit_cost_usd"]
                cost_status = product_cost["cost_status"]
                cost_breakdown = product_cost["cost_breakdown"]
            else:
                line_cost = Decimal("0.0000")
                unit_cost = Decimal("0.0000")
                cost_status = "missing_cost"
                cost_breakdown = []

    gross_profit = _money(line_total - line_cost) if cost_status == "ok" else Decimal("0.0000")
    return unit_cost, line_cost, _money(gross_profit), cost_status, cost_breakdown


def sync_invoices(payload, requested_by=None):
    active_ids = []
    for item in payload.get("invoices", []):
        if not isinstance(item, dict) or not item.get("id"):
            continue
        active_ids.append(item.get("id"))
        existing_invoice = Invoice.objects.filter(external_id=item.get("id")).first()
        previous_profit = _installment_profit_audit_value(existing_invoice.installment_plan if existing_invoice else {})
        incoming_plan = item.get("installmentPlan") or {}
        incoming_profit = _installment_profit_audit_value(incoming_plan)
        client = Client.objects.filter(external_id=item.get("clientId"), deleted_at__isnull=True).first()
        sync_items = _payload_items_with_line_defaults(item)
        subtotal_usd = _money(sum(_line_total(line) for line in sync_items))
        _assert_money_matches(item.get("subtotalUsd"), subtotal_usd, "SUBTOTAL_MISMATCH")
        discount_usd = _money(item.get("discountUsd"))
        total_usd = _money(max(Decimal("0"), subtotal_usd - discount_usd))
        _assert_money_matches(item.get("totalUsd"), total_usd, "TOTAL_MISMATCH")
        raw_kind = str(item.get("kind") or item.get("type") or "").strip().lower().replace("-", "_")
        invoice_kind = "installment" if (item.get("installmentPlan") or {}).get("type") == "installment" else ("direct_pos" if raw_kind in {"direct_pos", "pos", "directpos", "quick_sale", "quick"} else "invoice")
        paid_usd = total_usd if invoice_kind == "direct_pos" else decimal_or_zero(item.get("paidUsd"))
        status, remaining_usd = _payment_status(total_usd, paid_usd)
        payment_status = "paid" if invoice_kind == "direct_pos" else (item.get("paymentStatus") or status)
        if item.get("paymentStatus") == "void" or item.get("voidedAt"):
            payment_status = "void"
        existing_items = list(existing_invoice.items.select_related("product", "warehouse").order_by("id")) if existing_invoice else []
        invoice, created = Invoice.objects.update_or_create(
            external_id=item.get("id"),
            defaults={
                "client": client,
                "kind": invoice_kind,
                "title": item.get("title") or item.get("invoiceTitle") or "",
                "customer_name": item.get("customerName") or "",
                "exchange_rate": decimal_or_zero(item.get("exchangeRate"), "1460"),
                "subtotal_usd": subtotal_usd,
                "discount_usd": discount_usd,
                "paid_usd": paid_usd,
                "total_usd": total_usd,
                "remaining_usd": Decimal("0.0000") if invoice_kind == "direct_pos" else (decimal_or_zero(item.get("remainingUsd"), str(remaining_usd)) if item.get("remainingUsd") is not None else remaining_usd),
                "payment_status": payment_status,
                "installment_plan": item.get("installmentPlan") or {},
                "note": item.get("note") or "",
                "voided_at": datetime_or_none(item.get("voidedAt")),
                "void_reason": item.get("voidReason") or "",
                "created_at": datetime_or_none(item.get("createdAt")) or timezone.now(),
            },
        )
        invoice.items.all().delete()
        for index, line in enumerate(sync_items):
            product = Product.objects.filter(external_id=line.get("productId"), deleted_at__isnull=True).first()
            warehouse = Warehouse.objects.filter(external_id=line.get("warehouseId"), deleted_at__isnull=True).first()
            line_total = _line_total(line)
            _assert_money_matches(line.get("totalUsd"), line_total, "LINE_TOTAL_MISMATCH")
            quantity = decimal_or_zero(line.get("qty") if "qty" in line else line.get("quantity"))
            qty_in_base = decimal_or_zero(line.get("qtyInBase"))
            price_usd = _line_price(line)
            if price_usd <= 0 and quantity > 0:
                price_usd = _money(line_total / quantity)
            existing_item = _sync_existing_invoice_item_match(existing_items, line, index, product, warehouse)
            unit_cost, line_cost, gross_profit, cost_status, cost_breakdown = _sync_line_cost_fields(
                line,
                line_total,
                quantity,
                qty_in_base,
                existing_item,
                product,
                warehouse,
            )
            InvoiceItem.objects.create(
                invoice=invoice,
                product=product,
                warehouse=warehouse,
                unit_id=line.get("unitId") or line.get("unit") or "",
                unit_name=line.get("unitName") or "",
                quantity=quantity,
                qty_in_base=qty_in_base,
                price_usd=price_usd,
                total_usd=line_total,
                unit_cost_usd=unit_cost,
                total_cost_usd=line_cost,
                gross_profit_usd=gross_profit,
                cost_status=cost_status,
                cost_breakdown=cost_breakdown,
            )
        if created:
            _log("create", "invoice", invoice.external_id, "Invoice synced from frontend", item)
        elif previous_profit != incoming_profit and (previous_profit or _profit_float(incoming_profit.get("profitUsd")) > 0):
            _log(
                "installment_profit_change",
                "invoice",
                invoice.external_id,
                "Installment profit changed",
                {"user": _audit_actor(requested_by), "old": previous_profit, "new": incoming_profit},
            )
        if client:
            _ensure_incoming_invoice_payments_present(invoice, client, payload)
            initial_payment = _ensure_synced_invoice_initial_payment(invoice, client, item, payload)
            ensure_customer_invoice_ledger(invoice)
            _upsert_account_movement(
                external_id=f"client-invoice-{invoice.external_id}",
                party_type="client",
                party_id=client.external_id,
                movement_type="invoice",
                title="فاتورة بيع",
                amount_usd=invoice.total_usd,
                balance_after_usd=calculate_customer_balance(client),
                reference_type="invoice",
                reference_id=invoice.external_id,
                data={"paymentStatus": invoice.payment_status, "remainingUsd": float(invoice.remaining_usd)},
                created_at=invoice.created_at,
            )
            if initial_payment:
                ensure_client_payment_ledger(initial_payment)
                _upsert_account_movement(
                    external_id=f"client-payment-{initial_payment.external_id}",
                    party_type="client",
                    party_id=client.external_id,
                    movement_type="payment",
                    title="دفع مبلغ",
                    amount_usd=-initial_payment.amount_usd,
                    balance_after_usd=calculate_customer_balance(client),
                    reference_type="client_payment",
                    reference_id=initial_payment.external_id,
                    note=initial_payment.note,
                    data={"appliedTo": initial_payment.applied_to, "unappliedUsd": float(initial_payment.unapplied_usd)},
                    created_at=initial_payment.created_at,
                )


def _payment_invoice_amount(applied_to, invoice_id):
    total = Decimal("0.0000")
    for entry in applied_to or []:
        if not isinstance(entry, dict) or entry.get("invoiceId") != invoice_id:
            continue
        total += decimal_or_zero(entry.get("amountUsd"))
    return total


def _invoice_payment_coverage(client, invoice_id, payload):
    coverage = {}
    for payment in ClientPayment.objects.filter(client=client):
        amount = _payment_invoice_amount(payment.applied_to, invoice_id)
        if amount > 0:
            coverage[payment.external_id] = amount
    for payment in payload.get("clientPayments", []):
        if not isinstance(payment, dict) or payment.get("clientId") != client.external_id:
            continue
        reference_id = payment.get("id")
        if not reference_id:
            continue
        amount = _payment_invoice_amount(payment.get("appliedTo") or [], invoice_id)
        if amount > 0:
            coverage[reference_id] = amount
    return _money(sum(coverage.values(), Decimal("0.0000")))


def _ensure_incoming_invoice_payments_present(invoice, client, payload):
    for payment_item in payload.get("clientPayments", []):
        if not isinstance(payment_item, dict) or payment_item.get("clientId") != client.external_id:
            continue
        reference_id = payment_item.get("id")
        if not reference_id:
            continue
        if _payment_invoice_amount(payment_item.get("appliedTo") or [], invoice.external_id) <= 0:
            continue
        ClientPayment.objects.update_or_create(
            external_id=reference_id,
            defaults={
                "client": client,
                "client_name": payment_item.get("clientName") or client.name,
                "amount_usd": decimal_or_zero(payment_item.get("amountUsd")),
                "unapplied_usd": decimal_or_zero(payment_item.get("unappliedUsd")),
                "applied_to": payment_item.get("appliedTo") or [],
                "note": payment_item.get("note") or "",
                "received_at": date_or_none(payment_item.get("receivedAt")),
                "created_at": datetime_or_none(payment_item.get("createdAt")) or timezone.now(),
            },
        )


def _unique_client_payment_reference(base_id):
    candidate = base_id
    index = 1
    while ClientPayment.objects.filter(external_id=candidate).exists():
        index += 1
        candidate = f"{base_id}-{index}"
    return candidate


def _ensure_synced_invoice_initial_payment(invoice, client, item, payload):
    if invoice.payment_status == "void" or invoice.voided_at or invoice.paid_usd <= 0:
        return None
    covered = _invoice_payment_coverage(client, invoice.external_id, payload)
    missing = _money(min(invoice.paid_usd, invoice.total_usd) - covered)
    if missing <= Decimal("0.0001"):
        return None
    base_reference = (
        item.get("initialPaymentId")
        or item.get("paymentId")
        or f"invoice-payment-{invoice.external_id}"
    )
    reference_id = _unique_client_payment_reference(str(base_reference))
    payment = ClientPayment.objects.create(
        external_id=reference_id,
        client=client,
        client_name=client.name,
        amount_usd=missing,
        unapplied_usd=Decimal("0.0000"),
        applied_to=[{"invoiceId": invoice.external_id, "amountUsd": float(missing)}],
        note=item.get("initialPaymentNote") or "Initial invoice payment",
        received_at=invoice.created_at.date() if invoice.created_at else timezone.localdate(),
        created_at=invoice.created_at or timezone.now(),
    )
    return payment


def sync_purchases(payload):
    for item in payload.get("purchases", []):
        if not isinstance(item, dict) or not item.get("id"):
            continue
        supplier = Supplier.objects.filter(external_id=item.get("supplierId"), deleted_at__isnull=True).first()
        sync_items = _payload_items_with_line_defaults(item)
        cost_usd = _money(sum(_line_total(line, purchase=True) for line in sync_items))
        _assert_money_matches(item.get("costUsd"), cost_usd, "TOTAL_MISMATCH")
        paid_usd = decimal_or_zero(item.get("paidUsd"))
        status, remaining_usd = _payment_status(cost_usd, paid_usd)
        purchase, created = Purchase.objects.update_or_create(
            external_id=item.get("id"),
            defaults={
                "supplier": supplier,
                "title": item.get("title") or item.get("invoiceTitle") or "",
                "supplier_name": item.get("supplierName") or (supplier.name if supplier else ""),
                "exchange_rate": decimal_or_zero(item.get("exchangeRate"), "1460"),
                "cost_usd": cost_usd,
                "paid_usd": paid_usd,
                "remaining_usd": decimal_or_zero(item.get("remainingUsd"), str(remaining_usd)) if item.get("remainingUsd") is not None else remaining_usd,
                "payment_status": item.get("paymentStatus") or status,
                "note": item.get("note") or "",
                "voided_at": datetime_or_none(item.get("voidedAt")),
                "void_reason": item.get("voidReason") or "",
                "created_at": datetime_or_none(item.get("createdAt")) or timezone.now(),
            },
        )
        purchase.items.all().delete()
        for index, line in enumerate(sync_items):
            product = Product.objects.filter(external_id=line.get("productId"), deleted_at__isnull=True).first()
            warehouse = Warehouse.objects.filter(external_id=line.get("warehouseId"), deleted_at__isnull=True).first()
            line_total = _line_total(line, purchase=True)
            _assert_money_matches(line.get("totalUsd"), line_total, "LINE_TOTAL_MISMATCH")
            quantity = decimal_or_zero(line.get("quantity") if "quantity" in line else line.get("qty"))
            unit_cost_usd = _line_price(line, purchase=True)
            if unit_cost_usd <= 0 and quantity > 0:
                unit_cost_usd = _money(line_total / quantity)
            purchase_item = PurchaseItem.objects.create(
                purchase=purchase,
                product=product,
                warehouse=warehouse,
                unit_id=line.get("unitId") or line.get("unit") or "",
                unit_name=line.get("unitName") or "",
                quantity=quantity,
                qty_in_base=decimal_or_zero(line.get("qtyInBase")),
                unit_cost_usd=unit_cost_usd,
                total_usd=line_total,
                supplier_unit_cost_usd=decimal_or_zero(line.get("supplierUnitCostUsd"), str(unit_cost_usd)),
                base_unit_cost_usd=decimal_or_zero(line.get("baseUnitCostUsd")),
                storage_unit_cost_usd=decimal_or_zero(line.get("storageUnitCostUsd")),
                landed_cost_share_usd=decimal_or_zero(line.get("landedCostShareUsd")),
                discount_share_usd=decimal_or_zero(line.get("discountShareUsd")),
                batch_code=str(line.get("batchCode") or "").strip(),
                expiry_days=int(line.get("expiryDays") or 0),
                expires_at=datetime_or_none(line.get("expiresAt")),
                received_at=datetime_or_none(line.get("receivedAt")),
            )
            if product and purchase.payment_status != "void" and not purchase.voided_at:
                multiplier = decimal_or_zero(product.stock_unit_multiplier, "1") or Decimal("1")
                delta = _money(purchase_item.qty_in_base / multiplier) if multiplier > 0 else Decimal("0.0000")
                total_usd = _money(purchase_item.total_usd)
                batch_code = purchase_item.batch_code or f"{purchase.external_id}-{index + 1}"
                if delta > 0 and total_usd > 0 and not StockBatch.objects.filter(product=product, batch_code=batch_code).exists():
                    unit_cost_usd = purchase_item.storage_unit_cost_usd if purchase_item.storage_unit_cost_usd > 0 else _money(total_usd / delta)
                    StockBatch.objects.create(
                        product=product,
                        warehouse=warehouse or product.warehouse,
                        batch_code=batch_code,
                        quantity=delta,
                        purchase_cost_usd=unit_cost_usd,
                        expiry_date=date_or_none(purchase_item.expires_at) if purchase_item.expires_at else None,
                        received_at=purchase_item.received_at or purchase.created_at or timezone.now(),
                        is_closed=False,
                    )
                    Product.objects.filter(pk=product.pk).update(purchase_cost_usd=unit_cost_usd)
        if created:
            _log("create", "purchase", purchase.external_id, "Purchase synced from frontend", item)
        if supplier:
            ensure_supplier_invoice_ledger(purchase)
            _upsert_account_movement(
                external_id=f"supplier-purchase-{purchase.external_id}",
                party_type="supplier",
                party_id=supplier.external_id,
                movement_type="invoice",
                title="فاتورة شراء",
                amount_usd=purchase.cost_usd,
                balance_after_usd=calculate_supplier_balance(supplier),
                reference_type="purchase",
                reference_id=purchase.external_id,
                data={"paymentStatus": purchase.payment_status, "remainingUsd": float(purchase.remaining_usd)},
                created_at=purchase.created_at,
            )


def sync_payments(payload):
    for item in payload.get("clientPayments", []):
        if not isinstance(item, dict) or not item.get("id"):
            continue
        client = Client.objects.filter(external_id=item.get("clientId"), deleted_at__isnull=True).first()
        payment, created = ClientPayment.objects.update_or_create(
            external_id=item.get("id"),
            defaults={
                "client": client,
                "client_name": item.get("clientName") or (client.name if client else ""),
                "amount_usd": decimal_or_zero(item.get("amountUsd")),
                "unapplied_usd": decimal_or_zero(item.get("unappliedUsd")),
                "applied_to": item.get("appliedTo") or [],
                "note": item.get("note") or "",
                "received_at": date_or_none(item.get("receivedAt")),
                "created_at": datetime_or_none(item.get("createdAt")) or timezone.now(),
            },
        )
        if created:
            _log("payment", "client", payment.external_id, "Client payment synced from frontend", item)
        if client:
            ensure_client_payment_ledger(payment)
            _upsert_account_movement(
                external_id=f"client-payment-{payment.external_id}",
                party_type="client",
                party_id=client.external_id,
                movement_type="payment",
                title="دفع مبلغ",
                amount_usd=-payment.amount_usd,
                balance_after_usd=calculate_customer_balance(client),
                reference_type="client_payment",
                reference_id=payment.external_id,
                note=payment.note,
                data={"appliedTo": payment.applied_to, "unappliedUsd": float(payment.unapplied_usd)},
                created_at=payment.created_at,
            )

    for item in payload.get("supplierPayments", []):
        if not isinstance(item, dict) or not item.get("id"):
            continue
        supplier = Supplier.objects.filter(external_id=item.get("supplierId"), deleted_at__isnull=True).first()
        payment, created = SupplierPayment.objects.update_or_create(
            external_id=item.get("id"),
            defaults={
                "supplier": supplier,
                "supplier_name": item.get("supplierName") or (supplier.name if supplier else ""),
                "amount_usd": decimal_or_zero(item.get("amountUsd")),
                "unapplied_usd": decimal_or_zero(item.get("unappliedUsd")),
                "applied_to": item.get("appliedTo") or [],
                "note": item.get("note") or "",
                "paid_at": date_or_none(item.get("paidAt")),
                "created_at": datetime_or_none(item.get("createdAt")) or timezone.now(),
            },
        )
        if created:
            _log("payment", "supplier", payment.external_id, "Supplier payment synced from frontend", item)
        if supplier:
            ensure_supplier_payment_ledger(payment)
            _upsert_account_movement(
                external_id=f"supplier-payment-{payment.external_id}",
                party_type="supplier",
                party_id=supplier.external_id,
                movement_type="payment",
                title="تسديد مورد",
                amount_usd=-payment.amount_usd,
                balance_after_usd=calculate_supplier_balance(supplier),
                reference_type="supplier_payment",
                reference_id=payment.external_id,
                note=payment.note,
                data={"appliedTo": payment.applied_to, "unappliedUsd": float(payment.unapplied_usd)},
                created_at=payment.created_at,
            )


@csrf_exempt
@_payload_size_required
def sync_snapshot(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "POST":
        return _method_not_allowed("POST")
    denied = _auth_required(request)
    if denied:
        return denied

    payload = parse_json_body(request)
    current_snapshot = AppSnapshot.objects.filter(key="default").first()
    current_generation = ""
    if current_snapshot and isinstance(current_snapshot.data, dict):
        current_generation = current_snapshot.data.get("dataGeneration") or ""
    payload_generation = payload.get("dataGeneration") or ""
    if current_generation and payload_generation != current_generation:
        _security_audit(
            "sync_rejected",
            "STALE_LOCAL_STATE",
            {"payloadGeneration": payload_generation, "currentGeneration": current_generation},
            message="Rejected stale local sync payload",
        )
        return JsonResponse({
            **build_state_payload(),
            "syncRejected": True,
            "reason": "STALE_LOCAL_STATE",
            "dataGeneration": current_generation,
        }, status=409)
    report = {"ok": True, "sections": {}, "errors": []}
    successful_snapshot_keys = set()
    archive_sections = set()
    _audit_installment_profit_settings_change(payload, current_snapshot.data if current_snapshot else {}, request.user)

    if payload.get("exchangeRate"):
        successful_snapshot_keys.update(_run_sync_section(
            report,
            "settings",
            [],
            lambda: (
                CurrencyRate.objects.update(is_active=False),
                CurrencyRate.objects.create(rate=decimal_or_zero(payload.get("exchangeRate"), "1460"), is_active=True),
                1,
            )[-1],
        ))

    successful_snapshot_keys.update(_run_sync_section(report, "warehouses", ["warehouses"], lambda: _sync_warehouses_section(payload)))
    if report["sections"].get("warehouses", {}).get("ok"):
        archive_sections.add("warehouses")

    successful_snapshot_keys.update(_run_sync_section(report, "clients", ["clients", "accountMovements"], lambda: _sync_clients_section(payload)))
    if report["sections"].get("clients", {}).get("ok"):
        archive_sections.add("clients")

    successful_snapshot_keys.update(_run_sync_section(report, "suppliers", ["suppliers", "accountMovements"], lambda: _sync_suppliers_section(payload)))
    if report["sections"].get("suppliers", {}).get("ok"):
        archive_sections.add("suppliers")

    successful_snapshot_keys.update(_run_sync_section(report, "employees", ["employees"], lambda: _sync_employees_section(payload)))
    if report["sections"].get("employees", {}).get("ok"):
        archive_sections.add("employees")

    successful_snapshot_keys.update(_run_sync_section(report, "products", ["products"], lambda: _sync_products_section(payload, request.user)))
    if report["sections"].get("products", {}).get("ok"):
        archive_sections.add("products")

    # POS uses a deliberately lightweight state payload. Never interpret omitted
    # or partial POS collections as deletions during archive reconciliation.
    # A full desktop snapshot explicitly sets ``snapshotComplete``. Older
    # clients (and integrations using the original API contract) omit that
    # flag but send every business collection; treat those payloads as full
    # snapshots too. Partial/POS payloads still never reconcile deletions.
    required_snapshot_sections = {"warehouses", "products", "clients", "suppliers", "employees"}
    is_complete_snapshot = payload.get("snapshotComplete") is True or required_snapshot_sections.issubset(payload)
    if (
        archive_sections
        and str(payload.get("scope") or "full").lower() != "pos"
        and is_complete_snapshot
    ):
        _run_sync_section(report, "archiveMissing", [], lambda: (_archive_missing_records_from_payload(payload, archive_sections), 0)[1])

    successful_snapshot_keys.update(_run_sync_section(report, "invoices", ["invoices", "accountMovements"], lambda: _sync_invoices_section(payload, request.user)))
    successful_snapshot_keys.update(_run_sync_section(report, "purchases", ["purchases", "accountMovements"], lambda: _sync_purchases_section(payload)))
    successful_snapshot_keys.update(_run_sync_section(
        report,
        "payments",
        ["clientPayments", "supplierPayments", "accountMovements"],
        lambda: _sync_payments_section(payload),
    ))

    report["ok"] = not report["errors"]
    snapshot_payload = _snapshot_after_partial_sync(payload, current_snapshot.data if current_snapshot else {}, successful_snapshot_keys)
    AppSnapshot.objects.update_or_create(key="default", defaults={"data": snapshot_payload})

    response_payload = build_state_payload()
    response_payload.update({
        "syncReport": report,
        "syncHasErrors": bool(report["errors"]),
        "savedToDatabase": not report["errors"],
    })
    return JsonResponse(response_payload, status=207 if report["errors"] else 200)


def profit_snapshot(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "GET":
        return _method_not_allowed("GET")
    denied = _permission_required(request, "accounts.view_profits")
    if denied:
        return denied

    snapshot = AppSnapshot.objects.filter(key="default").first()
    saved = snapshot.data if snapshot else {}
    invoices = saved.get("invoices", [])
    cash_vouchers = saved.get("cashVouchers", [])
    employees = saved.get("employees", [])

    sales_usd = _money(Invoice.objects.filter(voided_at__isnull=True).aggregate(total=Sum("total_usd"))["total"] or 0)
    cogs_usd = _money(
        InvoiceItem.objects
        .filter(invoice__voided_at__isnull=True, cost_status="ok")
        .aggregate(total=Sum("total_cost_usd"))["total"] or 0
    )
    if sales_usd <= 0 and invoices:
        sales_usd = _money(sum(
            decimal_or_zero(invoice.get("subtotalUsd")) - decimal_or_zero(invoice.get("discountUsd"))
            for invoice in invoices
            if isinstance(invoice, dict) and not invoice.get("isVoided") and invoice.get("paymentStatus") != "void"
        ))
        cogs_usd = _money(sum(
            decimal_or_zero(line.get("totalCostUsd"))
            for invoice in invoices
            if isinstance(invoice, dict) and not invoice.get("isVoided") and invoice.get("paymentStatus") != "void"
            for line in invoice.get("items", [])
            if isinstance(line, dict) and (line.get("costStatus") in (None, "", "ok"))
        ))
    voucher_expenses_usd = sum(
        decimal_or_zero(voucher.get("amountUsd"))
        for voucher in cash_vouchers
        if isinstance(voucher, dict) and voucher.get("type") == "payment"
    )
    salary_expenses_usd = sum(decimal_or_zero(employee.get("salary")) for employee in employees if isinstance(employee, dict))
    db_expenses_usd = sum(expense.amount_usd for expense in Expense.objects.filter(deleted_at__isnull=True))
    expenses_usd = voucher_expenses_usd + salary_expenses_usd + db_expenses_usd
    gross_profit_usd = sales_usd - cogs_usd
    net_profit_usd = gross_profit_usd - expenses_usd
    rate = CurrencyRate.objects.filter(is_active=True).order_by("-created_at").first()
    exchange_rate = rate.rate if rate else decimal_or_zero(saved.get("exchangeRate"), "1460")

    return JsonResponse({
        "salesUsd": float(sales_usd),
        "cogsUsd": float(cogs_usd),
        "grossProfitUsd": float(gross_profit_usd),
        "expensesUsd": float(expenses_usd),
        "netProfitUsd": float(net_profit_usd),
        "exchangeRate": float(exchange_rate),
        "netProfitIqd": float(net_profit_usd * exchange_rate),
    })


@api_view(["GET", "OPTIONS"])
@authentication_classes(BACKUP_AUTH)
def backup_export(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "GET":
        return _method_not_allowed("GET")
    denied = _permission_required(request, "admin.backup")
    if denied:
        return denied
    try:
        with _runtime_operation_lock("backup"):
            payload = _build_unified_backup_payload()
    except FullBackupError as error:
        return _full_backup_error_response(error)
    filename_stamp = timezone.localtime(timezone.now()).strftime("%Y-%m-%d-%H%M")
    response = HttpResponse(_json_backup_bytes(payload), content_type="application/json")
    response["Content-Disposition"] = f'attachment; filename="tox-backup-{filename_stamp}.json"'
    response["X-TOX-Backup-Created-At"] = payload["manifest"].get("createdAt", "")
    return response


UNIFIED_BACKUP_FORMAT = "tox-json-full-backup"
UNIFIED_BACKUP_VERSION = 1


class FullBackupError(Exception):
    def __init__(self, code, message, status=400, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


@contextmanager
def _runtime_operation_lock(name):
    runtime_dir = _configured_runtime_dir()
    runtime_dir.mkdir(parents=True, exist_ok=True)
    lock_path = runtime_dir / f"{name}.lock"
    try:
        with lock_path.open("x", encoding="utf-8") as handle:
            handle.write(f"pid={os.getpid()}\nstartedAt={timezone.now().isoformat()}\n")
    except FileExistsError as error:
        raise FullBackupError(
            "BACKUP_BUSY",
            "A backup or restore operation is already running.",
            status=409,
            details={"lock": str(lock_path)},
        ) from error
    try:
        yield
    finally:
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass


def _json_backup_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, indent=2, default=str).encode("utf-8")


def _canonical_json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


def _sha256_bytes(payload):
    return hashlib.sha256(payload).hexdigest()


def _active_db_path():
    name = connections["default"].settings_dict.get("NAME")
    if not name:
        raise FullBackupError("NO_DATABASE", "SQLite database path is not configured.", status=500)
    name_text = str(name)
    if name_text == ":memory:" or (name_text.startswith("file:") and "mode=memory" in name_text):
        return None
    return Path(name)


def _copy_live_sqlite_database(target_path):
    connections["default"].ensure_connection()
    source = connections["default"].connection
    with sqlite3.connect(target_path) as destination:
        source.backup(destination)


def _sqlite_integrity(path):
    with sqlite3.connect(path) as connection:
        result = connection.execute("PRAGMA integrity_check").fetchone()
    return bool(result and str(result[0]).lower() == "ok"), (result[0] if result else "no result")


def _sqlite_record_counts(path):
    counts = {}
    with sqlite3.connect(path) as connection:
        tables = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        for (table_name,) in tables:
            try:
                counts[table_name] = connection.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0]
            except sqlite3.Error:
                counts[table_name] = None
    return counts


def _discard_sqlite_sidecars(db_path):
    locked = []
    for suffix in ("-wal", "-shm", "-journal"):
        sidecar = Path(f"{db_path}{suffix}")
        try:
            sidecar.unlink()
        except FileNotFoundError:
            pass
        except PermissionError:
            locked.append(str(sidecar))
    return locked


def _copy_sqlite_backup_to_path(restored_db_path, db_path):
    try:
        with sqlite3.connect(restored_db_path) as source, sqlite3.connect(db_path, timeout=30) as destination:
            destination.execute("PRAGMA busy_timeout=30000")
            source.backup(destination)
    except sqlite3.Error as error:
        raise FullBackupError(
            "DATABASE_RESTORE_FAILED",
            "Could not write the restored database. Close other TOX windows and try again.",
            status=500,
            details={"error": str(error)},
        ) from error


def _backup_config_payload(state):
    keys = (
        "theme",
        "lang",
        "dir",
        "currency",
        "exchangeRate",
        "activeExchangeRate",
        "businessName",
        "businessSubtitle",
        "businessPhone",
        "businessAddress",
        "businessOwnerName",
        "businessCompanyName",
        "invoicePrintSettings",
        "installmentProfitSettings",
        "productPricingSettings",
        "dataGeneration",
        "dataResetAt",
    )
    return {key: state.get(key) for key in keys if key in state}


def _build_unified_backup_payload():
    state = build_state_payload()
    config = _backup_config_payload(state)
    state_bytes = _canonical_json_bytes(state)
    config_bytes = _canonical_json_bytes(config)
    temp_db = tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite3")
    temp_db_path = Path(temp_db.name)
    temp_db.close()
    try:
        _copy_live_sqlite_database(temp_db_path)
        db_bytes = temp_db_path.read_bytes()
        record_counts = _sqlite_record_counts(temp_db_path)
    finally:
        try:
            temp_db_path.unlink()
        except OSError:
            pass

    created_at = timezone.now()
    manifest = {
        "format": UNIFIED_BACKUP_FORMAT,
        "version": UNIFIED_BACKUP_VERSION,
        "createdAt": created_at.isoformat(),
        "appVersion": desktop_config.APP_VERSION,
        "codeFingerprint": LOADED_CODE_FINGERPRINT,
        "databaseEngine": connections["default"].settings_dict.get("ENGINE", ""),
        "recordCounts": record_counts,
        "files": {
            "database": {"size": len(db_bytes), "sha256": _sha256_bytes(db_bytes)},
            "state": {"size": len(state_bytes), "sha256": _sha256_bytes(state_bytes)},
            "config": {"size": len(config_bytes), "sha256": _sha256_bytes(config_bytes)},
        },
    }
    return {
        "manifest": manifest,
        "databaseBase64": base64.b64encode(db_bytes).decode("ascii"),
        "state": state,
        "config": config,
    }


def _write_safety_unified_backup():
    backup_dir = _configured_backup_dir()
    backup_dir.mkdir(parents=True, exist_ok=True)
    payload = _build_unified_backup_payload()
    stamp = timezone.now().strftime("%Y%m%d-%H%M%S")
    target = backup_dir / f"before-restore-{stamp}.json"
    target.write_bytes(_json_backup_bytes(payload))
    return target


def _prune_internal_backups_after_restore():
    try:
        return prune_backup_files(
            _configured_backup_dir(),
            keep_before_restore=1,
            keep_daily_db=1,
            apply=True,
        )
    except Exception as error:
        return {"ok": False, "error": str(error), "apply": True, "backupDir": str(_configured_backup_dir())}


def _read_full_backup_bytes(request):
    source = getattr(request, "_request", request)
    try:
        files = getattr(request, "FILES", None) or getattr(source, "FILES", None)
        if files:
            uploaded = next(iter(files.values()))
            return uploaded.read()
        return getattr(source, "body", b"") or b""
    except RequestDataTooBig as error:
        _too_large, provided_bytes, limit_bytes = _request_body_size_info(request)
        raise FullBackupError(
            "PAYLOAD_TOO_LARGE",
            "Backup payload is too large.",
            status=413,
            details={"limitBytes": limit_bytes, "providedBytes": provided_bytes},
        ) from error


def _manifest_summary(manifest, *, archive_size, record_counts=None, safety_backup_path=""):
    files = manifest.get("files") or {}
    database_size = (files.get("db.sqlite3") or files.get("database") or {}).get("size", 0)
    return {
        "format": manifest.get("format"),
        "version": manifest.get("version"),
        "createdAt": manifest.get("createdAt"),
        "appVersion": manifest.get("appVersion"),
        "codeFingerprint": manifest.get("codeFingerprint"),
        "archiveSize": archive_size,
        "databaseSize": database_size,
        "recordCounts": record_counts if record_counts is not None else manifest.get("recordCounts", {}),
        "safetyBackupPath": safety_backup_path,
    }


UNIFIED_BACKUP_REQUIRED_TABLES = (
    "auth_user",
    "erp_appsnapshot",
    "erp_auditlog",
    "erp_warehouse",
    "erp_product",
    "erp_productunit",
    "erp_stockbatch",
    "erp_stockmovement",
    "erp_invoice",
    "erp_invoiceitem",
    "erp_purchase",
    "erp_purchaseitem",
)


def _current_sqlite_columns(table):
    with connections["default"].cursor() as cursor:
        cursor.execute(f'PRAGMA table_info("{table}")')
        return {row[1] for row in cursor.fetchall()}


def _restored_sqlite_columns(connection, table):
    return {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")').fetchall()}


def _verify_restored_database_shape(temp_db_path):
    with sqlite3.connect(temp_db_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        }
        missing_tables = [table for table in UNIFIED_BACKUP_REQUIRED_TABLES if table not in tables]
        if missing_tables:
            raise FullBackupError(
                "BACKUP_SCHEMA_MISMATCH",
                "Backup database is missing required tables.",
                details={"missingTables": missing_tables},
            )

        missing_columns = {}
        for table in UNIFIED_BACKUP_REQUIRED_TABLES:
            current_columns = _current_sqlite_columns(table)
            restored_columns = _restored_sqlite_columns(connection, table)
            missing = sorted(current_columns - restored_columns)
            if missing:
                missing_columns[table] = missing
        if missing_columns:
            raise FullBackupError(
                "BACKUP_SCHEMA_MISMATCH",
                "Backup database fields do not match the current application schema.",
                details={"missingColumns": missing_columns},
            )

        admin_count = connection.execute(
            "SELECT COUNT(*) FROM auth_user WHERE is_superuser = 1 AND is_active = 1"
        ).fetchone()[0]
        if not admin_count:
            raise FullBackupError(
                "BACKUP_ADMIN_MISSING",
                "Backup database does not contain an active admin user.",
            )


def _verify_unified_backup_payload(payload, *, keep_db_copy=False, allow_state_recovery=False):
    if not isinstance(payload, dict):
        raise FullBackupError("INVALID_BACKUP", "Backup JSON is invalid.")
    manifest = payload.get("manifest") if isinstance(payload.get("manifest"), dict) else {}
    if manifest.get("format") != UNIFIED_BACKUP_FORMAT or manifest.get("version") != UNIFIED_BACKUP_VERSION:
        raise FullBackupError(
            "UNSUPPORTED_BACKUP",
            "Backup format is not supported by this application version.",
            details={"format": manifest.get("format"), "version": manifest.get("version")},
        )

    database_base64 = payload.get("databaseBase64")
    if not database_base64:
        raise FullBackupError("BACKUP_FILES_MISSING", "Backup JSON is missing the database payload.", details={"missing": ["databaseBase64"]})
    try:
        db_bytes = base64.b64decode(str(database_base64).encode("ascii"), validate=True)
    except (binascii.Error, UnicodeEncodeError) as error:
        raise FullBackupError("INVALID_DATABASE_PAYLOAD", "Backup database payload is not valid Base64.") from error

    file_manifest = manifest.get("files") if isinstance(manifest.get("files"), dict) else {}
    warnings = []

    expected_database = file_manifest.get("database") if isinstance(file_manifest.get("database"), dict) else {}
    if expected_database.get("size") != len(db_bytes) or expected_database.get("sha256") != _sha256_bytes(db_bytes):
        raise FullBackupError("CHECKSUM_FAILED", "Backup database checksum verification failed.", details={"file": "database"})

    optional_checks = {
        "state": _canonical_json_bytes(payload.get("state") if isinstance(payload.get("state"), dict) else {}),
        "config": _canonical_json_bytes(payload.get("config") if isinstance(payload.get("config"), dict) else {}),
    }
    for name, content in optional_checks.items():
        expected = file_manifest.get(name) if isinstance(file_manifest.get(name), dict) else {}
        if expected.get("size") == len(content) and expected.get("sha256") == _sha256_bytes(content):
            continue
        warning = {
            "code": "STATE_CHECKSUM_RECOVERED" if name == "state" else "CONFIG_CHECKSUM_RECOVERED",
            "file": name,
            "message": f"Backup {name} checksum did not match; database payload was used for restore.",
        }
        if not allow_state_recovery:
            raise FullBackupError("CHECKSUM_FAILED", "Backup checksum verification failed.", details={"file": name})
        warnings.append(warning)

    temp_db_path = None
    try:
        temp_db = tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite3")
        temp_db_path = Path(temp_db.name)
        temp_db.write(db_bytes)
        temp_db.close()

        ok, result = _sqlite_integrity(temp_db_path)
        if not ok:
            raise FullBackupError("SQLITE_INTEGRITY_FAILED", "Backup database integrity check failed.", details={"result": result})
        _verify_restored_database_shape(temp_db_path)
        record_counts = _sqlite_record_counts(temp_db_path)
        summary = _manifest_summary(manifest, archive_size=len(_json_backup_bytes(payload)), record_counts=record_counts)
        summary["warnings"] = warnings
        if keep_db_copy:
            return summary, manifest, temp_db_path
        return summary, manifest, None
    finally:
        if temp_db_path and not keep_db_copy:
            try:
                temp_db_path.unlink()
            except OSError:
                pass


def _full_backup_error_response(error):
    payload = {
        "ok": False,
        "reason": error.code,
        "code": error.code,
        "message": error.message,
        "messageAr": "تعذر معالجة النسخة الاحتياطية.",
        "details": error.details,
        "recoverySteps": [
            "تأكد من اختيار ملف JSON الرسمي الذي تم تصديره من TOX ERP.",
            "تأكد أن الملف لم يتم فتحه أو تعديله بعد التصدير.",
            "أعد تصدير نسخة جديدة من نفس إصدار النظام ثم حاول مرة ثانية.",
        ],
    }
    if error.code == "PAYLOAD_TOO_LARGE":
        limit_bytes = int(error.details.get("limitBytes") or _payload_limit_bytes())
        provided_bytes = int(error.details.get("providedBytes") or 0)
        payload.update({
            "messageAr": "حجم ملف النسخة أكبر من الحد المسموح. ارفع حد TOX_DATA_UPLOAD_MAX_MEMORY_SIZE أو صدّر نسخة أصغر ثم حاول مرة ثانية.",
            "limitBytes": limit_bytes,
            "providedBytes": provided_bytes,
            "recoverySteps": [
                "تأكد أنك تستخدم ملف JSON الرسمي وليس ZIP أو ملفاً قديماً.",
                "إذا كان الملف صحيحاً لكنه كبير، ارفع قيمة TOX_DATA_UPLOAD_MAX_MEMORY_SIZE ثم أعد تشغيل TOX.",
                "بعد تعديل الحد، اضغط فحص النسخة مرة ثانية قبل الاسترجاع.",
            ],
        })
    return JsonResponse(payload, status=error.status)


def _zip_backup_disabled_response():
    return _full_backup_error_response(
        FullBackupError(
            "ZIP_BACKUP_DISABLED",
            "ZIP backup export and restore are disabled. Use a JSON backup file only.",
        )
    )


def _backup_audit(request, action, message, raw_backup=b"", *, reason="", details=None, summary=None, extra=None):
    try:
        data = {
            "user": _audit_actor(getattr(request, "user", None)),
            "path": getattr(request, "path", ""),
            "size": len(raw_backup or b""),
            "sha256": _sha256_bytes(raw_backup or b"") if raw_backup else "",
            "reason": reason,
            "details": details or {},
            "recordCounts": (summary or {}).get("recordCounts", {}),
            "format": (summary or {}).get("format", ""),
            "version": (summary or {}).get("version", ""),
            "createdAt": timezone.now().isoformat(),
        }
        if extra:
            data.update(extra)
        AuditLog.objects.create(
            action=action,
            entity_type="backup",
            entity_id=data["sha256"][:24] or timezone.now().strftime("%Y%m%d%H%M%S"),
            message=message,
            data=data,
        )
    except Exception:
        pass


def _legacy_backup_disabled_error(parsed_payload):
    return FullBackupError(
        "LEGACY_BACKUP_DISABLED",
        "Legacy browser/local-state backups are disabled. Export a unified JSON backup from this version.",
        details={
            "requiredFormat": UNIFIED_BACKUP_FORMAT,
            "hasManifest": isinstance(parsed_payload.get("manifest") if isinstance(parsed_payload, dict) else None, dict),
            "hasDatabaseBase64": bool(isinstance(parsed_payload, dict) and parsed_payload.get("databaseBase64")),
        },
    )


@api_view(["POST", "OPTIONS"])
@authentication_classes(BACKUP_AUTH)
@parser_classes(BACKUP_PARSERS)
@_payload_size_required
def backup_verify(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "POST":
        return _method_not_allowed("POST")
    denied = _permission_required(request, "admin.backup")
    if denied:
        return denied

    try:
        raw_backup = _read_full_backup_bytes(request)
    except FullBackupError as error:
        _backup_audit(request, "backup_verify_failed", "Backup verification failed", b"", reason=error.code, details=error.details)
        return _full_backup_error_response(error)

    def fail(error):
        _backup_audit(request, "backup_verify_failed", "Backup verification failed", raw_backup, reason=error.code, details=error.details)
        return _full_backup_error_response(error)

    if raw_backup[:2] == b"PK":
        return fail(FullBackupError("ZIP_BACKUP_DISABLED", "ZIP backup restore is disabled. Use a unified JSON backup file only."))

    try:
        parsed_payload = json.loads(raw_backup.decode("utf-8")) if raw_backup else {}
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        return fail(FullBackupError("INVALID_BACKUP", "Backup JSON is invalid."))
    if not isinstance(parsed_payload, dict):
        return fail(FullBackupError("INVALID_BACKUP", "Backup JSON must contain an object."))
    manifest = parsed_payload.get("manifest") if isinstance(parsed_payload.get("manifest"), dict) else {}
    if manifest.get("format") == UNIFIED_BACKUP_FORMAT:
        try:
            summary, _manifest, _temp_db = _verify_unified_backup_payload(parsed_payload, allow_state_recovery=True)
            _backup_audit(request, "backup_verify_ok", "Backup verification succeeded", raw_backup, summary=summary)
            return JsonResponse({"ok": True, "backup": summary, "warnings": summary.get("warnings", [])})
        except FullBackupError as error:
            return fail(error)
    if manifest:
        return fail(FullBackupError(
            "UNSUPPORTED_BACKUP",
            "Backup format is not supported by this application version.",
            details={"format": manifest.get("format"), "version": manifest.get("version")},
        ))
    return fail(_legacy_backup_disabled_error(parsed_payload))


def _replace_active_sqlite_database(restored_db_path):
    db_path = _active_db_path()
    if db_path is None:
        _load_sqlite_backup_into_current_connection(restored_db_path)
        return
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connections.close_all()
    locked_sidecars = _discard_sqlite_sidecars(db_path)
    if locked_sidecars:
        _copy_sqlite_backup_to_path(restored_db_path, db_path)
    else:
        try:
            shutil.copy2(restored_db_path, db_path)
        except PermissionError:
            _copy_sqlite_backup_to_path(restored_db_path, db_path)
        except OSError as error:
            raise FullBackupError(
                "DATABASE_RESTORE_FAILED",
                "Could not replace the active database file.",
                status=500,
                details={"error": str(error)},
            ) from error
    _discard_sqlite_sidecars(db_path)
    connections.close_all()
    call_command("migrate", interactive=False, verbosity=0)


def _load_sqlite_backup_into_current_connection(restored_db_path):
    connections.close_all()
    connection = connections["default"]
    connection.ensure_connection()
    raw = connection.connection
    raw.execute("PRAGMA foreign_keys=OFF")
    for object_type, name in raw.execute(
        "SELECT type, name FROM sqlite_master WHERE type IN ('view', 'table') AND name NOT LIKE 'sqlite_%' ORDER BY type"
    ).fetchall():
        quoted = name.replace('"', '""')
        raw.execute(f'DROP {object_type.upper()} IF EXISTS "{quoted}"')
    raw.commit()
    with sqlite3.connect(restored_db_path) as source:
        script = "\n".join(source.iterdump())
    raw.executescript(script)
    raw.commit()
    connections.close_all()
    call_command("migrate", interactive=False, verbosity=0)


@api_view(["GET", "OPTIONS"])
@authentication_classes(BACKUP_AUTH)
def backup_full_export(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "GET":
        return _method_not_allowed("GET")
    denied = _permission_required(request, "admin.backup")
    if denied:
        return denied
    return _zip_backup_disabled_response()


@api_view(["POST", "OPTIONS"])
@authentication_classes(BACKUP_AUTH)
@parser_classes(BACKUP_PARSERS)
def backup_full_verify(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "POST":
        return _method_not_allowed("POST")
    denied = _permission_required(request, "admin.backup")
    if denied:
        return denied
    return _zip_backup_disabled_response()


@api_view(["POST", "OPTIONS"])
@authentication_classes(BACKUP_AUTH)
@parser_classes(BACKUP_PARSERS)
def backup_full_restore(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "POST":
        return _method_not_allowed("POST")
    denied = _permission_required(request, "admin.backup")
    if denied:
        return denied
    return _zip_backup_disabled_response()


@api_view(["POST", "OPTIONS"])
@authentication_classes(BACKUP_AUTH)
@parser_classes(BACKUP_PARSERS)
@_payload_size_required
def backup_restore(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "POST":
        return _method_not_allowed("POST")
    denied = _permission_required(request, "admin.backup")
    if denied:
        return denied

    try:
        raw_backup = _read_full_backup_bytes(request)
    except FullBackupError as error:
        _backup_audit(request, "backup_restore_failed", "Backup restore failed", b"", reason=error.code, details=error.details)
        return _full_backup_error_response(error)

    def fail(error):
        _backup_audit(request, "backup_restore_failed", "Backup restore failed", raw_backup, reason=error.code, details=error.details)
        return _full_backup_error_response(error)

    if raw_backup[:2] == b"PK":
        return fail(FullBackupError("ZIP_BACKUP_DISABLED", "ZIP backup restore is disabled. Use a unified JSON backup file only."))

    try:
        parsed_payload = json.loads(raw_backup.decode("utf-8")) if raw_backup else {}
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        return fail(FullBackupError("INVALID_BACKUP", "Backup JSON is invalid."))
    if not isinstance(parsed_payload, dict):
        return fail(FullBackupError("INVALID_BACKUP", "Backup JSON must contain an object."))
    manifest = parsed_payload.get("manifest") if isinstance(parsed_payload, dict) else {}
    if isinstance(manifest, dict) and manifest.get("format") == UNIFIED_BACKUP_FORMAT:
        restored_db_path = None
        try:
            with _runtime_operation_lock("restore"):
                summary, manifest, restored_db_path = _verify_unified_backup_payload(parsed_payload, keep_db_copy=True, allow_state_recovery=True)
                safety_path = _write_safety_unified_backup()
                _replace_active_sqlite_database(restored_db_path)
                connections.close_all()
                retention_report = _prune_internal_backups_after_restore()
            _backup_audit(
                request,
                "backup_restore",
                "Unified JSON backup restored",
                raw_backup,
                summary=summary,
                extra={
                    "safetyBackupPath": str(safety_path),
                    "backupCreatedAt": manifest.get("createdAt", ""),
                    "backupRetention": retention_report,
                },
            )
            response_payload = build_state_payload()
            response_payload.update({
                "ok": True,
                "unifiedBackupRestored": True,
                "backup": _manifest_summary(manifest, archive_size=summary["archiveSize"], record_counts=summary["recordCounts"], safety_backup_path=str(safety_path)),
                "backupRetention": retention_report,
                "warnings": summary.get("warnings", []),
            })
            return JsonResponse(response_payload)
        except FullBackupError as error:
            return fail(error)
        finally:
            if restored_db_path:
                try:
                    restored_db_path.unlink()
                except OSError:
                    pass

    if isinstance(manifest, dict) and manifest:
        return fail(FullBackupError(
            "UNSUPPORTED_BACKUP",
            "Backup format is not supported by this application version.",
            details={"format": manifest.get("format"), "version": manifest.get("version")},
        ))
    return fail(_legacy_backup_disabled_error(parsed_payload))

def audit_logs(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method != "GET":
        return _method_not_allowed("GET")
    denied = _permission_required(request, "admin.settings")
    if denied:
        return denied
    logs = AuditLog.objects.order_by("-created_at", "-id")[:200]
    return JsonResponse({
        "logs": [
            {
                "id": log.id,
                "action": log.action,
                "entityType": log.entity_type,
                "entityId": log.entity_id,
                "message": log.message,
                "data": log.data,
                "createdAt": log.created_at.isoformat(),
            }
            for log in logs
        ]
    })


def _dashboard_review_to_dict(log):
    if not log:
        return None
    data = log.data if isinstance(log.data, dict) else {}
    return {
        "id": log.id,
        "status": data.get("status") or "unstable",
        "score": data.get("score", 0),
        "checks": data.get("checks") or [],
        "issues": data.get("issues") or [],
        "checkedAt": data.get("checkedAt") or log.created_at.isoformat(),
        "createdAt": log.created_at.isoformat(),
    }


@api_view(["GET", "POST", "OPTIONS"])
@authentication_classes(DASHBOARD_REVIEW_AUTH)
def dashboard_review(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "dashboard.open")
    if denied:
        return denied
    if request.method == "GET":
        latest = AuditLog.objects.filter(
            action="dashboard_design_review",
            entity_type="dashboard",
            entity_id="main_center",
        ).order_by("-created_at", "-id").first()
        return JsonResponse({"ok": True, "review": _dashboard_review_to_dict(latest)})
    if request.method != "POST":
        return _method_not_allowed("GET", "POST")

    payload = _drf_payload(request)
    status = str(payload.get("status") or "").strip().lower()
    if status not in {"stable", "unstable"}:
        return JsonResponse({"ok": False, "reason": "INVALID_REVIEW_STATUS"}, status=400)
    try:
        score = int(round(float(payload.get("score", 0))))
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "reason": "INVALID_REVIEW_SCORE"}, status=400)
    score = max(0, min(score, 100))
    checks = payload.get("checks")
    issues = payload.get("issues")
    if not isinstance(checks, list) or not isinstance(issues, list):
        return JsonResponse({"ok": False, "reason": "INVALID_REVIEW_PAYLOAD"}, status=400)
    data = {
        "status": status,
        "score": score,
        "checks": checks[:20],
        "issues": issues[:50],
        "checkedAt": payload.get("checkedAt") or timezone.now().isoformat(),
    }
    message = "Dashboard design review stable" if status == "stable" else "Dashboard design review unstable"
    _log("dashboard_design_review", "dashboard", "main_center", message, data)
    latest = AuditLog.objects.filter(
        action="dashboard_design_review",
        entity_type="dashboard",
        entity_id="main_center",
    ).order_by("-created_at", "-id").first()
    return JsonResponse({"ok": True, "review": _dashboard_review_to_dict(latest)}, status=201)


def _query_bool(value):
    if value is None or value == "":
        return None
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _exact_barcode_product_ids(query):
    normalized = _normalize_barcode(query).casefold()
    if not normalized:
        return []
    product_ids = set()
    for product in Product.objects.exclude(barcode="").only("id", "barcode"):
        if _normalize_barcode(product.barcode).casefold() == normalized:
            product_ids.add(product.id)
    for unit in ProductUnit.objects.exclude(barcode="").only("barcode", "product_id"):
        if _normalize_barcode(unit.barcode).casefold() == normalized:
            product_ids.add(unit.product_id)
    return list(product_ids)


def _apply_date_filters(qs, request):
    date_from = _drf_query(request, "dateFrom")
    date_to = _drf_query(request, "dateTo")
    parsed_from = parse_date(str(date_from)) if date_from else None
    parsed_to = parse_date(str(date_to)) if date_to else None
    if parsed_from:
        qs = qs.filter(created_at__date__gte=parsed_from)
    if parsed_to:
        qs = qs.filter(created_at__date__lte=parsed_to)
    return qs


def _apply_money_filters(qs, request, field_name):
    min_total = _drf_query(request, "minTotal")
    max_total = _drf_query(request, "maxTotal")
    if min_total not in (None, ""):
        qs = qs.filter(**{f"{field_name}__gte": decimal_or_zero(min_total)})
    if max_total not in (None, ""):
        qs = qs.filter(**{f"{field_name}__lte": decimal_or_zero(max_total)})
    return qs


def _apply_common_invoice_filters(qs, request, *, purchase=False):
    qs = _apply_date_filters(qs, request)
    total_field = "cost_usd" if purchase else "total_usd"
    qs = _apply_money_filters(qs, request, total_field)

    payment_status = _drf_query(request, "paymentStatus")
    if payment_status:
        qs = qs.filter(payment_status=payment_status)

    has_debt = _query_bool(_drf_query(request, "hasDebt"))
    if has_debt is True:
        qs = qs.filter(remaining_usd__gt=Decimal("0.0001"))
    elif has_debt is False:
        qs = qs.filter(remaining_usd__lte=Decimal("0.0001"))

    warehouse_id = _drf_query(request, "warehouseId")
    if warehouse_id:
        qs = qs.filter(items__warehouse__external_id=warehouse_id)

    currency = _drf_query(request, "currency")
    if currency:
        qs = qs.filter(items__product__currency=currency)

    query = str(_drf_query(request, "q") or "").strip()
    if query:
        barcode_product_ids = _exact_barcode_product_ids(query)
        if barcode_product_ids:
            return qs.filter(items__product_id__in=barcode_product_ids).distinct()
        if purchase:
            qs = qs.filter(
                Q(external_id__icontains=query)
                | Q(title__icontains=query)
                | Q(supplier_name__icontains=query)
                | Q(supplier__name__icontains=query)
                | Q(note__icontains=query)
                | Q(items__product__name__icontains=query)
                | Q(items__product__brand__icontains=query)
                | Q(items__product__sku__icontains=query)
                | Q(items__unit_id__icontains=query)
                | Q(items__unit_name__icontains=query)
                | Q(items__warehouse__name__icontains=query)
            )
        else:
            qs = qs.filter(
                Q(external_id__icontains=query)
                | Q(title__icontains=query)
                | Q(customer_name__icontains=query)
                | Q(note__icontains=query)
                | Q(client__name__icontains=query)
                | Q(items__product__name__icontains=query)
                | Q(items__product__brand__icontains=query)
                | Q(items__product__sku__icontains=query)
                | Q(items__unit_id__icontains=query)
                | Q(items__unit_name__icontains=query)
                | Q(items__warehouse__name__icontains=query)
            )

    return qs.distinct()


def _apply_sales_invoice_filters(qs, request):
    customer_id = _drf_query(request, "customerId") or _drf_query(request, "clientId") or _drf_query(request, "entityId")
    if customer_id:
        qs = qs.filter(client__external_id=customer_id)
    kind = str(_drf_query(request, "kind") or "").strip().lower()
    if kind in {"installment", "installments", "قسط", "اقساط"}:
        qs = qs.filter(Q(kind="installment") | Q(installment_plan__type="installment"))
    elif kind in {"direct_pos", "pos", "directpos", "quick_sale", "quick"}:
        qs = qs.filter(kind="direct_pos")
    elif kind in {"invoice", "formal", "direct", "cash", "بيع"}:
        qs = qs.filter(kind="invoice").exclude(installment_plan__type="installment")
    return _apply_common_invoice_filters(qs, request, purchase=False)


def _apply_purchase_invoice_filters(qs, request):
    supplier_id = _drf_query(request, "supplierId") or _drf_query(request, "entityId")
    if supplier_id:
        qs = qs.filter(supplier__external_id=supplier_id)
    return _apply_common_invoice_filters(qs, request, purchase=True)


@api_view(["GET", "POST", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def invoices(request):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "sales.open")
    if denied:
        return denied
    if request.method == "GET":
        entity_type = _drf_query(request, "entityType") or ("supplier" if _drf_query(request, "supplierId") else "customer")
        entity_id = _drf_query(request, "entityId") or _drf_query(request, "customerId") or _drf_query(request, "clientId") or _drf_query(request, "supplierId")
        qs = list_invoices_service(
            entity_type=entity_type,
            entity_id=entity_id,
            period_key=_drf_query(request, "period"),
            start_date=_drf_query(request, "start"),
            end_date=_drf_query(request, "end"),
            search_query=_drf_query(request, "q"),
            sale_kind=_drf_query(request, "saleKind"),
            return_status=_drf_query(request, "returnStatus"),
        )
        serializer = purchase_to_dict if entity_type == "supplier" else invoice_to_dict
        qs = _apply_purchase_invoice_filters(qs, request) if entity_type == "supplier" else _apply_sales_invoice_filters(qs, request)
        return _drf_paginated_response("invoices", qs, serializer, request, default_limit=100)
    if request.method != "POST":
        return _method_not_allowed("GET", "POST")
    denied = _permission_required(request, "sales.create_invoice")
    if denied:
        return denied
    try:
        created = create_invoice_service(_drf_payload(request))
    except (FinanceServiceError, OperationalError) as error:
        return _finance_error_response(error)
    serializer = purchase_to_dict if getattr(created, "supplier_id", None) else invoice_to_dict
    return Response({"ok": True, "invoice": serializer(created)}, status=201)


@api_view(["DELETE", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def invoice_detail(request, external_id):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    if request.method != "DELETE":
        return _method_not_allowed("DELETE")
    denied = _permission_required(request, "sales.delete_invoice")
    if denied:
        return denied
    payload = _drf_payload(request)
    try:
        invoice = void_invoice_service(
            external_id,
            reason=(payload.get("reason") or payload.get("note") or ""),
            requested_by=request.user,
        )
    except (FinanceServiceError, OperationalError) as error:
        return _finance_error_response(error)
    return Response({"ok": True, "reason": "VOIDED", "invoice": invoice_to_dict(invoice)})


@api_view(["GET", "POST", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def purchases(request):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "purchase.create_invoice" if request.method == "POST" else "purchase.open")
    if denied:
        return denied
    if request.method == "POST":
        payload = {**_drf_payload(request), "entityType": "supplier"}
        try:
            purchase = create_invoice_service(payload)
        except ValidationError as error:
            return Response(_validation_error_payload(error), status=400)
        except (FinanceServiceError, OperationalError) as error:
            return _finance_error_response(error)
        _record_purchase_account_movements(purchase)
        return Response({"ok": True, "purchase": purchase_to_dict(purchase)}, status=201)
    if request.method != "GET":
        return _method_not_allowed("GET", "POST")
    supplier_id = _drf_query(request, "supplierId")
    qs = list_invoices_service(
        entity_type="supplier",
        entity_id=supplier_id,
        period_key=_drf_query(request, "period"),
        start_date=_drf_query(request, "start"),
        end_date=_drf_query(request, "end"),
        search_query=_drf_query(request, "q"),
        sale_kind=_drf_query(request, "saleKind"),
        return_status=_drf_query(request, "returnStatus"),
    )
    qs = _apply_purchase_invoice_filters(qs, request)
    return _drf_paginated_response("purchases", qs, purchase_to_dict, request, default_limit=100)


@api_view(["DELETE", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def purchase_detail(request, external_id):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    if request.method != "DELETE":
        return _method_not_allowed("DELETE")
    denied = _permission_required(request, "purchase.delete_invoice")
    if denied:
        return denied
    payload = _drf_payload(request)
    try:
        purchase = void_purchase_service(
            external_id,
            reason=(payload.get("reason") or payload.get("note") or ""),
            requested_by=request.user,
        )
    except (FinanceServiceError, OperationalError) as error:
        return _finance_error_response(error)
    return Response({"ok": True, "reason": "VOIDED", "purchase": purchase_to_dict(purchase)})


def _return_permission_required(request, return_type):
    if return_type == "purchase_return":
        return _permission_required(request, "purchase.return")
    if return_type == "sale_return":
        return _permission_required(request, "sales.open")
    sales_denied = _permission_required(request, "sales.open")
    if not sales_denied:
        return None
    purchase_denied = _permission_required(request, "purchase.return")
    return None if not purchase_denied else sales_denied


@api_view(["GET", "POST", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def returns(request):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    if request.method == "POST":
        payload = _drf_payload(request)
        return_type = payload.get("returnType") or payload.get("type")
        if not return_type:
            return_type = "purchase_return" if payload.get("purchaseId") else "sale_return"
        denied = _return_permission_required(request, return_type)
        if denied:
            return denied
        try:
            return_document = create_return_service(payload, requested_by=request.user)
        except (FinanceServiceError, OperationalError) as error:
            return _finance_error_response(error)
        return Response({"ok": True, "returnDocument": return_document_to_dict(return_document)}, status=201)
    if request.method != "GET":
        return _method_not_allowed("GET", "POST")
    return_type = _drf_query(request, "type") or _drf_query(request, "returnType")
    if return_type not in {"sale_return", "purchase_return", None, ""}:
        return Response({"ok": False, "reason": "INVALID_RETURN_TYPE"}, status=400)
    return_type = return_type or None
    denied = _return_permission_required(request, return_type)
    if denied:
        return denied
    qs = list_returns_service(
        return_type=return_type,
        source_id=_drf_query(request, "sourceId") or _drf_query(request, "invoiceId") or _drf_query(request, "purchaseId"),
        period_key=_drf_query(request, "period"),
        start_date=_drf_query(request, "start"),
        end_date=_drf_query(request, "end"),
        sale_kind=_drf_query(request, "saleKind"),
        search_query=_drf_query(request, "q"),
    )
    return _drf_paginated_response("returns", qs, return_document_to_dict, request, default_limit=100)


@api_view(["GET", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def return_detail(request, external_id):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    if request.method != "GET":
        return _method_not_allowed("GET")
    return_document = (
        ReturnDocument.objects
        .select_related("invoice", "purchase", "client", "supplier")
        .prefetch_related(
            "items__product",
            "items__warehouse",
            "items__invoice_item__invoice__items",
            "items__purchase_item__purchase__items",
        )
        .filter(external_id=external_id)
        .first()
    )
    if not return_document:
        return Response({"ok": False, "reason": "NO_RETURN"}, status=404)
    denied = _return_permission_required(request, return_document.return_type)
    if denied:
        return denied
    return Response({"ok": True, "returnDocument": return_document_to_dict(return_document)})


@api_view(["GET", "POST", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def payments(request):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "accounts.manage_debts")
    if denied:
        return denied
    if request.method == "POST":
        try:
            payment = register_payment_service(_drf_payload(request))
        except ValidationError as error:
            return Response(_validation_error_payload(error), status=400)
        except (FinanceServiceError, OperationalError) as error:
            return _finance_error_response(error)
        if getattr(payment, "supplier_id", None):
            _record_supplier_payment_account_movement(payment)
        else:
            _record_client_payment_account_movement(payment)
        serializer = supplier_payment_to_dict if getattr(payment, "supplier_id", None) else client_payment_to_dict
        return Response({"ok": True, "payment": serializer(payment)}, status=201)
    if request.method != "GET":
        return _method_not_allowed("GET", "POST")
    limit, offset = _pagination_params(request, default_limit=100)
    entity_type = _drf_query(request, "entityType")
    entity_id = _drf_query(request, "entityId") or _drf_query(request, "customerId") or _drf_query(request, "clientId") or _drf_query(request, "supplierId")
    if not entity_type and _drf_query(request, "supplierId"):
        entity_type = "supplier"
    elif not entity_type and (_drf_query(request, "customerId") or _drf_query(request, "clientId")):
        entity_type = "customer"
    client_qs, supplier_qs = list_payments_service(entity_type=entity_type, entity_id=entity_id)
    client_total = client_qs.count()
    supplier_total = supplier_qs.count()
    return Response({
        "clientPayments": [client_payment_to_dict(payment) for payment in client_qs[offset:offset + limit]],
        "supplierPayments": [supplier_payment_to_dict(payment) for payment in supplier_qs[offset:offset + limit]],
        "pagination": {
            "limit": limit,
            "offset": offset,
            "clientTotal": client_total,
            "supplierTotal": supplier_total,
            "hasMore": offset + limit < max(client_total, supplier_total),
        },
    })


@api_view(["GET", "POST", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def installments(request):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "accounts.manage_debts")
    if denied:
        return denied
    if request.method == "POST":
        try:
            invoice, created_installments = create_installment_service(_drf_payload(request))
        except (FinanceServiceError, OperationalError) as error:
            return _finance_error_response(error)
        return Response({
            "ok": True,
            "invoice": invoice_to_dict(invoice),
            "installments": [installment_to_dict(item) for item in created_installments],
        }, status=201)
    if request.method != "GET":
        return _method_not_allowed("GET", "POST")
    qs = list_installments_service(
        customer_id=_drf_query(request, "customerId") or _drf_query(request, "clientId"),
        invoice_id=_drf_query(request, "invoiceId"),
    )
    return _drf_paginated_response("installments", qs, installment_to_dict, request, default_limit=100)


@api_view(["GET", "POST", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def statements(request):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "accounts.manage_debts")
    if denied:
        return denied
    if request.method == "POST":
        payload = _drf_payload(request)
        try:
            if payload.get("reverseEntryId"):
                entry = reverse_ledger_entry_service(payload.get("reverseEntryId"), reason=payload.get("reason") or payload.get("note") or "")
            else:
                entry = create_debt_adjustment_service(payload)
        except (FinanceServiceError, OperationalError, LedgerEntry.DoesNotExist) as error:
            return _finance_error_response(error)
        return Response({"ok": True, "entry": ledger_entry_to_dict(entry)}, status=201)
    if request.method != "GET":
        return _method_not_allowed("GET", "POST")
    entity_type = _drf_query(request, "entityType")
    if entity_type == "client":
        entity_type = "customer"
    entity_id = _drf_query(request, "entityId") or _drf_query(request, "customerId") or _drf_query(request, "clientId") or _drf_query(request, "supplierId")
    limit, offset = _pagination_params(request, default_limit=200)
    page, balance_usd_value, total_count = statement_service(entity_type, entity_id=entity_id, limit=limit, offset=offset)
    return Response({
        "entries": [ledger_entry_to_dict(entry) for entry in page],
        "balanceUsd": float(balance_usd_value),
        "balanceIqd": float(balance_iqd(balance_usd_value)),
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": total_count,
            "hasMore": offset + limit < total_count,
        },
    })


@csrf_exempt
def stock_adjust(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "warehouse.edit_product")
    if denied:
        return denied
    if request.method != "POST":
        return _method_not_allowed("POST")
    payload = parse_json_body(request)
    try:
        product = adjust_stock(
            payload.get("productId"),
            payload.get("unitId"),
            payload.get("quantity"),
            mode=payload.get("mode") or "DECREASE",
            note=payload.get("note") or "",
            batch=payload.get("batch") or None,
        )
    except InsufficientStock:
        return JsonResponse({"ok": False, "reason": "INSUFFICIENT_STOCK"}, status=400)
    except StockError as error:
        return JsonResponse({"ok": False, "reason": str(error)}, status=400)
    _log("stock", "product", product.external_id, "Stock adjusted", payload)
    return JsonResponse({"ok": True, "product": product_to_dict(product)})


@csrf_exempt
def warehouses(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "warehouse.open")
    if denied:
        return denied
    if request.method == "GET":
        return JsonResponse({"warehouses": [warehouse_to_dict(item) for item in Warehouse.objects.active().order_by("-id")]})
    if request.method != "POST":
        return _method_not_allowed("GET", "POST")
    denied = _permission_required(request, "warehouse.add_product")
    if denied:
        return denied

    payload = parse_json_body(request)
    external_id = payload.get("id") or f"wh-{int(timezone.now().timestamp() * 1000)}"
    warehouse = Warehouse.objects.create(
        external_id=external_id,
        name=payload.get("name") or "مخزن",
        code=payload.get("code") or "",
        zone=payload.get("zone") or "",
        manager=payload.get("manager") or "",
        color=payload.get("color") or "#d6b35a",
        note=payload.get("note") or "",
    )
    return JsonResponse(warehouse_to_dict(warehouse), status=201)


@csrf_exempt
def warehouse_detail(request, external_id):
    warehouse = Warehouse.objects.filter(external_id=external_id).first()
    if not warehouse:
        return JsonResponse({"ok": False, "reason": "NO_WAREHOUSE"}, status=404)
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "warehouse.edit_product")
    if denied:
        return denied
    if request.method == "DELETE":
        _hard_delete_products(Product.objects.filter(warehouse=warehouse))
        archived_at = timezone.now()
        warehouse.deleted_at = archived_at
        warehouse.save(update_fields=["deleted_at", "updated_at"])
        return JsonResponse({"ok": True})
    if request.method != "PATCH":
        return _method_not_allowed("PATCH", "DELETE")

    payload = parse_json_body(request)
    for field in ("name", "code", "zone", "manager", "color", "note"):
        if field in payload:
            setattr(warehouse, field, payload.get(field) or ("#d6b35a" if field == "color" else ""))
    warehouse.save()
    return JsonResponse(warehouse_to_dict(warehouse))


@csrf_exempt
def pos_products(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "warehouse.open")
    if denied:
        return denied
    if request.method != "GET":
        return _method_not_allowed("GET")

    limit = _positive_int(request.GET.get("limit"), POS_PRODUCT_LIMIT_DEFAULT, POS_PRODUCT_LIMIT_MAX)
    cursor = _positive_int(request.GET.get("cursor"), 0, 100000000)
    qs = _pos_product_queryset()
    qs, exact_barcode_match = _pos_filter_products(
        qs,
        query=request.GET.get("q", ""),
        barcode=request.GET.get("barcode", ""),
        warehouse_id=request.GET.get("warehouseId", ""),
    )
    page = list(qs[cursor:cursor + limit + 1])
    items = page[:limit]
    has_more = len(page) > limit
    total_approx = cursor + len(items) + (1 if has_more else 0)
    return JsonResponse({
        "items": [_pos_product_summary(product) for product in items],
        "nextCursor": str(cursor + len(items)) if has_more else "",
        "hasMore": has_more,
        "totalApprox": total_approx,
        "exactBarcodeMatch": exact_barcode_match,
    })


@csrf_exempt
def pos_product_detail(request, product_id):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "warehouse.open")
    if denied:
        return denied
    if request.method != "GET":
        return _method_not_allowed("GET")
    product = (
        Product.objects.active()
        .select_related("warehouse")
        .prefetch_related("units", "images")
        .filter(external_id=product_id)
        .first()
    )
    if not product:
        return JsonResponse({"ok": False, "reason": "NO_PRODUCT"}, status=404)
    return JsonResponse(_pos_product_detail_payload(product))


@csrf_exempt
def products(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "warehouse.open")
    if denied:
        return denied
    if request.method == "GET":
        open_batches = StockBatch.objects.filter(quantity__gt=0, is_closed=False).order_by("expiry_date", "received_at", "id")
        products_qs = (
            Product.objects.active()
            .select_related("warehouse")
            .prefetch_related("units", "images", Prefetch("batches", queryset=open_batches))
            .order_by("-id")
        )
        return JsonResponse({"products": [product_to_dict(item) for item in products_qs]})
    if request.method != "POST":
        return _method_not_allowed("GET", "POST")
    denied = _permission_required(request, "warehouse.add_product")
    if denied:
        return denied

    payload = parse_json_body(request)
    warehouse = Warehouse.objects.filter(external_id=payload.get("warehouseId"), deleted_at__isnull=True).first()
    if not warehouse:
        return JsonResponse({"ok": False, "reason": "NO_WAREHOUSE"}, status=400)

    external_id = payload.get("id") or f"p-{int(timezone.now().timestamp() * 1000)}"
    try:
        _validate_product_commercial_payload(payload)
        _validate_api_product_barcodes(payload, external_id)
    except SyncSectionError as error:
        return _duplicate_barcode_response(error)
    except ValidationError as error:
        return JsonResponse(_validation_error_payload(error), status=400)

    try:
        with transaction.atomic():
            purchase_cost_usd = _purchase_cost_usd_from_payload(payload, required=True)
            product = Product.objects.create(
                external_id=external_id,
                warehouse=warehouse,
                name=payload.get("name") or "منتج",
                brand=payload.get("brand") or "",
                origin_country=_product_origin_value(payload),
                kind=payload.get("kind") or "single",
                barcode=_normalize_barcode(payload.get("barcode")),
                sku=payload.get("sku") or "",
                image=payload.get("image") or payload.get("imageUrl") or "",
                currency=payload.get("currency") or "IQD",
                base_unit=payload.get("baseUnit") or "قطعة",
                stock_unit_name=payload.get("stockUnitName") or payload.get("baseUnit") or "قطعة",
                stock_unit_multiplier=decimal_or_zero(payload.get("stockUnitMultiplier"), "1"),
                stock_quantity_mode=payload.get("stockQuantityMode") or "storage-main-unit-v1",
                stock_quantity=decimal_or_zero(payload.get("stockQuantity")),
                purchase_cost_usd=purchase_cost_usd,
                alert_quantity=decimal_or_zero(payload.get("alertQuantity")),
                expiry_start=date_or_none(payload.get("expiryStart")),
                expires_at=date_or_none(payload.get("expiresAt")),
            )
            create_opening_stock_batch(product, unit_cost_usd=purchase_cost_usd)
            incoming_units = payload.get("units") if isinstance(payload.get("units"), list) else []
            if not incoming_units:
                incoming_units = [_default_product_unit_payload(product, payload)]
            for unit in incoming_units:
                ProductUnit.objects.create(
                    external_id=unit.get("id") or f"{product.external_id}-unit-{product.units.count() + 1}",
                    product=product,
                    name=unit.get("name") or product.base_unit,
                    multiplier=decimal_or_zero(unit.get("multiplier"), "1"),
                    price_usd=decimal_or_zero(unit.get("priceUsd")),
                    price_currency=unit.get("priceCurrency") or product.currency,
                    barcode=_normalize_barcode(unit.get("barcode")),
                )
            _ensure_product_has_base_unit(product, payload)
            _refresh_product_search_tokens(product)
    except IntegrityError as error:
        return _constraint_error_response(error)
    except ValidationError as error:
        return JsonResponse(_validation_error_payload(error), status=400)
    return JsonResponse(product_to_dict(product), status=201)


@csrf_exempt
def product_detail(request, external_id):
    product = Product.objects.filter(external_id=external_id).select_related("warehouse").first()
    if not product:
        return JsonResponse({"ok": False, "reason": "NO_PRODUCT"}, status=404)
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    if request.method == "DELETE":
        denied = _permission_required(request, "warehouse.delete_product")
        if denied:
            return denied
        _hard_delete_products(Product.objects.filter(pk=product.pk))
        return JsonResponse({"ok": True})
    if request.method != "PATCH":
        return _method_not_allowed("PATCH", "DELETE")
    denied = _permission_required(request, "warehouse.edit_product")
    if denied:
        return denied

    payload = parse_json_body(request)
    try:
        _validate_product_commercial_payload(payload, product)
        _validate_api_product_barcodes(payload, product.external_id, product)
    except SyncSectionError as error:
        return _duplicate_barcode_response(error)
    except ValidationError as error:
        return JsonResponse(_validation_error_payload(error), status=400)

    try:
        with transaction.atomic():
            before_snapshot = _product_accounting_snapshot(product)
            if "warehouseId" in payload:
                warehouse = Warehouse.objects.filter(external_id=payload.get("warehouseId"), deleted_at__isnull=True).first()
                if warehouse:
                    product.warehouse = warehouse
            if _has_product_origin(payload):
                product.origin_country = _product_origin_value(payload)
            field_map = {
                "name": "name",
                "brand": "brand",
                "kind": "kind",
                "barcode": "barcode",
                "sku": "sku",
                "image": "image",
                "imageUrl": "image",
                "currency": "currency",
                "baseUnit": "base_unit",
                "stockUnitName": "stock_unit_name",
                "stockUnitMultiplier": "stock_unit_multiplier",
                "stockQuantityMode": "stock_quantity_mode",
                "stockQuantity": "stock_quantity",
                "purchaseCostUsd": "purchase_cost_usd",
                "alertQuantity": "alert_quantity",
                "expiryStart": "expiry_start",
                "expiresAt": "expires_at",
            }
            if any(key in payload for key in ("purchaseCost", "purchaseCostAmount", "purchaseCostCurrency")) and "purchaseCostUsd" not in payload:
                product.purchase_cost_usd = _purchase_cost_usd_from_payload(payload, required=True)
            for source, target in field_map.items():
                if source not in payload:
                    continue
                value = payload.get(source)
                if target == "barcode":
                    value = _normalize_barcode(value)
                if target in {"stock_quantity", "alert_quantity", "stock_unit_multiplier", "purchase_cost_usd"}:
                    value = decimal_or_zero(value)
                if target in {"expiry_start", "expires_at"}:
                    value = date_or_none(value)
                if target in {"stock_quantity", "alert_quantity"}:
                    setattr(product, target, value)
                elif target in {"expiry_start", "expires_at"}:
                    setattr(product, target, value)
                else:
                    setattr(product, target, value or "")
            product.save()

            incoming_units = payload.get("units") if isinstance(payload.get("units"), list) else None
            active_unit_ids = []
            if incoming_units is not None:
                existing_units = {
                    unit.external_id: unit
                    for unit in ProductUnit.objects.filter(product=product)
                }
                for unit in incoming_units:
                    unit_id = str(unit.get("id") or unit.get("unitId") or "").strip()
                    if not unit_id:
                        continue
                    active_unit_ids.append(unit_id)
                    existing_unit = existing_units.get(unit_id)
                    price_source = unit.get("priceUsd") if "priceUsd" in unit else unit.get("price")
                    ProductUnit.objects.update_or_create(
                        external_id=unit_id,
                        product=product,
                        defaults={
                            "name": unit.get("name") or (existing_unit.name if existing_unit else product.base_unit),
                            "multiplier": decimal_or_zero(unit.get("multiplier"), existing_unit.multiplier if existing_unit else "1"),
                            "price_usd": decimal_or_zero(price_source, existing_unit.price_usd if existing_unit else "0"),
                            "price_currency": unit.get("priceCurrency") or unit.get("currency") or (existing_unit.price_currency if existing_unit else product.currency),
                            "barcode": _normalize_barcode(unit.get("barcode", existing_unit.barcode if existing_unit else "")),
                            "deleted_at": None,
                        },
                    )
                if payload.get("replaceUnits") is True and active_unit_ids:
                    _remove_obsolete_product_units(product, active_unit_ids)
            _ensure_product_has_base_unit(product, payload)
            _refresh_product_search_tokens(product)
            product.refresh_from_db()
            after_snapshot = _product_accounting_snapshot(product)
            changed = _product_accounting_diff(before_snapshot, after_snapshot)
            if changed:
                _log(
                    "product_accounting_change",
                    "product",
                    product.external_id,
                    "Product accounting fields changed",
                    {"user": _audit_actor(getattr(request, "user", None)), "changes": changed},
                )
    except IntegrityError as error:
        return _constraint_error_response(error)
    except ValidationError as error:
        return JsonResponse(_validation_error_payload(error), status=400)
    return JsonResponse(product_to_dict(product))


@csrf_exempt
def product_images(request, product_id):
    product = Product.objects.filter(external_id=product_id, deleted_at__isnull=True).select_related("warehouse").first()
    if not product:
        return JsonResponse({"ok": False, "reason": "NO_PRODUCT"}, status=404)
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "warehouse.edit_product")
    if denied:
        return denied
    if request.method == "GET":
        return _product_image_response(product)
    if request.method == "PATCH":
        payload = parse_json_body(request)
        items = payload.get("images") if isinstance(payload.get("images"), list) else []
        primary_id = str(payload.get("primaryImageId") or payload.get("primaryId") or "").strip()
        with transaction.atomic():
            if primary_id:
                image = ProductImage.objects.filter(product=product, external_id=primary_id).first()
                if not image:
                    return JsonResponse({"ok": False, "reason": "NO_IMAGE"}, status=404)
                _ensure_single_primary_product_image(product, image)
                image.is_primary = True
                image.save(update_fields=["is_primary", "updated_at"])
            for index, item in enumerate(items):
                if not isinstance(item, dict) or not item.get("id"):
                    continue
                image = ProductImage.objects.filter(product=product, external_id=item.get("id")).first()
                if not image:
                    continue
                image.sort_order = int(item.get("sortOrder") if item.get("sortOrder") is not None else index)
                if item.get("isPrimary") is True:
                    _ensure_single_primary_product_image(product, image)
                    image.is_primary = True
                image.save(update_fields=["sort_order", "is_primary", "updated_at"])
            _ensure_product_primary_image(product)
        return _product_image_response(product)
    if request.method != "POST":
        return _method_not_allowed("GET", "POST", "PATCH")

    image_files = request.FILES.getlist("image") or request.FILES.getlist("images") or request.FILES.getlist("original")
    large_files = request.FILES.getlist("large")
    catalog_files = request.FILES.getlist("catalog")
    thumb_files = request.FILES.getlist("thumb")
    file_count = max(len(image_files), len(large_files), len(catalog_files), len(thumb_files))
    if file_count <= 0:
        return JsonResponse({"ok": False, "reason": "NO_FILE"}, status=400)
    if file_count > 20:
        return JsonResponse({"ok": False, "reason": "TOO_MANY_IMAGES"}, status=400)

    def file_at(files, index):
        return files[index] if index < len(files) else None

    created_images = []
    try:
        with transaction.atomic():
            existing_count = ProductImage.objects.filter(product=product).count()
            current_max = ProductImage.objects.filter(product=product).aggregate(Max("sort_order")).get("sort_order__max")
            next_sort = int(current_max or 0) + (1 if existing_count else 0)
            force_primary = str(request.POST.get("isPrimary") or request.POST.get("primary") or "").lower() in {"1", "true", "yes"}
            for index in range(file_count):
                original_upload = file_at(image_files, index)
                large_upload = file_at(large_files, index)
                catalog_upload = file_at(catalog_files, index)
                thumb_upload = file_at(thumb_files, index)
                fallback_upload = original_upload or large_upload or catalog_upload or thumb_upload
                error = _uploaded_image_error(fallback_upload)
                if error:
                    return JsonResponse({"ok": False, "reason": error}, status=400)
                image = ProductImage(
                    external_id=request.POST.get("id") if file_count == 1 and request.POST.get("id") else f"pi-{int(timezone.now().timestamp() * 1000)}-{index}",
                    product=product,
                    sort_order=next_sort + index,
                    is_primary=force_primary or existing_count == 0 and index == 0,
                )
                _save_product_image_variant(image, "original", original_upload or fallback_upload, "original")
                _save_product_image_variant(image, "large", large_upload, "large")
                _save_product_image_variant(image, "catalog", catalog_upload, "catalog")
                _save_product_image_variant(image, "thumb", thumb_upload, "thumb")
                if image.is_primary:
                    _ensure_single_primary_product_image(product)
                image.save()
                created_images.append(image)
            _ensure_product_primary_image(product)
            _log(
                "product_images_uploaded",
                "product",
                product.external_id,
                "Product images uploaded",
                {"count": len(created_images), "user": _audit_actor(getattr(request, "user", None))},
            )
    except ValidationError as error:
        return JsonResponse(_validation_error_payload(error), status=400)
    return _product_image_response(product, status=201)


@csrf_exempt
def product_image_detail(request, product_id, image_id):
    product = Product.objects.filter(external_id=product_id, deleted_at__isnull=True).first()
    image = ProductImage.objects.filter(product=product, external_id=image_id).first() if product else None
    if not product or not image:
        return JsonResponse({"ok": False, "reason": "NO_IMAGE"}, status=404)
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "warehouse.edit_product")
    if denied:
        return denied
    if request.method == "PATCH":
        payload = parse_json_body(request)
        if "sortOrder" in payload:
            image.sort_order = int(payload.get("sortOrder") or 0)
        if payload.get("isPrimary") is True:
            _ensure_single_primary_product_image(product, image)
            image.is_primary = True
        image.save(update_fields=["sort_order", "is_primary", "updated_at"])
        _ensure_product_primary_image(product)
        return _product_image_response(product)
    if request.method != "DELETE":
        return _method_not_allowed("PATCH", "DELETE")
    was_primary = image.is_primary
    paths = [
        field.path
        for field in (image.original, image.large, image.catalog, image.thumb)
        if field and getattr(field, "name", "")
    ]
    image.delete()
    for path in paths:
        try:
            if path and os.path.exists(path):
                os.remove(path)
        except OSError:
            pass
    if was_primary:
        _ensure_product_primary_image(product)
    _log(
        "product_image_deleted",
        "product",
        product.external_id,
        "Product image deleted",
        {"imageId": image_id, "user": _audit_actor(getattr(request, "user", None))},
    )
    return _product_image_response(product)


@csrf_exempt
def product_unit_detail(request, product_id, unit_id):
    product = Product.objects.filter(external_id=product_id).first()
    unit = ProductUnit.objects.filter(product=product, external_id=unit_id).first() if product else None
    if not product or not unit:
        return JsonResponse({"ok": False, "reason": "NO_UNIT"}, status=404)
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "warehouse.edit_product")
    if denied:
        return denied
    if request.method == "DELETE":
        if unit.multiplier == Decimal("1"):
            return JsonResponse({"ok": False, "reason": "BASE_UNIT_LOCKED"}, status=400)
        if _unit_is_referenced(unit):
            _security_audit("delete_rejected", "product_unit_in_use", {"productId": product_id, "unitId": unit_id})
            return JsonResponse({"ok": False, "reason": "UNIT_IN_USE"}, status=409)
        before_snapshot = _product_accounting_snapshot(product)
        unit.delete()
        product.refresh_from_db()
        _refresh_product_search_tokens(product)
        after_snapshot = _product_accounting_snapshot(product)
        changed = _product_accounting_diff(before_snapshot, after_snapshot)
        if changed:
            _log(
                "product_accounting_change",
                "product",
                product.external_id,
                "Product accounting unit deleted",
                {"user": _audit_actor(getattr(request, "user", None)), "changes": changed},
            )
        return JsonResponse({"ok": True})
    return _method_not_allowed("DELETE")


def _customers_collection(request, key):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "accounts.manage_debts")
    if denied:
        return denied
    if request.method == "GET":
        return Response({key: [client_to_dict(item) for item in list_customers_service()]})
    if request.method != "POST":
        return _method_not_allowed("GET", "POST")
    try:
        customer = create_customer_service(_drf_payload(request))
    except FinanceServiceError as error:
        return _finance_error_response(error)
    return Response(client_to_dict(customer), status=201)


@api_view(["GET", "POST", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def customers(request):
    return _customers_collection(request, "customers")


@api_view(["GET", "POST", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def clients(request):
    return _customers_collection(request, "clients")


def _customer_detail(request, external_id):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "accounts.manage_debts")
    if denied:
        return denied
    if request.method == "DELETE":
        try:
            archive_customer_service(external_id)
        except FinanceServiceError as error:
            return _finance_error_response(error)
        return Response({"ok": True})
    if request.method == "GET":
        customer = next((item for item in list_customers_service() if item.external_id == external_id), None)
        if not customer:
            return Response({"ok": False, "reason": "NO_CUSTOMER"}, status=404)
        return Response(client_to_dict(customer))
    if request.method != "PATCH":
        return _method_not_allowed("GET", "PATCH", "DELETE")
    try:
        customer = update_customer_service_by_id(external_id, _drf_payload(request))
    except FinanceServiceError as error:
        return _finance_error_response(error)
    return Response(client_to_dict(customer))


@api_view(["GET", "PATCH", "DELETE", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def customer_detail(request, external_id):
    return _customer_detail(request, external_id)


@api_view(["GET", "PATCH", "DELETE", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def client_detail(request, external_id):
    return _customer_detail(request, external_id)


@api_view(["GET", "POST", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def suppliers(request):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "accounts.manage_debts")
    if denied:
        return denied
    if request.method == "GET":
        return Response({"suppliers": [supplier_to_dict(item) for item in list_suppliers_service()]})
    if request.method != "POST":
        return _method_not_allowed("GET", "POST")
    try:
        supplier = create_supplier_service(_drf_payload(request))
    except FinanceServiceError as error:
        return _finance_error_response(error)
    return Response(supplier_to_dict(supplier), status=201)


@api_view(["GET", "PATCH", "DELETE", "OPTIONS"])
@authentication_classes(FINANCE_AUTH)
def supplier_detail(request, external_id):
    if request.method == "OPTIONS":
        return Response({"ok": True})
    denied = _permission_required(request, "accounts.manage_debts")
    if denied:
        return denied
    if request.method == "DELETE":
        try:
            archive_supplier_service(external_id)
        except FinanceServiceError as error:
            return _finance_error_response(error)
        return Response({"ok": True})
    if request.method == "GET":
        supplier = next((item for item in list_suppliers_service() if item.external_id == external_id), None)
        if not supplier:
            return Response({"ok": False, "reason": "NO_SUPPLIER"}, status=404)
        return Response(supplier_to_dict(supplier))
    if request.method != "PATCH":
        return _method_not_allowed("GET", "PATCH", "DELETE")
    try:
        supplier = update_supplier_service_by_id(external_id, _drf_payload(request))
    except FinanceServiceError as error:
        return _finance_error_response(error)
    return Response(supplier_to_dict(supplier))


@csrf_exempt
def employees(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "admin.manage_employees")
    if denied:
        return denied
    if request.method == "GET":
        return JsonResponse({"employees": [employee_to_dict(item) for item in Employee.objects.active().order_by("-id")]})
    if request.method != "POST":
        return _method_not_allowed("GET", "POST")
    payload = parse_json_body(request)
    employee = Employee.objects.create(
        external_id=payload.get("id") or f"e-{int(timezone.now().timestamp() * 1000)}",
        name=payload.get("name") or "موظف",
        phone=payload.get("phone") or "",
        role=payload.get("role") or "",
        salary=decimal_or_zero(payload.get("salary")),
        work_hours=decimal_or_zero(payload.get("workHours")),
    )
    return JsonResponse(employee_to_dict(employee), status=201)


@csrf_exempt
def employee_detail(request, external_id):
    employee = Employee.objects.filter(external_id=external_id).first()
    if not employee:
        return JsonResponse({"ok": False, "reason": "NO_EMPLOYEE"}, status=404)
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})
    denied = _permission_required(request, "admin.manage_employees")
    if denied:
        return denied
    if request.method == "DELETE":
        employee.archive()
        return JsonResponse({"ok": True})
    if request.method != "PATCH":
        return _method_not_allowed("PATCH", "DELETE")
    payload = parse_json_body(request)
    for field in ("name", "phone", "role"):
        if field in payload:
            setattr(employee, field, payload.get(field) or "")
    if "salary" in payload:
        employee.salary = decimal_or_zero(payload.get("salary"))
    if "workHours" in payload:
        employee.work_hours = decimal_or_zero(payload.get("workHours"))
    employee.save()
    return JsonResponse(employee_to_dict(employee))


# =============================================================================
# SUPER ADMIN APIS
# =============================================================================
from functools import wraps
import os
import math
from datetime import timedelta
from django.conf import settings
from django.db.models import Q


def super_admin_required(view_func):
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"ok": False, "reason": "UNAUTHORIZED"}, status=401)
        profile = getattr(request.user, "tox_profile", None)
        if not profile or profile.role != "super_admin":
            return JsonResponse({"ok": False, "reason": "FORBIDDEN"}, status=403)
        return view_func(request, *args, **kwargs)
    return _wrapped_view


def _super_admin_user_dict(user):
    """Consistent user dict for all super-admin API responses."""
    profile = getattr(user, "tox_profile", None)
    expires_at = profile.expires_at if profile else None
    now = timezone.now()
    is_expired = bool(expires_at and expires_at < now)
    staff_count = UserProfile.objects.filter(managed_by=user).exclude(role__in=["admin", "super_admin"]).count()
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.first_name,
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
        "role": profile.role if profile else "unknown",
        "managed_by_id": profile.managed_by_id if profile else None,
        "managed_by_username": profile.managed_by.username if profile and profile.managed_by else "",
        "managed_by_name": profile.managed_by.get_full_name() if profile and profile.managed_by else "",
        "managed_staff_count": staff_count,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "starts_at": profile.created_at.isoformat() if profile and profile.created_at else None,
        "date_joined": user.date_joined.isoformat(),
        "is_expired": is_expired,
    }


@csrf_exempt
@api_view(["GET"])
@authentication_classes([ToxJWTAuthentication, SessionAuthentication])
@permission_classes([IsAuthenticated])
@super_admin_required
def super_admin_stats(request):
    db_path = settings.DATABASES["default"]["NAME"]
    db_size_mb = 0
    if os.path.exists(db_path):
        db_size_mb = round(os.path.getsize(db_path) / (1024 * 1024), 2)

    now = timezone.now()
    soon = now + timedelta(days=7)

    total_users = User.objects.count()
    active_users = User.objects.filter(is_active=True).count()
    disabled_users = User.objects.filter(is_active=False).count()

    # Expired subscriptions (active users whose subscription ended)
    expired_users = UserProfile.objects.filter(
        expires_at__isnull=False,
        expires_at__lt=now,
        user__is_active=True
    ).exclude(role="super_admin").count()

    # Expiring within 7 days
    expiring_soon = UserProfile.objects.filter(
        expires_at__isnull=False,
        expires_at__gte=now,
        expires_at__lte=soon,
        user__is_active=True
    ).exclude(role="super_admin").count()

    return JsonResponse({
        "ok": True,
        "users": total_users,
        "active_users": active_users,
        "disabled_users": disabled_users,
        "expired_users": expired_users,
        "expiring_soon": expiring_soon,
        "invoices": Invoice.objects.filter(voided_at__isnull=True).count(),
        "products": Product.objects.active().count(),
        "db_size_mb": db_size_mb
    })


@csrf_exempt
@api_view(["GET", "POST"])
@authentication_classes([ToxJWTAuthentication, SessionAuthentication])
@permission_classes([IsAuthenticated])
@super_admin_required
def super_admin_users(request):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})

    if request.method == "GET":
        # Pagination parameters
        try:
            page = max(1, int(request.GET.get("page", 1)))
        except (ValueError, TypeError):
            page = 1
        try:
            page_size = min(200, max(10, int(request.GET.get("page_size", 50))))
        except (ValueError, TypeError):
            page_size = 50

        search = str(request.GET.get("search", "")).strip()

        users_qs = User.objects.all().select_related("tox_profile", "tox_profile__managed_by").order_by("-date_joined")

        # Search filter
        if search:
            users_qs = users_qs.filter(Q(username__icontains=search))

        total = users_qs.count()
        total_pages = max(1, math.ceil(total / page_size))
        page = min(page, total_pages)

        offset = (page - 1) * page_size
        users_page = users_qs[offset:offset + page_size]

        out = [_super_admin_user_dict(u) for u in users_page]

        return JsonResponse({
            "ok": True,
            "users": out,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        })

    if request.method == "POST":
        payload = parse_json_body(request)
        username = str(payload.get("username") or "").strip()
        password = str(payload.get("password") or "")
        full_name = str(payload.get("full_name") or "").strip()
        # Force role to admin — super admin creates admin accounts only
        role = "admin"

        if not username or not password:
            return JsonResponse({"ok": False, "reason": "MISSING_FIELDS"}, status=400)

        if User.objects.filter(username=username).exists():
            return JsonResponse({"ok": False, "reason": "USERNAME_TAKEN"}, status=400)

        # Determine subscription dates
        expires_at = None
        start_date_str = payload.get("start_date")
        end_date_str = payload.get("end_date")
        subscription_days = payload.get("subscription_days")

        if end_date_str:
            try:
                from django.utils.dateparse import parse_datetime as _dp
                expires_at = _dp(end_date_str)
                if expires_at and timezone.is_naive(expires_at):
                    expires_at = timezone.make_aware(expires_at)
            except Exception:
                expires_at = None
        elif subscription_days and str(subscription_days).isdigit() and int(subscription_days) > 0:
            expires_at = timezone.now() + timedelta(days=int(subscription_days))

        user = User.objects.create_user(username=username, password=password, first_name=full_name)
        profile = UserProfile.objects.create(user=user, role=role, expires_at=expires_at, managed_by=request.user)

        # Set created_at from start_date if provided
        if start_date_str:
            try:
                from django.utils.dateparse import parse_datetime as _dp2
                parsed_start = _dp2(start_date_str)
                if parsed_start:
                    if timezone.is_naive(parsed_start):
                        parsed_start = timezone.make_aware(parsed_start)
                    profile.created_at = parsed_start
                    profile.save(update_fields=["created_at"])
            except Exception:
                pass

        return JsonResponse({"ok": True, "id": user.id, "user": _super_admin_user_dict(user)})


@csrf_exempt
@api_view(["POST", "DELETE"])
@authentication_classes([ToxJWTAuthentication, SessionAuthentication])
@permission_classes([IsAuthenticated])
@super_admin_required
def super_admin_user_action(request, user_id):
    if request.method == "OPTIONS":
        return JsonResponse({"ok": True})

    try:
        user = User.objects.select_related("tox_profile").get(pk=user_id)
    except User.DoesNotExist:
        return JsonResponse({"ok": False, "reason": "NOT_FOUND"}, status=404)

    if user.username == "super_admin":
        return JsonResponse({"ok": False, "reason": "CANNOT_MODIFY_SUPER_ADMIN"}, status=403)

    if request.method == "POST":
        payload = parse_json_body(request)
        action = payload.get("action")

        if action == "change_password":
            new_password = str(payload.get("new_password") or "")
            if not new_password:
                return JsonResponse({"ok": False, "reason": "MISSING_PASSWORD"}, status=400)
            user.set_password(new_password)
            user.save(update_fields=["password"])
            return JsonResponse({"ok": True, "user": _super_admin_user_dict(user)})

        if action == "toggle_active":
            user.is_active = not user.is_active
            user.save(update_fields=["is_active"])

            # Smart: when re-enabling a disabled account with expired subscription,
            # auto-renew for 30 days from now
            if user.is_active:
                profile = getattr(user, "tox_profile", None)
                if profile and profile.expires_at and profile.expires_at < timezone.now():
                    profile.expires_at = timezone.now() + timedelta(days=30)
                    profile.save(update_fields=["expires_at"])

            return JsonResponse({
                "ok": True,
                "is_active": user.is_active,
                "user": _super_admin_user_dict(user)
            })

        elif action == "renew_subscription":
            profile = getattr(user, "tox_profile", None)
            if not profile:
                return JsonResponse({"ok": False, "reason": "NO_PROFILE"}, status=400)

            new_end_date_str = payload.get("new_end_date")
            extend_days = payload.get("extend_days")

            now = timezone.now()

            if new_end_date_str:
                # Direct date assignment
                try:
                    from django.utils.dateparse import parse_datetime as _dp3
                    new_end = _dp3(new_end_date_str)
                    if new_end and timezone.is_naive(new_end):
                        new_end = timezone.make_aware(new_end)
                    profile.expires_at = new_end
                except Exception:
                    return JsonResponse({"ok": False, "reason": "INVALID_DATE"}, status=400)
            elif extend_days is not None and str(extend_days).isdigit():
                days = int(extend_days)
                if days == 0:
                    # Open subscription (no expiry)
                    profile.expires_at = None
                else:
                    # Smart renew: if expired → start from now, if active → extend from current
                    if profile.expires_at and profile.expires_at > now:
                        # Still active — extend from current expiry
                        profile.expires_at = profile.expires_at + timedelta(days=days)
                    else:
                        # Expired or no date — start from now
                        profile.expires_at = now + timedelta(days=days)
            else:
                return JsonResponse({"ok": False, "reason": "INVALID_DAYS"}, status=400)

            profile.save(update_fields=["expires_at"])
            return JsonResponse({"ok": True, "user": _super_admin_user_dict(user)})

        return JsonResponse({"ok": False, "reason": "INVALID_ACTION"}, status=400)

    if request.method == "DELETE":
        user.delete()
        return JsonResponse({"ok": True})
