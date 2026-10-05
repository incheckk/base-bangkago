"""
Diagnostic: What's the ceiling R² for our synthetic demand data?
Trains 5 baseline models to understand where 0.42 comes from.
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score, mean_absolute_error
from src.utils import get_project_root

# Load
df = pd.read_csv(get_project_root() / "data/processed/training_data.csv")
df['date'] = pd.to_datetime(df['date'])
df = df.sort_values('date')

# Chronological split (same as Script 5)
cutoff = df['date'].quantile(0.8)
train = df[df['date'] <= cutoff]
test = df[df['date'] > cutoff]

print(f"Train: {len(train)} rows | Test: {len(test)} rows")
print(f"Cutoff: {cutoff.date()}")
print()

y_train = train['daily_demand']
y_test = test['daily_demand']

# Baseline evaluation helper
def evaluate(name, features_train, features_test):
    model = RandomForestRegressor(n_estimators=100, max_depth=15, random_state=42, n_jobs=-1)
    model.fit(features_train, y_train)
    preds = model.predict(features_test)
    r2 = r2_score(y_test, preds)
    mae = mean_absolute_error(y_test, preds)
    print(f"{name:45s} | R² = {r2:.4f} | MAE = {mae:.2f}")
    return r2

print("=== DIAGNOSTIC RESULTS ===")
print()

# Baseline 1: Weekend only
evaluate("Baseline 1: is_weekend only",
         train[['is_weekend']],
         test[['is_weekend']])

# Baseline 2: Weekend + rolling_30
evaluate("Baseline 2: is_weekend + rolling_30",
         train[['is_weekend', 'rolling_30']],
         test[['is_weekend', 'rolling_30']])

# Baseline 3: Weekend + rolling_30 + rolling_7
evaluate("Baseline 3: + rolling_7",
         train[['is_weekend', 'rolling_30', 'rolling_7']],
         test[['is_weekend', 'rolling_30', 'rolling_7']])

# Baseline 4: All numeric features (no one-hot)
numeric_cols = ['is_weekend', 'rolling_30', 'rolling_7', 'lag_1', 'lag_7',
                'lag_30', 'month', 'wind_speed', 'wave_height', 'is_safe',
                'is_holiday', 'year']
evaluate("Baseline 4: All numeric (no one-hot)",
         train[numeric_cols],
         test[numeric_cols])

# Baseline 5: Just the mean (predict average)
mean_pred = np.full(len(y_test), y_train.mean())
r2_mean = r2_score(y_test, mean_pred)
mae_mean = mean_absolute_error(y_test, mean_pred)
print(f"{'Baseline 5: Predict train mean (no model)':45s} | R² = {r2_mean:.4f} | MAE = {mae_mean:.2f}")

print()
print("=== INTERPRETATION ===")
print("- If Baselines 1-4 hover near 0.40-0.45 -> data is noisy, current model is near ceiling")
print("- If Baselines 1-4 are much lower -> current model IS adding value")
print("- Compare against your Script 5 model: R² = 0.4204 (all 75 features)")
