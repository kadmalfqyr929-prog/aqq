import os
from pathlib import Path

import desktop_config


BASE_DIR = Path(__file__).resolve().parent.parent
desktop_config.ensure_runtime_dirs()

SECRET_KEY = os.environ.get("TOX_SECRET_KEY", desktop_config.setting("secret_key", "tox-dev-secret-key-change-before-production"))
DESKTOP_MODE = desktop_config.bool_setting("desktop_mode", True, "TOX_DESKTOP_MODE")
DEBUG = os.environ.get("TOX_DEBUG", "0" if DESKTOP_MODE else "1") == "1"
LAN_ACCESS = False
LAN_HOSTS = []
LAN_URLS = []

_default_allowed_hosts = ["127.0.0.1", "localhost", "testserver"]
_allowed_hosts_source = os.environ.get("TOX_ALLOWED_HOSTS", ",".join(dict.fromkeys(_default_allowed_hosts)))
ALLOWED_HOSTS = [
    host.strip()
    for host in _allowed_hosts_source.split(",")
    if host.strip()
]
if DESKTOP_MODE and os.environ.get("TOX_ALLOW_WILDCARD_HOSTS", "0") != "1":
    ALLOWED_HOSTS = [host for host in ALLOWED_HOSTS if host != "*"]
if not ALLOWED_HOSTS:
    ALLOWED_HOSTS = list(dict.fromkeys(_default_allowed_hosts))

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "erp",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise middleware should come directly after SecurityMiddleware for serving static files in production
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "erp.middleware.LocalOnlyMiddleware",
    "erp.middleware.DevCorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "erp.middleware.BackendDebugLoggingMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "erp.middleware.DesktopHeadersMiddleware",
]

ROOT_URLCONF = "toxerp.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "toxerp.wsgi.application"

# Database configuration: prefer DATABASE_URL when provided (e.g., PostgreSQL on Railway), otherwise fallback to local SQLite
DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("TOX_DATABASE_URL")
if DATABASE_URL:
    # Parse DATABASE_URL without adding new dependencies
    from urllib.parse import urlparse

    parsed = urlparse(DATABASE_URL)
    if parsed.scheme in ("postgres", "postgresql"):
        DB_NAME = parsed.path[1:]
        DB_USER = parsed.username or ""
        DB_PASSWORD = parsed.password or ""
        DB_HOST = parsed.hostname or ""
        DB_PORT = parsed.port or ""
        DATABASES = {
            "default": {
                "ENGINE": "django.db.backends.postgresql",
                "NAME": DB_NAME,
                "USER": DB_USER,
                "PASSWORD": DB_PASSWORD,
                "HOST": DB_HOST,
                "PORT": DB_PORT,
                "CONN_MAX_AGE": int(os.environ.get("TOX_DB_CONN_MAX_AGE", "60")),
            }
        }
    elif parsed.scheme.startswith("sqlite"):
        # sqlite:///absolute/path or sqlite:///:memory:
        path = parsed.path or ""
        if path in (":memory:", ""):
            NAME = path
        else:
            from pathlib import Path

            NAME = Path(path).expanduser()
        DATABASES = {
            "default": {
                "ENGINE": "django.db.backends.sqlite3",
                "NAME": NAME,
                "CONN_MAX_AGE": int(os.environ.get("TOX_DB_CONN_MAX_AGE", "60")),
                "OPTIONS": {"timeout": 30},
            }
        }
    else:
        # Unknown scheme; fallback to desktop sqlite
        DATABASES = {
            "default": {
                "ENGINE": "django.db.backends.sqlite3",
                "NAME": desktop_config.DATABASE_PATH,
                "CONN_MAX_AGE": int(os.environ.get("TOX_DB_CONN_MAX_AGE", "60")),
                "OPTIONS": {"timeout": 30},
            }
        }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": desktop_config.DATABASE_PATH,
            "CONN_MAX_AGE": int(os.environ.get("TOX_DB_CONN_MAX_AGE", "60")),
            "OPTIONS": {
                "timeout": 30,
            },
        }
    }

BACKUP_DIR = desktop_config.BACKUP_DIR
LOG_DIR = desktop_config.LOG_DIR
RUNTIME_DIR = desktop_config.RUNTIME_DIR

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Build CSRF and CORS trusted origins
_default_csrf_origins = ["http://127.0.0.1:5500", "http://localhost:5500"]
_default_cors_origins = ["http://127.0.0.1:5500", "http://localhost:5500"]

CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "TOX_CSRF_TRUSTED_ORIGINS",
        ",".join(_default_csrf_origins),
    ).split(",")
    if origin.strip()
]

DEV_CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "TOX_DEV_CORS_ALLOWED_ORIGINS",
        ",".join(_default_cors_origins),
    ).split(",")
    if origin.strip()
]

SESSION_COOKIE_SECURE = os.environ.get("TOX_SESSION_COOKIE_SECURE", "0") == "1"
CSRF_COOKIE_SECURE = os.environ.get("TOX_CSRF_COOKIE_SECURE", "0") == "1"
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "SAMEORIGIN"

LANGUAGE_CODE = "ar-iq"
TIME_ZONE = "Asia/Baghdad"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/assets/"
STATICFILES_DIRS = [BASE_DIR / "assets"]
# Where collectstatic will place files for production
STATIC_ROOT = Path(os.environ.get("TOX_STATIC_ROOT", str(BASE_DIR / "staticfiles")))
# Use WhiteNoise for static files in production
STATICFILES_STORAGE = os.environ.get("TOX_STATICFILES_STORAGE", "whitenoise.storage.CompressedStaticFilesStorage")
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(os.environ.get("TOX_MEDIA_ROOT", str(BASE_DIR / "media")))

# Production security settings (read from env)
SECURE_SSL_REDIRECT = os.environ.get("SECURE_SSL_REDIRECT", "0") == "1"
SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "0") == "1"
CSRF_COOKIE_SECURE = os.environ.get("CSRF_COOKIE_SECURE", "0") == "1"
SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "0"))
SECURE_HSTS_PRELOAD = os.environ.get("SECURE_HSTS_PRELOAD", "0") == "1"
SECURE_HSTS_INCLUDE_SUBDOMAINS = os.environ.get("SECURE_HSTS_INCLUDE_SUBDOMAINS", "0") == "1"

# X-Frame-Options (default DENY in production when not running in desktop mode)
X_FRAME_OPTIONS = os.environ.get("X_FRAME_OPTIONS", "DENY" if not DESKTOP_MODE else "SAMEORIGIN")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get("TOX_DATA_UPLOAD_MAX_MEMORY_SIZE", str(128 * 1024 * 1024)))
FILE_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get("TOX_FILE_UPLOAD_MAX_MEMORY_SIZE", str(128 * 1024 * 1024)))

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "toxerp-desktop-cache",
        "TIMEOUT": 300,
        "OPTIONS": {
            "MAX_ENTRIES": 2000,
        },
    }
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        },
    },
    "handlers": {
        "server_file": {
            "class": "logging.FileHandler",
            "filename": desktop_config.LOG_DIR / "django.log",
            "formatter": "standard",
            "encoding": "utf-8",
        },
        "error_file": {
            "class": "logging.FileHandler",
            "filename": desktop_config.LOG_DIR / "django-error.log",
            "formatter": "standard",
            "encoding": "utf-8",
            "level": "ERROR",
        },
        "backend_debug_file": {
            "class": "logging.FileHandler",
            "filename": desktop_config.LOG_DIR / "backend-debug.log",
            "formatter": "standard",
            "encoding": "utf-8",
            "level": "WARNING",
        },
    },
    "root": {
        "handlers": ["server_file", "error_file"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["server_file", "error_file"],
            "level": "INFO",
            "propagate": False,
        },
        "django.request": {
            "handlers": ["error_file"],
            "level": "ERROR",
            "propagate": False,
        },
        "tox.backend_debug": {
            "handlers": ["backend_debug_file"],
            "level": "WARNING",
            "propagate": False,
        },
    },
}
