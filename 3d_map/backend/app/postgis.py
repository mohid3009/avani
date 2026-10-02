"""
PostGIS persistence for generated LiDAR buildings.

Connection: the DSN is read from the POSTGRES_DSN env var, defaulting to
postgresql://postgres:postgres@localhost:5432/layerd

All geometries are stored as Polygon, SRID 4326 (the pipeline reprojects to
WGS84 before persisting). `save_buildings(fc)` upserts by building_id;
`save_buildings(fc, reconcile=True)` additionally deletes rows missing from
the payload — used when the user edits the generated set manually so the
table mirrors the working set exactly.

When PostgreSQL is unavailable (local dev without Docker), a JSON-file
fallback store is used automatically — no configuration needed.
"""

import json
import os
import threading
from contextlib import contextmanager

try:
    import psycopg2
    import psycopg2.extras
    _PSYCOPG2_AVAILABLE = True
except ImportError:
    _PSYCOPG2_AVAILABLE = False

DSN = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_DSN", "postgresql://postgres:postgres@localhost:5432/layerd")

# ── JSON file fallback store ──────────────────────────────────────────────────
# Used automatically when PostgreSQL is unreachable.
_FALLBACK_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_BUILDINGS_FILE = os.path.join(_FALLBACK_DIR, "buildings.json")
_UNITS_FILE = os.path.join(_FALLBACK_DIR, "units.json")
_fb_lock = threading.Lock()

def _fb_ensure_dir():
    os.makedirs(_FALLBACK_DIR, exist_ok=True)

def _fb_load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}

def _fb_save(path, data):
    _fb_ensure_dir()
    with open(path, "w") as f:
        json.dump(data, f)

def _fb_fetch_buildings():
    data = _fb_load(_BUILDINGS_FILE)
    return {
        "type": "FeatureCollection",
        "features": list(data.values()),
    }

def _fb_save_buildings(fc, session_id, label=None, reconcile=False):
    with _fb_lock:
        data = _fb_load(_BUILDINGS_FILE)
        incoming_ids = set()
        for feat in fc.get("features", []):
            p = feat.get("properties") or {}
            bid = p.get("building_id")
            if not bid:
                continue
            incoming_ids.add(bid)
            feat["properties"]["session_id"] = session_id
            data[bid] = feat
        if reconcile:
            for k in list(data.keys()):
                if data[k].get("properties", {}).get("session_id") == session_id and k not in incoming_ids:
                    del data[k]
        _fb_save(_BUILDINGS_FILE, data)
    return len(incoming_ids)

def _fb_fetch_units(building_id):
    data = _fb_load(_UNITS_FILE)
    return data.get(building_id, [])

def _fb_save_units(units):
    with _fb_lock:
        data = _fb_load(_UNITS_FILE)
        for u in units:
            bid = u.get("building_id")
            if not bid:
                continue
            if bid not in data:
                data[bid] = []
            existing = {x["unit_ulpin"]: i for i, x in enumerate(data[bid])}
            ulp = u.get("unit_ulpin")
            if ulp in existing:
                data[bid][existing[ulp]] = u
            else:
                data[bid].append(u)
        _fb_save(_UNITS_FILE, data)

def _fb_delete_units(building_id):
    with _fb_lock:
        data = _fb_load(_UNITS_FILE)
        count = len(data.pop(building_id, []))
        _fb_save(_UNITS_FILE, data)
    return count

def _fb_save_floor_units(building_id, floor_index, units):
    with _fb_lock:
        data = _fb_load(_UNITS_FILE)
        existing = [u for u in data.get(building_id, []) if u.get("floor_index") != floor_index]
        data[building_id] = existing + list(units)
        _fb_save(_UNITS_FILE, data)
    return len(units)

# ─────────────────────────────────────────────────────────────────────────────



SCHEMA = """
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS lidar_buildings (
    building_id TEXT PRIMARY KEY,
    session_id TEXT,
    job_id TEXT,
    name TEXT,
    height_m DOUBLE PRECISION,
    stories INTEGER,
    ground_z DOUBLE PRECISION,
    roof_z DOUBLE PRECISION,
    lidar_points INTEGER,
    height_source TEXT,
    original_height_m DOUBLE PRECISION,
    original_stories INTEGER,
    original_height_source TEXT,
    props JSONB NOT NULL DEFAULT '{}'::jsonb,
    geom geometry(Polygon, 4326) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lidar_buildings_geom_gix
    ON lidar_buildings USING GIST (geom);
CREATE INDEX IF NOT EXISTS lidar_buildings_job_idx ON lidar_buildings (job_id);

-- 3D ULPIN units: one row per vertical unit of a building
CREATE TABLE IF NOT EXISTS ulpin_units (
    unit_ulpin TEXT PRIMARY KEY,
    building_id TEXT NOT NULL,
    base_ulpin TEXT NOT NULL,
    floor_index INT NOT NULL,
    unit_no INT NOT NULL,
    polygon JSONB NOT NULL,
    area_sqm DOUBLE PRECISION,
    rights_type TEXT,
    owner_id TEXT,
    owner_name TEXT,
    segmentation TEXT,
    confidence DOUBLE PRECISION,
    evidence TEXT,
    validation_status TEXT DEFAULT 'valid',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ulpin_units_building_idx ON ulpin_units (building_id);

CREATE TABLE IF NOT EXISTS pending_unit_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id TEXT NOT NULL,
    unit_ulpin TEXT NOT NULL,
    proposed_by TEXT NOT NULL,
    patch JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

-- citizen portal: complaints raised from the mobile app
CREATE TABLE IF NOT EXISTS citizen_complaints (
    ticket_id TEXT PRIMARY KEY,
    citizen_id TEXT NOT NULL,
    citizen_name TEXT NOT NULL,
    building_id TEXT,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS citizen_complaints_citizen_idx ON citizen_complaints (citizen_id);


-- one row per extraction run; buildings reference their scan session
CREATE TABLE IF NOT EXISTS lidar_sessions (
    session_id TEXT PRIMARY KEY,
    label TEXT,
    mode TEXT,
    crs TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE lidar_buildings ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX IF NOT EXISTS lidar_buildings_session_idx ON lidar_buildings (session_id);
UPDATE lidar_buildings SET session_id = COALESCE(job_id, 'legacy')
WHERE session_id IS NULL;
INSERT INTO lidar_sessions (session_id, label)
SELECT DISTINCT session_id, 'Imported scan'
FROM lidar_buildings WHERE session_id IS NOT NULL
ON CONFLICT (session_id) DO NOTHING;
ALTER TABLE ulpin_units ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION;
ALTER TABLE ulpin_units ADD COLUMN IF NOT EXISTS evidence TEXT;
ALTER TABLE ulpin_units ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'valid';
-- everything else the UI tracks on a unit (revision, z range, edit history, ...)
ALTER TABLE ulpin_units ADD COLUMN IF NOT EXISTS props JSONB NOT NULL DEFAULT '{}'::jsonb;
"""


@contextmanager
def _conn():
    conn = psycopg2.connect(DSN, connect_timeout=5)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_postgis():
    """Create the extension (if present) and the lidar_buildings table."""
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)


_init_done = False


def ensure_init():
    """
    Lazily run the schema setup on the first successful connection. Covers the
    desktop-app launch race where the backend starts before PostgreSQL is up:
    every public entry point calls this, so persistence recovers as soon as
    the database becomes reachable — no process restart needed.
    """
    global _init_done
    if _init_done:
        return
    try:
        init_postgis()
        _init_done = True
    except Exception:
        pass  # Postgres not reachable yet — retried on the next call


def is_available():
    if not _PSYCOPG2_AVAILABLE:
        return False
    ensure_init()
    try:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return True
    except Exception:
        return False


def _pg_up():
    """Quick check: is PostgreSQL reachable right now?"""
    if not _PSYCOPG2_AVAILABLE:
        return False
    try:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return True
    except Exception:
        return False


def _row_from_feature(feature, session_id):
    p = dict(feature.get("properties") or {})
    geom = feature.get("geometry")
    return {
        "building_id": p.get("building_id"),
        "session_id": session_id,
        "name": p.get("name"),
        "height_m": p.get("height_m"),
        "stories": p.get("stories"),
        "ground_z": p.get("ground_z"),
        "roof_z": p.get("roof_z"),
        "lidar_points": p.get("lidar_points"),
        "height_source": p.get("height_source"),
        "original_height_m": p.get("original_height_m"),
        "original_stories": p.get("original_stories"),
        "original_height_source": p.get("original_height_source"),
        "props": json.dumps(p),
        "geom": json.dumps(geom),
    }


UPSERT = """
INSERT INTO lidar_buildings
    (building_id, session_id, name, height_m, stories, ground_z, roof_z, lidar_points,
     height_source, original_height_m, original_stories, original_height_source,
     props, geom)
VALUES (
    %(building_id)s, %(session_id)s, %(name)s, %(height_m)s, %(stories)s, %(ground_z)s,
    %(roof_z)s, %(lidar_points)s, %(height_source)s, %(original_height_m)s,
    %(original_stories)s, %(original_height_source)s, %(props)s::jsonb,
    ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326))
ON CONFLICT (building_id) DO UPDATE SET
    session_id = EXCLUDED.session_id,
    name = EXCLUDED.name,
    height_m = EXCLUDED.height_m,
    stories = EXCLUDED.stories,
    ground_z = EXCLUDED.ground_z,
    roof_z = EXCLUDED.roof_z,
    lidar_points = EXCLUDED.lidar_points,
    height_source = EXCLUDED.height_source,
    original_height_m = EXCLUDED.original_height_m,
    original_stories = EXCLUDED.original_stories,
    original_height_source = EXCLUDED.original_height_source,
    props = EXCLUDED.props,
    geom = EXCLUDED.geom,
    updated_at = now();
"""


def save_session(session_id, label=None, mode=None, crs=None):
    """Register/refresh a scan session row."""
    if not _pg_up():
        return  # no-op in fallback mode
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO lidar_sessions (session_id, label, mode, crs)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (session_id) DO UPDATE SET
                    label = COALESCE(EXCLUDED.label, lidar_sessions.label),
                    mode = COALESCE(EXCLUDED.mode, lidar_sessions.mode),
                    crs = COALESCE(EXCLUDED.crs, lidar_sessions.crs)
                """,
                (session_id, label, mode, crs),
            )


def delete_building(building_id):
    """Delete a single building row; returns True if a row was removed."""
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM lidar_buildings WHERE building_id = %s", (building_id,))
            return cur.rowcount > 0


def set_edit_status(building_id, status, entry):
    """
    Set props.edit_status on one building and append an audit entry to its
    edit_history — the registrar-confirmation workflow.
    """
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT props FROM lidar_buildings WHERE building_id = %s", (building_id,))
            row = cur.fetchone()
            if not row:
                raise ValueError(f"building {building_id} not found")
            props = row[0] if isinstance(row[0], dict) else json.loads(row[0])
            props["edit_status"] = status
            hist = props.get("edit_history")
            if not isinstance(hist, list):
                hist = []
            if isinstance(entry, dict) and entry:
                hist.append(entry)
            props["edit_history"] = hist
            cur.execute(
                "UPDATE lidar_buildings SET props = %s::jsonb, updated_at = now() "
                "WHERE building_id = %s",
                (json.dumps(props), building_id),
            )


def save_buildings(featurecollection, session_id, label=None, mode=None, crs=None, reconcile=True):
    """
    Upsert every Feature of the FeatureCollection into the given scan session.
    With reconcile=True, rows belonging to THIS session that are missing from
    the payload are deleted (e.g. buildings removed while editing) — other
    sessions are never touched.
    Returns the number of buildings now in the session.
    """
    if not session_id:
        raise ValueError("session_id is required")
    if not _pg_up():
        return _fb_save_buildings(featurecollection, session_id, label=label, reconcile=reconcile)
    ensure_init()
    features = featurecollection.get("features", [])
    save_session(session_id, label=label, mode=mode, crs=crs)
    with _conn() as conn:
        with conn.cursor() as cur:
            rows = [
                _row_from_feature(f, session_id)
                for f in features
                if f.get("properties", {}).get("building_id") and f.get("geometry")
            ]
            if rows:
                psycopg2.extras.execute_batch(cur, UPSERT, rows, page_size=1000)
            if reconcile and rows:
                ids = [
                    f["properties"]["building_id"]
                    for f in features
                    if f.get("properties", {}).get("building_id")
                ]
                cur.execute(
                    "DELETE FROM lidar_buildings "
                    "WHERE session_id = %s AND building_id <> ALL(%s)",
                    (session_id, ids),
                )
            cur.execute(
                "SELECT COUNT(*) FROM lidar_buildings WHERE session_id = %s",
                (session_id,),
            )
            return cur.fetchone()[0]


def fetch_buildings(session_id=None):
    """Saved buildings as a GeoJSON FeatureCollection (WGS84), all sessions or one."""
    if not _pg_up():
        return _fb_fetch_buildings()
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            if session_id:
                cur.execute(
                    "SELECT building_id, session_id, props, ST_AsGeoJSON(geom) "
                    "FROM lidar_buildings WHERE session_id = %s "
                    "ORDER BY updated_at DESC",
                    (session_id,),
                )
            else:
                cur.execute(
                    "SELECT building_id, session_id, props, ST_AsGeoJSON(geom) "
                    "FROM lidar_buildings ORDER BY updated_at DESC"
                )
            rows = cur.fetchall()
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {**r[2], "session_id": r[1]},
                "geometry": json.loads(r[3]),
            }
            for r in rows
        ],
    }


def fetch_building(building_id):
    """One saved building as a GeoJSON Feature, or None."""
    if not _pg_up():
        return _fb_load(_BUILDINGS_FILE).get(building_id)
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT session_id, props, ST_AsGeoJSON(geom) FROM lidar_buildings "
                "WHERE building_id = %s",
                (building_id,),
            )
            r = cur.fetchone()
    if not r:
        return None
    return {"type": "Feature", "properties": {**r[1], "session_id": r[0]}, "geometry": json.loads(r[2])}


def list_sessions():
    """All scan sessions with live building counts, newest first."""
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.session_id, s.label, s.mode, s.crs, s.created_at,
                       COUNT(b.building_id) AS buildings
                FROM lidar_sessions s
                LEFT JOIN lidar_buildings b ON b.session_id = s.session_id
                GROUP BY s.session_id, s.label, s.mode, s.crs, s.created_at
                ORDER BY s.created_at DESC
                """
            )
            rows = cur.fetchall()
    return [
        {
            "session_id": r[0],
            "label": r[1],
            "mode": r[2],
            "crs": r[3],
            "created_at": r[4].isoformat() if r[4] else None,
            "buildings": r[5],
        }
        for r in rows
    ]


def delete_session(session_id):
    """Remove a scan session and all of its buildings."""
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM lidar_buildings WHERE session_id = %s", (session_id,))
            cur.execute("DELETE FROM lidar_sessions WHERE session_id = %s", (session_id,))


def count_buildings():
    if not _pg_up():
        return len(_fb_load(_BUILDINGS_FILE))
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM lidar_buildings")
            return cur.fetchone()[0]


def clear_buildings():
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM lidar_buildings")


# ---------------- 3D ULPIN units ----------------

_UNIT_COLS = (
    "unit_ulpin", "base_ulpin", "floor_index", "unit_no", "polygon", "area_sqm",
    "rights_type", "owner_id", "owner_name", "segmentation", "confidence", "evidence",
    "validation_status",
)

_UNIT_UPSERT = """
INSERT INTO ulpin_units (unit_ulpin, building_id, base_ulpin, floor_index, unit_no, polygon,
                         area_sqm, rights_type, owner_id, owner_name, segmentation,
                         confidence, evidence, validation_status, props)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
ON CONFLICT (unit_ulpin) DO UPDATE SET
  building_id = EXCLUDED.building_id, polygon = EXCLUDED.polygon,
  area_sqm = EXCLUDED.area_sqm, rights_type = EXCLUDED.rights_type,
  owner_id = EXCLUDED.owner_id, owner_name = EXCLUDED.owner_name,
  segmentation = EXCLUDED.segmentation, confidence = EXCLUDED.confidence,
  evidence = EXCLUDED.evidence, validation_status = EXCLUDED.validation_status,
  props = EXCLUDED.props
"""


def _unit_row(building_id, u):
    extra = {k: v for k, v in u.items() if k not in _UNIT_COLS and k != "building_id"}
    return (
        u["unit_ulpin"], building_id, u["base_ulpin"], u["floor_index"], u["unit_no"],
        json.dumps(u["polygon"]), u.get("area_sqm"), u.get("rights_type"),
        u.get("owner_id"), u.get("owner_name"), u.get("segmentation"),
        u.get("confidence"), u.get("evidence"), u.get("validation_status") or "valid",
        json.dumps(extra),
    )


def _unit_from_row(r):
    # r = (building_id, props, *_UNIT_COLS)
    return {**(r[1] or {}), "building_id": r[0], **dict(zip(_UNIT_COLS, r[2:]))}


_UNIT_SELECT = "SELECT building_id, props, " + ", ".join(_UNIT_COLS) + " FROM ulpin_units"


def save_units(building_id, units):
    """Replace the full unit tree of one building; returns the saved count."""
    if not _pg_up():
        for u in units:
            u["building_id"] = building_id
        _fb_delete_units(building_id)
        _fb_save_units(units)
        return len(units)
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM ulpin_units WHERE building_id = %s", (building_id,))
            if units:
                psycopg2.extras.execute_batch(
                    cur, _UNIT_UPSERT, [_unit_row(building_id, u) for u in units], page_size=500
                )
            return len(units)


def save_floor_units(building_id, floor_index, units):
    """Replace the units of a single floor in a building; returns the saved count."""
    if not _pg_up():
        return _fb_save_floor_units(building_id, floor_index, units)
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM ulpin_units WHERE building_id = %s AND floor_index = %s",
                (building_id, floor_index),
            )
            if units:
                psycopg2.extras.execute_batch(
                    cur, _UNIT_UPSERT, [_unit_row(building_id, u) for u in units], page_size=500
                )
            return len(units)


def fetch_units(building_id):
    """All ULPIN units of one building, ordered floor then unit number."""
    if not _pg_up():
        return _fb_fetch_units(building_id)
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                _UNIT_SELECT + " WHERE building_id = %s ORDER BY floor_index, unit_no",
                (building_id,),
            )
            return [_unit_from_row(r) for r in cur.fetchall()]


def fetch_all_units():
    """Every ULPIN unit across all buildings (registrar search index)."""
    if not _pg_up():
        return [u for units in _fb_load(_UNITS_FILE).values() for u in units]
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(_UNIT_SELECT + " ORDER BY building_id, floor_index, unit_no")
            return [_unit_from_row(r) for r in cur.fetchall()]


def delete_units(building_id):
    """Remove the whole unit tree of one building; returns removed count."""
    if not _pg_up():
        return _fb_delete_units(building_id)
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM ulpin_units WHERE building_id = %s", (building_id,))
            return cur.rowcount


# ---------------- unit corrections (surveyor proposes -> registrar resolves) ----
# `patch` holds the whole proposal (before/after/overlap figures) as built by
# the frontend; the unit itself is rewritten through save_units.

def propose_unit_edit(building_id, unit_ulpin, proposed_by, patch):
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM pending_unit_edits "
                "WHERE building_id = %s AND unit_ulpin = %s AND status = 'pending'",
                (building_id, unit_ulpin),
            )
            if cur.fetchone():
                raise ValueError("This unit already has a pending correction")
            cur.execute(
                "INSERT INTO pending_unit_edits (building_id, unit_ulpin, proposed_by, patch) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (building_id, unit_ulpin, proposed_by, json.dumps(patch)),
            )
            return str(cur.fetchone()[0])


def get_pending_unit_edits():
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, patch, status, created_at FROM pending_unit_edits "
                "WHERE status = 'pending' ORDER BY created_at"
            )
            rows = cur.fetchall()
    return [
        {**(r[1] or {}), "id": str(r[0]), "status": r[2], "created_at": r[3].isoformat()}
        for r in rows
    ]


def resolve_unit_edit(edit_id, status, extra=None):
    """Mark a pending correction confirmed/rejected; returns the merged record or None."""
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE pending_unit_edits SET status = %s, resolved_at = now(), "
                "patch = patch || %s::jsonb "
                "WHERE id = %s AND status = 'pending' RETURNING id, patch, status",
                (status, json.dumps(extra or {}), edit_id),
            )
            r = cur.fetchone()
    return {**r[1], "id": str(r[0]), "status": r[2]} if r else None
