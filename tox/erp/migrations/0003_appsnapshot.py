from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("erp", "0002_productunit_scoped_external_id"),
    ]

    operations = [
        migrations.CreateModel(
            name="AppSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("key", models.CharField(default="default", max_length=80, unique=True)),
                ("data", models.JSONField(default=dict)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
