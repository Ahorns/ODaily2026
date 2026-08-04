"""Fill the galaxy with sample days, so it can be looked at properly before
there is a real year in it.

    python scripts/demo.py            # add sample days
    python scripts/demo.py --clear    # remove every one of them again

Sample days are marked `demo: true` in their frontmatter and say so in their
text, so they can never quietly become part of the real log. Nothing you wrote
yourself is touched: a date that already has an entry is skipped, and --clear
only deletes files carrying the flag.
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT / "log"
TEMPLATE = ROOT / "_templates" / "day.qmd"

FLAG = "demo: true"
NOTE = ("::: {.callout-note appearance=\"simple\"}\n"
        "Sample day, generated to show the map with something in it. "
        "Remove every one with `python scripts/demo.py --clear`.\n"
        ":::")

# project slug, category, and the shape of a typical session on it
SHAPES = [
    ("thesis", "writing", "Drafting"),
    ("thesis", "data", "Working through the figures"),
    ("thesis", "meeting", "Supervision"),
    ("reading", "reading", "Papers"),
    ("reading", "admin", "Filing notes"),
    ("odaily", "coding", "Building the log"),
    ("odaily", "meeting", "Talking it over"),
]

DID = [
    "Worked through the middle section and left the ending alone.",
    "Read around the problem instead of at it, which helped more than expected.",
    "Cleared a backlog that had been sitting there for a fortnight.",
    "Rebuilt something that already worked, because it did not work *well*.",
    "Spent the day on one stubborn thing and finished it.",
    "Short day. Tidied up and stopped early.",
]
WELL = [
    "Started with the hardest part while the day was still fresh.",
    "Kept a list of what I had already ruled out.",
    "Stopped when it stopped being useful rather than when time ran out.",
    "Wrote the note to myself before closing the laptop.",
]
LEARNED = [
    "The order I do things in matters more than how long I spend on them.",
    "Reading first makes the writing afterwards about twice as fast.",
    "A rough complete version beats a polished half every time.",
    "Most of what felt urgent today was not.",
]
IDEAS = [
    "Worth checking whether this generalises — might be a short note on its own.",
    "A monthly review of which days actually changed the outcome would be worth more than any daily metric.",
    "If this keeps recurring, it deserves a proper write-up rather than another patch.",
]


def is_demo(path: Path) -> bool:
    head = path.read_text(encoding="utf-8")[:400]
    return re.search(r"^demo:\s*true\s*$", head, re.MULTILINE) is not None


def clear() -> int:
    removed = 0
    for path in sorted(LOG_DIR.glob("*.qmd")):
        if path.name.startswith("_"):
            continue
        if is_demo(path):
            path.unlink()
            removed += 1
    print(f"Removed {removed} sample days.")
    return removed


def build_day(day: date, i: int) -> str:
    long_date = day.strftime("%A %#d %B %Y" if sys.platform == "win32" else "%A %-d %B %Y")

    sessions = [SHAPES[(i * 3 + day.day) % len(SHAPES)]]
    if day.day % 3 == 0:
        sessions.append(SHAPES[(i * 5 + day.day + 2) % len(SHAPES)])

    block = ""
    for k, (slug, category, note) in enumerate(sessions):
        hours = round(1.0 + ((day.day * 7 + k * 11 + i) % 11) * 0.5, 2)
        block += (f"  - project: {slug}\n"
                  f"    hours: {hours}\n"
                  f"    category: {category}\n"
                  f'    note: "{note}"\n')

    milestone = day.day % 13 == 0
    text = (TEMPLATE.read_text(encoding="utf-8")
            .replace("{{DATE}}", day.isoformat())
            .replace("{{LONG_DATE}}", long_date)
            .replace("{{MILESTONE}}", "true" if milestone else "false")
            .replace("{{PROJECTS}}", ""))

    # The template's starter entry, replaced with this day's own sessions.
    text = text.replace(
        '  - project: odaily\n    hours: 0\n    note: ""\n',
        block,
    )
    # The flag goes straight after the date so --clear can find it cheaply.
    text = text.replace(f"date: {day.isoformat()}", f"date: {day.isoformat()}\n{FLAG}")

    text = text.replace("## What I did\n", f"{NOTE}\n\n## What I did\n\n{DID[i % len(DID)]}\n")
    text = text.replace("## What I did well\n", f"## What I did well\n\n{WELL[i % len(WELL)]}\n")
    text = text.replace("## What I learned\n", f"## What I learned\n\n{LEARNED[i % len(LEARNED)]}\n")
    if day.day % 6 == 0:
        text = text.replace("## An idea that came up\n",
                            f"## An idea that came up\n\n{IDEAS[i % len(IDEAS)]}\n")
    return text


def add(weeks: int) -> int:
    today = date.today()
    start = today - timedelta(weeks=weeks)
    made = skipped = 0

    for offset in range((today - start).days + 1):
        day = start + timedelta(days=offset)
        # Not every day is a working day, and a log that claims otherwise is a
        # worse demonstration than one with gaps in it.
        if day.weekday() == 6 or (day.day * 7 + day.month) % 6 == 0:
            continue
        path = LOG_DIR / f"{day.isoformat()}.qmd"
        if path.exists():
            skipped += 1
            continue
        path.write_text(build_day(day, offset), encoding="utf-8")
        made += 1

    print(f"Added {made} sample days ({skipped} dates already had an entry and were left alone).")
    return made


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--clear", action="store_true", help="remove all sample days")
    ap.add_argument("--weeks", type=int, default=9, help="how far back to fill (default 9)")
    args = ap.parse_args()

    LOG_DIR.mkdir(exist_ok=True)
    if args.clear:
        clear()
    else:
        add(args.weeks)
    print("Now run: python scripts/build.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
