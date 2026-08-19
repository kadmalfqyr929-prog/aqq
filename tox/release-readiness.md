# TOX Release Readiness

Generated: 2026-05-30 13:11:20
Overall status: PASS
Safety backup: backups\arabic-fix-safety-20260530-124604

## Gate Results

- PASS: Django system check C:\Users\pro\AppData\Local\Programs\Python\Python311\python.exe manage.py check
- PASS: Django ERP tests C:\Users\pro\AppData\Local\Programs\Python\Python311\python.exe manage.py test erp.tests
- PASS: Django migrations check C:\Users\pro\AppData\Local\Programs\Python\Python311\python.exe manage.py migrate --check
- PASS: JavaScript syntax assets/js/api-client.js node --check assets/js/api-client.js
- PASS: JavaScript syntax assets/js/state.js node --check assets/js/state.js
- PASS: JavaScript syntax assets/js/ui.js node --check assets/js/ui.js
- PASS: JavaScript syntax assets/js/sales.js node --check assets/js/sales.js
- PASS: JavaScript syntax assets/js/purchases.js node --check assets/js/purchases.js
- PASS: JavaScript syntax assets/js/invoice-ledger.js node --check assets/js/invoice-ledger.js
- PASS: JavaScript syntax assets/js/products.js node --check assets/js/products.js
- PASS: JavaScript syntax assets/js/warehouse.js node --check assets/js/warehouse.js
- PASS: JavaScript syntax assets/js/clients.js node --check assets/js/clients.js
- PASS: JavaScript syntax assets/js/suppliers.js node --check assets/js/suppliers.js
- PASS: JavaScript syntax assets/js/installments.js node --check assets/js/installments.js
- PASS: JavaScript syntax assets/js/reports.js node --check assets/js/reports.js
- PASS: JavaScript syntax assets/js/settings.js node --check assets/js/settings.js
- PASS: JavaScript syntax assets/js/employees.js node --check assets/js/employees.js
- PASS: SQLite integrity_check ok
- PASS: SQLite foreign_key_check []
- PASS: SQLite WAL enabled wal
- PASS: Active products have units 0
- PASS: Invoice item units resolve 0
- PASS: License public key exists C:\Users\pro\Desktop\TOX_MIN\desktop-app\build\license-public.pem
- PASS: License public key valid shape 450 chars
- PASS: Arabic source targets found 85
- PASS: Arabic UTF-8 sources have no BOM []
- PASS: Arabic HTML pages declare charset []
- PASS: Arabic mojibake repair has no pending changes []
- PASS: Arabic encoding report exists C:\Users\pro\Desktop\TOX_MIN\logs\arabic-encoding-report.json

## Acceptance Checklist

- PASS backend Django check and test suite.
- PASS JavaScript syntax checks for operational pages.
- PASS SQLite integrity, foreign keys, WAL, product-unit relation checks.
- PASS valid license public key before packaging.
- PASS Arabic UTF-8 source, charset, and cache-busting checks.
- PASS desktop build if `--with-build` is used.
- Manual smoke test required: sales, purchases, warehouse, customers, suppliers, backup/restore, permissions, activation.

## Suggested Pricing In Iraq

- Basic local store: 500,000 to 1,500,000 IQD.
- Pro with setup, training, activation, and support: 1,500,000 to 3,500,000 IQD.
- Business/custom or multi-branch: 3,500,000 to 8,000,000+ IQD.
- Monthly support: 50,000 to 250,000 IQD depending on customer size.

## Notes Before Selling

- Sell installation, training, backup policy, and support, not only files.
- Keep the private license key outside the app package.
- Do not ship a build unless this gate passes and a clean-machine install is tested.
