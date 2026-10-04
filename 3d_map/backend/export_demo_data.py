"""
Snapshot the registry as static files for the frontend-only hosted demo.

    cd 3d_map/backend
    python export_demo_data.py

Writes 3d_map/frontend/public/demo/{buildings,units,sessions}.json from the database
(re-run it whenever the data changes, then rebuild with `npm run build:demo`).
"""
import json
import os

from app.postgis import fetch_all_units, fetch_buildings, list_sessions

OUT = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "demo")


def rounded(o, nd=7):
    """Trim coordinates to ~1 cm so the files stay small."""
    if isinstance(o, float):
        return round(o, nd)
    if isinstance(o, list):
        return [rounded(x, nd) for x in o]
    if isinstance(o, dict):
        return {k: rounded(v, nd) for k, v in o.items()}
    return o


def main():
    os.makedirs(OUT, exist_ok=True)
    fc = fetch_buildings()
    units = fetch_all_units()  # includes unit_ulpin_checked
    sessions = list_sessions()
    for name, data in (("buildings", rounded(fc)), ("units", rounded(units)), ("sessions", sessions)):
        path = os.path.join(OUT, f"{name}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"), default=str)
        print(f"{name}.json  {os.path.getsize(path) / 1e6:.2f} MB")
    print(f"{len(fc['features'])} buildings, {len(units)} units, {len(sessions)} sessions")


if __name__ == "__main__":
    main()
