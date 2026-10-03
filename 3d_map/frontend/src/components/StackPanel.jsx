import { useEffect, useState } from 'react'
import { probeColumn } from '../api.js'

const floorName = (f) => (f < 0 ? `Basement ${-f}` : `Floor ${f}`)

// Everything registered in the vertical column through the middle of a building, roof to basement.
export default function StackPanel({ feature }) {
  const [res, setRes] = useState(null)
  const ring = feature?.geometry?.type === 'Polygon' ? feature.geometry.coordinates[0] : feature?.geometry?.coordinates?.[0]?.[0]
  const lon = ring ? ring.reduce((s, p) => s + p[0], 0) / ring.length : null
  const lat = ring ? ring.reduce((s, p) => s + p[1], 0) / ring.length : null

  useEffect(() => {
    if (lon == null) return
    let live = true
    setRes(null)
    probeColumn(lon, lat).then((r) => live && setRes(r)).catch((e) => live && setRes({ found: false, message: e.message }))
    return () => { live = false }
  }, [lon, lat])

  if (lon == null) return null
  return (
    <div className="sp-block">
      <h3 className="sp-h3">What is stacked here</h3>
      {!res && <p className="sp-muted">Looking up the column…</p>}
      {res && !res.found && <p className="sp-muted">{res.message || 'Nothing registered at the middle of this footprint.'}</p>}
      {res?.found && (
        <ul className="sp-list" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {[...res.column].reverse().map((r) => (
            <li key={r.floor_index} className="sp-row" style={{ cursor: 'default' }}>
              <span>{floorName(r.floor_index)}, {r.z_from} to {r.z_to} m</span>
              <span className="sp-muted">{r.unit ? `Unit ${r.unit.unit_no}, ${r.unit.owner_name}` : 'common area'}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="sp-muted mono" style={{ wordBreak: 'break-all' }}>GET /api/lidar/column?lon={lon.toFixed(6)}&amp;lat={lat.toFixed(6)}</p>
    </div>
  )
}
