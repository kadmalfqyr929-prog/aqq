# Generated for TOX returns support.

import django.db.models.deletion
from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("erp", "0029_product_barcode_integrity"),
    ]

    operations = [
        migrations.CreateModel(
            name="ReturnDocument",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("external_id", models.CharField(max_length=80, unique=True)),
                ("return_type", models.CharField(choices=[("sale_return", "Sale return"), ("purchase_return", "Purchase return")], max_length=30)),
                ("party_name", models.CharField(blank=True, max_length=180)),
                ("exchange_rate", models.DecimalField(decimal_places=4, default=1460, max_digits=14)),
                ("total_usd", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ("settlement_method", models.CharField(choices=[("credit", "Credit"), ("cash", "Cash")], default="credit", max_length=20)),
                ("reason", models.CharField(blank=True, max_length=240)),
                ("note", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("client", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="returns", to="erp.client")),
                ("invoice", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="returns", to="erp.invoice")),
                ("purchase", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="returns", to="erp.purchase")),
                ("supplier", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="returns", to="erp.supplier")),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.CreateModel(
            name="ReturnItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("unit_id", models.CharField(blank=True, max_length=80)),
                ("unit_name", models.CharField(blank=True, max_length=100)),
                ("quantity", models.DecimalField(decimal_places=4, default=0, max_digits=15)),
                ("qty_in_base", models.DecimalField(decimal_places=4, default=0, max_digits=15)),
                ("unit_price_usd", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ("total_usd", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ("unit_cost_usd", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ("total_cost_usd", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ("condition", models.CharField(choices=[("resellable", "Resellable"), ("damaged", "Damaged")], default="resellable", max_length=20)),
                ("cost_breakdown", models.JSONField(blank=True, default=list)),
                ("invoice_item", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="return_items", to="erp.invoiceitem")),
                ("product", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="return_items", to="erp.product")),
                ("purchase_item", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="return_items", to="erp.purchaseitem")),
                ("return_document", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="items", to="erp.returndocument")),
                ("warehouse", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="return_items", to="erp.warehouse")),
            ],
        ),
        migrations.AddIndex(
            model_name="returndocument",
            index=models.Index(fields=["return_type", "created_at"], name="erp_returnd_return__9d4f77_idx"),
        ),
        migrations.AddIndex(
            model_name="returndocument",
            index=models.Index(fields=["invoice", "created_at"], name="erp_returnd_invoice_27b9f8_idx"),
        ),
        migrations.AddIndex(
            model_name="returndocument",
            index=models.Index(fields=["purchase", "created_at"], name="erp_returnd_purchase_59d8b1_idx"),
        ),
        migrations.AddIndex(
            model_name="returndocument",
            index=models.Index(fields=["client", "created_at"], name="erp_returnd_client__57c1f1_idx"),
        ),
        migrations.AddIndex(
            model_name="returndocument",
            index=models.Index(fields=["supplier", "created_at"], name="erp_returnd_supplier_6f94c3_idx"),
        ),
        migrations.AddIndex(
            model_name="returnitem",
            index=models.Index(fields=["return_document", "product"], name="erp_returni_return__940653_idx"),
        ),
        migrations.AddIndex(
            model_name="returnitem",
            index=models.Index(fields=["invoice_item"], name="erp_returni_invoice_2b6624_idx"),
        ),
        migrations.AddIndex(
            model_name="returnitem",
            index=models.Index(fields=["purchase_item"], name="erp_returni_purchase_097a78_idx"),
        ),
        migrations.AddIndex(
            model_name="returnitem",
            index=models.Index(fields=["product", "warehouse"], name="erp_returni_product_4fb12f_idx"),
        ),
    ]
