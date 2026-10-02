// ── Citizen portal records ───────────────────────────────────────────────────
// React hooks that load backend records and shape them for the portal pages
// (passport, property details, UPC, records, complaints, profile).

import { useEffect, useState } from 'react'
import {
  buildingIdOfUnit, citizenComplaints, citizenProfile, citizenProperties,
  digipin, fetchUnits, getBuilding, getSavedBuildings, peekUnits,
} from './api.js'

// registry statuses that count as a clean title
export const VERIFIED = new Set(['valid', 'confirmed', 'verified'])
const toStatus = (s) => (s === 'conflict' ? 'conflict' : VERIFIED.has(s) ? 'verified' : 'review')
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '—')

const EXTRACTION = {
  lidar: 'LiDAR point-cloud measurement',
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
    name: p.name || p.building_id,
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
