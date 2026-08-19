import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path

import desktop_config
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from erp.backup_retention import (
    backup_inventory,
    newest_before_restore_file,
    newest_daily_db_file,
    prune_backup_files,
)


ACTIVE_RUNTIME_LOCKS = ("backup.lock", "restore.lock", "prune_backups.lock")


class Command(BaseCommand):
    help = "Safely prune internal TOX backup files. Defaults to dry-run."

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--dry-run", action="store_true", help="Show the cleanup report without deleting files.")
        mode.add_argument("--apply", action="store_true", help="Delete old internal backups after verification passes.")
        parser.add_argument("--backup-dir", default="", help="Override the backup directory.")
        parser.add_argument("--keep-before-restore", type=int, default=1, help="Number of before-restore JSON backups to keep.")
        parser.add_argument("--keep-daily-db", type=int, default=1, help="Number of db-YYYY-MM-DD.sqlite3 backups to keep.")
        parser.add_argument("--skip-verify", action="store_true", help="Skip latest-backup verification. Not recommended.")
        parser.add_argument("--json", action="store_true", help="Print JSON output.")

    def handle(self, *args, **options):
        apply_changes = bool(options["apply"])
        backup_dir = self._backup_dir(options["backup_dir"])
        verification = self._verification_report(backup_dir, skip_verify=options["skip_verify"])
        if not verification["ok"] and apply_changes:
            payload = {
                "ok": False,
                "mode": "apply",
                "backupDir": str(backup_dir),
                "verification": verification,
                "retention": {"before": backup_inventory(backup_dir)},
            }
            self._write_payload(payload, options["json"])
            raise CommandError("Backup pruning refused because verification failed.")

        if apply_changes:
            with self._prune_lock():
                report = prune_backup_files(
                    backup_dir,
                    keep_before_restore=options["keep_before_restore"],
                    keep_daily_db=options["keep_daily_db"],
                    apply=True,
                )
        else:
            report = prune_backup_files(
                backup_dir,
                keep_before_restore=options["keep_before_restore"],
                keep_daily_db=options["keep_daily_db"],
                apply=False,
            )

        payload = {
            "ok": verification["ok"],
            "mode": "apply" if apply_changes else "dry-run",
            "backupDir": str(backup_dir),
            "verification": verification,
            "retention": report,
        }
        self._write_payload(payload, options["json"])
        if not payload["ok"]:
            raise CommandError("Backup pruning verification failed.")

    def _backup_dir(self, override):
        if override:
            return Path(override).expanduser().resolve()
        return Path(getattr(settings, "BACKUP_DIR", desktop_config.BACKUP_DIR)).expanduser().resolve()

    def _runtime_dir(self):
        return Path(getattr(settings, "RUNTIME_DIR", desktop_config.RUNTIME_DIR)).expanduser().resolve()

    def _verification_report(self, backup_dir, *, skip_verify=False):
        lock_status = self._runtime_lock_status()
        report = {
            "ok": lock_status["ok"],
            "runtimeLocks": lock_status,
            "beforeRestore": {"ok": True, "status": "skipped"},
            "dailyDb": {"ok": True, "status": "skipped"},
        }
        if skip_verify:
            report["skipVerify"] = True
            return report

        before_restore = newest_before_restore_file(backup_dir)
        if before_restore:
            report["beforeRestore"] = self._verify_unified_json_backup(before_restore)
            report["ok"] = report["ok"] and report["beforeRestore"]["ok"]
        else:
            report["beforeRestore"] = {"ok": True, "status": "missing", "path": ""}

        daily_db = newest_daily_db_file(backup_dir)
        if daily_db:
            report["dailyDb"] = self._verify_sqlite_backup(daily_db)
            report["ok"] = report["ok"] and report["dailyDb"]["ok"]
        else:
            report["dailyDb"] = {"ok": True, "status": "missing", "path": ""}
        return report

    def _runtime_lock_status(self):
        runtime_dir = self._runtime_dir()
        locks = []
        if runtime_dir.exists():
            for name in ACTIVE_RUNTIME_LOCKS:
                path = runtime_dir / name
                if not path.exists():
                    continue
                try:
                    detail = path.read_text(encoding="utf-8").strip()
                except OSError:
                    detail = ""
                locks.append({"name": name, "path": str(path), "detail": detail})
        return {"ok": not locks, "locks": locks}

    def _prune_lock(self):
        command = self

        class _Lock:
            def __enter__(self):
                runtime_dir = command._runtime_dir()
                runtime_dir.mkdir(parents=True, exist_ok=True)
                self.path = runtime_dir / "prune_backups.lock"
                try:
                    with self.path.open("x", encoding="utf-8") as handle:
                        handle.write(f"pid={os.getpid()}\nstartedAt={timezone.now().isoformat()}\n")
                except FileExistsError as error:
                    raise CommandError(f"Backup pruning is already running: {self.path}") from error
                return self

            def __exit__(self, exc_type, exc, traceback):
                try:
                    self.path.unlink()
                except FileNotFoundError:
                    pass

        return _Lock()

    def _verify_unified_json_backup(self, path):
        try:
            raw = path.read_bytes()
            payload = json.loads(raw.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            return {"ok": False, "status": "invalid-json", "path": str(path), "error": str(error)}
        if not isinstance(payload, dict):
            return {"ok": False, "status": "invalid-json", "path": str(path), "error": "Backup JSON root is not an object."}
        manifest = payload.get("manifest") if isinstance(payload.get("manifest"), dict) else {}
        if manifest.get("format") != "tox-json-full-backup":
            return {"ok": True, "status": "not-unified-json", "path": str(path)}
        try:
            from erp.api import FullBackupError, _verify_unified_backup_payload

            summary, _manifest, _temp_db = _verify_unified_backup_payload(payload, allow_state_recovery=True)
            return {
                "ok": True,
                "status": "verified",
                "path": str(path),
                "createdAt": manifest.get("createdAt", ""),
                "archiveSize": summary.get("archiveSize", 0),
                "recordCounts": summary.get("recordCounts", {}),
                "warnings": summary.get("warnings", []),
            }
        except FullBackupError as error:
            return {"ok": False, "status": "failed", "path": str(path), "reason": error.code, "details": error.details}
        except Exception as error:
            return {"ok": False, "status": "failed", "path": str(path), "error": str(error)}

    def _verify_sqlite_backup(self, path):
        try:
            uri = f"{path.resolve().as_uri()}?mode=ro&immutable=1"
            with closing(sqlite3.connect(uri, uri=True)) as connection:
                result = connection.execute("PRAGMA integrity_check").fetchone()
        except sqlite3.Error as error:
            return {"ok": False, "status": "failed", "path": str(path), "error": str(error)}
        detail = result[0] if result else "no result"
        return {"ok": str(detail).lower() == "ok", "status": "verified", "path": str(path), "integrity": detail}

    def _write_payload(self, payload, as_json):
        if as_json:
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
            return

        report = payload["retention"]
        before = report.get("before", {})
        after = report.get("after", before)
        self.stdout.write(f"Mode: {payload['mode']}")
        self.stdout.write(f"Backup dir: {payload['backupDir']}")
        self.stdout.write(
            "Before: "
            f"{before.get('totalFiles', 0)} files, {self._format_bytes(before.get('totalBytes', 0))} "
            f"(before-restore={before.get('beforeRestoreCount', 0)}, daily-db={before.get('dailyDbCount', 0)}, "
            f"daily-sidecars={before.get('dailyDbSidecarCount', 0)}, final-safety={before.get('finalSafetyCount', 0)}, "
            f"unknown={before.get('unknownCount', 0)})"
        )
        self.stdout.write(
            "After: "
            f"{after.get('totalFiles', 0)} files, {self._format_bytes(after.get('totalBytes', 0))} "
            f"(before-restore={after.get('beforeRestoreCount', 0)}, daily-db={after.get('dailyDbCount', 0)}, "
            f"daily-sidecars={after.get('dailyDbSidecarCount', 0)}, final-safety={after.get('finalSafetyCount', 0)}, "
            f"unknown={after.get('unknownCount', 0)})"
        )
        self.stdout.write(f"Verification: {'ok' if payload['verification']['ok'] else 'failed'}")
        kept = report.get("kept", [])
        candidates = report.get("candidates", [])
        deleted = report.get("deleted", [])
        self.stdout.write(f"Kept: {len(kept)}")
        for item in kept:
            self.stdout.write(f"  keep {item['reason']}: {item['name']} ({self._format_bytes(item['sizeBytes'])})")
        self.stdout.write(f"Candidates: {len(candidates)} ({self._format_bytes(report.get('candidateBytes', 0))})")
        for item in candidates:
            self.stdout.write(f"  prune {item['reason']}: {item['name']} ({self._format_bytes(item['sizeBytes'])})")
        if payload["mode"] == "apply":
            self.stdout.write(f"Deleted: {len(deleted)} ({self._format_bytes(report.get('deletedBytes', 0))})")
        unknown = before.get("unknown", [])
        if unknown:
            self.stdout.write(f"Unknown untouched: {len(unknown)}")
            for item in unknown:
                self.stdout.write(f"  untouched: {item['name']} ({self._format_bytes(item['sizeBytes'])})")

    def _format_bytes(self, value):
        value = float(value or 0)
        for unit in ("B", "KB", "MB", "GB"):
            if value < 1024 or unit == "GB":
                return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
            value /= 1024
        return f"{value:.1f} GB"
