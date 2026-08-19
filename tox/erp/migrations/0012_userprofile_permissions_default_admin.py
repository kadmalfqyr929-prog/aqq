import os

from django.conf import settings
from django.db import migrations, models


def create_default_admin(apps, schema_editor):
    if os.environ.get("TOX_ALLOW_DEFAULT_ADMIN", "0") != "1":
        return
    default_username = os.environ.get("TOX_DEFAULT_ADMIN_USERNAME", "")
    default_password = os.environ.get("TOX_DEFAULT_ADMIN_PASSWORD", "")
    if not default_username or not default_password:
        return
    User = apps.get_model("auth", "User")
    UserProfile = apps.get_model("erp", "UserProfile")
    if User.objects.filter(username=default_username).exists():
        user = User.objects.get(username=default_username)
    elif User.objects.exists():
        return
    else:
        user = User.objects.create_user(
            username=default_username,
            password=default_password,
            is_staff=True,
            is_superuser=True,
        )
    UserProfile.objects.update_or_create(user=user, defaults={"role": "admin", "permissions": {}})


class Migration(migrations.Migration):
    dependencies = [
        ("erp", "0011_clientpayment_applied_to_invoice_installment_plan"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="permissions",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(create_default_admin, migrations.RunPython.noop),
    ]
