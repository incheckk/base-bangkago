"""Script 5: train and compare demand models (v4.0 — RF vs GB shootout).

Reads:  data/processed/training_data.csv (33,648 rows x 20 cols),
        config/model_params.json
Writes: models/demand_rf.pkl, models/train_metadata.json,
        output/plots/feature_importance.png

Rules:
- Chronological 80/20 split by date — never shuffle time series data.
- One-hot encode route_id, weather_condition, day_of_week, season
  (get_dummies computed once on the full frame so train/test share
  identical columns), feature list stored in metadata for Script 7.
- RMSE uses sqrt(mean_squared_error(...)) because the `squared=`
  keyword was removed in scikit-learn 1.6 (installed: 1.9.1).
- MAPE is computed only on rows where daily_demand > 0 (zero-demand
  days make MAPE undefined; sklearn would return ~1e15%). The number
  of excluded rows is reported.

- booking_count and avg_passengers_per_booking are EXCLUDED from X:
  both are derived from the target (daily_demand / its booking count),
  so including them is target leakage. Expected feature count: 75.

- Two candidates, winner by test R2 (both random_state=42):
  RandomForest (grid: n_estimators=[500]) vs GradientBoosting
  (n_estimators=500, lr=0.1, max_depth=5). Winner overwrites
  models/demand_rf.pkl so downstream scripts keep working.

W1 leakage note: resolved. rolling_7/rolling_30 are shifted back 1 day
(Script 4 fix) and no longer include the target day's demand.
"""

import json
import time
import warnings
from datetime import datetime

import joblib
import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import (
    mean_absolute_error,
    mean_absolute_percentage_error,
    mean_squared_error,
    r2_score,
)
from sklearn.model_selection import GridSearchCV

from src.utils import ensure_dir, get_project_root, load_config

warnings.filterwarnings("ignore")

TEST_SIZE = 0.2
RANDOM_STATE = 42
RF_ESTIMATORS = 500
GB_ESTIMATORS = 500
GB_LEARNING_RATE = 0.1
GB_MAX_DEPTH = 5
EXPECTED_ROWS = 33648
SLOW_GRID_WARN_S = 600
CATEGORICALS = ["route_id", "weather_condition", "day_of_week", "season"]
TARGET = "daily_demand"
# Derived from the target -> excluded from the feature set (leakage).
EXCLUDED_FEATURES = ["booking_count", "avg_passengers_per_booking"]


def load_data() -> pd.DataFrame:
    """Load training data, parse and sort dates chronologically.

    Returns:
        DataFrame sorted by date ascending.
    """
    root = get_project_root()
    path = root / "data" / "processed" / "training_data.csv"
    df = pd.read_csv(path)
    if len(df) != EXPECTED_ROWS:
        print(f"WARNING: input rows = {len(df)}, expected {EXPECTED_ROWS}")
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date").reset_index(drop=True)


def split_chronological(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.Timestamp]:
    """Split at the 80th-percentile date (no shuffling).

    Returns:
        (train_df, test_df, cutoff_date) with train = date <= cutoff.
    """
    unique_dates = np.sort(df["date"].unique())
    cutoff = pd.Timestamp(unique_dates[int((1 - TEST_SIZE) * len(unique_dates))])
    train_df = df[df["date"] <= cutoff]
    test_df = df[df["date"] > cutoff]
    return train_df, test_df, cutoff


def build_features(
    df: pd.DataFrame, train_df: pd.DataFrame, test_df: pd.DataFrame
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series, list[str]]:
    """One-hot encode features once, then slice by the split indices.

    booking_count and avg_passengers_per_booking are excluded from X
    (both are derived from the target — target leakage).

    Returns:
        (X_train, X_test, y_train, y_test, feature_columns).
    """
    y = df[TARGET]
    X = pd.get_dummies(
        df.drop(columns=["date", TARGET] + EXCLUDED_FEATURES),
        columns=CATEGORICALS,
    )
    print(f"Excluded features (target leakage): {EXCLUDED_FEATURES}")

    nan_rows = X.isna().any(axis=1)
    if nan_rows.any():
        print(f"WARNING: {int(nan_rows.sum())} rows have NaN features — dropping")
        X = X[~nan_rows]
        y = y.loc[X.index]

    X_train = X.loc[X.index.isin(train_df.index)]
    X_test = X.loc[X.index.isin(test_df.index)]
    y_train = y.loc[X_train.index]
    y_test = y.loc[X_test.index]
    return X_train, X_test, y_train, y_test, list(X.columns)


def run_grid_search(
    X_train: pd.DataFrame, y_train: pd.Series
) -> tuple[RandomForestRegressor, dict, int, int]:
    """Tune the RandomForest with GridSearchCV per config/model_params.json.

    Returns:
        (best_model, best_params, n_combos, cv_folds).
    """
    params = load_config("model_params.json")
    grid_cfg = params["grid_search"]

    if not grid_cfg.get("enabled", True):
        model = RandomForestRegressor(**params["random_forest"])
        model.fit(X_train, y_train)
        return model, dict(params["random_forest"]), 1, 0

    param_grid = grid_cfg["param_grid"]
    n_combos = 1
    for values in param_grid.values():
        n_combos *= len(values)
    cv = int(grid_cfg.get("cv", 3))

    search = GridSearchCV(
        estimator=RandomForestRegressor(random_state=RANDOM_STATE, n_jobs=-1),
        param_grid=param_grid,
        cv=cv,
        scoring=grid_cfg.get("scoring", "neg_mean_absolute_error"),
        n_jobs=-1,
        verbose=1,
    )
    start = time.time()
    search.fit(X_train, y_train)
    elapsed = time.time() - start
    if elapsed > SLOW_GRID_WARN_S:
        print(f"WARNING: grid search took {elapsed:.0f}s "
              f"(> {SLOW_GRID_WARN_S}s)")
    return search.best_estimator_, dict(search.best_params_), n_combos, cv


def train_gradient_boosting(
    X_train: pd.DataFrame, y_train: pd.Series
) -> GradientBoostingRegressor:
    """Fit a GradientBoostingRegressor challenger (fixed hyperparams).

    Returns:
        Fitted GradientBoostingRegressor.
    """
    print("\n=== Training GradientBoostingRegressor ===")
    print(f"Params: n_estimators={GB_ESTIMATORS}, "
          f"learning_rate={GB_LEARNING_RATE}, max_depth={GB_MAX_DEPTH}")
    model = GradientBoostingRegressor(
        n_estimators=GB_ESTIMATORS,
        learning_rate=GB_LEARNING_RATE,
        max_depth=GB_MAX_DEPTH,
        random_state=RANDOM_STATE,
        verbose=1,
    )
    start = time.time()
    model.fit(X_train, y_train)
    print(f"GradientBoosting fit took {time.time() - start:.0f}s")
    return model


def evaluate(
    model: RandomForestRegressor | GradientBoostingRegressor,
    X_test: pd.DataFrame, y_test: pd.Series,
    label: str = "test set",
) -> dict[str, float]:
    """Compute MAE, RMSE, R2 and MAPE on the test set.

    MAPE uses only rows with daily_demand > 0 (zero targets make the
    metric undefined).

    Returns:
        Dict with mae, rmse, r2, mape keys.
    """
    y_pred = model.predict(X_test)
    mae = float(mean_absolute_error(y_test, y_pred))
    # sklearn >= 1.6 removed mean_squared_error(squared=False)
    rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
    r2 = float(r2_score(y_test, y_pred))

    nonzero = y_test.to_numpy() > 0
    if nonzero.any():
        mape = float(mean_absolute_percentage_error(
            y_test.to_numpy()[nonzero], y_pred[nonzero]
        ))
    else:
        mape = float("nan")
    excluded = int((~nonzero).sum())

    print(f"Metrics on {label}:")
    print(f"  MAE:  {mae:.2f} passengers")
    print(f"  RMSE: {rmse:.2f} passengers")
    print(f"  R2:   {r2:.4f}")
    print(f"  MAPE: {mape * 100:.2f}%  (zero-demand rows excluded: "
          f"{excluded} of {len(y_test)})")
    if r2 < 0:
        print("WARNING: R2 is negative — model is worse than predicting "
              "the mean")
    elif r2 < 0.3:
        print("WARNING: R2 is very low (< 0.3)")
    print("Note: rolling_7/rolling_30 are shifted back 1 day and "
          "booking stats are excluded — no target leakage")
    return {"mae": mae, "rmse": rmse, "r2": r2, "mape": mape}


def save_artifacts(
    model: RandomForestRegressor | GradientBoostingRegressor,
    best_params: dict,
    metrics: dict[str, float],
    feature_columns: list[str],
    n_train: int,
    n_test: int,
    model_type: str,
    comparison: dict,
) -> None:
    """Save the winning model pickle, metadata JSON, and print paths."""
    root = get_project_root()
    models_dir = root / "models"
    ensure_dir(models_dir)

    model_path = models_dir / "demand_rf.pkl"
    joblib.dump(model, model_path)

    metadata = {
        "trained_at": datetime.now().isoformat(),
        "model_type": model_type,
        "n_features": len(feature_columns),
        "n_train": n_train,
        "n_test": n_test,
        "best_params": best_params,
        "metrics": metrics,
        "feature_columns": feature_columns,
        "comparison": comparison,
    }
    meta_path = models_dir / "train_metadata.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"Model saved to: {model_path}")
    print(f"Metadata saved to: {meta_path}")


def plot_importance(
    model: RandomForestRegressor | GradientBoostingRegressor,
    feature_columns: list[str],
    model_name: str = "RandomForest",
) -> None:
    """Save a horizontal bar chart of the top 10 feature importances."""
    root = get_project_root()
    plots_dir = root / "output" / "plots"
    ensure_dir(plots_dir)

    importances = model.feature_importances_
    order = np.argsort(importances)[::-1][:10]
    top = [(feature_columns[i], float(importances[i]))
           for i in reversed(order)]  # ascending -> largest drawn on top

    print("Top 10 features:")
    for name, score in reversed(top):
        print(f"  {name}: {score:.4f}")

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.barh([name for name, _ in top], [score for _, score in top])
    ax.set_xlabel("Importance")
    ax.set_title(f"Top 10 Feature Importances — {model_name} (v4.0)")
    fig.tight_layout()
    out_path = plots_dir / "feature_importance.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Plot saved to: {out_path}")


def main() -> None:
    """Train RF + GB candidates, save the higher-R2 winner."""
    df = load_data()
    train_df, test_df, cutoff = split_chronological(df)
    X_train, X_test, y_train, y_test, feature_columns = build_features(
        df, train_df, test_df
    )

    print(f"Data loaded: {len(df)} rows, {len(feature_columns)} features")
    print(f"Split: cutoff {cutoff.date()} | train {len(X_train)} | "
          f"test {len(X_test)} | test share "
          f"{len(X_test) / len(df) * 100:.1f}% (TEST_SIZE={TEST_SIZE})")

    rf_model, rf_params, n_combos, cv = run_grid_search(X_train, y_train)
    if cv > 0:
        print(f"Grid search: {n_combos} combinations x {cv} folds = "
              f"{n_combos * cv} fits")
    else:
        print("Grid search: disabled in config — base model fitted")
    print(f"RF best params: {rf_params}")

    print("\n=== RandomForest Results ===")
    rf_metrics = evaluate(rf_model, X_test, y_test, label="test set (RF)")
    rf_r2 = rf_metrics["r2"]

    gb_model = train_gradient_boosting(X_train, y_train)
    print("\n=== GradientBoosting Results ===")
    gb_metrics = evaluate(gb_model, X_test, y_test, label="test set (GB)")
    gb_r2 = gb_metrics["r2"]
    print(f"  MAE:  {gb_metrics['mae']:.2f}")
    print(f"  RMSE: {gb_metrics['rmse']:.2f}")
    print(f"  R2:   {gb_r2:.4f}")

    gb_params = {
        "n_estimators": GB_ESTIMATORS,
        "learning_rate": GB_LEARNING_RATE,
        "max_depth": GB_MAX_DEPTH,
        "random_state": RANDOM_STATE,
    }

    print("\n=== Side-by-side ===")
    print(f"  RF R2: {rf_r2:.4f}")
    print(f"  GB R2: {gb_r2:.4f}")

    if gb_r2 > rf_r2:
        print(f"\n*** GradientBoosting wins: R2={gb_r2:.4f} "
              f"vs RF R2={rf_r2:.4f} ***")
        best_model, best_params = gb_model, gb_params
        best_metrics, best_name = gb_metrics, "GradientBoostingRegressor"
        winner = "GB"
    else:
        print(f"\n*** RandomForest wins: R2={rf_r2:.4f} "
              f"vs GB R2={gb_r2:.4f} ***")
        best_model, best_params = rf_model, rf_params
        best_metrics, best_name = rf_metrics, "RandomForestRegressor"
        winner = "RF"

    comparison = {"rf_r2": rf_r2, "gb_r2": gb_r2, "winner": winner}
    save_artifacts(
        best_model, best_params, best_metrics, feature_columns,
        len(X_train), len(X_test),
        model_type=best_name, comparison=comparison,
    )
    plot_importance(best_model, feature_columns, model_name=best_name)


if __name__ == "__main__":
    main()
