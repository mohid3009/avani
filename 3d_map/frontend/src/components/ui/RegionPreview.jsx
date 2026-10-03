import { footprintMeters } from '../../footprint.js'

// Plan view of a building: its footprint with the area a citizen marked in red.
// region = { floor, polygon }, polygon corners as 0..1 of the footprint bounding box (north up).
export default function RegionPreview({ geometry, region, width = 160 }) {
  const fp = footprintMeters(geometry)
  if (!fp || !region?.polygon?.length) return null
  const height = Math.min(Math.max(width * (fp.d / fp.w), 60), 220)
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0]
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)]
  const [w, h] = [Math.max(...xs) - x0 || 1, Math.max(...ys) - y0 || 1]
  const pt = ([x, y]) => `${(x * width).toFixed(1)},${((1 - y) * height).toFixed(1)}`
  const outline = ring.map(([lon, lat]) => pt([(lon - x0) / w, (lat - y0) / h])).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Plan view with the marked area in red" className="region-preview">
      <polygon points={outline} fill="#E3F1EA" stroke="#176B55" strokeWidth="1.5" />
      <polygon points={region.polygon.map(pt).join(' ')} fill="rgba(229, 72, 77, 0.55)" stroke="#8F1D22" strokeWidth="1.5" />
    </svg>
  )
}
