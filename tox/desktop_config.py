import hashlib
import ipaddress
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CONFIG_DIR = ROOT / "config"
DEFAULT_SETTINGS_FILE = CONFIG_DIR / "desktop-settings.example.json"
LOCAL_SETTINGS_FILE = CONFIG_DIR / "desktop-settings.json"


def _load_json(path):
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {}


_DEFAULT_SETTINGS = _load_json(DEFAULT_SETTINGS_FILE)
_LOCAL_SETTINGS = _load_json(LOCAL_SETTINGS_FILE)


def setting(name, default=None, env_var=None):
    if env_var and os.environ.get(env_var) not in (None, ""):
        return os.environ[env_var]
    if name in _LOCAL_SETTINGS:
        return _LOCAL_SETTINGS[name]
    if name in _DEFAULT_SETTINGS:
        return _DEFAULT_SETTINGS[name]
    return default


def bool_setting(name, default=False, env_var=None):
    value = setting(name, default, env_var)
    if isinstance(value, bool):
        return value
    if value is None:
        return bool(default)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


APP_NAME = str(os.environ.get("TOX_APP_NAME") or setting("app_name", "TOX Lite"))
APP_VERSION = str(os.environ.get("TOX_APP_VERSION") or setting("version", "1.0.0"))
APP_SLUG = str(os.environ.get("TOX_APP_SLUG") or setting("app_slug", "toxlite"))


def _local_host(value):
    host = str(value or "").strip() or "127.0.0.1"
    # Allow explicit 0.0.0.0 and other valid IPs to support production binding when provided
    if host in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}:
        return host
    try:
        # If user supplied a valid IP address, return it (allows non-loopback explicit hosts)
        ipaddress.ip_address(host.strip("[]"))
        return host
    except ValueError:
        pass
    return "127.0.0.1"


DATA_DIR = Path(os.environ.get("TOX_DATA_DIR") or setting("data_dir", str(ROOT))).expanduser().resolve()
DATABASE_PATH = Path(os.environ.get("TOX_DB_PATH") or setting("database_path", str(DATA_DIR / "db.sqlite3"))).expanduser().resolve()
BACKUP_DIR = Path(os.environ.get("TOX_BACKUP_DIR") or setting("backup_dir", str(DATA_DIR / "backups"))).expanduser().resolve()
LOG_DIR = Path(os.environ.get("TOX_LOG_DIR") or setting("log_dir", str(DATA_DIR / "logs"))).expanduser().resolve()
RUNTIME_DIR = Path(os.environ.get("TOX_RUNTIME_DIR") or setting("runtime_dir", str(DATA_DIR / ".runtime"))).expanduser().resolve()

HOST = _local_host(os.environ.get("TOX_HOST") or setting("host", "127.0.0.1"))
PORT = int(os.environ.get("TOX_PORT") or setting("port", 8765))
LAN_ACCESS = False
BIND_HOST = HOST
PUBLIC_HOST = ""
SERVER_URL = f"http://{HOST}:{PORT}"


def ensure_runtime_dirs():
    for path in (DATA_DIR, DATABASE_PATH.parent, BACKUP_DIR, LOG_DIR, RUNTIME_DIR, CONFIG_DIR):
        path.mkdir(parents=True, exist_ok=True)


def lan_hosts():
    return []


def lan_urls():
    return []


def source_fingerprint():
    digest = hashlib.sha256()
    roots = [ROOT / "erp", ROOT / "toxerp", ROOT / "assets", ROOT / "pages"]
    files = [ROOT / "index.html", ROOT / "desktop_config.py", ROOT / "start_server.py"]
    for base in roots:
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            files.append(path)
    for path in sorted({item.resolve() for item in files if item.exists()}):
        try:
            stat = path.stat()
        except OSError:
            continue
        rel = path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path)
        digest.update(rel.encode("utf-8", errors="ignore"))
        digest.update(str(stat.st_mtime_ns).encode("ascii"))
        digest.update(str(stat.st_size).encode("ascii"))
    return digest.hexdigest()[:16]


ensure_runtime_dirs()
