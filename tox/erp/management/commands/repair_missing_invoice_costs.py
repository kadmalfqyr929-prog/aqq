from django.core.management.base import BaseCommand

from erp.services import repair_missing_invoice_costs


class Command(BaseCommand):
    help = "Repair invoice items that lost COGS by using the product purchase cost."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report what would be repaired without saving changes.")
        parser.add_argument("--invoice", default="", help="Limit repair to a single invoice external id.")

    def handle(self, *args, **options):
        result = repair_missing_invoice_costs(
            dry_run=options["dry_run"],
            invoice_id=options.get("invoice") or None,
        )
        self.stdout.write(
            self.style.SUCCESS(
                "Scanned {scanned}, repaired {repaired}, fifo {fifoRepaired}, estimated {estimatedRepaired}, skipped {skipped}, dryRun={dryRun}".format(**result)
            )
        )
