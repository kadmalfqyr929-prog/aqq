from django.db import migrations, models
from django.db.models import Q
import re


_BARCODE_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def normalize_barcode(value):
    text = str(value or "").translate(_BARCODE_DIGITS)
    text = re.sub(r"[\u200b-\u200d\ufeff]", "", text)
    return re.sub(r"\s+", "", text).strip()


def normalize_and_clear_duplicate_barcodes(apps, schema_editor):
    Product = apps.get_model("erp", "Product")
    ProductUnit = apps.get_model("erp", "ProductUnit")
    owners = {}

    def keep_or_clear(key, barcode, obj):
        normalized = normalize_barcode(barcode)
        if not normalized:
            if barcode:
                obj.barcode = ""
                obj.save(update_fields=["barcode"])
            return
        previous = owners.get(normalized.casefold())
        if previous is None:
            owners[normalized.casefold()] = (obj._meta.label_lower, obj.pk)
            if barcode != normalized:
                obj.barcode = normalized
                obj.save(update_fields=["barcode"])
            return
        obj.barcode = ""
        obj.save(update_fields=["barcode"])

    for product in Product.objects.filter(deleted_at__isnull=True).exclude(barcode="").order_by("id"):
        keep_or_clear("product", product.barcode, product)

    for unit in (
        ProductUnit.objects.filter(deleted_at__isnull=True, product__deleted_at__isnull=True)
        .exclude(barcode="")
        .order_by("product_id", "id")
    ):
        keep_or_clear("unit", unit.barcode, unit)

    Product.objects.filter(deleted_at__isnull=False).exclude(barcode="").update(barcode="")
    ProductUnit.objects.filter(Q(deleted_at__isnull=False) | Q(product__deleted_at__isnull=False)).exclude(barcode="").update(barcode="")


class Migration(migrations.Migration):

    dependencies = [
        ("erp", "0028_productsearchtoken"),
    ]

    operations = [
        migrations.RunPython(normalize_and_clear_duplicate_barcodes, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="productunit",
            index=models.Index(fields=["barcode"], name="erp_unit_barcode_idx"),
        ),
        migrations.AddConstraint(
            model_name="product",
            constraint=models.UniqueConstraint(
                fields=("barcode",),
                condition=models.Q(("barcode", ""), _negated=True),
                name="unique_non_empty_product_barcode",
            ),
        ),
    ]
