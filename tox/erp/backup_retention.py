import re
from pathlib import Path


BEFORE_RESTORE_RE = re.compile(r"^before-restore-\d{8}-\d{6}\.json$")
DAILY_DB_RE = re.compile(r"^db-\d{4}-\d{2}-\d{2}\.sqlite3$")
DAILY_DB_SIDECAR_RE = re.compile(r"^db-\d{4}-\d{2}-\d{2}\.sqlite3-(wal|shm|journal)$", re.IGNORECASE)
FINAL_SAFETY_RE = re.compile(r"^final-safety-.*\.(json|sqlite3)$", re.IGNORECASE)
LEGACY_DB_MAINTENANCE_RE = re.compile(r"^db-maintenance-\d{8}-\d{6}\.sqlite3$", re.IGNORECASE)


def _inside_directory(path, directory):
    try:
        path.resolve().relative_to(directory.resolve())
        return True
    except ValueError:
        return False


def _matching_files(directory, pattern):
    directory = Path(directory)
    if not directory.exists():
        return []
    return [
        item
        for item in directory.iterdir()
        if item.is_file() and pattern.match(item.name) and _inside_directory(item, directory)
    ]


def _sort_newest_first(files):
    return sorted(files, key=lambda item: (item.stat().st_mtime, item.name), reverse=True)


def _backup_files(directory):
    directory = Path(directory)
    if not directory.exists():
        return []
    return [item for item in directory.iterdir() if item.is_file() and _inside_directory(item, directory)]


def _file_size(path):
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _report_entry(path, reason):
    return {"name": path.name, "path": str(path), "sizeBytes": _file_size(path), "reason": reason}


def newest_before_restore_file(backup_dir):
    files = _sort_newest_first(_matching_files(backup_dir, BEFORE_RESTORE_RE))
    return files[0] if files else None


def newest_daily_db_file(backup_dir):
    files = _sort_newest_first(_matching_files(backup_dir, DAILY_DB_RE))
    return files[0] if files else None


def backup_inventory(backup_dir):
    backup_dir = Path(backup_dir)
    files = _backup_files(backup_dir)
    before_restore = [item for item in files if BEFORE_RESTORE_RE.match(item.name)]
    daily_db = [item for item in files if DAILY_DB_RE.match(item.name)]
    daily_db_sidecars = [item for item in files if DAILY_DB_SIDECAR_RE.match(item.name)]
    final_safety = [item for item in files if FINAL_SAFETY_RE.match(item.name)]
    legacy_db_maintenance = [item for item in files if LEGACY_DB_MAINTENANCE_RE.match(item.name)]
    known = set(before_restore + daily_db + daily_db_sidecars + final_safety + legacy_db_maintenance)
    unknown = sorted((item for item in files if item not in known), key=lambda item: item.name)
    return {
        "backupDir": str(backup_dir),
        "totalFiles": len(files),
        "totalBytes": sum(_file_size(item) for item in files),
        "beforeRestoreCount": len(before_restore),
        "dailyDbCount": len(daily_db),
        "dailyDbSidecarCount": len(daily_db_sidecars),
        "finalSafetyCount": len(final_safety),
        "legacyDbMaintenanceCount": len(legacy_db_maintenance),
        "unknownCount": len(unknown),
        "unknown": [_report_entry(item, "unknown-untouched") for item in unknown],
    }


def _delete_file(path, directory):
    if not _inside_directory(path, directory):
        raise RuntimeError(f"Refusing to delete outside backup directory: {path}")
    if not path.is_file():
        raise RuntimeError(f"Refusing to delete non-file backup path: {path}")
    path.unlink()


def prune_backup_files(
    backup_dir,
    *,
    keep_before_restore=1,
    keep_daily_db=1,
    prune_before_restore=True,
    prune_daily_db=True,
    prune_daily_db_sidecars=True,
    prune_final_safety=True,
    prune_legacy_db_maintenance=True,
    apply=False,
):
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    keep_before_restore = max(0, int(keep_before_restore))
    keep_daily_db = max(0, int(keep_daily_db))

    report = {
        "backupDir": str(backup_dir),
        "apply": bool(apply),
        "before": backup_inventory(backup_dir),
        "kept": [],
        "deleted": [],
        "candidates": [],
        "deletedBytes": 0,
        "candidateBytes": 0,
    }

    candidates = []
    if prune_before_restore:
        files = _sort_newest_first(_matching_files(backup_dir, BEFORE_RESTORE_RE))
        report["kept"].extend(_report_entry(path, "latest-before-restore") for path in files[:keep_before_restore])
        candidates.extend((path, "old-before-restore") for path in files[keep_before_restore:])

    if prune_daily_db:
        files = _sort_newest_first(_matching_files(backup_dir, DAILY_DB_RE))
        report["kept"].extend(_report_entry(path, "latest-daily-db") for path in files[:keep_daily_db])
        candidates.extend((path, "old-daily-db") for path in files[keep_daily_db:])

    if prune_daily_db_sidecars:
        candidates.extend((path, "sqlite-daily-sidecar") for path in _sort_newest_first(_matching_files(backup_dir, DAILY_DB_SIDECAR_RE)))

    if prune_final_safety:
        candidates.extend((path, "old-final-safety") for path in _sort_newest_first(_matching_files(backup_dir, FINAL_SAFETY_RE)))

    if prune_legacy_db_maintenance:
        candidates.extend(
            (path, "legacy-db-maintenance")
            for path in _sort_newest_first(_matching_files(backup_dir, LEGACY_DB_MAINTENANCE_RE))
        )

    for path, reason in candidates:
        entry = _report_entry(path, reason)
        report["candidates"].append(entry)
        report["candidateBytes"] += entry["sizeBytes"]
        if apply:
            _delete_file(path, backup_dir)
            report["deleted"].append(entry)
            report["deletedBytes"] += entry["sizeBytes"]

    report["after"] = backup_inventory(backup_dir)
    return report
