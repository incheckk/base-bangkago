"""Script 3: aggregate bookings into daily per-route demand (v3.0).

Reads:  data/raw/synthetic_bookings.csv, data/raw/synthetic_weather.csv,
        config/routes.json, config/holidays.json
Writes: data/processed/training_data.csv (48 routes x 731 days = 35,088 rows)

Rules:
- Full route x date grid: every route appears on every day, including
  no-sail days (daily_demand = 0) so lag/rolling features stay regular.
- Weather is LEFT JOINed on (date, start_port_id) — weather covers all
  731 days, bookings only 636, and the grid must survive either way.
- is_holiday comes from utils.is_holiday() (recurring MM-DD + special
  events), same logic as Script 1.
- Dates are written as ISO strings YYYY-MM-DD; avg_passengers_per_booking
  is rounded to 2 decimals.
"""

from datetime import date, timedelta

import pandas as pd

from src.utils import (
    ensure_dir,
    get_day_type,
    get_project_root,
    get_season,
    is_holiday,
    load_config,
)

DATE_START = date(2024, 1, 1)
# Mirrors Scripts 1-2 so the grid covers the prediction week (today..+6).
DATE_END = date.today() + timedelta(days=6)

OUTPUT_COLUMNS = [
    "date", "route_id", "daily_demand", "booking_count",
    "avg_passengers_per_booking", "wind_speed", "wave_height",
    "weather_condition", "is_safe", "is_holiday", "day_of_week",
    "month", "is_weekend", "season", "year",
]


def load_bookings() -> pd.DataFrame:
    """Load completed bookings and aggregate to (route_id, date) demand.

    passenger_phone is forced to str so pandas does not infer int64
    (the '+' sign would be lost — Script 1 verification warning W2).

    Returns:
        One row per (route_id, date) that had at least one booking.
    """
    root = get_project_root()
    path = root / "data" / "raw" / "synthetic_bookings.csv"
    df = pd.read_csv(path, dtype={"passenger_phone": str})
    df = df[df["trip_stat"] == "completed"].copy()

    df["depart_dt"] = pd.to_datetime(df["depart_time"])
    df["date"] = df["depart_dt"].dt.date

    grouped = (
        df.groupby(["route_id", "date"])
        .agg(
            daily_demand=("num_of_passenger", "sum"),
            booking_count=("num_of_passenger", "size"),
        )
        .reset_index()
    )
    grouped["avg_passengers_per_booking"] = (
        grouped["daily_demand"] / grouped["booking_count"]
    ).round(2)
    return grouped


def build_grid() -> tuple[pd.DataFrame, dict[str, str]]:
    """Build the full route x date grid.

    Returns:
        (grid DataFrame with route_id + date, route_id -> start_port_id map).
    """
    routes = load_config("routes.json")["routes"]
    route_ids = [r["id"] for r in routes]
    start_port = {r["id"]: r["start_port_id"] for r in routes}

    days = pd.date_range(DATE_START, DATE_END, freq="D").date
    grid = pd.MultiIndex.from_product(
        [route_ids, days], names=["route_id", "date"]
    ).to_frame(index=False)
    return grid, start_port


def join_weather(grid: pd.DataFrame, start_port: dict[str, str]) -> pd.DataFrame:
    """LEFT JOIN weather onto the grid via (date, start_port_id).

    Args:
        grid: route x date grid.
        start_port: route_id -> start_port_id lookup.

    Returns:
        Grid with wind_speed, wave_height, weather_condition, is_safe.
    """
    root = get_project_root()
    weather = pd.read_csv(root / "data" / "raw" / "synthetic_weather.csv")
    weather["date"] = pd.to_datetime(
        weather["recorded_at"].str[:10]
    ).dt.date
    weather = weather.rename(columns={"port_id": "start_port_id"})

    grid = grid.copy()
    grid["start_port_id"] = grid["route_id"].map(start_port)
    merged = grid.merge(
        weather[["date", "start_port_id", "wind_speed", "wave_height",
                 "weather_condition", "is_safe"]],
        on=["date", "start_port_id"],
        how="left",
    )
    return merged.drop(columns=["start_port_id"])


def add_holiday_flag(grid: pd.DataFrame) -> pd.DataFrame:
    """Add is_holiday using utils.is_holiday() for each unique date."""
    holidays = load_config("holidays.json")
    unique_dates = sorted(grid["date"].unique())
    flag = {d: is_holiday(d, holidays) for d in unique_dates}
    grid = grid.copy()
    grid["is_holiday"] = grid["date"].map(flag).astype(bool)
    return grid


def add_derived(grid: pd.DataFrame) -> pd.DataFrame:
    """Add day_of_week, month, is_weekend, season, year columns."""
    grid = grid.copy()
    dates = pd.to_datetime(grid["date"])
    grid["day_of_week"] = dates.dt.day_name()
    grid["month"] = dates.dt.month.astype(int)
    grid["is_weekend"] = dates.dt.dayofweek >= 5
    grid["season"] = grid["date"].map(get_season)
    grid["year"] = dates.dt.year.astype(int)
    return grid


def main() -> None:
    """Aggregate bookings, join weather/holidays, write training_data.csv."""
    root = get_project_root()

    bookings = load_bookings()
    total_bookings = int(bookings["booking_count"].sum())
    total_pax = int(bookings["daily_demand"].sum())

    grid, start_port = build_grid()
    merged = grid.merge(bookings, on=["route_id", "date"], how="left")
    merged["daily_demand"] = merged["daily_demand"].fillna(0).astype(int)
    merged["booking_count"] = merged["booking_count"].fillna(0).astype(int)
    merged["avg_passengers_per_booking"] = (
        merged["avg_passengers_per_booking"].fillna(0.0).round(2)
    )

    merged = join_weather(merged, start_port)
    merged = add_holiday_flag(merged)
    merged = add_derived(merged)

    merged["date"] = pd.to_datetime(merged["date"]).dt.strftime("%Y-%m-%d")
    merged = merged.sort_values(["route_id", "date"]).reset_index(drop=True)
    merged = merged[OUTPUT_COLUMNS]

    out_path = root / "data" / "processed" / "training_data.csv"
    ensure_dir(out_path.parent)
    merged.to_csv(out_path, index=False)

    weather_missing = int(merged["wind_speed"].isna().sum())
    zero = int((merged["daily_demand"] == 0).sum())
    positive = int((merged["daily_demand"] > 0).sum())
    safe = int(merged["is_safe"].sum())
    holiday_rows = int(merged["is_holiday"].sum())

    print(f"Wrote {len(merged)} rows to {out_path}")
    print(f"Unique routes: {merged['route_id'].nunique()} "
          f"(expected 48)")
    print(f"Unique dates: {merged['date'].nunique()} (expected 731)")
    print(f"Total bookings processed: {total_bookings} (expected 97940)")
    print(f"Total passengers: {total_pax} (expected 605255)")
    print(f"Rows with daily_demand = 0: {zero}")
    print(f"Rows with daily_demand > 0: {positive}")
    print(f"Safe rows: {safe} | Unsafe rows: {len(merged) - safe}")
    print(f"Holiday rows: {holiday_rows}")
    if weather_missing:
        print(f"WARNING: {weather_missing} rows missing weather (NaN)")
    season_counts = merged["season"].value_counts().to_dict()
    daytype = merged["day_of_week"].isin(
        ["Saturday", "Sunday"]
    ).value_counts()
    print(f"Rows by season: {season_counts}")
    print(f"Rows by day type: weekend={int(daytype.get(True, 0))}, "
          f"weekday={int(daytype.get(False, 0))}")
    print("Sample (first 10 rows):")
    for row in merged.head(10).to_dict("records"):
        print(row)


if __name__ == "__main__":
    main()
