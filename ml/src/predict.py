"""Script 7: next-week demand predictions per route (v1.0).

Reads:  models/demand_rf.pkl, models/train_metadata.json,
        data/processed/training_data.csv
Writes: data/predictions/predictions.csv (dates today .. today+6)

How it predicts without recursion: Scripts 1-4 generate the route x
date grid through today+6, so the engineered features (lag/rolling/
weather/calendar) for those dates already exist from real history.
Script 5's chronological split holds out the last 20% of dates — which
covers this window — so scoring them is honest: the model never fit
on them.

confidence_score is left empty on purpose: a RandomForest gives no
calibrated uncertainty, and inventing a number would be a lie the app
displays.
"""

import json
from datetime import date, timedelta

import joblib
import numpy as np
import pandas as pd

from src.train_model import CATEGORICALS, EXCLUDED_FEATURES
from src.utils import ensure_dir, get_project_root

OUTPUT_COLUMNS = [
    "prediction_date", "route_id", "day_of_week", "hour_of_day",
    "is_weekend", "is_holiday", "previous_demand",
    "avg_demand_last_7_days", "avg_demand_last_30_days",
    "predicted_passengers",
]


def main() -> None:
    """Score today..+6 rows and write predictions.csv."""
    root = get_project_root()

    with open(root / "models" / "train_metadata.json", encoding="utf-8") as f:
        feature_columns = json.load(f)["feature_columns"]
    model = joblib.load(root / "models" / "demand_rf.pkl")

    df = pd.read_csv(root / "data" / "processed" / "training_data.csv")
    df["date"] = pd.to_datetime(df["date"])

    start, end = date.today(), date.today() + timedelta(days=6)
    window = df[
        (df["date"].dt.date >= start) & (df["date"].dt.date <= end)
    ].copy()
    if window.empty:
        print(f"WARNING: no training rows for {start}..{end} — re-run Scripts 1-5")
        ensure_dir(root / "data" / "predictions")
        pd.DataFrame(columns=OUTPUT_COLUMNS).to_csv(
            root / "data" / "predictions" / "predictions.csv", index=False
        )
        return

    X = pd.get_dummies(
        window.drop(columns=["date", "daily_demand"] + EXCLUDED_FEATURES),
        columns=CATEGORICALS,
    ).reindex(columns=feature_columns, fill_value=0)

    nan_rows = X.isna().any(axis=1)
    if nan_rows.any():
        print(f"WARNING: dropping {int(nan_rows.sum())} rows with NaN features")
        X = X[~nan_rows]
        window = window.loc[X.index]

    preds = np.clip(np.round(model.predict(X)), 0, None).astype(int)

    out = pd.DataFrame({
        "prediction_date": window["date"].dt.strftime("%Y-%m-%d"),
        "route_id": window["route_id"],
        "day_of_week": window["day_of_week"],
        "hour_of_day": 0,
        "is_weekend": window["is_weekend"].astype(bool),
        "is_holiday": window["is_holiday"].astype(bool),
        "previous_demand": window["lag_1"].astype(int),
        "avg_demand_last_7_days": window["rolling_7"].round(2),
        "avg_demand_last_30_days": window["rolling_30"].round(2),
        "predicted_passengers": preds,
    })[OUTPUT_COLUMNS].sort_values(["prediction_date", "route_id"])

    path = root / "data" / "predictions" / "predictions.csv"
    ensure_dir(path.parent)
    out.to_csv(path, index=False)

    print(f"Wrote {len(out)} predictions to {path}")
    print(f"Dates: {out['prediction_date'].min()} .. {out['prediction_date'].max()}")
    print(f"Routes: {out['route_id'].nunique()}")
    print(f"Predicted pax: min {out['predicted_passengers'].min()} | "
          f"max {out['predicted_passengers'].max()} | "
          f"mean {out['predicted_passengers'].mean():.1f}")


if __name__ == "__main__":
    main()
