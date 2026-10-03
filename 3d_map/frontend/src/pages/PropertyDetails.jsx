import { Suspense, lazy, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Box, Building2, MapPin, ShieldCheck } from 'lucide-react'
import Breadcrumb from '../components/ui/Breadcrumb.jsx'
import DetailGrid from '../components/ui/DetailGrid.jsx'
import MapInset from '../components/ui/MapInset.jsx'
import StatusPill from '../components/ui/StatusPill.jsx'
import { useUnit } from '../portalData.js'
import EvidenceBadge from '../components/ui/EvidenceBadge.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'

// three.js loads only when a property page opens
const PropertyModel3D = lazy(() => import('../components/PropertyModel3D.jsx'))

export default function PropertyDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: unit, loading } = useUnit(id)
  const [view, setView] = useState('3d') // 3d | map

  if (loading) return <div className="loading muted">loading property record…</div>
  if (!unit) {
    return (
      <div className="max-w-[760px] mx-auto">
        <Breadcrumb current="Property Details" />
        <div className="property-detail-empty">
          <Building2 size={28} />
          <h1>Property record not found</h1>
          <p>No registered unit matches this property identifier.</p>
          <Link to="/dashboard" className="btn primary inline-flex items-center gap-2">
            <ArrowLeft size={14} /> Back to My Properties
          </Link>
        </div>
      </div>
    )
  }

  const building = unit.building
  const verified = unit.status === 'verified'
  const conflict = unit.status === 'conflict'
  const statusVariant = verified ? 'verified' : 'review'
  const statusLabel = verified ? 'Verified Title' : conflict ? 'Boundary Conflict' : 'Under Review'
  const area = unit.area || unit.area_sqm || 82

  return (
    <div className="property-detail-page max-w-[1120px] mx-auto pb-12">
      <Breadcrumb current="Property Details" />

      <button className="property-back-link" onClick={() => navigate('/dashboard')}>
        <ArrowLeft size={14} /> Back to My Properties
      </button>

      <section className={`property-detail-hero ${conflict ? 'is-conflict' : verified ? 'is-verified' : 'is-review'}`}>
        <div className="property-detail-icon"><Building2 size={25} /></div>
        <div className="min-w-0 flex-1">
          <div className="property-detail-kicker">Registered residential volume</div>
          <h1 style={{ color: '#000000', WebkitTextFillColor: '#000000', background: 'none' }}>{unit.unitLabel || 'Property Unit'}</h1>
          <p><MapPin size={14} /> {building?.name || 'Registered Building'} · {building?.address || 'Chennai'}</p>
        </div>
        <StatusPill variant={statusVariant}>{statusLabel}</StatusPill>
      </section>

      <div className="property-detail-layout">
        <div className="property-detail-main">
          <section className="property-detail-section property-location-section">
            <div className="property-section-heading">
              <div>
                <span className="property-section-eyebrow">Location</span>
                <h2>Property location</h2>
              </div>
              <div className="pm3d-tabs" role="tablist">
                <button role="tab" aria-selected={view === '3d'} onClick={() => setView('3d')}>3D view</button>
                <button role="tab" aria-selected={view === 'map'} onClick={() => setView('map')}>On map</button>
              </div>
            </div>
            {view === '3d' ? (
              <ErrorBoundary>
                <Suspense fallback={<div className="pm3d-loading">Loading the 3D model…</div>}>
                  <PropertyModel3D geometry={building?.feature?.geometry} units={building?.units || []} unit={unit} />
                </Suspense>
              </ErrorBoundary>
            ) : (
              <MapInset
                highlightUnit
                geometry={building?.feature?.geometry}
                ulpin={building?.baseUlpin || unit.ulpin}
                address={building?.address || 'Chennai'}
                label={unit.unitLabel}
                heightM={building?.feature?.properties?.height_m ?? (building?.feature?.properties?.stories || 1) * 3}
                floorNo={unit.floor}
                unitPolygon={unit.raw?.polygon}
              />
            )}
            {view !== '3d' && <p className="property-map-note">Your floor is the pale band and your unit is yellow. Right-drag to tilt, Ctrl and scroll to zoom.</p>}
          </section>

          <section className="property-detail-section">
            <div className="property-section-heading">
              <div>
                <span className="property-section-eyebrow">Registry</span>
                <h2>Ownership and spatial details</h2>
              </div>
            </div>
            <DetailGrid
              fields={[
                { label: 'Registered Owner', value: unit.owner },
                { label: 'Unit & Floor', value: `${unit.unitLabel} · ${unit.floor < 0 ? `Basement ${-unit.floor}` : `Floor ${unit.floor}`}` },
                { label: 'Carpet Area', value: `${area} m² (~${Math.round(area * 10.764)} sq.ft)` },
                { label: 'Rights Category', value: unit.rightsType },
                ...(unit.lastUpdated && unit.lastUpdated !== '—' ? [{ label: 'Last Updated', value: unit.lastUpdated }] : []),
              ]}
              columns={2}
            />
          </section>

          <section className="property-detail-section property-id-section">
            <div className="property-section-heading">
              <div>
                <span className="property-section-eyebrow">National spatial identity</span>
                <h2>3D ULPIN</h2>
              </div>
              <ShieldCheck size={20} />
            </div>
            <code>{unit.raw?.unit_ulpin_checked || unit.ulpin || unit.unit_ulpin}</code>
            <EvidenceBadge heightSource={building?.feature?.properties?.height_source} segmentations={(building?.units || []).map((u) => u.raw?.segmentation)} />
          </section>
        </div>

        <aside className="property-detail-aside">
          <section className="property-action-panel">
            <h2>Property services</h2>
            <button className="property-action primary" onClick={() => navigate(`/portal/card/${encodeURIComponent(unit.id || unit.ulpin)}`)}>
              <ShieldCheck size={17} />
              <span><strong>Unified Property Card</strong><small>Document with a QR code to share</small></span>
            </button>
            <button className="property-action" onClick={() => navigate(`/portal/building/${building?.id}/3d`)} disabled={!building?.id}>
              <Box size={17} />
              <span><strong>View Building in 3D</strong><small>Inspect floor and unit volume</small></span>
            </button>
            <button className="property-action warning" onClick={() => navigate(`/portal/report/${encodeURIComponent(unit.id || unit.ulpin)}`)}>
              <AlertTriangle size={17} />
              <span><strong>Report a Problem</strong><small>Area, owner, or boundary issue</small></span>
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}
