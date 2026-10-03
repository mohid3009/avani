// ── API client — FastAPI + PostGIS backend ───────────────────────────────────
// Every record (buildings, scan sessions, ULPIN units, surveyor proposals,
// unit corrections, citizen portfolios) lives in the backend database.
// Small in-memory caches back the synchronous getters the UI calls during
// render (peekUnits, allUnits, citizenOwns, getPending*); they are refreshed
// by getSavedBuildings() and by every mutation below.

import { unitZRange } from './verticalGeometry.js'
import { SESSION_KEY } from './constants.js'
export { unitZRange } from './verticalGeometry.js'

// default '/api' → same origin (proxied by Vite in dev, aliased by FastAPI in
// production); set VITE_API_BASE_URL to point at a separate backend host.
const API_BASE = import.meta.env?.VITE_API_BASE_URL ?? '/api'

async function req(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const d = (await res.json()).detail ?? detail
      // FastAPI validation errors arrive as [{loc, msg}] — never show [object Object]
      detail = typeof d === 'string'
        ? d
        : Array.isArray(d) ? d.map((e) => `${(e.loc || []).filter((p) => p !== 'body').join('.')}: ${e.msg}`).join('; ') : JSON.stringify(d)
    } catch {}
    throw new Error(detail)
  }
  return res.json()
}
const post = (path, body) => req(path, { method: 'POST', body: JSON.stringify(body) })
const notify = (name) => globalThis.window?.dispatchEvent(new Event(name))

// ── caches ───────────────────────────────────────────────────────────────────
let fcCache = { type: 'FeatureCollection', features: [] }
const unitsCache = new Map() // building_id -> units[]
let pendingUnitCache = []

const findFeature = (buildingId) => fcCache.features.find((f) => f.properties.building_id === buildingId)
const putFeature = (feature) => {
  const id = feature.properties.building_id
  const i = fcCache.features.findIndex((f) => f.properties.building_id === id)
  if (i === -1) fcCache.features.push(feature)
  else fcCache.features[i] = feature
}
const setUnits = (buildingId, units) => {
  unitsCache.set(buildingId, units)
  notify('demo-units-changed')
  return units
}

function currentSession() {
  try { return JSON.parse(globalThis.sessionStorage?.getItem(SESSION_KEY)) || null } catch { return null }
}

// ── auth ─────────────────────────────────────────────────────────────────────
export const login = (username, password, role) => post('/login', { username, password, role })

// ── extraction (LiDAR or GIS-parcels-only) ───────────────────────────────────
// lazFile may be null → heights are derived from footprint attributes only.
export const startExtraction = (lazFile, { mode, bbox, bboxCrs, footprintCrs, footprintsFile, epsg, floorHeight }) => {
  const fd = new FormData()
  // always send a laz part — an empty placeholder means "no LiDAR" server-side
  fd.append('laz', lazFile || new Blob([]), lazFile ? lazFile.name : '')
  fd.append('mode', mode)
  if (mode === 'osm') {
    fd.append('xmin', String(bbox.xmin))
    fd.append('ymin', String(bbox.ymin))
    fd.append('xmax', String(bbox.xmax))
    fd.append('ymax', String(bbox.ymax))
    fd.append('bbox_crs', bboxCrs || 'laz')
  } else {
    fd.append('footprints', footprintsFile)
    fd.append('footprints_crs', footprintCrs || 'wgs84')
  }
  if (epsg) fd.append('epsg', String(epsg))
  fd.append('floor_height', String(floorHeight || 3.0))
  return req('/lidar/extract/start', { method: 'POST', body: fd })
}
export const getExtractionStatus = (jobId) => req(`/lidar/extract/${encodeURIComponent(jobId)}`)

// ── saved buildings + scan sessions ──────────────────────────────────────────
const refreshAllUnits = async () => {
  const all = await req('/lidar/units/all')
  unitsCache.clear()
  for (const u of all) {
    if (!unitsCache.has(u.building_id)) unitsCache.set(u.building_id, [])
    unitsCache.get(u.building_id).push(u)
  }
  notify('demo-units-changed')
}

const refreshPendingUnitEdits = async () => {
  pendingUnitCache = await req('/lidar/units/pending')
  notify('demo-pending-unit-edits-changed')
  return pendingUnitCache
}

export const getSavedBuildings = async (sessionId) => {
  const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
  const [fc] = await Promise.all([req(`/lidar/buildings${qs}`), refreshAllUnits(), refreshPendingUnitEdits()])
  if (!sessionId) fcCache = fc
  notify('demo-pending-building-edits-changed')
  return fc
}
export const getSavedStatus = () => req('/lidar/buildings/status')
export const getSessions = () => req('/lidar/sessions')
export const deleteSession = (sessionId) =>
  req(`/lidar/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
export const syncSavedBuildings = (fc, sessionId) =>
  post('/lidar/buildings/sync', { buildings: fc, session_id: sessionId })

// ── building edits & surveyor proposal workflow ──────────────────────────────
// A surveyor's proposal is stored on the building itself (props.pending_proposal)
// so it persists with the record and every registrar sees the same queue.

export const updateBuilding = async (feature) => {
  const res = await post('/lidar/buildings/update', {
    buildings: { type: 'FeatureCollection', features: [feature] },
  })
  putFeature(feature)
  notify('demo-pending-building-edits-changed')
  return res
}

export const getPendingBuildingEdits = () =>
  fcCache.features.map((f) => f.properties.pending_proposal).filter(Boolean)

const ASSET_TYPES = [
  [/\.(dwg|dxf|pdf|svg)$/, 'Floor Plan / Architectural CAD'],
  [/\.(las|laz|ply|pcd)$/, 'LiDAR Point Cloud'],
  [/\.(gltf|glb|obj|fbx|ifc|cityjson)$/, '3D Model'],
]

// Propose a building height / structure / asset update (Surveyor or Registrar)
export const proposeBuildingEdit = async (buildingId, patch, session, spatialAssetFile = null) => {
  const feature = findFeature(buildingId)
  if (!feature) throw new Error('building not found')
  const p = feature.properties

  // ponytail: only the asset's metadata is recorded; upload the file itself once there is file storage
  let assetInfo = null
  if (spatialAssetFile) {
    const name = (spatialAssetFile.name || '').toLowerCase()
    const match = ASSET_TYPES.find(([re]) => re.test(name))
    assetInfo = {
      file_name: spatialAssetFile.name,
      file_size: spatialAssetFile.size,
      asset_type: match ? match[1] : patch.asset_type || 'Floor Plan / Architectural CAD',
      uploaded_at: new Date().toISOString(),
      uploaded_by: session?.name || 'User',
    }
  }

  const before = {
    height_m: p.height_m,
    stories: p.stories,
    basements: p.basements || 0,
    spatial_assets: p.spatial_assets || [],
  }
  const after = {
    height_m: patch.height_m != null ? Number(patch.height_m) : before.height_m,
    stories: patch.stories != null ? Math.max(1, Math.round(Number(patch.stories))) : before.stories,
    basements: patch.basements != null ? Math.max(0, Math.round(Number(patch.basements))) : before.basements,
    spatial_assets: assetInfo ? [...before.spatial_assets, assetInfo] : before.spatial_assets,
  }

  if (session?.role === 'surveyor') {
    // live record stays unchanged until a registrar approves
    const proposal = {
      id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      building_id: buildingId,
      proposed_by: session?.name || 'Surveyor',
      role: 'surveyor',
      before,
      after,
      note: patch.note || '',
      created_at: new Date().toISOString(),
    }
    await updateBuilding({
      ...feature,
      properties: { ...p, edit_status: 'pending', pending_proposal: proposal, pending_proposal_id: proposal.id },
    })
    return { proposal, pending: true }
  }

  // registrar: direct update
  const building = {
    ...feature,
    properties: {
      ...p,
      ...after,
      edit_status: 'confirmed',
      height_source: 'registrar-approved',
      pending_proposal: null,
      pending_proposal_id: null,
      edit_history: [
        ...(p.edit_history || []),
        { change: `Direct edit: Height ${before.height_m}m → ${after.height_m}m (${after.stories} str)`, by: session?.name || 'Registrar', at: new Date().toISOString() },
      ],
    },
  }
  await updateBuilding(building)
  return { building, pending: false }
}

const featureForProposal = (proposalId) => {
  const feature = fcCache.features.find((f) => f.properties.pending_proposal?.id === proposalId)
  if (!feature) throw new Error('proposal not found')
  return feature
}

// Registrar approves a pending building proposal
export const confirmPendingBuildingEdit = async (proposalId, session) => {
  const feature = featureForProposal(proposalId)
  const p = feature.properties
  const { before, after } = p.pending_proposal
  const building = {
    ...feature,
    properties: {
      ...p,
      ...after,
      edit_status: 'confirmed',
      height_source: 'surveyor-verified',
      pending_proposal: null,
      pending_proposal_id: null,
      edit_history: [
        ...(p.edit_history || []),
        { change: `Approved Surveyor proposal: Height ${before.height_m}m → ${after.height_m}m (${after.stories} str)`, by: session?.name || 'Registrar', at: new Date().toISOString() },
      ],
    },
  }
  await updateBuilding(building)
  return { building }
}

// Registrar rejects a pending building proposal
export const rejectPendingBuildingEdit = async (proposalId, session, rejectionReason = '') => {
  const feature = featureForProposal(proposalId)
  const p = feature.properties
  await updateBuilding({
    ...feature,
    properties: {
      ...p,
      edit_status: null,
      pending_proposal: null,
      pending_proposal_id: null,
      edit_history: [
        ...(p.edit_history || []),
        { change: `Rejected Surveyor proposal: ${rejectionReason || 'No reason specified'}`, by: session?.name || 'Registrar', at: new Date().toISOString() },
      ],
    },
  })
  return { ok: true }
}

export const confirmBuildingEdit = async (buildingId, status, entry) => {
  const res = await post('/lidar/buildings/confirm', { building_id: buildingId, status, entry })
  const f = findFeature(buildingId)
  if (f) {
    putFeature({
      ...f,
      properties: { ...f.properties, edit_status: status, edit_history: [...(f.properties.edit_history || []), entry] },
    })
  }
  return res
}

export const deleteBuilding = async (buildingId) => {
  const res = await req(`/lidar/buildings/${encodeURIComponent(buildingId)}`, { method: 'DELETE' })
  fcCache.features = fcCache.features.filter((f) => f.properties.building_id !== buildingId)
  return res
}

export const getRegion = (lat, lon) => req(`/lidar/regions?lat=${lat}&lon=${lon}`)

// ── citizen portfolio ────────────────────────────────────────────────────────
// Ownership comes from the unit registry: a citizen owns a building when at
// least one of its ULPIN units carries their owner_id.

export const myOwnerId = () => currentSession()?.owner_id

export const citizenOwns = (buildingId) => {
  const me = myOwnerId()
  return !!me && (unitsCache.get(buildingId) || []).some((u) => u.owner_id === me)
}

export const citizenProperties = async () => {
  const me = myOwnerId()
  if (!me) return []
  const [{ properties }] = await Promise.all([
    req(`/citizen/properties?owner_id=${encodeURIComponent(me)}`),
    unitsCache.size ? null : refreshAllUnits(),
  ])
  return properties.map((p) => ({
    type: 'Feature',
    geometry: p.footprint,
    properties: { ...p, basements: p.min_floor < 0 ? -p.min_floor : 0 },
  }))
}

// ── ID verification and the vertical column at a location ───────────────────
export const verifyUlpin = (code) => req(`/ulpin/verify?code=${encodeURIComponent(code)}`)
export const probeColumn = (lon, lat) => req(`/lidar/column?lon=${lon}&lat=${lat}`)

// ── 3D ULPIN units ───────────────────────────────────────────────────────────
// GET /lidar/units segments a building on first request (YOLO plan or mock grid).
export const fetchUnits = async (buildingId) => {
  const { units } = await req(`/lidar/units?building_id=${encodeURIComponent(buildingId)}`)
  return { units: setUnits(buildingId, units) }
}

const freshUnits = async (buildingId) => (await fetchUnits(buildingId)).units

const saveUnitTree = async (buildingId, units) => {
  await req('/lidar/units', { method: 'PUT', body: JSON.stringify({ building_id: buildingId, units }) })
  return setUnits(buildingId, units)
}

export const generateFloorUnits = async (buildingId, floorIndex, planFile) => {
  const fd = new FormData()
  fd.append('building_id', buildingId)
  fd.append('floor_index', floorIndex)
  if (planFile) fd.append('plan', planFile)
  const data = await req('/lidar/units/generate_floor', { method: 'POST', body: fd })
  setUnits(buildingId, data.units)
  return data
}

export const generateUnits = async (buildingId, { floors, basements, floorHeight, planFile }) => {
  const fd = new FormData()
  fd.append('building_id', buildingId)
  fd.append('floors', String(floors))
  fd.append('basements', String(basements || 0))
  if (floorHeight) fd.append('floor_height', String(floorHeight))
  if (planFile) fd.append('plan', planFile)
  const data = await req('/lidar/units/generate', { method: 'POST', body: fd })
  setUnits(buildingId, data.units)
  return data
}

export const deleteUnits = async (buildingId) => {
  const res = await req(`/lidar/units?building_id=${encodeURIComponent(buildingId)}`, { method: 'DELETE' })
  setUnits(buildingId, [])
  return res
}

// registrar-only: patch a single unit's record (owner, rights, area, status)
export const updateUnit = async (buildingId, unitUlpin, patch) => {
  const units = await freshUnits(buildingId)
  const idx = units.findIndex((u) => u.unit_ulpin === unitUlpin)
  if (idx === -1) throw new Error('unit not found')
  const next = { ...units[idx] }
  if (next.pending_edit_id) throw new Error('Resolve the pending correction before editing this unit')
  next.revision = (next.revision || 0) + 1
  if (patch.owner_name != null && String(patch.owner_name).trim()) {
    next.owner_name = String(patch.owner_name).trim()
  }
  if (patch.rights_type) next.rights_type = patch.rights_type
  if (patch.area_sqm != null && patch.area_sqm !== '') {
    const n = Number(patch.area_sqm)
    if (!Number.isNaN(n)) next.area_sqm = Math.max(1, Math.round(n))
  }
  if (patch.validation_status) next.validation_status = patch.validation_status
  next.last_edited_by = 'registrar'
  next.updated_at = new Date().toISOString()
  units[idx] = next
  return { units: await saveUnitTree(buildingId, units) }
}

export const peekUnits = (buildingId) => unitsCache.get(buildingId) || []

// every unit across all buildings (for the registrar search index)
export const allUnits = () => [...unitsCache.values()].flat()

// DIGIPIN — India's official digital address code (DoLR / India Post): a
// 10-level 4×4 grid encoding of lat/lon inside India's bounding box (~3.8 m).
// ── Official India Post DIGIPIN Engine (3D-ULPIN Compatible) ──────────────────
// National Geo-Spatial Digital Addressing System (DoP / IIT Hyderabad / ISRO)
const DIGIPIN_GRID = [
  ['F', 'C', '9', '8'],
  ['J', '3', '2', '7'],
  ['K', '4', '5', '6'],
  ['L', 'M', 'P', 'T'],
]

// 2D/3D DIGIPIN Encoder
export const digipin = (lat, lon, floorIndex = null) => {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return '—'
  // DIGIPIN only covers India's bounding box — never clamp a foreign point onto its edge
  if (lat < 2.5 || lat > 38.5 || lon < 63.5 || lon > 99.5) return '—'
  let latMin = 2.5, latMax = 38.5, lonMin = 63.5, lonMax = 99.5
  let out = ''
  for (let level = 0; level < 10; level++) {
    const latDiv = (latMax - latMin) / 4
    const lonDiv = (lonMax - lonMin) / 4
    const row = Math.min(3, Math.max(0, Math.floor((latMax - lat) / latDiv)))
    const col = Math.min(3, Math.max(0, Math.floor((lon - lonMin) / lonDiv)))
    out += DIGIPIN_GRID[row][col]
    if (level === 2 || level === 5) out += '-'
    latMax = latMax - latDiv * row
    latMin = latMax - latDiv
    lonMin = lonMin + lonDiv * col
    lonMax = lonMin + lonDiv
  }
  if (floorIndex != null) {
    const flrStr = floorIndex < 0 ? `B${Math.abs(floorIndex)}` : `F${String(floorIndex).padStart(2, '0')}`
    return `${out} · ${flrStr}`
  }
  return out
}

export const encodeDigipin = digipin

// Validate DIGIPIN string format
export const isValidDigipin = (code) => {
  if (!code || typeof code !== 'string') return false
  const clean = code.replace(/[\s·].*$/, '').replace(/-/g, '').toUpperCase()
  if (clean.length !== 10) return false
  const validChars = new Set(['2', '3', '4', '5', '6', '7', '8', '9', 'C', 'F', 'J', 'K', 'L', 'M', 'P', 'T'])
  return [...clean].every((ch) => validChars.has(ch))
}

// 2D -> 3D DIGIPIN with Vertical Elevation (Z-axis)
export const digipin3D = (lat, lon, floorIndex = 0, floorHeightM = 3.0) => {
  const base2D = digipin(lat, lon)
  const zMin = floorIndex * floorHeightM
  const zMax = (floorIndex + 1) * floorHeightM
  const flrCode = floorIndex < 0 ? `B${Math.abs(floorIndex)}` : `F${String(floorIndex).padStart(2, '0')}`
  return {
    code2D: base2D,
    code3D: `${base2D} · ${flrCode}`,
    floorIndex,
    zExtent: { zMin, zMax, heightM: floorHeightM },
  }
}

// DIGIPIN Reverse Decoder (Code -> Bounding Box & Centroid Coordinates)
export const decodeDigipin = (code) => {
  if (!isValidDigipin(code)) return null
  const clean = code.replace(/[\s·].*$/, '').replace(/-/g, '').toUpperCase()
  
  const charToPos = {}
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      charToPos[DIGIPIN_GRID[r][c]] = { r, c }
    }
  }

  let latMin = 2.5, latMax = 38.5, lonMin = 63.5, lonMax = 99.5
  for (let i = 0; i < clean.length; i++) {
    const pos = charToPos[clean[i]]
    if (!pos) return null
    const latDiv = (latMax - latMin) / 4
    const lonDiv = (lonMax - lonMin) / 4
    const nextLatMax = latMax - latDiv * pos.r
    const nextLatMin = nextLatMax - latDiv
    const nextLonMin = lonMin + lonDiv * pos.c
    const nextLonMax = nextLonMin + lonDiv

    latMax = nextLatMax
    latMin = nextLatMin
    lonMin = nextLonMin
    lonMax = nextLonMax
  }

  const lat = Number(((latMin + latMax) / 2).toFixed(6))
  const lon = Number(((lonMin + lonMax) / 2).toFixed(6))

  // Extract floor index if present (e.g. "4T3-7J2-9LCK · F02")
  let floorIndex = null
  const flrMatch = code.match(/·\s*(F|B)(\d+)/i)
  if (flrMatch) {
    const type = flrMatch[1].toUpperCase()
    const num = parseInt(flrMatch[2], 10)
    floorIndex = type === 'B' ? -num : num
  }

  return {
    lat,
    lon,
    digipin: code.split(' ')[0],
    bounds: { latMin, latMax, lonMin, lonMax },
    resolutionMeters: 3.8,
    floorIndex,
    authority: 'Department of Posts (DoP) / IIT Hyderabad / ISRO'
  }
}

// Async DIGIPIN API fetcher (with official DoLR/India Post standard metadata response)
export const fetchDigipinApi = async (lat, lon, floorIndex = null) => {
  // Simulates high-precision Geo-API call matching official India Post API schema
  await new Promise((res) => setTimeout(res, 20))
  const pin2D = digipin(lat, lon)
  const decoded = decodeDigipin(pin2D)
  return {
    success: true,
    digipin: floorIndex != null ? digipin(lat, lon, floorIndex) : pin2D,
    digipin2D: pin2D,
    coordinates: { lat, lon },
    boundingBox: decoded?.bounds ?? null, // null outside India
    precisionMeters: 3.8,
    gridLevel: 10,
    projection: 'EPSG:4362 / WGS84',
    standard: 'India Post DIGIPIN Technical Spec (March 2025)',
    floorIndex,
    zHeightM: floorIndex != null ? floorIndex * 3.0 : 0
  }
}


// ── Volumetric Overlap Detection Engine ──────────────────────────────────────

// Compute 2D bounding box from normalised polygon [0..1] coordinates
const polyBbox = (poly) => {
  if (!poly || !poly.length) return null
  // Use reduce instead of spread to avoid RangeError on large arrays
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const [x, y] of poly) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { x0, x1, y0, y1 }
}

// 1D interval overlap amount (returns 0 if no overlap)
const intervalOverlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

// 2D bbox overlap area (in normalised 0..1 coords)
const bboxOverlap2D = (bA, bB) => {
  if (!bA || !bB) return 0
  const ox = intervalOverlap(bA.x0, bA.x1, bB.x0, bB.x1)
  const oy = intervalOverlap(bA.y0, bA.y1, bB.y0, bB.y1)
  return ox * oy
}

// Detect 3D volumetric overlaps for a set of units in the same building.
// Returns an array of overlap records: { unitA_ulpin, unitB_ulpin, zOverlapM, xyOverlapNorm, volumeM3 }
export const detectVolumetricOverlaps = (units, footprintAreaM2 = 300) => {
  const overlaps = []
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i]
      const b = units[j]
      const zA = unitZRange(a)
      const zB = unitZRange(b)
      const dz = intervalOverlap(zA.zMin, zA.zMax, zB.zMin, zB.zMax)
      if (dz <= 0) continue
      const bboxA = polyBbox(a.polygon)
      const bboxB = polyBbox(b.polygon)
      const xyNorm = bboxOverlap2D(bboxA, bboxB)
      if (xyNorm <= 0) continue
      const xyM2 = xyNorm * footprintAreaM2
      const vol = +(dz * xyM2).toFixed(2)
      overlaps.push({
        unitA_ulpin: a.unit_ulpin,
        unitB_ulpin: b.unit_ulpin,
        ownerA: a.owner_name,
        ownerB: b.owner_name,
        floorA: a.floor_index,
        floorB: b.floor_index,
        zOverlapM: +dz.toFixed(2),
        xyOverlapM2: +xyM2.toFixed(2),
        volumeM3: vol,
      })
    }
  }
  return overlaps
}

// Shortcut: get overlaps touching a specific unit ULPIN
export const overlapsForUnit = (units, targetUlpin, footprintAreaM2) => {
  const all = detectVolumetricOverlaps(units, footprintAreaM2)
  return all.filter((o) => o.unitA_ulpin === targetUlpin || o.unitB_ulpin === targetUlpin)
}

// ── Pending Unit Corrections (Surveyor → Registrar Approval) ─────────────────
// Proposals live in the backend's pending_unit_edits table; the unit tree is
// re-read from the server before every decision so a stale browser can never
// approve a correction against an outdated unit.

// synchronous view of the queue (refreshed by getSavedBuildings and every decision)
export const getPendingUnitEdits = () => pendingUnitCache

// Surveyor proposes a correction to a unit
export const proposeUnitCorrection = async (buildingId, unitUlpin, patch, session) => {
  const units = await freshUnits(buildingId)
  const idx = units.findIndex((u) => u.unit_ulpin === unitUlpin)
  if (idx === -1) throw new Error('unit not found')

  const before = { ...units[idx] }
  if (before.pending_edit_id) throw new Error('This unit already has a pending correction')
  const after = { ...before }
  if (patch.owner_name != null && String(patch.owner_name).trim()) after.owner_name = String(patch.owner_name).trim()
  if (patch.rights_type) after.rights_type = patch.rights_type
  if (patch.area_sqm != null && patch.area_sqm !== '') {
    const n = Number(patch.area_sqm)
    if (!Number.isNaN(n)) after.area_sqm = Math.max(1, Math.round(n))
  }
  if (patch.z_min != null && String(patch.z_min).trim() === '') throw new Error('Minimum height is required')
  if (patch.z_max != null && String(patch.z_max).trim() === '') throw new Error('Maximum height is required')
  if (patch.z_min != null) after.z_min = Number(patch.z_min)
  if (patch.z_max != null) after.z_max = Number(patch.z_max)
  unitZRange(after)

  const overlapVolume = (list) => overlapsForUnit(list, unitUlpin).reduce((s, o) => s + o.volumeM3, 0)
  const overlapBefore = overlapVolume(units)
  const overlapAfter = overlapVolume(units.map((u, i) => (i === idx ? after : u)))

  const entry = {
    building_id: buildingId,
    unit_ulpin: unitUlpin,
    unit_revision: before.revision || 0,
    before: {
      owner_name: before.owner_name,
      rights_type: before.rights_type,
      area_sqm: before.area_sqm,
      z_min: before.z_min,
      z_max: before.z_max,
      validation_status: before.validation_status,
    },
    after: {
      owner_name: after.owner_name,
      rights_type: after.rights_type,
      area_sqm: after.area_sqm,
      z_min: after.z_min,
      z_max: after.z_max,
    },
    overlap_before_m3: +overlapBefore.toFixed(2),
    overlap_after_m3: +overlapAfter.toFixed(2),
    resolution_note: patch.resolution_note || '',
    proposed_by: session?.name || 'Surveyor',
    proposed_role: session?.role || 'surveyor',
    created_at: new Date().toISOString(),
  }
  const { id: editId } = await post('/lidar/units/update', {
    building_id: buildingId, unit_ulpin: unitUlpin, proposed_by: entry.proposed_by, patch: entry,
  })

  // mark the unit itself as awaiting approval
  units[idx] = { ...before, pending_edit_id: editId, validation_status: 'pending_approval', updated_at: new Date().toISOString(), last_edited_by: entry.proposed_by }
  await saveUnitTree(buildingId, units)
  await refreshPendingUnitEdits()

  return { editId, overlapBefore, overlapAfter, entry: { ...entry, id: editId, status: 'pending' } }
}

// load a pending correction + the live unit it targets, rejecting stale decisions
const pendingDecision = async (editId) => {
  const entry = (await refreshPendingUnitEdits()).find((e) => e.id === editId)
  if (!entry) throw new Error('This correction is no longer pending')
  const units = await freshUnits(entry.building_id)
  const idx = units.findIndex((u) => u.unit_ulpin === entry.unit_ulpin)
  if (idx === -1) throw new Error('unit not found')
  if (units[idx].pending_edit_id !== editId) throw new Error('This correction is no longer pending')
  return { entry, units, idx }
}

// ponytail: the unit save and the queue update are two requests, not one transaction; move both server-side if partial failures show up
const resolveEdit = async (editId, status, registrarSession, extra = {}) => {
  await post('/lidar/units/confirm', {
    id: editId, status,
    resolution: { resolved_by: registrarSession?.name, resolved_at: new Date().toISOString(), ...extra },
  })
  await refreshPendingUnitEdits()
}

// Registrar approves a pending unit correction
export const confirmUnitCorrection = async (editId, registrarSession) => {
  const { entry, units, idx } = await pendingDecision(editId)
  const current = units[idx]
  if (entry.unit_revision != null && (current.revision || 0) !== entry.unit_revision) {
    throw new Error('The unit changed after this correction was proposed')
  }
  const candidate = { ...current, ...entry.after }
  unitZRange(candidate)
  if (overlapsForUnit(units.map((u, i) => (i === idx ? candidate : u)), entry.unit_ulpin).length) {
    throw new Error('Resolve all volumetric overlaps before approving this correction')
  }

  const by = registrarSession?.name || 'Registrar'
  const next = {
    ...candidate,
    revision: (current.revision || 0) + 1,
    validation_status: 'confirmed',
    pending_edit_id: null,
    updated_at: new Date().toISOString(),
    last_edited_by: by,
    edit_history: [
      ...(current.edit_history || []),
      { at: new Date().toISOString(), by, role: 'registrar',
        change: `Approved correction proposed by ${entry.proposed_by}: area ${entry.before.area_sqm}→${entry.after.area_sqm} m², overlap resolved ${entry.overlap_before_m3}→${entry.overlap_after_m3} m³` },
    ],
  }
  units[idx] = next
  await saveUnitTree(entry.building_id, units)
  await resolveEdit(editId, 'confirmed', registrarSession)
  return { ok: true, unit: next }
}

// Registrar rejects a pending unit correction
export const rejectUnitCorrection = async (editId, registrarSession, reason = '') => {
  const { entry, units, idx } = await pendingDecision(editId)
  const by = registrarSession?.name || 'Registrar'
  units[idx] = {
    ...units[idx],
    validation_status: entry.before.validation_status || 'confirmed',
    pending_edit_id: null,
    updated_at: new Date().toISOString(),
    last_edited_by: by,
    edit_history: [
      ...(units[idx].edit_history || []),
      { at: new Date().toISOString(), by, role: 'registrar',
        change: `Rejected correction proposed by ${entry.proposed_by}${reason ? `: ${reason}` : ''}` },
    ],
  }
  await saveUnitTree(entry.building_id, units)
  await resolveEdit(editId, 'rejected', registrarSession, { rejection_reason: reason })
  return { ok: true }
}

// Import an external footprint (e.g. an Overture building picked in the ULPIN view)
export const saveBuildingFeature = (feature) =>
  updateBuilding({
    ...feature,
    properties: { session_id: 'overture_import', ...feature.properties },
  })

// ── citizen complaints (backend citizen_complaints table) ───────────────────
// the backend stores a free-text subject; the portal files one ticket per unit,
// so the unit's ULPIN goes in subject and the issue type in category.
const toComplaint = (c) => ({
  id: c.ticket_id,
  unitId: c.subject,
  buildingId: c.building_id,
  // backend lowercases the category; the old mobile app used snake_case
  issueType: c.category.replace(/_/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase()),
  description: c.description,
  status: c.status,
  date: (c.created_at || '').slice(0, 10),
})

export const citizenComplaints = async () => {
  const me = myOwnerId()
  if (!me) return []
  return (await req(`/citizen/complaints?owner_id=${encodeURIComponent(me)}`)).map(toComplaint)
}

export const fileComplaint = async ({ unitId, buildingId, issueType, description }) => {
  const res = await post('/citizen/complaints', {
    owner_id: myOwnerId(), subject: unitId, building_id: buildingId, category: issueType, description,
  })
  return res.ticket_id
}

export const getBuilding = (buildingId) => req(`/lidar/buildings/${encodeURIComponent(buildingId)}`)

// building id of a unit, from the registry index (loaded once on demand)
export const buildingIdOfUnit = async (unitUlpin) => {
  if (!unitsCache.size) await refreshAllUnits()
  return allUnits().find((u) => u.unit_ulpin === unitUlpin)?.building_id ?? null
}

export const citizenProfile = () => {
  const me = myOwnerId()
  return me ? req(`/citizen/profile?owner_id=${encodeURIComponent(me)}`) : Promise.resolve(null)
}

// which floor-plan model unit extraction uses (or why it can't)
export const segmentationStatus = () => req('/lidar/segmentation/status')
