"""
Replace estimated building heights with Google Open Buildings 2.5D heights.

Dataset: GOOGLE/Research/open-buildings-temporal/v1 (Earth Engine) — yearly
4 m rasters for South Asia incl. India; band `building_height` in metres.
For every footprint we take the median height of the pixels inside it.

One-time setup (your own Google account):
    pip install earthengine-api
    earthengine authenticate
    # an Earth Engine-enabled Google Cloud project is required:
    # https://developers.google.com/earth-engine/guides/access

Run:
    cd 3d_map/backend
    python heights_open_buildings.py --project YOUR_GCP_PROJECT              # Chennai session
    python heights_open_buildings.py --project YOUR_GCP_PROJECT --dry-run    # preview only

Measured heights are kept: buildings whose height came from LiDAR or was
approved by a surveyor/registrar are skipped unless --force is given.
"""
import argparse

from app.postgis import fetch_buildings, save_buildings

ASSET = "GOOGLE/Research/open-buildings-temporal/v1"
SOURCE = "google-open-buildings-2.5d"
KEEP = {"lidar", "surveyor-verified", "registrar-approved"}  # never overwrite measured heights
MIN_HEIGHT_M = 2.0  # below this the model saw no building in the footprint


def height_image(ee, year):
    col = ee.ImageCollection(ASSET).filterDate(f"{year}-01-01", f"{year + 1}-01-01")
    return col.mosaic().select("building_height")


def sample_heights(ee, image, features):
    """{building_id: median height in m} for one batch of GeoJSON features."""
    fc = ee.FeatureCollection([
        ee.Feature(ee.Geometry(f["geometry"]), {"bid": f["properties"]["building_id"]}) for f in features
    ])
    rows = image.reduceRegions(collection=fc, reducer=ee.Reducer.median(), scale=4).getInfo()["features"]
    return {r["properties"]["bid"]: r["properties"].get("median") for r in rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="Earth Engine-enabled Google Cloud project id")
    ap.add_argument("--session", default="chennai-t-nagar", help="scan session to update")
    ap.add_argument("--year", type=int, default=2023, help="dataset year (2016-2023)")
    ap.add_argument("--floor-height", type=float, default=3.0)
    ap.add_argument("--batch", type=int, default=400, help="footprints per Earth Engine request")
    ap.add_argument("--force", action="store_true", help="also overwrite measured/approved heights")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    import ee

    ee.Initialize(project=args.project)
    image = height_image(ee, args.year)

    features = fetch_buildings(session_id=args.session)["features"]
    todo = [f for f in features if args.force or f["properties"].get("height_source") not in KEEP]
    print(f"{len(features)} buildings in {args.session}; {len(todo)} to sample from {ASSET} ({args.year})")

    updated, no_signal = [], 0
    for i in range(0, len(todo), args.batch):
        batch = todo[i:i + args.batch]
        heights = sample_heights(ee, image, batch)
        for f in batch:
            p = f["properties"]
            h = heights.get(p["building_id"])
            if h is None or h < MIN_HEIGHT_M:
                no_signal += 1
                continue
            p.setdefault("original_height_m", p.get("height_m"))
            p.setdefault("original_stories", p.get("stories"))
            p.setdefault("original_height_source", p.get("height_source"))
            p["height_m"] = round(h, 1)
            p["stories"] = max(1, round(h / args.floor_height))
            p["height_source"] = SOURCE
            p["height_year"] = args.year
            updated.append(f)
        print(f"  sampled {min(i + args.batch, len(todo))}/{len(todo)}")

    print(f"{len(updated)} heights from Google 2.5D; {no_signal} footprints had no height signal (kept as before)")
    if updated and not args.dry_run:
        save_buildings({"type": "FeatureCollection", "features": updated}, args.session, reconcile=False)
        print("saved")


if __name__ == "__main__":
    main()
