from decimal import Decimal

from django.db import migrations, models


def migrate_existing_stock_to_storage_units(apps, schema_editor):
    Product = apps.get_model("erp", "Product")
    ProductUnit = apps.get_model("erp", "ProductUnit")
    AppSnapshot = apps.get_model("erp", "AppSnapshot")

    snapshot = AppSnapshot.objects.filter(key="default").first()
    saved_products = {}
    if snapshot and isinstance(snapshot.data, dict):
        saved_products = {
            item.get("id"): item
            for item in snapshot.data.get("products", [])
            if isinstance(item, dict) and item.get("id")
        }

    for product in Product.objects.all():
        saved = saved_products.get(product.external_id, {})
        largest_unit = (
            ProductUnit.objects.filter(product_id=product.id, deleted_at__isnull=True, multiplier__gt=1)
            .order_by("-multiplier")
            .first()
        )
        multiplier = Decimal(str(saved.get("stockUnitMultiplier") or (largest_unit.multiplier if largest_unit else 1) or 1))
        if multiplier <= 0:
            multiplier = Decimal("1")
        product.stock_unit_name = saved.get("stockUnitName") or (largest_unit.name if largest_unit else product.base_unit)
        product.stock_unit_multiplier = multiplier
        product.stock_quantity_mode = "storage-main-unit-v1"
        product.stock_quantity = product.stock_quantity / multiplier
        product.alert_quantity = product.alert_quantity / multiplier
        product.save(
            update_fields=[
                "stock_unit_name",
                "stock_unit_multiplier",
                "stock_quantity_mode",
                "stock_quantity",
                "alert_quantity",
            ]
        )


class Migration(migrations.Migration):
    dependencies = [
        ("erp", "0003_appsnapshot"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="stock_unit_name",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="product",
            name="stock_unit_multiplier",
            field=models.DecimalField(decimal_places=3, default=1, max_digits=14),
        ),
        migrations.AddField(
            model_name="product",
            name="stock_quantity_mode",
            field=models.CharField(default="storage-main-unit-v1", max_length=40),
        ),
        migrations.RunPython(migrate_existing_stock_to_storage_units, migrations.RunPython.noop),
    ]
