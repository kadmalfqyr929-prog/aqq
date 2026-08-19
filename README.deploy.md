Deployment guide — TOX ERP (Django)

This file explains how to deploy the project to Railway (or similar container-based hosts).

Prerequisites
- A GitHub repository with your code pushed (branch: main).
- Railway service (or any provider that exposes PORT env and lets you set environment variables).

Key files
- Procfile: web: ./start_prod.sh
- start_prod.sh: runs migrations, collectstatic, then launches gunicorn
- tox/requirements.txt: dependencies (Django, djangorestframework, gunicorn, whitenoise, psycopg2-binary)

Recommended approach (Railway)
1) Connect the GitHub repo to Railway and let it build.
   - Build command: pip install -r tox/requirements.txt
   - Railway will detect Procfile and run web: ./start_prod.sh

2) Configure Environment Variables in Railway (Settings → Environment):
   - TOX_SECRET_KEY: (required) set a strong secret
   - TOX_DEBUG=0
   - TOX_DESKTOP_MODE=0
   - TOX_ALLOWED_HOSTS: yourrailwaydomain.up.railway.app (or comma-separated list)
   - TOX_CSRF_TRUSTED_ORIGINS: https://yourrailwaydomain.up.railway.app
   - DATABASE_URL: postgres://user:pass@host:port/dbname  (recommended for production)
     OR if using SQLite persistently:
       - Create a Volume and set TOX_DB_PATH=/data/db.sqlite3
   - TOX_STATIC_ROOT: optional (defaults to tox/staticfiles) or /data/staticfiles if you have a volume
   - (Security) SECURE_SSL_REDIRECT=1, SESSION_COOKIE_SECURE=1, CSRF_COOKIE_SECURE=1, SECURE_HSTS_SECONDS=31536000, SECURE_HSTS_PRELOAD=1, SECURE_HSTS_INCLUDE_SUBDOMAINS=1
   - GUNICORN_WORKERS: optional (default 4)

3) Health check
   - Use: /api/health/ (expects HTTP 200)

4) Persistent storage (media / database)
   - Media uploads and SQLite require a persistent volume. Prefer using a managed database (Postgres) and object storage (S3) for media.

5) After deploy
   - Check Railway logs for migrate & collectstatic output; watch for psycopg2 or DB connection errors.
   - Verify: https://<your-domain>/api/health/ returns ok:true
   - Test basic API endpoints and frontend.

Local testing before deploy
- Install dependencies: python -m pip install -r tox/requirements.txt
- Migrate: cd tox && python manage.py migrate
- Collect static: python manage.py collectstatic --noinput
- Run locally (dev): python manage.py runserver 127.0.0.1:8765
- Run production-mode locally (requires gunicorn & whitenoise): PORT=8080 ./start_prod.sh

Notes & troubleshooting
- If using Postgres, ensure DATABASE_URL credentials are correct and database is reachable.
- If collectstatic fails, inspect settings.STATIC_ROOT path and ensure write permissions.
- If DB migrations fail on Railway, run a one-off job: python tox/manage.py migrate
- Do not commit secrets. Use Railway's Environment/Secrets UI.

If you want, I can:
- Provide the exact Railway UI steps per-screen, or
- Attempt to push the local commits to GitHub (requires your PAT or SSH setup), or
- Add code to store media on S3 and configure Django storages.
