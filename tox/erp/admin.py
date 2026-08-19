from django.contrib import admin

from .models import (
    AppSnapshot,
    AuditLog,
    Client,
    ClientPayment,
    Employee,
    Installment,
    Invoice,
    InvoiceItem,
    LedgerEntry,
    LoginEvent,
    Product,
    ProductImage,
    ProductUnit,
    Purchase,
    PurchaseItem,
    StockMovement,
    Supplier,
    SupplierPayment,
    UserProfile,
    Warehouse,
)


class ProductUnitInline(admin.TabularInline):
    model = ProductUnit
    extra = 0


class ProductImageInline(admin.TabularInline):
    model = ProductImage
    extra = 0
    fields = ("external_id", "large", "catalog", "thumb", "sort_order", "is_primary")


class InvoiceItemInline(admin.TabularInline):
    model = InvoiceItem
    extra = 0


class InstallmentInline(admin.TabularInline):
    model = Installment
    extra = 0
    readonly_fields = ("external_id", "client", "number", "amount_usd", "due_date", "created_at")
    can_delete = False


class PurchaseItemInline(admin.TabularInline):
    model = PurchaseItem
    extra = 0


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "brand", "warehouse", "barcode", "stock_quantity", "currency", "deleted_at")
    list_filter = ("warehouse", "kind", "currency", "deleted_at")
    search_fields = ("name", "brand", "barcode", "sku")
    inlines = [ProductUnitInline, ProductImageInline]


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ("external_id", "kind", "customer_name", "subtotal_usd", "paid_usd", "created_at")
    list_filter = ("kind", "payment_status")
    search_fields = ("external_id", "customer_name")
    inlines = [InvoiceItemInline, InstallmentInline]


@admin.register(Purchase)
class PurchaseAdmin(admin.ModelAdmin):
    list_display = ("external_id", "supplier_name", "cost_usd", "paid_usd", "created_at")
    search_fields = ("external_id", "supplier_name")
    inlines = [PurchaseItemInline]


@admin.register(ClientPayment)
class ClientPaymentAdmin(admin.ModelAdmin):
    list_display = ("external_id", "client_name", "amount_usd", "unapplied_usd", "received_at")
    search_fields = ("external_id", "client_name")


@admin.register(SupplierPayment)
class SupplierPaymentAdmin(admin.ModelAdmin):
    list_display = ("external_id", "supplier_name", "amount_usd", "unapplied_usd", "paid_at")
    search_fields = ("external_id", "supplier_name")


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = ("entity_type", "entity_id", "type", "amount_usd", "reference_id", "timestamp")
    list_filter = ("entity_type", "type")
    search_fields = ("entity_id", "reference_id")
    readonly_fields = [field.name for field in LedgerEntry._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("action", "entity_type", "entity_id", "created_at")
    search_fields = ("action", "entity_type", "entity_id", "message")

#this is for sucerty and logone for admain user like 
admin.site.register(Warehouse)
admin.site.register(ProductUnit)
admin.site.register(Client)
admin.site.register(Supplier)
admin.site.register(Employee)
admin.site.register(Installment)
admin.site.register(UserProfile)
admin.site.register(LoginEvent)
admin.site.register(StockMovement)
admin.site.register(AppSnapshot)
