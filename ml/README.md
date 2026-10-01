# BangkaGo ML Module

Random Forest demand prediction for BangkaGo sea travel routes.

## Setup
1. cd base-bangkago/ml
2. python -m venv venv
3. Windows: venv\Scripts\activate | Mac/Linux: source venv/bin/activate
4. pip install -r requirements.txt
5. Copy .env.example to .env and fill in real Supabase credentials

## Pipeline (run in order)
python src/generate_synthetic.py    # Step 1: synthetic bookings
python src/generate_weather.py      # Step 2: synthetic weather
python src/aggregate_demand.py      # Step 3: daily demand
python src/engineer_features.py     # Step 4: lag/rolling features
python src/train_model.py           # Step 5: train Random Forest
python src/evaluate_model.py        # Step 6: metrics + plots
python src/predict.py               # Step 7: future predictions
python src/export_sql.py            # Step 8: SQL for Supabase

## Key parameters (from bangkero interviews)
- Weekday: 5–8 pax/trip, 1–2 trips/day
- Weekend: 12–15 pax/trip, 3 trips/day
- Peak hour: 9–10 AM
- Fare: ₱70 per passenger
- Seasons: Amihan (Dec–Feb), Summer (Mar–May), Habagat (Jun–Nov)
- Holidays: Pasko 2.1×, NY 2×, Holy Week 1.5×, All Saints 1.5×, Fiesta sa Opon 2×
