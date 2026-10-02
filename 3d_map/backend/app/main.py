import hashlib
import json
import os

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .postgis import init_postgis

app = FastAPI(title="Layerd API", version="2.0")
app.add_middleware(GZipMiddleware, minimum_size=1024)  # the city GeoJSON is ~4 MB raw

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    # the mobile app (Expo Go / Expo Web dev server / device web preview) also
    # talks to this API directly — allow any dev origin; auth is demo-grade anyway
    allow_origin_regex=".*",
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_ROLES = {"citizen", "surveyor", "registrar"}

# Role views for the demo â€” swap for real auth in production.
DEMO_ACCOUNTS = {
    "citizen":   {"username": "ramesh",  "password": "citizen123",  "name": "Ramesh Iyer"},
    "surveyor":  {"username": "priya",   "password": "survey123",   "name": "Priya Venkatesan"},
    "registrar": {"username": "arun",    "password": "register123", "name": "Arun Krishnan"},
}


@app.post("/login")
def login(payload: dict = Body(...)):
    username = str(payload.get("username", "")).strip().lower()
    password = str(payload.get("password", ""))
    role = str(payload.get("role", "")).strip().lower()
    if role not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of {sorted(VALID_ROLES)}")
    if role == "citizen":
        # multiple citizen demo accounts (ramesh = full portfolio, kavitha = small holding)
        from .citizen import CITIZEN_LOGINS
        from .ulpin import OWNERS

        acct = CITIZEN_LOGINS.get(username)
        if not acct or acct["password"] != password:
            raise HTTPException(401, "invalid username or password for this role")
        name = next(n for oid, n in OWNERS if oid == acct["owner_id"])
        token = hashlib.sha256(f"{username}:{password}:{role}".encode()).hexdigest()[:32]
        return {"token": token, "role": role, "username": username, "name": name,
                "owner_id": acct["owner_id"]}
    acct = DEMO_ACCOUNTS[role]
    if username != acct["username"] or password != acct["password"]:
        raise HTTPException(401, "invalid username or password for this role")
    token = hashlib.sha256(f"{username}:{password}:{role}".encode()).hexdigest()[:32]
    return {"token": token, "role": role, "username": username, "name": acct["name"]}


@app.on_event("startup")
def startup():
    try:
        init_postgis()
        print("[startup] PostGIS ready")
    except Exception as e:  # PostGIS is optional â€” the app works without it
        print(f"[startup] PostGIS unavailable ({e}) â€” LiDAR persistence disabled")


# ---------------- Step-wise extraction jobs ----------------

@app.post("/lidar/extract/start")
async def start_extraction(
    laz: UploadFile | None = File(None),
    mode: str = Form("osm"),
    footprints: UploadFile | None = File(None),
    xmin: float | None = Form(None),
    ymin: float | None = Form(None),
    xmax: float | None = Form(None),
    ymax: float | None = Form(None),
    bbox_crs: str = Form("laz"),  # 'laz' = bbox in the .laz's native CRS
    footprints_crs: str = Form("wgs84"),  # 'laz' = footprint GeoJSON in the .laz's native CRS
    epsg: int | None = Form(None),
    floor_height: float = Form(3.0),
):
    """
    Start a LiDAR extraction job and return its id immediately. Poll
    GET /lidar/extract/{job_id} for step-wise progress and the final result.
    mode: 'osm' (footprints fetched for the xmin/ymin/xmax/ymax bbox) or
    'footprints' (footprints uploaded as a GeoJSON file). bbox_crs /
    footprints_crs = 'laz' means the given coordinates are in the .laz's
    native projected CRS (transformed to WGS84 server-side); 'wgs84' means
    plain lon/lat degrees.
    """
    import threading

    from .extract_jobs import create_job, run_extraction

    if mode not in ("osm", "footprints"):
        raise HTTPException(400, "mode must be 'osm' or 'footprints'")
    if floor_height <= 0:
        raise HTTPException(400, "floor_height must be positive")

    # read uploads up-front; an empty part counts as "not provided" (some
    # FastAPI/python-multipart combos reject a multipart body in which an
    # optional file field is entirely absent, so the frontend sends an empty
    # placeholder part instead)
    laz_bytes = await laz.read() if laz else None
    footprints_bytes = await footprints.read() if footprints else None
    if laz_bytes == b"":
        laz_bytes = None
    if footprints_bytes == b"":
        footprints_bytes = None
    has_lidar = bool(laz_bytes)  # without a .laz, heights come from attributes

    if mode == "osm":
        if None in (xmin, ymin, xmax, ymax):
            raise HTTPException(400, "bbox required: xmin, ymin, xmax, ymax")
        if xmin >= xmax or ymin >= ymax:
            raise HTTPException(400, "invalid bbox: need xmin < xmax and ymin < ymax")
        if not has_lidar and bbox_crs == "laz":
            bbox_crs = "wgs84"  # no .laz CRS to borrow — bbox must be WGS84
        if bbox_crs not in ("laz", "wgs84"):
            raise HTTPException(400, "bbox_crs must be 'laz' or 'wgs84'")
        if bbox_crs == "wgs84" and not (
            -180 <= xmin <= 180 and -180 <= xmax <= 180
            and -90 <= ymin <= 90 and -90 <= ymax <= 90
        ):
            raise HTTPException(
                400,
                "these look like projected coordinates (e.g. metres), not "
                "WGS84 lon/lat â€” set 'bbox coordinates' to 'same as .laz CRS'",
            )
        bbox = (xmin, ymin, xmax, ymax)
    else:
        if footprints is None:
            raise HTTPException(400, "footprints file required for mode 'footprints'")
        if footprints_crs not in ("laz", "wgs84"):
            raise HTTPException(400, "footprints_crs must be 'laz' or 'wgs84'")
        if footprints_crs == "laz" and not has_lidar:
            raise HTTPException(
                400,
                "footprint coordinates set to 'same as .laz CRS' but no .laz was uploaded",
            )
        bbox = None

    job = create_job(mode, has_lidar=has_lidar)
    thread = threading.Thread(
        target=run_extraction,
        args=(job, mode, laz_bytes, footprints_bytes, bbox, bbox_crs, footprints_crs, epsg, float(floor_height)),
        daemon=True,
    )
    thread.start()
    return {"job_id": job["job_id"], "steps": job["steps"]}


@app.get("/lidar/extract/{job_id}")
def extraction_status(job_id: str):
    """Step-wise progress + (when finished) the full extraction result."""
    from .extract_jobs import get_job

    job = get_job(job_id)
    if not job:
        raise HTTPException(404, f"job {job_id} not found")
    return {
        "job_id": job["job_id"],
        "state": job["state"],
        "steps": job["steps"],
        "error": job["error"],
        "result": job["result"],
    }


# ---------------- PostGIS persistence (saved buildings + scan sessions) ----------------

@app.get("/lidar/buildings/status")
def lidar_saved_status():
    from .postgis import count_buildings, is_available
    if not is_available():
        return {"available": False, "count": 0}
    return {"available": True, "count": count_buildings()}


@app.get("/lidar/buildings")
def lidar_saved_buildings(session_id: str | None = Query(None)):
    """Saved buildings as GeoJSON — all scan sessions, or one via ?session_id=."""
    from .postgis import fetch_buildings, is_available
    if not is_available():
        raise HTTPException(503, "PostGIS is not available")
    return fetch_buildings(session_id=session_id)


@app.post("/lidar/buildings/sync")
def lidar_sync_buildings(payload: dict = Body(...)):
    """
    Persist the (possibly manually edited) working set of ONE scan session:
    upserts every feature into that session and deletes session rows missing
    from the payload. Other sessions are never touched.
    """
    import uuid

    from .postgis import save_buildings
    fc = payload.get("buildings")
    if not isinstance(fc, dict) or fc.get("type") != "FeatureCollection":
        raise HTTPException(400, "body must contain a FeatureCollection under 'buildings'")
    session_id = payload.get("session_id") or uuid.uuid4().hex[:12]
    count = save_buildings(fc, session_id=session_id, label=payload.get("label"), reconcile=True)
    return {"status": "ok", "session_id": session_id, "count": count}


@app.delete("/lidar/buildings/{building_id}")
def lidar_delete_building(building_id: str):
    """Delete a single building (surveyor/registrar editing)."""
    from .postgis import delete_building

    if not delete_building(building_id):
        raise HTTPException(404, f"building {building_id} not found")
    return {"status": "deleted", "building_id": building_id}


@app.get("/lidar/buildings/{building_id}")
def lidar_building(building_id: str):
    """One saved building as a GeoJSON Feature."""
    from .postgis import fetch_building

    feat = fetch_building(building_id)
    if feat is None:
        raise HTTPException(404, f"building {building_id} not found")
    return feat


@app.get("/lidar/regions")
def lidar_region(lat: float, lon: float):
    """Reverse-geocode a scan centroid to {country, region} for the grouping UI."""
    from .regions import lookup_region

    return lookup_region(lat, lon)


@app.post("/lidar/buildings/update")
def lidar_update_building(payload: dict = Body(...)):
    """
    Upsert ONE (possibly edited) building feature without touching the rest of
    its session — used by the dashboard editor. The feature's properties must
    carry session_id (fetch_buildings includes it).
    """
    from .postgis import save_buildings

    fc = payload.get("buildings")
    feature = fc.get("features", [None])[0] if isinstance(fc, dict) else None
    props = (feature or {}).get("properties") or {}
    if not feature or not props.get("building_id"):
        raise HTTPException(400, "body must contain buildings.features[0] with building_id")
    session_id = props.get("session_id") or payload.get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id missing (not in feature properties)")
    save_buildings({"type": "FeatureCollection", "features": [feature]}, session_id, reconcile=False)
    return {"status": "ok", "building_id": props.get("building_id")}


@app.post("/lidar/buildings/confirm")
def lidar_confirm_edit(payload: dict = Body(...)):
    """
    Registrar confirmation workflow: set edit_status ('confirmed' or 'pending')
    on one building and append the provided audit entry to its edit_history.
    """
    from .postgis import set_edit_status

    building_id = payload.get("building_id")
    status = payload.get("status", "confirmed")
    if not building_id:
        raise HTTPException(400, "building_id required")
    if status not in ("confirmed", "pending"):
        raise HTTPException(400, "status must be 'confirmed' or 'pending'")
    try:
        set_edit_status(building_id, status, payload.get("entry"))
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"status": "ok", "building_id": building_id, "edit_status": status}


@app.post("/lidar/buildings/clear")
def lidar_clear_buildings():
    from .postgis import clear_buildings
    clear_buildings()
    return {"status": "cleared"}


@app.get("/lidar/sessions")
def lidar_sessions():
    """All scan sessions with their live building counts."""
    from .postgis import is_available, list_sessions
    if not is_available():
        raise HTTPException(503, "PostGIS is not available")
    return list_sessions()


@app.delete("/lidar/sessions/{session_id}")
def lidar_delete_session(session_id: str):
    """Delete a scan session and all of its buildings."""
    from .postgis import delete_session, is_available
    if not is_available():
        raise HTTPException(503, "PostGIS is not available")
    delete_session(session_id)
    return {"status": "deleted", "session_id": session_id}


# ---------------- 3D ULPIN units ----------------

def _footprint_size_m(feat):
    """Width/depth (m) of a footprint's bounding box — unit polygons are normalized to it."""
    import math

    geom = feat["geometry"]
    ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    lat_mid = (min(lats) + max(lats)) / 2
    width = max(1.0, (max(lons) - min(lons)) * 111320 * math.cos(math.radians(lat_mid)))
    depth = max(1.0, (max(lats) - min(lats)) * 110540)
    return width, depth


def _floor_units(building_id, feat, floor_index, seg):
    """Turn one floor's segmentation into ULPIN unit records (+ overlap check)."""
    from itertools import combinations

    from shapely.geometry import Polygon as ShPolygon

    from .ulpin import base_ulpin, owner_for, unit_ulpin

    base = base_ulpin(building_id)
    width, depth = _footprint_size_m(feat)
    units = []
    for j, part in enumerate(seg["units"], start=1):
        ulp = unit_ulpin(base, floor_index, j)
        owner = owner_for(ulp, floor_index)
        poly = part["polygon"]
        area = ShPolygon([[x * width, y * depth] for x, y in poly[:-1]]).buffer(0).area
        units.append({
            "unit_ulpin": ulp,
            "base_ulpin": base,
            "floor_index": floor_index,
            "unit_no": j,
            "polygon": poly,
            "area_sqm": round(area, 2),
            "rights_type": owner["rights_type"],
            "owner_id": owner["owner_id"],
            "owner_name": owner["owner_name"],
            "segmentation": seg["source"],  # 'model' | 'estimated'
            "confidence": part.get("confidence"),
            "evidence": part.get("label") or seg["note"],
            "validation_status": "valid",
        })
    # topology check (PRD FR13): units on a floor must not overlap. Masks share
    # wall pixels, so only overlaps above 2 % of the smaller unit count.
    shapes = [ShPolygon(u["polygon"][:-1]).buffer(0) for u in units]
    for (i, a), (k, b) in combinations(enumerate(shapes), 2):
        if a.intersection(b).area > 0.02 * min(a.area, b.area):
            units[i]["validation_status"] = units[k]["validation_status"] = "conflict"
    return units


def _floor_range(floors, basements):
    return list(range(-int(basements), 0)) + list(range(1, int(floors) + 1))


@app.get("/lidar/segmentation/status")
def segmentation_status():
    """Which floor-plan model unit extraction will use (or why it cannot)."""
    from .segmentation import model_status

    return model_status()


@app.get("/lidar/units")
def ulpin_units_for_building(building_id: str = Query(...)):
    """
    All 3D ULPIN units of one building. A building without units gets an
    *estimated* layout (labelled segmentation='estimated') on first request,
    using its own floor/basement counts, until a surveyor uploads a plan.
    """
    from .postgis import fetch_building, fetch_units, save_units
    from .segmentation import segment_floorplan

    units = fetch_units(building_id)
    if units:
        return {"building_id": building_id, "units": units}

    feat = fetch_building(building_id)
    if feat is None:
        return {"building_id": building_id, "units": []}

    props = feat["properties"]
    seg = segment_floorplan(None, n_units=6, seed=building_id)
    floors = max(1, int(props.get("stories") or 1))
    basements = max(0, int(props.get("basements") or 0))
    units = [u for f in _floor_range(floors, basements) for u in _floor_units(building_id, feat, f, seg)]
    save_units(building_id, units)
    return {"building_id": building_id, "units": units}


@app.delete("/lidar/units")
def ulpin_units_clear(building_id: str = Query(...)):
    """Remove the whole unit tree of one building."""
    from .postgis import delete_units
    removed = delete_units(building_id)
    return {"status": "cleared", "building_id": building_id, "removed": removed}


@app.post("/lidar/units/generate")
async def ulpin_units_generate(
    building_id: str = Form(...),
    floors: int = Form(...),
    basements: int = Form(0),
    floor_height: float = Form(3.0),
    plan: UploadFile | None = File(None),
):
    """
    Generate the whole unit tree of one building. With a floor-plan image the
    trained model extracts the unit outlines (same plan on every floor);
    otherwise the layout is estimated. Unit ULPINs: `{base}-F{floor}-U{unit}`.
    """
    from .postgis import fetch_building, save_units
    from .segmentation import segment_floorplan
    from .ulpin import base_ulpin

    if floors < 1 or floors > 60:
        raise HTTPException(400, "floors must be between 1 and 60")
    if basements < 0 or basements > 6:
        raise HTTPException(400, "basements must be between 0 and 6")
    if floor_height <= 0 or floor_height > 12:
        raise HTTPException(400, "floor_height must be between 0 and 12")

    feat = fetch_building(building_id)
    if feat is None:
        raise HTTPException(404, f"building {building_id} not found")

    seg = segment_floorplan(await plan.read() if plan else None, n_units=6, seed=building_id)
    units = [u for f in _floor_range(floors, basements) for u in _floor_units(building_id, feat, f, seg)]
    saved = save_units(building_id, units)
    return {
        "building_id": building_id,
        "base_ulpin": base_ulpin(building_id),
        "segmentation": seg["source"],
        "note": seg["note"],
        "floors": floors,
        "basements": basements,
        "unit_count": len(units),
        "conflicts": sum(u["validation_status"] == "conflict" for u in units),
        "saved": saved,
        "units": units,
    }


@app.put("/lidar/units")
def ulpin_units_replace(payload: dict = Body(...)):
    """Replace one building's whole unit tree (registrar edits, corrections)."""
    from .postgis import save_units

    building_id = payload.get("building_id")
    units = payload.get("units")
    if not building_id or not isinstance(units, list):
        raise HTTPException(400, "building_id and a units list are required")
    if any(not u.get("unit_ulpin") or "polygon" not in u for u in units):
        raise HTTPException(400, "every unit needs unit_ulpin and polygon")
    return {"building_id": building_id, "saved": save_units(building_id, units), "units": units}


@app.get("/lidar/units/all")
def ulpin_units_all():
    """Every unit across all buildings — the registrar search index."""
    from .postgis import fetch_all_units

    return fetch_all_units()


@app.get("/lidar/units/pending")
def lidar_units_pending():
    from .postgis import get_pending_unit_edits
    return get_pending_unit_edits()


@app.post("/lidar/units/update")
def lidar_units_update(payload: dict = Body(...)):
    """Surveyor proposes a unit correction; payload.patch is the full proposal."""
    from .postgis import propose_unit_edit

    b_id, ulp, patch = payload.get("building_id"), payload.get("unit_ulpin"), payload.get("patch")
    if not b_id or not ulp or not isinstance(patch, dict):
        raise HTTPException(400, "building_id, unit_ulpin and patch are required")
    try:
        edit_id = propose_unit_edit(b_id, ulp, payload.get("proposed_by") or "surveyor", patch)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"status": "pending", "id": edit_id}


@app.post("/lidar/units/confirm")
def lidar_units_confirm(payload: dict = Body(...)):
    """Registrar resolves a correction: status 'confirmed' or 'rejected'."""
    from .postgis import resolve_unit_edit

    status = payload.get("status")
    if status not in ("confirmed", "rejected"):
        raise HTTPException(400, "status must be 'confirmed' or 'rejected'")
    res = resolve_unit_edit(payload.get("id"), status, payload.get("resolution"))
    if not res:
        raise HTTPException(404, "pending edit not found")
    return res



@app.post("/lidar/units/generate_floor")
async def ulpin_units_generate_floor(
    building_id: str = Form(...),
    floor_index: int = Form(...),
    plan: UploadFile | None = File(None),
):
    """Re-extract one floor's units from its own plan (floors often differ)."""
    from .postgis import fetch_building, fetch_units, save_floor_units
    from .segmentation import segment_floorplan
    from .ulpin import base_ulpin

    feat = fetch_building(building_id)
    if feat is None:
        raise HTTPException(404, f"building {building_id} not found")

    seg = segment_floorplan(await plan.read() if plan else None, n_units=6, seed=f"{building_id}:{floor_index}")
    floor_units = _floor_units(building_id, feat, floor_index, seg)
    saved = save_floor_units(building_id, floor_index, floor_units)
    all_units = fetch_units(building_id)  # the UI redraws the whole building
    return {
        "building_id": building_id,
        "base_ulpin": base_ulpin(building_id),
        "segmentation": seg["source"],
        "note": seg["note"],
        "unit_count": len(floor_units),
        "conflicts": sum(u["validation_status"] == "conflict" for u in floor_units),
        "saved": saved,
        "units": all_units,
    }

# ---------------- Citizen portal (mobile app) ----------------
# Per-citizen views: own profile, own properties (derived from ULPIN unit
# ownership), building status, property taxes, complaints and a help chatbot.
# Identity is demo-grade: resolved by ?name= or ?owner_id=, defaulting to the
# demo citizen (Ramesh Iyer / OWN-0001).

from .citizen import (
    add_complaint,
    chat_reply,
    fetch_owned_properties,
    fetch_owned_units,
    fetch_property_detail,
    list_complaints,
    profile as citizen_profile_data,
    taxes_for_units,
)


def _citizen(name: str | None, owner_id: str | None):
    return citizen_profile_data(name, owner_id)


@app.get("/citizen/profile")
def citizen_profile(name: str | None = Query(None), owner_id: str | None = Query(None)):
    return _citizen(name, owner_id)


@app.get("/citizen/digipin")
def citizen_digipin(lat: float = Query(...), lon: float = Query(...)):
    """DigiPin (India Post digital address code) for any coordinate."""
    from .digipin import digipin_encode, digipin_format

    pin = digipin_encode(lat, lon)
    if pin is None:
        raise HTTPException(400, "coordinate outside India's DigiPin boundary")
    return {"digipin": digipin_format(pin), "lat": lat, "lon": lon}


@app.get("/citizen/properties")
def citizen_properties(name: str | None = Query(None), owner_id: str | None = Query(None)):
    cid, _ = _citizen(name, owner_id)["owner_id"], None
    try:
        return fetch_owned_properties(cid)
    except Exception as e:
        raise HTTPException(503, f"property records unavailable: {e}")


@app.get("/citizen/property/{building_id}")
def citizen_property(building_id: str, name: str | None = Query(None), owner_id: str | None = Query(None)):
    cid, cname = (lambda p: (p["owner_id"], p["name"]))(citizen_profile_data(name, owner_id))
    try:
        detail = fetch_property_detail(cid, building_id)
    except Exception as e:
        raise HTTPException(503, f"property records unavailable: {e}")
    if detail is None:
        raise HTTPException(404, f"building {building_id} not found")
    return detail


@app.get("/citizen/taxes")
def citizen_taxes(name: str | None = Query(None), owner_id: str | None = Query(None)):
    cid, cname = (lambda p: (p["owner_id"], p["name"]))(citizen_profile_data(name, owner_id))
    try:
        units = fetch_owned_units(cid)
    except Exception as e:
        raise HTTPException(503, f"property records unavailable: {e}")
    return taxes_for_units(units)


@app.get("/citizen/complaints")
def citizen_complaints_list(name: str | None = Query(None), owner_id: str | None = Query(None)):
    cid, _ = (lambda p: (p["owner_id"], p["name"]))(citizen_profile_data(name, owner_id))
    return list_complaints(cid)


@app.post("/citizen/complaints")
def citizen_complaints_add(payload: dict = Body(...)):
    p = citizen_profile_data(payload.get("name"), payload.get("owner_id"))
    subject = str(payload.get("subject", "")).strip()
    description = str(payload.get("description", "")).strip()
    category = str(payload.get("category", "other")).strip().lower()
    if not subject or not description:
        raise HTTPException(400, "subject and description are required")
    return add_complaint(
        p["owner_id"], p["name"], category, subject, description,
        payload.get("building_id"),
    )


@app.post("/citizen/chat")
def citizen_chat(payload: dict = Body(...)):
    p = citizen_profile_data(payload.get("name"), payload.get("owner_id"))
    message = str(payload.get("message", "")).strip()
    if not message:
        raise HTTPException(400, "message is required")
    return chat_reply(message, p["owner_id"], p["name"])


# ---------------- Desktop / production serving ----------------
# The Electron desktop shell spawns this backend and loads http://localhost:<port>
# directly, so the API is aliased under /api/ (the frontend's fetch base) and
# the built frontend (3d_map/frontend/dist) is served from the same origin.
# NOTE: this block must stay at the very END of the file — the SPA catch-all
# matches every GET path, so it has to be registered after all API routes.

_FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend", "dist",
)

app.mount("/api", app)  # same-origin alias: /api/lidar/... -> /lidar/...

if os.path.isdir(_FRONTEND_DIST):
    _assets_dir = os.path.join(_FRONTEND_DIST, "assets")
    if os.path.isdir(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        """Serve the SPA (client-side routing needs index.html for every path)."""
        # never swallow API/asset paths — they must never return HTML
        if full_path == "api" or full_path.startswith(("api/", "assets/")):
            raise HTTPException(404, "not found")
        candidate = os.path.join(_FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_FRONTEND_DIST, "index.html"))


