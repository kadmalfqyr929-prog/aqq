import argparse
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "db.sqlite3"
REPORT_PATH = ROOT / "release-readiness.md"
JS_FILES = [
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
ARABIC_TEXT_ROOTS = [
    "index.html",
    "pages",
    "assets/js",
    "erp",
    "desktop-app/src",
]


def run_step(name, command, cwd=ROOT, timeout=180):
    started = datetime.now()
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        capture_output=True,
        timeout=timeout,
        shell=False,
    )
    elapsed = round((datetime.now() - started).total_seconds(), 2)
    output = (result.stdout or "") + (result.stderr or "")
    return {
        "name": name,
        "command": " ".join(str(part) for part in command),
        "ok": result.returncode == 0,
        "code": result.returncode,
        "elapsed": elapsed,
        "output": output.strip()[-6000:],
    }


def sqlite_checks():
    checks = []
    if not DB_PATH.exists():
        return [{"name": "SQLite file exists", "ok": False, "detail": str(DB_PATH)}]
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
            JOIN erp_product p ON p.id = i.product_id
            WHERE i.product_id IS NOT NULL
              AND i.unit_id <> ''
              AND NOT EXISTS (
                SELECT 1 FROM erp_productunit u
                WHERE u.product_id = i.product_id AND u.external_id = i.unit_id
              )
            """
        ).fetchone()[0]
    checks.extend([
        {"name": "SQLite integrity_check", "ok": integrity == "ok", "detail": integrity},
        {"name": "SQLite foreign_key_check", "ok": not foreign_keys, "detail": json.dumps(foreign_keys[:10])},
        {"name": "SQLite WAL enabled", "ok": journal_mode.lower() == "wal", "detail": journal_mode},
        {"name": "Active products have units", "ok": product_without_units == 0, "detail": str(product_without_units)},
        {"name": "Invoice item units resolve", "ok": orphan_invoice_units == 0, "detail": str(orphan_invoice_units)},
    ])
    return checks


def license_checks():
    public_key = ROOT / "desktop-app" / "build" / "license-public.pem"
    exists = public_key.exists()
    text = public_key.read_text(encoding="utf-8", errors="ignore").strip() if exists else ""
    return [
        {"name": "License public key exists", "ok": exists, "detail": str(public_key)},
        {"name": "License public key valid shape", "ok": "BEGIN PUBLIC KEY" in text and "END PUBLIC KEY" in text, "detail": f"{len(text)} chars"},
    ]


def production_secret_checks():
    local_settings = ROOT / "config" / "desktop-settings.json"
    local_secret = ""
    if local_settings.exists():
        try:
            local_secret = str(json.loads(local_settings.read_text(encoding="utf-8")).get("secret_key", ""))
        except json.JSONDecodeError:
            local_secret = ""
    candidate = os.environ.get("TOX_SECRET_KEY") or local_secret
    blocked = {
        "",
        "change-this-before-shipping",
        "tox-dev-secret-key-change-before-production",
    }
    return [
        {
            "name": "Production secret key configured",
            "ok": candidate not in blocked and len(candidate) >= 32,
            "detail": "TOX_SECRET_KEY or config/desktop-settings.json secret_key",
        }
    ]


def desktop_packaging_checks():
    package_path = ROOT / "desktop-app" / "package.json"
    checks = []
    try:
        from safety_gate import desktop_dependency_checks
        checks.extend(desktop_dependency_checks())
    except Exception as error:
        checks.append({"name": "Desktop dependency checker import", "ok": False, "detail": str(error)})

    if not package_path.exists():
        checks.append({"name": "Desktop package build config exists", "ok": False, "detail": str(package_path)})
        return checks

    package = json.loads(package_path.read_text(encoding="utf-8"))
    build = package.get("build") or {}
    files_blob = json.dumps(build.get("files", []) + build.get("extraResources", []), ensure_ascii=False)
    checks.extend([
        {
            "name": "Desktop package build config exists",
            "ok": bool(build),
            "detail": str(package_path.relative_to(ROOT)),
        },
        {
            "name": "Private license key excluded from package",
            "ok": "license-private.pem" not in files_blob,
            "detail": "desktop-app/package.json",
        },
        {
            "name": "Local desktop settings excluded from package",
            "ok": "config/desktop-settings.json" not in files_blob,
            "detail": "desktop-app/package.json",
        },
    ])
    return checks


def frontend_static_security_checks():
    try:
        from safety_gate import frontend_static_security_checks as safety_security_checks
        return safety_security_checks()
    except Exception as error:
        return [{"name": "Frontend static security checker import", "ok": False, "detail": str(error)}]


def arabic_encoding_checks():
    checks = []
    try:
        from repair_arabic_encoding import TEXT_SUFFIXES, iter_targets, normalize_file
    except Exception as error:
        return [{"name": "Arabic encoding checker import", "ok": False, "detail": str(error)}]

    targets = list(iter_targets())
    pending_repairs = []
    bom_files = []
    missing_charset = []
    for path in targets:
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            bom_files.append(str(path.relative_to(ROOT)))
        if path.suffix.lower() == ".html":
            text = raw.decode("utf-8-sig", errors="replace")
            if "<meta charset=" not in text.lower():
                missing_charset.append(str(path.relative_to(ROOT)))
        result = normalize_file(path, bump_assets=True)
        if result["changed"] or result.get("mojibakeResidue") or result.get("afterSuspicious"):
            pending_repairs.append(result["path"])

    report_path = ROOT / "logs" / "arabic-encoding-report.json"
    report_exists = report_path.exists()
    return [
        {"name": "Arabic source targets found", "ok": bool(targets), "detail": str(len(targets))},
        {"name": "Arabic UTF-8 sources have no BOM", "ok": not bom_files, "detail": json.dumps(bom_files[:10], ensure_ascii=False)},
        {"name": "Arabic HTML pages declare charset", "ok": not missing_charset, "detail": json.dumps(missing_charset[:10], ensure_ascii=False)},
        {"name": "Arabic mojibake repair has no pending changes", "ok": not pending_repairs, "detail": json.dumps(pending_repairs[:10], ensure_ascii=False)},
        {"name": "Arabic encoding report exists", "ok": report_exists, "detail": str(report_path)},
    ]


def render_report(results, db_checks, license_status, arabic_status, security_status, desktop_status, build_steps, backup_path):
    all_items = results + db_checks + license_status + arabic_status + security_status + desktop_status + build_steps
    ok = all(item.get("ok") for item in all_items)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        "# TOX Release Readiness",
        "",
        f"Generated: {now}",
        f"Overall status: {'PASS' if ok else 'BLOCKED'}",
        f"Safety backup: {backup_path or 'not provided'}",
        "",
        "## Gate Results",
        "",
    ]
    for item in all_items:
        status = "PASS" if item.get("ok") else "FAIL"
        detail = item.get("detail") or item.get("command") or ""
        lines.append(f"- {status}: {item['name']} {detail}".rstrip())
    lines.extend([
        "",
        "## Acceptance Checklist",
        "",
        "- PASS backend Django check and test suite.",
        "- PASS JavaScript syntax checks for operational pages.",
        "- PASS SQLite integrity, foreign keys, WAL, product-unit relation checks.",
        "- PASS valid license public key before packaging.",
        "- PASS Arabic UTF-8 source, charset, and cache-busting checks.",
        "- PASS frontend static security and pre-login API gating checks.",
        "- PASS desktop dependencies and packaging resource checks.",
        "- PASS production secret key is unique before packaging.",
        "- PASS desktop build if `--with-build` is used.",
        "- Manual smoke test required: sales, purchases, warehouse, customers, suppliers, backup/restore, permissions, activation.",
        "",
        "## Suggested Pricing In Iraq",
        "",
        "- Basic local store: 500,000 to 1,500,000 IQD.",
        "- Pro with setup, training, activation, and support: 1,500,000 to 3,500,000 IQD.",
        "- Business/custom or multi-branch: 3,500,000 to 8,000,000+ IQD.",
        "- Monthly support: 50,000 to 250,000 IQD depending on customer size.",
        "",
        "## Notes Before Selling",
        "",
        "- Sell installation, training, backup policy, and support, not only files.",
        "- Keep the private license key outside the app package.",
        "- Do not ship a build unless this gate passes and a clean-machine install is tested.",
    ])
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ok


def main():
    parser = argparse.ArgumentParser(description="Run TOX release readiness checks.")
    parser.add_argument("--with-build", action="store_true", help="Run desktop npm dist after all checks.")
    parser.add_argument("--backup-path", default="", help="Safety backup path to record in the report.")
    args = parser.parse_args()

    results = [
        run_step("Django system check", [sys.executable, "manage.py", "check"], timeout=120),
        run_step("Database maintenance dry run", [sys.executable, "manage.py", "maintain_db", "--dry-run"], timeout=120),
        run_step("Backup pruning dry run", [sys.executable, "manage.py", "prune_backups", "--dry-run"], timeout=120),
        run_step("Django ERP tests", [sys.executable, "manage.py", "test", "erp.tests"], timeout=240),
        run_step("Django migrations check", [sys.executable, "manage.py", "migrate", "--check"], timeout=120),
    ]
    for file_path in JS_FILES:
        if (ROOT / file_path).exists():
            results.append(run_step(f"JavaScript syntax {file_path}", ["node", "--check", file_path], timeout=60))
    db_checks = sqlite_checks()
    license_status = license_checks() + production_secret_checks()
    arabic_status = arabic_encoding_checks()
    security_status = frontend_static_security_checks()
    desktop_status = desktop_packaging_checks()

    build_steps = []
    preliminary_ok = all(item.get("ok") for item in results + db_checks + license_status + arabic_status + security_status + desktop_status)
    if args.with_build and preliminary_ok:
        clean_step = run_step(
            "Clean disposable caches before desktop build",
            [sys.executable, "scripts/clean_project_safely.py", "--apply", "--include-logs", "--days", "30"],
            timeout=120,
        )
        build_steps.append(clean_step)
        if clean_step.get("ok"):
            build_steps.append(run_step("Desktop installer build", ["npm.cmd", "run", "dist"], cwd=ROOT / "desktop-app", timeout=900))
        else:
            build_steps.append({"name": "Desktop installer build", "ok": False, "detail": "Skipped because cleanup before build failed."})
    elif args.with_build:
        build_steps.append({"name": "Desktop installer build", "ok": False, "detail": "Skipped because readiness checks failed."})

    ok = render_report(results, db_checks, license_status, arabic_status, security_status, desktop_status, build_steps, args.backup_path)
    print(f"Release readiness {'PASS' if ok else 'BLOCKED'}")
    print(REPORT_PATH)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
