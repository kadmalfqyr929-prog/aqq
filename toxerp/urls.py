from django.contrib import admin
from django.urls import path
from . import views

urlpatterns = [
    path('api/health/', views.api_health, name='api-health'),
    path('', views.index, name='index'),
    path('admin/', admin.site.urls),
]
