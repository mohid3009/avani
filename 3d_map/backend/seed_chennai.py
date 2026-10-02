"""
Load the Chennai · T. Nagar city (Google Open Buildings footprints) into the
database as its own scan session, then generate ULPIN units for a slice of
multi-storey buildings so citizens own registered units out of the box.

    cd 3d_map/backend
    python seed_chennai.py            # 40 buildings get units
    python seed_chennai.py --units 0  # buildings only

Safe to re-run: buildings are upserted, buildings that already have units keep them.
"""
import argparse
import json
import os

from app.main import ulpin_units_for_building
from app.postgis import fetch_units, save_buildings

SESSION_ID = "chennai-t-nagar"
LABEL = "Chennai · T. Nagar — Google Open Buildings"
DATA = os.path.join(os.path.dirname(__file__), "seed", "chennai_buildings.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--units", type=int, default=40, help="buildings to pre-generate units for")
    args = ap.parse_args()

    with open(DATA, encoding="utf-8") as f:
        fc = json.load(f)
    n = save_buildings(fc, SESSION_ID, label=LABEL, mode="osm", crs="EPSG:4326", reconcile=True)
    print(f"buildings in session {SESSION_ID}: {n}")

    # tallest first: they carry the most units per building
    tall = sorted(fc["features"], key=lambda f: -(f["properties"].get("stories") or 1))
    made = 0
    for feat in tall[: args.units]:
        bid = feat["properties"]["building_id"]
        if not fetch_units(bid):
            ulpin_units_for_building(bid)
            made += 1
    print(f"generated units for {made} building(s)")


if __name__ == "__main__":
    main()
