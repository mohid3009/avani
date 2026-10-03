import { Suspense, lazy, useState } from 'react'
import { Box, X } from 'lucide-react'
import ErrorBoundary from '../ErrorBoundary.jsx'
import { useUnit } from '../../portalData.js'

const PropertyModel3D = lazy(() => import('../PropertyModel3D.jsx'))
const floorName = (f) => (f < 0 ? `Basement ${-f}` : `Floor ${f}`)

// Optional step of a report: outline the disputed area on the 3D model of the unit.
export default function DisputePicker({ unitId, region, onChange }) {
  const [open, setOpen] = useState(false)
  const { data: unit } = useUnit(unitId)

  return (
    <div className="dp">
      <div className="dp-bar">
        <button type="button" className="dp-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={!unit}>
          <Box size={15} /> {open ? 'Hide the 3D model' : 'Mark the area on the 3D model'}
        </button>
        {region && (
          <span className="dp-chip">
            Area marked on {floorName(region.floor)}
            <button type="button" aria-label="Remove the marked area" onClick={() => onChange(null)}><X size={13} /></button>
          </span>
        )}
      </div>
      {open && unit && (
        <ErrorBoundary>
          <Suspense fallback={<div className="pm3d-loading">Loading the 3D model…</div>}>
            <PropertyModel3D
              key={unit.ulpin}
              markable
              geometry={unit.building.feature.geometry}
              units={unit.building.units}
              unit={unit}
              region={region}
              onRegion={onChange}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
