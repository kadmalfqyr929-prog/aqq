import argparse
import shutil
from datetime import datetime, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SAFE_RUNTIME_NAMES = {"server.pid", "server.lock", "toxerp.lock"}
NEVER_DELETE = {
    "db.sqlite3",
    "db.sqlite3-shm",
    "db.sqlite3-wal",
    "config",
    "backups",
    "desktop-app/package-lock.json",
    "desktop-app/build/license-public.pem",
}
EXCLUDED_PARTS = {
    ".git",
    ".venv",
    "backups",
    "config",
    "dist",
    "node_modules",
}


def inside_root(path):
    try:
        path.resolve().relative_to(ROOT.resolve())
        return True
    except ValueError:
        return False


def is_never_delete(path):
    rel = path.relative_to(ROOT).as_posix()
    parts = set(path.relative_to(ROOT).parts)
    return rel in NEVER_DELETE or bool(parts & EXCLUDED_PARTS)


def collect_candidates(include_logs=False, include_runtime=False, days=30):
    candidates = []
    for cache_dir in ROOT.rglob("__pycache__"):
        if cache_dir.is_dir() and inside_root(cache_dir) and not is_never_delete(cache_dir):
            candidates.append(("pycache", cache_dir))
    for pyc in ROOT.rglob("*.pyc"):
        if pyc.is_file() and inside_root(pyc) and not is_never_delete(pyc):
            candidates.append(("pyc", pyc))
    if include_runtime:
        runtime = ROOT / ".runtime"
        if runtime.exists():
            for item in runtime.iterdir():
                if item.name.lower() in SAFE_RUNTIME_NAMES and inside_root(item):
                    candidates.append(("runtime", item))
    if include_logs:
        cutoff = datetime.now() - timedelta(days=max(1, days))
        logs = ROOT / "logs"
        if logs.exists():
            for log in logs.glob("*.log"):
                try:
                    modified = datetime.fromtimestamp(log.stat().st_mtime)
                except OSError:
                    continue
                if modified < cutoff and inside_root(log):
                    candidates.append(("old-log", log))
    return candidates


def remove_path(path):
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def main():
    parser = argparse.ArgumentParser(description="Safely list or remove disposable project cache files.")
    parser.add_argument("--apply", action="store_true", help="Delete safe disposable files. Default is dry-run.")
    parser.add_argument("--include-logs", action="store_true", help="Include old log files in candidates.")
    parser.add_argument("--include-runtime", action="store_true", help="Include known runtime lock/pid files.")
    parser.add_argument("--days", type=int, default=30, help="Old log age threshold.")
    args = parser.parse_args()

    candidates = collect_candidates(include_logs=args.include_logs, include_runtime=args.include_runtime, days=args.days)
    for kind, path in candidates:
        rel = path.relative_to(ROOT)
        print(f"{kind}: {rel}")
    if args.apply:
        for _, path in candidates:
            if not inside_root(path) or is_never_delete(path):
                raise RuntimeError(f"Refusing to delete protected path: {path}")
            remove_path(path)
        print(f"deleted: {len(candidates)}")
    else:
        print(f"dry-run candidates: {len(candidates)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
