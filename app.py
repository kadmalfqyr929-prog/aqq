#!/usr/bin/env python
"""
Django WSGI application for production deployment.
Used by gunicorn and other WSGI servers.
"""
import os
import sys
from pathlib import Path

# Add the project root to the Python path
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

# Set Django settings module
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "toxerp.settings")

# Configure environment for Railway and production
os.environ.setdefault("TOX_HOST", "0.0.0.0")
os.environ.setdefault("TOX_PORT", os.environ.get("PORT", "8000"))
os.environ.setdefault("TOX_DEBUG", "0")

from django.core.wsgi import get_wsgi_application

application = get_wsgi_application()
