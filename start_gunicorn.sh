#!/usr/bin/env bash
set -euo pipefail

# Start script for Railway/Heroku-like platforms.
# - Run migrations
# - Collect static files (best-effort)
# - Ensure STATIC_ROOT exists
# - Start gunicorn with logs to stdout/stderr

echo "[start_gunicorn] running migrations..." >&2
python manage.py migrate --noinput

echo "[start_gunicorn] collecting static files (if configured)..." >&2
python manage.py collectstatic --noinput || true

# Ensure STATIC_ROOT directory exists (create if missing) to avoid warnings from middleware
mkdir -p staticfiles || true

# Require PORT to be set by the environment (Railway provides this). Fail fast if missing.
: ${PORT:?PORT environment variable must be set by Railway}

echo "[start_gunicorn] PORT='${PORT}'" >&2
echo "[start_gunicorn] starting gunicorn on 0.0.0.0:${PORT}..." >&2

exec gunicorn toxerp.wsgi:application \
  --bind 0.0.0.0:${PORT} \
  --workers 2 \
  --log-level info \
  --access-logfile - \
  --error-logfile -
