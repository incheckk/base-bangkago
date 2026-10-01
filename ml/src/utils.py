"""Shared helpers for the BangkaGo ML pipeline.

All scripts import from this module. Uses stdlib only so config
loading and date logic work without heavy dependencies.
"""

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Generator


def get_project_root() -> Path:
    """Return the path to the ml/ folder (parent of src/)."""
    return Path(__file__).resolve().parent.parent


def load_config(filename: str) -> dict:
    """Read a JSON file from the config/ folder.

    Args:
        filename: e.g. "ports.json" or "holidays.json".

    Returns:
        Parsed JSON as a dict.
    """
    path = get_project_root() / "config" / filename
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def ensure_dir(path: Path) -> None:
    """Create a folder (and parents) if it does not exist."""
    Path(path).mkdir(parents=True, exist_ok=True)


def date_range(start: date, end: date) -> Generator[date, None, None]:
    """Yield every date from start to end inclusive."""
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def get_season(d: date) -> str:
    """Return the sailing season for a date.

    Amihan (NE monsoon): Dec, Jan, Feb.
    Summer: Mar, Apr, May.
    Habagat (SW monsoon): Jun–Nov.
    """
    if d.month in (12, 1, 2):
        return "amihan"
    if d.month in (3, 4, 5):
        return "summer"
    return "habagat"


def get_day_type(d: date) -> str:
    """Return 'weekday' (Mon–Fri) or 'weekend' (Sat–Sun)."""
    return "weekday" if d.weekday() < 5 else "weekend"


def _special_event_multiplier(d: date, holidays_config: dict) -> float:
    """Return the highest special-event multiplier active on date, else 1.0.

    Special events are defined by month + duration in days (first N days
    of the month). If several overlap, the max wins.
    """
    best = 1.0
    for event in holidays_config.get("special_events", []):
        try:
            month = int(event["month"])
            days = int(event["days"])
            mult = float(event["multiplier"])
        except (KeyError, TypeError, ValueError):
            continue
        if d.month == month and 1 <= d.day <= days:
            best = max(best, mult)
    return best


def get_holiday_multiplier(d: date, holidays_config: dict) -> float:
    """Return the demand multiplier for a date, or 1.0 on normal days.

    Checks recurring MM-DD holidays first, then month-window special
    events. Returns the max of any matches.
    """
    best = 1.0
    mmdd = d.strftime("%m-%d")
    for holiday in holidays_config.get("holidays", []):
        if holiday.get("recurring") and holiday.get("date") == mmdd:
            try:
                best = max(best, float(holiday["multiplier"]))
            except (TypeError, ValueError):
                continue
        elif not holiday.get("recurring") and holiday.get("date") == d.isoformat():
            try:
                best = max(best, float(holiday["multiplier"]))
            except (TypeError, ValueError):
                continue
    best = max(best, _special_event_multiplier(d, holidays_config))
    return best


def is_holiday(d: date, holidays_config: dict) -> bool:
    """Return True if the date has a multiplier above 1.0."""
    return get_holiday_multiplier(d, holidays_config) > 1.0
