import logging
import time
from urllib.parse import urlparse

from django.conf import settings
from django.http import HttpResponseForbidden, JsonResponse

import desktop_config
from .serializers import InvalidJsonBody


backend_debug_logger = logging.getLogger("tox.backend_debug")
CODE_FINGERPRINT = desktop_config.source_fingerprint()


class LocalOnlyMiddleware:
    """Keep the desktop backend reachable from the current machine only."""

    LOOPBACKS = {"127.0.0.1", "::1", "localhost", "testserver"}
    PROTECTED_SUFFIXES = (".sqlite", ".sqlite3", ".db", ".env", ".log")

    def __init__(self, get_response):
        self.get_response = get_response

    def _allowed_desktop_address(self, value):
        host = str(value or "").strip().lower().strip("[]")
        return host in self.LOOPBACKS

    def __call__(self, request):
        if getattr(settings, "DESKTOP_MODE", False):
            host = request.get_host().split(":")[0].lower()
            remote_addr = (request.META.get("REMOTE_ADDR") or "").lower()
            
            # Allow the request if both host and remote_addr pass the check (if remote_addr is present)
            if remote_addr:
                host_allowed = self._allowed_desktop_address(host)
                remote_allowed = self._allowed_desktop_address(remote_addr)
                if not (host_allowed and remote_allowed):
                    return HttpResponseForbidden("Local desktop access only.")
            else:
                # If no REMOTE_ADDR, just check the host
                if not self._allowed_desktop_address(host):
                    return HttpResponseForbidden("Local desktop access only.")
                    
            if request.path.lower().endswith(self.PROTECTED_SUFFIXES):
                return HttpResponseForbidden("Protected local file.")
        return self.get_response(request)


class DevCorsMiddleware:
    """Allow the existing Live Server frontend to talk to Django during development."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.headers.get("Origin")
        allowed_origin = origin in getattr(settings, "DEV_CORS_ALLOWED_ORIGINS", [])
        same_origin = False
        if origin:
            parsed = urlparse(origin)
            same_origin = parsed.netloc.lower() == request.get_host().lower()
        
        # For /api/ endpoints: allow configured dev origins and same-origin desktop requests.
        if request.path.startswith("/api/") and origin and not (allowed_origin or same_origin):
            return HttpResponseForbidden("Origin is not allowed.")
        
        # Handle OPTIONS requests
        if allowed_origin and request.method == "OPTIONS":
            response = JsonResponse({"ok": True})
        else:
            response = self.get_response(request)
        
        # Return CORS headers for both allowed origins and same-origin requests
        if allowed_origin or (same_origin and origin and request.path.startswith("/api/")):
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
            response["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Requested-With"
            response["Access-Control-Allow-Credentials"] = "true"
        
        return response


class BackendDebugLoggingMiddleware:
    """Categorize notable backend responses in a dedicated debug log."""

    WATCHED_STATUS_CODES = {403, 404, 500}

    def __init__(self, get_response):
        self.get_response = get_response

    def process_exception(self, request, exception):
        if isinstance(exception, InvalidJsonBody):
            return JsonResponse({"ok": False, "reason": "INVALID_JSON"}, status=400)
        return None

    def __call__(self, request):
        started = time.perf_counter()
        try:
            response = self.get_response(request)
        except InvalidJsonBody:
            return JsonResponse({"ok": False, "reason": "INVALID_JSON"}, status=400)
        except Exception:
            backend_debug_logger.exception(
                "500 exception path=%s method=%s user=%s",
                request.path,
                request.method,
                getattr(getattr(request, "user", None), "username", "anonymous"),
            )
            raise
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        if response.status_code in self.WATCHED_STATUS_CODES:
            backend_debug_logger.warning(
                "%s response path=%s method=%s user=%s elapsed_ms=%s",
                response.status_code,
                request.path,
                request.method,
                getattr(getattr(request, "user", None), "username", "anonymous"),
                elapsed_ms,
            )
        return response


class DesktopHeadersMiddleware:
    """Small local-only hardening and caching hints for the Electron shell."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault("X-Content-Type-Options", "nosniff")
        response.setdefault("X-Frame-Options", "SAMEORIGIN")
        content_type = response.get("Content-Type", "")
        if content_type.startswith("text/html"):
            response["Content-Type"] = "text/html; charset=utf-8"
            response["Cache-Control"] = "no-cache, max-age=0, must-revalidate"
            response["Pragma"] = "no-cache"
            response["Expires"] = "0"
            response["X-TOX-Code-Fingerprint"] = CODE_FINGERPRINT
        if getattr(settings, "DESKTOP_MODE", False):
            response.setdefault("X-Desktop-App", "TOX ERP")
            if request.path.startswith(settings.STATIC_URL):
                response["Cache-Control"] = "no-cache, max-age=0, must-revalidate"
                response["Pragma"] = "no-cache"
                response["Expires"] = "0"
                response["X-TOX-Code-Fingerprint"] = CODE_FINGERPRINT
            elif request.path.startswith("/api/"):
                response.setdefault("Cache-Control", "no-store")
        return response
