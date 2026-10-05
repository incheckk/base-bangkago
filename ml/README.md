# BangkaGo ML Module

Random Forest demand prediction for BangkaGo sea travel routes.

## Setup
1. cd base-bangkago/ml
2. python -m venv venv
3. Windows: venv\Scripts\activate | Mac/Linux: source venv/bin/activate
4. pip install -r requirements.txt
5. Copy .env.example to .env and fill in real Supabase credentials

## Pipeline (run in order)
python -m src.generate_synthetic    # Step 1: synthetic bookings (v3.0)
python src/generate_weather.py      # Step 2: synthetic weather
python src/aggregate_demand.py      # Step 3: daily demand
python src/engineer_features.py     # Step 4: lag/rolling features
python src/train_model.py           # Step 5: train Random Forest
python src/evaluate_model.py        # Step 6: metrics + plots
python src/predict.py               # Step 7: future predictions
python src/export_sql.py            # Step 8: SQL for Supabase

## Key parameters (from bangkero interviews, v3.0)
- 10 ports: 4 mainland (Marigondon main, Angasil, Hilton, Maribago) + 6 islands
- 48 routes (4 mainland x 6 islands x 2 directions), route ID `{start}__{end}`
- Weekday: 5–15 pax/trip, 1–2 trips/day
- Weekend: 12–22 pax/trip, 3 trips/day
- Boat capacity: medium 15 (60%) / large 25 (40%), random per trip
- Peak hour: 9–10 AM (highest weight)
- Fare: ₱100 per passenger (flat)
- Island hopping: ₱3,500 (medium) / ₱7,000 (large), 1–2 per week
- Seasons: Amihan (Dec–Feb, 15% no-sail), Summer (Mar–May, 1.7%), Habagat (Jun–Nov, 18.3%)
- Holidays: Pasko 2×, NY 2×, Holy Week 2.5×, All Saints 2.5×, Fiesta sa Opon 2×
