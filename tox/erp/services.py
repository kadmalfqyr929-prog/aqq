import os
import re
import sys
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

if __name__ == "__main__" and __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "erp"

if not os.environ.get("DJANGO_SETTINGS_MODULE"):
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "toxerp.settings")
    import django
    from django.apps import apps

    if not apps.ready and not getattr(apps, "loading", False):
        django.setup()

from django.db import IntegrityError, transaction
from django.db.models import F, Q, Sum
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.contrib.auth.models import User

from .models import (
    AccountMovement,
    AppSnapshot,
    AuditLog,
    Client,
    ClientPayment,
    CurrencyRate,
    Employee,
    Expense,
    Installment,
    Invoice,
    InvoiceItem,
    LedgerEntry,
    LoginEvent,
    Product,
    ProductUnit,
    Purchase,
    PurchaseItem,
    ReturnDocument,
    ReturnItem,
    StockBatch,
    StockMovement,
    Supplier,
    SupplierPayment,
    UserProfile,
    Warehouse,
)


class FinanceServiceError(ValueError):
    def __init__(self, reason, message=None, details=None):
        self.reason = reason
        self.details = details or {}
        super().__init__(message or reason)


def decimal_or_zero(value, default="0"):
    try:
        return Decimal(str(value if value not in (None, "") else default))
    except Exception:
        return Decimal(default)


def date_or_none(value):
    if not value:
        return None
    if hasattr(value, "date") and hasattr(value, "isoformat"):
        value = value.date()
    if hasattr(value, "isoformat"):
        year = getattr(value, "year", None)
        if year is not None and not 1900 <= year <= 2100:
            raise ValidationError("Date is outside the supported range")
        return value
    text = str(value).strip()
    parsed = parse_date(text)
    if parsed is None:
        parsed_datetime = parse_datetime(text)
        if parsed_datetime is not None:
            if timezone.is_aware(parsed_datetime):
                parsed_datetime = timezone.localtime(parsed_datetime)
            parsed = parsed_datetime.date()
    if parsed is None:
        raise ValidationError("Invalid date value")
    if not 1900 <= parsed.year <= 2100:
        raise ValidationError("Date is outside the supported range")
    return parsed


def datetime_or_now(value=None):
    if not value:
        return timezone.now()
    if hasattr(value, "isoformat"):
        return value
    return parse_datetime(str(value)) or timezone.now()


MONEY_PRECISION = Decimal("0.0001")
MONEY_TOLERANCE = Decimal("0.0001")
WHOLE_MONEY_PRECISION = Decimal("1")


def _money(value):
    return decimal_or_zero(value).quantize(MONEY_PRECISION, rounding=ROUND_HALF_UP)


def _whole_money(value):
    return decimal_or_zero(value).quantize(WHOLE_MONEY_PRECISION, rounding=ROUND_HALF_UP)


def _line_currency(line, *, purchase=False):
    keys = ("unitCostCurrency", "costCurrency", "currency") if purchase else ("priceCurrency", "currency")
    for key in keys:
        value = str(line.get(key) or "").strip().upper()
        if value:
            return value
    return "USD"


def _line_exchange_rate(line):
    rate = decimal_or_zero(line.get("exchangeRate") or line.get("rate"), "1460")
    return rate if rate > 0 else Decimal("1460")


def _payload_currency(payload):
    return str(payload.get("currency") or "USD").strip().upper()


def _payload_exchange_rate(payload):
    rate = decimal_or_zero(payload.get("exchangeRate") or payload.get("rate"), "1460")
    return rate if rate > 0 else Decimal("1460")


def _line_with_payload_defaults(line, payload):
    if not isinstance(line, dict):
        return line
    item = dict(line)
    if item.get("exchangeRate") in (None, "") and item.get("rate") in (None, ""):
        item["exchangeRate"] = payload.get("exchangeRate") or payload.get("rate") or "1460"
    if item.get("currency") in (None, ""):
        currency = payload.get("currency")
        if currency:
            item["currency"] = currency
    return item


def _payload_items_with_line_defaults(payload):
    return [_line_with_payload_defaults(item, payload) for item in payload.get("items") or []]


def _round_payload_money_usd(value, payload):
    value = _money(value)
    if _payload_currency(payload) == "IQD":
        return _money(_whole_money(value * _payload_exchange_rate(payload)) / _payload_exchange_rate(payload))
    return _money(_whole_money(value))


def _amount_to_usd_from_line(line, amount, *, purchase=False):
    amount = _whole_money(amount)
    currency = _line_currency(line, purchase=purchase)
    if currency == "IQD":
        return _money(amount / _line_exchange_rate(line))
    return _money(amount)


def _line_original_amount(line, keys):
    for key in keys:
        if line.get(key) not in (None, ""):
            return line.get(key)
    return None


def _line_quantity(line):
    return _money(line.get("qty") if "qty" in line else line.get("quantity"))


def _line_price(line, *, purchase=False):
    if purchase:
        original = _line_original_amount(line, ("unitCost", "cost", "price"))
        if original is not None:
            return _amount_to_usd_from_line(line, original, purchase=True)
        return _money(line.get("unitCostUsd") if "unitCostUsd" in line else line.get("priceUsd"))
    original = _line_original_amount(line, ("price", "unitPrice"))
    if original is not None:
        return _amount_to_usd_from_line(line, original)
    return _money(line.get("priceUsd"))


def _line_total(line, *, purchase=False):
    original_total = _line_original_amount(line, ("lineTotal", "total", "amount"))
    if original_total is not None:
        return _amount_to_usd_from_line(line, original_total, purchase=purchase)
    gross = _money(_line_quantity(line) * _line_price(line, purchase=purchase))
    discount = Decimal("0.0000")
    if line.get("lineDiscountUsd") is not None:
        discount = _money(line.get("lineDiscountUsd"))
    elif line.get("discountUsd") is not None:
        discount = _money(line.get("discountUsd"))
    elif line.get("lineDiscountPercent") is not None:
        percent = max(Decimal("0.0000"), min(decimal_or_zero(line.get("lineDiscountPercent")), Decimal("100")))
        discount = _money(gross * percent / Decimal("100"))
    return _money(max(Decimal("0.0000"), gross - discount))


def _assert_money_matches(provided, expected, reason):
    if provided is None:
        return
    provided_money = _money(provided)
    expected_money = _money(expected)
    difference = _money(provided_money - expected_money)
    if abs(difference) > MONEY_TOLERANCE:
        raise FinanceServiceError(
            reason,
            details={
                "providedUsd": float(provided_money),
                "expectedUsd": float(expected_money),
                "differenceUsd": float(difference),
            },
        )


def _timestamp_id(prefix):
    return f"{prefix}-{int(timezone.now().timestamp() * 1000000)}"


def _document_id(prefix, model, when=None):
    local_time = timezone.localtime(when or timezone.now())
    marker = f"{prefix}-{local_time:%Y%m%d}-"
    max_number = 0
    for external_id in model.objects.filter(external_id__startswith=marker).values_list("external_id", flat=True):
        suffix = str(external_id)[len(marker):]
        if suffix.isdigit():
            max_number = max(max_number, int(suffix))
    next_number = max_number + 1
    candidate = f"{marker}{next_number:04d}"
    while model.objects.filter(external_id=candidate).exists():
        next_number += 1
        candidate = f"{marker}{next_number:04d}"
    return candidate


def _payment_status(total, paid):
    total = _money(total)
    paid = _money(paid)
    remaining = max(Decimal("0.0000"), total - paid)
    if total <= 0 or remaining <= Decimal("0.0001"):
        return "paid", Decimal("0.0000")
    if paid > 0:
        return "partial", remaining
    return "unpaid", remaining


def _invoice_kind(payload):
    raw = str(payload.get("kind") or payload.get("type") or "").strip().lower().replace("-", "_")
    if (payload.get("installmentPlan") or {}).get("type") == "installment":
        return "installment"
    if raw in {"direct_pos", "pos", "directpos", "quick_sale", "quick"}:
        return "direct_pos"
    return "invoice"


def _opening_signed_usd(amount, balance_type):
    value = abs(_money(amount))
    if value <= 0:
        return Decimal("0.0000")
    return -value if (balance_type or "debit") in {"credit", "advance"} else value


def _active_rate():
    return decimal_or_zero(
        CurrencyRate.objects.filter(is_active=True).order_by("-created_at").values_list("rate", flat=True).first(),
        "1460",
    )


def _entity_kwargs(entity_type, entity):
    if entity_type == LedgerEntry.ENTITY_CUSTOMER:
        return {"customer": entity, "supplier": None}
    if entity_type == LedgerEntry.ENTITY_SUPPLIER:
        return {"customer": None, "supplier": entity}
    raise FinanceServiceError("INVALID_ENTITY")


def record_ledger_entry(
    *,
    entity_type,
    entity,
    amount_usd,
    entry_type,
    reference_id,
    reference_model="",
    timestamp=None,
    invoice=None,
    purchase=None,
    payment=None,
    supplier_payment=None,
    installment=None,
    reversed_entry=None,
    metadata=None,
):
    amount = _money(amount_usd)
    if amount == 0:
        return None
    entity_id = entity.external_id
    defaults = {
        **_entity_kwargs(entity_type, entity),
        "amount_usd": amount,
        "reference_model": reference_model or "",
        "invoice": invoice,
        "purchase": purchase,
        "payment": payment,
        "supplier_payment": supplier_payment,
        "installment": installment,
        "reversed_entry": reversed_entry,
        "metadata": metadata or {},
        "timestamp": timestamp or timezone.now(),
    }
    try:
        entry, created = LedgerEntry.objects.get_or_create(
            entity_type=entity_type,
            entity_id=entity_id,
            type=entry_type,
            reference_id=reference_id,
            defaults=defaults,
        )
    except IntegrityError:
        entry = LedgerEntry.objects.get(
            entity_type=entity_type,
            entity_id=entity_id,
            type=entry_type,
            reference_id=reference_id,
        )
        created = False
    if not created and entry.amount_usd != amount:
        raise FinanceServiceError("LEDGER_REFERENCE_CONFLICT")
    return entry


def reverse_ledger_entry_service(entry_id, reason=""):
    original = LedgerEntry.objects.get(pk=entry_id)
    entity = original.customer if original.entity_type == LedgerEntry.ENTITY_CUSTOMER else original.supplier
    return record_ledger_entry(
        entity_type=original.entity_type,
        entity=entity,
        amount_usd=-original.amount_usd,
        entry_type=LedgerEntry.TYPE_DEBT_ADJUSTMENT,
        reference_id=f"reversal-{original.id}",
        reference_model="ledger_reversal",
        reversed_entry=original,
        metadata={"reason": reason or "", "reverses": original.id, "reversedReferenceId": original.reference_id},
    )


def calculate_entity_balance(entity_type, entity_or_external_id):
    entity_id = getattr(entity_or_external_id, "external_id", entity_or_external_id)
    total = LedgerEntry.objects.filter(entity_type=entity_type, entity_id=entity_id).aggregate(total=Sum("amount_usd"))["total"]
    return _money(total or 0)


def entity_balance_map(entity_type, entity_ids):
    ids = [str(entity_id) for entity_id in entity_ids if entity_id]
    if not ids:
        return {}
    rows = (
        LedgerEntry.objects
        .filter(entity_type=entity_type, entity_id__in=ids)
        .values("entity_id")
        .annotate(total=Sum("amount_usd"))
    )
    return {row["entity_id"]: _money(row["total"] or 0) for row in rows}


def calculate_customer_balance(customer_or_external_id):
    return calculate_entity_balance(LedgerEntry.ENTITY_CUSTOMER, customer_or_external_id)


def calculate_supplier_balance(supplier_or_external_id):
    return calculate_entity_balance(LedgerEntry.ENTITY_SUPPLIER, supplier_or_external_id)


def balance_iqd(amount_usd):
    return _money(amount_usd) * _active_rate()


def list_customers_service():
    return Client.objects.active().order_by("-id")


def list_suppliers_service():
    return Supplier.objects.active().order_by("-id")


def get_customer_service(external_id):
    return Client.objects.filter(external_id=external_id).first()


def get_supplier_service(external_id):
    return Supplier.objects.filter(external_id=external_id).first()


def create_customer_service(payload):
    with transaction.atomic():
        external_id = payload.get("id") or payload.get("externalId") or _timestamp_id("c")
        if Client.objects.filter(external_id=external_id).exists():
            raise FinanceServiceError("CUSTOMER_EXISTS")
        customer = Client.objects.create(
            external_id=external_id,
            name=payload.get("name") or "زبون",
            phone=payload.get("phone") or "",
            address=payload.get("address") or "",
            image=payload.get("image") or payload.get("imageUrl") or "",
            debt_limit_usd=_money(payload.get("debtLimitUsd")),
            opening_balance_usd=abs(_money(payload.get("openingBalanceUsd"))),
            opening_balance_type=payload.get("openingBalanceType") or "debit",
            financial_note=payload.get("financialNote") or "",
            loyalty_points=int(payload.get("loyaltyPoints") or 0),
            note=payload.get("note") or "",
        )
        opening = _opening_signed_usd(customer.opening_balance_usd, customer.opening_balance_type)
        if opening:
            record_ledger_entry(
                entity_type=LedgerEntry.ENTITY_CUSTOMER,
                entity=customer,
                amount_usd=opening,
                entry_type=LedgerEntry.TYPE_DEBT_ADJUSTMENT,
                reference_id=f"customer-opening-{customer.external_id}",
                reference_model="customer",
                timestamp=customer.created_at,
                metadata={"openingBalanceType": customer.opening_balance_type, "note": customer.financial_note},
            )
        return customer


def update_customer_service(customer, payload):
    with transaction.atomic():
        before = _opening_signed_usd(customer.opening_balance_usd, customer.opening_balance_type)
        for field in ("name", "phone", "address", "image", "note"):
            if field in payload:
                setattr(customer, field, payload.get(field) or "")
        if "imageUrl" in payload:
            customer.image = payload.get("imageUrl") or ""
        if "debtLimitUsd" in payload:
            customer.debt_limit_usd = _money(payload.get("debtLimitUsd"))
        if "openingBalanceUsd" in payload:
            customer.opening_balance_usd = abs(_money(payload.get("openingBalanceUsd")))
        if "openingBalanceType" in payload:
            customer.opening_balance_type = payload.get("openingBalanceType") or "debit"
        if "financialNote" in payload:
            customer.financial_note = payload.get("financialNote") or ""
        if "loyaltyPoints" in payload:
            customer.loyalty_points = int(payload.get("loyaltyPoints") or 0)
        customer.save()
        after = _opening_signed_usd(customer.opening_balance_usd, customer.opening_balance_type)
        delta = _money(after - before)
        if delta:
            record_ledger_entry(
                entity_type=LedgerEntry.ENTITY_CUSTOMER,
                entity=customer,
                amount_usd=delta,
                entry_type=LedgerEntry.TYPE_DEBT_ADJUSTMENT,
                reference_id=_timestamp_id(f"customer-opening-adjust-{customer.external_id}"),
                reference_model="customer",
                metadata={"openingBalanceType": customer.opening_balance_type, "note": customer.financial_note},
            )
        return customer


def update_customer_service_by_id(external_id, payload):
    customer = get_customer_service(external_id)
    if not customer:
        raise FinanceServiceError("NO_CUSTOMER")
    return update_customer_service(customer, payload)


def archive_customer_service(external_id):
    customer = get_customer_service(external_id)
    if not customer:
        raise FinanceServiceError("NO_CUSTOMER")
    if calculate_customer_balance(customer) > Decimal("0.0001"):
        raise FinanceServiceError("CUSTOMER_HAS_DEBT")
    active_installments = Installment.objects.filter(client=customer).filter(
        ~Q(invoice__payment_status="paid")
    ).exists()
    if active_installments:
        raise FinanceServiceError("CUSTOMER_HAS_ACTIVE_INSTALLMENTS")
    customer.archive()
    return customer


def sync_customer_service(payload):
    customer = Client.objects.filter(external_id=payload.get("id")).first()
    if customer:
        return update_customer_service(customer, payload)
    return create_customer_service(payload)


def create_supplier_service(payload):
    with transaction.atomic():
        external_id = payload.get("id") or payload.get("externalId") or _timestamp_id("s")
        if Supplier.objects.filter(external_id=external_id).exists():
            raise FinanceServiceError("SUPPLIER_EXISTS")
        supplier = Supplier.objects.create(
            external_id=external_id,
            name=payload.get("name") or "مورد",
            phone=payload.get("phone") or "",
            company_name=payload.get("companyName") or payload.get("company_name") or "",
            email=payload.get("email") or "",
            image=payload.get("image") or payload.get("imageUrl") or "",
            city=payload.get("city") or "",
            opening_balance_usd=abs(_money(payload.get("openingBalanceUsd"))),
            opening_balance_type=payload.get("openingBalanceType") or "debit",
            financial_note=payload.get("financialNote") or "",
            note=payload.get("note") or "",
        )
        opening = _opening_signed_usd(supplier.opening_balance_usd, supplier.opening_balance_type)
        if opening:
            record_ledger_entry(
                entity_type=LedgerEntry.ENTITY_SUPPLIER,
                entity=supplier,
                amount_usd=opening,
                entry_type=LedgerEntry.TYPE_DEBT_ADJUSTMENT,
                reference_id=f"supplier-opening-{supplier.external_id}",
                reference_model="supplier",
                timestamp=supplier.created_at,
                metadata={"openingBalanceType": supplier.opening_balance_type, "note": supplier.financial_note},
            )
        return supplier


def update_supplier_service(supplier, payload):
    with transaction.atomic():
        before = _opening_signed_usd(supplier.opening_balance_usd, supplier.opening_balance_type)
        for field in ("name", "phone", "city", "email", "image", "note"):
            if field in payload:
                setattr(supplier, field, payload.get(field) or "")
        if "companyName" in payload:
            supplier.company_name = payload.get("companyName") or ""
        if "company_name" in payload:
            supplier.company_name = payload.get("company_name") or ""
        if "imageUrl" in payload:
            supplier.image = payload.get("imageUrl") or ""
        if "openingBalanceUsd" in payload:
            supplier.opening_balance_usd = abs(_money(payload.get("openingBalanceUsd")))
        if "openingBalanceType" in payload:
            supplier.opening_balance_type = payload.get("openingBalanceType") or "debit"
        if "financialNote" in payload:
            supplier.financial_note = payload.get("financialNote") or ""
        supplier.save()
        after = _opening_signed_usd(supplier.opening_balance_usd, supplier.opening_balance_type)
        delta = _money(after - before)
        if delta:
            record_ledger_entry(
                entity_type=LedgerEntry.ENTITY_SUPPLIER,
                entity=supplier,
                amount_usd=delta,
                entry_type=LedgerEntry.TYPE_DEBT_ADJUSTMENT,
                reference_id=_timestamp_id(f"supplier-opening-adjust-{supplier.external_id}"),
                reference_model="supplier",
                metadata={"openingBalanceType": supplier.opening_balance_type, "note": supplier.financial_note},
            )
        return supplier


def update_supplier_service_by_id(external_id, payload):
    supplier = get_supplier_service(external_id)
    if not supplier:
        raise FinanceServiceError("NO_SUPPLIER")
    return update_supplier_service(supplier, payload)


def archive_supplier_service(external_id):
    supplier = get_supplier_service(external_id)
    if not supplier:
        raise FinanceServiceError("NO_SUPPLIER")
    if calculate_supplier_balance(supplier) > Decimal("0.0001"):
        raise FinanceServiceError("SUPPLIER_HAS_DEBT")
    supplier.archive()
    return supplier


def sync_supplier_service(payload):
    supplier = Supplier.objects.filter(external_id=payload.get("id")).first()
    if supplier:
        return update_supplier_service(supplier, payload)
    return create_supplier_service(payload)


def _invoice_totals(payload):
    items = _payload_items_with_line_defaults(payload)
    if not items:
        raise FinanceServiceError("EMPTY_INVOICE")
    subtotal = _money(sum(_line_total(item) for item in items))
    _assert_money_matches(payload.get("subtotalUsd"), subtotal, "SUBTOTAL_MISMATCH")
    discount = _money(payload.get("discountUsd"))
    total = _money(max(Decimal("0.0000"), subtotal - discount))
    _assert_money_matches(payload.get("totalUsd"), total, "TOTAL_MISMATCH")
    if _invoice_kind(payload) == "direct_pos":
        paid = total
    else:
        paid = min(max(_money(payload.get("paidUsd")), Decimal("0.0000")), total)
    status, remaining = _payment_status(total, paid)
    return subtotal, discount, paid, total, remaining, status


def _line_error(reason, line, index=None, product=None, **extra):
    details = {
        "lineIndex": index,
        "productId": line.get("productId"),
        "unitId": line.get("unitId") or line.get("unit"),
        "unitName": line.get("unitName") or "",
        "productName": getattr(product, "name", ""),
    }
    details.update({key: value for key, value in extra.items() if value not in (None, "")})
    raise FinanceServiceError(reason, details=details)


def _line_expected_multiplier(line):
    quantity = _line_quantity(line)
    qty_in_base = decimal_or_zero(line.get("qtyInBase"))
    if quantity <= 0 or qty_in_base <= 0:
        return None
    return _money(qty_in_base / quantity)


def _ensure_product_base_unit(product, line=None):
    if hasattr(product, "_active_units_cache"):
        active_units = product._active_units_cache
    else:
        prefetched = getattr(product, "_prefetched_objects_cache", {}).get("units")
        source = prefetched if prefetched is not None else product.units.all()
        active_units = [unit for unit in source if unit.deleted_at is None]
        product._active_units_cache = active_units
    if active_units:
        return active_units
    price = _line_price(line or {}) if line else Decimal("0.0000")
    unit, _ = ProductUnit.objects.update_or_create(
        product=product,
        external_id=f"{product.external_id}-unit",
        defaults={
            "name": product.base_unit or "قطعة",
            "multiplier": Decimal("1.0000"),
            "price_usd": price,
            "price_currency": product.currency or "IQD",
            "barcode": "",
            "deleted_at": None,
        },
    )
    product._active_units_cache = [unit]
    return product._active_units_cache


def _resolve_line_unit(product, line, index=None):
    units = _ensure_product_base_unit(product, line)
    unit_id = str(line.get("unitId") or line.get("unit") or "").strip()
    if unit_id:
        exact = next((unit for unit in units if unit.external_id == unit_id), None)
        if exact:
            return exact

    expected_multiplier = _line_expected_multiplier(line)
    unit_name = str(line.get("unitName") or "").strip()
    if unit_name:
        name_matches = [unit for unit in units if unit.name == unit_name]
        if expected_multiplier is not None:
            both = [unit for unit in name_matches if _money(unit.multiplier) == expected_multiplier]
            if len(both) == 1:
                return both[0]
        if len(name_matches) == 1:
            return name_matches[0]

    if expected_multiplier is not None:
        multiplier_matches = [unit for unit in units if _money(unit.multiplier) == expected_multiplier]
        if len(multiplier_matches) == 1:
            return multiplier_matches[0]

    if len(units) == 1:
        return units[0]
    _line_error("NO_UNIT", line, index, product, availableUnits=[unit.external_id for unit in units])


def _line_product_and_unit(line, *, product_map=None, warehouse_map=None, index=None):
    product_id = line.get("productId")
    product = product_map.get(product_id) if product_map is not None else None
    if product_map is None:
        product = Product.objects.select_for_update().filter(external_id=product_id, deleted_at__isnull=True).first()
    if not product:
        _line_error("NO_PRODUCT", line, index)
    unit = _resolve_line_unit(product, line, index)
    warehouse_id = line.get("warehouseId") or getattr(product.warehouse, "external_id", "")
    warehouse = warehouse_map.get(warehouse_id) if warehouse_map is not None else None
    if warehouse_map is None:
        warehouse = Warehouse.objects.filter(
            external_id=warehouse_id,
            deleted_at__isnull=True,
        ).first()
    warehouse = warehouse or product.warehouse
    return product, unit, warehouse


def _validate_line_quantity(line, unit):
    quantity = _line_quantity(line)
    if quantity <= 0:
        raise FinanceServiceError("INVALID_QUANTITY")
    unit_text = str(getattr(unit, "name", "") or "").lower()
    measurable = re.search(r"kg|كغم|كيلو|gram|غرام|liter|لتر|ml|مليلتر|meter|متر|cm|سم|وزن|سائل", unit_text)
    if not measurable and quantity != quantity.to_integral_value():
        raise FinanceServiceError("INVALID_WHOLE_QUANTITY", "هذه الوحدة تباع بعدد صحيح فقط")
    qty_in_base = _money(quantity * decimal_or_zero(unit.multiplier, "1"))
    _assert_money_matches(line.get("qtyInBase"), qty_in_base, "QTY_BASE_MISMATCH")
    return quantity, qty_in_base


def _storage_delta(product, qty_in_base):
    multiplier = decimal_or_zero(product.stock_unit_multiplier, "1")
    if multiplier <= 0:
        raise FinanceServiceError("INVALID_STOCK_UNIT")
    return _money(qty_in_base / multiplier)


def _batch_unit_cost(total_usd, storage_quantity):
    storage_quantity = _money(storage_quantity)
    if storage_quantity <= 0:
        raise FinanceServiceError("INVALID_STOCK_UNIT")
    return _money(_money(total_usd) / storage_quantity)


def _purchase_batch_code(purchase, index):
    return f"{purchase.external_id}-{index + 1}"


def _purchase_line_batch_code(purchase, item, index):
    return str(item.batch_code or "").strip() or _purchase_batch_code(purchase, index)


def create_opening_stock_batch(product, *, quantity=None, unit_cost_usd=None, warehouse=None, batch_code=None, received_at=None):
    quantity = _money(product.stock_quantity if quantity is None else quantity)
    unit_cost_usd = _money(product.purchase_cost_usd if unit_cost_usd is None else unit_cost_usd)
    if quantity <= 0:
        return None
    if unit_cost_usd <= 0:
        raise FinanceServiceError("PURCHASE_COST_REQUIRED")
    return StockBatch.objects.create(
        product=product,
        warehouse=warehouse or product.warehouse,
        batch_code=batch_code or f"OPENING-{product.external_id}",
        quantity=quantity,
        purchase_cost_usd=unit_cost_usd,
        expiry_date=product.expires_at,
        received_at=received_at or product.created_at or timezone.now(),
        is_closed=False,
    )


def _open_stock_batch_total(product, warehouse=None):
    warehouse = warehouse or product.warehouse
    total = (
        StockBatch.objects.filter(
            product=product,
            warehouse=warehouse,
            quantity__gt=0,
            is_closed=False,
        ).aggregate(total=Sum("quantity"))["total"]
        or Decimal("0.0000")
    )
    return _money(total)


def _stock_cost_adjustment_batch_code(product, prefix):
    stamp = timezone.now().strftime("%Y%m%d%H%M%S%f")
    return f"{prefix}-{product.external_id}-{stamp}"


def _cost_source_for_batch_code(batch_code):
    code = str(batch_code or "").upper()
    if code.startswith("COST-AUTO-") or code.startswith("COST-REPAIR-"):
        return "repaired_from_purchase_cost"
    return "fifo_ok"


def _cost_breakdown_marker(source, *, quantity, unit_cost_usd, cost_usd, reason="", product=None):
    marker = {
        "source": source,
        "quantity": float(_money(quantity)),
        "unitCostUsd": float(_money(unit_cost_usd)),
        "costUsd": float(_money(cost_usd)),
    }
    if reason:
        marker["reason"] = reason
    if product:
        marker["productId"] = product.external_id
        marker["productName"] = product.name
    return marker


def _create_stock_cost_adjustment_batch(product, *, quantity, warehouse=None, prefix="COST-AUTO"):
    quantity = _money(quantity)
    unit_cost_usd = _money(product.purchase_cost_usd)
    if quantity <= MONEY_TOLERANCE:
        return None
    if unit_cost_usd <= 0:
        raise FinanceServiceError(
            "MISSING_PURCHASE_COST",
            details={
                "productId": product.external_id,
                "productName": product.name,
            },
        )
    return StockBatch.objects.create(
        product=product,
        warehouse=warehouse or product.warehouse,
        batch_code=_stock_cost_adjustment_batch_code(product, prefix),
        quantity=quantity,
        purchase_cost_usd=unit_cost_usd,
        expiry_date=product.expires_at,
        received_at=timezone.now(),
        is_closed=False,
    )


def _ensure_fifo_cost_batches(product, warehouse, required_quantity, available_quantity):
    required_quantity = _money(required_quantity)
    available_quantity = _money(available_quantity)
    if available_quantity + MONEY_TOLERANCE >= required_quantity:
        return None

    current_stock = _money(
        Product.objects.filter(pk=product.pk).values_list("stock_quantity", flat=True).first()
        or Decimal("0.0000")
    )
    if current_stock + MONEY_TOLERANCE < required_quantity:
        raise FinanceServiceError(
            "INSUFFICIENT_STOCK",
            details={
                "productId": product.external_id,
                "productName": product.name,
                "requiredQuantity": float(required_quantity),
                "availableQuantity": float(current_stock),
            },
        )
    if _money(product.purchase_cost_usd) <= 0:
        raise FinanceServiceError(
            "MISSING_PURCHASE_COST",
            details={
                "productId": product.external_id,
                "productName": product.name,
                "requiredQuantity": float(required_quantity),
                "availableCostBatchQuantity": float(available_quantity),
            },
        )

    # Repair the full product/batch gap so the next sale does not hit the same
    # missing-cost condition again.
    missing_quantity = _money(current_stock - available_quantity)
    return _create_stock_cost_adjustment_batch(
        product,
        warehouse=warehouse,
        quantity=missing_quantity,
        prefix="COST-AUTO",
    )


def repair_stock_cost_batches(*, dry_run=False, product_id=None):
    products = Product.objects.active().select_related("warehouse").filter(stock_quantity__gt=0).order_by("name", "id")
    if product_id:
        products = products.filter(external_id=product_id)

    result = {
        "scanned": 0,
        "repaired": 0,
        "skipped": 0,
        "missingCost": 0,
        "dryRun": bool(dry_run),
        "items": [],
    }

    for product in products:
        result["scanned"] += 1
        batch_total = _open_stock_batch_total(product, product.warehouse)
        missing_quantity = _money(product.stock_quantity - batch_total)
        if missing_quantity <= MONEY_TOLERANCE:
            result["skipped"] += 1
            continue

        item = {
            "productId": product.external_id,
            "productName": product.name,
            "stockQuantity": float(_money(product.stock_quantity)),
            "batchQuantity": float(batch_total),
            "missingQuantity": float(missing_quantity),
            "purchaseCostUsd": float(_money(product.purchase_cost_usd)),
        }
        result["items"].append(item)

        if _money(product.purchase_cost_usd) <= 0:
            result["missingCost"] += 1
            result["skipped"] += 1
            item["status"] = "missing_purchase_cost"
            continue

        result["repaired"] += 1
        item["status"] = "dry_run" if dry_run else "repaired"
        if dry_run:
            continue

        _create_stock_cost_adjustment_batch(
            product,
            warehouse=product.warehouse,
            quantity=missing_quantity,
            prefix="COST-REPAIR",
        )

    return result


def _create_purchase_stock_batch(purchase, item, *, index, delta, total_usd):
    if delta <= 0:
        return None
    unit_cost_usd = _money(item.storage_unit_cost_usd) if item.storage_unit_cost_usd and item.storage_unit_cost_usd > 0 else _batch_unit_cost(total_usd, delta)
    warehouse = item.warehouse or item.product.warehouse
    received_at = item.received_at or purchase.created_at or timezone.now()
    expiry_date = date_or_none(item.expires_at) if item.expires_at else None
    batch = StockBatch.objects.create(
        product=item.product,
        warehouse=warehouse,
        batch_code=_purchase_line_batch_code(purchase, item, index),
        quantity=delta,
        purchase_cost_usd=unit_cost_usd,
        expiry_date=expiry_date,
        received_at=received_at,
        is_closed=False,
    )
    Product.objects.filter(pk=item.product_id).update(purchase_cost_usd=unit_cost_usd)
    item.product.purchase_cost_usd = unit_cost_usd
    return batch


def _consume_fifo_cost(product, warehouse, storage_quantity):
    remaining = _money(storage_quantity)
    if remaining <= 0:
        return Decimal("0.0000"), []
    warehouse = warehouse or product.warehouse

    def cost_batches():
        return list(
            StockBatch.objects.select_for_update().filter(
                product=product,
                warehouse=warehouse,
                quantity__gt=0,
                is_closed=False,
            ).order_by(F("expiry_date").asc(nulls_last=True), "received_at", "id")
        )

    batches = cost_batches()
    total_available = _money(sum(_money(batch.quantity) for batch in batches))
    if total_available + MONEY_TOLERANCE < remaining:
        _ensure_fifo_cost_batches(product, warehouse, remaining, total_available)
        batches = cost_batches()
        total_available = _money(sum(_money(batch.quantity) for batch in batches))
    if total_available + MONEY_TOLERANCE < remaining:
        raise FinanceServiceError(
            "INSUFFICIENT_COST_BATCH",
            details={
                "productId": product.external_id,
                "productName": product.name,
                "requiredQuantity": float(remaining),
                "availableQuantity": float(total_available),
            },
        )

    total_cost = Decimal("0.0000")
    breakdown = []
    for batch in batches:
        if remaining <= 0:
            break
        available = _money(batch.quantity)
        take = min(available, remaining)
        if take <= 0:
            continue
        line_cost = _money(take * _money(batch.purchase_cost_usd))
        batch.quantity = _money(available - take)
        batch.is_closed = batch.quantity <= MONEY_TOLERANCE
        batch.save(update_fields=["quantity", "is_closed"])
        breakdown.append({
            "batchId": batch.id,
            "batchCode": batch.batch_code or str(batch.id),
            "source": _cost_source_for_batch_code(batch.batch_code),
            "quantity": float(take),
            "unitCostUsd": float(_money(batch.purchase_cost_usd)),
            "costUsd": float(line_cost),
        })
        total_cost = _money(total_cost + line_cost)
        remaining = _money(remaining - take)

    if remaining > MONEY_TOLERANCE:
        raise FinanceServiceError("INSUFFICIENT_COST_BATCH")
    return total_cost, breakdown


def _preview_fifo_cost(product, warehouse, storage_quantity):
    remaining = _money(storage_quantity)
    if remaining <= 0:
        return Decimal("0.0000"), []
    warehouse = warehouse or product.warehouse
    batches = list(
        StockBatch.objects.filter(
            product=product,
            warehouse=warehouse,
            quantity__gt=0,
            is_closed=False,
        ).order_by(F("expiry_date").asc(nulls_last=True), "received_at", "id")
    )
    total_available = _money(sum(_money(batch.quantity) for batch in batches))
    if total_available + MONEY_TOLERANCE < remaining:
        return None
    total_cost = Decimal("0.0000")
    breakdown = []
    for batch in batches:
        if remaining <= 0:
            break
        take = min(_money(batch.quantity), remaining)
        if take <= 0:
            continue
        line_cost = _money(take * _money(batch.purchase_cost_usd))
        breakdown.append({
            "batchId": batch.id,
            "batchCode": batch.batch_code or str(batch.id),
            "source": _cost_source_for_batch_code(batch.batch_code),
            "quantity": float(take),
            "unitCostUsd": float(_money(batch.purchase_cost_usd)),
            "costUsd": float(line_cost),
        })
        total_cost = _money(total_cost + line_cost)
        remaining = _money(remaining - take)
    if remaining > MONEY_TOLERANCE:
        return None
    return total_cost, breakdown


def _restore_fifo_cost_breakdown(item):
    for entry in item.cost_breakdown or []:
        batch_id = entry.get("batchId")
        quantity = _money(entry.get("quantity"))
        if not batch_id or quantity <= 0:
            continue
        updated = StockBatch.objects.filter(pk=batch_id).update(
            quantity=F("quantity") + quantity,
            is_closed=False,
        )
        if not updated and item.product_id:
            StockBatch.objects.create(
                product=item.product,
                warehouse=item.warehouse or item.product.warehouse,
                batch_code=str(entry.get("batchCode") or f"RESTORE-{item.invoice.external_id}"),
                quantity=quantity,
                purchase_cost_usd=_money(entry.get("unitCostUsd")),
                received_at=timezone.now(),
                is_closed=False,
            )


def _load_line_context(items):
    product_ids = {line.get("productId") for line in items if isinstance(line, dict) and line.get("productId")}
    warehouse_ids = {line.get("warehouseId") for line in items if isinstance(line, dict) and line.get("warehouseId")}
    products = (
        Product.objects.select_for_update()
        .filter(external_id__in=product_ids, deleted_at__isnull=True)
        .select_related("warehouse")
        .prefetch_related("units")
    )
    warehouses = Warehouse.objects.filter(external_id__in=warehouse_ids, deleted_at__isnull=True)
    return {
        "products": {product.external_id: product for product in products},
        "warehouses": {warehouse.external_id: warehouse for warehouse in warehouses},
    }


def _create_invoice_items(invoice, items):
    context = _load_line_context(items)
    for index, line in enumerate(items):
        product, unit, warehouse = _line_product_and_unit(
            line,
            product_map=context["products"],
            warehouse_map=context["warehouses"],
            index=index,
        )
        quantity, qty_in_base = _validate_line_quantity(line, unit)
        price_usd = _line_price(line)
        total_usd = _line_total(line)
        _assert_money_matches(line.get("totalUsd"), total_usd, "LINE_TOTAL_MISMATCH")
        delta = _storage_delta(product, qty_in_base)
        current_stock = _money(
            Product.objects.filter(pk=product.pk).values_list("stock_quantity", flat=True).first()
            or Decimal("0.0000")
        )
        if current_stock + MONEY_TOLERANCE < delta:
            raise FinanceServiceError(
                "INSUFFICIENT_STOCK",
                details={
                    "productId": product.external_id,
                    "productName": product.name,
                    "requiredQuantity": float(delta),
                    "availableQuantity": float(current_stock),
                },
            )
        total_cost_usd, cost_breakdown = _consume_fifo_cost(product, warehouse, delta)
        updated = Product.objects.filter(pk=product.pk, stock_quantity__gte=delta).update(stock_quantity=F("stock_quantity") - delta)
        if not updated:
            raise FinanceServiceError(
                "INSUFFICIENT_STOCK",
                details={
                    "productId": product.external_id,
                    "productName": product.name,
                    "requiredQuantity": float(delta),
                    "availableQuantity": 0,
                },
            )
        unit_cost_usd = _money(total_cost_usd / quantity) if quantity > 0 else Decimal("0.0000")
        InvoiceItem.objects.create(
            invoice=invoice,
            product=product,
            warehouse=warehouse,
            unit_id=unit.external_id,
            unit_name=line.get("unitName") or unit.name,
            quantity=quantity,
            qty_in_base=qty_in_base,
            price_usd=price_usd,
            total_usd=total_usd,
            unit_cost_usd=unit_cost_usd,
            total_cost_usd=total_cost_usd,
            gross_profit_usd=_money(total_usd - total_cost_usd),
            cost_status="ok",
            cost_breakdown=cost_breakdown,
        )
        StockMovement.objects.create(
            product=product,
            warehouse=warehouse,
            movement_type="sale",
            quantity=-delta,
            note=f"Invoice {invoice.external_id}: {quantity} {unit.name}",
        )


def repair_missing_invoice_costs(*, dry_run=False, invoice_id=None):
    qs = (
        InvoiceItem.objects.select_related("invoice", "product")
        .filter(invoice__voided_at__isnull=True)
        .filter(Q(total_cost_usd__lte=0) | ~Q(cost_status="ok"))
        .order_by("invoice__created_at", "id")
    )
    if invoice_id:
        qs = qs.filter(invoice__external_id=invoice_id)

    result = {
        "scanned": 0,
        "repaired": 0,
        "fifoRepaired": 0,
        "estimatedRepaired": 0,
        "skipped": 0,
        "dryRun": bool(dry_run),
        "items": [],
    }
    for item in qs:
        result["scanned"] += 1
        product = item.product
        if not product or product.purchase_cost_usd <= 0 or item.quantity <= 0 or item.qty_in_base <= 0:
            result["skipped"] += 1
            continue
        try:
            storage_quantity = _storage_delta(product, item.qty_in_base)
        except FinanceServiceError:
            result["skipped"] += 1
            continue

        warehouse = item.warehouse or product.warehouse
        fifo_preview = _preview_fifo_cost(product, warehouse, storage_quantity)
        repair_source = "fifo_ok" if fifo_preview else "repaired_from_purchase_cost"
        if fifo_preview:
            total_cost, cost_breakdown = fifo_preview
        else:
            total_cost = _money(storage_quantity * product.purchase_cost_usd)
            cost_breakdown = [
                _cost_breakdown_marker(
                    "repaired_from_purchase_cost",
                    quantity=storage_quantity,
                    unit_cost_usd=product.purchase_cost_usd,
                    cost_usd=total_cost,
                    reason="invoice_cost_repair",
                    product=product,
                )
            ]
        if total_cost <= 0:
            result["skipped"] += 1
            continue
        unit_cost = _money(total_cost / item.quantity)
        gross_profit = _money(item.total_usd - total_cost)
        result["repaired"] += 1
        if repair_source == "fifo_ok":
            result["fifoRepaired"] += 1
        else:
            result["estimatedRepaired"] += 1
        result["items"].append({
            "invoiceId": item.invoice.external_id,
            "productId": product.external_id,
            "productName": product.name,
            "source": repair_source,
            "totalCostUsd": float(total_cost),
            "grossProfitUsd": float(gross_profit),
        })
        if dry_run:
            continue
        with transaction.atomic():
            if repair_source == "fifo_ok":
                total_cost, cost_breakdown = _consume_fifo_cost(product, warehouse, storage_quantity)
                unit_cost = _money(total_cost / item.quantity)
                gross_profit = _money(item.total_usd - total_cost)
                if not StockMovement.objects.filter(
                    product=product,
                    warehouse=warehouse,
                    movement_type="sale",
                    note__icontains=item.invoice.external_id,
                ).exists():
                    StockMovement.objects.create(
                        product=product,
                        warehouse=warehouse,
                        movement_type="sale",
                        quantity=-storage_quantity,
                        note=f"Invoice {item.invoice.external_id}: repaired FIFO cost",
                    )
            item.unit_cost_usd = unit_cost
            item.total_cost_usd = total_cost
            item.gross_profit_usd = gross_profit
            item.cost_status = "ok"
            item.cost_breakdown = cost_breakdown
            item.save(
                update_fields=[
                    "unit_cost_usd",
                    "total_cost_usd",
                    "gross_profit_usd",
                    "cost_status",
                    "cost_breakdown",
                ]
            )
    return result


def _create_purchase_items(purchase, items):
    context = _load_line_context(items)
    for index, line in enumerate(items):
        product, unit, warehouse = _line_product_and_unit(
            line,
            product_map=context["products"],
            warehouse_map=context["warehouses"],
            index=index,
        )
        quantity, qty_in_base = _validate_line_quantity(line, unit)
        unit_cost_usd = _line_price(line, purchase=True)
        total_usd = _line_total(line, purchase=True)
        _assert_money_matches(line.get("totalUsd"), total_usd, "LINE_TOTAL_MISMATCH")
        delta = _storage_delta(product, qty_in_base)
        base_unit_cost_usd = decimal_or_zero(line.get("baseUnitCostUsd"))
        storage_unit_cost_usd = decimal_or_zero(line.get("storageUnitCostUsd"))
        if base_unit_cost_usd <= 0 and qty_in_base > 0:
            base_unit_cost_usd = _money(total_usd / qty_in_base)
        if storage_unit_cost_usd <= 0 and delta > 0:
            storage_unit_cost_usd = _money(total_usd / delta)
        Product.objects.filter(pk=product.pk).update(stock_quantity=F("stock_quantity") + delta)
        purchase_item = PurchaseItem.objects.create(
            purchase=purchase,
            product=product,
            warehouse=warehouse,
            unit_id=unit.external_id,
            unit_name=line.get("unitName") or unit.name,
            quantity=quantity,
            qty_in_base=qty_in_base,
            unit_cost_usd=unit_cost_usd,
            total_usd=total_usd,
            supplier_unit_cost_usd=decimal_or_zero(line.get("supplierUnitCostUsd"), str(unit_cost_usd)),
            base_unit_cost_usd=base_unit_cost_usd,
            storage_unit_cost_usd=storage_unit_cost_usd,
            landed_cost_share_usd=decimal_or_zero(line.get("landedCostShareUsd")),
            discount_share_usd=decimal_or_zero(line.get("discountShareUsd")),
            batch_code=str(line.get("batchCode") or "").strip(),
            expiry_days=int(line.get("expiryDays") or 0),
            expires_at=datetime_or_now(line.get("expiresAt")) if line.get("expiresAt") else None,
            received_at=datetime_or_now(line.get("receivedAt")) if line.get("receivedAt") else None,
        )
        _create_purchase_stock_batch(purchase, purchase_item, index=index, delta=delta, total_usd=total_usd)
        StockMovement.objects.create(
            product=product,
            warehouse=warehouse,
            movement_type="purchase",
            quantity=delta,
            note=f"Purchase {purchase.external_id}: {quantity} {unit.name}",
        )


from django.db.models.functions import Coalesce

def list_invoices_service(entity_type=None, entity_id=None, period_key=None, start_date=None, end_date=None, search_query=None, sale_kind=None, return_status=None):
    if entity_type == LedgerEntry.ENTITY_SUPPLIER:
        qs = Purchase.objects.select_related("supplier").prefetch_related("items__product", "items__warehouse").order_by("-created_at", "-id")
        if entity_id:
            qs = qs.filter(supplier__external_id=entity_id)
            
        now = timezone.now()
        if period_key == "today":
            qs = qs.filter(created_at__gte=now.replace(hour=0, minute=0, second=0, microsecond=0), created_at__lt=(now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0))
        elif period_key == "yesterday":
            yesterday = now - timedelta(days=1)
            qs = qs.filter(created_at__gte=yesterday.replace(hour=0, minute=0, second=0, microsecond=0), created_at__lt=now.replace(hour=0, minute=0, second=0, microsecond=0))
        elif period_key == "week":
            qs = qs.filter(created_at__gte=now - timedelta(days=now.weekday()), created_at__lt=now - timedelta(days=now.weekday()) + timedelta(days=7))
        elif period_key == "month":
            if now.month == 12:
                next_month = now.replace(year=now.year+1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
            else:
                next_month = now.replace(month=now.month+1, day=1, hour=0, minute=0, second=0, microsecond=0)
            qs = qs.filter(created_at__gte=now.replace(day=1, hour=0, minute=0, second=0, microsecond=0), created_at__lt=next_month)
        elif period_key == "year":
            qs = qs.filter(created_at__gte=now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0), created_at__lt=now.replace(year=now.year+1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0))
        elif period_key == "custom":
            if start_date:
                qs = qs.filter(created_at__gte=f"{start_date}T00:00:00Z")
            if end_date:
                qs = qs.filter(created_at__lte=f"{end_date}T23:59:59Z")
                
        if search_query:
            qs = qs.filter(
                Q(external_id__icontains=search_query) |
                Q(supplier__company_name__icontains=search_query) |
                Q(supplier__name__icontains=search_query) |
                Q(supplier__phone__icontains=search_query) |
                Q(items__product__name__icontains=search_query) |
                Q(items__product__barcode__icontains=search_query)
            ).distinct()
            
        if return_status and return_status != "all":
            qs = qs.annotate(returned_total=Coalesce(Sum('returns__total_usd'), Decimal('0.0000')))
            if return_status == "returnable":
                qs = qs.filter(returned_total__lt=F('total_usd'))
            elif return_status == "partial":
                qs = qs.filter(returned_total__gt=0, returned_total__lt=F('total_usd'))
            elif return_status == "full":
                qs = qs.filter(returned_total__gte=F('total_usd'))
        
        return qs
        
    qs = Invoice.objects.select_related("client").prefetch_related("items__product", "items__warehouse").order_by("-created_at", "-id")
    if entity_id:
        qs = qs.filter(client__external_id=entity_id)
        
    now = timezone.now()
    if period_key == "today":
        qs = qs.filter(created_at__gte=now.replace(hour=0, minute=0, second=0, microsecond=0), created_at__lt=(now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0))
    elif period_key == "yesterday":
        yesterday = now - timedelta(days=1)
        qs = qs.filter(created_at__gte=yesterday.replace(hour=0, minute=0, second=0, microsecond=0), created_at__lt=now.replace(hour=0, minute=0, second=0, microsecond=0))
    elif period_key == "week":
        qs = qs.filter(created_at__gte=now - timedelta(days=now.weekday()), created_at__lt=now - timedelta(days=now.weekday()) + timedelta(days=7))
    elif period_key == "month":
        if now.month == 12:
            next_month = now.replace(year=now.year+1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        else:
            next_month = now.replace(month=now.month+1, day=1, hour=0, minute=0, second=0, microsecond=0)
        qs = qs.filter(created_at__gte=now.replace(day=1, hour=0, minute=0, second=0, microsecond=0), created_at__lt=next_month)
    elif period_key == "year":
        qs = qs.filter(created_at__gte=now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0), created_at__lt=now.replace(year=now.year+1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0))
    elif period_key == "custom":
        if start_date:
            qs = qs.filter(created_at__gte=f"{start_date}T00:00:00Z")
        if end_date:
            qs = qs.filter(created_at__lte=f"{end_date}T23:59:59Z")
            
    if sale_kind and sale_kind != "all":
        qs = qs.filter(kind=sale_kind)
        
    if search_query:
        qs = qs.filter(
            Q(external_id__icontains=search_query) |
            Q(client__name__icontains=search_query) |
            Q(client__phone__icontains=search_query) |
            Q(items__product__name__icontains=search_query) |
            Q(items__product__barcode__icontains=search_query)
        ).distinct()
        
    if return_status and return_status != "all":
        qs = qs.annotate(returned_total=Coalesce(Sum('returns__total_usd'), Decimal('0.0000')))
        if return_status == "returnable":
            qs = qs.filter(returned_total__lt=F('total_usd'))
        elif return_status == "partial":
            qs = qs.filter(returned_total__gt=0, returned_total__lt=F('total_usd'))
        elif return_status == "full":
            qs = qs.filter(returned_total__gte=F('total_usd'))
            
    return qs


def list_payments_service(entity_type=None, entity_id=None):
    client_qs = ClientPayment.objects.select_related("client").order_by("-created_at", "-id")
    supplier_qs = SupplierPayment.objects.select_related("supplier").order_by("-created_at", "-id")
    if entity_type == LedgerEntry.ENTITY_CUSTOMER and entity_id:
        client_qs = client_qs.filter(client__external_id=entity_id)
        supplier_qs = supplier_qs.none()
    elif entity_type == LedgerEntry.ENTITY_SUPPLIER and entity_id:
        supplier_qs = supplier_qs.filter(supplier__external_id=entity_id)
        client_qs = client_qs.none()
    return client_qs, supplier_qs


def create_invoice_service(payload):
    entity_type = payload.get("entityType") or (LedgerEntry.ENTITY_SUPPLIER if payload.get("supplierId") else LedgerEntry.ENTITY_CUSTOMER)
    if entity_type == LedgerEntry.ENTITY_SUPPLIER:
        return _create_supplier_invoice_service(payload)
    return _create_customer_invoice_service(payload)


def _idempotency_key(payload):
    return str(payload.get("idempotencyKey") or payload.get("idempotency_key") or "").strip()


def _document_external_id(payload, prefix, model, created_at):
    return (
        str(payload.get("id") or payload.get("externalId") or "").strip()
        or _idempotency_key(payload)
        or _document_id(prefix, model, created_at)
    )


def _create_customer_invoice_service(payload):
    with transaction.atomic():
        customer_id = payload.get("customerId") or payload.get("clientId")
        customer = None
        if customer_id:
            customer = Client.objects.filter(external_id=customer_id, deleted_at__isnull=True).first()
        if customer_id and not customer:
            raise FinanceServiceError("NO_CUSTOMER")
        created_at = datetime_or_now(payload.get("createdAt"))
        external_id = _document_external_id(payload, "INV", Invoice, created_at)
        existing = Invoice.objects.filter(external_id=external_id).first()
        if existing and _idempotency_key(payload):
            return existing
        if existing:
            raise FinanceServiceError("INVOICE_EXISTS")
        items = _payload_items_with_line_defaults(payload)
        subtotal, discount, paid, total, remaining, status = _invoice_totals(payload)
        invoice = Invoice.objects.create(
            external_id=external_id,
            client=customer,
            kind=_invoice_kind(payload),
            title=payload.get("title") or payload.get("invoiceTitle") or "",
            customer_name=payload.get("customerName") or (customer.name if customer else "زبون مباشر"),
            exchange_rate=decimal_or_zero(payload.get("exchangeRate"), "1460"),
            subtotal_usd=subtotal,
            discount_usd=discount,
            paid_usd=paid,
            total_usd=total,
            remaining_usd=remaining,
            payment_status=status,
            installment_plan=payload.get("installmentPlan") or {},
            note=payload.get("note") or "",
            created_at=created_at,
        )
        _create_invoice_items(invoice, items)
        if customer:
            record_ledger_entry(
                entity_type=LedgerEntry.ENTITY_CUSTOMER,
                entity=customer,
                amount_usd=total,
                entry_type=LedgerEntry.TYPE_INVOICE_CREATED,
                reference_id=invoice.external_id,
                reference_model="invoice",
                timestamp=invoice.created_at,
                invoice=invoice,
                metadata={"paymentStatus": invoice.payment_status},
            )
            if paid:
                _create_customer_payment_record(
                    customer=customer,
                    amount_usd=paid,
                    note=payload.get("paymentNote") or "Invoice payment",
                    received_at=date_or_none(payload.get("receivedAt")),
                    applied_to=[{"invoiceId": invoice.external_id, "amountUsd": float(paid)}],
                    reference_id=payload.get("paymentId") or _timestamp_id("PAY"),
                    entry_type=LedgerEntry.TYPE_PAYMENT_RECEIVED,
                    installment=None,
                )
        return invoice


def _create_supplier_invoice_service(payload):
    with transaction.atomic():
        supplier_id = payload.get("supplierId")
        supplier = None
        if supplier_id:
            supplier = Supplier.objects.filter(external_id=supplier_id, deleted_at__isnull=True).first()
        if supplier_id and not supplier:
            raise FinanceServiceError("NO_SUPPLIER")
        created_at = datetime_or_now(payload.get("createdAt"))
        external_id = _document_external_id(payload, "PUR", Purchase, created_at)
        existing = Purchase.objects.filter(external_id=external_id).first()
        if existing and _idempotency_key(payload):
            return existing
        if existing:
            raise FinanceServiceError("INVOICE_EXISTS")
        items = _payload_items_with_line_defaults(payload)
        if not items:
            raise FinanceServiceError("EMPTY_INVOICE")
        cost = _money(sum(_line_total(item, purchase=True) for item in items))
        _assert_money_matches(payload.get("costUsd"), cost, "TOTAL_MISMATCH")
        paid = min(max(_money(payload.get("paidUsd")), Decimal("0.0000")), cost)
        status, remaining = _payment_status(cost, paid)
        purchase = Purchase.objects.create(
            external_id=external_id,
            supplier=supplier,
            title=payload.get("title") or payload.get("invoiceTitle") or "",
            supplier_name=payload.get("supplierName") or (supplier.name if supplier else "مورد مباشر"),
            exchange_rate=decimal_or_zero(payload.get("exchangeRate"), "1460"),
            cost_usd=cost,
            paid_usd=paid,
            remaining_usd=remaining,
            payment_status=status,
            note=payload.get("note") or "",
            created_at=created_at,
        )
        _create_purchase_items(purchase, items)
        if supplier:
            record_ledger_entry(
                entity_type=LedgerEntry.ENTITY_SUPPLIER,
                entity=supplier,
                amount_usd=cost,
                entry_type=LedgerEntry.TYPE_INVOICE_CREATED,
                reference_id=purchase.external_id,
                reference_model="purchase",
                timestamp=purchase.created_at,
                purchase=purchase,
                metadata={"paymentStatus": purchase.payment_status},
            )
            if paid:
                _create_supplier_payment_record(
                    supplier=supplier,
                    amount_usd=paid,
                    note=payload.get("paymentNote") or "Supplier invoice payment",
                    paid_at=date_or_none(payload.get("paidAt")),
                    applied_to=[{"purchaseId": purchase.external_id, "amountUsd": float(paid)}],
                    reference_id=payload.get("paymentId") or _timestamp_id("SPAY"),
                )
        return purchase


def _refresh_invoice_payment_state(invoice):
    status, remaining = _payment_status(invoice.total_usd, invoice.paid_usd)
    invoice.payment_status = status
    invoice.remaining_usd = remaining
    invoice.save(update_fields=["paid_usd", "remaining_usd", "payment_status"])


def _refresh_purchase_payment_state(purchase):
    status, remaining = _payment_status(purchase.cost_usd, purchase.paid_usd)
    purchase.payment_status = status
    purchase.remaining_usd = remaining
    purchase.save(update_fields=["paid_usd", "remaining_usd", "payment_status"])


def _invoice_returned_total(invoice):
    return _money(
        ReturnDocument.objects.filter(
            return_type="sale_return",
            invoice=invoice,
        ).aggregate(total=Sum("total_usd"))["total"]
        or Decimal("0.0000")
    )


def _purchase_returned_total(purchase):
    return _money(
        ReturnDocument.objects.filter(
            return_type="purchase_return",
            purchase=purchase,
        ).aggregate(total=Sum("total_usd"))["total"]
        or Decimal("0.0000")
    )


def _refresh_invoice_return_state(invoice):
    if invoice.voided_at:
        return
    returned = _invoice_returned_total(invoice)
    net_due = max(Decimal("0.0000"), _money(invoice.total_usd - returned))
    invoice.remaining_usd = max(Decimal("0.0000"), _money(net_due - invoice.paid_usd))
    if invoice.remaining_usd <= MONEY_TOLERANCE:
        invoice.payment_status = "paid"
        invoice.remaining_usd = Decimal("0.0000")
    elif invoice.paid_usd > 0 or returned > 0:
        invoice.payment_status = "partial"
    else:
        invoice.payment_status = "unpaid"
    invoice.save(update_fields=["remaining_usd", "payment_status"])


def _refresh_purchase_return_state(purchase):
    if purchase.voided_at:
        return
    returned = _purchase_returned_total(purchase)
    net_due = max(Decimal("0.0000"), _money(purchase.cost_usd - returned))
    purchase.remaining_usd = max(Decimal("0.0000"), _money(net_due - purchase.paid_usd))
    if purchase.remaining_usd <= MONEY_TOLERANCE:
        purchase.payment_status = "paid"
        purchase.remaining_usd = Decimal("0.0000")
    elif purchase.paid_usd > 0 or returned > 0:
        purchase.payment_status = "partial"
    else:
        purchase.payment_status = "unpaid"
    purchase.save(update_fields=["remaining_usd", "payment_status"])


def _payment_references(payment, key, value):
    return any(str(item.get(key) or "") == str(value) for item in (payment.applied_to or []))


def _reverse_ledger_entries_for_void(entries, *, reason="", reference_model="void"):
    reversed_entries = []
    for entry in entries:
        if entry.reversal_entries.exists():
            continue
        entity = entry.customer if entry.entity_type == LedgerEntry.ENTITY_CUSTOMER else entry.supplier
        if not entity:
            continue
        reversed_entries.append(record_ledger_entry(
            entity_type=entry.entity_type,
            entity=entity,
            amount_usd=-entry.amount_usd,
            entry_type=LedgerEntry.TYPE_DEBT_ADJUSTMENT,
            reference_id=f"void-{entry.id}",
            reference_model=reference_model,
            reversed_entry=entry,
            metadata={
                "reason": reason or "",
                "voidedReferenceId": entry.reference_id,
                "voidedReferenceModel": entry.reference_model,
            },
        ))
    return reversed_entries


def _restore_invoice_stock(invoice):
    for item in invoice.items.select_related("product", "warehouse"):
        if not item.product_id:
            continue
        delta = _storage_delta(item.product, item.qty_in_base)
        _restore_fifo_cost_breakdown(item)
        Product.objects.filter(pk=item.product_id).update(stock_quantity=F("stock_quantity") + delta)
        StockMovement.objects.create(
            product=item.product,
            warehouse=item.warehouse or item.product.warehouse,
            movement_type="adjustment",
            quantity=delta,
            note=f"Void invoice {invoice.external_id}",
        )


def _reverse_purchase_stock(purchase):
    for index, item in enumerate(purchase.items.select_related("product", "warehouse").order_by("id")):
        if not item.product_id:
            continue
        delta = _storage_delta(item.product, item.qty_in_base)
        batch = (
            StockBatch.objects.select_for_update()
            .filter(
                product=item.product,
                warehouse=item.warehouse or item.product.warehouse,
                batch_code=_purchase_batch_code(purchase, index),
            )
            .first()
        )
        if batch:
            if _money(batch.quantity) + MONEY_TOLERANCE < delta:
                raise FinanceServiceError("PURCHASE_BATCH_ALREADY_SOLD")
            batch.quantity = _money(batch.quantity - delta)
            batch.is_closed = batch.quantity <= MONEY_TOLERANCE
            batch.save(update_fields=["quantity", "is_closed"])
        updated = Product.objects.filter(pk=item.product_id, stock_quantity__gte=delta).update(stock_quantity=F("stock_quantity") - delta)
        if not updated:
            raise FinanceServiceError("VOID_STOCK_UNAVAILABLE")
        StockMovement.objects.create(
            product=item.product,
            warehouse=item.warehouse or item.product.warehouse,
            movement_type="adjustment",
            quantity=-delta,
            note=f"Void purchase {purchase.external_id}",
        )


def void_invoice_service(external_id, *, reason="", requested_by=None):
    with transaction.atomic():
        invoice = (
            Invoice.objects.select_for_update()
            .select_related("client")
            .prefetch_related("items__product", "items__warehouse")
            .filter(external_id=external_id)
            .first()
        )
        if not invoice:
            raise FinanceServiceError("NO_INVOICE")
        if invoice.voided_at:
            return invoice
        if invoice.remaining_usd > MONEY_TOLERANCE:
            raise FinanceServiceError("INVOICE_HAS_DEBT")
        if invoice.installments.exists() or (isinstance(invoice.installment_plan, dict) and invoice.installment_plan.get("type") == "installment"):
            raise FinanceServiceError("INVOICE_HAS_INSTALLMENTS")
        if invoice.client_id:
            for payment in ClientPayment.objects.filter(client=invoice.client):
                if _payment_references(payment, "invoiceId", invoice.external_id):
                    raise FinanceServiceError("INVOICE_HAS_LINKED_PAYMENTS")
        _restore_invoice_stock(invoice)
        _reverse_ledger_entries_for_void(
            LedgerEntry.objects.filter(invoice=invoice).order_by("timestamp", "id"),
            reason=reason,
            reference_model="invoice_void",
        )
        invoice.voided_at = timezone.now()
        invoice.void_reason = reason or ""
        invoice.payment_status = "void"
        invoice.remaining_usd = Decimal("0.0000")
        invoice.save(update_fields=["voided_at", "void_reason", "payment_status", "remaining_usd"])
        AuditLog.objects.create(
            action="invoice_void",
            entity_type="invoice",
            entity_id=invoice.external_id,
            message="Invoice safely voided",
            data={"reason": reason or "", "requestedBy": getattr(requested_by, "username", "") if requested_by else ""},
        )
        return invoice


def void_purchase_service(external_id, *, reason="", requested_by=None):
    with transaction.atomic():
        purchase = (
            Purchase.objects.select_for_update()
            .select_related("supplier")
            .prefetch_related("items__product", "items__warehouse")
            .filter(external_id=external_id)
            .first()
        )
        if not purchase:
            raise FinanceServiceError("NO_PURCHASE")
        if purchase.voided_at:
            return purchase
        if purchase.remaining_usd > MONEY_TOLERANCE:
            raise FinanceServiceError("PURCHASE_HAS_DEBT")
        if purchase.supplier_id:
            for payment in SupplierPayment.objects.filter(supplier=purchase.supplier):
                if _payment_references(payment, "purchaseId", purchase.external_id):
                    raise FinanceServiceError("PURCHASE_HAS_LINKED_PAYMENTS")
        _reverse_purchase_stock(purchase)
        _reverse_ledger_entries_for_void(
            LedgerEntry.objects.filter(purchase=purchase).order_by("timestamp", "id"),
            reason=reason,
            reference_model="purchase_void",
        )
        purchase.voided_at = timezone.now()
        purchase.void_reason = reason or ""
        purchase.payment_status = "void"
        purchase.remaining_usd = Decimal("0.0000")
        purchase.save(update_fields=["voided_at", "void_reason", "payment_status", "remaining_usd"])
        AuditLog.objects.create(
            action="purchase_void",
            entity_type="purchase",
            entity_id=purchase.external_id,
            message="Purchase invoice safely voided",
            data={"reason": reason or "", "requestedBy": getattr(requested_by, "username", "") if requested_by else ""},
        )
        return purchase


def _return_document_external_id(payload, return_type, created_at):
    prefix = "SRET" if return_type == "sale_return" else "PRET"
    return _document_external_id(payload, prefix, ReturnDocument, created_at)


def _return_quantity_from_payload(line):
    return _money(line.get("qty") if "qty" in line else line.get("quantity"))


def _line_by_payload_index(lines, payload_line):
    raw_index = payload_line.get("lineIndex") if payload_line.get("lineIndex") is not None else payload_line.get("itemIndex")
    if raw_index is not None and str(raw_index).strip() != "":
        try:
            return lines[int(raw_index)]
        except (IndexError, TypeError, ValueError):
            raise FinanceServiceError("RETURN_LINE_NOT_FOUND")
    product_id = str(payload_line.get("productId") or "").strip()
    unit_id = str(payload_line.get("unitId") or "").strip()
    matches = [
        item for item in lines
        if item.product and item.product.external_id == product_id and (not unit_id or item.unit_id == unit_id)
    ]
    if len(matches) != 1:
        raise FinanceServiceError("RETURN_LINE_NOT_FOUND")
    return matches[0]


def _returned_qty_in_base_for_invoice_item(item):
    return _money(ReturnItem.objects.filter(invoice_item=item).aggregate(total=Sum("qty_in_base"))["total"] or Decimal("0.0000"))


def _returned_qty_in_base_for_purchase_item(item):
    return _money(ReturnItem.objects.filter(purchase_item=item).aggregate(total=Sum("qty_in_base"))["total"] or Decimal("0.0000"))


def _return_qty_in_base(source_item, quantity):
    if source_item.quantity <= 0:
        raise FinanceServiceError("INVALID_QUANTITY")
    return _money(_money(quantity) * _money(source_item.qty_in_base) / _money(source_item.quantity))


def _scaled_cost_breakdown(invoice_item, storage_delta):
    original_delta = _storage_delta(invoice_item.product, invoice_item.qty_in_base)
    if original_delta <= 0:
        return Decimal("0.0000"), []
    ratio = _money(storage_delta) / original_delta
    total_cost = Decimal("0.0000")
    scaled = []
    for entry in invoice_item.cost_breakdown or []:
        quantity = _money(entry.get("quantity")) * ratio
        cost_usd = _money(entry.get("costUsd")) * ratio
        unit_cost = _money(entry.get("unitCostUsd"))
        if quantity <= MONEY_TOLERANCE:
            continue
        total_cost += cost_usd
        scaled.append({
            **entry,
            "quantity": float(_money(quantity)),
            "costUsd": float(_money(cost_usd)),
            "unitCostUsd": float(unit_cost),
        })
    if not scaled and invoice_item.total_cost_usd > 0:
        total_cost = _money(invoice_item.total_cost_usd * ratio)
    return _money(total_cost), scaled


def _restore_sale_return_batches(return_item):
    for entry in return_item.cost_breakdown or []:
        quantity = _money(entry.get("quantity"))
        if quantity <= MONEY_TOLERANCE:
            continue
        batch_id = entry.get("batchId")
        updated = 0
        if batch_id:
            updated = StockBatch.objects.filter(pk=batch_id).update(quantity=F("quantity") + quantity, is_closed=False)
        if not updated and return_item.product_id:
            StockBatch.objects.create(
                product=return_item.product,
                warehouse=return_item.warehouse or return_item.product.warehouse,
                batch_code=str(entry.get("batchCode") or f"RETURN-{return_item.return_document.external_id}"),
                quantity=quantity,
                purchase_cost_usd=_money(entry.get("unitCostUsd") or return_item.unit_cost_usd),
                received_at=timezone.now(),
                is_closed=False,
            )


def _reduce_installments_from_return(invoice, amount_usd):
    amount_left = _money(amount_usd)
    if amount_left <= MONEY_TOLERANCE:
        return
    installments = list(invoice.installments.select_for_update().order_by("-number"))
    if not installments:
        return
    plan = invoice.installment_plan if isinstance(invoice.installment_plan, dict) else {}
    schedule = plan.get("schedule") if isinstance(plan.get("schedule"), list) else []
    schedule_by_number = {int(item.get("number") or 0): item for item in schedule if isinstance(item, dict)}
    for installment in installments:
        if amount_left <= MONEY_TOLERANCE:
            break
        paid = installment_paid_usd(installment)
        reducible = max(Decimal("0.0000"), _money(installment.amount_usd - paid))
        if reducible <= MONEY_TOLERANCE:
            continue
        reduction = min(amount_left, reducible)
        installment.amount_usd = _money(installment.amount_usd - reduction)
        installment.save(update_fields=["amount_usd"])
        schedule_item = schedule_by_number.get(installment.number)
        if schedule_item is not None:
            schedule_item["amountUsd"] = float(installment.amount_usd)
            schedule_item["returnedUsd"] = float(_money(decimal_or_zero(schedule_item.get("returnedUsd")) + reduction))
            if installment.amount_usd <= MONEY_TOLERANCE:
                schedule_item["status"] = "returned"
            elif paid >= installment.amount_usd - MONEY_TOLERANCE:
                schedule_item["status"] = "paid"
        amount_left = _money(amount_left - reduction)
    if schedule:
        plan["schedule"] = schedule
    for key in ("remainingUsd", "totalUsd", "finalPriceUsd"):
        if key in plan:
            plan[key] = float(max(Decimal("0.0000"), _money(decimal_or_zero(plan.get(key)) - _money(amount_usd))))
    invoice.installment_plan = plan
    invoice.save(update_fields=["installment_plan"])


def _record_return_ledger(return_document):
    if return_document.return_type == "sale_return" and return_document.client_id:
        record_ledger_entry(
            entity_type=LedgerEntry.ENTITY_CUSTOMER,
            entity=return_document.client,
            amount_usd=-return_document.total_usd,
            entry_type=LedgerEntry.TYPE_DEBT_ADJUSTMENT,
            reference_id=return_document.external_id,
            reference_model="return",
            timestamp=return_document.created_at,
            invoice=return_document.invoice,
            metadata={"returnType": return_document.return_type, "settlementMethod": return_document.settlement_method, "reason": return_document.reason},
        )
        if return_document.settlement_method == "cash":
            record_ledger_entry(
                entity_type=LedgerEntry.ENTITY_CUSTOMER,
                entity=return_document.client,
                amount_usd=return_document.total_usd,
                entry_type=LedgerEntry.TYPE_DEBT_ADJUSTMENT,
                reference_id=f"{return_document.external_id}-cash",
                reference_model="return_cash_refund",
                timestamp=return_document.created_at,
                invoice=return_document.invoice,
                metadata={"returnId": return_document.external_id},
            )
    if return_document.return_type == "purchase_return" and return_document.supplier_id:
        record_ledger_entry(
            entity_type=LedgerEntry.ENTITY_SUPPLIER,
            entity=return_document.supplier,
            amount_usd=-return_document.total_usd,
            entry_type=LedgerEntry.TYPE_DEBT_ADJUSTMENT,
            reference_id=return_document.external_id,
            reference_model="return",
            timestamp=return_document.created_at,
            purchase=return_document.purchase,
            metadata={"returnType": return_document.return_type, "settlementMethod": return_document.settlement_method, "reason": return_document.reason},
        )
        if return_document.settlement_method == "cash":
            record_ledger_entry(
                entity_type=LedgerEntry.ENTITY_SUPPLIER,
                entity=return_document.supplier,
                amount_usd=return_document.total_usd,
                entry_type=LedgerEntry.TYPE_DEBT_ADJUSTMENT,
                reference_id=f"{return_document.external_id}-cash",
                reference_model="return_cash_received",
                timestamp=return_document.created_at,
                purchase=return_document.purchase,
                metadata={"returnId": return_document.external_id},
            )


def _create_sale_return(payload, *, requested_by=None):
    invoice_id = payload.get("invoiceId") or payload.get("sourceId") or payload.get("documentId")
    invoice = (
        Invoice.objects.select_for_update()
        .select_related("client")
        .prefetch_related("items__product", "items__warehouse", "installments")
        .filter(external_id=invoice_id)
        .first()
    )
    if not invoice:
        raise FinanceServiceError("NO_INVOICE")
    if invoice.voided_at:
        raise FinanceServiceError("INVOICE_VOIDED")
    payload_items = payload.get("items") if isinstance(payload.get("items"), list) else []
    if not payload_items:
        raise FinanceServiceError("EMPTY_RETURN")
    created_at = datetime_or_now(payload.get("createdAt"))
    external_id = _return_document_external_id(payload, "sale_return", created_at)
    if ReturnDocument.objects.filter(external_id=external_id).exists():
        raise FinanceServiceError("RETURN_EXISTS")
    source_items = list(invoice.items.select_related("product", "warehouse").order_by("id"))
    return_document = ReturnDocument.objects.create(
        external_id=external_id,
        return_type="sale_return",
        invoice=invoice,
        client=invoice.client,
        party_name=invoice.customer_name or (invoice.client.name if invoice.client else "زبون مباشر"),
        exchange_rate=invoice.exchange_rate,
        settlement_method=payload.get("settlementMethod") if payload.get("settlementMethod") in {"credit", "cash"} else "credit",
        reason=payload.get("reason") or "",
        note=payload.get("note") or "",
        created_at=created_at,
    )
    total = Decimal("0.0000")
    for payload_line in payload_items:
        source_item = _line_by_payload_index(source_items, payload_line)
        if not source_item.product_id:
            raise FinanceServiceError("NO_PRODUCT")
        quantity = _return_quantity_from_payload(payload_line)
        if quantity <= 0:
            continue
        qty_in_base = _return_qty_in_base(source_item, quantity)
        available = _money(source_item.qty_in_base - _returned_qty_in_base_for_invoice_item(source_item))
        if qty_in_base > available + MONEY_TOLERANCE:
            raise FinanceServiceError("RETURN_QTY_EXCEEDS_AVAILABLE")
        unit_price_usd = _money(source_item.total_usd / source_item.quantity) if source_item.quantity > 0 else source_item.price_usd
        line_total = _money(unit_price_usd * quantity)
        storage_delta = _storage_delta(source_item.product, qty_in_base)
        total_cost, cost_breakdown = _scaled_cost_breakdown(source_item, storage_delta)
        unit_cost = _money(total_cost / quantity) if quantity > 0 else Decimal("0.0000")
        condition = payload_line.get("condition") if payload_line.get("condition") in {"resellable", "damaged"} else "resellable"
        return_item = ReturnItem.objects.create(
            return_document=return_document,
            invoice_item=source_item,
            product=source_item.product,
            warehouse=source_item.warehouse or source_item.product.warehouse,
            unit_id=source_item.unit_id,
            unit_name=source_item.unit_name,
            quantity=quantity,
            qty_in_base=qty_in_base,
            unit_price_usd=unit_price_usd,
            total_usd=line_total,
            unit_cost_usd=unit_cost,
            total_cost_usd=total_cost,
            condition=condition,
            cost_breakdown=cost_breakdown,
        )
        if condition == "resellable":
            Product.objects.filter(pk=source_item.product_id).update(stock_quantity=F("stock_quantity") + storage_delta)
            _restore_sale_return_batches(return_item)
            StockMovement.objects.create(
                product=source_item.product,
                warehouse=return_item.warehouse,
                movement_type="sale_return",
                quantity=storage_delta,
                note=f"Sales return {return_document.external_id} from invoice {invoice.external_id}",
            )
        else:
            StockMovement.objects.create(
                product=source_item.product,
                warehouse=return_item.warehouse,
                movement_type="return_damage",
                quantity=Decimal("0.0000"),
                note=f"Damaged sales return {return_document.external_id} from invoice {invoice.external_id}",
            )
        total += line_total
    total = _money(total)
    if total <= MONEY_TOLERANCE:
        raise FinanceServiceError("EMPTY_RETURN")
    return_document.total_usd = total
    return_document.save(update_fields=["total_usd"])
    if isinstance(invoice.installment_plan, dict) and invoice.installment_plan.get("type") == "installment":
        _reduce_installments_from_return(invoice, total)
    _record_return_ledger(return_document)
    _refresh_invoice_return_state(invoice)
    AuditLog.objects.create(
        action="sale_return_created",
        entity_type="return",
        entity_id=return_document.external_id,
        message="Sales return created",
        data={"invoiceId": invoice.external_id, "requestedBy": getattr(requested_by, "username", "") if requested_by else ""},
    )
    return return_document


def _create_purchase_return(payload, *, requested_by=None):
    purchase_id = payload.get("purchaseId") or payload.get("sourceId") or payload.get("documentId")
    purchase = (
        Purchase.objects.select_for_update()
        .select_related("supplier")
        .prefetch_related("items__product", "items__warehouse")
        .filter(external_id=purchase_id)
        .first()
    )
    if not purchase:
        raise FinanceServiceError("NO_PURCHASE")
    if purchase.voided_at:
        raise FinanceServiceError("PURCHASE_VOIDED")
    payload_items = payload.get("items") if isinstance(payload.get("items"), list) else []
    if not payload_items:
        raise FinanceServiceError("EMPTY_RETURN")
    created_at = datetime_or_now(payload.get("createdAt"))
    external_id = _return_document_external_id(payload, "purchase_return", created_at)
    if ReturnDocument.objects.filter(external_id=external_id).exists():
        raise FinanceServiceError("RETURN_EXISTS")
    source_items = list(purchase.items.select_related("product", "warehouse").order_by("id"))
    return_document = ReturnDocument.objects.create(
        external_id=external_id,
        return_type="purchase_return",
        purchase=purchase,
        supplier=purchase.supplier,
        party_name=purchase.supplier_name or (purchase.supplier.name if purchase.supplier else "مورد مباشر"),
        exchange_rate=purchase.exchange_rate,
        settlement_method=payload.get("settlementMethod") if payload.get("settlementMethod") in {"credit", "cash"} else "credit",
        reason=payload.get("reason") or "",
        note=payload.get("note") or "",
        created_at=created_at,
    )
    total = Decimal("0.0000")
    for payload_line in payload_items:
        source_item = _line_by_payload_index(source_items, payload_line)
        if not source_item.product_id:
            raise FinanceServiceError("NO_PRODUCT")
        quantity = _return_quantity_from_payload(payload_line)
        if quantity <= 0:
            continue
        qty_in_base = _return_qty_in_base(source_item, quantity)
        available = _money(source_item.qty_in_base - _returned_qty_in_base_for_purchase_item(source_item))
        if qty_in_base > available + MONEY_TOLERANCE:
            raise FinanceServiceError("RETURN_QTY_EXCEEDS_AVAILABLE")
        storage_delta = _storage_delta(source_item.product, qty_in_base)
        current_stock = _money(Product.objects.filter(pk=source_item.product_id).values_list("stock_quantity", flat=True).first() or Decimal("0.0000"))
        if current_stock + MONEY_TOLERANCE < storage_delta:
            raise FinanceServiceError("PURCHASE_RETURN_STOCK_UNAVAILABLE")
        source_index = source_items.index(source_item)
        batch_code = _purchase_line_batch_code(purchase, source_item, source_index)
        batch = (
            StockBatch.objects.select_for_update()
            .filter(product=source_item.product, warehouse=source_item.warehouse or source_item.product.warehouse, batch_code=batch_code)
            .first()
        )
        if batch and _money(batch.quantity) + MONEY_TOLERANCE < storage_delta:
            raise FinanceServiceError("PURCHASE_RETURN_BATCH_SOLD")
        unit_price_usd = _money(source_item.total_usd / source_item.quantity) if source_item.quantity > 0 else source_item.unit_cost_usd
        line_total = _money(unit_price_usd * quantity)
        unit_cost = _money(line_total / quantity) if quantity > 0 else Decimal("0.0000")
        return_item = ReturnItem.objects.create(
            return_document=return_document,
            purchase_item=source_item,
            product=source_item.product,
            warehouse=source_item.warehouse or source_item.product.warehouse,
            unit_id=source_item.unit_id,
            unit_name=source_item.unit_name,
            quantity=quantity,
            qty_in_base=qty_in_base,
            unit_price_usd=unit_price_usd,
            total_usd=line_total,
            unit_cost_usd=unit_cost,
            total_cost_usd=line_total,
            condition="resellable",
            cost_breakdown=[],
        )
        if batch:
            batch.quantity = _money(batch.quantity - storage_delta)
            batch.is_closed = batch.quantity <= MONEY_TOLERANCE
            batch.save(update_fields=["quantity", "is_closed"])
        updated = Product.objects.filter(pk=source_item.product_id, stock_quantity__gte=storage_delta).update(stock_quantity=F("stock_quantity") - storage_delta)
        if not updated:
            raise FinanceServiceError("PURCHASE_RETURN_STOCK_UNAVAILABLE")
        StockMovement.objects.create(
            product=source_item.product,
            warehouse=return_item.warehouse,
            movement_type="purchase_return",
            quantity=-storage_delta,
            note=f"Purchase return {return_document.external_id} from purchase {purchase.external_id}",
        )
        total += line_total
    total = _money(total)
    if total <= MONEY_TOLERANCE:
        raise FinanceServiceError("EMPTY_RETURN")
    return_document.total_usd = total
    return_document.save(update_fields=["total_usd"])
    _record_return_ledger(return_document)
    _refresh_purchase_return_state(purchase)
    AuditLog.objects.create(
        action="purchase_return_created",
        entity_type="return",
        entity_id=return_document.external_id,
        message="Purchase return created",
        data={"purchaseId": purchase.external_id, "requestedBy": getattr(requested_by, "username", "") if requested_by else ""},
    )
    return return_document


def create_return_service(payload, *, requested_by=None):
    return_type = payload.get("returnType") or payload.get("type")
    with transaction.atomic():
        if return_type == "purchase_return" or payload.get("purchaseId"):
            return _create_purchase_return(payload, requested_by=requested_by)
        return _create_sale_return(payload, requested_by=requested_by)


from django.utils import timezone
from datetime import timedelta

def list_returns_service(return_type=None, source_id=None, period_key=None, start_date=None, end_date=None, sale_kind=None, search_query=None):
    qs = ReturnDocument.objects.select_related("invoice", "purchase", "client", "supplier").prefetch_related("items__product", "items__warehouse").order_by("-created_at", "-id")
    if return_type:
        qs = qs.filter(return_type=return_type)
    if source_id:
        qs = qs.filter(Q(invoice__external_id=source_id) | Q(purchase__external_id=source_id))

    now = timezone.now()
    if period_key == "today":
        qs = qs.filter(created_at__gte=now.replace(hour=0, minute=0, second=0, microsecond=0))
    elif period_key == "week":
        qs = qs.filter(created_at__gte=now - timedelta(days=now.weekday()))
    elif period_key == "month":
        qs = qs.filter(created_at__gte=now.replace(day=1, hour=0, minute=0, second=0, microsecond=0))
    elif period_key == "year":
        qs = qs.filter(created_at__gte=now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0))
    elif period_key == "custom":
        if start_date:
            qs = qs.filter(created_at__gte=f"{start_date}T00:00:00Z")
        if end_date:
            qs = qs.filter(created_at__lte=f"{end_date}T23:59:59Z")

    if sale_kind and sale_kind != "all":
        qs = qs.filter(invoice__kind=sale_kind)
        
    if search_query:
        qs = qs.filter(
            Q(external_id__icontains=search_query) |
            Q(invoice__external_id__icontains=search_query) |
            Q(purchase__external_id__icontains=search_query) |
            Q(client__name__icontains=search_query) |
            Q(supplier__company_name__icontains=search_query) |
            Q(reason__icontains=search_query) |
            Q(note__icontains=search_query)
        )
        
    return qs


def _apply_customer_payment(customer, amount_usd, installment=None):
    remaining = _money(amount_usd)
    applied_to = []
    if installment:
        invoice = installment.invoice
        applied = min(remaining, max(Decimal("0.0000"), installment.amount_usd - installment_paid_usd(installment)))
        invoice.paid_usd = _money(invoice.paid_usd + applied)
        _mark_installment_paid_in_plan(invoice, installment, applied)
        _refresh_invoice_payment_state(invoice)
        return [{"invoiceId": invoice.external_id, "installmentId": installment.external_id, "installmentNumber": installment.number, "amountUsd": float(applied)}], _money(remaining - applied)

    invoices = Invoice.objects.select_for_update().filter(client=customer).order_by("created_at", "id")
    for invoice in invoices:
        if remaining <= 0:
            break
        debt = max(Decimal("0.0000"), _money(invoice.total_usd - invoice.paid_usd))
        if debt <= 0:
            continue
        applied = min(debt, remaining)
        invoice.paid_usd = _money(invoice.paid_usd + applied)
        _refresh_invoice_payment_state(invoice)
        applied_to.append({"invoiceId": invoice.external_id, "amountUsd": float(applied)})
        remaining = _money(remaining - applied)
    return applied_to, remaining


def _apply_supplier_payment(supplier, amount_usd, purchase_id=None):
    remaining = _money(amount_usd)
    applied_to = []
    purchases = Purchase.objects.select_for_update().filter(supplier=supplier).order_by("created_at", "id")
    if purchase_id:
        purchases = purchases.filter(external_id=purchase_id)
    for purchase in purchases:
        if remaining <= 0:
            break
        debt = max(Decimal("0.0000"), _money(purchase.cost_usd - purchase.paid_usd))
        if debt <= 0:
            continue
        applied = min(debt, remaining)
        purchase.paid_usd = _money(purchase.paid_usd + applied)
        _refresh_purchase_payment_state(purchase)
        applied_to.append({"purchaseId": purchase.external_id, "amountUsd": float(applied)})
        remaining = _money(remaining - applied)
    return applied_to, remaining


def _create_customer_payment_record(
    *,
    customer,
    amount_usd,
    note,
    received_at,
    applied_to,
    reference_id,
    entry_type,
    installment=None,
):
    payment = ClientPayment.objects.create(
        external_id=reference_id,
        client=customer,
        client_name=customer.name,
        amount_usd=_money(amount_usd),
        unapplied_usd=max(Decimal("0.0000"), _money(amount_usd) - sum(_money(item.get("amountUsd")) for item in applied_to)),
        applied_to=applied_to,
        note=note or "",
        received_at=received_at,
    )
    record_ledger_entry(
        entity_type=LedgerEntry.ENTITY_CUSTOMER,
        entity=customer,
        amount_usd=-payment.amount_usd,
        entry_type=entry_type,
        reference_id=payment.external_id,
        reference_model="payment",
        timestamp=payment.created_at,
        payment=payment,
        installment=installment,
        metadata={"appliedTo": applied_to, "unappliedUsd": float(payment.unapplied_usd)},
    )
    return payment


def _create_supplier_payment_record(*, supplier, amount_usd, note, paid_at, applied_to, reference_id):
    payment = SupplierPayment.objects.create(
        external_id=reference_id,
        supplier=supplier,
        supplier_name=supplier.name,
        amount_usd=_money(amount_usd),
        unapplied_usd=max(Decimal("0.0000"), _money(amount_usd) - sum(_money(item.get("amountUsd")) for item in applied_to)),
        applied_to=applied_to,
        note=note or "",
        paid_at=paid_at,
    )
    record_ledger_entry(
        entity_type=LedgerEntry.ENTITY_SUPPLIER,
        entity=supplier,
        amount_usd=-payment.amount_usd,
        entry_type=LedgerEntry.TYPE_PAYMENT_RECEIVED,
        reference_id=payment.external_id,
        reference_model="supplier_payment",
        timestamp=payment.created_at,
        supplier_payment=payment,
        metadata={"appliedTo": applied_to, "unappliedUsd": float(payment.unapplied_usd)},
    )
    return payment


def _ensure_payment_reference_available(model, reference_id):
    if reference_id and model.objects.filter(external_id=reference_id).exists():
        raise FinanceServiceError("PAYMENT_EXISTS")


def register_payment_service(payload):
    entity_type = payload.get("entityType") or (LedgerEntry.ENTITY_SUPPLIER if payload.get("supplierId") else LedgerEntry.ENTITY_CUSTOMER)
    amount = _money(payload.get("amountUsd") if payload.get("amountUsd") is not None else payload.get("amount"))
    if amount <= 0:
        raise FinanceServiceError("INVALID_AMOUNT")
    with transaction.atomic():
        if entity_type == LedgerEntry.ENTITY_SUPPLIER:
            supplier = Supplier.objects.filter(external_id=payload.get("supplierId"), deleted_at__isnull=True).first()
            if not supplier:
                raise FinanceServiceError("NO_SUPPLIER")
            reference_id = payload.get("id") or payload.get("externalId") or _timestamp_id("SPAY")
            _ensure_payment_reference_available(SupplierPayment, reference_id)
            applied_to, remaining = _apply_supplier_payment(supplier, amount, payload.get("purchaseId"))
            return _create_supplier_payment_record(
                supplier=supplier,
                amount_usd=amount,
                note=payload.get("note") or "",
                paid_at=date_or_none(payload.get("paidAt")),
                applied_to=applied_to,
                reference_id=reference_id,
            )

        customer = Client.objects.filter(external_id=payload.get("customerId") or payload.get("clientId"), deleted_at__isnull=True).first()
        if not customer:
            raise FinanceServiceError("NO_CUSTOMER")
        reference_id = payload.get("id") or payload.get("externalId") or _timestamp_id("PAY")
        _ensure_payment_reference_available(ClientPayment, reference_id)
        installment = None
        entry_type = LedgerEntry.TYPE_PAYMENT_RECEIVED
        if payload.get("installmentId"):
            installment = Installment.objects.select_related("invoice", "client").filter(external_id=payload.get("installmentId"), client=customer).first()
            if not installment:
                raise FinanceServiceError("NO_INSTALLMENT")
            entry_type = LedgerEntry.TYPE_INSTALLMENT_PAYMENT
        applied_to, remaining = _apply_customer_payment(customer, amount, installment=installment)
        payment = _create_customer_payment_record(
            customer=customer,
            amount_usd=amount,
            note=payload.get("note") or "",
            received_at=date_or_none(payload.get("receivedAt")),
            applied_to=applied_to,
            reference_id=reference_id,
            entry_type=entry_type,
            installment=installment,
        )
        payment.unapplied_usd = remaining
        payment.save(update_fields=["unapplied_usd"])
        return payment


def _add_months(source, months):
    month = source.month - 1 + months
    year = source.year + month // 12
    month = month % 12 + 1
    day = min(source.day, monthrange(year, month)[1])
    return date(year, month, day)


def _build_installment_schedule(payload, total_usd):
    explicit = payload.get("schedule") or payload.get("installments")
    if explicit:
        return [
            {
                "number": int(item.get("number") or index + 1),
                "amountUsd": _round_payload_money_usd(item.get("amountUsd"), payload),
                "dueDate": date_or_none(item.get("dueDate")),
            }
            for index, item in enumerate(explicit)
        ]
    count = max(1, int(payload.get("installmentCount") or payload.get("count") or 1))
    down_payment = min(max(_money(payload.get("downPaymentUsd")), Decimal("0.0000")), total_usd)
    remaining = _money(total_usd - down_payment)
    each = _round_payload_money_usd(remaining / count, payload) if count else remaining
    start = date_or_none(payload.get("firstDueDate")) or timezone.localdate()
    cycle = payload.get("cycle") or payload.get("installmentCycle") or "monthly"
    schedule = []
    running = Decimal("0.0000")
    for index in range(count):
        amount = each if index < count - 1 else _round_payload_money_usd(remaining - running, payload)
        running += amount
        if cycle == "weekly":
            due = start + timedelta(days=7 * index)
        elif cycle == "biweekly":
            due = start + timedelta(days=14 * index)
        else:
            due = _add_months(start, index)
        schedule.append({"number": index + 1, "amountUsd": amount, "dueDate": due})
    return schedule


def _installment_profit_source(payload):
    plan = payload.get("installmentPlan") if isinstance(payload.get("installmentPlan"), dict) else {}
    for key in ("profit", "installmentProfit"):
        if isinstance(payload.get(key), dict):
            return payload.get(key)
    profit = plan.get("profit")
    return profit if isinstance(profit, dict) else None


def _installment_profit_from_payload(payload, cash_total):
    source = _installment_profit_source(payload)
    if source is None:
        return None
    cash_total = _money(source.get("cashPriceUsd") or payload.get("cashPriceUsd") or cash_total)
    mode = "fixed" if source.get("mode") == "fixed" else "percent"
    percent = max(Decimal("0.0000"), decimal_or_zero(source.get("percent")))
    fixed = max(Decimal("0.0000"), _money(source.get("fixedAmountUsd") or source.get("fixedAmount") or 0))
    minimum = max(Decimal("0.0000"), _money(source.get("minAmountUsd") or source.get("minProfitAmountUsd") or 0))
    maximum = max(Decimal("0.0000"), _money(source.get("maxAmountUsd") or source.get("maxProfitAmountUsd") or 0))
    if maximum > 0 and maximum < minimum:
        raise FinanceServiceError("INVALID_PROFIT_LIMITS")
    profit = fixed if mode == "fixed" else _money(cash_total * percent / Decimal("100"))
    if minimum > 0:
        profit = max(profit, minimum)
    if maximum > 0:
        profit = min(profit, maximum)
    profit = _round_payload_money_usd(profit, payload)
    final_total = _round_payload_money_usd(cash_total + profit, payload)
    return {
        "mode": mode,
        "percent": float(percent),
        "fixedAmountUsd": float(fixed),
        "minAmountUsd": float(minimum),
        "maxAmountUsd": float(maximum),
        "cashPriceUsd": float(cash_total),
        "profitUsd": float(profit),
        "finalPriceUsd": float(final_total),
        "source": source.get("source") or "manual",
        "calculatedAt": source.get("calculatedAt") or timezone.now().isoformat(),
    }


def _installment_items_with_profit(items, cash_total, final_total):
    if not items or _money(cash_total) <= 0 or _money(cash_total) == _money(final_total):
        return items
    adjusted = []
    running = Decimal("0.0000")
    for index, line in enumerate(items):
        qty = _line_quantity(line)
        cash_line_total = _line_total(line)
        if index < len(items) - 1:
            line_total = _money(cash_line_total * _money(final_total) / _money(cash_total))
        else:
            line_total = _money(_money(final_total) - running)
        running += line_total
        line_price = _money(line_total / qty) if qty > 0 else line_total
        adjusted.append({
            **line,
            "cashPriceUsd": float(_line_price(line)),
            "cashTotalUsd": float(cash_line_total),
            "priceUsd": float(line_price),
            "totalUsd": float(line_total),
            "lineDiscountUsd": 0,
            "lineDiscountPercent": 0,
        })
    return adjusted


def create_installment_service(payload):
    with transaction.atomic():
        customer = Client.objects.filter(external_id=payload.get("customerId") or payload.get("clientId"), deleted_at__isnull=True).first()
        if not customer:
            raise FinanceServiceError("NO_CUSTOMER")
        invoice_payload = {**payload, "clientId": customer.external_id, "paidUsd": Decimal("0.0000")}
        cash_invoice_payload = dict(invoice_payload)
        if _installment_profit_source(payload) is not None:
            cash_invoice_payload.pop("subtotalUsd", None)
            cash_invoice_payload.pop("totalUsd", None)
        subtotal, discount, _paid, total, _remaining, _status = _invoice_totals(cash_invoice_payload)
        profit = _installment_profit_from_payload(payload, total)
        if profit:
            cash_total = _money(profit["cashPriceUsd"])
            total = _money(profit["finalPriceUsd"])
            invoice_payload["items"] = _installment_items_with_profit(invoice_payload.get("items") or [], cash_total, total)
            invoice_payload["subtotalUsd"] = float(total)
            invoice_payload["discountUsd"] = 0
            invoice_payload["totalUsd"] = float(total)
        down_payment = min(max(_money(payload.get("downPaymentUsd")), Decimal("0.0000")), total)
        installment_remaining = _money(total - down_payment)
        schedule = _build_installment_schedule(payload, total)
        plan = {
            "type": "installment",
            "cashPriceUsd": float(profit["cashPriceUsd"]) if profit else float(total),
            "profitUsd": float(profit["profitUsd"]) if profit else 0,
            "finalPriceUsd": float(total),
            "totalUsd": float(total),
            "downPaymentUsd": float(down_payment),
            "remainingUsd": float(installment_remaining),
            "schedule": [
                {
                    "number": item["number"],
                    "amountUsd": float(item["amountUsd"]),
                    "dueDate": item["dueDate"].isoformat() if item["dueDate"] else None,
                    "paidUsd": 0,
                    "status": "pending",
                }
                for item in schedule
            ],
        }
        if profit:
            plan["profit"] = profit
        invoice_payload["installmentPlan"] = plan
        invoice = _create_customer_invoice_service(invoice_payload)
        installments = [
            Installment.objects.create(
                external_id=f"{invoice.external_id}-INS-{item['number']}",
                invoice=invoice,
                client=customer,
                number=item["number"],
                amount_usd=item["amountUsd"],
                due_date=item["dueDate"],
            )
            for item in schedule
        ]
        if down_payment:
            applied_to = [{"invoiceId": invoice.external_id, "amountUsd": float(down_payment), "downPayment": True}]
            _create_customer_payment_record(
                customer=customer,
                amount_usd=down_payment,
                note=payload.get("downPaymentNote") or "Installment down payment",
                received_at=date_or_none(payload.get("receivedAt")),
                applied_to=applied_to,
                reference_id=payload.get("downPaymentId") or _timestamp_id("PAY"),
                entry_type=LedgerEntry.TYPE_PAYMENT_RECEIVED,
            )
            invoice.paid_usd = down_payment
            _refresh_invoice_payment_state(invoice)
        return invoice, installments


def _mark_installment_paid_in_plan(invoice, installment, amount):
    plan = invoice.installment_plan if isinstance(invoice.installment_plan, dict) else {}
    schedule = plan.get("schedule") if isinstance(plan.get("schedule"), list) else []
    for item in schedule:
        if int(item.get("number") or 0) != installment.number:
            continue
        item["paidUsd"] = float(_money(decimal_or_zero(item.get("paidUsd")) + amount))
        if decimal_or_zero(item.get("paidUsd")) >= installment.amount_usd - Decimal("0.0001"):
            item["paidUsd"] = float(installment.amount_usd)
            item["status"] = "paid"
            item["paidAt"] = timezone.localdate().isoformat()
        else:
            item["status"] = "partial"
    invoice.installment_plan = plan
    invoice.save(update_fields=["installment_plan"])


def installment_paid_usd(installment):
    total = LedgerEntry.objects.filter(
        entity_type=LedgerEntry.ENTITY_CUSTOMER,
        installment=installment,
        type=LedgerEntry.TYPE_INSTALLMENT_PAYMENT,
    ).aggregate(total=Sum("amount_usd"))["total"]
    return abs(_money(total or 0))


def list_installments_service(customer_id=None, invoice_id=None):
    qs = Installment.objects.select_related("client", "invoice").order_by("due_date", "number", "id")
    if customer_id:
        qs = qs.filter(client__external_id=customer_id)
    if invoice_id:
        qs = qs.filter(invoice__external_id=invoice_id)
    return qs


def create_debt_adjustment_service(payload):
    entity_type = payload.get("entityType") or (LedgerEntry.ENTITY_SUPPLIER if payload.get("supplierId") else LedgerEntry.ENTITY_CUSTOMER)
    amount = _money(payload.get("amountUsd") if payload.get("amountUsd") is not None else payload.get("amount"))
    if amount == 0:
        raise FinanceServiceError("INVALID_AMOUNT")
    with transaction.atomic():
        if entity_type == LedgerEntry.ENTITY_SUPPLIER:
            entity = Supplier.objects.filter(external_id=payload.get("supplierId"), deleted_at__isnull=True).first()
            if not entity:
                raise FinanceServiceError("NO_SUPPLIER")
        else:
            entity = Client.objects.filter(external_id=payload.get("customerId") or payload.get("clientId"), deleted_at__isnull=True).first()
            if not entity:
                raise FinanceServiceError("NO_CUSTOMER")
        return record_ledger_entry(
            entity_type=entity_type,
            entity=entity,
            amount_usd=amount,
            entry_type=LedgerEntry.TYPE_DEBT_ADJUSTMENT,
            reference_id=payload.get("id") or payload.get("externalId") or _timestamp_id("ADJ"),
            reference_model="debt_adjustment",
            metadata={"note": payload.get("note") or ""},
        )


def statement_service(entity_type, entity_id=None, *, limit=None, offset=0):
    qs = LedgerEntry.objects.select_related("customer", "supplier", "invoice", "purchase", "payment", "supplier_payment", "installment")
    if entity_type:
        qs = qs.filter(entity_type=entity_type)
    if entity_id:
        qs = qs.filter(entity_id=entity_id)
    total_count = qs.count()
    balance = _money(qs.aggregate(total=Sum("amount_usd"))["total"] or 0)
    ordered = qs.order_by("timestamp", "id")
    if limit is not None:
        offset_value = max(0, int(offset or 0))
        limit_value = max(0, int(limit or 0))
        entries = list(ordered[offset_value:offset_value + limit_value])
        if offset_value:
            prior_amounts = ordered.values_list("amount_usd", flat=True)[:offset_value]
            running = _money(sum((amount or Decimal("0.0000") for amount in prior_amounts), Decimal("0.0000")))
        else:
            running = Decimal("0.0000")
    else:
        entries = list(ordered)
        running = Decimal("0.0000")
    for entry in entries:
        running = _money(running + entry.amount_usd)
        entry.running_balance_usd = running
    return entries, balance, total_count


def ensure_customer_invoice_ledger(invoice):
    if not invoice.client:
        return None
    record_ledger_entry(
        entity_type=LedgerEntry.ENTITY_CUSTOMER,
        entity=invoice.client,
        amount_usd=invoice.total_usd,
        entry_type=LedgerEntry.TYPE_INVOICE_CREATED,
        reference_id=invoice.external_id,
        reference_model="invoice",
        timestamp=invoice.created_at,
        invoice=invoice,
        metadata={"paymentStatus": invoice.payment_status},
    )
    applied = Decimal("0.0000")
    for payment in ClientPayment.objects.filter(client=invoice.client):
        for item in payment.applied_to or []:
            if item.get("invoiceId") == invoice.external_id:
                applied += _money(item.get("amountUsd"))
    immediate_paid = max(Decimal("0.0000"), _money(invoice.paid_usd - applied))
    if immediate_paid:
        record_ledger_entry(
            entity_type=LedgerEntry.ENTITY_CUSTOMER,
            entity=invoice.client,
            amount_usd=-immediate_paid,
            entry_type=LedgerEntry.TYPE_PAYMENT_RECEIVED,
            reference_id=f"invoice-paid-{invoice.external_id}",
            reference_model="invoice_payment",
            timestamp=invoice.created_at,
            invoice=invoice,
            metadata={"invoiceId": invoice.external_id, "source": "invoice.paid_usd"},
        )


def ensure_supplier_invoice_ledger(purchase):
    if not purchase.supplier:
        return None
    record_ledger_entry(
        entity_type=LedgerEntry.ENTITY_SUPPLIER,
        entity=purchase.supplier,
        amount_usd=purchase.cost_usd,
        entry_type=LedgerEntry.TYPE_INVOICE_CREATED,
        reference_id=purchase.external_id,
        reference_model="purchase",
        timestamp=purchase.created_at,
        purchase=purchase,
        metadata={"paymentStatus": purchase.payment_status},
    )
    applied = Decimal("0.0000")
    for payment in SupplierPayment.objects.filter(supplier=purchase.supplier):
        for item in payment.applied_to or []:
            if item.get("purchaseId") == purchase.external_id:
                applied += _money(item.get("amountUsd"))
    immediate_paid = max(Decimal("0.0000"), _money(purchase.paid_usd - applied))
    if immediate_paid:
        record_ledger_entry(
            entity_type=LedgerEntry.ENTITY_SUPPLIER,
            entity=purchase.supplier,
            amount_usd=-immediate_paid,
            entry_type=LedgerEntry.TYPE_PAYMENT_RECEIVED,
            reference_id=f"purchase-paid-{purchase.external_id}",
            reference_model="purchase_payment",
            timestamp=purchase.created_at,
            purchase=purchase,
            metadata={"purchaseId": purchase.external_id, "source": "purchase.paid_usd"},
        )


def ensure_client_payment_ledger(payment):
    if not payment.client:
        return None
    installment_id = ""
    for item in payment.applied_to or []:
        installment_id = item.get("installmentId") or ""
        if installment_id:
            break
    installment = Installment.objects.filter(external_id=installment_id).first() if installment_id else None
    entry_type = LedgerEntry.TYPE_INSTALLMENT_PAYMENT if (installment or getattr(payment, "paymentKind", "") == "installment") else LedgerEntry.TYPE_PAYMENT_RECEIVED
    record_ledger_entry(
        entity_type=LedgerEntry.ENTITY_CUSTOMER,
        entity=payment.client,
        amount_usd=-payment.amount_usd,
        entry_type=entry_type,
        reference_id=payment.external_id,
        reference_model="payment",
        timestamp=payment.created_at,
        payment=payment,
        installment=installment,
        metadata={"appliedTo": payment.applied_to, "unappliedUsd": float(payment.unapplied_usd)},
    )


def ensure_supplier_payment_ledger(payment):
    if not payment.supplier:
        return None
    record_ledger_entry(
        entity_type=LedgerEntry.ENTITY_SUPPLIER,
        entity=payment.supplier,
        amount_usd=-payment.amount_usd,
        entry_type=LedgerEntry.TYPE_PAYMENT_RECEIVED,
        reference_id=payment.external_id,
        reference_model="supplier_payment",
        timestamp=payment.created_at,
        supplier_payment=payment,
        metadata={"appliedTo": payment.applied_to, "unappliedUsd": float(payment.unapplied_usd)},
    )


RESET_EMPTY_COLLECTIONS = (
    "warehouses",
    "suppliers",
    "products",
    "clients",
    "employees",
    "purchases",
    "invoices",
    "clientPayments",
    "supplierPayments",
    "accountMovements",
    "cashVouchers",
    "suspendedInvoices",
    "suspendedPurchases",
)

RESET_PRESERVED_SETTINGS = (
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
    "soundEnabled",
    "soundVolume",
    "soundPack",
    "unitPresets",
    "brands",
    "originCountries",
)


def _raw_delete_queryset(qs):
    return qs._raw_delete(qs.db)


def _reset_snapshot_payload(previous_snapshot=None, reset_at=None, data_generation=None):
    previous = previous_snapshot.data if previous_snapshot and isinstance(previous_snapshot.data, dict) else {}
    payload = {key: [] for key in RESET_EMPTY_COLLECTIONS}
    for key in RESET_PRESERVED_SETTINGS:
        if key in previous:
            payload[key] = previous.get(key)
    if payload.get("theme") not in {"tox-blue", "noir", "matte-black", "summer-orange", "emerald-ledger", "graphite-lime", "ruby-slate", "amethyst-control", "violet-night", "coffee", "neon-blue", "teal-slate"}:
        payload["theme"] = "tox-blue"
    if payload.get("lang") not in {"ar", "en"}:
        payload["lang"] = "ar"
    if payload.get("dir") not in {"rtl", "ltr"}:
        payload["dir"] = "rtl" if payload.get("lang") == "ar" else "ltr"
    payload.setdefault("theme", "tox-blue")
    payload.setdefault("lang", "ar")
    payload.setdefault("dir", "rtl")
    payload.setdefault("currency", "IQD")
    payload.setdefault("exchangeRate", float(_active_rate()))
    payload["dataGeneration"] = data_generation or _timestamp_id("reset")
    payload["dataResetAt"] = (reset_at or timezone.now()).isoformat()
    return payload


def _protected_reset_user_ids(request_user=None):
    protected_ids = set()
    if request_user and getattr(request_user, "is_authenticated", False):
        protected_ids.add(request_user.id)
    protected_ids.update(User.objects.filter(username="user").values_list("id", flat=True))
    protected_ids.update(User.objects.filter(is_superuser=True).values_list("id", flat=True))
    protected_ids.update(UserProfile.objects.filter(role="admin").values_list("user_id", flat=True))
    return {user_id for user_id in protected_ids if user_id}


def reset_system_service(*, requested_by=None, preserve_settings=True):
    reset_at = timezone.now()
    with transaction.atomic():
        previous_snapshot = AppSnapshot.objects.filter(key="default").first()
        generation = _timestamp_id("reset")
        snapshot_payload = _reset_snapshot_payload(
            previous_snapshot if preserve_settings else None,
            reset_at=reset_at,
            data_generation=generation,
        )

        protected_user_ids = _protected_reset_user_ids(requested_by)
        UserProfile.objects.filter(user_id__in=protected_user_ids).update(
            role="admin",
            permissions={},
            branch=None,
        )
        User.objects.filter(id__in=protected_user_ids).update(
            is_active=True,
            is_staff=True,
            is_superuser=True,
        )

        counts = {}
        for name, model in (
            ("ledgerEntries", LedgerEntry),
            ("loginEvents", LoginEvent),
            ("accountMovements", AccountMovement),
            ("returnItems", ReturnItem),
            ("returnDocuments", ReturnDocument),
            ("invoiceItems", InvoiceItem),
            ("purchaseItems", PurchaseItem),
            ("installments", Installment),
            ("clientPayments", ClientPayment),
            ("supplierPayments", SupplierPayment),
            ("invoices", Invoice),
            ("purchases", Purchase),
            ("stockMovements", StockMovement),
            ("stockBatches", StockBatch),
            ("productUnits", ProductUnit),
            ("products", Product),
            ("warehouses", Warehouse),
            ("clients", Client),
            ("suppliers", Supplier),
            ("employees", Employee),
            ("expenses", Expense),
            ("auditLogs", AuditLog),
        ):
            counts[name] = model.objects.count()
            if name == "ledgerEntries":
                _raw_delete_queryset(model.objects.all())
            else:
                model.objects.all().delete()

        removable_users = User.objects.exclude(id__in=protected_user_ids)
        counts["users"] = removable_users.count()
        removable_users.delete()

        snapshot, _created = AppSnapshot.objects.update_or_create(
            key="default",
            defaults={"data": snapshot_payload},
        )
        AuditLog.objects.create(
            action="system_reset",
            entity_type="system",
            entity_id="default",
            message="System data reset",
            data={
                "resetAt": reset_at.isoformat(),
                "dataGeneration": generation,
                "counts": counts,
                "requestedBy": getattr(requested_by, "username", "") if requested_by else "",
                "protectedUserIds": sorted(protected_user_ids),
            },
        )
    return {
        "ok": True,
        "resetAt": reset_at.isoformat(),
        "dataGeneration": generation,
        "counts": counts,
        "state": snapshot.data,
    }
