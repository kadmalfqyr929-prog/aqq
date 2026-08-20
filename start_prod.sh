#!/bin/sh
set -e
# Entrypoint for production: run migrations, collect static, then start gunicorn
# Run from repository root (do not assume 'tox' subdirectory)

# Apply migrations (non-interactive). Fail if migrations error out so deployment stops and logs the error.
python manage.py migrate --noinput

# Collect static files
python manage.py collectstatic --noinput

# Start gunicorn; PORT env var is provided by Railway
exec gunicorn toxerp.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers ${GUNICORN_WORKERS:-4}
