"""
Citizen portal data layer for the Layerd mobile app.

Everything a citizen sees on the phone is derived from the same PostGIS
records the surveyors produce: their properties are the ULPIN units the
demo owner registry assigned them (`ulpin.py` — Citizen 1 is OWN-0001),
their taxes are computed deterministically from unit area, and complaints
get their own table (with an in-memory fallback when the DB is down).

Identity is demo-grade like the rest of the backend: the citizen is
resolved by name or owner_id, defaulting to the demo citizen account.
"""

import hashlib
import json
from datetime import date, datetime, timedelta

from .digipin import digipin_encode, digipin_format

# ₹ per sqm of unit area per financial year (demo rate)
TAX_RATE_PER_SQM = 8.0

DEMO_CITIZEN = ("OWN-0001", "Citizen 1")

# demo small-holding accounts: cap how many buildings each citizen sees.
# "kavitha" logs in as Kavitha Raman and sees only her first 2 properties.
DEMO_PROPERTY_LIMITS = {
    "OWN-0009": 2,
}

# second citizen login (handled by /login alongside ramesh)
CITIZEN_LOGINS = {
    "ramesh": {"password": "citizen123", "owner_id": "OWN-0001"},
    "kavitha": {"password": "kavitha123", "owner_id": "OWN-0009"},
}

# contact details for the demo citizen; other owners get deterministic fakes
PROFILE_EXTRA = {
    "OWN-0001": {
        "phone": "+91 98407 22114",
        "email": "ramesh.iyer@example.in",
        "address": "12/4, Bharathi Street, Anna Nagar, Chennai 600040",
        "aadhaar": "XXXX-XXXX-4417",
    },
}

_MEM_COMPLAINTS = []


def _digest(text):
    return hashlib.sha256(str(text).encode("utf-8")).hexdigest()


def _fy(today=None):
    """Financial year label like '2026-27' (Indian FY runs Apr–Mar)."""
    t = today or date.today()
    start = t.year if t.month >= 4 else t.year - 1
    return f"{start}-{str(start + 1)[2:]}"


def _resolve_owner(name=None, owner_id=None):
    from .ulpin import OWNERS

    if owner_id:
        for oid, full in OWNERS:
            if oid == owner_id:
                return oid, full
    if name:
        wanted = str(name).strip().lower()
        for oid, full in OWNERS:
            if full.lower() == wanted:
                return oid, full
    return DEMO_CITIZEN  # demo default: the pre-filled citizen account


def profile(name=None, owner_id=None):
    oid, full = _resolve_owner(name, owner_id)
    extra = PROFILE_EXTRA.get(oid)
    if extra is None:
        h = _digest(oid)
        extra = {
            "phone": f"+91 9{h[0:4]} {h[4:8]}",
            "email": f"{full.split()[0].lower()}.{full.split()[-1].lower()}@example.in",
            "address": f"Plot {int(h[0:3], 16) % 900 + 100}, Civil Lines, Chennai 6000{int(h[3:5], 16) % 90 + 10:03d}",
            "aadhaar": f"XXXX-XXXX-{h[0:4]}",
        }
    return {
        "owner_id": oid,
        "name": full,
        "role": "citizen",
        **extra,
        "registered_on": "2024-11-03",
    }


# ---------------- complaints ----------------

def add_complaint(citizen_id, citizen_name, category, subject, description, building_id=None, region=None):
    """Persist a complaint — Postgres first, in-memory fallback for demos."""
    h = _digest(f"{citizen_id}:{subject}:{datetime.utcnow().isoformat()}")
    ticket = f"CMP-{int(h[0:6], 16) % 900000 + 100000}"
    now = datetime.utcnow().isoformat()
    try:
        from .postgis import _conn, ensure_init

        ensure_init()
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO citizen_complaints
                       (ticket_id, citizen_id, citizen_name, building_id, category,
                        subject, description, status, created_at, updated_at, region)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, 'submitted', %s, %s, %s)""",
                    (ticket, citizen_id, citizen_name, building_id, category,
                     subject, description, now, now, json.dumps(region) if region else None),
                )
    except Exception:
        _MEM_COMPLAINTS.append({
            "ticket_id": ticket, "citizen_id": citizen_id, "citizen_name": citizen_name,
            "building_id": building_id, "category": category, "subject": subject,
            "description": description, "status": "submitted",
            "created_at": now, "updated_at": now, "region": region,
        })
    return {"ticket_id": ticket, "status": "submitted", "created_at": now}


def list_complaints(citizen_id=None, building_id=None):
    """A citizen's complaints, or every complaint filed against one building (staff view)."""
    where, arg = ("citizen_id = %s", citizen_id) if citizen_id else ("building_id = %s", building_id)
    try:
        from .postgis import _conn, ensure_init

        ensure_init()
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""SELECT ticket_id, citizen_id, citizen_name, building_id, category,
                              subject, description, status, created_at, updated_at, region
                       FROM citizen_complaints WHERE {where}
                       ORDER BY created_at DESC""",
                    (arg,),
                )
                rows = cur.fetchall()
        return [
            {
                "ticket_id": r[0], "citizen_id": r[1], "citizen_name": r[2],
                "building_id": r[3], "category": r[4], "subject": r[5],
                "description": r[6], "status": r[7],
                "created_at": r[8].isoformat() if r[8] else None,
                "updated_at": r[9].isoformat() if r[9] else None,
                "region": r[10],
            }
            for r in rows
        ]
    except Exception:
        return [c for c in _MEM_COMPLAINTS if (c["citizen_id"] == citizen_id if citizen_id else c["building_id"] == building_id)]


# ---------------- properties / taxes ----------------

def taxes_for_units(units, fy=None):
    fy = fy or _fy()
    records = [_unit_tax(u, fy) for u in units]
    paid = sum(r["annual_tax"] for r in records if r["status"] == "paid")
    due = sum(r["annual_tax"] for r in records if r["status"] in ("pending", "overdue"))
    return {
        "fy": fy,
        "rate_per_sqm": TAX_RATE_PER_SQM,
        "records": records,
        "summary": {
            "total_annual": round(paid + due, 2),
            "paid": round(paid, 2),
            "due": round(due, 2),
            "overdue_count": sum(1 for r in records if r["status"] == "overdue"),
            "units": len(records),
        },
    }


def _unit_tax(unit, fy):
    """Deterministic demo tax record for one unit in one financial year."""
    area = float(unit.get("area_sqm") or 50.0)
    annual = round(area * TAX_RATE_PER_SQM, 2)
    h = _digest(f"{unit['unit_ulpin']}:{fy}")
    roll = int(h[0:4], 16) % 10
    due = date(int(fy.split("-")[0]) + 1, 3, 31)  # FY ends 31 Mar
    if roll < 6:
        status, paid_on = "paid", due - timedelta(days=int(h[4:6], 16) % 120 + 10)
    elif roll < 9:
        status, paid_on = "pending", None
    else:
        status, paid_on = "overdue", None
    return {
        "unit_ulpin": unit["unit_ulpin"],
        "floor_index": unit.get("floor_index"),
        "unit_no": unit.get("unit_no"),
        "area_sqm": area,
        "annual_tax": annual,
        "status": status,
        "paid_on": paid_on.isoformat() if paid_on else None,
    }


# ---------------- owned properties (PostGIS) ----------------

def _property_limit(owner_id):
    """Max buildings this demo account may see, or None for unlimited."""
    return DEMO_PROPERTY_LIMITS.get(owner_id)


def _apply_limit(owner_id, props):
    limit = _property_limit(owner_id)
    if limit is not None:
        return props[:limit]
    return props


def fetch_owned_units(owner_id):
    """Every ULPIN unit the citizen owns, across all scanned buildings."""
    from .postgis import _conn, ensure_init

    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT unit_ulpin, building_id, base_ulpin, floor_index, unit_no,
                          area_sqm, rights_type, validation_status
                   FROM ulpin_units WHERE owner_id = %s
                   ORDER BY building_id, floor_index, unit_no""",
                (owner_id,),
            )
            rows = cur.fetchall()
    units = [
        {
            "unit_ulpin": r[0], "building_id": r[1], "base_ulpin": r[2],
            "floor_index": r[3], "unit_no": r[4], "area_sqm": r[5],
            "rights_type": r[6], "validation_status": r[7],
        }
        for r in rows
    ]
    limit = _property_limit(owner_id)
    if limit is not None:
        keep = {u["building_id"] for u in units}  # same order as properties query
        allowed = sorted(keep)[:limit]
        units = [u for u in units if u["building_id"] in allowed]
    return units


def fetch_owned_properties(owner_id):
    """Buildings the citizen owns at least one unit in, with live rollups."""
    from .postgis import _conn, ensure_init

    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT u.building_id, COALESCE(b.name, '') AS name, b.stories,
                          b.height_m, b.props->>'edit_status' AS edit_status,
                          COUNT(*) AS units, SUM(u.area_sqm) AS area_sqm,
                          MIN(u.floor_index) AS min_floor, MAX(u.floor_index) AS max_floor,
                          MIN(u.base_ulpin) AS base_ulpin,
                          ST_AsGeoJSON(b.geom) AS geom,
                          ST_Y(ST_Centroid(b.geom)) AS lat, ST_X(ST_Centroid(b.geom)) AS lon
                   FROM ulpin_units u
                   JOIN lidar_buildings b ON b.building_id = u.building_id
                   WHERE u.owner_id = %s
                   GROUP BY u.building_id, b.name, b.stories, b.height_m, b.props, b.geom
                   ORDER BY u.building_id""",
                (owner_id,),
            )
            rows = cur.fetchall()
    props = []
    for r in rows:
        lat, lon = r[11], r[12]
        props.append({
            "building_id": r[0], "name": r[1], "stories": r[2], "height_m": r[3],
            "edit_status": r[4], "units": r[5],
            "area_sqm": round(float(r[6] or 0), 2),
            "min_floor": r[7], "max_floor": r[8], "base_ulpin": r[9],
            "footprint": json.loads(r[10]) if r[10] else None,
            "center": {"lat": lat, "lon": lon} if lat is not None else None,
            "digipin": digipin_format(digipin_encode(lat, lon)) if lat is not None else None,
        })
    props = _apply_limit(owner_id, props)
    return {
        "properties": props,
        "summary": {
            "properties": len(props),
            "units": sum(p["units"] for p in props),
            "total_area_sqm": round(sum(p["area_sqm"] for p in props), 2),
        },
    }


def fetch_property_detail(owner_id, building_id):
    """One owned building: info + footprint + my units + taxes + status."""
    from .postgis import _conn, ensure_init, fetch_units

    _, citizen_name = _resolve_owner(owner_id=owner_id)
    ensure_init()
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT building_id, COALESCE(name, ''), stories, height_m, ground_z,
                          roof_z, lidar_points, height_source, props, ST_AsGeoJSON(geom),
                          ST_Y(ST_Centroid(geom)), ST_X(ST_Centroid(geom))
                   FROM lidar_buildings WHERE building_id = %s""",
                (building_id,),
            )
            row = cur.fetchone()
    if row is None:
        return None
    # small-holding accounts may only open their allowed properties
    limit = _property_limit(owner_id)
    if limit is not None:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT DISTINCT building_id FROM ulpin_units WHERE owner_id = %s ORDER BY building_id",
                    (owner_id,),
                )
                allowed = [r[0] for r in cur.fetchall()][:limit]
        if building_id not in allowed:
            return None
    props = row[8] or {}
    all_units = fetch_units(building_id)
    own_units = [u for u in all_units if u.get("owner_id") == owner_id]
    lat, lon = row[10], row[11]
    share = round(100.0 * len(own_units) / len(all_units), 1) if all_units else 0.0
    return {
        "building_id": row[0],
        "name": row[1],
        "stories": row[2],
        "height_m": row[3],
        "ground_z": row[4],
        "roof_z": row[5],
        "lidar_points": row[6],
        "height_source": row[7],
        "edit_status": props.get("edit_status"),
        "basements": int(props.get("basements") or 0),
        "edit_history": props.get("edit_history") or [],
        "footprint": json.loads(row[9]) if row[9] else None,
        "center": {"lat": lat, "lon": lon} if lat is not None else None,
        "digipin": digipin_format(digipin_encode(lat, lon)) if lat is not None else None,
        "my_units": own_units,
        "other_units": len(all_units) - len(own_units),
        "my_share_pct": share,
        "deeds": deeds_for(owner_id, citizen_name, building_id, own_units),
        "taxes": taxes_for_units(own_units),
    }


# ---------------- registration deeds (deterministic demo registry) ----------

SRO_OFFICES = (
    "SRO Anna Nagar", "SRO T. Nagar", "SRO Perambur",
    "SRO Adyar", "SRO Velachery", "SRO Egmore",
)


def deeds_for(owner_id, citizen_name, building_id, units):
    """Deterministic mock registration deeds for one property holding."""
    if not units:
        return []
    h = _digest(f"deed:{owner_id}:{building_id}")
    from .ulpin import OWNERS

    other = OWNERS[(int(h[0], 16) + 1) % len(OWNERS)]
    year = 2019 + int(h[1], 16) % 6
    area = sum(float(u.get("area_sqm") or 50.0) for u in units)
    office = SRO_OFFICES[int(h[2], 16) % len(SRO_OFFICES)]
    deed_no = f"DOC-{year}-B1-{int(h[3:9], 16) % 900000 + 100000}"
    month = int(h[9], 16) % 12 + 1
    day = int(h[10], 16) % 27 + 1
    deeds = [{
        "deed_no": deed_no,
        "deed_type": "sale deed",
        "executed_on": f"{year}-{month:02d}-{day:02d}",
        "sro": office,
        "grantor": other[1],
        "grantee": citizen_name,
        "consideration": int(round(area * 38000, -3)),
        "covers": f"{len(units)} ULPIN unit(s)",
        "status": "registered",
    }]
    # a registered mortgage / lease entry for variety
    if int(h[11], 16) % 3 == 0:
        deeds.append({
            "deed_no": f"DOC-{year + 2}-B3-{int(h[12:18], 16) % 900000 + 100000}",
            "deed_type": "lease deed",
            "executed_on": f"{year + 2}-{month:02d}-{day:02d}",
            "sro": office,
            "grantor": citizen_name,
            "grantee": "Retail Tenant (lease)",
            "consideration": int(round(area * 420, -2)),
            "covers": "leasehold rights",
            "status": "registered",
        })
    return deeds


# ---------------- help chatbot ----------------

def chat_reply(message, owner_id, citizen_name):
    """Rule-based assistant answering with the citizen's real records."""
    m = str(message).lower()
    suggestions = ["my property tax", "my properties", "building status", "raise a complaint"]

    def _owned():
        try:
            return fetch_owned_properties(owner_id)
        except Exception:
            return {"properties": [], "summary": {"properties": 0, "units": 0, "total_area_sqm": 0}}

    if m.strip() in ("hi", "hey", "hello") or any(w in m for w in ("vanakkam", "namaste", "good morning", "good evening")):
        return {
            "reply": f"Vanakkam {citizen_name.split()[0]}! I'm the Layerd property assistant. "
                     "I can help with your property tax, your ULPIN units, building status and complaints.",
            "suggestions": suggestions,
        }

    if any(w in m for w in ("tax", "pay", "due", "owed", "amount")):
        try:
            units = fetch_owned_units(owner_id)
            t = taxes_for_units(units)
            s = t["summary"]
            reply = (f"Property tax FY {t['fy']} — annual ₹{s['total_annual']:.0f} "
                     f"({s['units']} units @ ₹{t['rate_per_sqm']}/sqm). "
                     f"Paid: ₹{s['paid']:.0f}. Due: ₹{s['due']:.0f}")
            reply += f", including {s['overdue_count']} overdue unit(s)." if s["overdue_count"] else "."
            return {"reply": reply, "suggestions": ["my properties", "building status", "raise a complaint"]}
        except Exception:
            return {"reply": "I couldn't reach the property records right now — please try again shortly.",
                    "suggestions": suggestions}

    if any(w in m for w in ("property", "ulpin", "own", "asset", "holding")):
        d = _owned()
        if not d["properties"]:
            return {"reply": "No ULPIN units are registered to you yet — units appear after a surveyor generates them for your building.",
                    "suggestions": suggestions}
        lines = [f"• {p['building_id']} — {p['units']} unit(s), {p['area_sqm']:.0f} m²" for p in d["properties"][:6]]
        more = f" …and {len(d['properties']) - 6} more" if len(d["properties"]) > 6 else ""
        return {"reply": f"You own {d['summary']['units']} unit(s) across {d['summary']['properties']} property record(s):\n" + "\n".join(lines) + more,
                "suggestions": ["my property tax", "building status", "raise a complaint"]}

    if any(w in m for w in ("complaint", "grievance", "issue", "ticket", "report")):
        try:
            cs = list_complaints(owner_id)
        except Exception:
            cs = []
        if cs:
            last = cs[0]
            reply = (f"You have {len(cs)} complaint(s) on file. Latest: {last['ticket_id']} "
                     f"({last['category']}) — status “{last['status']}”. "
                     "Raise a new one from the Complaints tab anytime.")
        else:
            reply = "You have no complaints on file. Use the Complaints tab to raise one — you'll get a ticket ID instantly."
        return {"reply": reply, "suggestions": ["my property tax", "my properties", "building status"]}

    if any(w in m for w in ("status", "confirm", "pending", "edit", "survey", "lidar", "scan", "height")):
        d = _owned()
        pending = [p for p in d["properties"] if p.get("edit_status") == "pending"]
        if pending:
            reply = (f"{len(pending)} of your building record(s) have surveyor edits awaiting "
                     f"registrar confirmation (e.g. {pending[0]['building_id']}). "
                     "The record stays official until the registrar confirms.")
        else:
            reply = (f"All {d['summary']['properties']} of your building record(s) are confirmed and official. "
                     "Surveyors measure heights with LiDAR scans; every edit is audited in the record history.")
        return {"reply": reply, "suggestions": ["my property tax", "my properties", "raise a complaint"]}

    if any(w in m for w in ("transfer", "sell", "gift", "mutation", "register")):
        return {"reply": "To transfer a property: both parties visit the sub-registrar with the sale deed and ULPIN. "
                         "The registrar verifies the 3D unit in Layerd, then publishes the mutation to NGDRS. "
                         "Your ULPIN history stays intact.",
                "suggestions": ["my properties", "my property tax", "raise a complaint"]}

    return {
        "reply": "I can help with: property tax dues, your ULPIN properties, building/confirmation status, "
                 "complaints, and property transfer steps. What would you like to know?",
        "suggestions": suggestions,
    }
