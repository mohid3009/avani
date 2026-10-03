// Footprint of a building in metres, centred on its bounding box (shared by the 3D model and plan previews).
const M_PER_DEG = 111320

export function footprintMeters(geometry) {
  const ring = geometry?.type === 'Polygon' ? geometry.coordinates[0] : geometry?.coordinates?.[0]?.[0]
  if (!ring?.length) return null
  const lons = ring.map((c) => c[0])
  const lats = ring.map((c) => c[1])
  const minLon = Math.min(...lons)
  const minLat = Math.min(...lats)
  const latMid = (minLat + Math.max(...lats)) / 2
  const kx = M_PER_DEG * Math.cos((latMid * Math.PI) / 180)
  const w = Math.max(1, (Math.max(...lons) - minLon) * kx)
  const d = Math.max(1, (Math.max(...lats) - minLat) * 110540)
  const pts = ring.map(([lon, lat]) => [(lon - minLon) * kx - w / 2, (lat - minLat) * 110540 - d / 2])
  return { w, d, pts }
}
