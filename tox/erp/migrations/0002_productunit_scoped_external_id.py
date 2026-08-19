from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("erp", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="productunit",
            name="external_id",
            field=models.CharField(max_length=80),
        ),
        migrations.AlterUniqueTogether(
            name="productunit",
            unique_together={("product", "external_id")},
        ),
    ]
