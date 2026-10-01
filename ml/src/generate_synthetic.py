"""Script 1: generate 2 years of synthetic booking data.

Reads:  config/ports.json, config/routes.json, config/holidays.json
Writes: data/raw/synthetic_bookings.csv (~50k rows)

Rules (locked from bangkero interviews, Option A):
- trip_stat is always 'completed'; cancellations are modelled as
  whole no-sail days skipped by season probability.
- Fare is a flat PHP 70 per passenger.
"""

import csv
import math
import random
import string
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from tqdm import tqdm

from src.utils import (
    date_range,
    ensure_dir,
    get_day_type,
    get_holiday_multiplier,
    get_project_root,
    get_season,
    load_config,
)

DATE_START = date(2024, 1, 1)
DATE_END = date(2025, 12, 31)
FARE_PER_HEAD = 70
BANGKA_CAPACITY = 15
NO_SAIL_PROB = {"amihan": 0.117, "summer": 0.017, "habagat": 0.183}
PEAK_HOURS_WEIGHTS = {
    7: 3, 8: 3, 9: 3, 10: 3, 11: 2, 12: 2,
    13: 1, 14: 1, 15: 1, 16: 1, 17: 1, 18: 1,
}
ISLAND_HOPPING_PRICE_MIN = 3000
ISLAND_HOPPING_PRICE_MAX = 3500

FIRST_NAMES = [
    "Juan", "Maria", "Jose", "Ana", "Pedro", "Rosa", "Miguel", "Luz",
    "Ramon", "Carmen", "Daniel", "Grace", "Marco", "Liza", "Paolo",
    "Jenny", "Rafael", "Bianca", "Carlos", "Nena",
]
LAST_NAMES = [
    "Dela Cruz", "Santos", "Reyes", "Bautista", "Ocampo", "Garcia",
    "Mendoza", "Torres", "Tomas", "Andrada", "Castillo", "Flores",
    "Villanueva", "Ramos", "Aquino", "Navarro", "Salazar", "Mercado",
    "Aguilar", "Cortez",
]
BOAT_NAMES = [
    "MBCA Sto. Niño", "MBCA Bantay Dagat", "MBCA Santa Rosa",
    "MBCA Maribago Queen", "MBCA Caohagan Star", "MBCA Nalusuan Express",
]

CSV_COLUMNS = [
    "id", "ref", "service_type", "num_of_passenger", "trip_stat",
    "created_at", "depart_time", "arrival_time", "total_price",
    "route_id", "from_port_name", "to_port_name", "passenger_name",
    "passenger_phone", "user_id", "operator_id", "operator_name",
    "operator_boat_name",
]


def generate_booking_ref() -> str:
    """Return a ref like 'BGO-A1B2C3'."""
    chars = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"BGO-{chars}"


def generate_filipino_name() -> str:
    """Return a random Filipino-style full name."""
    return f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"


def generate_phone() -> str:
    """Return a +639XXXXXXXXX-format phone number."""
    return "+639" + "".join(random.choices(string.digits, k=9))


def generate_boat_name() -> str:
    """Return a random bangka name."""
    return random.choice(BOAT_NAMES)


def pick_booking_hour() -> int:
    """Pick an operating hour weighted toward morning peaks."""
    hours = list(PEAK_HOURS_WEIGHTS.keys())
    weights = list(PEAK_HOURS_WEIGHTS.values())
    return random.choices(hours, weights=weights, k=1)[0]


def build_booking_row(
    trip_day: date,
    route: dict,
    port_lookup: dict,
    num_passengers: int,
    service_type: str,
    total_price: int,
) -> dict:
    """Build one CSV row for a booking on the given trip day."""
    hour = pick_booking_hour()
    minute = random.randint(0, 59)
    depart_dt = datetime(trip_day.year, trip_day.month, trip_day.day, hour, minute)
    estimated = int(route.get("estimated_minutes", 20))
    arrival_dt = depart_dt + timedelta(minutes=estimated)

    if random.random() < 0.8:  # 80% advance booking, 2–3 days before
        created_dt = depart_dt - timedelta(days=random.randint(2, 3))
    else:  # 20% walk-in, same day shortly before departure
        created_dt = depart_dt - timedelta(minutes=random.randint(5, 120))

    return {
        "id": str(uuid.uuid4()),
        "ref": generate_booking_ref(),
        "service_type": service_type,
        "num_of_passenger": num_passengers,
        "trip_stat": "completed",
        "created_at": created_dt.isoformat(),
        "depart_time": depart_dt.isoformat(),
        "arrival_time": arrival_dt.isoformat(),
        "total_price": total_price,
        "route_id": route["id"],
        "from_port_name": port_lookup[route["start_port_id"]],
        "to_port_name": port_lookup[route["end_port_id"]],
        "passenger_name": generate_filipino_name(),
        "passenger_phone": generate_phone(),
        "user_id": str(uuid.uuid4()),
        "operator_id": str(uuid.uuid4()),
        "operator_name": generate_filipino_name(),
        "operator_boat_name": generate_boat_name(),
    }


def split_into_bookings(pax: int) -> list[int]:
    """Split a trip's passenger total into booking-size chunks of 5–9."""
    booking_size = random.randint(5, 9)
    num_bookings = max(1, math.ceil(pax / booking_size))
    base, remainder = divmod(pax, num_bookings)
    return [base + (1 if i < remainder else 0) for i in range(num_bookings)]


def main() -> None:
    """Generate synthetic bookings and write the raw CSV."""
    random.seed(42)
    root = get_project_root()
    ports = load_config("ports.json")["ports"]
    routes = load_config("routes.json")["routes"]
    holidays = load_config("holidays.json")
    port_lookup = {p["id"]: p["name"] for p in ports}

    out_path = root / "data" / "raw" / "synthetic_bookings.csv"
    ensure_dir(out_path.parent)

    rows: list[dict] = []
    season_counts: dict[str, int] = {"amihan": 0, "summer": 0, "habagat": 0}
    day_type_counts: dict[str, int] = {"weekday": 0, "weekend": 0}
    island_hopping_due = 0

    days = list(date_range(DATE_START, DATE_END))
    for trip_day in tqdm(days, desc="Generating synthetic bookings"):
        season = get_season(trip_day)
        day_type = get_day_type(trip_day)
        if random.random() < NO_SAIL_PROB[season]:
            continue  # no-sail day: no bookings at all

        holiday_mult = get_holiday_multiplier(trip_day, holidays)

        for route in routes:
            num_trips = random.randint(1, 2) if day_type == "weekday" else 3
            for _ in range(num_trips):
                base_pax = (
                    random.randint(5, 8)
                    if day_type == "weekday"
                    else random.randint(12, 15)
                )
                adjusted = int(base_pax * holiday_mult)
                pax = min(adjusted, BANGKA_CAPACITY)
                for chunk in split_into_bookings(pax):
                    rows.append(
                        build_booking_row(
                            trip_day, route, port_lookup, chunk,
                            "passenger", FARE_PER_HEAD * chunk,
                        )
                    )
                    season_counts[season] += chunk
                    day_type_counts[day_type] += chunk

        # Island hopping: ~2–4 per week total across bangkeros.
        island_hopping_due += 1
        if island_hopping_due >= 7:
            island_hopping_due = 0
            for _ in range(random.randint(2, 4)):
                hop_day = trip_day - timedelta(days=random.randint(0, 6))
                if hop_day < DATE_START:
                    continue
                hop_pax = random.randint(10, BANGKA_CAPACITY)
                hop_route = random.choice(routes)
                hop_price = random.randint(
                    ISLAND_HOPPING_PRICE_MIN, ISLAND_HOPPING_PRICE_MAX
                )
                rows.append(
                    build_booking_row(
                        hop_day, hop_route, port_lookup, hop_pax,
                        "island_hopping", hop_price,
                    )
                )
                hop_season = get_season(hop_day)
                season_counts[hop_season] += hop_pax
                day_type_counts[get_day_type(hop_day)] += hop_pax

    rows.sort(key=lambda r: r["created_at"])
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    total_pax = sum(r["num_of_passenger"] for r in rows)
    total_revenue = sum(int(r["total_price"]) for r in rows)
    print(f"Wrote {len(rows)} bookings to {out_path}")
    print(f"Total passengers: {total_pax}")
    print(f"Total revenue: PHP {total_revenue}")
    print(f"By season: {season_counts}")
    print(f"By day type: {day_type_counts}")
    print("Sample (first 10 rows):")
    for row in rows[:10]:
        print(row)


if __name__ == "__main__":
    main()
