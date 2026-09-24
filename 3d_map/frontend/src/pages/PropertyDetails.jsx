import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Box, Building2, CalendarDays, FileText,
  Layers, MapPin, Ruler, ShieldCheck, UserRound,
} from 'lucide-react'
import Breadcrumb from '../components/ui/Breadcrumb.jsx'
import DetailGrid from '../components/ui/DetailGrid.jsx'
import MapInset from '../components/ui/MapInset.jsx'
import StatusPill from '../components/ui/StatusPill.jsx'
import { getUnit } from '../mockData.js'

export default function PropertyDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const unit = getUnit(id)

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
          <h1>{unit.unitLabel || 'Property Unit'}</h1>
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
              <span className="property-map-badge"><MapPin size={13} /> 2D parcel map</span>
            </div>
            <MapInset
              highlightUnit
              ulpin={building?.baseUlpin || unit.ulpin}
              address={building?.address || 'Chennai'}
              label={unit.unitLabel}
            />
            <p className="property-map-note">
              The highlighted footprint shows the registered parcel associated with this unit. Open the 3D view for vertical floor boundaries.
            </p>
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
                { label: 'Registered Owner', value: unit.owner || 'Citizen' },
                { label: 'Unit & Floor', value: `${unit.unitLabel || 'Unit'} · Floor ${unit.floor ?? 1}` },
                { label: 'Carpet Area', value: `${area} m² (~${Math.round(area * 10.764)} sq.ft)` },
                { label: 'Rights Category', value: unit.rightsType || 'Freehold Title' },
                { label: 'Encumbrance', value: verified ? 'Nil · Clear title' : 'Review in progress' },
                { label: 'Last Updated', value: unit.lastUpdated || '2026-09-01' },
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
            <code>{unit.ulpin || unit.unit_ulpin}</code>
          </section>
        </div>

        <aside className="property-detail-aside">
          <section className="property-action-panel">
            <h2>Property services</h2>
            <p>Open official records or report a discrepancy.</p>
            <button className="property-action primary" onClick={() => navigate(`/passport/${encodeURIComponent(unit.id || unit.ulpin)}`)}>
              <ShieldCheck size={17} />
              <span><strong>Digital Passport</strong><small>Verified deed and QR record</small></span>
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

          <section className="property-summary-panel">
            <h2>At a glance</h2>
            <div><Ruler size={15} /><span>Area</span><strong>{area} m²</strong></div>
            <div><Layers size={15} /><span>Floor</span><strong>{unit.floor ?? 1}</strong></div>
            <div><UserRound size={15} /><span>Ownership</span><strong>{unit.rightsType || 'Owned'}</strong></div>
            <div><CalendarDays size={15} /><span>Updated</span><strong>{unit.lastUpdated || 'Sep 2026'}</strong></div>
          </section>

          <div className="property-help-card">
            <FileText size={18} />
            <div><strong>Need help reading this record?</strong><p>Use Help & Support from Profile & Settings.</p></div>
          </div>
        </aside>
      </div>
    </div>
  )
}
