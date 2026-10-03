"""
Line up a new set of building footprints (a re-scan, another source) with the registry.

1. Registration: every nearby (new, old) centroid pair votes for a translation; the
   most-voted shift is the survey offset. Wrong pairs scatter, true ones agree.
2. Matching: after removing that shift, pair footprints one-to-one by IoU.

Matched buildings can adopt the registry's building_id, so their base ULPIN, units
and owners survive a re-survey. Works in lon/lat degrees: IoU is unchanged by the
(near-uniform) degree-to-metre scaling, and offsets are reported in metres.
"""
import math
from collections import Counter

from shapely.affinity import translate
from shapely.geometry import shape
from shapely.strtree import STRtree

M_LAT = 110540.0
MEASURED = {"lidar", "google-open-buildings-2.5d", "surveyor-verified", "registrar-approved", "tag-height"}
REMEASURES = {"lidar", "surveyor-verified", "registrar-approved"}  # new sources allowed to replace a measured height
HEIGHT_KEYS = ("height_m", "stories", "height_source", "ground_z", "roof_z", "lidar_points")
SEARCH_M = 30.0  # farthest shift between two surveys we try to recover
VOTE_BIN_M = 1.5
MIN_IOU = 0.4


def _geoms(fc):
    out = []
    for f in fc["features"]:
        g = shape(f["geometry"]).buffer(0)
        out.append((f["properties"]["building_id"], g))
    return out


def estimate_offset(new, old):
    """(dx, dy) in degrees that moves `new` onto `old`, plus the number of agreeing pairs."""
    if not new or not old:
        return (0.0, 0.0), 0
    lat = old[0][1].centroid.y
    kx, ky = 111320.0 * math.cos(math.radians(lat)), M_LAT
    tree = STRtree([g for _, g in old])
    radius = SEARCH_M / ky
    votes, pairs = Counter(), []
    for _, g in new:
        c = g.centroid
        for j in tree.query(c.buffer(radius)):
            o = old[j][1].centroid
            dx, dy = (o.x - c.x) * kx, (o.y - c.y) * ky
            if math.hypot(dx, dy) <= SEARCH_M:
                votes[(round(dx / VOTE_BIN_M), round(dy / VOTE_BIN_M))] += 1
                pairs.append((dx, dy))
    if not votes:
        return (0.0, 0.0), 0
    (bx, by), _ = votes.most_common(1)[0]
    near = [p for p in pairs if abs(p[0] / VOTE_BIN_M - bx) <= 1 and abs(p[1] / VOTE_BIN_M - by) <= 1]
    mx = sorted(p[0] for p in near)[len(near) // 2]
    my = sorted(p[1] for p in near)[len(near) // 2]
    return (mx / kx, my / ky), len(near)


def match(new_fc, old_fc, min_iou=MIN_IOU):
    """
    {matches: {new_id: old_id}, offset_m: (east, north), unmatched_new: [...], unmatched_old: n,
     iou_mean: float}. One-to-one, best overlaps first.
    """
    new, old = _geoms(new_fc), _geoms(old_fc)
    (dx, dy), votes = estimate_offset(new, old)
    moved = [(i, translate(g, dx, dy)) for i, g in new]
    tree = STRtree([g for _, g in old])
    cands = []
    for ni, (nid, g) in enumerate(moved):
        for j in tree.query(g):
            inter = g.intersection(old[j][1]).area
            iou = inter / (g.union(old[j][1]).area or 1)
            if iou >= min_iou:
                cands.append((iou, ni, j))
    cands.sort(reverse=True)  # ponytail: greedy, optimal assignment (Hungarian) only if dense ties matter
    used_n, used_o, matches, ious = set(), set(), {}, []
    for iou, ni, j in cands:
        if ni in used_n or j in used_o:
            continue
        used_n.add(ni); used_o.add(j)
        matches[new[ni][0]] = old[j][0]
        ious.append(iou)
    lat = old[0][1].centroid.y if old else 0
    return {
        "matches": matches,
        "offset_m": (round(dx * 111320 * math.cos(math.radians(lat)), 2), round(dy * M_LAT, 2)),
        "votes": votes,
        "unmatched_new": [i for k, (i, _) in enumerate(new) if k not in used_n],
        "unmatched_old": len(old) - len(used_o),
        "iou_mean": round(sum(ious) / len(ious), 3) if ious else 0.0,
    }


def adopt_ids(new_fc, result, old_fc=None):
    """
    Copy of `new_fc` where matched buildings take the registry's building_id. With `old_fc`,
    a matched building also keeps the registry's properties (name, basements, ...) wherever
    the new survey has nothing to say; the new geometry and measurements win.
    """
    old_props = {f["properties"]["building_id"]: f["properties"] for f in (old_fc or {"features": []})["features"]}
    feats = []
    for f in new_fc["features"]:
        scan_id = f["properties"]["building_id"]
        old_id = result["matches"].get(scan_id)
        props = f["properties"]
        if old_id:
            kept = {k: v for k, v in old_props.get(old_id, {}).items() if k != "session_id"}
            props = {**kept, **{k: v for k, v in props.items() if v is not None}, "building_id": old_id, "matched_from": scan_id}
            # a footprints-only rescan must not replace a measured height with a default one
            if kept.get("height_source") in MEASURED and f["properties"].get("height_source") not in REMEASURES:
                props.update({k: kept[k] for k in HEIGHT_KEYS if k in kept})
                props["height_kept"] = True
        feats.append({**f, "properties": props})
    return {**new_fc, "features": feats}
