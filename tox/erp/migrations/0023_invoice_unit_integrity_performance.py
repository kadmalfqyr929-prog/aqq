# Generated for invoice unit integrity and local SQLite performance hardening.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("erp", "0022_warehouse_color"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="product",
            index=models.Index(fields=["deleted_at", "warehouse", "name"], name="erp_product_active_wh_name_idx"),
        ),
        migrations.AddIndex(
            model_name="productunit",
            index=models.Index(fields=["product", "deleted_at"], name="erp_unit_product_active_idx"),
        ),
        migrations.AddIndex(
            model_name="productunit",
            index=models.Index(fields=["product", "name", "multiplier"], name="erp_unit_product_name_mult_idx"),
        ),
        migrations.AddIndex(
            model_name="invoiceitem",
            index=models.Index(fields=["product", "unit_id"], name="erp_invitem_product_unit_idx"),
        ),
        migrations.AddIndex(
            model_name="stockmovement",
            index=models.Index(fields=["product", "created_at"], name="erp_stockmove_product_date_idx"),
        ),
    ]
