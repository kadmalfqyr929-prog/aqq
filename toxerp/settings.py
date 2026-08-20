import os
from pathlib import Path

# Base directory (project root)
BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("TOX_SECRET_KEY", os.environ.get("SECRET_KEY", "django-insecure-temporary-change-me"))
DEBUG = os.environ.get("TOX_DEBUG", "0") in ("1", "True", "true", "TRUE")

ALLOWED_HOSTS = os.environ.get("TOX_ALLOWED_HOSTS", os.environ.get("ALLOWED_HOSTS", "*")).split(",") if os.environ.get("TOX_ALLOWED_HOSTS") else ["*"]

# Application definition
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "toxerp.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [str(BASE_DIR / "templates")],
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

# Database: default to sqlite (use DATABASE_URL or TOX_DB_PATH in env to override)
DATABASE_PATH = os.environ.get("TOX_DB_PATH")
if DATABASE_PATH:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": DATABASE_PATH}}
else:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": str(BASE_DIR / "db.sqlite3")}}

# Internationalization
LANGUAGE_CODE = os.environ.get("TOX_LANGUAGE_CODE", "ar")
TIME_ZONE = os.environ.get("TOX_TIME_ZONE", "Asia/Baghdad")
USE_I18N = True
USE_L10N = True
USE_TZ = True

# Static files
STATIC_URL = "/static/"
STATIC_ROOT = os.environ.get("TOX_STATIC_ROOT", str(BASE_DIR / "staticfiles"))

# Minimal defaults for deployment
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
