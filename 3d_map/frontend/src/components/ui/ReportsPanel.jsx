import { useEffect, useState } from 'react'
import { buildingComplaints } from '../../api.js'
import RegionPreview from './RegionPreview.jsx'

const floorName = (f) => (f < 0 ? `Basement ${-f}` : `Floor ${f}`)

// Staff view: what citizens have reported against this building, with the area they marked.
export default function ReportsPanel({ buildingId, geometry }) {
  const [reports, setReports] = useState(null)
  useEffect(() => {
    let live = true
    setReports(null)
    buildingComplaints(buildingId).then((r) => live && setReports(r)).catch(() => live && setReports([]))
    return () => { live = false }
  }, [buildingId])

  if (!reports?.length) return null
  return (
    <div className="sp-block">
      <h3 className="sp-h3">Citizen reports <span className="sp-count is-quiet">{reports.length}</span></h3>
      <ul className="sp-list">
        {reports.map((r) => (
          <li key={r.id} className="sp-report">
            <p className="sp-text"><b>{r.issueType}</b> <span className="sp-muted">{r.id}, {r.date}</span></p>
            <p className="sp-text">{r.description}</p>
            {r.region && (
              <>
                <p className="sp-muted">Area marked on {floorName(r.region.floor)}</p>
                <RegionPreview geometry={geometry} region={r.region} />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
