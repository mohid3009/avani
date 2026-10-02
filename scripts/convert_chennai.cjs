// One-off converter: raw Overpass JSON → baked demo dataset for the frontend.
// Usage: node convert_chennai.cjs
const fs = require('fs')
const path = require('path')

const rawPath = path.resolve(__dirname, '../chennai_raw.json')
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'))

const BBOX = { minLat: 13.028, maxLat: 13.052, minLon: 80.215, maxLon: 80.248 }
const CAP = 6000 // keep the GPU happy — tagged buildings are kept first

const stableHash = (s) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// storeys: use the real OSM tag when present, otherwise a randomised but
// stable heuristic per building type (jitter from the id, so re-runs agree)
function storiesFor(tags, id) {
  const lv = parseInt(tags['building:levels'] ?? tags.levels, 10)
  if (Number.isFinite(lv) && lv > 0) return Math.min(lv, 30)
  const t = (tags.building || '').toLowerCase()
  const h = stableHash(String(id))
  const rnd = (n) => h % n // 0..n-1, deterministic per building
  let base, spread
  if (t === 'apartments') { base = 3; spread = 9 }        // 3–11 storeys
  else if (['house', 'residential', 'semidetached_house', 'detached', 'terrace', 'bungalow'].includes(t)) { base = 1; spread = 4 }
  else if (['retail', 'commercial', 'office', 'supermarket', 'civic'].includes(t)) { base = 2; spread = 8 }
  else if (['hotel', 'dormitory'].includes(t)) { base = 3; spread = 10 }
  else if (['hospital', 'school', 'college', 'university', 'public', 'government'].includes(t)) { base = 2; spread = 6 }
  else if (['church', 'mosque', 'temple', 'place_of_worship'].includes(t)) return 1
  else { base = 1; spread = 6 }
  let stories = base + rnd(spread)
  // occasional mid-rise outliers (~6%) — breaks up the height profile so the
  // skyline has a few towers sticking out of the low-rise fabric
  if (rnd(100) < 6) stories += 5 + rnd(14)
  return Math.min(stories, 28)
}

// per-building storey height — no two blocks share exactly the same floor
// height, and commercial floors run taller than residential ones
function storeyHeightFor(tags, id) {
  const t = (tags.building || '').toLowerCase()
  const h = stableHash(`h:${id}`)
  const commercial = ['retail', 'commercial', 'office', 'hotel', 'supermarket'].includes(t)
  const low = commercial ? 3.4 : 2.8
  return +(low + (h % 14) / 10).toFixed(2) // commercial 3.4–4.7 m, else 2.8–4.1 m
}

function heightFor(tags, stories, id) {
  const m = /([\d.]+)/.exec(tags.height || tags['building:height'] || '')
  if (m) {
    const v = parseFloat(m[1])
    if (Number.isFinite(v) && v > 0) return Math.min(v, 100)
  }
  return +(stories * storeyHeightFor(tags, id)).toFixed(1)
}

const ringArea = (ring) => {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return a / 2
}

const features = []
const push = (id, tags, geomPts) => {
  if (geomPts.length < 4) return
  const ring = geomPts.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)])
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0])
  const lat = ring.map((c) => c[1])
  const lon = ring.map((c) => c[0])
  if (Math.min(...lat) < BBOX.minLat || Math.max(...lat) > BBOX.maxLat || Math.min(...lon) < BBOX.minLon || Math.max(...lon) > BBOX.maxLon) return
  if (Math.abs(ringArea(ring)) < 2e-9) return // sliver — skip
  const stories = storiesFor(tags, id)
  const height = heightFor(tags, stories, id)
  const tagged = Number.isFinite(parseInt(tags['building:levels'] ?? tags.levels, 10)) || !!tags.height
  features.push({
    type: 'Feature',
    properties: {
      building_id: id,
      name: tags.name || null,
      session_id: 'chennai-t-nagar',
      stories,
      height_m: height,
      basements: 0,
      source: tagged ? 'osm-levels' : 'osm-estimated',
      color: tagged ? '#3f8cff' : '#f5a63b', // blue = real OSM levels, orange = estimated
      edit_status: 'none',
      edit_history: [],
    },
    geometry: { type: 'Polygon', coordinates: [ring] },
  })
}

for (const el of raw.elements || []) {
  if (el.type === 'way' && el.geometry) {
    push(`OSM-W${el.id}`, el.tags || {}, el.geometry)
  } else if (el.type === 'relation' && el.members) {
    // multipolygon relations — each outer member becomes its own footprint
    for (const m of el.members) {
      if (m.role === 'outer' && m.geometry) push(`OSM-R${el.id}N${m.ref}`, el.tags || {}, m.geometry)
    }
  }
}

// tagged buildings first, then fill up to the cap with the estimated ones
const tagged = features.filter((f) => f.properties.source === 'osm-levels')
const rest = features.filter((f) => f.properties.source !== 'osm-levels')
const kept = [...tagged, ...rest].slice(0, CAP)

const outData = JSON.stringify({ type: 'FeatureCollection', features: kept })
// loaded into PostGIS by 3d_map/backend/seed_chennai.py
const outPath = path.resolve(__dirname, '../3d_map/backend/seed/chennai_buildings.json')
fs.writeFileSync(outPath, outData)
console.log(`raw features: ${features.length} (tagged ${tagged.length}) → kept ${kept.length}`)
console.log(`total storey slices: ${kept.reduce((s, f) => s + f.properties.stories, 0)}`)

// height distribution sanity check
const hs = kept.map((f) => f.properties.height_m).sort((a, b) => a - b)
const mean = hs.reduce((a, b) => a + b, 0) / hs.length
const distinct = new Set(hs).size
console.log(`heights: min ${hs[0]} m · median ${hs[Math.floor(hs.length / 2)]} m · mean ${mean.toFixed(1)} m · max ${hs[hs.length - 1]} m · ${distinct} distinct values`)
