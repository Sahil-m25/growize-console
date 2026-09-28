#!/usr/bin/env python3
"""M19-S02-T03 - fill the Test cases sheet's Jev columns from results.csv, matched by test id.

Usage: python3 console/scripts/jev-fill-workbook.py <results.csv> <workbook.xlsx> (--out new.xlsx | --in-place) [--sheet "Test cases"]
Fills, by header name in row 1: 'Jev result' <- verdict, 'Jev p' <- p (number), 'Facts below 0.80' <- failing_facts,
'Run date' <- run_date. Rows are matched on the 'Test' column. CSV ids missing from the sheet are reported, never
added; sheet rows absent from the CSV are left untouched. Prints a JSON summary; exit 1 if any CSV id is missing.
Note: openpyxl keeps formulas and styles but drops charts/images; pm/build_plan.py also overlays Jev results
when it rebuilds the workbook, so re-run this after a rebuild. Needs openpyxl.
"""
import argparse, csv, datetime, json, sys

COLS = {"verdict": "Jev result", "p": "Jev p", "failing_facts": "Facts below 0.80", "run_date": "Run date"}


def read_results(path):
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    by_id, dupes = {}, []
    for r in rows:
        i = (r.get("id") or "").strip()
        if not i:
            continue
        if i in by_id:
            dupes.append(i)
        by_id[i] = r  # the later row wins (a re-run of the same case)
    return by_id, dupes


def cell_value(key, raw):
    raw = raw if raw is not None else ""
    if key == "p":
        try:
            return float(raw)
        except ValueError:
            return None if raw == "" else raw
    if key == "run_date" and raw:
        try:
            return datetime.date.fromisoformat(raw[:10])
        except ValueError:
            return raw
    return raw if raw != "" else ("—" if key == "failing_facts" else raw)


def fill(results_csv, workbook, out, sheet="Test cases"):
    import openpyxl
    by_id, dupes = read_results(results_csv)
    wb = openpyxl.load_workbook(workbook)
    if sheet not in wb.sheetnames:
        raise SystemExit(f"sheet {sheet!r} not found in {workbook}")
    ws = wb[sheet]
    head = {str(c.value).strip(): c.column for c in ws[1] if c.value is not None}
    need = ["Test", *COLS.values()]
    absent = [h for h in need if h not in head]
    if absent:
        raise SystemExit(f"missing columns in {sheet!r}: {', '.join(absent)}")
    filled, seen = [], set()
    for row in range(2, ws.max_row + 1):
        tid = ws.cell(row=row, column=head["Test"]).value
        tid = str(tid).strip() if tid is not None else ""
        r = by_id.get(tid)
        if not r:
            continue
        for key, col in COLS.items():
            c = ws.cell(row=row, column=head[col])
            c.value = cell_value(key, r.get(key))
            if key == "run_date" and isinstance(c.value, datetime.date):
                c.number_format = "dd mmm yyyy"
        filled.append(tid)
        seen.add(tid)
    missing = [i for i in by_id if i not in seen]
    wb.save(out)
    return {"filled": len(filled), "filled_ids": filled, "missing_in_sheet": missing, "duplicate_ids_in_csv": dupes, "saved": out}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("results_csv"); ap.add_argument("workbook")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--out"); g.add_argument("--in-place", action="store_true")
    ap.add_argument("--sheet", default="Test cases")
    a = ap.parse_args(argv)
    s = fill(a.results_csv, a.workbook, a.workbook if a.in_place else a.out, a.sheet)
    print(json.dumps(s, indent=1, default=str))
    return 1 if s["missing_in_sheet"] else 0


if __name__ == "__main__":
    sys.exit(main())
