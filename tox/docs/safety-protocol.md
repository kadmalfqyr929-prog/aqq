# TOX Safety Protocol

- Keep `db.sqlite3`, `backups/`, and `config/` protected during cleanup.
- Prefer dry runs before destructive cleanup.
- Run `python scripts/safety_gate.py --quick` after changes.
- Reinstall desktop dependencies with `npm install` inside `desktop-app` after deleting `node_modules`.
