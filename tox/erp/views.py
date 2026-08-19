from django.conf import settings
from django.http import FileResponse, Http404


def frontend_page(request, page):
    target = settings.BASE_DIR / page if page == "index.html" else settings.BASE_DIR / "pages" / page
    if not target.exists() or target.suffix != ".html":
        raise Http404("Page not found")
    return FileResponse(target.open("rb"), content_type="text/html; charset=utf-8")


def favicon(request):
    target = settings.BASE_DIR / "assets" / "img" / "tox-sales-mark.svg"
    if not target.exists():
        raise Http404("Favicon not found")
    return FileResponse(target.open("rb"), content_type="image/svg+xml")
