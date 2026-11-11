# Avani — 3D ULPIN Generation & Vertical Property Mapping

**Smart India Hackathon 2026 · Problem Statement SIH26011**
**Live demo: <https://avani3d.vercel.app/>**

> One parcel, every dimension.

India's ULPIN (Unique Land Parcel Identification Number) identifies the *footprint* of a plot, but says
nothing about what sits above or below it: a 20-storey apartment block and an empty plot carry the same ID.
Avani extends ULPIN into the vertical dimension. It generates a unique, verifiable ID for every
flat, shop or basement unit, ties it back to the base parcel, and shows the whole building as a 3D stack.

## What it does

| Capability | How |
|---|---|
| **3D ULPIN generation** | Each unit gets `{base_ULPIN}-F{floor}-U{unit}-{check}`, e.g. `TN-07-4821-9034-7756-F3-U2-T`. Basements use negative floors (`F-1`). The last character is a check character, so a mistyped ID is caught. |
| **Vertical property mapping** | Every storey is a coloured slice; basements render below ground. Open a building in 3D, on a Cesium globe, or as an exploded floor-by-floor stack. |
| **Backward compatible** | The base ULPIN prefix is unchanged, so existing 2D land records still resolve. |
| **DIGIPIN** | Each parcel also carries its DIGIPIN (India Post grid code) from its coordinates. |
| **Volumetric validation** | Z-range per unit and overlap detection catch two units claiming the same volume. |
| **Unified Property Card (UPC)** | A shareable card per unit with a QR code and a public ID-verification page (`/verify/:code`). |
| **Three role portals** | Citizen (my units, records, complaints), Surveyor (scan, propose heights/units), Registrar (approve, resolve disputes). |
| **Real dataset** | ~6,600 OpenStreetMap building footprints for Chennai · T. Nagar, with Google Open Buildings 2.5D heights. |

NGDRS hand-off is a mock payload only; there is no real government integration.

## Try the live demo

Open <https://avani3d.vercel.app/> → **Launch demo** and sign in (credentials are pre-filled):

| Role | Username | Password |
|------|----------|----------|
| Citizen | `ramesh` | `citizen123` |
| Citizen (small holding) | `kavitha` | `kavitha123` |
| Surveyor | `priya` | `survey123` |
| Registrar | `arun` | `register123` |

Suggested walkthrough: **Citizen → Records → Capitale Tower → View Building 3D**, then **City map** to
see storey slices over satellite imagery, then **Check an ID** on the Records page.

The hosted demo is frontend-only: a small in-browser stand-in for the API (`src/demo/demoServer.js`)
serves a snapshot of the registry, and changes you make stay in your browser. Scans, rescans and
floor-plan extraction need the real backend.

## Architecture

```
3d_map/
├── frontend/   React 18 + Vite, MapLibre GL (city view), Three.js / react-three-fiber (unit & building 3D),
│               CesiumJS (globe, loaded from CDN on demand)
├── backend/    FastAPI + PostgreSQL/PostGIS (JSON-file fallback); ULPIN + check-char generation (app/ulpin.py),
│               DIGIPIN, LiDAR footprint conflation, YOLO floor-plan unit extraction
└── yolo-v11-wt/  stock checkpoint (not a unit model — drop your trained weights in 3d_map/models/units.pt)
scripts/        Chennai dataset converter, vertical-geometry tests
```

Full requirements and data model: [`3D_ULPIN_PRD.md`](3D_ULPIN_PRD.md) · user stories: [`userstories.md`](userstories.md) ·
status and design notes: [`PROJECT_SUMMARY.md`](PROJECT_SUMMARY.md).

## Run locally

**Frontend only (no backend, same as the hosted demo)**

```bash
cd 3d_map/frontend
npm install
npm run build:demo && npm run preview     # http://localhost:4173
```

**Full stack** — see [`run.md`](run.md) for PostgreSQL/PostGIS setup:

```bash
cd 3d_map/backend && pip install -r requirements.txt
python seed_chennai.py && uvicorn app.main:app --port 8000
cd ../frontend && npm run dev             # http://localhost:5173, /api proxied to :8000
```

## Tests

```bash
cd 3d_map/frontend && npm test            # vertical geometry & overlap logic
cd 3d_map/backend && python test_check_char.py && python test_conflate.py
```

## Deploy

- **Vercel (demo):** import the repo, set **Root Directory** to `3d_map/frontend`. `vercel.json` already runs
  `npm run build:demo` and serves `dist`.
- **Render (full stack):** `render.yaml` + `Dockerfile`; set `DATABASE_URL` (e.g. Neon) in the dashboard.

## Known limits

- Floor heights and unit layouts are *estimated* unless a floor-plan model or LiDAR scan is supplied; the UI labels them as such.
- Owner data comes from a deterministic demo registry, not a real land-records system.
- Auth is demo-grade.
