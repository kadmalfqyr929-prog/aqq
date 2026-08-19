from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("erp", "0023_invoice_unit_integrity_performance"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="origin_country",
            field=models.CharField(blank=True, max_length=140),
        ),
    ]
