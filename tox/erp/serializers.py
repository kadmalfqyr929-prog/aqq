import json
from decimal import Decimal
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from .services import (
    balance_iqd,
    calculate_customer_balance,
    calculate_supplier_balance,
    installment_paid_usd,
)


class InvalidJsonBody(ValueError):
    """Raised when a request body declares JSON but cannot be decoded."""


def parse_json_body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        raise InvalidJsonBody("INVALID_JSON")


def decimal_or_zero(value, default="0"):
    try:
        return Decimal(str(value if value not in (None, "") else default))
    except Exception:
        return Decimal(default)


def expense_to_dict(expense):
    return {
        "id": expense.external_id,
        "title": expense.title,
        "category": expense.category,
        "amountUsd": float(expense.amount_usd),
        "currency": expense.currency,
        "exchangeRate": float(expense.exchange_rate),
        "paidAt": expense.paid_at.isoformat() if expense.paid_at else "",
        "note": expense.note,
        "createdAt": expense.created_at.isoformat() if expense.created_at else "",
    }


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


def datetime_or_none(value):
    if not value:
        return None
    if hasattr(value, "isoformat"):
        return value
    return parse_datetime(str(value))


def unit_to_dict(unit):
    return {
        "id": unit.external_id,
        "name": unit.name,
        "multiplier": float(unit.multiplier),
        "priceUsd": float(unit.price_usd),
        "priceCurrency": unit.price_currency,
        "barcode": unit.barcode,
    }


def _file_url(field):
    try:
        return field.url if field else ""
    except (ValueError, AttributeError):
        return ""


def product_image_to_dict(image):
    original = _file_url(image.original)
    large = _file_url(image.large) or original
    catalog = _file_url(image.catalog) or large
    thumb = _file_url(image.thumb) or catalog
    return {
        "id": image.external_id,
        "url": large,
        "image": large,
        "imageUrl": large,
        "largeUrl": large,
        "catalogUrl": catalog,
        "thumbUrl": thumb,
        "originalUrl": original or large,
        "sortOrder": image.sort_order,
        "isPrimary": bool(image.is_primary),
    }


def product_images_to_list(product):
    images = [product_image_to_dict(image) for image in product.images.all()]
    if images:
        primary_index = next((index for index, image in enumerate(images) if image.get("isPrimary")), 0)
        if primary_index:
            primary = images.pop(primary_index)
            images.insert(0, primary)
        return images
    if product.image:
        return [{
            "id": "legacy-image",
            "url": product.image,
            "image": product.image,
            "imageUrl": product.image,
            "largeUrl": product.image,
            "catalogUrl": product.image,
            "thumbUrl": product.image,
            "originalUrl": product.image,
            "sortOrder": 0,
            "isPrimary": True,
            "isLegacy": True,
        }]
    return []


def _nearest_open_batch_expiry(product):
    prefetched = getattr(product, "_prefetched_objects_cache", {}).get("batches")
    if prefetched is None:
        batch = (
            product.batches
            .filter(quantity__gt=0, is_closed=False, expiry_date__isnull=False)
            .order_by("expiry_date", "received_at", "id")
            .first()
        )
        return batch.expiry_date if batch else None
    candidates = [
        batch for batch in prefetched
        if batch.quantity > 0 and not batch.is_closed and batch.expiry_date
    ]
    if not candidates:
        return None
    return sorted(candidates, key=lambda batch: (batch.expiry_date, batch.received_at, batch.id))[0].expiry_date


def product_to_dict(product, saved_product=None):
    active_units = [unit for unit in product.units.all() if unit.deleted_at is None]
    saved_product = saved_product or {}
    stored_multiplier = decimal_or_zero(product.stock_unit_multiplier, "1") or Decimal("1")
    if stored_multiplier <= 0:
        stored_multiplier = Decimal("1")
    nearest_expiry = _nearest_open_batch_expiry(product)
    display_expiry = nearest_expiry or product.expires_at
    images = product_images_to_list(product)
    primary_image = images[0]["imageUrl"] if images else product.image
    return {
        "id": product.external_id,
        "name": product.name,
        "brand": product.brand,
        "originCountry": product.origin_country,
        "origin": product.origin_country,
        "kind": product.kind,
        "barcode": product.barcode,
        "sku": product.sku,
        "image": primary_image,
        "imageUrl": primary_image,
        "images": images,
        "warehouseId": product.warehouse.external_id,
        "currency": product.currency,
        "baseUnit": product.base_unit,
        "stockUnitName": product.stock_unit_name or saved_product.get("stockUnitName") or product.base_unit,
        "stockUnitMultiplier": float(stored_multiplier),
        "stockQuantityMode": product.stock_quantity_mode or "storage-main-unit-v1",
        "stockQuantity": float(product.stock_quantity),
        "purchaseCostUsd": float(product.purchase_cost_usd),
        "alertQuantity": float(product.alert_quantity),
        "preventNegativeSale": saved_product.get("preventNegativeSale", True) is not False,
        "expiryStart": product.expiry_start.isoformat() if product.expiry_start else None,
        "expiresAt": display_expiry.isoformat() if display_expiry else None,
        "nearestBatchExpiresAt": nearest_expiry.isoformat() if nearest_expiry else None,
        "deletedAt": product.deleted_at.isoformat() if product.deleted_at else None,
        "units": [unit_to_dict(unit) for unit in active_units],
    }


def warehouse_to_dict(warehouse):
    return {
        "id": warehouse.external_id,
        "name": warehouse.name,
        "code": warehouse.code,
        "zone": warehouse.zone,
        "manager": warehouse.manager,
        "color": warehouse.color or "#d6b35a",
        "note": warehouse.note,
        "deletedAt": warehouse.deleted_at.isoformat() if warehouse.deleted_at else None,
    }


def client_to_dict(client, balance_usd=None):
    if balance_usd is None:
        balance_usd = calculate_customer_balance(client)
    return {
        "id": client.external_id,
        "name": client.name,
        "phone": client.phone,
        "address": client.address,
        "image": client.image,
        "imageUrl": client.image,
        "debtLimitUsd": float(client.debt_limit_usd),
        "openingBalanceUsd": float(client.opening_balance_usd),
        "openingBalanceType": client.opening_balance_type,
        "financialNote": client.financial_note,
        "balanceUsd": float(balance_usd),
        "balanceIqd": float(balance_iqd(balance_usd)),
        "loyaltyPoints": client.loyalty_points,
        "note": client.note,
        "deletedAt": client.deleted_at.isoformat() if client.deleted_at else None,
    }


def supplier_to_dict(supplier, balance_usd=None):
    if balance_usd is None:
        balance_usd = calculate_supplier_balance(supplier)
    return {
        "id": supplier.external_id,
        "name": supplier.name,
        "phone": supplier.phone,
        "companyName": supplier.company_name,
        "email": supplier.email,
        "image": supplier.image,
        "imageUrl": supplier.image,
        "city": supplier.city,
        "openingBalanceUsd": float(supplier.opening_balance_usd),
        "openingBalanceType": supplier.opening_balance_type,
        "financialNote": supplier.financial_note,
        "balanceUsd": float(balance_usd),
        "balanceIqd": float(balance_iqd(balance_usd)),
        "note": supplier.note,
        "deletedAt": supplier.deleted_at.isoformat() if supplier.deleted_at else None,
    }


def employee_to_dict(employee):
    return {
        "id": employee.external_id,
        "userId": employee.user_id,
        "name": employee.name,
        "phone": employee.phone,
        "role": employee.role,
        "salary": float(employee.salary),
        "workHours": float(employee.work_hours),
        "deletedAt": employee.deleted_at.isoformat() if employee.deleted_at else None,
    }


def employee_payroll_to_dict(entry):
    return {
        "id": entry.id,
        "employeeId": entry.employee.external_id,
        "amountIqd": float(entry.amount_iqd),
        "note": entry.note,
        "createdAt": entry.created_at.isoformat(),
        "createdBy": entry.created_by.username if entry.created_by else "",
    }


def invoice_item_to_dict(item):
    product_image = ""
    if item.product:
        product_images = product_images_to_list(item.product)
        product_image = product_images[0]["imageUrl"] if product_images else item.product.image
    return {
        "productId": item.product.external_id if item.product else "",
        "productName": item.product.name if item.product else "",
        "productBrand": item.product.brand if item.product else "",
        "productImage": product_image,
        "warehouseId": item.warehouse.external_id if item.warehouse else "",
        "warehouseName": item.warehouse.name if item.warehouse else "",
        "unitId": item.unit_id,
        "unitName": item.unit_name,
        "qty": float(item.quantity),
        "quantity": float(item.quantity),
        "qtyInBase": float(item.qty_in_base),
        "priceUsd": float(item.price_usd),
        "totalUsd": float(item.total_usd),
        "unitCostUsd": float(item.unit_cost_usd),
        "totalCostUsd": float(item.total_cost_usd),
        "grossProfitUsd": float(item.gross_profit_usd),
        "costStatus": item.cost_status,
        "costBreakdown": item.cost_breakdown or [],
    }


def invoice_to_dict(invoice):
    kind = invoice.kind or ("installment" if (invoice.installment_plan or {}).get("type") == "installment" else "invoice")
    paid_usd = invoice.total_usd if kind == "direct_pos" else invoice.paid_usd
    remaining_usd = 0 if kind == "direct_pos" else invoice.remaining_usd
    payment_status = "paid" if kind == "direct_pos" and not invoice.voided_at and invoice.payment_status != "void" else invoice.payment_status
    return {
        "id": invoice.external_id,
        "clientId": invoice.client.external_id if invoice.client else None,
        "kind": kind,
        "type": kind,
        "title": invoice.title,
        "customerName": invoice.customer_name,
        "createdAt": invoice.created_at.isoformat(),
        "exchangeRate": float(invoice.exchange_rate),
        "subtotalUsd": float(invoice.subtotal_usd),
        "discountUsd": float(invoice.discount_usd),
        "paidUsd": float(paid_usd),
        "totalUsd": float(invoice.total_usd),
        "remainingUsd": float(remaining_usd),
        "paymentStatus": payment_status,
        "note": invoice.note,
        "isVoided": bool(invoice.voided_at),
        "voidedAt": invoice.voided_at.isoformat() if invoice.voided_at else None,
        "voidReason": invoice.void_reason,
        "installmentPlan": invoice.installment_plan or None,
        "returnedUsd": float(getattr(invoice, 'returned_total', 0) or 0),
        "items": [invoice_item_to_dict(item) for item in invoice.items.all()],
    }


def purchase_item_to_dict(item):
    product_image = ""
    if item.product:
        product_images = product_images_to_list(item.product)
        product_image = product_images[0]["imageUrl"] if product_images else item.product.image
    return {
        "productId": item.product.external_id if item.product else "",
        "productName": item.product.name if item.product else "",
        "productBrand": item.product.brand if item.product else "",
        "productImage": product_image,
        "warehouseId": item.warehouse.external_id if item.warehouse else "",
        "warehouseName": item.warehouse.name if item.warehouse else "",
        "quantity": float(item.quantity),
        "unitId": item.unit_id,
        "unitName": item.unit_name,
        "qtyInBase": float(item.qty_in_base),
        "unitCostUsd": float(item.unit_cost_usd),
        "totalUsd": float(item.total_usd),
        "supplierUnitCostUsd": float(item.supplier_unit_cost_usd),
        "baseUnitCostUsd": float(item.base_unit_cost_usd),
        "storageUnitCostUsd": float(item.storage_unit_cost_usd),
        "landedCostShareUsd": float(item.landed_cost_share_usd),
        "discountShareUsd": float(item.discount_share_usd),
        "batchCode": item.batch_code,
        "expiryDays": item.expiry_days,
        "expiresAt": item.expires_at.isoformat() if item.expires_at else None,
        "receivedAt": item.received_at.isoformat() if item.received_at else None,
    }


def purchase_to_dict(purchase):
    return {
        "id": purchase.external_id,
        "supplierId": purchase.supplier.external_id if purchase.supplier else None,
        "title": purchase.title,
        "supplierName": purchase.supplier_name,
        "createdAt": purchase.created_at.isoformat(),
        "exchangeRate": float(purchase.exchange_rate),
        "costUsd": float(purchase.cost_usd),
        "paidUsd": float(purchase.paid_usd),
        "remainingUsd": float(purchase.remaining_usd),
        "paymentStatus": purchase.payment_status,
        "isVoided": bool(purchase.voided_at),
        "voidedAt": purchase.voided_at.isoformat() if purchase.voided_at else None,
        "voidReason": purchase.void_reason,
        "note": purchase.note,
        "returnedUsd": float(getattr(purchase, 'returned_total', 0) or 0),
        "items": [purchase_item_to_dict(item) for item in purchase.items.all()],
    }


def return_item_to_dict(item):
    line_index = None
    if item.invoice_item_id and item.invoice_item and item.invoice_item.invoice_id:
        line_ids = list(item.invoice_item.invoice.items.order_by("id").values_list("id", flat=True))
        if item.invoice_item_id in line_ids:
            line_index = line_ids.index(item.invoice_item_id)
    elif item.purchase_item_id and item.purchase_item and item.purchase_item.purchase_id:
        line_ids = list(item.purchase_item.purchase.items.order_by("id").values_list("id", flat=True))
        if item.purchase_item_id in line_ids:
            line_index = line_ids.index(item.purchase_item_id)
    return {
        "lineIndex": line_index,
        "productId": item.product.external_id if item.product else "",
        "productName": item.product.name if item.product else "",
        "warehouseId": item.warehouse.external_id if item.warehouse else "",
        "warehouseName": item.warehouse.name if item.warehouse else "",
        "unitId": item.unit_id,
        "unitName": item.unit_name,
        "quantity": float(item.quantity),
        "qty": float(item.quantity),
        "qtyInBase": float(item.qty_in_base),
        "unitPriceUsd": float(item.unit_price_usd),
        "totalUsd": float(item.total_usd),
        "unitCostUsd": float(item.unit_cost_usd),
        "totalCostUsd": float(item.total_cost_usd),
        "condition": item.condition,
        "costBreakdown": item.cost_breakdown or [],
    }


def return_document_to_dict(return_document):
    source_id = return_document.invoice.external_id if return_document.invoice else return_document.purchase.external_id if return_document.purchase else ""
    return {
        "id": return_document.external_id,
        "returnType": return_document.return_type,
        "type": return_document.return_type,
        "sourceId": source_id,
        "invoiceId": return_document.invoice.external_id if return_document.invoice else None,
        "purchaseId": return_document.purchase.external_id if return_document.purchase else None,
        "clientId": return_document.client.external_id if return_document.client else None,
        "supplierId": return_document.supplier.external_id if return_document.supplier else None,
        "partyName": return_document.party_name,
        "exchangeRate": float(return_document.exchange_rate),
        "totalUsd": float(return_document.total_usd),
        "settlementMethod": return_document.settlement_method,
        "reason": return_document.reason,
        "note": return_document.note,
        "createdAt": return_document.created_at.isoformat(),
        "items": [return_item_to_dict(item) for item in return_document.items.all()],
    }


def client_payment_to_dict(payment):
    return {
        "id": payment.external_id,
        "clientId": payment.client.external_id if payment.client else None,
        "clientName": payment.client_name,
        "amountUsd": float(payment.amount_usd),
        "unappliedUsd": float(payment.unapplied_usd),
        "appliedTo": getattr(payment, "applied_to", []) or [],
        "note": payment.note,
        "receivedAt": payment.received_at.isoformat() if payment.received_at else None,
        "createdAt": payment.created_at.isoformat(),
    }


def supplier_payment_to_dict(payment):
    return {
        "id": payment.external_id,
        "supplierId": payment.supplier.external_id if payment.supplier else None,
        "supplierName": payment.supplier_name,
        "amountUsd": float(payment.amount_usd),
        "unappliedUsd": float(payment.unapplied_usd),
        "appliedTo": payment.applied_to or [],
        "note": payment.note,
        "paidAt": payment.paid_at.isoformat() if payment.paid_at else None,
        "createdAt": payment.created_at.isoformat(),
    }


def account_movement_to_dict(movement):
    return {
        "id": movement.external_id,
        "partyType": movement.party_type,
        "partyId": movement.party_id,
        "movementType": movement.movement_type,
        "title": movement.title,
        "debitUsd": float(movement.debit_usd),
        "creditUsd": float(movement.credit_usd),
        "balanceAfterUsd": float(movement.balance_after_usd),
        "referenceType": movement.reference_type,
        "referenceId": movement.reference_id,
        "note": movement.note,
        "data": movement.data,
        "createdAt": movement.created_at.isoformat(),
    }


def installment_to_dict(installment):
    paid = installment_paid_usd(installment)
    remaining = max(Decimal("0"), installment.amount_usd - paid)
    if remaining <= Decimal("0.0001"):
        status = "paid"
    elif paid > 0:
        status = "partial"
    else:
        status = "pending"
    return {
        "id": installment.external_id,
        "invoiceId": installment.invoice.external_id,
        "clientId": installment.client.external_id,
        "number": installment.number,
        "amountUsd": float(installment.amount_usd),
        "paidUsd": float(paid),
        "remainingUsd": float(remaining),
        "status": status,
        "dueDate": installment.due_date.isoformat() if installment.due_date else None,
        "note": installment.note,
        "createdAt": installment.created_at.isoformat(),
    }


def ledger_entry_to_dict(entry):
    data = {
        "id": entry.id,
        "entityType": entry.entity_type,
        "entityId": entry.entity_id,
        "amountUsd": float(entry.amount_usd),
        "type": entry.type,
        "referenceId": entry.reference_id,
        "referenceModel": entry.reference_model,
        "reversedEntryId": entry.reversed_entry_id,
        "metadata": entry.metadata,
        "timestamp": entry.timestamp.isoformat(),
    }
    if hasattr(entry, "running_balance_usd"):
        data["runningBalanceUsd"] = float(entry.running_balance_usd)
    return data
