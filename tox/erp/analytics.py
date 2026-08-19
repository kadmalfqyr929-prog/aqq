from calendar import monthrange
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db.models import Count, Max, Sum, Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from .models import (
    AccountMovement,
    AppSnapshot,
    AuditLog,
    Client,
    ClientPayment,
    Expense,
    Installment,
    Invoice,
    InvoiceItem,
    LedgerEntry,
    Product,
    ProductUnit,
    Purchase,
    ReturnDocument,
    ReturnItem,
    StockMovement,
    StockBatch,
    Supplier,
    SupplierPayment,
    Warehouse,
)
from .services import _money, balance_iqd, calculate_customer_balance, calculate_supplier_balance


_READINESS_BARCODE_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def _readiness_barcode(value):
    return "".join(str(value or "").translate(_READINESS_BARCODE_DIGITS).split()).casefold()


def _amount(value):
    return float(_money(value or 0))


def _format_iqd(value_usd):
    iqd = int(_money(balance_iqd(value_usd)).quantize(Decimal("1")))
    return f"{iqd:,} د.ع"


def _format_date_iq(value):
    if not value:
        return ""
    local_value = timezone.localtime(value) if hasattr(value, "tzinfo") else value
    return local_value.strftime("%Y/%m/%d %H:%M")


def _query_value(params, key, default=None):
    if not params:
        return default
    getter = getattr(params, "get", None)
    return getter(key, default) if getter else default


def _period_datetime(day, end=False):
    moment = datetime.combine(day, time.max if end else time.min)
    return timezone.make_aware(moment) if timezone.is_naive(moment) else moment


def analytics_period(params=None):
    today = timezone.localdate()
    raw_period = str(_query_value(params, "period", "all") or "all").strip().lower()
    if raw_period not in {"today", "week", "month", "last_month", "year", "last12", "custom", "all"}:
        raw_period = "all"
    start_date = None
    end_date = None
    if raw_period == "today":
        start_date = end_date = today
    elif raw_period == "week":
        start_date = today - timedelta(days=today.weekday())
        end_date = today
    elif raw_period == "month":
        start_date = today.replace(day=1)
        end_date = today
    elif raw_period == "last_month":
        last_month = _add_months(today.replace(day=1), -1)
        start_date = last_month
        end_date = last_month.replace(day=monthrange(last_month.year, last_month.month)[1])
    elif raw_period == "year":
        start_date = today.replace(month=1, day=1)
        end_date = today
    elif raw_period == "last12":
        start_date = _add_months(today.replace(day=1), -11)
        end_date = today
    elif raw_period == "custom":
        start_date = parse_date(str(_query_value(params, "start", "") or ""))
        end_date = parse_date(str(_query_value(params, "end", "") or ""))
        if not start_date and end_date:
            start_date = end_date
        if start_date and not end_date:
            end_date = today
        if start_date and end_date and start_date > end_date:
            start_date, end_date = end_date, start_date
    months = 6
    if start_date and end_date:
        months = max(1, min(24, (end_date.year - start_date.year) * 12 + end_date.month - start_date.month + 1))
    granularity = "day" if start_date and end_date and (end_date - start_date).days <= 45 else "month"
    return {
        "key": raw_period,
        "startDate": start_date.isoformat() if start_date else "",
        "endDate": end_date.isoformat() if end_date else "",
        "start": _period_datetime(start_date) if start_date else None,
        "end": _period_datetime(end_date, end=True) if end_date else None,
        "granularity": granularity,
        "months": months,
    }


def _filter_range(qs, field, period):
    start = (period or {}).get("start")
    end = (period or {}).get("end")
    if start:
        qs = qs.filter(**{f"{field}__gte": start})
    if end:
        qs = qs.filter(**{f"{field}__lte": end})
    return qs


def _analytics_filters(params=None):
    raw_kind = str(_query_value(params, "saleKind", "all") or "all").strip()
    if raw_kind not in {"all", "invoice", "direct_pos", "installment"}:
        raw_kind = "all"
    raw_source = str(_query_value(params, "costSource", "all") or "all").strip()
    if raw_source not in {"all", "fifo", "review"}:
        raw_source = "all"
    margin_min = _query_decimal(params, "marginMin")
    margin_max = _query_decimal(params, "marginMax")
    if margin_min is not None and margin_max is not None and margin_min > margin_max:
        margin_min, margin_max = margin_max, margin_min
    return {
        "saleKind": raw_kind,
        "costSource": raw_source,
        "q": str(_query_value(params, "q", "") or "").strip(),
        "marginMin": margin_min,
        "marginMax": margin_max,
    }


def _query_decimal(params, key):
    raw = str(_query_value(params, key, "") or "").strip()
    if raw == "":
        return None
    try:
        return Decimal(raw)
    except Exception:
        return None


def _apply_profit_filters_to_items(qs, filters):
    filters = filters or {}
    if filters.get("saleKind") and filters["saleKind"] != "all":
        qs = qs.filter(invoice__kind=filters["saleKind"])
    search = filters.get("q") or ""
    if search:
        qs = qs.filter(
            Q(invoice__external_id__icontains=search)
            | Q(invoice__customer_name__icontains=search)
            | Q(product__name__icontains=search)
            | Q(product__barcode__icontains=search)
            | Q(product__sku__icontains=search)
            | Q(warehouse__name__icontains=search)
            | Q(unit_name__icontains=search)
        )
    return qs


def _passes_profit_row_filters(row, filters):
    filters = filters or {}
    if filters.get("costSource") == "fifo" and row.get("costSource") != "fifo_ok":
        return False
    if filters.get("costSource") == "review" and row.get("costSource") == "fifo_ok":
        return False
    margin_key = "trustedGrossMargin" if row.get("costTrustStatus") == "trusted" else "grossMargin"
    margin = Decimal(str(row.get(margin_key, 0) or 0))
    margin_min = filters.get("marginMin")
    margin_max = filters.get("marginMax")
    if margin_min is not None and margin < margin_min:
        return False
    if margin_max is not None and margin > margin_max:
        return False
    return True


def _cost_trust_status(source):
    return "trusted" if source == "fifo_ok" else "needs_review"


def _trust_amounts(source, revenue, cogs, gross_profit):
    if source == "fifo_ok":
        return revenue, cogs, gross_profit, Decimal("0.0000")
    if source != "missing_cost":
        return revenue, cogs, gross_profit, gross_profit
    return Decimal("0.0000"), Decimal("0.0000"), Decimal("0.0000"), gross_profit


def _localized_money(value_usd):
    return {
        "valueUsd": _amount(value_usd),
        "valueIqd": _amount(balance_iqd(value_usd)),
        "formatted": _format_iqd(value_usd),
        "currency": "IQD",
        "locale": "ar-IQ",
        "dir": "rtl",
    }


def _localized_number(value):
    return {
        "value": _amount(value),
        "formatted": f"{_amount(value):g}",
        "locale": "ar-IQ",
        "dir": "rtl",
    }


_COST_SOURCES = ("fifo_ok", "repaired_from_purchase_cost", "estimated_from_product_cost", "missing_cost")


def _cost_source_for_batch_code(batch_code):
    code = str(batch_code or "").upper()
    if code.startswith("COST-AUTO-") or code.startswith("COST-REPAIR-"):
        return "repaired_from_purchase_cost"
    return "fifo_ok"


def _cost_source_from_item(item):
    if not item or (item.cost_status or "missing_cost") != "ok":
        return "missing_cost"
    breakdown = item.cost_breakdown if isinstance(item.cost_breakdown, list) else []
    if not breakdown:
        return "estimated_from_product_cost"
    sources = set()
    for entry in breakdown:
        if not isinstance(entry, dict):
            continue
        source = str(entry.get("source") or "").strip()
        if source:
            sources.add(source)
        batch_source = _cost_source_for_batch_code(entry.get("batchCode"))
        if batch_source != "fifo_ok":
            sources.add(batch_source)
    if "estimated_from_product_cost" in sources:
        return "estimated_from_product_cost"
    if "repaired_from_purchase_cost" in sources:
        return "repaired_from_purchase_cost"
    return "fifo_ok"


def _new_cost_source_counts():
    return {source: 0 for source in _COST_SOURCES}


def _add_cost_source(counts, source):
    normalized = source if source in _COST_SOURCES else "missing_cost"
    counts[normalized] = counts.get(normalized, 0) + 1


def _cost_source_status(counts):
    if counts.get("missing_cost", 0):
        return "missing_cost"
    if counts.get("estimated_from_product_cost", 0):
        return "estimated_from_product_cost"
    if counts.get("repaired_from_purchase_cost", 0):
        return "repaired_from_purchase_cost"
    return "fifo_ok"


def _cost_source_label_ar(source):
    return {
        "fifo_ok": "FIFO حقيقي",
        "repaired_from_purchase_cost": "كلفة مرممة",
        "estimated_from_product_cost": "كلفة تقديرية",
        "missing_cost": "نقص كلفة",
    }.get(source, source or "-")


def _cost_source_summary(counts):
    source = _cost_source_status(counts)
    return {
        "costSource": source,
        "costSourceLabelAr": _cost_source_label_ar(source),
        "costTrustStatus": _cost_trust_status(source),
        "fifoCostCount": counts.get("fifo_ok", 0),
        "repairedCostCount": counts.get("repaired_from_purchase_cost", 0),
        "estimatedCostCount": counts.get("estimated_from_product_cost", 0),
        "missingCostCount": counts.get("missing_cost", 0),
    }


def _revision_value(value):
    if not value:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _revision_part(model, *date_fields):
    aggregates = {"count": Count("id")}
    for field in date_fields:
        aggregates[f"max_{field}"] = Max(field)
    data = model.objects.aggregate(**aggregates)
    values = [str(data.get("count") or 0)]
    values.extend(_revision_value(data.get(f"max_{field}")) for field in date_fields)
    return ":".join(values)


def analytics_revision():
    parts = [
        _revision_part(Invoice, "created_at", "voided_at"),
        _revision_part(Purchase, "created_at", "voided_at"),
        _revision_part(ClientPayment, "created_at"),
        _revision_part(SupplierPayment, "created_at"),
        _revision_part(Expense, "created_at", "updated_at"),
        _revision_part(Product, "created_at", "updated_at", "deleted_at"),
        _revision_part(StockBatch, "received_at"),
        _revision_part(StockMovement, "created_at"),
        _revision_part(LedgerEntry, "timestamp"),
        _revision_part(AppSnapshot, "updated_at"),
    ]
    return "|".join(parts)


def _snapshot_voucher_expenses(period=None):
    """Return payment vouchers saved by the cashbox, scoped to a report period.

    Cash vouchers are part of the desktop state snapshot, while operational
    expenses can also be stored in the Expense model.  They are separate
    sources, so reporting must combine them instead of silently omitting cash
    disbursements such as shop rent.
    """
    snapshot = AppSnapshot.objects.filter(key="default").only("data").first()
    data = snapshot.data if snapshot and isinstance(snapshot.data, dict) else {}
    vouchers = data.get("cashVouchers", [])
    if not isinstance(vouchers, list):
        return Decimal("0.0000")

    start = (period or {}).get("start")
    end = (period or {}).get("end")
    total = Decimal("0.0000")
    for voucher in vouchers:
        if not isinstance(voucher, dict):
            continue
        voucher_type = str(voucher.get("type") or "").strip().lower()
        if voucher_type not in {"payment", "expense"}:
            continue
        try:
            amount = _money(Decimal(str(voucher.get("amountUsd") or 0)))
        except Exception:
            continue
        if amount <= 0:
            continue

        raw_date = voucher.get("createdAt") or voucher.get("date")
        paid_at = parse_datetime(str(raw_date or ""))
        if paid_at and timezone.is_naive(paid_at):
            paid_at = timezone.make_aware(paid_at)
        if not paid_at:
            voucher_day = parse_date(str(raw_date or ""))
            paid_at = _period_datetime(voucher_day) if voucher_day else None
        if (start or end) and not paid_at:
            continue
        if start and paid_at < start:
            continue
        if end and paid_at > end:
            continue
        total = _money(total + amount)
    return total


class LedgerAnalyticsService:
    """Financial analytics derived from immutable ledger entries."""

    def __init__(self, since=None, until=None):
        self.since = since
        self.until = until

    def ledger(self):
        qs = LedgerEntry.objects.all()
        if self.since:
            qs = qs.filter(timestamp__gte=self.since)
        if self.until:
            qs = qs.filter(timestamp__lte=self.until)
        return qs

    def revenue(self):
        qs = Invoice.objects.filter(voided_at__isnull=True)
        if self.since:
            qs = qs.filter(created_at__gte=self.since)
        if self.until:
            qs = qs.filter(created_at__lte=self.until)
        return _money(qs.aggregate(total=Sum("total_usd"))["total"] or 0)

    def customer_collections(self):
        total = (
            self.ledger()
            .filter(entity_type=LedgerEntry.ENTITY_CUSTOMER, type__in=[LedgerEntry.TYPE_PAYMENT_RECEIVED, LedgerEntry.TYPE_INSTALLMENT_PAYMENT])
            .aggregate(total=Sum("amount_usd"))["total"] or 0
        )
        return abs(_money(total))

    def purchase_cost(self):
        return _money(
            self.ledger()
            .filter(entity_type=LedgerEntry.ENTITY_SUPPLIER, type=LedgerEntry.TYPE_INVOICE_CREATED)
            .aggregate(total=Sum("amount_usd"))["total"] or 0
        )

    def supplier_payments(self):
        total = (
            self.ledger()
            .filter(entity_type=LedgerEntry.ENTITY_SUPPLIER, type=LedgerEntry.TYPE_PAYMENT_RECEIVED)
            .aggregate(total=Sum("amount_usd"))["total"] or 0
        )
        return abs(_money(total))

    def expenses(self):
        qs = Expense.objects.all()
        if self.since:
            qs = qs.filter(created_at__gte=self.since)
        if self.until:
            qs = qs.filter(created_at__lte=self.until)
        return _money(qs.aggregate(total=Sum("amount_usd"))["total"] or 0)

    def cogs(self):
        qs = InvoiceItem.objects.filter(invoice__voided_at__isnull=True, cost_status="ok")
        if self.since:
            qs = qs.filter(invoice__created_at__gte=self.since)
        if self.until:
            qs = qs.filter(invoice__created_at__lte=self.until)
        return _money(qs.aggregate(total=Sum("total_cost_usd"))["total"] or 0)

    def sale_returns(self):
        qs = ReturnDocument.objects.filter(return_type="sale_return")
        if self.since:
            qs = qs.filter(created_at__gte=self.since)
        if self.until:
            qs = qs.filter(created_at__lte=self.until)
        return _money(qs.aggregate(total=Sum("total_usd"))["total"] or 0)

    def purchase_returns(self):
        qs = ReturnDocument.objects.filter(return_type="purchase_return")
        if self.since:
            qs = qs.filter(created_at__gte=self.since)
        if self.until:
            qs = qs.filter(created_at__lte=self.until)
        return _money(qs.aggregate(total=Sum("total_usd"))["total"] or 0)

    def canceled_profit(self):
        qs = ReturnItem.objects.filter(return_document__return_type="sale_return")
        if self.since:
            qs = qs.filter(return_document__created_at__gte=self.since)
        if self.until:
            qs = qs.filter(return_document__created_at__lte=self.until)
        aggr = qs.aggregate(revenue=Sum("total_usd"), cogs=Sum("total_cost_usd"))
        rev = _money(aggr["revenue"] or 0)
        cogs = _money(aggr["cogs"] or 0)
        return _money(rev - cogs)

    def gross_profit(self):
        return _money(self.revenue() - self.cogs())

    def net_profit(self):
        return _money(self.gross_profit() - self.canceled_profit() - self.expenses())


def _percent(value):
    return int(max(0, min(100, round(float(value or 0)))))


def _ratio_percent(numerator, denominator):
    denominator = _money(denominator)
    if denominator <= 0:
        return 0
    return _percent((_money(numerator) / denominator) * 100)


def _markup_percent(profit, cogs):
    cogs = _money(cogs)
    if cogs <= 0:
        return 0
    return int(round(float((_money(profit) / cogs) * 100)))


def _installment_profit_from_invoice(invoice):
    if not invoice:
        return Decimal("0.0000")
    plan = invoice.installment_plan if isinstance(invoice.installment_plan, dict) else {}
    if invoice.kind != "installment" and plan.get("type") != "installment":
        return Decimal("0.0000")
    profit = plan.get("profitUsd")
    profit_block = plan.get("profit") if isinstance(plan.get("profit"), dict) else {}
    if profit in (None, ""):
        profit = profit_block.get("profitUsd")
    if profit in (None, ""):
        cash_price = plan.get("cashPriceUsd") or profit_block.get("cashPriceUsd")
        final_price = plan.get("finalPriceUsd") or plan.get("totalUsd") or profit_block.get("finalPriceUsd")
        if cash_price not in (None, "") and final_price not in (None, ""):
            profit = _money(final_price) - _money(cash_price)
    return max(Decimal("0.0000"), _money(profit))


def _installment_profit_for_item(item):
    invoice = getattr(item, "invoice", None)
    installment_profit = _installment_profit_from_invoice(invoice)
    invoice_total = _money(getattr(invoice, "total_usd", 0))
    if installment_profit <= 0 or invoice_total <= 0:
        return Decimal("0.0000")
    return _money(installment_profit * _money(item.total_usd) / invoice_total)


def _split_cash_and_installment_profit(gross_profit, installment_profit):
    installment_profit = _money(installment_profit)
    return _money(_money(gross_profit) - installment_profit), installment_profit


def _has_partial_profit_filters(filters):
    filters = filters or {}
    return any([
        filters.get("saleKind") not in (None, "", "all"),
        filters.get("costSource") not in (None, "", "all"),
        bool(filters.get("q")),
        filters.get("marginMin") is not None,
        filters.get("marginMax") is not None,
    ])


def _month_start(day):
    return day.replace(day=1)


def _add_months(day, months):
    month = day.month - 1 + months
    year = day.year + month // 12
    month = month % 12 + 1
    return day.replace(year=year, month=month, day=min(day.day, monthrange(year, month)[1]))


def _ledger_total(entity_type, entry_type=None, since=None):
    qs = LedgerEntry.objects.filter(entity_type=entity_type)
    if entry_type:
        qs = qs.filter(type=entry_type)
    if since:
        qs = qs.filter(timestamp__gte=since)
    return _money(qs.aggregate(total=Sum("amount_usd"))["total"] or 0)


def _daily_sales(days=14):
    today = timezone.localdate()
    start = today - timedelta(days=days - 1)
    totals = {start + timedelta(days=index): Decimal("0.0000") for index in range(days)}
    qs = LedgerEntry.objects.filter(
        entity_type=LedgerEntry.ENTITY_CUSTOMER,
        type=LedgerEntry.TYPE_INVOICE_CREATED,
        timestamp__date__gte=start,
    ).values("timestamp__date").annotate(total=Sum("amount_usd"))
    for item in qs:
        key = item["timestamp__date"]
        if key in totals:
            totals[key] = _money(item["total"])
    return [
        {"key": day.isoformat(), "label": day.strftime("%d/%m"), "valueUsd": _amount(total), "formatted": _format_iqd(total)}
        for day, total in totals.items()
    ]


def _monthly_sales(months=6):
    today = timezone.localdate()
    first_month = _add_months(_month_start(today), -(months - 1))
    buckets = {_add_months(first_month, index): Decimal("0.0000") for index in range(months)}
    qs = LedgerEntry.objects.filter(
        entity_type=LedgerEntry.ENTITY_CUSTOMER,
        type=LedgerEntry.TYPE_INVOICE_CREATED,
        timestamp__date__gte=first_month,
    ).values("timestamp__year", "timestamp__month").annotate(total=Sum("amount_usd"))
    for item in qs:
        key = first_month.replace(year=item["timestamp__year"], month=item["timestamp__month"])
        if key in buckets:
            buckets[key] = _money(item["total"])
    return [
        {"key": day.strftime("%Y-%m"), "label": day.strftime("%m/%Y"), "valueUsd": _amount(total), "formatted": _format_iqd(total)}
        for day, total in buckets.items()
    ]


def _trend_period_dates(period):
    today = timezone.localdate()
    start = parse_date(period.get("startDate") or "") if period else None
    end = parse_date(period.get("endDate") or "") if period else None
    if not start or not end:
        months = 6
        first_month = _add_months(_month_start(today), -(months - 1))
        return "month", first_month, today
    return period.get("granularity") or "month", start, end


def _day_buckets(start, end):
    days = max(1, (end - start).days + 1)
    return {start + timedelta(days=index): Decimal("0.0000") for index in range(days)}


def _month_buckets(start, end):
    first_month = _month_start(start)
    months = max(1, min(24, (end.year - first_month.year) * 12 + end.month - first_month.month + 1))
    return {_add_months(first_month, index): Decimal("0.0000") for index in range(months)}


def _sales_trend(period=None):
    granularity, start, end = _trend_period_dates(period or {})
    qs = _filter_range(Invoice.objects.filter(voided_at__isnull=True), "created_at", {
        "start": _period_datetime(start),
        "end": _period_datetime(end, end=True),
    })
    if granularity == "day":
        buckets = _day_buckets(start, end)
        data = qs.values("created_at__date").annotate(total=Sum("total_usd"))
        for item in data:
            key = item["created_at__date"]
            if key in buckets:
                buckets[key] = _money(item["total"])
        return [
            {"key": day.isoformat(), "label": day.strftime("%d/%m"), "valueUsd": _amount(total), "formatted": _format_iqd(total)}
            for day, total in buckets.items()
        ]
    buckets = _month_buckets(start, end)
    data = qs.values("created_at__year", "created_at__month").annotate(total=Sum("total_usd"))
    for item in data:
        key = _month_start(start).replace(year=item["created_at__year"], month=item["created_at__month"])
        if key in buckets:
            buckets[key] = _money(item["total"])
    return [
        {"key": day.strftime("%Y-%m"), "label": day.strftime("%m/%Y"), "valueUsd": _amount(total), "formatted": _format_iqd(total)}
        for day, total in buckets.items()
    ]


def _profit_trend(period=None):
    granularity, start, end = _trend_period_dates(period or {})
    qs = _filter_range(InvoiceItem.objects.select_related("invoice").filter(invoice__voided_at__isnull=True), "invoice__created_at", {
        "start": _period_datetime(start),
        "end": _period_datetime(end, end=True),
    })
    if granularity == "day":
        buckets = _day_buckets(start, end)
        for item in qs:
            if _cost_source_from_item(item) != "fifo_ok":
                continue
            key = timezone.localtime(item.invoice.created_at).date()
            if key in buckets:
                buckets[key] = _money(buckets[key] + _money(item.total_usd) - _money(item.total_cost_usd))
        return [
            {"key": day.isoformat(), "label": day.strftime("%d/%m"), "valueUsd": _amount(total), "formatted": _format_iqd(total)}
            for day, total in buckets.items()
        ]
    buckets = _month_buckets(start, end)
    for item in qs:
        if _cost_source_from_item(item) != "fifo_ok":
            continue
        created_at = timezone.localtime(item.invoice.created_at)
        key = _month_start(start).replace(year=created_at.year, month=created_at.month)
        if key in buckets:
            buckets[key] = _money(buckets[key] + _money(item.total_usd) - _money(item.total_cost_usd))
    return [
        {"key": day.strftime("%Y-%m"), "label": day.strftime("%m/%Y"), "valueUsd": _amount(total), "formatted": _format_iqd(total)}
        for day, total in buckets.items()
    ]


def _top_products(limit=6, period=None):
    qs = (
        InvoiceItem.objects.select_related("invoice", "product", "warehouse")
        .filter(invoice__voided_at__isnull=True)
    )
    qs = _filter_range(qs, "invoice__created_at", period or {})
    qs = (
        qs
        .values("product__external_id", "product__name", "warehouse__name")
        .annotate(total=Sum("total_usd"), quantity=Sum("quantity"))
        .order_by("-total")[:limit]
    )
    return [
        {
            "id": item["product__external_id"] or "",
            "name": item["product__name"] or "منتج غير محدد",
            "warehouse": item["warehouse__name"] or "",
            "totalUsd": _amount(item["total"]),
            "formattedTotal": _format_iqd(item["total"] or 0),
            "quantity": _amount(item["quantity"]),
        }
        for item in qs
    ]


def _invoice_profit_rows(limit=60, period=None, filters=None):
    item_qs = (
        InvoiceItem.objects.select_related("invoice", "product", "warehouse")
        .filter(invoice__voided_at__isnull=True)
    )
    item_qs = _filter_range(item_qs, "invoice__created_at", period or {})
    item_qs = _apply_profit_filters_to_items(item_qs, filters)
    invoice_ids = list(item_qs.values_list("invoice_id", flat=True).distinct())
    qs = Invoice.objects.filter(id__in=invoice_ids, voided_at__isnull=True)
    invoices = list(
        qs
        .annotate(
            item_revenue=Sum("items__total_usd"),
            item_cogs=Sum("items__total_cost_usd"),
            missing_cost_count=Count("items", filter=~Q(items__cost_status="ok")),
        )
        .order_by("-created_at", "-id")[:limit]
    )
    source_counts = {}
    trusted_totals = {}
    if invoices:
        invoice_ids = [invoice.id for invoice in invoices]
        for item in item_qs.filter(invoice_id__in=invoice_ids):
            counts = source_counts.setdefault(item.invoice_id, _new_cost_source_counts())
            source = _cost_source_from_item(item)
            _add_cost_source(counts, source)
            totals = trusted_totals.setdefault(item.invoice_id, {
                "allRevenue": Decimal("0.0000"),
                "allCogs": Decimal("0.0000"),
                "revenue": Decimal("0.0000"),
                "cogs": Decimal("0.0000"),
                "profit": Decimal("0.0000"),
                "estimatedProfit": Decimal("0.0000"),
            })
            revenue = _money(item.total_usd)
            cogs = _money(item.total_cost_usd)
            profit = _money(revenue - cogs)
            trusted_revenue, trusted_cogs, trusted_profit, estimated_profit = _trust_amounts(source, revenue, cogs, profit)
            totals["allRevenue"] = _money(totals["allRevenue"] + revenue)
            totals["allCogs"] = _money(totals["allCogs"] + cogs)
            totals["revenue"] = _money(totals["revenue"] + trusted_revenue)
            totals["cogs"] = _money(totals["cogs"] + trusted_cogs)
            totals["profit"] = _money(totals["profit"] + trusted_profit)
            totals["estimatedProfit"] = _money(totals["estimatedProfit"] + estimated_profit)
    rows = []
    for invoice in invoices:
        trusted = trusted_totals.get(invoice.id, {
            "allRevenue": _money(invoice.item_revenue if invoice.item_revenue is not None else invoice.total_usd),
            "allCogs": _money(invoice.item_cogs or 0),
            "revenue": Decimal("0.0000"),
            "cogs": Decimal("0.0000"),
            "profit": Decimal("0.0000"),
            "estimatedProfit": Decimal("0.0000"),
        })
        revenue = _money(trusted["allRevenue"])
        cogs = _money(trusted["allCogs"])
        gross_profit = _money(revenue - cogs)
        cash_sale_profit, installment_profit = _split_cash_and_installment_profit(
            gross_profit,
            _installment_profit_from_invoice(invoice),
        )
        margin = _ratio_percent(gross_profit, revenue)
        counts = source_counts.get(invoice.id, _new_cost_source_counts())
        source_summary = _cost_source_summary(counts)
        row = {
            "id": invoice.external_id,
            "customerName": invoice.customer_name,
            "kind": invoice.kind,
            "createdAt": invoice.created_at.isoformat(),
            "revenueUsd": _amount(revenue),
            "cogsUsd": _amount(cogs),
            "grossProfitUsd": _amount(gross_profit),
            "cashSaleProfitUsd": _amount(cash_sale_profit),
            "installmentProfitUsd": _amount(installment_profit),
            "trustedRevenueUsd": _amount(trusted["revenue"]),
            "trustedCogsUsd": _amount(trusted["cogs"]),
            "trustedGrossProfitUsd": _amount(trusted["profit"]),
            "estimatedGrossProfitUsd": _amount(trusted["estimatedProfit"]),
            "formattedRevenue": _format_iqd(revenue),
            "formattedCogs": _format_iqd(cogs),
            "formattedGrossProfit": _format_iqd(gross_profit),
            "formattedCashSaleProfit": _format_iqd(cash_sale_profit),
            "formattedInstallmentProfit": _format_iqd(installment_profit),
            "formattedTrustedGrossProfit": _format_iqd(trusted["profit"]),
            "formattedEstimatedGrossProfit": _format_iqd(trusted["estimatedProfit"]),
            "grossMargin": margin,
            "trustedGrossMargin": _ratio_percent(trusted["profit"], trusted["revenue"]),
            "grossMarkup": _markup_percent(gross_profit, cogs),
            "trustedMarkup": _markup_percent(trusted["profit"], trusted["cogs"]),
            "costTrustStatus": _cost_trust_status(source_summary["costSource"]),
            "costStatus": "missing_cost" if source_summary["costSource"] == "missing_cost" else "ok",
            **source_summary,
        }
        if _passes_profit_row_filters(row, filters):
            rows.append(row)
    return rows


def _product_profit_rows(limit=80, period=None, filters=None):
    qs = (
        InvoiceItem.objects.select_related("product", "warehouse")
        .filter(invoice__voided_at__isnull=True)
        .order_by("-invoice__created_at", "-id")
    )
    qs = _filter_range(qs, "invoice__created_at", period or {})
    qs = _apply_profit_filters_to_items(qs, filters)
    grouped = {}
    for item in qs:
        key = (
            item.product_id or 0,
            item.product.external_id if item.product else "",
            item.product.name if item.product else "منتج غير محدد",
            item.warehouse.name if item.warehouse else "",
            item.unit_name or "",
        )
        row = grouped.setdefault(key, {
            "revenue": Decimal("0.0000"),
            "cogs": Decimal("0.0000"),
            "quantity": Decimal("0.0000"),
            "trustedRevenue": Decimal("0.0000"),
            "trustedCogs": Decimal("0.0000"),
            "trustedProfit": Decimal("0.0000"),
            "estimatedProfit": Decimal("0.0000"),
            "cashSaleProfit": Decimal("0.0000"),
            "installmentProfit": Decimal("0.0000"),
            "returnQuantity": Decimal("0.0000"),
            "returnRevenue": Decimal("0.0000"),
            "returnCogs": Decimal("0.0000"),
            "counts": _new_cost_source_counts(),
        })
        revenue = _money(item.total_usd)
        cogs = _money(item.total_cost_usd)
        profit = _money(revenue - cogs)
        cash_sale_profit, installment_profit = _split_cash_and_installment_profit(profit, _installment_profit_for_item(item))
        source = _cost_source_from_item(item)
        trusted_revenue, trusted_cogs, trusted_profit, estimated_profit = _trust_amounts(source, revenue, cogs, profit)
        row["revenue"] = _money(row["revenue"] + revenue)
        row["cogs"] = _money(row["cogs"] + cogs)
        row["quantity"] = _money(row["quantity"] + _money(item.quantity))
        row["trustedRevenue"] = _money(row["trustedRevenue"] + trusted_revenue)
        row["trustedCogs"] = _money(row["trustedCogs"] + trusted_cogs)
        row["trustedProfit"] = _money(row["trustedProfit"] + trusted_profit)
        row["estimatedProfit"] = _money(row["estimatedProfit"] + estimated_profit)
        row["cashSaleProfit"] = _money(row["cashSaleProfit"] + cash_sale_profit)
        row["installmentProfit"] = _money(row["installmentProfit"] + installment_profit)
        _add_cost_source(row["counts"], source)

    # Process Returns
    returns_qs = ReturnItem.objects.select_related("product", "warehouse").filter(return_document__return_type="sale_return")
    returns_qs = _filter_range(returns_qs, "return_document__created_at", period or {})
    for item in returns_qs:
        key = (
            item.product_id or 0,
            item.product.external_id if item.product else "",
            item.product.name if item.product else "منتج غير محدد",
            item.warehouse.name if item.warehouse else "",
            item.unit_name or "",
        )
        if key in grouped:
            grouped[key]["returnQuantity"] = _money(grouped[key]["returnQuantity"] + _money(item.quantity))
            grouped[key]["returnRevenue"] = _money(grouped[key]["returnRevenue"] + _money(item.total_usd))
            grouped[key]["returnCogs"] = _money(grouped[key]["returnCogs"] + _money(item.total_cost_usd))

    rows = []
    for key, item in grouped.items():
        _, external_id, name, warehouse_name, unit_name = key
        revenue = _money(item["revenue"])
        cogs = _money(item["cogs"])
        gross_profit = _money(revenue - cogs)
        cash_sale_profit = _money(item["cashSaleProfit"])
        installment_profit = _money(item["installmentProfit"])
        source_summary = _cost_source_summary(item["counts"])
        row = {
            "id": external_id,
            "name": name,
            "warehouse": warehouse_name,
            "unitName": unit_name,
            "quantity": _amount(item["quantity"]),
            "revenueUsd": _amount(revenue),
            "cogsUsd": _amount(cogs),
            "grossProfitUsd": _amount(gross_profit),
            "cashSaleProfitUsd": _amount(cash_sale_profit),
            "installmentProfitUsd": _amount(installment_profit),
            "returnQuantity": _amount(item["returnQuantity"]),
            "returnRevenueUsd": _amount(item["returnRevenue"]),
            "canceledProfitUsd": _amount(item["returnRevenue"] - item["returnCogs"]),
            "netQuantity": _amount(item["quantity"] - item["returnQuantity"]),
            "netRevenueUsd": _amount(revenue - item["returnRevenue"]),
            "netProfitUsd": _amount(gross_profit - (item["returnRevenue"] - item["returnCogs"])),
            "trustedRevenueUsd": _amount(item["trustedRevenue"]),
            "trustedCogsUsd": _amount(item["trustedCogs"]),
            "trustedGrossProfitUsd": _amount(item["trustedProfit"]),
            "estimatedGrossProfitUsd": _amount(item["estimatedProfit"]),
            "formattedRevenue": _format_iqd(revenue),
            "formattedCogs": _format_iqd(cogs),
            "formattedGrossProfit": _format_iqd(gross_profit),
            "formattedCashSaleProfit": _format_iqd(cash_sale_profit),
            "formattedInstallmentProfit": _format_iqd(installment_profit),
            "formattedTrustedGrossProfit": _format_iqd(item["trustedProfit"]),
            "formattedEstimatedGrossProfit": _format_iqd(item["estimatedProfit"]),
            "grossMargin": _ratio_percent(gross_profit, revenue),
            "trustedGrossMargin": _ratio_percent(item["trustedProfit"], item["trustedRevenue"]),
            "grossMarkup": _markup_percent(gross_profit, cogs),
            "trustedMarkup": _markup_percent(item["trustedProfit"], item["trustedCogs"]),
            "costTrustStatus": _cost_trust_status(source_summary["costSource"]),
            **source_summary,
        }
        if _passes_profit_row_filters(row, filters):
            rows.append(row)
    rows.sort(key=lambda row: row["revenueUsd"], reverse=True)
    return rows[:limit]


def _profit_trust_summary(period=None, filters=None):
    qs = (
        InvoiceItem.objects.select_related("invoice", "product", "warehouse")
        .filter(invoice__voided_at__isnull=True)
    )
    qs = _filter_range(qs, "invoice__created_at", period or {})
    qs = _apply_profit_filters_to_items(qs, filters)
    totals = {
        "revenue": Decimal("0.0000"),
        "cogs": Decimal("0.0000"),
        "grossProfit": Decimal("0.0000"),
        "trustedRevenue": Decimal("0.0000"),
        "trustedCogs": Decimal("0.0000"),
        "trustedGrossProfit": Decimal("0.0000"),
        "estimatedGrossProfit": Decimal("0.0000"),
        "cashSaleProfit": Decimal("0.0000"),
        "installmentProfit": Decimal("0.0000"),
        "reviewRows": 0,
        "missingRows": 0,
        "rows": 0,
        "trustedRows": 0,
        "invoiceIds": set(),
        "trustedInvoiceIds": set(),
    }
    for item in qs:
        revenue = _money(item.total_usd)
        cogs = _money(item.total_cost_usd)
        profit = _money(revenue - cogs)
        cash_sale_profit, installment_profit = _split_cash_and_installment_profit(profit, _installment_profit_for_item(item))
        source = _cost_source_from_item(item)
        trusted_revenue, trusted_cogs, trusted_profit, estimated_profit = _trust_amounts(source, revenue, cogs, profit)
        if (filters or {}).get("costSource") == "fifo" and source != "fifo_ok":
            continue
        if (filters or {}).get("costSource") == "review" and source == "fifo_ok":
            continue
        filter_profit = trusted_profit if source == "fifo_ok" else profit
        filter_revenue = trusted_revenue if source == "fifo_ok" else revenue
        margin = Decimal(str(_ratio_percent(filter_profit, filter_revenue)))
        margin_min = (filters or {}).get("marginMin")
        margin_max = (filters or {}).get("marginMax")
        if margin_min is not None and margin < margin_min:
            continue
        if margin_max is not None and margin > margin_max:
            continue
        totals["revenue"] = _money(totals["revenue"] + revenue)
        totals["cogs"] = _money(totals["cogs"] + cogs)
        totals["grossProfit"] = _money(totals["grossProfit"] + profit)
        totals["cashSaleProfit"] = _money(totals["cashSaleProfit"] + cash_sale_profit)
        totals["installmentProfit"] = _money(totals["installmentProfit"] + installment_profit)
        totals["trustedRevenue"] = _money(totals["trustedRevenue"] + trusted_revenue)
        totals["trustedCogs"] = _money(totals["trustedCogs"] + trusted_cogs)
        totals["trustedGrossProfit"] = _money(totals["trustedGrossProfit"] + trusted_profit)
        totals["estimatedGrossProfit"] = _money(totals["estimatedGrossProfit"] + estimated_profit)
        totals["invoiceIds"].add(item.invoice_id)
        totals["rows"] += 1
        if source != "missing_cost":
            totals["trustedInvoiceIds"].add(item.invoice_id)
            totals["trustedRows"] += 1
        if source != "fifo_ok":
            totals["reviewRows"] += 1
            if source == "missing_cost":
                totals["missingRows"] += 1
    status = "trusted" if not totals["reviewRows"] else "needs_review"
    return {
        "revenue": totals["revenue"],
        "cogs": totals["cogs"],
        "grossProfit": totals["grossProfit"],
        "cashSaleProfit": totals["cashSaleProfit"],
        "installmentProfit": totals["installmentProfit"],
        "trustedRevenue": totals["trustedRevenue"],
        "trustedCogs": totals["trustedCogs"],
        "trustedGrossProfit": totals["trustedGrossProfit"],
        "estimatedGrossProfit": totals["estimatedGrossProfit"],
        "reviewRows": totals["reviewRows"],
        "missingRows": totals["missingRows"],
        "rows": totals["rows"],
        "trustedRows": totals["trustedRows"],
        "invoiceCount": len(totals["invoiceIds"]),
        "trustedInvoiceCount": len(totals["trustedInvoiceIds"]),
        "costTrustStatus": status,
        "trustedGrossMargin": _ratio_percent(totals["trustedGrossProfit"], totals["trustedRevenue"]),
        "trustedMarkup": _markup_percent(totals["trustedGrossProfit"], totals["trustedCogs"]),
        "profitConfidence": _ratio_percent(totals["trustedRows"], totals["rows"]),
        "grossMargin": _ratio_percent(totals["grossProfit"], totals["revenue"]),
        "grossMarkup": _markup_percent(totals["grossProfit"], totals["cogs"]),
    }


def _product_accounting_rows(limit=120):
    products = list(Product.objects.active().select_related("warehouse").prefetch_related("units").order_by("name", "id")[:limit])
    product_ids = [product.id for product in products]
    batch_data = {}
    for batch in StockBatch.objects.filter(product_id__in=product_ids, quantity__gt=0, is_closed=False).select_related("product"):
        row = batch_data.setdefault(batch.product_id, {
            "quantity": Decimal("0.0000"),
            "value": Decimal("0.0000"),
            "adjustmentBatches": 0,
        })
        row["quantity"] = _money(row["quantity"] + _money(batch.quantity))
        row["value"] = _money(row["value"] + _money(batch.quantity * batch.purchase_cost_usd))
        if _cost_source_for_batch_code(batch.batch_code) != "fifo_ok":
            row["adjustmentBatches"] += 1

    sales_data = {}
    for item in InvoiceItem.objects.select_related("invoice", "product").filter(product_id__in=product_ids, invoice__voided_at__isnull=True):
        row = sales_data.setdefault(item.product_id, {
            "revenue": Decimal("0.0000"),
            "cogs": Decimal("0.0000"),
            "trustedRevenue": Decimal("0.0000"),
            "trustedCogs": Decimal("0.0000"),
            "trustedProfit": Decimal("0.0000"),
            "estimatedProfit": Decimal("0.0000"),
            "cashSaleProfit": Decimal("0.0000"),
            "installmentProfit": Decimal("0.0000"),
            "quantity": Decimal("0.0000"),
            "qtyInBase": Decimal("0.0000"),
            "counts": _new_cost_source_counts(),
        })
        revenue = _money(item.total_usd)
        cogs = _money(item.total_cost_usd)
        profit = _money(revenue - cogs)
        cash_sale_profit, installment_profit = _split_cash_and_installment_profit(profit, _installment_profit_for_item(item))
        source = _cost_source_from_item(item)
        trusted_revenue, trusted_cogs, trusted_profit, estimated_profit = _trust_amounts(source, revenue, cogs, profit)
        row["revenue"] = _money(row["revenue"] + revenue)
        row["cogs"] = _money(row["cogs"] + cogs)
        row["trustedRevenue"] = _money(row["trustedRevenue"] + trusted_revenue)
        row["trustedCogs"] = _money(row["trustedCogs"] + trusted_cogs)
        row["trustedProfit"] = _money(row["trustedProfit"] + trusted_profit)
        row["estimatedProfit"] = _money(row["estimatedProfit"] + estimated_profit)
        row["cashSaleProfit"] = _money(row["cashSaleProfit"] + cash_sale_profit)
        row["installmentProfit"] = _money(row["installmentProfit"] + installment_profit)
        row["quantity"] = _money(row["quantity"] + _money(item.quantity))
        row["qtyInBase"] = _money(row["qtyInBase"] + _money(item.qty_in_base))
        _add_cost_source(row["counts"], source)

    rows = []
    for product in products:
        units = [unit for unit in product.units.all() if unit.deleted_at is None]
        stock_quantity = _money(product.stock_quantity)
        stock_multiplier = _money(product.stock_unit_multiplier or 0)
        batch = batch_data.get(product.id, {"quantity": Decimal("0.0000"), "value": Decimal("0.0000"), "adjustmentBatches": 0})
        sold = sales_data.get(product.id, {
            "revenue": Decimal("0.0000"),
            "cogs": Decimal("0.0000"),
            "trustedRevenue": Decimal("0.0000"),
            "trustedCogs": Decimal("0.0000"),
            "trustedProfit": Decimal("0.0000"),
            "estimatedProfit": Decimal("0.0000"),
            "cashSaleProfit": Decimal("0.0000"),
            "installmentProfit": Decimal("0.0000"),
            "quantity": Decimal("0.0000"),
            "qtyInBase": Decimal("0.0000"),
            "counts": _new_cost_source_counts(),
        })
        batch_quantity = _money(batch["quantity"])
        fifo_gap = _money(stock_quantity - batch_quantity)
        base_units = [unit for unit in units if _money(unit.multiplier) == Decimal("1.0000")]
        has_storage_unit = stock_multiplier <= 1 or any(_money(unit.multiplier) == stock_multiplier for unit in units)
        priced_units = [unit for unit in units if _money(unit.price_usd) > 0]
        if not units:
            unit_status = "missing_sales_unit"
            unit_status_label = "لا توجد وحدة بيع"
        elif not base_units:
            unit_status = "missing_base_unit"
            unit_status_label = "لا توجد وحدة ×1"
        elif not has_storage_unit:
            unit_status = "missing_storage_unit"
            unit_status_label = "وحدة التخزين غير موجودة للبيع"
        elif len(priced_units) < len(units):
            unit_status = "unit_price_missing"
            unit_status_label = "وحدات بسعر صفر"
        else:
            unit_status = "ok"
            unit_status_label = "الوحدات جاهزة"

        if product.barcode or any(unit.barcode for unit in units):
            barcode_status = "ok"
            barcode_status_label = "باركود موجود"
        elif base_units:
            barcode_status = "base_missing"
            barcode_status_label = "البيع المفرد بلا باركود"
        else:
            barcode_status = "missing"
            barcode_status_label = "بلا باركود"

        if fifo_gap > Decimal("0.0001"):
            inventory_status = "stock_greater_than_batches"
            inventory_status_label = "المخزون أكبر من FIFO"
        elif fifo_gap < Decimal("-0.0001"):
            inventory_status = "batches_greater_than_stock"
            inventory_status_label = "FIFO أكبر من المخزون"
        elif batch["adjustmentBatches"]:
            inventory_status = "repaired"
            inventory_status_label = "توجد دفعات مرممة"
        else:
            inventory_status = "ok"
            inventory_status_label = "مطابق"

        revenue = _money(sold["revenue"])
        cogs = _money(sold["cogs"])
        gross_profit = _money(revenue - cogs)
        trusted_revenue = _money(sold["trustedRevenue"])
        trusted_cogs = _money(sold["trustedCogs"])
        trusted_profit = _money(sold["trustedProfit"])
        estimated_profit = _money(sold["estimatedProfit"])
        cash_sale_profit = _money(sold["cashSaleProfit"])
        installment_profit = _money(sold["installmentProfit"])
        rows.append({
            "id": product.external_id,
            "name": product.name,
            "warehouse": product.warehouse.name if product.warehouse_id else "",
            "stockUnitName": product.stock_unit_name or product.base_unit,
            "stockUnitMultiplier": _amount(stock_multiplier),
            "stockQuantity": _amount(stock_quantity),
            "batchQuantity": _amount(batch_quantity),
            "fifoGapQuantity": _amount(fifo_gap),
            "inventoryValueUsd": _amount(batch["value"]),
            "formattedInventoryValue": _format_iqd(batch["value"]),
            "purchaseCostUsd": _amount(product.purchase_cost_usd),
            "formattedPurchaseCost": _format_iqd(product.purchase_cost_usd),
            "quantitySold": _amount(sold["quantity"]),
            "qtyInBaseSold": _amount(sold["qtyInBase"]),
            "revenueUsd": _amount(revenue),
            "cogsUsd": _amount(cogs),
            "grossProfitUsd": _amount(gross_profit),
            "cashSaleProfitUsd": _amount(cash_sale_profit),
            "installmentProfitUsd": _amount(installment_profit),
            "trustedRevenueUsd": _amount(trusted_revenue),
            "trustedCogsUsd": _amount(trusted_cogs),
            "trustedGrossProfitUsd": _amount(trusted_profit),
            "estimatedGrossProfitUsd": _amount(estimated_profit),
            "formattedRevenue": _format_iqd(revenue),
            "formattedCogs": _format_iqd(cogs),
            "formattedGrossProfit": _format_iqd(gross_profit),
            "formattedCashSaleProfit": _format_iqd(cash_sale_profit),
            "formattedInstallmentProfit": _format_iqd(installment_profit),
            "formattedTrustedGrossProfit": _format_iqd(trusted_profit),
            "formattedEstimatedGrossProfit": _format_iqd(estimated_profit),
            "grossMargin": _ratio_percent(gross_profit, revenue),
            "trustedGrossMargin": _ratio_percent(trusted_profit, trusted_revenue),
            "grossMarkup": _markup_percent(gross_profit, cogs),
            "trustedMarkup": _markup_percent(trusted_profit, trusted_cogs),
            "inventoryStatus": inventory_status,
            "inventoryStatusLabelAr": inventory_status_label,
            "unitStatus": unit_status,
            "unitStatusLabelAr": unit_status_label,
            "barcodeStatus": barcode_status,
            "barcodeStatusLabelAr": barcode_status_label,
            "adjustmentBatchCount": batch["adjustmentBatches"],
            **_cost_source_summary(sold["counts"]),
        })
    return rows


def _stock_batch_rows(limit=100):
    rows = []
    qs = (
        StockBatch.objects.select_related("product", "warehouse")
        .filter(quantity__gt=0, is_closed=False)
        .order_by("received_at", "id")[:limit]
    )
    for batch in qs:
        value = _money(batch.quantity * batch.purchase_cost_usd)
        rows.append({
            "id": batch.id,
            "batchCode": batch.batch_code or str(batch.id),
            "productId": batch.product.external_id,
            "productName": batch.product.name,
            "warehouse": batch.warehouse.name,
            "quantity": _amount(batch.quantity),
            "unitCostUsd": _amount(batch.purchase_cost_usd),
            "totalValueUsd": _amount(value),
            "costSource": _cost_source_for_batch_code(batch.batch_code),
            "costSourceLabelAr": _cost_source_label_ar(_cost_source_for_batch_code(batch.batch_code)),
            "formattedUnitCost": _format_iqd(batch.purchase_cost_usd),
            "formattedTotalValue": _format_iqd(value),
            "receivedAt": batch.received_at.isoformat(),
            "expiryDate": batch.expiry_date.isoformat() if batch.expiry_date else None,
        })
    return rows


def _inventory_value():
    total = Decimal("0.0000")
    for batch in StockBatch.objects.filter(quantity__gt=0, is_closed=False, product__deleted_at__isnull=True):
        total = _money(total + _money(batch.quantity * batch.purchase_cost_usd))
    return total


def _missing_cost_rows(limit=80):
    rows = []
    item_qs = (
        InvoiceItem.objects.select_related("invoice", "product", "warehouse")
        .filter(invoice__voided_at__isnull=True)
        .exclude(cost_status="ok")
        .order_by("-invoice__created_at", "-id")[:limit]
    )
    for item in item_qs:
        rows.append({
            "type": "invoice_item",
            "invoiceId": item.invoice.external_id,
            "productId": item.product.external_id if item.product else "",
            "productName": item.product.name if item.product else "منتج غير محدد",
            "warehouse": item.warehouse.name if item.warehouse else "",
            "quantity": _amount(item.quantity),
            "revenueUsd": _amount(item.total_usd),
            "reason": item.cost_status or "missing_cost",
        })
    if len(rows) < limit:
        product_qs = (
            Product.objects.active()
            .select_related("warehouse")
            .filter(stock_quantity__gt=0)
            .filter(Q(purchase_cost_usd__lte=0) | ~Q(batches__quantity__gt=0, batches__is_closed=False))
            .distinct()
            .order_by("name")[: max(0, limit - len(rows))]
        )
        for product in product_qs:
            reason = "missing_default_cost" if product.purchase_cost_usd <= 0 else "missing_fifo_batch"
            rows.append({
                "type": "product",
                "invoiceId": "",
                "productId": product.external_id,
                "productName": product.name,
                "warehouse": product.warehouse.name if product.warehouse_id else "",
                "quantity": _amount(product.stock_quantity),
                "revenueUsd": 0,
                "reason": reason,
            })
    return rows


def _readiness_issue(code, severity, title_ar, title_en, *, product=None, details=None, action_ar="", action_en=""):
    return {
        "code": code,
        "severity": severity,
        "titleAr": title_ar,
        "titleEn": title_en,
        "productId": product.external_id if product else "",
        "productName": product.name if product else "",
        "warehouse": product.warehouse.name if product and product.warehouse_id else "",
        "details": details or {},
        "actionAr": action_ar,
        "actionEn": action_en,
    }


def _latest_backup_summary():
    try:
        import desktop_config

        backup_dir = getattr(desktop_config, "BACKUP_DIR", None)
        if not backup_dir or not backup_dir.exists():
            return {"status": "warning", "lastBackupAt": "", "messageAr": "لا توجد نسخة احتياطية محفوظة.", "messageEn": "No saved backup was found."}
        files = [item for item in backup_dir.iterdir() if item.is_file() and item.suffix.lower() in {".json", ".zip", ".sqlite3"}]
        if not files:
            return {"status": "warning", "lastBackupAt": "", "messageAr": "لا توجد نسخة احتياطية محفوظة.", "messageEn": "No saved backup was found."}
        latest = max(files, key=lambda item: item.stat().st_mtime)
        latest_time = datetime.fromtimestamp(latest.stat().st_mtime, tz=timezone.get_current_timezone())
        age_days = max(0, (timezone.now() - latest_time).days)
        status = "ok" if age_days <= 1 else "warning"
        return {
            "status": status,
            "lastBackupAt": latest_time.isoformat(),
            "lastBackupName": latest.name,
            "ageDays": age_days,
            "messageAr": "آخر نسخة احتياطية حديثة." if status == "ok" else "النسخة الاحتياطية قديمة؛ صدّر نسخة جديدة.",
            "messageEn": "Latest backup is recent." if status == "ok" else "Backup is old; export a new backup.",
        }
    except Exception as error:
        return {"status": "warning", "lastBackupAt": "", "messageAr": "تعذر قراءة حالة النسخ الاحتياطي.", "messageEn": "Could not read backup status.", "error": str(error)}


def _readiness_barcode_issues(products):
    owners = {}
    issues = []

    def add_owner(barcode, owner):
        if not barcode:
            return
        previous = owners.get(barcode)
        if previous and previous["label"] != owner["label"]:
            issues.append(
                _readiness_issue(
                    "duplicate_barcode",
                    "critical",
                    "باركود مكرر",
                    "Duplicate barcode",
                    product=owner.get("product"),
                    details={
                        "barcode": barcode,
                        "first": previous["label"],
                        "second": owner["label"],
                    },
                    action_ar="غيّر الباركود من المنتج أو وحدة البيع قبل الاعتماد التجاري.",
                    action_en="Change one of the duplicated barcodes before commercial use.",
                )
            )
            return
        owners[barcode] = owner

    for product in products:
        add_owner(_readiness_barcode(product.barcode), {"product": product, "label": f"product:{product.external_id}"})
        for unit in product.units.all():
            if unit.deleted_at is not None:
                continue
            add_owner(_readiness_barcode(unit.barcode), {"product": product, "label": f"unit:{product.external_id}:{unit.external_id}"})
    return issues


def system_readiness_payload(limit=120):
    products = list(Product.objects.active().select_related("warehouse").prefetch_related("units").order_by("name", "id"))
    open_batch_totals = {
        item["product_id"]: _money(item["total"] or 0)
        for item in StockBatch.objects.filter(quantity__gt=0, is_closed=False, product__deleted_at__isnull=True)
        .values("product_id")
        .annotate(total=Sum("quantity"))
    }
    invoice_missing_count = InvoiceItem.objects.filter(invoice__voided_at__isnull=True).exclude(cost_status="ok").count()
    issues = []

    if invoice_missing_count:
        issues.append(
            _readiness_issue(
                "invoice_missing_cost",
                "critical",
                "فواتير فيها كلفة ناقصة",
                "Invoices have missing cost",
                details={"count": invoice_missing_count},
                action_ar="شغّل ترميم كلف الفواتير وراجع نواقص الكلفة قبل اعتماد الربح.",
                action_en="Repair invoice costs and review missing-cost rows before trusting profit.",
            )
        )

    issues.extend(_readiness_barcode_issues(products))

    for product in products:
        units = [unit for unit in product.units.all() if unit.deleted_at is None]
        stock_quantity = _money(product.stock_quantity)
        stock_multiplier = _money(product.stock_unit_multiplier or 0)
        batch_total = open_batch_totals.get(product.id, Decimal("0.0000"))

        if _money(product.purchase_cost_usd) <= 0 and stock_quantity > 0:
            issues.append(
                _readiness_issue(
                    "missing_purchase_cost",
                    "critical",
                    "منتج فيه مخزون بلا سعر شراء",
                    "Product has stock without purchase cost",
                    product=product,
                    details={"stockQuantity": _amount(stock_quantity)},
                    action_ar="أدخل سعر شراء حتى يحسب النظام COGS والربح الحقيقي.",
                    action_en="Enter purchase cost so COGS and real profit can be calculated.",
                )
            )

        if stock_multiplier <= 0:
            issues.append(
                _readiness_issue(
                    "invalid_stock_multiplier",
                    "critical",
                    "معامل وحدة التخزين غير صحيح",
                    "Invalid stock unit multiplier",
                    product=product,
                    details={"stockUnitMultiplier": _amount(stock_multiplier)},
                    action_ar="اضبط معامل وحدة التخزين إلى رقم أكبر من صفر.",
                    action_en="Set the stock unit multiplier to a value greater than zero.",
                )
            )

        if not units:
            issues.append(
                _readiness_issue(
                    "missing_sales_unit",
                    "critical",
                    "المنتج بلا وحدة بيع",
                    "Product has no sales unit",
                    product=product,
                    action_ar="أنشئ وحدة بيع أساس، مثل قطعة × 1.",
                    action_en="Create a base sales unit, such as piece × 1.",
                )
            )
        elif not any(_money(unit.multiplier) == Decimal("1.0000") for unit in units):
            issues.append(
                _readiness_issue(
                    "missing_base_unit",
                    "warning",
                    "لا توجد وحدة بيع أساس ×1",
                    "Missing base sales unit ×1",
                    product=product,
                    action_ar="أضف وحدة قطعة/مفرد بمعامل 1 حتى يكون البيع الجزئي واضحاً.",
                    action_en="Add a piece/base unit with multiplier 1 for clear partial sales.",
                )
            )
        for unit in units:
            unit_multiplier = _money(unit.multiplier)
            if unit_multiplier <= 0:
                issues.append(
                    _readiness_issue(
                        "invalid_sales_unit_multiplier",
                        "critical",
                        "معامل وحدة بيع غير صحيح",
                        "Invalid sales unit multiplier",
                        product=product,
                        details={"unitId": unit.external_id, "unitName": unit.name, "multiplier": _amount(unit_multiplier)},
                        action_ar="عدّل معامل وحدة البيع إلى رقم أكبر من صفر حتى لا ينكسر حساب الكمية والكلفة.",
                        action_en="Set the sales unit multiplier to a value greater than zero.",
                    )
                )
            if _money(unit.price_usd) <= 0:
                issues.append(
                    _readiness_issue(
                        "unit_price_missing",
                        "warning",
                        "وحدة بيع بلا سعر",
                        "Sales unit has no price",
                        product=product,
                        details={"unitId": unit.external_id, "unitName": unit.name},
                        action_ar="أدخل سعر بيع لكل وحدة قابلة للبيع حتى لا تُباع بسعر صفر.",
                        action_en="Enter a price for every sellable unit so it cannot be sold for zero.",
                    )
                )

        if stock_quantity > 0 and batch_total + Decimal("0.0001") < stock_quantity and _money(product.purchase_cost_usd) > 0:
            issues.append(
                _readiness_issue(
                    "missing_fifo_batch",
                    "warning",
                    "المخزون أكبر من دفعات الكلفة",
                    "Stock is greater than open cost batches",
                    product=product,
                    details={
                        "stockQuantity": _amount(stock_quantity),
                        "batchQuantity": _amount(batch_total),
                        "missingQuantity": _amount(stock_quantity - batch_total),
                    },
                    action_ar="شغّل repair_stock_cost_batches أو افتح المنتج للتأكد من كلفة المخزون.",
                    action_en="Run repair_stock_cost_batches or review the product inventory cost.",
                )
            )
        if batch_total > stock_quantity + Decimal("0.0001"):
            issues.append(
                _readiness_issue(
                    "excess_fifo_batch",
                    "warning",
                    "دفعات الكلفة أكبر من المخزون",
                    "Open cost batches exceed product stock",
                    product=product,
                    details={
                        "stockQuantity": _amount(stock_quantity),
                        "batchQuantity": _amount(batch_total),
                        "excessQuantity": _amount(batch_total - stock_quantity),
                    },
                    action_ar="راجع حركة المخزون أو الفواتير الملغاة لأن قيمة المخزون قد تكون أعلى من الواقع.",
                    action_en="Review stock movements or voided invoices because inventory value may be overstated.",
                )
            )

        if stock_multiplier > 1 and units:
            has_storage_unit = any(_money(unit.multiplier) == stock_multiplier for unit in units)
            if not has_storage_unit:
                issues.append(
                    _readiness_issue(
                        "missing_storage_sales_unit",
                        "warning",
                        "لا توجد وحدة بيع تطابق وحدة التخزين",
                        "No sales unit matches the storage unit",
                        product=product,
                        details={"stockUnitName": product.stock_unit_name, "stockUnitMultiplier": _amount(stock_multiplier)},
                        action_ar="أضف وحدة كارتون/صندوق بنفس معامل وحدة التخزين إذا تريد البيع بالجملة.",
                        action_en="Add a carton/box sales unit matching the stock multiplier if bulk sale is needed.",
                    )
                )
            base_units = [unit for unit in units if _money(unit.multiplier) == Decimal("1.0000")]
            if base_units and not product.barcode and not any(unit.barcode for unit in base_units):
                issues.append(
                    _readiness_issue(
                        "base_unit_missing_barcode",
                        "info",
                        "وحدة البيع المفرد بلا باركود",
                        "Base sales unit has no barcode",
                        product=product,
                        action_ar="إذا المنتج يباع بالقطعة عبر قارئ باركود، أضف باركود القطعة. باركود الكارتون اختياري.",
                        action_en="If the item is scanned by piece, add the piece barcode. Carton barcode is optional.",
                    )
                )

    backup = _latest_backup_summary()
    if backup.get("status") != "ok":
        issues.append(
            _readiness_issue(
                "backup_not_recent",
                "warning",
                "النسخ الاحتياطي يحتاج متابعة",
                "Backup needs attention",
                details=backup,
                action_ar="صدّر نسخة احتياطية كاملة قبل البيع التجاري أو نقل النظام لجهاز التاجر.",
                action_en="Export a full backup before commercial use or moving the system to a merchant device.",
            )
        )

    severity_order = {"critical": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda item: (severity_order.get(item["severity"], 3), item.get("productName") or item["code"]))
    counts = {
        "critical": sum(1 for item in issues if item["severity"] == "critical"),
        "warning": sum(1 for item in issues if item["severity"] == "warning"),
        "info": sum(1 for item in issues if item["severity"] == "info"),
    }
    score = max(0, 100 - counts["critical"] * 12 - counts["warning"] * 5 - counts["info"])
    status = "ready" if counts["critical"] == 0 and counts["warning"] <= 2 else "needs_review" if counts["critical"] == 0 else "blocked"

    return {
        "score": score,
        "status": status,
        "counts": counts,
        "summaryAr": "جاهز للبيع بثقة" if status == "ready" else "يحتاج مراجعة قبل البيع التجاري" if status == "needs_review" else "غير جاهز للاعتماد التجاري",
        "summaryEn": "Ready for trusted sales" if status == "ready" else "Needs review before commercial use" if status == "needs_review" else "Not ready for commercial use",
        "issues": issues[:limit],
        "totalIssues": len(issues),
        "backup": backup,
        "checks": {
            "products": len(products),
            "invoiceMissingCostCount": invoice_missing_count,
            "openBatchProducts": len(open_batch_totals),
        },
    }


def _low_stock(limit=8):
    items = []
    for product in Product.objects.active().select_related("warehouse").prefetch_related("units").order_by("stock_quantity", "name"):
        if product.alert_quantity <= 0:
            continue
        if product.stock_quantity > product.alert_quantity:
            continue
        ratio = _percent((product.stock_quantity / product.alert_quantity) * 100) if product.alert_quantity else 0
        items.append({
            "id": product.external_id,
            "name": product.name,
            "warehouse": product.warehouse.name if product.warehouse_id else "",
            "stock": _amount(product.stock_quantity),
            "alert": _amount(product.alert_quantity),
            "formattedStock": f"{_amount(product.stock_quantity):g} {product.stock_unit_name or product.base_unit}",
            "formattedAlert": f"{_amount(product.alert_quantity):g} {product.stock_unit_name or product.base_unit}",
            "health": ratio,
        })
        if len(items) >= limit:
            break
    return items


def _warehouse_status():
    warehouses = list(Warehouse.objects.active().order_by("name"))
    product_counts = {
        item["warehouse_id"]: item["count"]
        for item in Product.objects.active().values("warehouse_id").annotate(count=Count("id"))
    }
    low_by_warehouse = {}
    for product in Product.objects.active().filter(alert_quantity__gt=0):
        if product.stock_quantity <= product.alert_quantity:
            low_by_warehouse[product.warehouse_id] = low_by_warehouse.get(product.warehouse_id, 0) + 1
    return [
        {
            "id": warehouse.external_id,
            "name": warehouse.name,
            "zone": warehouse.zone,
            "stockUnits": _amount(product_counts.get(warehouse.id, 0)),
            "lowStock": low_by_warehouse.get(warehouse.id, 0),
        }
        for warehouse in warehouses
    ]


def _entity_balances(model, calculator, limit=6):
    entity_type = LedgerEntry.ENTITY_CUSTOMER if model is Client else LedgerEntry.ENTITY_SUPPLIER
    name_field = "customer__name" if model is Client else "supplier__name"
    qs = (
        LedgerEntry.objects.filter(entity_type=entity_type)
        .values("entity_id", name_field)
        .annotate(balance=Sum("amount_usd"))
        .filter(balance__gt=0)
        .order_by("-balance")[:limit]
    )
    return [
        {
            "id": item["entity_id"],
            "name": item[name_field] or item["entity_id"],
            "balanceUsd": _amount(item["balance"]),
            "formattedBalance": _format_iqd(item["balance"] or 0),
        }
        for item in qs
    ]


def _top_revenue_customers(limit=6):
    qs = (
        LedgerEntry.objects.filter(entity_type=LedgerEntry.ENTITY_CUSTOMER, type=LedgerEntry.TYPE_INVOICE_CREATED)
        .values("entity_id", "customer__name")
        .annotate(total=Sum("amount_usd"))
        .order_by("-total")[:limit]
    )
    return [
        {
            "id": item["entity_id"],
            "name": item["customer__name"] or item["entity_id"],
            "totalUsd": _amount(item["total"]),
            "formattedTotal": _format_iqd(item["total"] or 0),
        }
        for item in qs
    ]


def _installment_risks(limit=8):
    today = timezone.localdate()
    rows = []
    qs = Installment.objects.select_related("client", "invoice").filter(due_date__lte=today).order_by("due_date", "number")
    for installment in qs:
        plan = installment.invoice.installment_plan if isinstance(installment.invoice.installment_plan, dict) else {}
        schedule = plan.get("schedule") if isinstance(plan.get("schedule"), list) else []
        plan_item = next((item for item in schedule if int(item.get("number") or 0) == installment.number), {})
        paid = _money(plan_item.get("paidUsd") or 0)
        remaining = max(Decimal("0.0000"), _money(installment.amount_usd - paid))
        if remaining <= Decimal("0.0001"):
            continue
        rows.append({
            "id": installment.external_id,
            "customer": installment.client.name,
            "invoiceId": installment.invoice.external_id,
            "number": installment.number,
            "dueDate": installment.due_date.isoformat() if installment.due_date else "",
            "remainingUsd": _amount(remaining),
            "formattedRemaining": _format_iqd(remaining),
            "daysLate": max(0, (today - installment.due_date).days) if installment.due_date else 0,
        })
        if len(rows) >= limit:
            break
    return rows


def _activity_feed(limit=12):
    ledger = [
        {
            "type": entry.type,
            "title": entry.reference_model or entry.type,
            "party": entry.customer.name if entry.customer_id else entry.supplier.name if entry.supplier_id else entry.entity_id,
            "amountUsd": _amount(abs(entry.amount_usd)),
            "amountFormatted": _format_iqd(abs(entry.amount_usd)),
            "createdAt": entry.timestamp.isoformat(),
            "createdAtFormatted": _format_date_iq(entry.timestamp),
        }
        for entry in LedgerEntry.objects.select_related("customer", "supplier", "invoice", "purchase", "payment", "supplier_payment").order_by("-timestamp", "-id")[:limit]
    ]
    stock = [
        {
            "type": f"STOCK_{movement.movement_type.upper()}",
            "title": movement.product.name,
            "party": movement.warehouse.name,
            "amountUsd": None,
            "createdAt": movement.created_at.isoformat(),
            "createdAtFormatted": _format_date_iq(movement.created_at),
        }
        for movement in StockMovement.objects.select_related("product", "warehouse").order_by("-created_at", "-id")[:limit]
    ]
    return sorted(ledger + stock, key=lambda item: item["createdAt"], reverse=True)[:limit]


def _smart_score(*, revenue, net_profit, customer_debt, supplier_debt, low_stock, installment_risks, missing_cost_count=0):
    score = 100
    if revenue > 0 and net_profit < 0:
        score -= 22
    elif revenue > 0 and _ratio_percent(net_profit, revenue) < 8:
        score -= 10
    score -= min(24, round(_ratio_percent(customer_debt + supplier_debt, max(revenue, Decimal("1"))) / 5))
    score -= min(18, len(low_stock) * 3)
    score -= min(16, len(installment_risks) * 4)
    score -= min(20, missing_cost_count * 4)
    return max(0, min(100, int(score)))


def _score_label(score):
    if score >= 82:
        return "ممتاز"
    if score >= 65:
        return "مستقر"
    if score >= 45:
        return "يحتاج متابعة"
    return "خطر"


def _score_summary(score, collection_rate, low_stock_count, installments_count):
    parts = [f"مؤشر الصحة {score}/100", f"معدل التحصيل {collection_rate}%"]
    if low_stock_count:
        parts.append(f"{low_stock_count} تنبيه مخزون")
    if installments_count:
        parts.append(f"{installments_count} قسط يحتاج متابعة")
    return " · ".join(parts)


def _insights(kpis, low_stock, installment_risks, top_customers, warehouse_status, smart_score, collection_rate):
    insights = []
    if smart_score < 55:
        insights.append({
            "tone": "danger",
            "title": "مؤشر الصحة منخفض",
            "body": "راجع الديون والتنبيهات لأنها تضغط على أداء النظام.",
        })
    if kpis["todaySales"]["valueUsd"] > 0:
        insights.append({
            "tone": "positive",
            "title": "نشاط مبيعات اليوم",
            "body": "توجد حركة مبيعات مسجلة اليوم من الدفتر المالي.",
        })
    if collection_rate < 55 and kpis["revenue"]["valueUsd"] > 0:
        insights.append({
            "tone": "warning",
            "title": "التحصيل يحتاج متابعة",
            "body": f"معدل التحصيل الحالي {collection_rate}% من الإيرادات المسجلة.",
        })
    if (kpis.get("missingCost") or {}).get("value", 0):
        insights.append({
            "tone": "warning",
            "title": "نواقص كلفة",
            "body": "توجد منتجات أو فواتير لا تحمل كلفة FIFO كاملة، لذلك تحتاج مراجعة قبل اعتماد الربح النهائي.",
        })
    if low_stock:
        insights.append({
            "tone": "danger",
            "title": "مخاطر نفاد مخزون",
            "body": f"{len(low_stock)} منتج يحتاج متابعة مخزون فورية.",
        })
    if installment_risks:
        insights.append({
            "tone": "warning",
            "title": "أقساط متأخرة",
            "body": f"{len(installment_risks)} قسط متأخر أو مستحق يحتاج متابعة.",
        })
    if top_customers:
        insights.append({
            "tone": "info",
            "title": "أفضل عميل إيراداً",
            "body": f"{top_customers[0]['name']} يتصدر إيرادات العملاء.",
        })
    unusual = [item for item in warehouse_status if item["lowStock"] >= 3]
    if unusual:
        insights.append({
            "tone": "warning",
            "title": "ضغط على المخازن",
            "body": f"{unusual[0]['name']} لديه عدة تنبيهات مخزون منخفض.",
        })
    if not insights:
        insights.append({
            "tone": "positive",
            "title": "النظام مستقر",
            "body": "لا توجد مخاطر واضحة في البيانات الحالية.",
        })
    return insights[:6]


def dashboard_analytics_payload(params=None):
    now = timezone.now()
    revision = analytics_revision()
    period = analytics_period(params)
    report_filters = _analytics_filters(params)
    partial_profit_filters = _has_partial_profit_filters(report_filters)
    profit_summary = _profit_trust_summary(period, report_filters)
    today = timezone.localdate()
    today_start = timezone.make_aware(datetime.combine(today, time.min))
    ledger_service = LedgerAnalyticsService(period.get("start"), period.get("end"))
    today_ledger_service = LedgerAnalyticsService(today_start)
    customer_invoice_total = profit_summary["revenue"]
    supplier_invoice_total = ledger_service.purchase_cost()
    cogs_total = profit_summary["trustedCogs"]
    all_cogs_total = profit_summary["cogs"]
    inventory_value = _inventory_value()
    gross_profit = profit_summary["trustedGrossProfit"]
    all_gross_profit = profit_summary["grossProfit"]
    estimated_gross_profit = profit_summary["estimatedGrossProfit"]
    expense_records_total = ledger_service.expenses()
    voucher_expenses_total = _snapshot_voucher_expenses(period)
    expenses_total = _money(expense_records_total + voucher_expenses_total)
    customer_collections = ledger_service.customer_collections()
    supplier_payments = ledger_service.supplier_payments()
    revenue = customer_invoice_total
    sale_returns = ledger_service.sale_returns()
    net_sales = _money(revenue - sale_returns)
    canceled_profit = ledger_service.canceled_profit()
    purchase_returns = ledger_service.purchase_returns()
    net_purchases = _money(supplier_invoice_total - purchase_returns)
    net_profit = _money(gross_profit - canceled_profit - expenses_total)
    invoice_count = profit_summary["invoiceCount"]
    purchase_count = _filter_range(Purchase.objects.all(), "created_at", period).count()
    payment_count = (
        _filter_range(ClientPayment.objects.all(), "created_at", period).count()
        + _filter_range(SupplierPayment.objects.all(), "created_at", period).count()
    )
    customer_debt = _money(sum(
        item["balance"] for item in LedgerEntry.objects.filter(entity_type=LedgerEntry.ENTITY_CUSTOMER)
        .values("entity_id").annotate(balance=Sum("amount_usd")).filter(balance__gt=0)
    ))
    supplier_debt = _money(sum(
        item["balance"] for item in LedgerEntry.objects.filter(entity_type=LedgerEntry.ENTITY_SUPPLIER)
        .values("entity_id").annotate(balance=Sum("amount_usd")).filter(balance__gt=0)
    ))
    pending_payments = _money(customer_debt + supplier_debt)
    low_stock = _low_stock()
    installment_risks = _installment_risks()
    top_customers = _top_revenue_customers()
    warehouse_status = _warehouse_status()
    collection_rate = _ratio_percent(customer_collections, revenue)
    profit_margin = profit_summary["trustedGrossMargin"]
    profit_markup = profit_summary["trustedMarkup"]
    profit_confidence = profit_summary["profitConfidence"]
    net_profit_margin = _ratio_percent(net_profit, revenue)
    missing_cost_rows = _missing_cost_rows()
    missing_cost_count = profit_summary["reviewRows"]
    readiness = system_readiness_payload()
    profit_product_rows = _product_profit_rows(period=period, filters=report_filters)
    product_trusted_profit = _money(sum(Decimal(str(item.get("trustedGrossProfitUsd", 0) or 0)) for item in profit_product_rows))
    product_estimated_profit = _money(sum(Decimal(str(item.get("estimatedGrossProfitUsd", 0) or 0)) for item in profit_product_rows))
    product_cash_sale_profit = _money(sum(Decimal(str(item.get("cashSaleProfitUsd", 0) or 0)) for item in profit_product_rows))
    product_installment_profit = _money(sum(Decimal(str(item.get("installmentProfitUsd", 0) or 0)) for item in profit_product_rows))
    product_revenue = _money(sum(Decimal(str(item.get("revenueUsd", 0) or 0)) for item in profit_product_rows))
    product_cogs = _money(sum(Decimal(str(item.get("cogsUsd", 0) or 0)) for item in profit_product_rows))
    product_quantity = _money(sum(Decimal(str(item.get("quantity", 0) or 0)) for item in profit_product_rows))
    average_invoice = _money(revenue / invoice_count) if invoice_count else Decimal("0")
    smart_score = _smart_score(
        revenue=revenue,
        net_profit=net_profit,
        customer_debt=customer_debt,
        supplier_debt=supplier_debt,
        low_stock=low_stock,
        installment_risks=installment_risks,
        missing_cost_count=missing_cost_count,
    )
    smart_summary = _score_summary(smart_score, collection_rate, len(low_stock), len(installment_risks))
    kpis = {
        "todaySales": {"labelAr": "مبيعات اليوم", "labelEn": "Today Sales", "tone": "sales", **_localized_money(today_ledger_service.revenue())},
        "revenue": {"labelAr": "إجمالي المبيعات", "labelEn": "Gross Sales", "tone": "sales", **_localized_money(revenue)},
        "saleReturns": {"labelAr": "مرتجعات البيع", "labelEn": "Sale Returns", "tone": "debt", **_localized_money(sale_returns)},
        "netSales": {"labelAr": "صافي المبيعات", "labelEn": "Net Sales", "tone": "sales", **_localized_money(net_sales)},
        "cogs": {"labelAr": "كلفة البضاعة المباعة", "labelEn": "COGS", "tone": "suppliers", **_localized_money(cogs_total)},
        "grossProfit": {"labelAr": "الربح قبل المرتجعات", "labelEn": "Gross Profit", "tone": "profit", **_localized_money(gross_profit)},
        "canceledProfit": {"labelAr": "الربح الملغى", "labelEn": "Canceled Profit", "tone": "debt", **_localized_money(canceled_profit)},
        "trustedGrossProfit": {"labelAr": "الربح المعتمد", "labelEn": "Trusted Profit", "tone": "profit", **_localized_money(gross_profit)},
        "reviewProfit": {"labelAr": "ربح يحتاج مراجعة", "labelEn": "Review Profit", "tone": "debt", **_localized_money(estimated_gross_profit)},
        "expenses": {"labelAr": "المصاريف", "labelEn": "Expenses", "tone": "debt", **_localized_money(expenses_total)},
        "netProfit": {"labelAr": "صافي الربح", "labelEn": "Net Profit", "tone": "profit", **_localized_money(net_profit)},
        "grossMargin": {"labelAr": "هامش الربح", "labelEn": "Gross Margin", "tone": "profit", "value": profit_margin, "formatted": f"{profit_margin}%"},
        "profitMarkup": {"labelAr": "الزيادة على الكلفة", "labelEn": "Markup", "tone": "profit", "value": profit_markup, "formatted": f"{profit_markup}%"},
        "profitConfidence": {"labelAr": "ثقة الأرباح", "labelEn": "Profit Confidence", "tone": "profit", "value": profit_confidence, "formatted": f"{profit_confidence}%"},
        "missingCost": {"labelAr": "نواقص الكلفة", "labelEn": "Missing Cost", "tone": "debt", "value": missing_cost_count},
        "inventoryValue": {"labelAr": "قيمة المخزون", "labelEn": "Inventory Value", "tone": "stock", **_localized_money(inventory_value)},
        "pendingPayments": {"labelAr": "ديون معلقة", "labelEn": "Pending Balances", "tone": "debt", **_localized_money(pending_payments)},
        "purchaseCost": {"labelAr": "إجمالي المشتريات", "labelEn": "Purchase Cost", "tone": "suppliers", **_localized_money(supplier_invoice_total)},
        "purchaseReturns": {"labelAr": "مرتجعات الشراء", "labelEn": "Purchase Returns", "tone": "profit", **_localized_money(purchase_returns)},
        "netPurchases": {"labelAr": "صافي المشتريات", "labelEn": "Net Purchases", "tone": "suppliers", **_localized_money(net_purchases)},
        "collectionRate": {"labelAr": "معدل التحصيل", "labelEn": "Collection Rate", "tone": "profit", "value": collection_rate, "formatted": f"{collection_rate}%"},
        "averageInvoice": {"labelAr": "متوسط الفاتورة", "labelEn": "Average Invoice", "tone": "sales", **_localized_money(average_invoice)},
        "activeCustomers": {"labelAr": "عملاء نشطون", "labelEn": "Active Customers", "tone": "customers", "value": Client.objects.active().count()},
        "suppliers": {"labelAr": "الموردون", "labelEn": "Suppliers", "tone": "suppliers", "value": Supplier.objects.active().count()},
        "invoiceCount": {"labelAr": "عدد الفواتير", "labelEn": "Invoices", "tone": "sales", "value": invoice_count},
        "paymentCount": {"labelAr": "عدد المدفوعات", "labelEn": "Payments", "tone": "profit", "value": payment_count},
        "lowStockAlerts": {"labelAr": "تنبيهات مخزون", "labelEn": "Low Stock Alerts", "tone": "stock", "value": len(low_stock)},
        "pendingInstallments": {"labelAr": "أقساط متأخرة", "labelEn": "Pending Installments", "tone": "installments", "value": len(installment_risks)},
        "smartScore": {"labelAr": "مؤشر الصحة", "labelEn": "Smart Score", "tone": "score", "value": smart_score, "formatted": f"{smart_score}/100"},
    }
    return {
        "ok": True,
        "revision": revision,
        "analyticsRevision": revision,
        "updatedAt": now.isoformat(),
        "updatedAtFormatted": _format_date_iq(now),
        "currency": "IQD",
        "exchangeRate": _amount(balance_iqd(1)),
        "locale": {"language": "ar", "market": "ar-IQ", "currency": "IQD", "dir": "rtl"},
        "period": {
            "key": period["key"],
            "startDate": period["startDate"],
            "endDate": period["endDate"],
            "granularity": period["granularity"],
        },
        "filters": {
            "saleKind": report_filters["saleKind"],
            "costSource": report_filters["costSource"],
            "q": report_filters["q"],
            "marginMin": _amount(report_filters["marginMin"]) if report_filters["marginMin"] is not None else None,
            "marginMax": _amount(report_filters["marginMax"]) if report_filters["marginMax"] is not None else None,
        },
        "smartScore": smart_score,
        "healthScore": smart_score,
        "health": {
            "score": smart_score,
            "label": _score_label(smart_score),
            "summary": smart_summary,
            "collectionRate": collection_rate,
            "profitMargin": profit_margin,
            "netProfitMargin": net_profit_margin,
            "missingCostCount": missing_cost_count,
            "riskCount": len(low_stock) + len(installment_risks),
            "readinessStatus": readiness["status"],
            "readinessScore": readiness["score"],
        },
        "readiness": readiness,
        "kpis": kpis,
        "charts": {
            "dailySales": _daily_sales(),
            "monthlySales": _sales_trend(period),
            "profitTrend": _profit_trend(period),
        },
        "activity": _activity_feed(),
        "widgets": {
            "topProducts": _top_products(period=period),
            "topCustomers": top_customers,
            "customerDebt": _entity_balances(Client, calculate_customer_balance),
            "supplierDebt": _entity_balances(Supplier, calculate_supplier_balance),
            "lowStock": low_stock,
            "warehouseStatus": warehouse_status,
            "installmentRisks": installment_risks,
        },
        "reports": {
            "sales": {
                "revenueUsd": _amount(revenue),
                "saleReturnsUsd": _amount(sale_returns),
                "netSalesUsd": _amount(net_sales),
                "cogsUsd": _amount(cogs_total),
                "grossProfitUsd": _amount(gross_profit),
                "canceledProfitUsd": _amount(canceled_profit),
                "allCogsUsd": _amount(all_cogs_total),
                "allGrossProfitUsd": _amount(all_gross_profit),
                "cashSaleProfitUsd": _amount(profit_summary["cashSaleProfit"]),
                "installmentProfitUsd": _amount(profit_summary["installmentProfit"]),
                "formattedCashSaleProfit": _format_iqd(profit_summary["cashSaleProfit"]),
                "formattedInstallmentProfit": _format_iqd(profit_summary["installmentProfit"]),
                "trustedRevenueUsd": _amount(profit_summary["trustedRevenue"]),
                "trustedCogsUsd": _amount(profit_summary["trustedCogs"]),
                "trustedGrossProfitUsd": _amount(gross_profit),
                "estimatedGrossProfitUsd": _amount(estimated_gross_profit),
                "reviewProfitRowsCount": profit_summary["reviewRows"],
                "missingCostRowsCount": profit_summary["missingRows"],
                "trustedInvoiceCount": profit_summary["trustedInvoiceCount"],
                "trustedProfitRowsCount": profit_summary["trustedRows"],
                "profitRowsCount": profit_summary["rows"],
                "costTrustStatus": profit_summary["costTrustStatus"],
                "expensesUsd": _amount(expenses_total),
                "expenseRecordsUsd": _amount(expense_records_total),
                "cashVoucherExpensesUsd": _amount(voucher_expenses_total),
                "netProfitUsd": _amount(net_profit),
                "netProfitReliable": not partial_profit_filters,
                "netProfitContextAr": "صافي ربح الفترة الكاملة" if not partial_profit_filters else "صافي الربح لا يعتمد مع فلاتر جزئية؛ استخدم الربح الإجمالي المفلتر.",
                "todayUsd": kpis["todaySales"]["valueUsd"],
                "invoiceCount": invoice_count,
                "paymentCount": payment_count,
                "averageInvoiceUsd": _amount(average_invoice),
                "collectionRate": collection_rate,
                "profitMargin": profit_margin,
                "grossMargin": profit_margin,
                "trustedMarkup": profit_markup,
                "grossMarkup": profit_summary["grossMarkup"],
                "profitConfidence": profit_confidence,
                "netProfitMargin": net_profit_margin,
                "missingCostCount": missing_cost_count,
            },
            "customers": {"count": Client.objects.active().count(), "debtUsd": _amount(customer_debt), "collectedUsd": _amount(customer_collections), "topRevenue": top_customers},
            "suppliers": {"count": Supplier.objects.active().count(), "debtUsd": _amount(supplier_debt), "purchasesUsd": _amount(supplier_invoice_total), "purchaseReturnsUsd": _amount(purchase_returns), "netPurchasesUsd": _amount(net_purchases), "paidUsd": _amount(supplier_payments)},
            "products": {
                "count": Product.objects.active().count(),
                "topSelling": _top_products(period=period),
                "lowStock": low_stock,
                "inventoryValueUsd": _amount(inventory_value),
                "formattedInventoryValue": _format_iqd(inventory_value),
                "soldProductCount": len(profit_product_rows),
                "soldQuantity": _amount(product_quantity),
                "revenueUsd": _amount(product_revenue),
                "cogsUsd": _amount(product_cogs),
                "trustedGrossProfitUsd": _amount(product_trusted_profit),
                "estimatedGrossProfitUsd": _amount(product_estimated_profit),
                "cashSaleProfitUsd": _amount(product_cash_sale_profit),
                "installmentProfitUsd": _amount(product_installment_profit),
                "formattedTrustedGrossProfit": _format_iqd(product_trusted_profit),
                "formattedEstimatedGrossProfit": _format_iqd(product_estimated_profit),
                "formattedCashSaleProfit": _format_iqd(product_cash_sale_profit),
                "formattedInstallmentProfit": _format_iqd(product_installment_profit),
                "trustedGrossMargin": _ratio_percent(product_trusted_profit, product_revenue),
                "trustedMarkup": _markup_percent(product_trusted_profit, product_cogs),
            },
            "warehouses": {"count": Warehouse.objects.active().count(), "status": warehouse_status},
            "ledger": {
                "customerLedgerUsd": _amount(customer_invoice_total),
                "supplierLedgerUsd": _amount(supplier_invoice_total),
                "cogsUsd": _amount(cogs_total),
                "grossProfitUsd": _amount(gross_profit),
                "allCogsUsd": _amount(all_cogs_total),
                "allGrossProfitUsd": _amount(all_gross_profit),
                "cashSaleProfitUsd": _amount(profit_summary["cashSaleProfit"]),
                "installmentProfitUsd": _amount(profit_summary["installmentProfit"]),
                "trustedGrossProfitUsd": _amount(gross_profit),
                "estimatedGrossProfitUsd": _amount(estimated_gross_profit),
                "expensesUsd": _amount(expenses_total),
                "expenseRecordsUsd": _amount(expense_records_total),
                "cashVoucherExpensesUsd": _amount(voucher_expenses_total),
                "netProfitUsd": _amount(net_profit),
                "entries": LedgerEntry.objects.count(),
            },
            "readiness": readiness,
            "profitInvoices": _invoice_profit_rows(period=period, filters=report_filters),
            "profitProducts": profit_product_rows,
            "productAccounting": _product_accounting_rows(),
            "stockBatches": _stock_batch_rows(),
            "missingCosts": missing_cost_rows,
        },
        "summary": dashboard_summary_payload(kpis=kpis, revenue=revenue, net_profit=net_profit, pending_payments=pending_payments, updated_at=now),
        "insights": _insights(kpis, low_stock, installment_risks, top_customers, warehouse_status, smart_score, collection_rate),
        "counts": {
            "invoices": invoice_count,
            "purchases": purchase_count,
            "payments": payment_count,
            "movements": AccountMovement.objects.count(),
            "audit": AuditLog.objects.count(),
            "lowStock": len(low_stock),
            "installmentRisks": len(installment_risks),
        },
    }


def dashboard_summary_payload(kpis=None, revenue=None, net_profit=None, pending_payments=None, updated_at=None):
    updated_at = updated_at or timezone.now()
    if kpis is None:
        ledger_service = LedgerAnalyticsService()
        revenue = ledger_service.revenue()
        net_profit = ledger_service.net_profit()
        customer_debt = _money(sum(
            item["balance"] for item in LedgerEntry.objects.filter(entity_type=LedgerEntry.ENTITY_CUSTOMER)
            .values("entity_id").annotate(balance=Sum("amount_usd")).filter(balance__gt=0)
        ))
        supplier_debt = _money(sum(
            item["balance"] for item in LedgerEntry.objects.filter(entity_type=LedgerEntry.ENTITY_SUPPLIER)
            .values("entity_id").annotate(balance=Sum("amount_usd")).filter(balance__gt=0)
        ))
        pending_payments = _money(customer_debt + supplier_debt)
        today_start = timezone.make_aware(datetime.combine(timezone.localdate(), time.min))
        kpis = {
            "todaySales": {"labelAr": "مبيعات اليوم", "labelEn": "Today Sales", "tone": "sales", **_localized_money(LedgerAnalyticsService(today_start).revenue())},
            "revenue": {"labelAr": "الإيراد", "labelEn": "Revenue", "tone": "sales", **_localized_money(revenue)},
            "netProfit": {"labelAr": "صافي الربح", "labelEn": "Net Profit", "tone": "profit", **_localized_money(net_profit)},
            "pendingPayments": {"labelAr": "ديون معلقة", "labelEn": "Pending Balances", "tone": "debt", **_localized_money(pending_payments)},
        }
    return {
        "ok": True,
        "updatedAt": updated_at.isoformat(),
        "updatedAtFormatted": _format_date_iq(updated_at),
        "currency": "IQD",
        "locale": {"language": "ar", "market": "ar-IQ", "currency": "IQD", "dir": "rtl"},
        "today_sales": kpis.get("todaySales"),
        "revenue": kpis.get("revenue"),
        "net_profit": kpis.get("netProfit"),
        "pending_payments": kpis.get("pendingPayments"),
        "smart_score": kpis.get("smartScore"),
    }


def kpi_analytics_payload():
    payload = dashboard_analytics_payload()
    return {
        "ok": True,
        "updatedAt": payload["updatedAt"],
        "updatedAtFormatted": payload["updatedAtFormatted"],
        "currency": "IQD",
        "locale": payload["locale"],
        "health": payload["health"],
        "kpis": payload["kpis"],
        "monthly_graph": payload["charts"]["monthlySales"],
        "daily_graph": payload["charts"]["dailySales"],
    }


def stock_alerts_payload():
    now = timezone.now()
    return {
        "ok": True,
        "updatedAt": now.isoformat(),
        "updatedAtFormatted": _format_date_iq(now),
        "currency": "IQD",
        "locale": {"language": "ar", "market": "ar-IQ", "currency": "IQD", "dir": "rtl"},
        "low_stock": _low_stock(),
        "warehouses": _warehouse_status(),
    }
