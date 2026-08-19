from django.db import models
from django.db.models import Q
from django.contrib.auth.models import User
from django.utils import timezone
from uuid import uuid4


class SoftDeleteQuerySet(models.QuerySet):
    def active(self):
        return self.filter(deleted_at__isnull=True)


class SoftDeleteModel(models.Model):
    external_id = models.CharField(max_length=80, unique=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    objects = SoftDeleteQuerySet.as_manager()

    class Meta:
        abstract = True

    def archive(self):
        self.deleted_at = timezone.now()
        self.save(update_fields=["deleted_at", "updated_at"])


class ImmutableLedgerQuerySet(models.QuerySet):
    def update(self, *args, **kwargs):
        raise ValueError("Ledger entries are immutable; create a reversal entry instead.")

    def delete(self, *args, **kwargs):
        raise ValueError("Ledger entries are immutable; create a reversal entry instead.")


class Warehouse(SoftDeleteModel):
    name = models.CharField(max_length=160)
    code = models.CharField(max_length=60, blank=True)
    zone = models.CharField(max_length=160, blank=True)
    manager = models.CharField(max_length=160, blank=True)
    color = models.CharField(max_length=24, default="#d6b35a")
    note = models.TextField(blank=True)

    def __str__(self):
        return self.name


class Product(SoftDeleteModel):
    KIND_CHOICES = [
        ("single", "Single"),
        ("packaged", "Packaged"),
        ("weighted", "Weighted"),
        ("liquid", "Liquid"),
        ("length", "Length"),
    ]
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="products")
    name = models.CharField(max_length=220)
    brand = models.CharField(max_length=140, blank=True)
    origin_country = models.CharField(max_length=140, blank=True)
    kind = models.CharField(max_length=30, choices=KIND_CHOICES, default="single")
    barcode = models.CharField(max_length=120, blank=True, db_index=True)
    sku = models.CharField(max_length=120, blank=True)
    image = models.TextField(blank=True)
    currency = models.CharField(max_length=8, default="IQD")
    base_unit = models.CharField(max_length=80, default="قطعة")
    stock_unit_name = models.CharField(max_length=100, blank=True)
    stock_unit_multiplier = models.DecimalField(max_digits=15, decimal_places=4, default=1)
    stock_quantity_mode = models.CharField(max_length=40, default="storage-main-unit-v1")
    stock_quantity = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    purchase_cost_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    alert_quantity = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    expiry_start = models.DateField(null=True, blank=True)
    expires_at = models.DateField(null=True, blank=True)

    def __str__(self):
        return self.name

    class Meta:
        indexes = [
            models.Index(fields=["warehouse", "deleted_at"]),
            models.Index(fields=["deleted_at", "warehouse", "name"], name="erp_product_active_wh_name_idx"),
            models.Index(fields=["name"]),
            models.Index(fields=["sku"]),
            models.Index(fields=["expires_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["barcode"],
                condition=~Q(barcode=""),
                name="unique_non_empty_product_barcode",
            ),
        ]


def product_image_upload_to(instance, filename):
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    variant = getattr(instance, "_upload_variant", "original")
    product_id = instance.product.external_id if instance.product_id else "pending"
    return f"product-images/{product_id}/{variant}/{uuid4().hex}.{suffix}"


class ProductImage(models.Model):
    external_id = models.CharField(max_length=80, unique=True)
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="images")
    original = models.FileField(upload_to=product_image_upload_to, blank=True)
    large = models.FileField(upload_to=product_image_upload_to, blank=True)
    catalog = models.FileField(upload_to=product_image_upload_to, blank=True)
    thumb = models.FileField(upload_to=product_image_upload_to, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]
        indexes = [
            models.Index(fields=["product", "sort_order"], name="erp_product_image_order_idx"),
            models.Index(fields=["product", "is_primary"], name="erp_product_image_primary_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["product"],
                condition=Q(is_primary=True),
                name="unique_primary_product_image",
            ),
        ]

    def __str__(self):
        return f"{self.product.name} image {self.sort_order}"


class ProductUnit(SoftDeleteModel):
    external_id = models.CharField(max_length=80)
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="units")
    name = models.CharField(max_length=100)
    multiplier = models.DecimalField(max_digits=15, decimal_places=4, default=1)
    price_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    price_currency = models.CharField(max_length=8, default="IQD")
    barcode = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ["id"]
        unique_together = ("product", "external_id")
        indexes = [
            models.Index(fields=["product", "deleted_at"], name="erp_unit_product_active_idx"),
            models.Index(fields=["product", "name", "multiplier"], name="erp_unit_product_name_mult_idx"),
            models.Index(fields=["barcode"], name="erp_unit_barcode_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["barcode"],
                condition=~Q(barcode=""),
                name="unique_non_empty_product_unit_barcode",
            ),
            models.CheckConstraint(
                check=Q(multiplier__gt=0),
                name="product_unit_multiplier_positive",
            ),
        ]

    def __str__(self):
        return f"{self.product.name} - {self.name}"


class ProductSearchToken(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="search_tokens")
    token = models.CharField(max_length=120, db_index=True)
    weight = models.PositiveSmallIntegerField(default=1)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [
            models.Index(fields=["token", "product"], name="erp_pos_token_product_idx"),
            models.Index(fields=["product", "token"], name="erp_pos_product_token_idx"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["product", "token"], name="unique_pos_product_search_token"),
        ]

    def __str__(self):
        return f"{self.product_id}:{self.token}"


class CurrencyRate(models.Model):
    base_currency = models.CharField(max_length=8, default="USD")
    quote_currency = models.CharField(max_length=8, default="IQD")
    rate = models.DecimalField(max_digits=14, decimal_places=4, default=1460)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"1 {self.base_currency} = {self.rate} {self.quote_currency}"


class StockBatch(models.Model):
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="batches")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="batches")
    batch_code = models.CharField(max_length=100, blank=True)
    quantity = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    purchase_cost_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    expiry_date = models.DateField(null=True, blank=True)
    received_at = models.DateTimeField(default=timezone.now)
    is_closed = models.BooleanField(default=False)

    class Meta:
        ordering = ["expiry_date", "received_at", "id"]
        indexes = [
            models.Index(fields=["product", "warehouse", "expiry_date"]),
            models.Index(fields=["product", "warehouse", "is_closed", "received_at"], name="erp_batch_fifo_idx"),
        ]

    def __str__(self):
        return f"{self.product.name} - {self.batch_code or self.id}"


class Expense(SoftDeleteModel):
    CATEGORY_CHOICES = [
        ("rent", "Rent"),
        ("salary", "Salary"),
        ("utilities", "Utilities"),
        ("transport", "Transport"),
        ("other", "Other"),
    ]
    title = models.CharField(max_length=180)
    category = models.CharField(max_length=40, choices=CATEGORY_CHOICES, default="other")
    amount_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    currency = models.CharField(max_length=8, default="IQD")
    exchange_rate = models.DecimalField(max_digits=14, decimal_places=4, default=1460)
    paid_at = models.DateTimeField(default=timezone.now)
    note = models.TextField(blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["deleted_at", "paid_at"]),
            models.Index(fields=["category"]),
        ]


class Client(SoftDeleteModel):
    name = models.CharField(max_length=180)
    phone = models.CharField(max_length=80, blank=True)
    address = models.CharField(max_length=240, blank=True)
    image = models.CharField(max_length=500, blank=True)
    debt_limit_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    opening_balance_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    opening_balance_type = models.CharField(max_length=20, default="debit")
    financial_note = models.TextField(blank=True)
    loyalty_points = models.IntegerField(default=0)
    note = models.TextField(blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["deleted_at", "name"]),
            models.Index(fields=["phone"]),
        ]


class Supplier(SoftDeleteModel):
    name = models.CharField(max_length=180)
    phone = models.CharField(max_length=80, blank=True)
    company_name = models.CharField(max_length=180, blank=True)
    email = models.EmailField(blank=True)
    image = models.CharField(max_length=500, blank=True)
    city = models.CharField(max_length=120, blank=True)
    opening_balance_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    opening_balance_type = models.CharField(max_length=20, default="debit")
    financial_note = models.TextField(blank=True)
    note = models.TextField(blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["deleted_at", "name"]),
            models.Index(fields=["phone"]),
        ]


class Employee(SoftDeleteModel):
    user = models.OneToOneField(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="employee_profile")
    name = models.CharField(max_length=180)
    phone = models.CharField(max_length=80, blank=True)
    role = models.CharField(max_length=120, blank=True)
    salary = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    work_hours = models.DecimalField(max_digits=8, decimal_places=2, default=0)

    class Meta:
        indexes = [
            models.Index(fields=["deleted_at", "name"]),
            models.Index(fields=["role"]),
        ]


class EmployeePayroll(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="payroll_entries")
    amount_iqd = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    note = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_payroll_entries")

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["employee", "created_at"]),
        ]


class UserProfile(models.Model):
    ROLE_CHOICES = [
        ("admin", "Admin"),
        ("super_admin", "Super Admin"),
        ("cashier", "Cashier"),
        ("warehouse", "Warehouse"),
        ("accountant", "Accountant"),
    ]
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="tox_profile")
    role = models.CharField(max_length=30, choices=ROLE_CHOICES, default="cashier")
    permissions = models.JSONField(default=dict, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    branch = models.ForeignKey(Warehouse, on_delete=models.SET_NULL, null=True, blank=True, related_name="users")
    managed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="managed_tox_profiles",
        help_text="The manager or tenant owner responsible for this account.",
    )
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.user.username} ({self.role})"


class LoginEvent(models.Model):
    EVENT_CHOICES = [
        ("login", "Login"),
        ("logout", "Logout"),
        ("failed", "Failed login"),
    ]
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="tox_login_events")
    username = models.CharField(max_length=150, blank=True)
    event = models.CharField(max_length=20, choices=EVENT_CHOICES)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]


class StockMovement(models.Model):
    MOVEMENT_TYPES = [
        ("sale", "Sale"),
        ("purchase", "Purchase"),
        ("sale_return", "Sale return"),
        ("purchase_return", "Purchase return"),
        ("return_damage", "Return damage"),
        ("adjustment", "Adjustment"),
        ("transfer", "Transfer"),
        ("archive", "Archive"),
    ]
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="movements")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="movements")
    movement_type = models.CharField(max_length=30, choices=MOVEMENT_TYPES)
    quantity = models.DecimalField(max_digits=15, decimal_places=4)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [
            models.Index(fields=["product", "warehouse", "created_at"]),
            models.Index(fields=["product", "created_at"], name="erp_stockmove_product_date_idx"),
            models.Index(fields=["movement_type", "created_at"]),
        ]


class Invoice(models.Model):
    KIND_CHOICES = [
        ("invoice", "Invoice"),
        ("direct_pos", "Direct POS"),
        ("installment", "Installment"),
    ]

    external_id = models.CharField(max_length=80, unique=True)
    client = models.ForeignKey(Client, on_delete=models.SET_NULL, null=True, blank=True, related_name="invoices")
    kind = models.CharField(max_length=30, choices=KIND_CHOICES, default="invoice")
    title = models.CharField(max_length=180, blank=True)
    customer_name = models.CharField(max_length=180, blank=True)
    exchange_rate = models.DecimalField(max_digits=14, decimal_places=4, default=1460)
    subtotal_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    discount_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    paid_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    total_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    remaining_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    payment_status = models.CharField(max_length=20, default="unpaid")
    installment_plan = models.JSONField(default=dict, blank=True)
    note = models.TextField(blank=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    void_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["created_at", "id"]),
            models.Index(fields=["client", "created_at"]),
            models.Index(fields=["client", "payment_status", "created_at"]),
            models.Index(fields=["kind", "created_at"], name="erp_invoice_kind_created_idx"),
            models.Index(fields=["external_id"]),
        ]


class InvoiceItem(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, null=True, blank=True, related_name="invoice_items")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.SET_NULL, null=True, blank=True, related_name="invoice_items")
    unit_id = models.CharField(max_length=80, blank=True)
    unit_name = models.CharField(max_length=100, blank=True)
    quantity = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    qty_in_base = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    price_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    total_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    unit_cost_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    total_cost_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    gross_profit_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    cost_status = models.CharField(max_length=30, default="missing_cost")
    cost_breakdown = models.JSONField(default=list, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["invoice", "product"]),
            models.Index(fields=["product", "warehouse"]),
            models.Index(fields=["product", "unit_id"], name="erp_invitem_product_unit_idx"),
            models.Index(fields=["product", "cost_status"], name="erp_invitem_product_cost_idx"),
        ]


class Installment(models.Model):
    external_id = models.CharField(max_length=100, unique=True)
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="installments")
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="installments")
    number = models.PositiveIntegerField()
    amount_usd = models.DecimalField(max_digits=14, decimal_places=4)
    due_date = models.DateField(null=True, blank=True)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["due_date", "number", "id"]
        unique_together = ("invoice", "number")
        indexes = [
            models.Index(fields=["client", "due_date"]),
            models.Index(fields=["invoice", "number"]),
        ]

    def __str__(self):
        return f"{self.invoice.external_id} installment {self.number}"


class Purchase(models.Model):
    external_id = models.CharField(max_length=80, unique=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name="purchases")
    title = models.CharField(max_length=180, blank=True)
    supplier_name = models.CharField(max_length=180, blank=True)
    exchange_rate = models.DecimalField(max_digits=14, decimal_places=4, default=1460)
    cost_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    paid_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    remaining_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    payment_status = models.CharField(max_length=20, default="unpaid")
    note = models.TextField(blank=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    void_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["created_at", "id"]),
            models.Index(fields=["supplier", "created_at"]),
            models.Index(fields=["supplier", "payment_status", "created_at"]),
            models.Index(fields=["external_id"]),
        ]


class PurchaseItem(models.Model):
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, null=True, blank=True, related_name="purchase_items")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.SET_NULL, null=True, blank=True, related_name="purchase_items")
    unit_id = models.CharField(max_length=80, blank=True)
    unit_name = models.CharField(max_length=100, blank=True)
    quantity = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    qty_in_base = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    unit_cost_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    total_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    supplier_unit_cost_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    base_unit_cost_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    storage_unit_cost_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    landed_cost_share_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    discount_share_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    batch_code = models.CharField(max_length=100, blank=True)
    expiry_days = models.IntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["purchase", "product"]),
            models.Index(fields=["product", "warehouse"]),
            models.Index(fields=["expires_at"]),
        ]


class ReturnDocument(models.Model):
    RETURN_TYPES = [
        ("sale_return", "Sale return"),
        ("purchase_return", "Purchase return"),
    ]
    SETTLEMENT_METHODS = [
        ("credit", "Credit"),
        ("cash", "Cash"),
    ]

    external_id = models.CharField(max_length=80, unique=True)
    return_type = models.CharField(max_length=30, choices=RETURN_TYPES)
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, null=True, blank=True, related_name="returns")
    purchase = models.ForeignKey(Purchase, on_delete=models.PROTECT, null=True, blank=True, related_name="returns")
    client = models.ForeignKey(Client, on_delete=models.SET_NULL, null=True, blank=True, related_name="returns")
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name="returns")
    party_name = models.CharField(max_length=180, blank=True)
    exchange_rate = models.DecimalField(max_digits=14, decimal_places=4, default=1460)
    total_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    settlement_method = models.CharField(max_length=20, choices=SETTLEMENT_METHODS, default="credit")
    reason = models.CharField(max_length=240, blank=True)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["return_type", "created_at"]),
            models.Index(fields=["invoice", "created_at"]),
            models.Index(fields=["purchase", "created_at"]),
            models.Index(fields=["client", "created_at"]),
            models.Index(fields=["supplier", "created_at"]),
        ]


class ReturnItem(models.Model):
    CONDITION_CHOICES = [
        ("resellable", "Resellable"),
        ("damaged", "Damaged"),
    ]

    return_document = models.ForeignKey(ReturnDocument, on_delete=models.CASCADE, related_name="items")
    invoice_item = models.ForeignKey(InvoiceItem, on_delete=models.PROTECT, null=True, blank=True, related_name="return_items")
    purchase_item = models.ForeignKey(PurchaseItem, on_delete=models.PROTECT, null=True, blank=True, related_name="return_items")
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, null=True, blank=True, related_name="return_items")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.SET_NULL, null=True, blank=True, related_name="return_items")
    unit_id = models.CharField(max_length=80, blank=True)
    unit_name = models.CharField(max_length=100, blank=True)
    quantity = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    qty_in_base = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    unit_price_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    total_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    unit_cost_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    total_cost_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    condition = models.CharField(max_length=20, choices=CONDITION_CHOICES, default="resellable")
    cost_breakdown = models.JSONField(default=list, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["return_document", "product"]),
            models.Index(fields=["invoice_item"]),
            models.Index(fields=["purchase_item"]),
            models.Index(fields=["product", "warehouse"]),
        ]


class ClientPayment(models.Model):
    external_id = models.CharField(max_length=80, unique=True)
    client = models.ForeignKey(Client, on_delete=models.SET_NULL, null=True, blank=True, related_name="payments")
    client_name = models.CharField(max_length=180, blank=True)
    amount_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    unapplied_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    applied_to = models.JSONField(default=list, blank=True)
    note = models.TextField(blank=True)
    received_at = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["client", "created_at"]),
            models.Index(fields=["external_id"]),
        ]


class SupplierPayment(models.Model):
    external_id = models.CharField(max_length=80, unique=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name="payments")
    supplier_name = models.CharField(max_length=180, blank=True)
    amount_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    unapplied_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    applied_to = models.JSONField(default=list, blank=True)
    note = models.TextField(blank=True)
    paid_at = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["supplier", "created_at"]),
            models.Index(fields=["external_id"]),
        ]


class AccountMovement(models.Model):
    PARTY_TYPES = [
        ("client", "Client"),
        ("supplier", "Supplier"),
    ]
    MOVEMENT_TYPES = [
        ("opening", "Opening balance"),
        ("invoice", "Invoice"),
        ("payment", "Payment"),
        ("return", "Return"),
        ("adjustment", "Adjustment"),
    ]
    external_id = models.CharField(max_length=120, unique=True)
    party_type = models.CharField(max_length=20, choices=PARTY_TYPES)
    party_id = models.CharField(max_length=80, db_index=True)
    movement_type = models.CharField(max_length=24, choices=MOVEMENT_TYPES)
    title = models.CharField(max_length=160)
    debit_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    credit_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    balance_after_usd = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    reference_type = models.CharField(max_length=40, blank=True)
    reference_id = models.CharField(max_length=80, blank=True)
    note = models.TextField(blank=True)
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["party_type", "party_id", "created_at"]),
            models.Index(fields=["movement_type", "created_at"]),
            models.Index(fields=["reference_type", "reference_id"]),
        ]


class LedgerEntry(models.Model):
    ENTITY_CUSTOMER = "customer"
    ENTITY_SUPPLIER = "supplier"
    ENTITY_CHOICES = [
        (ENTITY_CUSTOMER, "Customer"),
        (ENTITY_SUPPLIER, "Supplier"),
    ]

    TYPE_INVOICE_CREATED = "INVOICE_CREATED"
    TYPE_PAYMENT_RECEIVED = "PAYMENT_RECEIVED"
    TYPE_INSTALLMENT_PAYMENT = "INSTALLMENT_PAYMENT"
    TYPE_DEBT_ADJUSTMENT = "DEBT_ADJUSTMENT"
    TYPE_CHOICES = [
        (TYPE_INVOICE_CREATED, "Invoice created"),
        (TYPE_PAYMENT_RECEIVED, "Payment received"),
        (TYPE_INSTALLMENT_PAYMENT, "Installment payment"),
        (TYPE_DEBT_ADJUSTMENT, "Debt adjustment"),
    ]

    entity_type = models.CharField(max_length=20, choices=ENTITY_CHOICES)
    entity_id = models.CharField(max_length=80, db_index=True)
    customer = models.ForeignKey(Client, on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_entries")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_entries")
    amount_usd = models.DecimalField(max_digits=14, decimal_places=4)
    type = models.CharField(max_length=40, choices=TYPE_CHOICES)
    reference_id = models.CharField(max_length=120, db_index=True)
    reference_model = models.CharField(max_length=40, blank=True)
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_entries")
    purchase = models.ForeignKey(Purchase, on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_entries")
    payment = models.ForeignKey(ClientPayment, on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_entries")
    supplier_payment = models.ForeignKey(SupplierPayment, on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_entries")
    installment = models.ForeignKey(Installment, on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_entries")
    reversed_entry = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True, related_name="reversal_entries")
    metadata = models.JSONField(default=dict, blank=True)
    timestamp = models.DateTimeField(default=timezone.now)

    objects = ImmutableLedgerQuerySet.as_manager()

    class Meta:
        ordering = ["-timestamp", "-id"]
        indexes = [
            models.Index(fields=["entity_type", "entity_id", "timestamp"]),
            models.Index(fields=["type", "timestamp"]),
            models.Index(fields=["reference_model", "reference_id"]),
        ]
        constraints = [
            models.CheckConstraint(
                check=~Q(amount_usd=0),
                name="ledger_entry_amount_non_zero",
            ),
            models.CheckConstraint(
                check=(
                    Q(entity_type="customer", customer__isnull=False, supplier__isnull=True)
                    | Q(entity_type="supplier", supplier__isnull=False, customer__isnull=True)
                ),
                name="ledger_entry_exact_entity",
            ),
            models.UniqueConstraint(
                fields=["entity_type", "entity_id", "type", "reference_id"],
                name="unique_ledger_entry_reference",
            ),
        ]

    def _validate_entry(self):
        if self.entity_type == self.ENTITY_CUSTOMER:
            if not self.customer_id or self.supplier_id:
                raise ValueError("Customer ledger entries must reference exactly one customer.")
            expected_entity_id = self.customer.external_id
            if self.entity_id and self.entity_id != expected_entity_id:
                raise ValueError("Ledger entity_id must match the referenced customer.")
            self.entity_id = expected_entity_id
        elif self.entity_type == self.ENTITY_SUPPLIER:
            if not self.supplier_id or self.customer_id:
                raise ValueError("Supplier ledger entries must reference exactly one supplier.")
            expected_entity_id = self.supplier.external_id
            if self.entity_id and self.entity_id != expected_entity_id:
                raise ValueError("Ledger entity_id must match the referenced supplier.")
            self.entity_id = expected_entity_id
        else:
            raise ValueError("Ledger entries require a valid entity type.")
        if not self.reference_id:
            raise ValueError("Ledger entries require a reference_id.")
        if self.amount_usd in (None, 0):
            raise ValueError("Ledger entries require a non-zero amount.")

    def save(self, *args, **kwargs):
        if self.pk and not getattr(self, "_allow_ledger_update", False):
            raise ValueError("Ledger entries are immutable; create a reversal entry instead.")
        self._validate_entry()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Ledger entries are immutable; create a reversal entry instead.")

    def __str__(self):
        return f"{self.entity_type}:{self.entity_id} {self.type} {self.amount_usd}"


class AuditLog(models.Model):
    action = models.CharField(max_length=80)
    entity_type = models.CharField(max_length=80)
    entity_id = models.CharField(max_length=80, blank=True)
    message = models.CharField(max_length=240, blank=True)
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["entity_type", "entity_id"]),
            models.Index(fields=["action", "created_at"]),
        ]


class AppSnapshot(models.Model):
    key = models.CharField(max_length=80, unique=True, default="default")
    data = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)
