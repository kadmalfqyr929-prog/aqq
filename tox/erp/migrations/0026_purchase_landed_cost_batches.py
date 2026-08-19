from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("erp", "0025_fifo_profit_costing"),
    ]

    operations = [
        migrations.AddField(
            model_name="purchaseitem",
            name="supplier_unit_cost_usd",
            field=models.DecimalField(decimal_places=4, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="purchaseitem",
            name="base_unit_cost_usd",
            field=models.DecimalField(decimal_places=4, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="purchaseitem",
            name="storage_unit_cost_usd",
            field=models.DecimalField(decimal_places=4, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="purchaseitem",
            name="landed_cost_share_usd",
            field=models.DecimalField(decimal_places=4, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="purchaseitem",
            name="discount_share_usd",
            field=models.DecimalField(decimal_places=4, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="purchaseitem",
            name="batch_code",
            field=models.CharField(blank=True, max_length=100),
        ),
    ]
