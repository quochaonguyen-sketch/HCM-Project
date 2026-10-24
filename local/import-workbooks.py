"""Read the supplied XLSX files without modifying them; keep native date cells."""
import datetime
import json
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent

def cell(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return {"$date": value.isoformat()}
    return value if value is not None else ""

def main():
    books = {}
    for key, name in [("backend", "1. Database back-end.xlsx"), ("frontend", "2. Database front-end.xlsx")]:
        workbook = openpyxl.load_workbook(ROOT / name, read_only=True, data_only=True)
        sheets = {}
        for sheet in workbook:
            rows = [[cell(v) for v in row] for row in sheet.iter_rows(values_only=True)]
            while rows and not any(v != "" for v in rows[-1]):
                rows.pop()
            width = max((max((i + 1 for i, v in enumerate(row) if v != ""), default=0) for row in rows), default=0)
            rows = [row[:width] for row in rows]
            sheets[sheet.title] = rows
        books[key] = {"name": name, "sheets": sheets}
        workbook.close()
    target = ROOT / "local" / "workbooks.private.json"
    target.write_text(json.dumps(books, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({k: {n: len(rows) - 1 for n, rows in b["sheets"].items()} for k, b in books.items()}, ensure_ascii=True))

if __name__ == "__main__":
    main()
