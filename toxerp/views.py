from django.http import HttpResponse, Http404, JsonResponse
from django.conf import settings
from pathlib import Path


def index(request):
    index_path = Path(settings.BASE_DIR) / "index.html"
    if not index_path.exists():
        raise Http404("index.html not found")
    return HttpResponse(index_path.read_text(encoding="utf-8"), content_type="text/html")


def api_health(request):
    # Lightweight health endpoint used by hosts (Railway) to check service liveness
    return JsonResponse({"ok": True})
