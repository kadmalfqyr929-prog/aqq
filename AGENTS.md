# TOX ERP — Agent Operating Guide

> A working manual for any AI agent (Mavis, Codex, Claude Code, Cursor, Aider, Devin, Gemini CLI) that touches this repo. **Read this on cold start, then re-consult per task.** It is the single source of truth for how TOX is built, what its rules are, and how to change it safely.

---

## 1. What this project is

**TOX ERP / TOX Lite** is an Arabic-first, RTL, **local-first** sales, warehouse, accounts, and reporting system for **Iraqi** small businesses. It pairs a **Django 4.2 + DRF** backend with a **vanilla-JS + Electron** desktop shell and a **Flutter-friendly REST** contract. The financial core is an **immutable ledger**; the stock core is **FIFO costing with multi-unit products**.

Primary URL: `http://127.0.0.1:8765/` (loopback only — **LAN is hard-disabled by policy**).
Default admin: `user / user123` (admin role).

Pricing tiers (from `release-readiness.md`): 500K – 8M+ IQD depending on edition. Sell installation, training, and support — not just files.

---

## 2. Who it's for

| Dimension        | Value                                                                |
|------------------|----------------------------------------------------------------------|
| Market           | Iraq, small/medium retail + wholesale                                |
| Language         | Arabic (RTL) primary; English technical                              |
| Currency         | IQD primary; USD secondary; all balances normalized to IQD for KPIs  |
| Time zone        | `Asia/Baghdad` (set in `toxerp/settings.py`)                         |
| Deployment       | Desktop (Electron) or local web on a single machine                  |
| Network posture  | **Loopback only** — no LAN, no WAN, no cloud                         |

Never relax the loopback-only posture. `LocalOnlyMiddleware` and `desktop_config.LAN_ACCESS = False` enforce it; `start_server.py` and `start_server.py` reject non-loopback host arguments.

---

## 3. Architecture at a glance

```
┌─────────────────────────────────────────────────────────────┐
│  Electron shell (desktop-app/src/main.js)                   │
│  ├── license.js   (RSA-SHA256 activation, machine binding)  │
│  ├── logger.js    (logs/<userData>/electron.log)            │
│  ├── config.js    (HOST=127.0.0.1, PORT=8765)               │
│  └── spawn → start_server.py (Django runserver --noreload)  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Django (toxerp/settings.py) — loopback only                │
│  ├── LocalOnlyMiddleware     (forbids non-loopback)         │
│  ├── DevCorsMiddleware       (5500 + same-origin only)      │
│  ├── BackendDebugLogging     (logs/backend-debug.log 4xx/5xx)│
│  └── DesktopHeadersMiddleware (no-store, fingerprint)       │
│                                                             │
│  erp/                                                       │
│  ├── models.py        SoftDelete + ImmutableLedgerQuerySet  │
│  ├── services.py      FinanceServiceError, FIFO, validation│
│  ├── analytics.py     Dashboard/KPI/Stock alerts/Reports   │
│  ├── api.py           DRF function views (csrf_exempt)      │
│  ├── serializers.py   dict<->model, IQD formatting          │
│  ├── authentication.py ToxJWTAuthentication (HS256)         │
│  ├── stock.py         Inventory adjustment engine           │
│  ├── middleware.py    Local-only, CORS, debug, headers      │
│  ├── backup_retention Auto-prune of backups/                │
│  └── migrations/      30 incremental, never destructive     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend (assets/, pages/, index.html)                     │
│  ├── assets/js/api-client.js  ToxApi (Bearer token, CORS)   │
│  ├── assets/js/state.js       global state (~170KB)         │
│  ├── assets/js/ui.js          shared widgets / dialogs      │
│  ├── assets/js/sales.js, purchases.js, products.js, …       │
│  ├── assets/css/styles.css    design system + 9 themes      │
│  ├── assets/css/dashboard-2026.css                         │
│  └── pages/*.html            one HTML per ERP section       │
└─────────────────────────────────────────────────────────────┘
```

Two ways the system is shipped:

- **Web/local** — `python start_server.py` opens at `http://127.0.0.1:8765/`.
- **Desktop** — `npm run build` in `desktop-app/` produces an NSIS installer; bundles the backend as `extraResources` and launches it on demand.

---

## 4. File map & ownership

| Path                                | Owns                                                        | Edit when…                                                 |
|-------------------------------------|-------------------------------------------------------------|------------------------------------------------------------|
| `index.html`                        | Login + dashboard shell                                     | Login flow or root navigation changes                      |
| `pages/*.html`                      | One HTML per ERP section (sales, warehouse, reports, …)     | Adding/removing sections, page-level structural changes   |
| `assets/css/styles.css`             | Design system, themes, ERP layout polish                    | Theming, button/input/panel geometry, RTL rules           |
| `assets/css/dashboard-2026.css`     | Dashboard + client views                                    | Dashboard-specific polish                                  |
| `assets/js/api-client.js`           | HTTP client (Bearer token, CORS, base URL)                  | API transport contract changes                             |
| `assets/js/state.js`                | Global in-memory + `localStorage` state                     | Cross-page state shape                                     |
| `assets/js/ui.js`                   | Shared UI widgets (dialogs, toasts, tables)                 | Reusable UI patterns                                       |
| `assets/js/<feature>.js`            | Per-feature behavior (sales, products, …)                   | Feature work                                              |
| `erp/models.py`                     | Domain entities                                             | Adding an entity, soft-delete, immutability                |
| `erp/services.py`                   | Financial transaction services (FIFO, validation)           | Touching money math, stock moves, invoice/purchase writes  |
| `erp/analytics.py`                  | Dashboard/KPI/Report payloads (server-derived)              | Anything that affects revenue/profit/stock-alert numbers   |
| `erp/api.py`                        | HTTP endpoints                                              | Adding/changing an endpoint                                |
| `erp/serializers.py`                | Model → dict, JSON parsing helpers                          | API response shape                                         |
| `erp/authentication.py`             | JWT signing + verification                                  | Auth changes                                               |
| `erp/middleware.py`                 | Loopback, CORS, debug logging, desktop headers              | Network/security posture changes                           |
| `erp/stock.py`                      | Inventory adjustment engine                                 | Manual stock adjustments                                   |
| `erp/backup_retention.py`           | Auto-prune `backups/`                                       | Retention policy changes                                   |
| `erp/migrations/`                   | DB schema history                                           | **Only when adding fields/entities — never destructive**   |
| `erp/management/commands/`          | `maintain_db`, `prune_backups`, repair tools                | Operational tooling                                        |
| `erp/tests.py`                      | Django test suite                                           | Whenever touching `services.py` / `analytics.py` / `api.py`|
| `toxerp/settings.py`                | Django settings (CORS, JWT, host, locale, logging)          | Infrastructure config                                      |
| `toxerp/urls.py`                    | Top-level URL routing                                       | Adding top-level pages or static routes                    |
| `desktop_config.py`                 | Paths, host, port, settings, source fingerprint             | Packaging/desktop config                                   |
| `start_server.py`                   | Production-style launcher (loopback, migrations, --noreload) | Local-launch behavior                                    |
| `manage.py`                         | Django CLI                                                  | Don't touch                                                |
| `desktop-app/src/main.js`           | Electron main process                                       | Desktop lifecycle                                          |
| `desktop-app/src/config.js`         | Desktop URL/port/window config                              | Desktop port changes                                       |
| `desktop-app/src/license.js`        | RSA-SHA256 license verification                             | License flow changes                                       |
| `desktop-app/src/logger.js`         | Desktop log writer                                          | Desktop diagnostics                                        |
| `desktop-app/package.json`          | Electron build config                                       | Packaging changes                                          |
| `desktop-app/scripts/create-license*.js` | License tooling                                         | License generation                                         |
| `scripts/diagnose_tox.py`           | API/JWT/CORS/frontend-binding health probe                  | Adding new diagnostic checks                               |
| `scripts/safety_gate.py`            | Pre/post-change integrity checks                            | Adding safety checks                                       |
| `scripts/release_gate.py`           | Pre-release gate (CSS, JS, DB, license, Arabic)             | Adding release gates                                       |
| `scripts/repair_arabic_encoding.py` | Mojibake repair utility                                     | Arabic encoding drift                                      |
| `scripts/clean_project_safely.py`   | Safe cleanup (preserves db.sqlite3, backups/, config/)      | Cleanup policy changes                                     |
| `config/desktop-settings.example.json` | Default desktop settings                                | Schema additions                                           |
| `config/desktop-settings.json`      | Local desktop settings (loopback, port)                     | Local-only changes                                         |
| `config/license-private.pem`        | **Private RSA key — never ship, never commit for real**     | License key rotation                                       |
| `docs/safety-protocol.md`           | Safety rules                                                | Documentation                                              |
| `docs/change-audit-template.md`     | Pre-change audit template                                   | Documentation                                              |
| `release-readiness.md`              | Last release gate output                                    | Auto-regenerated                                           |

**Do not edit** `desktop-app/build/license-public.pem` casually — it gates the entire activation flow. The matching private key lives in `config/license-private.pem` and must **never** be packaged or committed in a real distribution.

---

## 5. Domain model cheat sheet

**Inheritance base classes**

- `SoftDeleteModel` — adds `external_id` (UUID-ish), `created_at`, `updated_at`, `deleted_at`, and an `archive()` method. Use `Model.objects.active()` to filter live rows. Every domain entity inherits this.
- `ImmutableLedgerQuerySet` — overrides `update()` and `delete()` to **raise** `ValueError`. Apply to any ledger-style entity. Create reversals, never edit.

**Core entities** (in dependency order)

```
Warehouse (soft)
   └── Product (soft, with image, units, alert_quantity, multi-currency)
         ├── ProductImage          (1..n, sort_order, is_primary)
         ├── ProductUnit           (multi-unit; base_unit + multiplier)
         └── ProductSearchToken    (for fast POS search)

Client (soft)              Supplier (soft)         Employee (soft)
   ├── address                  ├── company_name        ├── user FK
   ├── image                    └── contact             ├── salary, role
   └── balance_iqd (derived)    balance via ledger     └── payroll FKs

Invoice (soft, kind)        Purchase (soft)         ReturnDocument (soft)
   ├── invoiceitem[]              ├── purchaseitem[]     └── returnitem[]
   ├── client_id? (nullable)      └── supplier_id?
   └── totals validated server-side

InstallmentPlan (soft)     ClientPayment            SupplierPayment
   └── schedule FK

LedgerEntry (IMMUTABLE)     AccountMovement          StockBatch
   amount, currency, kind,    mirrors ledger for      (FIFO cost layer)
   account FK, ref FK, date   account balance

StockMovement               CurrencyRate             Expense
  (audit trail for stock)    (USD<->IQD snapshots)    (operational costs)

UserProfile (1:1 User)      LoginEvent               AuditLog
  role, permissions JSON     login attempts           cross-entity audit
```

**Critical relations**

- `Client.balance_iqd` is **derived** from the ledger; do not store ad-hoc balances.
- `Product.stock_quantity` is `Decimal(15,4)`; conversions go through `ProductUnit` (largest unit = display default).
- `StockBatch` is the FIFO cost layer. New `Purchase` → creates batch; `Invoice` → consumes from oldest batch.
- All money math uses `Decimal` + `_money()` (ROUND_HALF_UP to 0.0001 IQD). Never `float`.
- `external_id` is the public ID used by all REST endpoints. **Never** expose raw `pk`.

---

## 6. Hard rules (do / don't)

### Network & access

- ✅ Bind only to `127.0.0.1` / `localhost` / `::1`. `start_server.py` already coerces.
- ✅ Keep `LocalOnlyMiddleware` first in the request chain.
- ❌ Don't add `0.0.0.0` bindings, `ALLOWED_HOSTS = ["*"]`, or LAN env vars.
- ❌ Don't expose `/api/...`, `/assets/...`, or `/media/...` to a public server.
- ❌ Don't use `csrf_exempt` outside `erp/api.py` and only with a justified reason (custom auth).
- ❌ Don't disable `LocalOnlyMiddleware` even in "dev mode" — it has no dev-mode bypass.

### Money & ledger

- ✅ Use `Decimal` everywhere for money. Use `_money()` for rounding.
- ✅ Append a **reversal** `LedgerEntry` to undo — never `update()` / `delete()`.
- ✅ All invoice/purchase totals must be **recomputed server-side** from line items.
- ✅ Validate unit conversion via `ProductUnit`; never trust client-side `unit_price`.
- ❌ Don't read or write `LedgerEntry` via `.update()` / `.delete()`.
- ❌ Don't put money math in serializers — it belongs in `services.py`.
- ❌ Don't let JS compute revenue/profit/KPIs — `analytics.py` is the only source.

### Database

- ✅ Migrations are **incremental and additive**; preserve data.
- ✅ Always include `external_id`, `created_at`, `updated_at`, `deleted_at` on new entities.
- ✅ Add `models.Index(...)` for any field used in `filter()` on hot paths.
- ❌ Don't drop columns or rename `external_id`s — these are public API.
- ❌ Don't write SQL migrations by hand; use `makemigrations`.

### Frontend

- ✅ One `assets/js/<feature>.js` per page section; share via `ui.js` + `state.js`.
- ✅ Always render Arabic RTL; respect `dir="rtl"` and `lang="ar-iq"`.
- ✅ Read `ToxApi.token()` for the Bearer header (handled by `api-client.js`).
- ✅ Use theme variables (`--tox-*`) for color; don't hard-code hex.
- ❌ Don't put money math in JS — call the API.
- ❌ Don't write to `localStorage` for security-sensitive data.
- ❌ Don't bypass `csrf_exempt` patterns — `api-client.js` already handles auth.

### Auth

- ✅ JWT tokens are HS256 with 12h lifetime; verify `exp` on every request.
- ✅ `IsAuthenticated` is required for analytics endpoints.
- ❌ Don't accept a token without verifying it (no `request.user` shortcut).
- ❌ Don't store passwords in plaintext; use Django's hashers.

### Operations

- ✅ Run `python manage.py check` and `python manage.py test erp.tests` before commit.
- ✅ Run `python scripts/safety_gate.py --quick` before any risky change.
- ✅ Run `python scripts/release_gate.py` before any release.
- ✅ Never edit `db.sqlite3`, `backups/`, or `config/` during cleanup scripts.
- ❌ Don't auto-install software (Python, Node) without user approval.

---

## 7. Frontend patterns

**Loading order** (typical page):

```html
<script src="/assets/js/api-client.js"></script>
<script src="/assets/js/state.js"></script>
<script src="/assets/js/ui.js"></script>
<script src="/assets/js/<feature>.js"></script>
```

**API call pattern**:

```js
const response = await ToxApi.fetch("/invoices/", {
  method: "POST",
  body: JSON.stringify(payload)
});
if (!response.ok) {
  const err = await response.json();
  // err.reason, err.message — backend raises these consistently
  ui.toast(err.message || "فشل الحفظ", "error");
  return;
}
const data = await response.json();
```

**Money display**:

- Backend already returns IQD-formatted strings (`f"{int(...):,} د.ع"`) where stable.
- For dynamic values, call `formatIQD(value)` in `labels.js` / `ui.js` — never `toFixed`.

**RTL rules**:

- Layouts use `flex` with logical properties (`margin-inline-start`, `padding-inline-end`).
- Numbers and dates display via `ar-IQ` locale; never mix LTR numerals.
- Icon mirroring: arrows and progress indicators must flip in RTL.

**Theming**:

- 9 themes live in `:root[data-theme="..."]` blocks in `styles.css`.
- Pick theme variables (`--tox-bg`, `--tox-fg`, `--tox-accent`, …) over hard-coded colors.
- New theme = new `:root[data-theme="..."]` block, no JS changes.

**Stable binding IDs** (the dashboard frontend contract):

- `#today-sales-card`, `#low-stock-alert-list`, `#sales-chart-container`, etc.
- Don't rename without updating `diagnose_tox.py` and `dashboard.js`.

---

## 8. Backend patterns

**Service layer** (`erp/services.py`):

- All write operations that touch money or stock go through a service function.
- Raise `FinanceServiceError(reason, message, details)` for recoverable issues.
- Use `transaction.atomic()` blocks; never half-write a financial event.
- `_assert_money_matches()`, `_consume_fifo_cost()`, `_line_price()`, `_line_total()`, `_money()` are the building blocks.

**Analytics layer** (`erp/analytics.py`):

- All revenue, profit, KPI, and stock-alert numbers are computed here, not in the API view.
- Public functions: `dashboard_analytics_payload()`, `dashboard_summary_payload()`, `kpi_analytics_payload()`, `stock_alerts_payload()`, `system_readiness_payload()`, `analytics_reports_live()`.
- Period parsing handled by `analytics_period(params)`.

**API layer** (`erp/api.py`):

- All views are function-based with `@api_view([...])` and explicit `@permission_classes` / `@authentication_classes`.
- `csrf_exempt` is on every function view (custom auth) — never extend that surface area.
- Imports serializers and services; never import models in views if a serializer wraps them.
- Heavy/streaming views: use `StreamingHttpResponse` (e.g. backup full export).

**Auth** (`erp/authentication.py`):

- `ToxJWTAuthentication` parses `Authorization: Bearer <token>`, validates HS256 signature and `exp`.
- `create_access_token(user)` issues a 12h token. Use it from `auth_login`.

**Middleware order matters** (`toxerp/settings.py`):

```
Security → Session → LocalOnly → DevCors → Common → Csrf → Auth → BackendDebugLogging → Messages → Clickjacking → DesktopHeaders
```

Reordering will break either the loopback gate, the CORS allow-list, or the debug log.

---

## 9. Database patterns

**Adding a new entity**:

```python
class MyEntity(SoftDeleteModel):
    external_id = models.CharField(max_length=80, unique=True)  # inherited
    created_at = models.DateTimeField(default=timezone.now)     # inherited
    updated_at = models.DateTimeField(auto_now=True)            # inherited
    deleted_at = models.DateTimeField(null=True, blank=True)    # inherited

    name = models.CharField(max_length=160, db_index=True)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT)

    class Meta:
        indexes = [models.Index(fields=["warehouse", "deleted_at"])]
```

Then `python manage.py makemigrations erp` and review the diff. Never `migrate --run-syncdb` against production data.

**Ledger-style entity**:

```python
class MyLedger(SoftDeleteModel):
    objects = ImmutableLedgerQuerySet.as_manager()
    # ...
```

The `ImmutableLedgerQuerySet.update()` / `.delete()` will raise. Reversal = append a new row with negative `amount`.

**Soft-delete queries**:

- Always use `MyModel.objects.active()` (or `.filter(deleted_at__isnull=True)`).
- Foreign keys to soft-deleted models should use `on_delete=PROTECT` and filter in the query.

**Hot-path indexes** to consider on every entity: `deleted_at`, `created_at`, plus anything in `filter()` or `order_by()`.

---

## 10. Desktop shell

**Launch flow** (Electron → Django):

1. `app.whenReady()` → `license.ensureActivation({...})` (skipped in dev unless `TOX_REQUIRE_LICENSE=1`).
2. `startDjangoBackend()` spawns `start_server.py --no-wait` via `pythonw.exe` / `python.exe` / `py.exe -3` candidates.
3. `waitForBackend()` polls `/api/health/` every 500ms for up to 60s.
4. `createMainWindow()` opens `http://127.0.0.1:8765/` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
5. `before-quit` kills the Django child process.

**License**:

- `desktop-app/src/license.js` uses `crypto.verify("RSA-SHA256", …)` with `license-public.pem`.
- Machine ID = SHA-256(`APP_NAME | hostname | username | platform | arch | userData path`) truncated to 32 hex chars uppercased.
- License file lives at `<userData>/runtime/activation.license.json`.

**Build**:

- `npm run build` → NSIS installer for Windows x64.
- Bundles `src/`, `build/icon.ico`, `build/license-public.pem`, `package.json` in `app.asar`.
- `extraResources` (the Django backend) is filtered: excludes `__pycache__`, `*.pyc`.
- In packaged mode, the backend lives at `process.resourcesPath/backend/`.

**Hardening** (already in place):

- Single-instance lock; `app.requestSingleInstanceLock()`.
- `setWindowOpenHandler` denies internal navigation; routes to default browser.
- `will-navigate` blocks any non-`SERVER_URL` navigation.
- `LocalOnlyMiddleware` is the last line of defense if the desktop shell ever gets bypassed.

---

## 11. Build, run, validate

```powershell
# Setup
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Apply migrations
python manage.py migrate

# Run (web/local)
python manage.py runserver 127.0.0.1:8765
# — or —
python start_server.py          # preferred; also runs migrations and is loopback-only

# Health
curl http://127.0.0.1:8765/api/health/

# Diagnostics
python scripts\diagnose_tox.py --base-url http://127.0.0.1:8765

# Tests
python manage.py check
python manage.py test erp.tests --keepdb
python manage.py shell -c "from erp.analytics import dashboard_analytics_payload; print(dashboard_analytics_payload()['ok'])"

# Safety gate (before/after risky change)
python scripts\safety_gate.py --quick

# Release gate (before shipping)
python scripts\release_gate.py

# Frontend syntax (Node required)
node --check assets\js\dashboard.js
node --check assets\js\reports.js
node --check assets\js\state.js

# Desktop build
cd desktop-app
npm install
npm run build
```

**PowerShell caveats** (per host policy):

- Use `;` not `&&` to chain commands; or use `if ($?) { … }`.
- Use `Get-ChildItem`, `Select-String`, `Select-Object` — not `ls`, `grep`, `head`.
- Use the full `node.exe` / `python.exe` path if `PATH` is weird; on Windows prefer `python.exe` not `python3`.

---

## 12. Common recipes

### Add a new REST endpoint

1. Add the view in `erp/api.py` (function-based, `@api_view`, explicit permissions).
2. Wire it in `erp/urls.py` (`path("…", api.my_view)`).
3. If it touches money/stock, route the write through `erp/services.py` (transaction, validation).
4. Add a serializer in `erp/serializers.py` (do not return raw `Model.objects.values()`).
5. Add a JS caller in `assets/js/<feature>.js` via `ToxApi.fetch(...)`.
6. Add a test in `erp/tests.py` — happy path + auth + invalid input.
7. Run `python manage.py check && python manage.py test erp.tests --keepdb`.

### Add a new entity

1. `class MyEntity(SoftDeleteModel):` in `erp/models.py` with the standard fields plus yours.
2. `python manage.py makemigrations erp`; review the migration.
3. Add to `erp/admin.py` if it should be admin-visible.
4. Add serializer (`my_entity_to_dict`) in `erp/serializers.py`.
5. Add a CRUD view in `erp/api.py` and a URL in `erp/urls.py`.
6. Index any field used in `filter()` or `order_by()`.
7. Test + check.

### Add a new ERP page

1. Create `pages/<feature>.html` with the standard `dir="rtl"`, theme, layout markup.
2. Add a `<script>` tag for `api-client.js`, `state.js`, `ui.js`, then `<feature>.js`.
3. Wire navigation in `index.html` and any parent shell.
4. Add a top-level URL in `toxerp/urls.py` if it's a full page (not under `/api/`).
5. Reuse theme variables; never hard-code colors.

### Add a new theme

1. Append a new `:root[data-theme="<name>"] { … }` block in `assets/css/styles.css`.
2. Reuse the same variable names (`--tox-bg`, `--tox-fg`, `--tox-accent`, …) so feature CSS doesn't break.
3. Test dashboard, login, sales, reports — they have the most diverse colors.

### Add a new analytics metric

1. Add a private helper in `erp/analytics.py` that reads from ledger / batches — never from frontend.
2. Expose it through one of: `dashboard_analytics_payload`, `kpi_analytics_payload`, `analytics_reports_live`.
3. Bind a stable DOM ID in `assets/js/dashboard.js` and `diagnose_tox.py` if it's dashboard-visible.
4. Test with a representative seed.

### Add a new middleware

1. Drop it in `erp/middleware.py`.
2. Wire it in `MIDDLEWARE` in `toxerp/settings.py` — placement matters (see Section 8).
3. If it changes request/response shapes, update `BackendDebugLogging` accordingly.

---

## 13. What NOT to touch (without strong justification)

| Area                                  | Why                                                                                  |
|---------------------------------------|--------------------------------------------------------------------------------------|
| `config/license-private.pem`          | Private RSA key. Compromise = full license bypass. Never commit in real distribution.|
| `LocalOnlyMiddleware` behavior        | Loopback gate. Removing = remote attack surface on a desktop product.               |
| `ImmutableLedgerQuerySet` overrides   | Whole point of the ledger. Bypass = silent corruption.                              |
| `_money()`, `_line_total()`, FIFO     | The only correct way to do money math in this codebase.                             |
| `start_server.py` host coercion       | Forces loopback even if env says otherwise.                                          |
| `desktop-app/build/license-public.pem`| Distro identity. Wrong key = activation always fails.                                |
| `db.sqlite3`, `backups/`              | User data. Cleanup scripts must never delete without a backup policy.                |
| `release-readiness.md`                | Auto-generated by `release_gate.py`. Don't hand-edit.                              |
| `desktop-app/src/license.js` flow     | License UX is the commercial gate. Changes need product + security review.          |

---

## 14. Known gaps & opportunities (improvement backlog)

The user wants the system to stay stable, fast, and well-designed. Below are the gaps I noticed during this analysis — each is a candidate for a follow-up task, not a must-fix-now.

### Performance

- **`assets/js/state.js` is ~170 KB** — biggest single JS file. Likely a candidate for splitting (per-section stores) or migrating hot paths to lazy imports.
- **`styles.css` is ~870 KB; `dashboard-2026.css` is ~160 KB** — consider a PostCSS / purge pass to drop unused rules per page.
- **Analytics queries** — most are O(n) ledger scans. For large datasets, add covering composite indexes (`LedgerEntry(account_id, created_at)`) and consider a daily `AccountMovement` snapshot table for the dashboard.
- **N+1 risk** on dashboard entity balances — already mitigated with grouped aggregation per `release-readiness.md`; verify with `python -X importtime manage.py shell -c …` if numbers lag.

### Architecture / maintainability

- **`erp/api.py` is ~5,300 lines** — single file, all endpoints. Split per feature (`api/sales.py`, `api/warehouse.py`, …) without breaking URL paths.
- **`erp/services.py` is ~2,700 lines** — same pattern. Splitting by domain (sales, purchases, stock, payments) would help.
- **Mix of soft-delete + immutable ledger + soft-delete on `Invoice`/`Purchase`** is correct but subtly easy to break. Add a `Model.archived()` mixin check to CI.
- **No `services/` subpackage, no `repositories/`** — a future refactor could introduce them behind the current function surface, without changing callers.
- **No structured logging** — only file handlers. Add JSON logging in production builds.

### Frontend

- **No bundler** — script order is hand-maintained. Adding an `esbuild` / `rollup` step would let us split safely, deduplicate, and tree-shake.
- **No state-management framework** — `state.js` is hand-rolled. A `proxy` + observers would be cleaner, but: cost vs benefit depends on how much more feature work is coming.
- **Themes are CSS-only** — to add a user-customizable accent you'd need a runtime CSS variable update.
- **No automated visual regression test** — for a 9-theme system this is a gap.

### Testing

- **`erp/tests.py`** — only one test file. Coverage is concentrated on sales/invoices/stock. Add:
  - Middleware loopback tests (synthetic non-loopback REMOTE_ADDR).
  - JWT edge cases (expired, tampered, wrong user).
  - Analytics regression with frozen time.
  - Serializer round-trip tests per entity.

### Tooling

- **No pre-commit / lint** — adding `ruff` (Python) and `eslint` (JS) would catch regressions cheap.
- **No CI** — `release-readiness.md` is the closest thing; consider wiring it into GitHub Actions.
- **No backup verification on restore** beyond the manual `backup_verify` endpoint — automate a "restore to scratch DB + integrity_check" job.

### Security

- **`CSRF_COOKIE_HTTPONLY = False`** — required for the SPA, but worth re-evaluating if a native client is added.
- **`SECRET_KEY` default** in `desktop_config.py` is a placeholder. Desktop install must rotate it.
- **No rate limiting on `/api/auth/login/`** — for a desktop app the attack surface is local, but still nice-to-have.

### Product

- **No multi-branch** — `Warehouse` is per-store, but consolidated reporting is not exposed.
- **No barcode scanner integration** beyond the input field — hardware integration is absent.
- **No Iraqi Bologna-style grading** (per README — explicit non-goal).
- **No mobile shell** — Flutter client is mentioned in the README as a future option; the API already supports it.

### Documentation

- **No architecture diagram** in the repo (this file is a partial substitute).
- **No OpenAPI / Swagger** — for a REST-first project this is a gap. Consider `drf-spectacular` with a small footprint.
- **No changelog** — a `CHANGELOG.md` tied to migration `0001…0030` would help.

---

## 15. Quick orientation checklist (use at the start of every task)

- [ ] **What area is this task in?** Frontend / backend / desktop / database / ops / docs.
- [ ] **Read the owning file** (Section 4) before writing code.
- [ ] **Are any hard rules** (Section 6) affected? Loopback, ledger, money math, migrations.
- [ ] **Will I touch the network posture, JWT, or license?** If yes, ask for explicit sign-off.
- [ ] **Does this need a migration?** If yes, additive only, with a test.
- [ ] **Does this need a serializer change?** If yes, the API contract changed — coordinate with `assets/js/`.
- [ ] **Will I touch `assets/css/styles.css`?** If yes, check all 9 themes + RTL.
- [ ] **Did I run `python manage.py check` and `python manage.py test erp.tests --keepdb`?**
- [ ] **Did I run `python scripts/safety_gate.py --quick`?**
- [ ] **Did I update the relevant doc** (`README.md`, `docs/`, this file)?

---

## 16. How to keep this file useful

This document is living. When you:

- Add a new entity → add a row to Section 5.
- Add a new hard rule → add it to Section 6.
- Discover a non-obvious gotcha → add it to Section 13.
- Ship a new improvement → remove it from Section 14.

If something here becomes wrong, fix it in the same commit that changes the code. Stale docs are worse than no docs.

---

*Last full review: 2026-07-29 — initial synthesis from full repo scan (readme, models, services, analytics, api, auth, middleware, desktop shell, license flow, JS modules, CSS, scripts, release gate output).*
