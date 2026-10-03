import { Link, useNavigate, useParams } from 'react-router-dom'
import { Building2, Box, Info, ShieldCheck, ArrowLeft } from 'lucide-react'
import Breadcrumb from '../components/ui/Breadcrumb.jsx'
import TicketCard from '../components/ui/TicketCard.jsx'
import DetailGrid from '../components/ui/DetailGrid.jsx'
import MapInset from '../components/ui/MapInset.jsx'
import MiniRow from '../components/ui/MiniRow.jsx'
import StatusPill from '../components/ui/StatusPill.jsx'
import { useBuilding } from '../portalData.js'

export default function UnifiedPropertyCard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: b, loading } = useBuilding(id)

  if (loading) return <div className="loading muted">loading parcel…</div>
  if (!b) {
    return (
      <div className="max-w-[640px]">
        <Breadcrumb current="Parcel record" />
        <div className="bg-surface border border-line rounded-[14px] p-6 text-sm text-ink-mid">
          Parcel not found.{' '}
          <Link to="/portal/records" className="text-[#176B55] font-semibold">Back to records</Link>
        </div>
      </div>
    )
  }

  const allVerified = b.units.length > 0 && b.units.every((u) => u.status === 'verified')
  const firstUnit = b.units[0]
  return (
    <div className="max-w-[640px]">
      <Breadcrumb current="Parcel record" />
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-mid hover:text-ink mb-2 mt-2">
        <ArrowLeft size={13} /> Back
      </button>
      <TicketCard
        illustration={
          <div className="w-10 h-10 rounded-[10px] bg-bluebg text-blue grid place-items-center shrink-0">
            <Building2 size={18} />
          </div>
        }
        badgeVariant={allVerified ? 'verified' : 'review'}
        badgeLabel={allVerified ? 'Verified' : 'Under Review'}
        buildingName="Parcel record"
        unitLabel={b.name}
        metaText={b.address}
      >
        <div className="bg-surface border border-line rounded-[12px] p-4 mt-4">
          <DetailGrid
            fields={[
              { label: 'Base ULPIN', value: b.baseUlpin },
              { label: 'Registered Owners', value: String(new Set(b.units.map((u) => u.ownerId)).size) },
              { label: 'Storeys', value: `${b.floors ?? '—'}${b.basements ? ` + ${b.basements} basement` : ''}` },
              { label: 'Height', value: b.height != null ? `${b.height} m` : '—' },
            ]}
            columns={2}
          />
          <p className="flex items-start gap-1.5 text-[11px] text-ink-soft mt-3">
            <Info size={12} className="mt-0.5 shrink-0" />
            Owners come from the demo ULPIN owner registry — not linked to Aadhaar or DigiLocker.
          </p>
        </div>

        <div className="mt-3">
          <MapInset geometry={b.feature.geometry} ulpin={b.baseUlpin} />
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 mt-3">
          <button
            onClick={() => firstUnit && navigate(`/portal/card/${encodeURIComponent(firstUnit.id)}`)}
            disabled={!firstUnit}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-[#176B55] text-white text-xs font-bold rounded-[10px] px-3 py-2.5 hover:bg-[#0F5442] disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            <ShieldCheck size={15} /> Unified Property Card
          </button>
          <button
            onClick={() => navigate(`/portal/building/${b.id}/3d`)}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-surface border border-line text-ink text-xs font-bold rounded-[10px] px-3 py-2.5 hover:bg-neutralbg"
          >
            <Box size={15} /> View Building 3D
          </button>
        </div>

        <div className="bg-surface border border-line rounded-[12px] p-4 mt-3">
          <h3 className="text-sm font-bold text-ink mb-1">
            Units under this parcel ({b.units.length})
          </h3>
          {b.units.map((u, i) => (
            <MiniRow
              key={u.id}
              icon={<Building2 size={15} />}
              title={u.unitLabel}
              subtitle={`Floor ${u.floor} · ${u.owner} · ${u.area} m²`}
              pill={
                <StatusPill variant={u.status === 'verified' ? 'verified' : 'review'}>
                  {u.status}
                </StatusPill>
              }
              onClick={() => navigate(`/portal/card/${encodeURIComponent(u.id)}`)}
              last={i === b.units.length - 1}
            />
          ))}
        </div>
      </TicketCard>
    </div>
  )
}