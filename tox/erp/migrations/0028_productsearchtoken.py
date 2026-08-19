import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models
import re


TOKEN_RE = re.compile(r"[\w\u0600-\u06ff]+", re.UNICODE)
DIGIT_TRANSLATION = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def _normalize_text(value):
    text = str(value or "").translate(DIGIT_TRANSLATION).casefold()
    return re.sub(r"[\u0640\u200c\u200d]+", "", text)


def _terms(value):
    return [
        token[:120]
        for token in TOKEN_RE.findall(_normalize_text(value))
        if token and (len(token) > 1 or token.isdigit())
    ]


def _normalize_barcode(value):
    return re.sub(r"\s+", "", str(value or "").translate(DIGIT_TRANSLATION).strip())


def backfill_pos_tokens(apps, schema_editor):
    Product = apps.get_model("erp", "Product")
    ProductUnit = apps.get_model("erp", "ProductUnit")
    ProductSearchToken = apps.get_model("erp", "ProductSearchToken")
    batch = []
    for product in Product.objects.filter(deleted_at__isnull=True).iterator(chunk_size=500):
        units = list(ProductUnit.objects.filter(product_id=product.id, deleted_at__isnull=True))
        values = [
            product.name,
            product.brand,
            product.origin_country,
            product.kind,
            product.sku,
            product.barcode,
            product.base_unit,
            product.stock_unit_name,
        ]
        for unit in units:
            values.extend([unit.name, unit.barcode])
        tokens = set()
        for value in values:
            tokens.update(_terms(value))
        for barcode in [product.barcode, *(unit.barcode for unit in units)]:
            normalized = _normalize_barcode(barcode)
            if normalized:
                tokens.add(normalized[:120])
        batch.extend(ProductSearchToken(product_id=product.id, token=token) for token in sorted(tokens))
        if len(batch) >= 5000:
            ProductSearchToken.objects.bulk_create(batch, ignore_conflicts=True)
            batch = []
    if batch:
        ProductSearchToken.objects.bulk_create(batch, ignore_conflicts=True)


class Migration(migrations.Migration):

    dependencies = [
        ("erp", "0027_productimage_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProductSearchToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token", models.CharField(db_index=True, max_length=120)),
                ("weight", models.PositiveSmallIntegerField(default=1)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("product", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="search_tokens", to="erp.product")),
            ],
        ),
        migrations.AddIndex(
            model_name="productsearchtoken",
            index=models.Index(fields=["token", "product"], name="erp_pos_token_product_idx"),
        ),
        migrations.AddIndex(
            model_name="productsearchtoken",
            index=models.Index(fields=["product", "token"], name="erp_pos_product_token_idx"),
        ),
        migrations.AddConstraint(
            model_name="productsearchtoken",
            constraint=models.UniqueConstraint(fields=("product", "token"), name="unique_pos_product_search_token"),
        ),
        migrations.RunPython(backfill_pos_tokens, migrations.RunPython.noop),
    ]
