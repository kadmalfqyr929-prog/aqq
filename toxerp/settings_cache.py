"""
Django cache configuration for static files and API responses
Add this to your main settings.py
"""

# Cache configuration
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'unique-snowflake',
        'TIMEOUT': 3600,
    },
    'static': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'static-files-cache',
        'TIMEOUT': 86400 * 30,  # 30 days for static files
    }
}

# Static files configuration for better caching
STATIC_URL = '/assets/'
STATIC_ROOT = '/app/staticfiles'

# Whitenoise configuration for efficient static file serving
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',  # Add this
    # ... rest of middleware
]

# WhiteNoise configuration
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# Response headers for static files
STATIC_HEADERS = {
    'Cache-Control': 'public, immutable, max-age=31536000',
}
