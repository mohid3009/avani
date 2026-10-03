"""Run: python test_conflate.py. Shift, jitter and thin out real footprints, then line them back up."""
import json, math, random
from app.conflate import match

random.seed(7)
old = json.load(open("seed/chennai_buildings.json"))
# a dense 2 km patch of real Chennai footprints
fs = [f for f in old["features"] if f["geometry"]["type"] == "Polygon"][:600]
old = {"type": "FeatureCollection", "features": fs}

E, N = 9.0, -4.0  # metres the "new survey" is displaced by
kx = 111320 * math.cos(math.radians(13.04))
new_feats = []
for f in fs:
    if random.random() < 0.1:  # building missing from the new survey
        continue
    ring = [[x - E / kx + random.gauss(0, 0.25) / kx, y - N / 110540 + random.gauss(0, 0.25) / 110540] for x, y in f["geometry"]["coordinates"][0]]
    ring[-1] = ring[0]
    new_feats.append({"type": "Feature", "properties": {"building_id": "new-" + f["properties"]["building_id"]}, "geometry": {"type": "Polygon", "coordinates": [ring]}})

r = match({"type": "FeatureCollection", "features": new_feats}, old)
right = sum(1 for n, o in r["matches"].items() if n == "new-" + o)
print(f"{len(new_feats)} buildings, matched {len(r['matches'])}, correct {right}, offset {r['offset_m']} (true {E}, {N}), mean IoU {r['iou_mean']}")
assert right / len(new_feats) > 0.97 and abs(r["offset_m"][0] - E) < 1 and abs(r["offset_m"][1] - N) < 1

# a footprints-only rescan must not replace a measured height with a default one
from app.conflate import adopt_ids
sq = {"type": "Polygon", "coordinates": [[[80, 13], [80.0001, 13], [80.0001, 13.0001], [80, 13]]]}
old_fc = {"features": [{"type": "Feature", "geometry": sq, "properties": {"building_id": "B1", "name": "Tower", "height_m": 54.1, "stories": 18, "height_source": "google-open-buildings-2.5d"}}]}
new_fc = {"features": [{"type": "Feature", "geometry": sq, "properties": {"building_id": "scan-1", "height_m": 3.0, "stories": 1, "height_source": "osm-default"}}]}
out = adopt_ids(new_fc, {"matches": {"scan-1": "B1"}}, old_fc)["features"][0]["properties"]
assert (out["building_id"], out["name"], out["height_m"], out["stories"], out["height_kept"]) == ("B1", "Tower", 54.1, 18, True), out
new_fc["features"][0]["properties"]["height_source"] = "lidar"
out = adopt_ids(new_fc, {"matches": {"scan-1": "B1"}}, old_fc)["features"][0]["properties"]
assert out["height_m"] == 3.0 and not out.get("height_kept"), out
print("ok: measured heights survive a footprints-only rescan; a new LiDAR measurement replaces them")
