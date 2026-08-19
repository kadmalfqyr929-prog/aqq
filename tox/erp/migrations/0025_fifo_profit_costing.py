from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("erp", "0024_product_origin_country"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="purchase_cost_usd",
            field=models.DecimalField(decimal_places=4, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="invoiceitem",
            name="cost_breakdown",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="invoiceitem",
            name="cost_status",
            field=models.CharField(default="missing_cost", max_length=30),
        ),
        migrations.AddField(
            model_name="invoiceitem",
            name="gross_profit_usd",
            field=models.DecimalField(decimal_places=4, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="invoiceitem",
            name="total_cost_usd",
            field=models.DecimalField(decimal_places=4, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="invoiceitem",
            name="unit_cost_usd",
            field=models.DecimalField(decimal_places=4, default=0, max_digits=14),
        ),
        migrations.AddIndex(
            model_name="stockbatch",
            index=models.Index(fields=["product", "warehouse", "is_closed", "received_at"], name="erp_batch_fifo_idx"),
        ),
        migrations.AddIndex(
            model_name="invoiceitem",
            index=models.Index(fields=["product", "cost_status"], name="erp_invitem_product_cost_idx"),
        ),
    ]
