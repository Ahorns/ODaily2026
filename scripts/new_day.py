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

import yaml

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "_templates" / "day.qmd"
PROJECTS = ROOT / "projects.yml"


def project_comment() -> str:
    """The slugs you may write in `project:`, one line per family.

    Sits inside the `<!-- time -->` block, after a blank line, so build.py
    stops parsing before it and the list can stay free-form. Generated per
    file rather than hard-coded in the template so it can never fall out of
    step with projects.yml.
    """
    try:
        reg = yaml.safe_load(PROJECTS.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return "  (could not read projects.yml)"

    groups = reg.get("groups") or {}
    projects = reg.get("projects") or {}
    if not projects:
        return "  (no projects yet — add one to projects.yml)"

    by_group: dict[str, list[str]] = {}
    for slug, meta in sorted(projects.items()):
        group = (meta or {}).get("group") or ""
        by_group.setdefault(group, []).append(slug)

    label = {g: (groups.get(g, {}) or {}).get("name", g) or "Other" for g in by_group}
    width = max(len(v) for v in label.values())

    lines = []
    for group in sorted(by_group, key=lambda g: label[g]):
        slugs = ", ".join(by_group[group])
        lines.append(f"  {label[group].ljust(width)}  {slugs}")
    return "\n".join(lines)


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
        .replace("{{PROJECTS}}", project_comment())
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    print(f"Created {target.relative_to(ROOT)}")

    if not args.no_build:
        subprocess.run([sys.executable, str(ROOT / "scripts" / "build.py")], check=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
