"""Start today's entry (or any date's) from the template.

    python scripts/new_day.py               # today
    python scripts/new_day.py 2026-08-02    # a specific day
    python scripts/new_day.py --milestone   # mark it a supernova

Refuses to overwrite an entry that already exists, then runs the build so the
new planet exists straight away.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "_templates" / "day.qmd"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("date", nargs="?", help="ISO date; defaults to today")
    ap.add_argument("--milestone", action="store_true", help="mark the day a supernova")
    ap.add_argument("--no-build", action="store_true", help="skip running scripts/build.py")
    args = ap.parse_args()

    try:
        day = date.fromisoformat(args.date) if args.date else date.today()
    except ValueError:
        print(f"Not an ISO date: {args.date}", file=sys.stderr)
        return 1

    target = ROOT / "log" / f"{day.isoformat()}.qmd"
    if target.exists():
        print(f"{target.relative_to(ROOT)} already exists — opening that instead of overwriting it.")
        return 0

    # "%#d" is the Windows spelling of "%-d"; both mean an unpadded day number.
    long_date = day.strftime("%A %#d %B %Y" if sys.platform == "win32" else "%A %-d %B %Y")
    text = (
        TEMPLATE.read_text(encoding="utf-8")
        .replace("{{DATE}}", day.isoformat())
        .replace("{{LONG_DATE}}", long_date)
        .replace("{{MILESTONE}}", "true" if args.milestone else "false")
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    print(f"Created {target.relative_to(ROOT)}")

    if not args.no_build:
        subprocess.run([sys.executable, str(ROOT / "scripts" / "build.py")], check=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
