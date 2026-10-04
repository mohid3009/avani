# Avani — Running locally

Frontend (React + Vite) talks to the FastAPI backend; every record — buildings,
scan sessions, ULPIN units, surveyor proposals, unit corrections, citizen
complaints — lives in PostgreSQL/PostGIS.

## 1. Database

PostgreSQL with the PostGIS extension, reachable at
`postgresql://postgres:postgres@localhost:5432/layerd` (override with
`DATABASE_URL`). Tables are created automatically on first connection.

Without PostgreSQL the backend falls back to JSON files in `3d_map/backend/data/`
for buildings and units (corrections and complaints need PostgreSQL).

## 2. Backend

```powershell
cd 3d_map\backend
pip install -r requirements.txt
python seed_chennai.py      # once: loads Chennai · T. Nagar (6,625 buildings) + units for 40 of them
uvicorn app.main:app --port 8000
```

## 3. Frontend

```powershell
cd 3d_map\frontend
npm install
npm run dev                 # http://localhost:5173 — /api is proxied to :8000
```

Set `VITE_API_BASE_URL` at build time to point a deployed frontend at a separate backend host.

## Floor-plan model (unit extraction)

Copy your trained YOLO segmentation weights to `3d_map/models/units.pt`
(or set `YOLO_WEIGHTS=C:\path	o\model.pt`) and restart the backend.

- `GET /api/lidar/segmentation/status` shows whether the model loaded and its class names;
  surveyors see the same status in *Your work* and in the unit editor.
- By default every class the model predicts counts as a unit. If it also predicts
  rooms, walls or doors, list just the unit classes: `YOLO_UNIT_CLASSES=apartment,shop`.
- `YOLO_CONF` (default 0.35) is the minimum detection confidence.
- The stock COCO checkpoint in `yolo-v11-wt/` is refused — it detects people and cars, not units.
- Without a model or a plan image, units are *estimated* and labelled as such.

## Real building heights (Google Open Buildings 2.5D)

```powershell
pip install earthengine-api
earthengine authenticate                                       # your Google account
cd 3d_mapackend
python heights_open_buildings.py --project YOUR_GCP_PROJECT --dry-run
python heights_open_buildings.py --project YOUR_GCP_PROJECT
```

Needs an Earth Engine-enabled Google Cloud project. Takes the median 2023
`building_height` inside each footprint; LiDAR-measured and approved heights are kept.

## Accounts (demo-grade auth)

| Role | Username | Password |
|------|----------|----------|
| Citizen | ramesh | citizen123 |
| Citizen (small holding) | kavitha | kavitha123 |
| Surveyor | priya | survey123 |
| Registrar | arun | register123 |

Unit ownership comes from the backend's deterministic owner registry
(`app/ulpin.py`): each generated unit is assigned to one of 12 demo owners.

## Rebuilding the Chennai dataset

`scripts/convert_chennai.cjs` turns a raw Overpass dump (`chennai_raw.json`) into
`3d_map/backend/seed/chennai_buildings.json`; re-run `python seed_chennai.py` afterwards.

## Frontend-only hosting (free demo, no backend)

`npm run build:demo` (in `3d_map/frontend`) builds the app so it needs no server: a small stand-in
(`src/demo/demoServer.js`) answers the `/api` calls in the browser from a snapshot of the registry in
`public/demo/*.json`. Buildings, units, UPC cards, ID verification, complaints and the proposal
workflow all work; changes a visitor makes stay in that visitor's browser. Scans, rescans and floor-plan
extraction need the real server and answer with a message.

Refresh the snapshot after changing the database: `cd 3d_map/backend && python export_demo_data.py`.

Host it on Vercel (or any static host): import the repo, set **Root Directory** to `3d_map/frontend`;
`vercel.json` already sets the build command (`npm run build:demo`) and output (`dist`).
