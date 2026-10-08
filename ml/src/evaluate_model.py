"""Script 6: evaluation report + defense charts (v1.0).

Reads:  models/demand_rf.pkl, models/train_metadata.json,
        data/processed/training_data.csv
Writes: output/metrics_report.txt,
        output/plots/actual_vs_predicted.png,
        output/plots/residuals.png,
        output/plots/monthly_demand.png,
        output/plots/feature_importance.png (refresh)

Rebuilds Script 5's exact chronological 80/20 split and scores the
saved winner on the held-out test dates. Imports the feature builders
straight from train_model so the two scripts can never drift apart.
"""

import json

import joblib
import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import (
    mean_absolute_error,
    mean_absolute_percentage_error,
    mean_squared_error,
    r2_score,
)

from src.train_model import build_features, load_data, plot_importance, split_chronological
from src.utils import ensure_dir, get_project_root


def metrics_block(y_true: pd.Series, y_pred: np.ndarray) -> dict[str, float]:
    """MAE / RMSE / R2 / MAPE (nonzero rows only), like Script 5."""
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = float(r2_score(y_true, y_pred))
    nonzero = y_true.to_numpy() > 0
    mape = (
        float(mean_absolute_percentage_error(y_true.to_numpy()[nonzero], y_pred[nonzero]))
        if nonzero.any()
        else float("nan")
    )
    return {"mae": mae, "rmse": rmse, "r2": r2, "mape": mape}


def save_plots(
    y_true: pd.Series, y_pred: np.ndarray, dates: pd.Series, out_dir
) -> None:
    """Actual-vs-predicted scatter, residual histogram, monthly bars."""
    res = y_true.to_numpy() - y_pred

    fig, ax = plt.subplots(figsize=(7, 7))
    ax.scatter(y_true, y_pred, alpha=0.3, s=12)
    lim = max(y_true.max(), y_pred.max()) * 1.05
    ax.plot([0, lim], [0, lim], "r--", lw=1)
    ax.set_xlabel("Actual demand (passengers)")
    ax.set_ylabel("Predicted demand (passengers)")
    ax.set_title("Actual vs Predicted — test set")
    fig.tight_layout()
    fig.savefig(out_dir / "actual_vs_predicted.png", dpi=150)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.hist(res, bins=40, edgecolor="black", alpha=0.7)
    ax.axvline(0, color="red", lw=1)
    ax.set_xlabel("Residual (actual − predicted)")
    ax.set_ylabel("Count")
    ax.set_title("Residual Distribution — test set")
    fig.tight_layout()
    fig.savefig(out_dir / "residuals.png", dpi=150)
    plt.close(fig)

    monthly = (
        pd.DataFrame({"date": dates, "actual": y_true.to_numpy(), "predicted": y_pred})
        .assign(month=lambda d: d["date"].dt.to_period("M").astype(str))
        .groupby("month")[["actual", "predicted"]]
        .sum()
    )
    fig, ax = plt.subplots(figsize=(10, 5))
    x = np.arange(len(monthly))
    ax.bar(x - 0.2, monthly["actual"], width=0.4, label="Actual")
    ax.bar(x + 0.2, monthly["predicted"], width=0.4, label="Predicted")
    ax.set_xticks(x)
    ax.set_xticklabels(monthly.index, rotation=45, ha="right", fontsize=8)
    ax.set_ylabel("Total passengers")
    ax.set_title("Monthly Demand — actual vs predicted (test set)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_dir / "monthly_demand.png", dpi=150)
    plt.close(fig)

    print(f"Plots saved to {out_dir}")


def main() -> None:
    """Score the saved model on the held-out test dates + write report."""
    root = get_project_root()
    with open(root / "models" / "train_metadata.json", encoding="utf-8") as f:
        meta = json.load(f)
    model = joblib.load(root / "models" / "demand_rf.pkl")

    df = load_data()
    train_df, test_df, cutoff = split_chronological(df)
    X_train, X_test, y_train, y_test, feature_columns = build_features(
        df, train_df, test_df
    )
    if len(X_test) == 0:
        print("No test rows — nothing to evaluate")
        return

    y_pred = model.predict(X_test)
    m = metrics_block(y_test, y_pred)

    lines = [
        "BangkaGo demand model — evaluation report",
        f"Generated: {pd.Timestamp.now().isoformat()}",
        f"Model: {meta.get('model_type')} trained {meta.get('trained_at')}",
        f"Split: cutoff {cutoff.date()} | train {len(X_train)} | test {len(X_test)}",
        "",
        f"R2:   {m['r2']:.4f}",
        f"MAE:  {m['mae']:.2f} passengers",
        f"RMSE: {m['rmse']:.2f} passengers",
        f"MAPE: {m['mape'] * 100:.2f}%  (zero-demand rows excluded)",
    ]
    report = "\n".join(lines)
    print(report)

    out_dir = root / "output"
    ensure_dir(out_dir)
    (out_dir / "metrics_report.txt").write_text(report + "\n", encoding="utf-8")
    save_plots(y_test, y_pred, test_df.loc[y_test.index, "date"], out_dir)
    plot_importance(model, feature_columns, model_name=meta.get("model_type", "model"))


if __name__ == "__main__":
    main()
