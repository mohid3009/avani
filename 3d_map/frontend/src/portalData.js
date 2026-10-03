// ── Citizen portal records ───────────────────────────────────────────────────
// React hooks that load backend records and shape them for the portal pages
// (passport, property details, UPC, records, complaints, profile).

import { useEffect, useState } from 'react'
import {
  buildingIdOfUnit, citizenComplaints, citizenProfile, citizenProperties,
  digipin, fetchUnits, getBuilding, getSavedBuildings, peekUnits,
} from './api.js'

// registry statuses that count as a clean title
// unnamed buildings get a short, stable label
export const buildingName = (p) => p.name || `Building ${String(p.building_id).slice(-4)}`
export const VERIFIED = new Set(['valid', 'confirmed', 'verified'])
// height sources that are real measurements, not estimates
export const MEASURED = new Set(['lidar', 'google-open-buildings-2.5d', 'surveyor-verified', 'registrar-approved', 'tag-height'])
const toStatus = (s) => (s === 'conflict' ? 'conflict' : VERIFIED.has(s) ? 'verified' : 'review')
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '—')

const EXTRACTION = {
  lidar: 'LiDAR point-cloud measurement',
  'google-open-buildings-2.5d': 'Google Open Buildings 2.5D (2023)',
  'tag-height': 'Height tag in the map data',
  'surveyor-verified': 'Surveyor-verified measurement',
  'registrar-approved': 'Registrar-approved measurement',
}

function centroid(geometry) {
  const ring = geometry?.type === 'Polygon' ? geometry.coordinates[0] : geometry?.coordinates?.[0]?.[0]
  if (!ring?.length) return null
  const n = ring.length
  return { lat: ring.reduce((s, c) => s + c[1], 0) / n, lon: ring.reduce((s, c) => s + c[0], 0) / n }
}

function toBuilding(feature, units) {
  const p = feature.properties
  const c = centroid(feature.geometry)
  const b = {
    id: p.building_id,
    name: buildingName(p),
    baseUlpin: units[0]?.base_ulpin || 'not yet assigned',
    // no postal address in the dataset — the DIGIPIN is the precise address code
    address: c && digipin(c.lat, c.lon) !== '—' ? `DIGIPIN ${digipin(c.lat, c.lon)}` : 'outside DIGIPIN coverage',
    floors: p.stories,
    basements: p.basements || 0,
    height: p.height_m,
    extraction: EXTRACTION[p.height_source] || (p.source ? `Footprint: ${p.source}` : 'GIS footprint attributes'),
    feature,
  }
  b.units = units.map((u) => ({
    id: u.unit_ulpin,
    ulpin: u.unit_ulpin,
    floor: u.floor_index,
    unitLabel: u.floor_index < 0 ? `Unit ${u.unit_no} (basement)` : `Unit ${u.unit_no}`,
    owner: u.owner_name,
    ownerId: u.owner_id,
    area: u.area_sqm,
    rightsType: cap(u.rights_type),
    status: toStatus(u.validation_status),
    lastUpdated: (u.updated_at || '').slice(0, 10) || '—',
    raw: u,
    building: b,
  }))
  return b
}

async function loadBuilding(id) {
  const [feature, { units }] = await Promise.all([getBuilding(id), fetchUnits(id)])
  return toBuilding(feature, units)
}

function useAsync(load, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  useEffect(() => {
    let alive = true
    setState({ data: null, loading: true, error: null })
    load().then(
      (data) => alive && setState({ data, loading: false, error: null }),
      (error) => alive && setState({ data: null, loading: false, error }),
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

export const useBuilding = (id) => useAsync(() => loadBuilding(id), [id])

export const useUnit = (ulpin) =>
  useAsync(async () => {
    const bid = await buildingIdOfUnit(ulpin)
    if (!bid) return null // missing records stay missing; never fabricate a title
    return (await loadBuilding(bid)).units.find((u) => u.ulpin === ulpin) || null
  }, [ulpin])

// buildings where the signed-in citizen owns at least one unit
export const useOwnedBuildings = () =>
  useAsync(async () => {
    const owned = await citizenProperties()
    return owned.map((f) => toBuilding(f, peekUnits(f.properties.building_id)))
  }, [])

// every parcel with a ULPIN unit tree (the registry, not every scanned footprint)
export const useRegisteredBuildings = () =>
  useAsync(async () => {
    const fc = await getSavedBuildings()
    return fc.features
      .filter((f) => peekUnits(f.properties.building_id).length)
      .map((f) => toBuilding(f, peekUnits(f.properties.building_id)))
  }, [])

export const useProfile = () => useAsync(citizenProfile, [])

export function useComplaints() {
  const [version, setVersion] = useState(0)
  const state = useAsync(citizenComplaints, [version])
  return { ...state, reload: () => setVersion((v) => v + 1) }
}

// sharing: checked ID, public verify link, DIGIPIN of a unit
export const checkedId = (u) => u.raw?.unit_ulpin_checked || u.ulpin

export const verifyUrl = (code) => `${window.location.origin}/verify/${encodeURIComponent(code)}`

// DIGIPIN (with floor) of the middle of the unit; the unit polygon is normalized to the footprint bounding box
export function digipinOf(geometry, polygon, floor) {
  const ring = geometry?.type === 'Polygon' ? geometry.coordinates[0] : geometry?.coordinates?.[0]?.[0]
  if (!ring?.length) return '—'
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)]
  const [w, h] = [Math.max(...xs) - x0, Math.max(...ys) - y0]
  const pts = polygon?.length ? polygon : [[0.5, 0.5]]
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
  return digipin(y0 + cy * h, x0 + cx * w, floor)
}
