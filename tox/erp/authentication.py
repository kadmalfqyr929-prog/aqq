import base64
import hashlib
import hmac
import json
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import exceptions
from rest_framework.authentication import BaseAuthentication, get_authorization_header


def _b64_encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64_decode(value):
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))


def _sign(message):
    return _b64_encode(hmac.new(settings.SECRET_KEY.encode("utf-8"), message.encode("ascii"), hashlib.sha256).digest())


def create_access_token(user, lifetime=None):
    lifetime = lifetime or timedelta(hours=12)
    now = timezone.now()
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(user.pk),
        "username": user.get_username(),
        "iat": int(now.timestamp()),
        "exp": int((now + lifetime).timestamp()),
    }
    encoded_header = _b64_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    encoded_payload = _b64_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    message = f"{encoded_header}.{encoded_payload}"
    return f"{message}.{_sign(message)}"


class ToxJWTAuthentication(BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        auth = get_authorization_header(request).decode("ascii")
        if not auth:
            return None
        parts = auth.split()
        if len(parts) != 2 or parts[0] != self.keyword:
            return None
        token = parts[1]
        try:
            encoded_header, encoded_payload, signature = token.split(".")
        except ValueError as error:
            raise exceptions.AuthenticationFailed("Invalid analytics token") from error
        message = f"{encoded_header}.{encoded_payload}"
        if not hmac.compare_digest(signature, _sign(message)):
            raise exceptions.AuthenticationFailed("Invalid analytics token signature")
        try:
            payload = json.loads(_b64_decode(encoded_payload).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as error:
            raise exceptions.AuthenticationFailed("Invalid analytics token payload") from error
        if int(payload.get("exp") or 0) < int(timezone.now().timestamp()):
            raise exceptions.AuthenticationFailed("Analytics token expired")
        user = User.objects.filter(pk=payload.get("sub"), is_active=True).first()
        if not user:
            raise exceptions.AuthenticationFailed("Analytics token user not found")
        return user, token
