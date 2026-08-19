import argparse
import json
import re
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "db.sqlite3"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

QUICK_JS_FILES = [
    "assets/js/api-client.js",
    "assets/js/state.js",
    "assets/js/dashboard.js",
    "assets/js/settings.js",
]

FULL_JS_FILES = [
    "assets/js/api-client.js",
    "assets/js/state.js",
    "assets/js/ui.js",
    "assets/js/sales.js",
    "assets/js/purchases.js",
    "assets/js/invoice-ledger.js",
    "assets/js/products.js",
    "assets/js/warehouse.js",
    "assets/js/clients.js",
    "assets/js/suppliers.js",
    "assets/js/installments.js",
    "assets/js/reports.js",
    "assets/js/settings.js",
    "assets/js/employees.js",
    "assets/js/dashboard.js",
    "assets/js/backup.js",
    "assets/js/product-alerts.js",
    "assets/js/finance.js",
    "assets/js/labels.js",
]

RISKY_OPTION_TEMPLATE_FILES = [
    "assets/js/sales.js",
    "assets/js/purchases.js",
    "assets/js/installments.js",
    "assets/js/warehouse.js",
    "assets/js/labels.js",
    "assets/js/product-alerts.js",
    "assets/js/invoice-ledger.js",
]

SAFE_TEMPLATE_MARKERS = (
    "Escape(",
    "escapeHtml(",
    "escapeWarehouseHtml(",
    "invoiceEscape(",
    "saleEscape(",
    "purchaseEscape(",
    "alertEscape(",
    "labelEscape(",
    "escH(",
    "esc(",
)


def run_step(name, command, timeout=180, cwd=ROOT):
    started = datetime.now()
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            text=True,
            capture_output=True,
            timeout=timeout,
            shell=False,
        )
        output = (result.stdout or "") + (result.stderr or "")
        code = result.returncode
    except subprocess.TimeoutExpired as error:
        output = (error.stdout or "") + (error.stderr or "") + f"\nTimed out after {timeout}s"
        code = 124
    elapsed = round((datetime.now() - started).total_seconds(), 2)
    return {
        "name": name,
        "command": " ".join(str(part) for part in command),
        "ok": code == 0,
        "code": code,
        "elapsed": elapsed,
        "output": output.strip()[-4000:],
    }


def js_steps(files):
    steps = []
    for file_path in files:
        if (ROOT / file_path).exists():
            steps.append(run_step(f"JavaScript syntax {file_path}", ["node", "--check", file_path], timeout=60))
    return steps


def desktop_dependency_checks():
    package_json = ROOT / "desktop-app" / "package.json"
    electron_package = ROOT / "desktop-app" / "node_modules" / "electron" / "package.json"
    builder_package = ROOT / "desktop-app" / "node_modules" / "electron-builder" / "package.json"
    checks = [
        {"name": "Desktop package.json exists", "ok": package_json.exists(), "detail": str(package_json.relative_to(ROOT))},
        {"name": "Desktop electron dependency installed", "ok": electron_package.exists(), "detail": str(electron_package.relative_to(ROOT))},
        {"name": "Desktop electron-builder dependency installed", "ok": builder_package.exists(), "detail": str(builder_package.relative_to(ROOT))},
    ]
    if package_json.exists():
        checks.append(run_step("Desktop npm dependency tree", ["npm.cmd", "ls", "--depth=0"], timeout=120, cwd=ROOT / "desktop-app"))
    return checks


def frontend_static_security_checks():
    risky_lines = []
    for relative in RISKY_OPTION_TEMPLATE_FILES:
        path = ROOT / relative
        if not path.exists():
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
            if "<option" not in line or "${" not in line:
                continue
            if 'value="${' not in line and ">${" not in line:
                continue
            if any(marker in line for marker in SAFE_TEMPLATE_MARKERS):
                continue
            risky_lines.append(f"{relative}:{number}")
    state_js = (ROOT / "assets/js/state.js").read_text(encoding="utf-8", errors="replace")
    dashboard_js = (ROOT / "assets/js/dashboard.js").read_text(encoding="utf-8", errors="replace")
    api_client_js = (ROOT / "assets/js/api-client.js").read_text(encoding="utf-8", errors="replace")
    return [
        {
            "name": "Frontend dynamic option templates escaped",
            "ok": not risky_lines,
            "detail": json.dumps(risky_lines[:12], ensure_ascii=False),
        },
        {
            "name": "Frontend state hydration waits for verified session",
            "ok": "isSessionVerified" in state_js and "backendHydrationBlockReason" in state_js,
            "detail": "assets/js/state.js",
        },
        {
            "name": "Dashboard API waits for verified session",
            "ok": "isSessionVerified" in dashboard_js and "/analytics/dashboard/" in dashboard_js,
            "detail": "assets/js/dashboard.js",
        },
        {
            "name": "API client sends bearer token automatically",
            "ok": "const headers = authHeaders({" in api_client_js,
            "detail": "assets/js/api-client.js",
        },
        {
            "name": "Frontend does not expire sessions on permission-only 403",
            "ok": "return Number(status) === 401;" in state_js and "[401, 403].includes" not in dashboard_js,
            "detail": "assets/js/state.js, assets/js/dashboard.js",
        },
    ]


def dashboard_design_checks():
    index_html = (ROOT / "index.html").read_text(encoding="utf-8", errors="replace")
    dashboard_js = (ROOT / "assets/js/dashboard.js").read_text(encoding="utf-8", errors="replace")
    dashboard_css = (ROOT / "assets/css/dashboard-2026.css").read_text(encoding="utf-8", errors="replace")
    shortcut_match = re.search(r"const\s+shortcuts\s*=\s*\[(.*?)\];", dashboard_js, re.S)
    shortcut_labels = re.findall(r'label:\s*"([^"]+)"', shortcut_match.group(1) if shortcut_match else "")
    required_labels = [
        "فاتورة بيع",
        "فاتورة شراء",
        "إضافة منتج",
        "العملاء",
        "الموردون",
        "المستودعات",
        "الموظفون",
        "التقارير",
        "إعدادات النظام",
    ]
    return [
        {
            "name": "Dashboard enterprise shell active",
            "ok": "tox-enterprise-dashboard" in index_html and "20260605-dashboard-enterprise" in index_html,
            "detail": "index.html",
        },
        {
            "name": "Dashboard quick actions are 3x3 set",
            "ok": shortcut_labels == required_labels,
            "detail": json.dumps(shortcut_labels, ensure_ascii=False),
        },
        {
            "name": "Dashboard recent invoices are wide rows",
            "ok": "tox-dashboard-recent-head" in dashboard_js and "tox-dashboard-recent-head" in dashboard_css,
            "detail": "assets/js/dashboard.js, assets/css/dashboard-2026.css",
        },
        {
            "name": "Dashboard activity panel is wired",
            "ok": "data-dashboard-activity-list" in index_html and "renderActivity" in dashboard_js,
            "detail": "index.html, assets/js/dashboard.js",
        },
    ]


def server_startup_checks():
    start_server = (ROOT / "start_server.py").read_text(encoding="utf-8", errors="replace")
    desktop_config = (ROOT / "desktop_config.py").read_text(encoding="utf-8", errors="replace")
    settings_py = (ROOT / "toxerp/settings.py").read_text(encoding="utf-8", errors="replace")
    middleware_py = (ROOT / "erp" / "middleware.py").read_text(encoding="utf-8", errors="replace")
    old_network_label = "Phone on same " + "Wi-Fi"
    return [
        {
            "name": "Server startup prints only local computer URLs",
            "ok": old_network_label not in start_server and "return local_url, []" in start_server,
            "detail": "start_server.py",
        },
        {
            "name": "Server startup forces local-only mode",
            "ok": 'os.environ["TOX_LAN_ACCESS"] = "0"' in start_server and "args.lan = False" in start_server,
            "detail": "start_server.py",
        },
        {
            "name": "Desktop config reports no LAN hosts",
            "ok": "LAN_ACCESS = False" in desktop_config and "def lan_hosts" in desktop_config and "return []" in desktop_config,
            "detail": "desktop_config.py",
        },
        {
            "name": "Desktop middleware allows loopback only",
            "ok": "return host in self.LOOPBACKS" in middleware_py and "_private_lan_address" not in middleware_py,
            "detail": "erp/middleware.py",
        },
    ]


def sqlite_checks():
    if not DB_PATH.exists():
        return [{"name": "SQLite file exists", "ok": False, "detail": str(DB_PATH)}]
    checks = []
    try:
        with sqlite3.connect(DB_PATH) as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
            journal_mode = connection.execute("PRAGMA journal_mode").fetchone()[0]
            product_without_units = connection.execute(
                """
                SELECT COUNT(*)
                FROM erp_product p
                WHERE p.deleted_at IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM erp_productunit u
                    WHERE u.product_id = p.id AND u.deleted_at IS NULL
                  )
                """
            ).fetchone()[0]
            orphan_invoice_units = connection.execute(
                """
                SELECT COUNT(*)
                FROM erp_invoiceitem i
                WHERE i.product_id IS NOT NULL
                  AND i.unit_id <> ''
                  AND NOT EXISTS (
                    SELECT 1 FROM erp_productunit u
                    WHERE u.product_id = i.product_id AND u.external_id = i.unit_id
                  )
                """
            ).fetchone()[0]
        checks.extend([
            {"name": "SQLite integrity_check", "ok": integrity == "ok", "detail": str(integrity)},
            {"name": "SQLite foreign_key_check", "ok": not foreign_keys, "detail": json.dumps(foreign_keys[:10])},
            {"name": "SQLite WAL enabled", "ok": journal_mode.lower() == "wal", "detail": journal_mode},
            {"name": "Active products have units", "ok": product_without_units == 0, "detail": str(product_without_units)},
            {"name": "Invoice item units resolve", "ok": orphan_invoice_units == 0, "detail": str(orphan_invoice_units)},
        ])
    except sqlite3.Error as error:
        checks.append({"name": "SQLite checks", "ok": False, "detail": str(error)})
    return checks


def arabic_encoding_checks():
    try:
        from repair_arabic_encoding import REPORT_PATH, iter_targets, normalize_file
    except Exception as error:
        return [{"name": "Arabic encoding checker import", "ok": False, "detail": str(error)}]

    entries = []
    for path in iter_targets():
        result = normalize_file(path, bump_assets=False)
        if result["changed"] or result["beforeSuspicious"] or result["afterSuspicious"] or result.get("mojibakeResidue"):
            entries.append({key: value for key, value in result.items() if key != "text"})

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "mode": "safety-gate",
        "changedFiles": sum(1 for entry in entries if entry["changed"]),
        "bomFiles": sum(1 for entry in entries if entry["hadBom"]),
        "suspiciousFiles": sum(1 for entry in entries if entry["afterSuspicious"] or entry.get("mojibakeResidue")),
        "entries": entries,
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    pending = [entry["path"] for entry in entries if entry["changed"] or entry["afterSuspicious"] or entry.get("mojibakeResidue")]
    return [
        {
            "name": "Arabic source encoding clean",
            "ok": not pending,
            "detail": json.dumps(pending[:12], ensure_ascii=False),
        },
        {
            "name": "Arabic encoding report written",
            "ok": REPORT_PATH.exists(),
            "detail": str(REPORT_PATH.relative_to(ROOT)),
        },
    ]


def build_results(mode):
    results = [
        run_step("Django system check", [sys.executable, "manage.py", "check"], timeout=120),
        run_step("Database maintenance dry run", [sys.executable, "manage.py", "maintain_db", "--dry-run"], timeout=120),
        run_step("Backup pruning dry run", [sys.executable, "manage.py", "prune_backups", "--dry-run"], timeout=120),
    ]
    if mode == "full":
        results.extend([
            run_step("Django ERP tests", [sys.executable, "manage.py", "test", "erp.tests"], timeout=300),
            run_step("Django migrations check", [sys.executable, "manage.py", "migrate", "--check"], timeout=120),
        ])
        results.extend(js_steps(FULL_JS_FILES))
        results.extend(frontend_static_security_checks())
        results.extend(dashboard_design_checks())
        results.extend(server_startup_checks())
        results.extend(desktop_dependency_checks())
        results.extend(arabic_encoding_checks())
        results.extend(sqlite_checks())
    else:
        results.extend(js_steps(QUICK_JS_FILES))
    return results


def print_text_report(payload):
    status = "PASS" if payload["ok"] else "BLOCKED"
    print(f"TOX Safety Gate {status}")
    print(f"mode: {payload['mode']}")
    print(f"generatedAt: {payload['generatedAt']}")
    for item in payload["results"]:
        marker = "PASS" if item.get("ok") else "FAIL"
        detail = item.get("detail") or item.get("command") or ""
        elapsed = item.get("elapsed")
        suffix = f" ({elapsed}s)" if elapsed is not None else ""
        print(f"- {marker}: {item['name']}{suffix} {detail}".rstrip())
        if not item.get("ok") and item.get("output"):
            print(item["output"])


def main():
    parser = argparse.ArgumentParser(description="Run non-mutating TOX ERP safety checks.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--quick", action="store_true", help="Run fast daily checks. This is the default.")
    mode.add_argument("--full", action="store_true", help="Run full pre-release and protected-change checks.")
    parser.add_argument("--json", action="store_true", help="Print JSON only.")
    args = parser.parse_args()

    selected_mode = "full" if args.full else "quick"
    results = build_results(selected_mode)
    payload = {
        "ok": all(item.get("ok") for item in results),
        "mode": selected_mode,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "results": results,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_text_report(payload)
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
