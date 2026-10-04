// A stand-in for the backend that runs in the browser, for the frontend-only hosted demo.
//
// It answers the same /api/... calls the app already makes, from a snapshot of the registry
// (public/demo/*.json, made by backend/export_demo_data.py). Changes made by a visitor
// (complaints, proposals, corrections) stay in that visitor's own browser (localStorage).
// Anything that needs real compute, such as scans or floor-plan extraction, answers with a
// clear message instead.
import { digipin } from '../api.js'
import { isValidChecked, splitCheck } from './checkchar.js'
import { bboxOfRing, pointInRing, ringOf } from './geo.js'

const STORE_KEY = 'avani-demo-v1'
const SERVER_ONLY = 'This needs the full server. The hosted demo is a read-mostly snapshot, so scans and floor-plan extraction are switched off.'

const ACCOUNTS = {
  citizen: [
    { username: 'ramesh', password: 'citizen123', name: 'Citizen 1', owner_id: 'OWN-0001' },
    { username: 'kavitha', password: 'kavitha123', name: 'Kavitha Raman', owner_id: 'OWN-0009' },
  ],
  surveyor: [{ username: 'priya', password: 'survey123', name: 'Priya Venkatesan' }],
  registrar: [{ username: 'arun', password: 'register123', name: 'Arun Krishnan' }],
}
const OWNER_NAMES = { 'OWN-0001': 'Citizen 1', 'OWN-0009': 'Kavitha Raman' }
const PROPERTY_LIMITS = { 'OWN-0009': 2 } // a small-holding demo account sees only its first buildings

// ── state: the snapshot plus this browser's own changes ──────────────────────
let loading
function load() {
  loading ??= (async () => {
    const get = (name) => fetch(`/demo/${name}.json`).then((r) => r.json())
    const [fc, units, sessions] = await Promise.all([get('buildings'), get('units'), get('sessions')])
    const s = {
      byId: new Map(fc.features.map((f) => [f.properties.building_id, f])),
      units: new Map(),
      sessions,
      pending: [],
      complaints: [],
      deleted: new Set(),
      sessionsDeleted: new Set(),
      dirtyFeatures: new Set(),
      dirtyUnits: new Set(),
    }
    for (const u of units) {
      if (!s.units.has(u.building_id)) s.units.set(u.building_id, [])
      s.units.get(u.building_id).push(u)
    }
    try {
      const o = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
      if (o) {
        for (const [id, f] of Object.entries(o.features || {})) { s.byId.set(id, f); s.dirtyFeatures.add(id) }
        for (const id of o.deleted || []) { s.byId.delete(id); s.units.delete(id); s.deleted.add(id) }
        for (const [id, list] of Object.entries(o.units || {})) { s.units.set(id, list); s.dirtyUnits.add(id) }
        for (const id of o.sessionsDeleted || []) s.sessionsDeleted.add(id)
        s.pending = o.pending || []
        s.complaints = o.complaints || []
      }
    } catch { /* a corrupt save is ignored */ }
    return s
  })()
  return loading
}

function persist(s) {
  const o = {
    features: {}, units: {}, deleted: [...s.deleted], sessionsDeleted: [...s.sessionsDeleted],
    pending: s.pending, complaints: s.complaints,
  }
  for (const id of s.dirtyFeatures) if (s.byId.has(id)) o.features[id] = s.byId.get(id)
  for (const id of s.dirtyUnits) o.units[id] = s.units.get(id) || []
  try { localStorage.setItem(STORE_KEY, JSON.stringify(o)) } catch { /* storage full or blocked */ }
}

const allUnits = (s) => [...s.units.values()].flat()
const fail = (status, detail) => [status, { detail }]

// ── pieces ported from the backend ───────────────────────────────────────────
function verify(s, code) {
  const [ulpin, check] = splitCheck(code)
  if (check === null) return { status: 'missing_check', message: 'This ID has no check character at the end (the last letter or digit after the final dash).' }
  if (!isValidChecked(`${ulpin}-${check}`)) return { status: 'bad_checksum', message: 'The check character does not match, so the ID was mistyped or altered.' }
  const unit = allUnits(s).find((u) => u.unit_ulpin === ulpin)
  if (!unit) return { status: 'unknown', ulpin, message: 'The ID is well formed but no unit with it is registered.' }
  return { status: 'verified', ulpin, unit }
}

// the vertical stack at a point: the building that has units and contains it, floor by floor
function column(s, lon, lat) {
  let feat = null
  for (const [id, list] of s.units) {
    const f = list.length ? s.byId.get(id) : null
    if (f && pointInRing(lon, lat, ringOf(f.geometry))) { feat = f; break }
  }
  if (!feat) return [null, []]
  const [x0, y0, x1, y1] = bboxOfRing(ringOf(feat.geometry))
  const nx = (lon - x0) / Math.max(x1 - x0, 1e-12)
  const ny = (lat - y0) / Math.max(y1 - y0, 1e-12)
  const fh = Number(feat.properties.floor_height) || 3
  const byFloor = new Map()
  for (const u of s.units.get(feat.properties.building_id)) {
    if (!byFloor.has(u.floor_index)) byFloor.set(u.floor_index, [])
    byFloor.get(u.floor_index).push(u)
  }
  const rows = [...byFloor.keys()].sort((a, b) => a - b).map((f) => {
    const z0 = f > 0 ? (f - 1) * fh : f * fh
    const hit = byFloor.get(f).find((u) => pointInRing(nx, ny, u.polygon))
    return {
      floor_index: f, z_from: +z0.toFixed(2), z_to: +(z0 + fh).toFixed(2),
      space: hit ? 'unit' : 'common area',
      unit: hit && {
        unit_ulpin: hit.unit_ulpin, unit_ulpin_checked: hit.unit_ulpin_checked, unit_no: hit.unit_no,
        owner_name: hit.owner_name, rights_type: hit.rights_type, area_sqm: hit.area_sqm, segmentation: hit.segmentation,
      },
    }
  })
  return [feat, rows]
}

function ownedProperties(s, ownerId) {
  const groups = new Map()
  for (const u of allUnits(s)) {
    if (u.owner_id !== ownerId) continue
    if (!groups.has(u.building_id)) groups.set(u.building_id, [])
    groups.get(u.building_id).push(u)
  }
  let props = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, us]) => {
    const f = s.byId.get(id)
    const ring = f ? ringOf(f.geometry) : []
    const lat = ring.length ? ring.reduce((a, p) => a + p[1], 0) / ring.length : null
    const lon = ring.length ? ring.reduce((a, p) => a + p[0], 0) / ring.length : null
    const pin = lat != null ? digipin(lat, lon) : null
    return {
      building_id: id, name: f?.properties.name || '', stories: f?.properties.stories ?? null, height_m: f?.properties.height_m ?? null,
      edit_status: f?.properties.edit_status ?? null, units: us.length,
      area_sqm: +us.reduce((a, u) => a + (u.area_sqm || 0), 0).toFixed(2),
      min_floor: Math.min(...us.map((u) => u.floor_index)), max_floor: Math.max(...us.map((u) => u.floor_index)),
      base_ulpin: us[0].base_ulpin, footprint: f?.geometry || null,
      center: lat != null ? { lat, lon } : null, digipin: pin && pin !== '—' ? pin : null,
    }
  })
  if (PROPERTY_LIMITS[ownerId]) props = props.slice(0, PROPERTY_LIMITS[ownerId])
  return {
    properties: props,
    summary: {
      properties: props.length, units: props.reduce((a, p) => a + p.units, 0),
      total_area_sqm: +props.reduce((a, p) => a + p.area_sqm, 0).toFixed(2),
    },
  }
}

function cleanRegion(region) {
  if (!region) return null
  const floor = Number.parseInt(region.floor, 10)
  const poly = Array.isArray(region.polygon) ? region.polygon : null
  if (!Number.isFinite(floor) || !poly) return false
  const pts = poly.map((p) => [Math.min(1, Math.max(0, Number(p[0]))), Math.min(1, Math.max(0, Number(p[1])))])
  if (pts.some((p) => p.some(Number.isNaN)) || pts.length < 3 || pts.length > 60) return false
  return { floor, polygon: pts }
}

const complaintsFor = (s, test) => s.complaints.filter(test).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

// ── routing ──────────────────────────────────────────────────────────────────
async function route(method, path, q, body) {
  const s = await load()
  let m

  if (method === 'POST' && path === '/login') {
    const acct = (ACCOUNTS[body?.role] || []).find((a) => a.username === body.username && a.password === body.password)
    if (!acct) return fail(401, 'invalid username or password for this role')
    return [200, { token: `demo-${acct.username}`, role: body.role, username: acct.username, name: acct.name, ...(acct.owner_id && { owner_id: acct.owner_id }) }]
  }

  // buildings and scan sessions
  if (method === 'GET' && path === '/lidar/buildings/status') return [200, { available: true, count: s.byId.size }]
  if (method === 'GET' && path === '/lidar/buildings') {
    const sid = q.get('session_id')
    const features = [...s.byId.values()].filter((f) => !sid || f.properties.session_id === sid)
    return [200, { type: 'FeatureCollection', features }]
  }
  if ((m = path.match(/^\/lidar\/buildings\/([^/]+)$/)) && !['update', 'confirm', 'sync', 'status'].includes(m[1])) {
    const id = decodeURIComponent(m[1])
    if (method === 'GET') return s.byId.has(id) ? [200, s.byId.get(id)] : fail(404, `building ${id} not found`)
    if (method === 'DELETE') {
      if (!s.byId.delete(id)) return fail(404, `building ${id} not found`)
      s.units.delete(id); s.deleted.add(id); persist(s)
      return [200, { status: 'deleted', building_id: id }]
    }
  }
  if (method === 'POST' && path === '/lidar/buildings/update') {
    const f = body?.buildings?.features?.[0]
    const id = f?.properties?.building_id
    if (!id) return fail(400, 'body must contain buildings.features[0] with building_id')
    s.byId.set(id, f); s.dirtyFeatures.add(id); s.deleted.delete(id); persist(s)
    return [200, { status: 'ok', building_id: id }]
  }
  if (method === 'POST' && path === '/lidar/buildings/confirm') {
    const f = s.byId.get(body?.building_id)
    if (!f) return fail(404, `building ${body?.building_id} not found`)
    const props = { ...f.properties, edit_status: body.status, edit_history: [...(f.properties.edit_history || []), ...(body.entry ? [body.entry] : [])] }
    s.byId.set(body.building_id, { ...f, properties: props }); s.dirtyFeatures.add(body.building_id); persist(s)
    return [200, { status: 'ok', building_id: body.building_id, edit_status: body.status }]
  }
  if (method === 'POST' && path === '/lidar/buildings/sync') return fail(501, SERVER_ONLY)
  if (method === 'GET' && path === '/lidar/sessions') {
    return [200, s.sessions.filter((x) => !s.sessionsDeleted.has(x.session_id)).map((x) => ({
      ...x, buildings: [...s.byId.values()].filter((f) => f.properties.session_id === x.session_id).length,
    }))]
  }
  if ((m = path.match(/^\/lidar\/sessions\/([^/]+)$/)) && method === 'DELETE') {
    const sid = decodeURIComponent(m[1])
    for (const [id, f] of [...s.byId]) if (f.properties.session_id === sid) { s.byId.delete(id); s.units.delete(id); s.deleted.add(id) }
    s.sessionsDeleted.add(sid); persist(s)
    return [200, { status: 'deleted', session_id: sid }]
  }
  if (method === 'GET' && path === '/lidar/regions') return [200, { country: 'India', region: 'Tamil Nadu' }]
  if (path.startsWith('/lidar/extract')) return fail(501, SERVER_ONLY)

  // units
  if (method === 'GET' && path === '/lidar/segmentation/status') return [200, { ready: false, path: '', reason: 'Floor-plan extraction runs on the server. This hosted demo has no model.' }]
  if (method === 'GET' && path === '/lidar/units/all') return [200, allUnits(s)]
  if (method === 'GET' && path === '/lidar/units/pending') return [200, s.pending.filter((p) => p.status === 'pending')]
  if (method === 'GET' && path === '/lidar/units') {
    const id = q.get('building_id')
    return [200, { building_id: id, units: s.units.get(id) || [] }]
  }
  if (method === 'PUT' && path === '/lidar/units') {
    s.units.set(body.building_id, body.units); s.dirtyUnits.add(body.building_id); persist(s)
    return [200, { building_id: body.building_id, saved: body.units.length }]
  }
  if (method === 'DELETE' && path === '/lidar/units') {
    const id = q.get('building_id')
    const removed = (s.units.get(id) || []).length
    s.units.set(id, []); s.dirtyUnits.add(id); persist(s)
    return [200, { building_id: id, removed }]
  }
  if (method === 'POST' && path.startsWith('/lidar/units/generate')) return fail(501, SERVER_ONLY)
  if (method === 'POST' && path === '/lidar/units/update') {
    const { building_id: bid, unit_ulpin: ulp, patch } = body || {}
    if (!bid || !ulp || !patch) return fail(400, 'building_id, unit_ulpin and patch are required')
    if (s.pending.some((p) => p.status === 'pending' && p.unit_ulpin === ulp)) return fail(409, 'This unit already has a pending correction')
    const id = crypto.randomUUID()
    s.pending.push({ ...patch, building_id: bid, unit_ulpin: ulp, id, status: 'pending', created_at: new Date().toISOString() })
    persist(s)
    return [200, { status: 'pending', id }]
  }
  if (method === 'POST' && path === '/lidar/units/confirm') {
    if (!['confirmed', 'rejected'].includes(body?.status)) return fail(400, 'status must be confirmed or rejected')
    const p = s.pending.find((x) => x.id === body.id && x.status === 'pending')
    if (!p) return fail(404, 'pending edit not found')
    Object.assign(p, body.resolution || {}, { status: body.status })
    persist(s)
    return [200, p]
  }

  // ids, verification and lookups
  if (method === 'GET' && path === '/ulpin/verify') return [200, verify(s, q.get('code'))]
  if (method === 'GET' && path === '/lidar/column') {
    const [feat, rows] = column(s, Number(q.get('lon')), Number(q.get('lat')))
    if (!feat) return [200, { found: false, message: 'No registered building at this location.' }]
    const p = feat.properties
    return [200, { found: true, building: { building_id: p.building_id, name: p.name, stories: p.stories, height_m: p.height_m }, column: rows }]
  }

  // citizen portal
  if (method === 'GET' && path === '/citizen/profile') {
    const id = q.get('owner_id') || 'OWN-0001'
    return [200, { owner_id: id, name: OWNER_NAMES[id] || allUnits(s).find((u) => u.owner_id === id)?.owner_name || id, role: 'citizen', registered_on: '2024-11-03' }]
  }
  if (method === 'GET' && path === '/citizen/properties') return [200, ownedProperties(s, q.get('owner_id') || 'OWN-0001')]
  if (method === 'GET' && path === '/citizen/complaints') return [200, complaintsFor(s, (c) => c.citizen_id === (q.get('owner_id') || 'OWN-0001'))]
  if (method === 'GET' && path === '/lidar/complaints') return [200, complaintsFor(s, (c) => c.building_id === q.get('building_id'))]
  if (method === 'POST' && path === '/citizen/complaints') {
    const subject = String(body?.subject || '').trim()
    const description = String(body?.description || '').trim()
    if (!subject || !description) return fail(400, 'subject and description are required')
    const region = cleanRegion(body.region)
    if (region === false) return fail(400, 'the marked area needs between 3 and 60 corners')
    const ownerId = body.owner_id || 'OWN-0001'
    const now = new Date().toISOString()
    const ticket = `CMP-${Math.floor(100000 + Math.random() * 900000)}`
    s.complaints.push({
      ticket_id: ticket, citizen_id: ownerId, citizen_name: OWNER_NAMES[ownerId] || ownerId, building_id: body.building_id || null,
      category: String(body.category || 'other').trim().toLowerCase(), subject, description, status: 'submitted',
      created_at: now, updated_at: now, region,
    })
    persist(s)
    return [200, { ticket_id: ticket, status: 'submitted', created_at: now }]
  }

  return fail(404, `no such endpoint in the hosted demo: ${method} ${path}`)
}

export function installDemoServer() {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input.url
    if (!raw.startsWith('/api/')) return realFetch(input, init)
    const url = new URL(raw, window.location.origin)
    let body = init.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = null } }
    else if (body instanceof FormData) body = Object.fromEntries(body.entries())
    const [status, data] = await route((init.method || 'GET').toUpperCase(), url.pathname.slice(4), url.searchParams, body)
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  }
}
