"""Script 4: engineer lag and rolling features (v3.0).

Reads:  data/processed/training_data.csv (35,088 rows, 15 cols)
Writes: data/processed/training_data.csv (overwrites: 33,648 rows, 20 cols)

Rules:
- Rows must be sorted by (route_id, date) before shifting, otherwise
  lag values cross routes.
- lag_1/lag_7/lag_30 are per-route shifts of daily_demand.
- rolling_7/rolling_30 are per-route means over the PRECEDING 7/30 days
  (x.shift(1).rolling(...) with min_periods equal to the window), so the
  first N rows per route are NaN. Windows are shifted back by 1 day to
  avoid target leakage (the target day's demand is never included).
- Dropping rows with any NaN lag/rolling removes exactly the first 30
  rows of every route (48 x 30 = 1,440) -> 701 days per route.
- Output keeps date as ISO string YYYY-MM-DD; rolling values rounded
  to 2 dp to match avg_passengers_per_booking.
"""

import pandas as pd

from src.utils import ensure_dir, get_project_root

EXPECTED_INPUT_ROWS = 35088
EXPECTED_OUTPUT_ROWS = 33648
LAG_SUBSET = ["lag_1", "lag_7", "lag_30", "rolling_7", "rolling_30"]
NEW_COLUMNS = ["lag_1", "lag_7", "lag_30", "rolling_7", "rolling_30"]

OUTPUT_COLUMNS = [
    "date", "route_id", "daily_demand", "booking_count",
    "avg_passengers_per_booking", "lag_1", "lag_7", "lag_30",
    "rolling_7", "rolling_30", "wind_speed", "wave_height",
    "weather_condition", "is_safe", "is_holiday", "day_of_week",
    "month", "is_weekend", "season", "year",
]


def load_data() -> pd.DataFrame:
    """Load training_data.csv and parse date for chronological sorting.

    The passenger_phone dtype guard is kept for schema stability even
    though Script 3's output has no such column (pandas ignores dtype
    keys for missing columns).

    Returns:
        Raw training DataFrame with a datetime date column.
    """
    root = get_project_root()
    path = root / "data" / "processed" / "training_data.csv"
    df = pd.read_csv(path, dtype={"passenger_phone": str})

    if len(df) != EXPECTED_INPUT_ROWS:
        print(f"WARNING: input rows = {len(df)}, "
              f"expected {EXPECTED_INPUT_ROWS} (source file may have changed)")
    already = [c for c in NEW_COLUMNS if c in df.columns]
    if already:
        print(f"WARNING: input already contains engineered columns {already} "
              f"— Script 4 appears to have been run before; re-running "
              f"will corrupt lag values")

    df["date"] = pd.to_datetime(df["date"])
    return df


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add per-route lag shifts and rolling means of daily_demand.

    Rolling windows look back only (shift(1) before rolling), so the
    current day's demand — the training target — is never included.

    Args:
        df: Training data sorted by (route_id, date).

    Returns:
        DataFrame with the 5 new feature columns.
    """
    df = df.sort_values(["route_id", "date"]).reset_index(drop=True)
    demand = df.groupby("route_id")["daily_demand"]
    df["lag_1"] = demand.shift(1)
    df["lag_7"] = demand.shift(7)
    df["lag_30"] = demand.shift(30)
    df["rolling_7"] = demand.transform(
        lambda x: x.shift(1).rolling(7, min_periods=7).mean()
    ).round(2)
    df["rolling_30"] = demand.transform(
        lambda x: x.shift(1).rolling(30, min_periods=30).mean()
    ).round(2)
    return df


def finalize(df: pd.DataFrame) -> pd.DataFrame:
    """Drop rows lacking history, cast types, restore ISO dates.

    Returns:
        Feature-complete DataFrame in the 20-column output order.
    """
    df = df.dropna(subset=LAG_SUBSET)
    for col in ("lag_1", "lag_7", "lag_30"):
        df[col] = df[col].astype("int64")
    df["date"] = df["date"].dt.strftime("%Y-%m-%d")
    return df[OUTPUT_COLUMNS]


def main() -> None:
    """Engineer features and overwrite training_data.csv."""
    df = load_data()
    input_rows = len(df)

    df = add_features(df)
    df = finalize(df)

    if len(df) != EXPECTED_OUTPUT_ROWS:
        print(f"WARNING: output rows = {len(df)}, "
              f"expected {EXPECTED_OUTPUT_ROWS}")
    nan_counts = df.isna().sum()
    if nan_counts.sum():
        print(f"WARNING: NaN remains in columns: "
              f"{dict(nan_counts[nan_counts > 0])}")

    out_path = get_project_root() / "data" / "processed" / "training_data.csv"
    ensure_dir(out_path.parent)
    df.to_csv(out_path, index=False)

    routes = df["route_id"].nunique()
    dates_per_route = df.groupby("route_id")["date"].nunique()

    print(f"Wrote {len(df)} rows x {df.shape[1]} cols to {out_path}")
    print("Rolling windows shifted back 1 day (target day's demand excluded)")
    print(f"Input rows: {input_rows} (expected {EXPECTED_INPUT_ROWS})")
    print(f"Output rows: {len(df)} (expected {EXPECTED_OUTPUT_ROWS})")
    print(f"Rows dropped: {input_rows - len(df)} (expected 1440)")
    print(f"Unique routes: {routes} (expected 48)")
    print(f"Dates per route: min {int(dates_per_route.min())}, "
          f"max {int(dates_per_route.max())} (expected 701)")
    print(f"Columns: {df.shape[1]} (expected 20)")
    print(f"NaN check (all columns): {int(nan_counts.sum())}")
    for col in NEW_COLUMNS:
        print(f"{col}: min {df[col].min()} | max {df[col].max()} | "
              f"mean {round(df[col].mean(), 2)}")
    print("Sample (first 5 rows):")
    for row in df.head(5).to_dict("records"):
        print(row)
    print("Sample (last 5 rows):")
    for row in df.tail(5).to_dict("records"):
        print(row)


if __name__ == "__main__":
    main()
