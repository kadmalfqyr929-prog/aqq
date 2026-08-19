import shutil
from pathlib import Path

from check_database import create_daily_backup
from django.conf import settings
from django.contrib.sessions.models import Session
from django.core.management.base import BaseCommand
from django.db import connection
from django.utils import timezone

from erp.models import AuditLog, InvoiceItem, LoginEvent, ProductUnit


class Command(BaseCommand):
    help = "Safely back up and optimize the local SQLite database without touching business data."

    def add_arguments(self, parser):
        parser.add_argument("--no-backup", action="store_true", help="Skip the pre-maintenance SQLite backup.")
        parser.add_argument("--dry-run", action="store_true", help="Show what would be cleaned without deleting rows.")
        parser.add_argument("--login-days", type=int, default=90, help="Keep login events for this many days.")
        parser.add_argument("--audit-days", type=int, default=180, help="Keep audit logs for this many days.")
        parser.add_argument("--log-days", type=int, default=30, help="Keep log files modified within this many days.")
        parser.add_argument("--clean-log-files", action="store_true", help="Archive old *.log files from the configured log directory.")
        parser.add_argument("--repair-invoice-units", action="store_true", help="Repair legacy invoice item unit ids when one safe active product unit matches.")

    def handle(self, *args, **options):
        db_settings = settings.DATABASES["default"]
        db_path = Path(db_settings["NAME"])
        if db_settings["ENGINE"] != "django.db.backends.sqlite3":
            self.stdout.write(self.style.WARNING("maintain_db is optimized for SQLite; only session/log cleanup will run."))
        if db_path.exists() and not options["no_backup"] and not options["dry_run"]:
            backup_path = create_daily_backup()
            self.stdout.write(self.style.SUCCESS(f"Daily SQLite backup ready: {backup_path}"))

        now = timezone.now()
        expired_sessions = Session.objects.filter(expire_date__lt=now)
        login_cutoff = now - timezone.timedelta(days=max(1, options["login_days"]))
        audit_cutoff = now - timezone.timedelta(days=max(1, options["audit_days"]))
        old_logins = LoginEvent.objects.filter(created_at__lt=login_cutoff)
        old_audits = AuditLog.objects.filter(created_at__lt=audit_cutoff)
        old_log_files = []
        log_cutoff_ts = (now - timezone.timedelta(days=max(1, options["log_days"]))).timestamp()
        if options["clean_log_files"]:
            log_dir = Path(getattr(settings, "LOG_DIR", settings.BASE_DIR / "logs"))
            if log_dir.exists():
                for path in log_dir.glob("*.log"):
                    try:
                        if path.stat().st_mtime < log_cutoff_ts:
                            old_log_files.append(path)
                    except OSError:
                        continue

        counts = {
            "expired_sessions": expired_sessions.count(),
            "old_login_events": old_logins.count(),
            "old_audit_logs": old_audits.count(),
            "old_log_files": len(old_log_files),
        }
        if options["dry_run"]:
            self.stdout.write(f"Dry run cleanup counts: {counts}")
            if options["repair_invoice_units"]:
                self.stdout.write(f"Dry run invoice unit repairs: {len(self._invoice_unit_repairs())}")
            if old_log_files:
                self.stdout.write("Old log files:")
                for path in old_log_files:
                    self.stdout.write(f"  {path}")
            return

        expired_sessions.delete()
        old_logins.delete()
        old_audits.delete()
        archived_log_files = []
        archive_dir = None
        if old_log_files:
            archive_dir = Path(getattr(settings, "LOG_DIR", settings.BASE_DIR / "logs")) / "archive"
            archive_dir.mkdir(parents=True, exist_ok=True)
        for path in old_log_files:
            try:
                target = archive_dir / path.name
                if target.exists():
                    stamp = timezone.localtime().strftime("%Y%m%d-%H%M%S")
                    target = archive_dir / f"{path.stem}-{stamp}{path.suffix}"
                shutil.move(str(path), str(target))
                archived_log_files.append(target)
            except OSError as error:
                self.stdout.write(self.style.WARNING(f"Could not archive log file {path}: {error}"))
        repaired_units = 0
        if options["repair_invoice_units"]:
            repaired_units = self._repair_invoice_units()

        if db_settings["ENGINE"] == "django.db.backends.sqlite3":
            with connection.cursor() as cursor:
                cursor.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                cursor.execute("PRAGMA optimize")

        if repaired_units:
            counts["invoice_unit_repairs"] = repaired_units
        if archived_log_files:
            counts["archived_log_files"] = len(archived_log_files)
        self.stdout.write(self.style.SUCCESS(f"Database maintenance complete: {counts}"))

    def _invoice_unit_repairs(self):
        repairs = []
        items = InvoiceItem.objects.select_related("invoice", "product").filter(product__isnull=False).exclude(unit_id="")
        for item in items:
            if ProductUnit.objects.filter(product=item.product, external_id=item.unit_id).exists():
                continue
            units = list(ProductUnit.objects.filter(product=item.product, deleted_at__isnull=True))
            unit_name = (item.unit_name or "").strip()
            matches = [unit for unit in units if unit.name == unit_name] if unit_name else []
            if item.quantity and item.qty_in_base:
                expected_multiplier = item.qty_in_base / item.quantity
                matches = [unit for unit in (matches or units) if unit.multiplier == expected_multiplier]
            if not matches and len(units) == 1:
                matches = units
            if len(matches) == 1:
                repairs.append((item, matches[0]))
        return repairs

    def _repair_invoice_units(self):
        repaired = 0
        for item, unit in self._invoice_unit_repairs():
            old_unit_id = item.unit_id
            item.unit_id = unit.external_id
            item.unit_name = item.unit_name or unit.name
            item.save(update_fields=["unit_id", "unit_name"])
            AuditLog.objects.create(
                action="repair",
                entity_type="invoice_item",
                entity_id=str(item.id),
                message="Repaired legacy invoice item unit id",
                data={
                    "invoiceId": item.invoice.external_id,
                    "productId": item.product.external_id,
                    "oldUnitId": old_unit_id,
                    "newUnitId": unit.external_id,
                },
            )
            repaired += 1
        return repaired
