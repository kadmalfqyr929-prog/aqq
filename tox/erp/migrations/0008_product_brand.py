from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("erp", "0007_alter_product_alert_quantity_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="brand",
            field=models.CharField(blank=True, max_length=140),
        ),
    ]
