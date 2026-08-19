from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path, re_path
from django.views.static import serve

from erp.views import favicon, frontend_page


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("erp.urls")),
    path("favicon.ico", favicon, name="favicon"),
    path("", frontend_page, {"page": "index.html"}, name="home"),
    path("index.html", frontend_page, {"page": "index.html"}, name="frontend-home"),
    re_path(r"^pages/(?P<page>[-\w]+\.html)$", frontend_page, name="frontend-page"),
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.BASE_DIR / "assets")
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
elif getattr(settings, "DESKTOP_MODE", False):
    urlpatterns += [
        re_path(r"^assets/(?P<path>.*)$", serve, {"document_root": settings.BASE_DIR / "assets"}),
        re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
    ]
