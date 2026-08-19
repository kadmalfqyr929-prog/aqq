import sqlite3
from contextlib import closing
from datetime import date

import desktop_config


def _discard_sqlite_sidecars(path):
    for suffix in ("-wal", "-shm", "-journal"):
        try:
            path.with_name(f"{path.name}{suffix}").unlink()
        except FileNotFoundError:
            pass


def create_daily_backup():
    desktop_config.ensure_runtime_dirs()
    source = desktop_config.DATABASE_PATH
    if not source.exists():
        raise FileNotFoundError(f"missing database: {source}")

    target = desktop_config.BACKUP_DIR / f"db-{date.today().isoformat()}.sqlite3"
    temp_target = target.with_name(f"{target.name}.tmp")
    try:
        temp_target.unlink()
    except FileNotFoundError:
        pass
    _discard_sqlite_sidecars(temp_target)

    with closing(sqlite3.connect(source)) as source_connection, closing(sqlite3.connect(temp_target)) as backup_connection:
        source_connection.backup(backup_connection)
        backup_connection.execute("PRAGMA journal_mode=DELETE")
        integrity = backup_connection.execute("PRAGMA integrity_check").fetchone()
        if not integrity or str(integrity[0]).lower() != "ok":
            raise RuntimeError(f"daily backup integrity_check failed: {integrity[0] if integrity else 'no result'}")

    temp_target.replace(target)
    _discard_sqlite_sidecars(target)
    return target


def main():
    path = desktop_config.DATABASE_PATH
    if not path.exists():
        print(f"missing: {path}")
        return 1
    with sqlite3.connect(path) as connection:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
    print(f"database: {path}")
    print(f"integrity_check: {integrity}")
    print(f"foreign_key_issues: {len(foreign_keys)}")
    return 0 if integrity == "ok" and not foreign_keys else 1


if __name__ == "__main__":
    raise SystemExit(main())
