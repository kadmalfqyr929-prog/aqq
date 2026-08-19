import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENDPOINTS = [
    "/api/health/",
    "/api/analytics/dashboard/",
    "/api/analytics/dashboard-summary/",
    "/api/analytics/kpis/",
    "/api/analytics/stock-alerts/",
    "/api/analytics/reports/",
]
EXPECTED_BINDINGS = {
    "dashboard_kpis": "[data-dashboard-kpi-grid]",
    "dashboard_shortcuts": "[data-dashboard-shortcut-grid]",
    "dashboard_today": "[data-dashboard-today-grid]",
    "dashboard_sales_chart": "[data-dashboard-sales-chart]",
    "dashboard_attention": "[data-dashboard-attention-list]",
    "dashboard_recent": "[data-dashboard-recent-invoices]",
}


def request_json(base_url, path, *, method="GET", token="", payload=None, headers=None, timeout=8):
    data = None
    request_headers = {"Accept": "application/json", **(headers or {})}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    request = Request(f"{base_url.rstrip('/')}{path}", data=data, method=method, headers=request_headers)
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return {
                "ok": 200 <= response.status < 300,
                "status": response.status,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
                "headers": dict(response.headers),
                "json": json.loads(raw) if raw else {},
            }
    except HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        return {
            "ok": False,
            "status": error.code,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "headers": dict(error.headers),
            "json": json.loads(raw) if raw.strip().startswith("{") else {"detail": raw[:240]},
        }
    except URLError as error:
        return {
            "ok": False,
            "status": 0,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "headers": {},
            "json": {"reason": "NETWORK_ERROR", "detail": str(error.reason)},
        }


def login(base_url, username, password, account_type):
    result = request_json(
        base_url,
        "/api/auth/login/",
        method="POST",
        payload={"username": username, "password": password, "accountType": account_type},
    )
    return result, result.get("json", {}).get("accessToken") or ""


def check_cors(base_url):
    request = Request(
        f"{base_url.rstrip('/')}/api/analytics/dashboard/",
        method="OPTIONS",
        headers={
            "Origin": "http://127.0.0.1:5500",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization, Content-Type",
        },
    )
    try:
        with urlopen(request, timeout=8) as response:
            headers = dict(response.headers)
            return {
                "status": response.status,
                "allow_origin": headers.get("Access-Control-Allow-Origin", ""),
                "allow_headers": headers.get("Access-Control-Allow-Headers", ""),
            }
    except HTTPError as error:
        headers = dict(error.headers)
        return {
            "status": error.code,
            "allow_origin": headers.get("Access-Control-Allow-Origin", ""),
            "allow_headers": headers.get("Access-Control-Allow-Headers", ""),
            "error": error.reason,
        }
    except Exception as error:
        return {"status": 0, "error": str(error)}


def check_frontend_bindings():
    html = (ROOT / "index.html").read_text(encoding="utf-8", errors="ignore")
    js = (ROOT / "assets" / "js" / "dashboard.js").read_text(encoding="utf-8", errors="ignore")
    def selector_present(selector, source):
        if selector.startswith("#"):
            return selector[1:] in source
        if selector.startswith("[") and selector.endswith("]"):
            return selector.strip("[]").split("=", 1)[0] in source
        return selector in source

    return {
        key: {
            "selector": selector,
            "html": selector_present(selector, html),
            "javascript": selector_present(selector, js),
        }
        for key, selector in EXPECTED_BINDINGS.items()
    }


def main():
    parser = argparse.ArgumentParser(description="Diagnose TOX ERP API/JWT/CORS/frontend bindings.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8765")
    parser.add_argument("--username", default=os.environ.get("TOX_DIAG_USERNAME", ""))
    parser.add_argument("--password", default=os.environ.get("TOX_DIAG_PASSWORD", ""))
    parser.add_argument("--account-type", default="admin")
    args = parser.parse_args()

    if not args.username or not args.password:
        print("missing credentials: pass --username and --password or set TOX_DIAG_USERNAME/TOX_DIAG_PASSWORD")
        return 2

    login_result, token = login(args.base_url, args.username, args.password, args.account_type)
    print(f"login status={login_result['status']} token={'yes' if token else 'no'} elapsed_ms={login_result['elapsed_ms']}")

    invalid = request_json(args.base_url, "/api/analytics/dashboard/", token="invalid-token")
    print(f"invalid_jwt dashboard status={invalid['status']}")

    for path in DEFAULT_ENDPOINTS:
        result = request_json(args.base_url, path, token=token if path.startswith("/api/analytics/") else "")
        print(f"{path} status={result['status']} ok={result['ok']} elapsed_ms={result['elapsed_ms']}")
        if result["elapsed_ms"] > 200 and path.startswith("/api/analytics/"):
            print(f"  warning: analytics response exceeded 200ms target")

    cors = check_cors(args.base_url)
    print(f"cors status={cors.get('status')} allow_origin={cors.get('allow_origin', '')} allow_headers={cors.get('allow_headers', '')}")

    bindings = check_frontend_bindings()
    for key, result in bindings.items():
        status = "ok" if (result["html"] or result["javascript"]) else "missing"
        print(f"binding {key} -> {result['selector']} {status}")

    return 0 if token else 1


if __name__ == "__main__":
    sys.exit(main())
