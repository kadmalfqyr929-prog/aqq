#!/bin/sh
set -ex
# Entrypoint for production: run migrations, collect static, then start gunicorn
# Run from repository root (do not assume 'tox' subdirectory)

echo "Starting TOX ERP application..."

# Apply migrations (non-interactive). Fail if migrations error out so deployment stops and logs the error.
echo "Running database migrations..."
python manage.py migrate --noinput

# Collect static files with better error handling
echo "Collecting static files..."
python manage.py collectstatic --noinput --clear --verbosity 2

# Verify static files were collected
if [ ! -d "/app/staticfiles" ]; then
    echo "ERROR: Static files collection failed"
    exit 1
fi

echo "Static files collected successfully"

# Start gunicorn; PORT env var is provided by Railway
# Use a low default worker count to avoid OOM on small containers; allow override with GUNICORN_WORKERS env var
echo "Starting Gunicorn server on port ${PORT:-8080}..."
exec gunicorn \
    toxerp.wsgi:application \
    --bind 0.0.0.0:${PORT:-8080} \
    --workers ${GUNICORN_WORKERS:-1} \
    --worker-class sync \
    --threads 2 \
    --max-requests 1000 \
    --max-requests-jitter 100 \
    --timeout 30 \
    --graceful-timeout 30 \
    --log-level info \
    --access-logfile - \
    --error-logfile - \
    --capture-output
