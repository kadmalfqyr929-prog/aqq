"""
Gunicorn configuration for production deployment
Optimized for static file serving and caching
"""

# Worker settings
workers = 1  # Can be increased based on container resources
worker_class = "sync"
worker_connections = 1000
keepalive = 2

# Binding
bind = ["0.0.0.0:8080"]

# Timeout
timeout = 30
graceful_timeout = 30

# Logging
loglevel = "info"  # Changed from debug to reduce log spam
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'
errorlog = "-"
accesslog = "-"
capture_output = True

# Request handling
limit_request_line = 4094
limit_request_fields = 100
limit_request_field_size = 8190

# Performance
preload_app = False
max_requests = 1000
max_requests_jitter = 100
