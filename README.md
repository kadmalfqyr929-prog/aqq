# TOX ERP Sales & Warehouse OS

TOX ERP is an Arabic-first sales, warehouse, accounts, and reporting system for Iraqi businesses. The application combines a Django REST Framework backend, an immutable financial ledger, and a lightweight vanilla JavaScript/Electron-ready frontend. The goal is a fast local-first ERP experience with reliable IQD reporting, stock control, customer/supplier accounts, employee administration, and smart dashboard analytics.

## Architecture Overview

- **Backend:** Django 4.2 + Django REST Framework, SQLite by default for desktop/local deployment.
- **Frontend:** Vanilla JavaScript, HTML, and CSS with an Electron desktop shell. The API is also suitable for a Flutter client if a mobile/desktop Flutter shell is added later.
- **Data engine:** Products, warehouses, purchases, sales invoices, payments, installments, immutable ledger entries, stock movements, and audit/login events.
- **Analytics:** Dashboard, KPI, stock-alert, and reports endpoints are JWT-protected and derive revenue/profit from ledger entries rather than frontend calculations.
- **Market localization:** Arabic RTL layout, Iraqi timezone, IQD display, and `ar-IQ` number/date formatting.

## Key Features

- Sales POS with direct and customer-linked checkout.
- Product catalog with flexible units, barcodes, brands, alert quantities, and expiry dates.
- Warehouse hub with stock movements and low-stock monitoring.
- Purchases and supplier settlement.
- Customer/supplier account ledgers with immutable ledger entries and payment tracking.
- Installment sales and overdue installment insight.
- Employee and permissions management.
- Smart Reports and Dashboard analytics with skeleton loading states.
- Local desktop hardening and debug logging.

Note: Iraqi Bologna-style grading is not currently part of this codebase; the system is focused on sales, warehouse, and ledger-based ERP workflows.

## File Structure

```text
.
├── index.html                 # Dashboard and login entry
├── pages/                     # Sales, products, warehouse, reports, settings pages
├── assets/
│   ├── css/styles.css         # Shared design system and ERP layout polish
│   ├── css/dashboard-2026.css # Specialized dashboard/client views
│   ├── js/                    # Vanilla JS modules for each page
│   └── img/                   # Login/dashboard visual assets
├── erp/
│   ├── api.py                 # REST endpoints and permissions
│   ├── analytics.py           # Dashboard/report service layer
│   ├── authentication.py      # First-party JWT signing/authentication
│   ├── models.py              # ERP domain models and immutable ledger
│   ├── services.py            # Financial transaction services and validation
│   ├── serializers.py         # API serialization and stock unit normalization
│   ├── stock.py               # Inventory adjustment engine
│   └── middleware.py          # Local-only, CORS, debug logging, desktop headers
├── toxerp/settings.py         # Django settings and logging configuration
├── scripts/
│   ├── backup_db.py
│   └── diagnose_tox.py        # API/JWT/CORS/frontend binding diagnostics
├── desktop-app/               # Electron shell
└── db.sqlite3                 # Local development database
```

## Installation

1. Create and activate a Python environment.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. Install dependencies.

```powershell
pip install -r requirements.txt
```

3. Apply migrations.

```powershell
python manage.py migrate
```

4. Start the backend and frontend.

```powershell
python manage.py runserver 127.0.0.1:8765
```

Open:

```text
http://127.0.0.1:8765/
```

Default local admin login:

```text
username: user
password: user123
role: admin
```

## Production Deployment Notes

- Set a strong `TOX_SECRET_KEY`.
- Set `TOX_DEBUG=0`.
- Restrict `TOX_ALLOWED_HOSTS`.
- Use a production database if deploying beyond local desktop use.
- Run `python manage.py collectstatic` if serving static files through a production server.
- Keep `logs/backend-debug.log`, `logs/django-error.log`, and database backups under operational review.

## API And Diagnostics

Login returns an access token:

```http
POST /api/auth/login/
```

Analytics routes require:

```http
Authorization: Bearer <token>
```

Core analytics endpoints:

```text
/api/analytics/dashboard/
/api/analytics/dashboard-summary/
/api/analytics/kpis/
/api/analytics/stock-alerts/
/api/analytics/reports/
```

Run diagnostics:

```powershell
python scripts\diagnose_tox.py --base-url http://127.0.0.1:8765
```

The diagnostic checks login, JWT rejection, analytics latency, CORS headers, and frontend binding hooks such as `#today-sales-card`, `#low-stock-alert-list`, and `#sales-chart-container`.

## Optimization Log

- Secured dashboard/report analytics with Bearer JWT authentication and `IsAuthenticated`.
- Split dashboard analytics into summary, KPI, stock alert, and full dashboard routes.
- Moved revenue and net profit calculations into `LedgerAnalyticsService`.
- Optimized dashboard entity balances with grouped ledger aggregation to avoid N+1 account balance queries.
- Added server-side invoice/purchase validation for totals, line totals, quantities, units, and base-unit conversion.
- Added transactional stock updates and stock movement logging for API-created invoices and purchases.
- Normalized product serialization to display inventory using the largest active unit by default.
- Added backend debug middleware for 403/404/500 categorization in `logs/backend-debug.log`.
- Added dashboard skeleton loaders and stable frontend binding IDs.
- Standardized button geometry, input height, panel radius, hover transitions, RTL alignment, and dashboard grid containment.

## Verification Commands

```powershell
python manage.py check
node --check assets\js\dashboard.js
node --check assets\js\reports.js
python manage.py shell -c "from erp.analytics import dashboard_analytics_payload; print(dashboard_analytics_payload()['ok'])"
python scripts\diagnose_tox.py --base-url http://127.0.0.1:8765
```
