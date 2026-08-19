from django.core.management.base import BaseCommand

from erp.services import repair_stock_cost_batches


def _console_safe(value):
    return str(value).encode("ascii", "backslashreplace").decode("ascii")


class Command(BaseCommand):
    help = "Repair missing FIFO stock cost batches from product stock and purchase cost."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report missing cost batches without writing changes.")
        parser.add_argument("--product", help="Repair only one product external id.")

    def handle(self, *args, **options):
        result = repair_stock_cost_batches(
            dry_run=options["dry_run"],
            product_id=options.get("product"),
        )
        self.stdout.write(
            self.style.SUCCESS(
                "Scanned {scanned}, repaired {repaired}, skipped {skipped}, missing cost {missingCost}, dry-run {dryRun}".format(
                    **result
                )
            )
        )
        for item in result["items"]:
            safe_item = {key: _console_safe(value) for key, value in item.items()}
            self.stdout.write(
                "{status}: {productName} ({productId}) stock={stockQuantity} batches={batchQuantity} missing={missingQuantity} cost={purchaseCostUsd}".format(
                    **safe_item
                )
            )
