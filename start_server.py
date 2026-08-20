import argparse
import os
import socket
from urllib.error import URLError
from urllib.request import urlopen
from pathlib import Path



ROOT = Path(__file__).resolve().parent
HEALTH_TIMEOUT_SECONDS = 2


def local_host(value):
    host = str(value or "").strip() or "127.0.0.1"
    return host if host in {"127.0.0.1", "localhost", "::1"} else "127.0.0.1"


def configure_environment(args):
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "toxerp.settings")
    args.host = local_host(args.host)
    os.environ["TOX_PORT"] = str(args.port)
    os.environ["TOX_HOST"] = args.host
    os.environ["TOX_BIND_HOST"] = args.host
    os.environ["TOX_LAN_ACCESS"] = "0"
    

def run_migrations():
    import django
    from django.core.management import call_command

    print("Checking database migrations...", flush=True)
    django.setup()
    call_command("migrate", interactive=False, verbosity=1)


def public_base_url(args):
    return f"http://{local_host(args.host)}:{args.port}"


def access_urls(args):
    local_url = f"http://127.0.0.1:{args.port}"
    return local_url, []


def print_access_urls(args, already_running=False):
    local_url, _lan_urls = access_urls(args)
    title = "TOX backend is already running" if already_running else "TOX backend URL"
    print(f"{title}:", flush=True)
    print(f"  Open: {local_url}/", flush=True)
    print(f"  API health: {local_url}/api/health/", flush=True)


def port_is_open(host, port):
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def tox_backend_is_healthy(base_url):
    try:
        with urlopen(f"{base_url}/api/health/", timeout=HEALTH_TIMEOUT_SECONDS) as response:
            return response.status == 200
    except (OSError, URLError):
        return False



def stop_if_server_already_running(args):
    base_url = public_base_url(args)
    if tox_backend_is_healthy(base_url):
        print_access_urls(args, already_running=True)
        return True
    if port_is_open(local_host(args.host), args.port):
        print(
            f"Port {args.port} is already in use, but TOX health check did not answer at {base_url}/api/health/.",
            flush=True,
        )
        print("Close the other process or choose another port with --port.", flush=True)
        raise SystemExit(2)
    return False


def run_server(args):
    from django.core.management import execute_from_command_line

    bind_host = local_host(args.host)
    addr = f"{bind_host}:{args.port}"
    command = [str(ROOT / "manage.py"), "runserver", addr, "--noreload"]
    print_access_urls(args)
    execute_from_command_line(command)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Start the TOX Lite local Django backend.")
    parser.add_argument("--host", default=os.environ.get("TOX_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("TOX_PORT", "8765")))
    parser.add_argument("--lan", dest="lan", action="store_true", default=False, help="Compatibility option; TOX now starts with the local computer URL only.")
    parser.add_argument("--local-only", dest="lan", action="store_false", help="Bind only to this computer.")
    parser.add_argument("--no-migrate", action="store_true", help="Skip automatic migrations.")
    parser.add_argument("--no-wait", action="store_true", help="Compatibility flag used by the desktop launcher.")
    args = parser.parse_args(argv)
    args.lan = False

    os.chdir(ROOT)
    configure_environment(args)
    if stop_if_server_already_running(args):
        return 0
    if not args.no_migrate:
        run_migrations()
    run_server(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

