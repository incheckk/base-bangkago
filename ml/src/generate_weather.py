"""Script 2: generate synthetic daily weather per port (v3.0).

Reads:  config/ports.json, data/raw/synthetic_bookings.csv (cross-check only)
Writes: data/raw/synthetic_weather.csv (10 ports x 731 days = 7,310 rows)

Rules:
- Full calendar range 2024-01-01..2025-12-31 is used (weather exists on
  no-sail days too), so every date has a row for every port.
- Season drives the wind/wave distribution and weather-condition weights.
- is_safe = (wave_height < 1.5 AND wind_speed < 35).
- recorded_at is noon (12:00:00) ISO 8601 because weather is per-day.
"""

import csv
import random
import uuid
from datetime import date, timedelta

from tqdm import tqdm

from src.utils import (
    date_range,
    ensure_dir,
    get_project_root,
    get_season,
    load_config,
)

SEED = 42
DATE_START = date(2024, 1, 1)
# Must reach at least today+6 — Script 7 predicts those dates and needs
# a weather row per (date, start port) to build features.
DATE_END = date.today() + timedelta(days=6)

# season -> (wind_mu, wind_sd, wind_lo, wind_hi,
#            wave_mu, wave_sd, wave_lo, wave_hi,
#            condition weights)
SEASON_SPECS: dict[str, dict] = {
    "amihan": {
        "wind": (20.0, 8.0, 5.0, 45.0),
        "wave": (0.8, 0.4, 0.1, 2.5),
        "conditions": {
            "cloudy": 40, "partly cloudy": 30, "sunny": 20,
            "rainy": 8, "stormy": 2,
        },
    },
    "summer": {
        "wind": (12.0, 5.0, 3.0, 30.0),
        "wave": (0.4, 0.2, 0.05, 1.5),
        "conditions": {
            "sunny": 60, "partly cloudy": 25, "cloudy": 10,
            "rainy": 4, "stormy": 1,
        },
    },
    "habagat": {
        "wind": (30.0, 12.0, 8.0, 60.0),
        "wave": (1.2, 0.6, 0.2, 3.5),
        "conditions": {
            "rainy": 40, "cloudy": 25, "partly cloudy": 15,
            "stormy": 15, "sunny": 5,
        },
    },
}

CSV_COLUMNS = [
    "id", "wind_speed", "wave_height", "weather_condition",
    "is_safe", "recorded_at", "port_id",
]


def sample_clipped(params: tuple[float, float, float, float]) -> float:
    """Draw from a normal distribution and clamp to [lo, hi].

    Args:
        params: (mu, sigma, lo, hi).

    Returns:
        The clamped sample.
    """
    mu, sigma, lo, hi = params
    value = random.gauss(mu, sigma)
    return min(max(value, lo), hi)


def pick_condition(season: str) -> str:
    """Pick a weather condition string weighted for the season."""
    weights = SEASON_SPECS[season]["conditions"]
    names = list(weights.keys())
    probs = list(weights.values())
    return random.choices(names, weights=probs, k=1)[0]


def count_booking_dates() -> int:
    """Count unique depart dates in the bookings CSV (stdlib csv, no pandas).

    Returns:
        Number of distinct YYYY-MM-DD depart dates found (0 if file missing).
    """
    path = get_project_root() / "data" / "raw" / "synthetic_bookings.csv"
    dates: set[str] = set()
    try:
        with open(path, "r", encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                dates.add(row["depart_time"][:10])
    except FileNotFoundError:
        return 0
    return len(dates)


def main() -> None:
    """Generate synthetic weather rows and write the raw CSV."""
    random.seed(SEED)
    root = get_project_root()
    ports = load_config("ports.json")["ports"]
    days = list(date_range(DATE_START, DATE_END))

    out_path = root / "data" / "raw" / "synthetic_weather.csv"
    ensure_dir(out_path.parent)

    combos = [(port, day) for port in ports for day in days]
    rows: list[dict] = []
    for port, day in tqdm(
        combos, desc="Generating synthetic weather (v3.0)"
    ):
        season = get_season(day)
        spec = SEASON_SPECS[season]
        wind = round(sample_clipped(spec["wind"]), 1)
        wave = round(sample_clipped(spec["wave"]), 2)
        condition = pick_condition(season)
        is_safe = wave < 1.5 and wind < 35

        rows.append({
            "id": str(uuid.uuid4()),
            "wind_speed": wind,
            "wave_height": wave,
            "weather_condition": condition,
            "is_safe": is_safe,
            "recorded_at": f"{day.isoformat()}T12:00:00",
            "port_id": port["id"],
        })

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    total = len(rows)
    safe = sum(1 for r in rows if r["is_safe"])
    season_counts: dict[str, int] = {}
    condition_counts: dict[str, int] = {}
    for row in rows:
        season = get_season(date.fromisoformat(row["recorded_at"][:10]))
        season_counts[season] = season_counts.get(season, 0) + 1
        cond = row["weather_condition"]
        condition_counts[cond] = condition_counts.get(cond, 0) + 1

    print(f"Wrote {total} weather rows to {out_path}")
    print(f"Booking dates in Script 1 output (cross-check): "
          f"{count_booking_dates()} unique depart dates")
    print(f"By season: {season_counts}")
    print(f"By condition: {condition_counts}")
    print(f"Safe: {safe} ({safe / total * 100:.1f}%) | "
          f"Unsafe: {total - safe} ({(total - safe) / total * 100:.1f}%)")
    print("Sample (first 5 rows):")
    for row in rows[:5]:
        print(row)


if __name__ == "__main__":
    main()
