---
name: tox-erp-expertise
description: Deep knowledge of the TOX ERP system — architecture, domain model, backend/frontend patterns, conventions, and improvement strategies. Auto-triggers on any TOX-related development task.
---

# TOX ERP Expert Skill

You have comprehensive expertise in the TOX ERP codebase. Apply this knowledge when working on any task in this project.

## Architecture Quick Reference

- **Backend**: Django 4.2 + DRF at `127.0.0.1:8765` (loopback-only). SQLite DB.
- **Frontend**: Vanilla JS + HTML/CSS. Electron desktop shell.
- **Auth**: Custom HS256 JWT (12h), stored in `sessionStorage`.
- **Currency**: USD storage, IQD display. Default rate: 1,460 IQD/USD. Always `Decimal`, never `float`.
- **Core pattern**: Immutable ledger (`LedgerEntry`), soft-delete (`SoftDeleteModel`), FIFO stock costing (`StockBatch`).

## Key Files & Their Roles

| File | Role | Size |
|------|------|------|
| `erp/models.py` | 25+ entities with SoftDelete, ImmutableLedger | 763 lines |
| `erp/services.py` | Financial core: FIFO, validation, money math | 2,790 lines |
| `erp/analytics.py` | Dashboard/KPI/Reports (server-only) | 1,981 lines |
| `erp/api.py` | 65+ DRF function-based endpoints | 5,440 lines |
| `erp/serializers.py` | Model→dict conversion | 515 lines |
| `erp/authentication.py` | JWT signing/verification | 71 lines |
| `erp/middleware.py` | LocalOnly, CORS, debug logging, desktop headers | 151 lines |
| `erp/stock.py` | Inventory adjustment with FIFO batch consumption | 130 lines |
| `assets/js/api-client.js` | `ToxApi` HTTP client (Bearer auth, loopback) | 91 lines |
| `assets/js/state.js` | `ToxStore` global state + localStorage | 4,038 lines |
| `assets/js/ui.js` | `ToxI18n`, shared widgets, dialogs, toasts | 1,594 lines |
| `assets/css/styles.css` | Design system, 9 themes, RTL | 908 KB |

## Hard Rules

1. **Money**: `Decimal` + `_money()` everywhere. Never `float`.
2. **Ledger**: Immutable. Reverse via new entry with negative amount.
3. **IDs**: Always `external_id` for API. Never expose `pk`.
4. **Network**: Loopback only. Never `0.0.0.0` or LAN.
5. **KPIs**: Server-side only (`analytics.py`). Never compute in JS.
6. **CSS**: Use `--tox-*` theme variables. Never hardcode hex.
7. **Stock**: All changes via `adjust_stock()` or service functions. Always atomic.
8. **Migrations**: Incremental, additive. Never drop columns.
9. **Soft-delete**: Use `archive()`. Query with `objects.active()`.
10. **Middleware order**: Security → Session → LocalOnly → DevCors → Common → Csrf → Auth → DebugLog → Messages → XFrame → DesktopHeaders.

## Patterns to Follow

### Adding an API endpoint
```python
@csrf_exempt
@api_view(["GET", "POST"])
@authentication_classes([ToxJWTAuthentication, SessionAuthentication])
@permission_classes([IsAuthenticated])
def my_endpoint(request):
    # ...
    return Response({"ok": True, ...})
```

### API call from frontend
```javascript
const res = await ToxApi.fetch("/my-endpoint/", {
  method: "POST",
  body: JSON.stringify(payload)
});
```

### Money math
```python
from .services import _money, balance_iqd
total = _money(price * quantity)
iqd = balance_iqd(total)
```

### Service error handling
```python
raise FinanceServiceError("INSUFFICIENT_BALANCE", "رصيد غير كافٍ", {"required": str(amount)})
```

## Known Technical Debt

- `api.py` (5,440 lines) needs splitting into per-resource modules
- `state.js` (4,038 lines) needs splitting into domain modules
- `styles.css` (908 KB) needs CSS audit and dead-rule cleanup
- `decimal_or_zero`/`date_or_none` duplicated between `services.py` and `serializers.py`
- No CI pipeline — tests and safety gates are manual
