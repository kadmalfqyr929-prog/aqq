from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import F

from .models import Product, ProductUnit, StockBatch, StockMovement


STOCK_DECIMAL = Decimal("0.0001")


class StockError(ValueError):
    pass


class InsufficientStock(StockError):
    pass


def _decimal(value):
    return Decimal(str(value if value not in (None, "") else "0"))


def _quantize(value):
    return value.quantize(STOCK_DECIMAL, rounding=ROUND_HALF_UP)


def _get_product(product_id):
    queryset = Product.objects.select_for_update().select_related("warehouse")
    product = queryset.filter(external_id=product_id, deleted_at__isnull=True).first()
    if product:
        return product
    if str(product_id).isdigit():
        product = queryset.filter(pk=int(product_id), deleted_at__isnull=True).first()
    if not product:
        raise StockError("NO_PRODUCT")
    return product


def _get_unit(product, sales_unit_id):
    unit = ProductUnit.objects.filter(
        product=product,
        external_id=sales_unit_id,
        deleted_at__isnull=True,
    ).first()
    if unit:
        return unit
    if str(sales_unit_id).isdigit():
        unit = ProductUnit.objects.filter(
            product=product,
            pk=int(sales_unit_id),
            deleted_at__isnull=True,
        ).first()
    if not unit:
        raise StockError("NO_UNIT")
    return unit


def _consume_batches(product, storage_delta):
    remaining = storage_delta
    batches = (
        StockBatch.objects.select_for_update()
        .filter(product=product, warehouse=product.warehouse, is_closed=False, quantity__gt=0)
        .order_by(F("expiry_date").asc(nulls_last=True), "received_at", "id")
    )
    for batch in batches:
        if remaining <= 0:
            break
        consumed = min(batch.quantity, remaining)
        StockBatch.objects.filter(pk=batch.pk).update(
            quantity=F("quantity") - consumed,
            is_closed=batch.quantity <= consumed,
        )
        remaining -= consumed
    return remaining


@transaction.atomic
def adjust_stock(product_id, sales_unit_id, qty_sold, mode="DECREASE", note="", batch=None):
    product = _get_product(product_id)
    unit = _get_unit(product, sales_unit_id)
    quantity = _decimal(qty_sold)
    if quantity <= 0:
        raise StockError("INVALID_QUANTITY")

    stock_multiplier = _decimal(product.stock_unit_multiplier)
    unit_multiplier = _decimal(unit.multiplier)
    if stock_multiplier <= 0 or unit_multiplier <= 0:
        raise StockError("INVALID_MULTIPLIER")

    storage_delta = _quantize((quantity * unit_multiplier) / stock_multiplier)
    normalized_mode = str(mode or "DECREASE").upper()

    if normalized_mode == "DECREASE":
        updated = Product.objects.filter(
            pk=product.pk,
            stock_quantity__gte=storage_delta,
        ).update(stock_quantity=F("stock_quantity") - storage_delta)
        if not updated:
            raise InsufficientStock("INSUFFICIENT_STOCK")
        _consume_batches(product, storage_delta)
        movement_type = "sale"
        movement_quantity = -storage_delta
    elif normalized_mode == "INCREASE":
        Product.objects.filter(pk=product.pk).update(stock_quantity=F("stock_quantity") + storage_delta)
        if batch:
            StockBatch.objects.create(
                product=product,
                warehouse=product.warehouse,
                batch_code=batch.get("batch_code") or batch.get("batchCode") or "",
                quantity=storage_delta,
                purchase_cost_usd=_decimal(batch.get("purchase_cost_usd") or batch.get("purchaseCostUsd")),
                expiry_date=batch.get("expiry_date") or batch.get("expiryDate"),
            )
        movement_type = "purchase"
        movement_quantity = storage_delta
    else:
        raise StockError("INVALID_MODE")

    StockMovement.objects.create(
        product=product,
        warehouse=product.warehouse,
        movement_type=movement_type,
        quantity=movement_quantity,
        note=note
        or f"{normalized_mode}: {quantity} {unit.name} = {storage_delta} {product.stock_unit_name or product.base_unit}",
    )
    product.refresh_from_db()
    return product
