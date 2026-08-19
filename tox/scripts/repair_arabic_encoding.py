import argparse
import json
import re
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
REPORT_PATH = ROOT / "logs" / "arabic-encoding-report.json"
ASSET_VERSION = "20260530-arabic-utf8"
TEXT_SUFFIXES = {".html", ".js", ".py"}
TARGET_ROOTS = [
    "index.html",
    "pages",
    "assets/js",
    "erp",
    "desktop-app/src",
]
EXCLUDED_PARTS = {
    ".git",
    ".venv",
    ".runtime",
    ".sixth",
    "__pycache__",
    "backups",
    "dist",
    "node_modules",
}
CP1252_BYTES = {
    0x20AC: 0x80,
    0x201A: 0x82,
    0x0192: 0x83,
    0x201E: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02C6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8A,
    0x2039: 0x8B,
    0x0152: 0x8C,
    0x017D: 0x8E,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201C: 0x93,
    0x201D: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02DC: 0x98,
    0x2122: 0x99,
    0x0161: 0x9A,
    0x203A: 0x9B,
    0x0153: 0x9C,
    0x017E: 0x9E,
    0x0178: 0x9F,
}
MOJIBAKE_CHARS = (
    "\u00c2\u00c3\u00c6\u00d8\u00d9\u00da\u00db"
    "\u00e2\u20ac\u201a\u201e\u2026\u2020\u2021\u02c6\u2030"
    "\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022"
    "\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178"
)
# Mojibake Arabic appears as byte-looking Latin-1 / cp1252 runs such as
# U+00D9 U+2026 U+00D8 U+00B1. Decode only a full run, then keep it only
# when it becomes real Arabic.
MOJIBAKE_RE = re.compile(
    r"[\u0080-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e"
    r"\u0192\u02c6\u02dc\u2018\u2019\u201a\u201c\u201d\u201e"
    r"\u2022\u2026\u2020\u2021\u2030\u2039\u203a\u20ac\u2122]{2,}"
)
SOURCE_MOJIBAKE_RE = re.compile(
    r"[\u00c2\u00c3\u00c6\u00d8\u00d9\u00da\u00db\ufffd]"
    r"|\u00e2[\u0080-\u00bf]"
    r"|\\uFFFD"
)
ASSET_VERSION_RE = re.compile(r"(\?v=)[A-Za-z0-9_.-]+")


def iter_targets():
    for item in TARGET_ROOTS:
        path = ROOT / item
        if not path.exists():
            continue
        paths = [path] if path.is_file() else path.rglob("*")
        for candidate in paths:
            if not candidate.is_file() or candidate.suffix.lower() not in TEXT_SUFFIXES:
                continue
            if any(part in EXCLUDED_PARTS for part in candidate.relative_to(ROOT).parts):
                continue
            yield candidate


def has_arabic(text):
    return any("\u0600" <= char <= "\u06ff" for char in text)


def suspicious_score(text):
    score = text.count("\ufffd") * 3
    for match in MOJIBAKE_RE.finditer(text):
        original = match.group(0)
        decoded = decode_cp1252_utf8(original)
        if decoded != original and has_arabic(decoded):
            score += len(original)
    return score


def decode_cp1252_utf8(text):
    byte_values = []
    for char in text:
        code = ord(char)
        if code <= 0xFF:
            byte_values.append(code)
        elif code in CP1252_BYTES:
            byte_values.append(CP1252_BYTES[code])
        else:
            return text
    try:
        return bytes(byte_values).decode("utf-8")
    except UnicodeDecodeError:
        return text


def repair_mojibake(text):
    def replace(match):
        original = match.group(0)
        decoded = decode_cp1252_utf8(original)
        if decoded == original:
            return original
        if has_arabic(decoded) and suspicious_score(decoded) < suspicious_score(original):
            return decoded
        return original

    return MOJIBAKE_RE.sub(replace, text)


def has_mojibake_residue(text):
    return bool(SOURCE_MOJIBAKE_RE.search(text))


def ensure_html_charset(text):
    if "<meta charset=" in text.lower():
        return text
    return re.sub(r"(<head[^>]*>)", r'\1\n    <meta charset="utf-8" />', text, count=1, flags=re.IGNORECASE)


def normalize_file(path, bump_assets):
    raw = path.read_bytes()
    had_bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig", errors="replace")
    before = text
    text = repair_mojibake(text)
    if path.suffix.lower() == ".html":
        text = ensure_html_charset(text)
        if bump_assets:
            text = ASSET_VERSION_RE.sub(r"\g<1>" + ASSET_VERSION, text)
    changed = had_bom or text != before
    return {
        "path": str(path.relative_to(ROOT)),
        "hadBom": had_bom,
        "changed": changed,
        "beforeSuspicious": suspicious_score(before),
        "afterSuspicious": suspicious_score(text),
        "mojibakeResidue": has_mojibake_residue(text),
        "text": text,
        "rawLength": len(raw),
    }


def main():
    parser = argparse.ArgumentParser(description="Repair UTF-8 Arabic source files safely.")
    parser.add_argument("--apply", action="store_true", help="Write changes. Default is dry-run.")
    parser.add_argument("--bump-assets", action="store_true", help="Bump HTML asset query strings.")
    args = parser.parse_args()

    entries = []
    for path in iter_targets():
        result = normalize_file(path, args.bump_assets)
        if result["changed"] or result["beforeSuspicious"] or result["mojibakeResidue"]:
            entries.append({key: value for key, value in result.items() if key != "text"})
        if args.apply and result["changed"]:
            path.write_text(result["text"], encoding="utf-8", newline="")

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "mode": "apply" if args.apply else "dry-run",
        "assetVersion": ASSET_VERSION if args.bump_assets else "",
        "changedFiles": sum(1 for entry in entries if entry["changed"]),
        "bomFiles": sum(1 for entry in entries if entry["hadBom"]),
        "suspiciousFiles": sum(1 for entry in entries if entry["afterSuspicious"] or entry.get("mojibakeResidue")),
        "entries": entries,
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("mode", "changedFiles", "bomFiles", "suspiciousFiles")}, ensure_ascii=False))
    print(REPORT_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
