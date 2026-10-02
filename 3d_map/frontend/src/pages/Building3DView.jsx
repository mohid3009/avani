import { Link, useParams } from 'react-router-dom'
import { MousePointer, CircleDot, ArrowLeft } from 'lucide-react'
import Breadcrumb from '../components/ui/Breadcrumb.jsx'
import DetailGrid from '../components/ui/DetailGrid.jsx'
import Building3DScene from '../components/Building3DScene.jsx'
import { myOwnerId } from '../api.js'
import { useBuilding } from '../portalData.js'

export default function Building3DView() {
  const { id } = useParams()
  const { data: b, loading } = useBuilding(id)

  if (loading) return <div className="loading muted">loading building…</div>
  if (!b) {
    return (
      <div className="max-w-[640px]">
        <Breadcrumb current="3D Building View" />
        <div className="bg-surface border border-line rounded-[14px] p-6 text-sm text-ink-mid">
          Building not found.{' '}
          <Link to="/portal/records" className="text-[#176B55] font-semibold">Back to records</Link>
        </div>
      </div>
    )
  }

  // highlight the viewer's own unit's floor when they own one here
  const ownedHere = b.units.find((u) => u.ownerId && u.ownerId === myOwnerId())
  const unitFloor = ownedHere?.floor ?? null

  return (
    <div className="max-w-[1080px]">
      <Breadcrumb current="3D Building View" />
      <button onClick={() => window.history.back()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#000000] hover:text-[#000000] mb-2 mt-2">
        <ArrowLeft size={13} /> Back
      </button>
      <h1 className="text-xl font-extrabold text-[#000000]">{b.name} — 3D</h1>
      <p className="text-sm text-[#000000] mt-0.5 mb-4">{b.address}</p>

      <div className="grid gap-4 min-[900px]:grid-cols-[1fr_320px]">
        <div
          className="relative bg-surface border border-line rounded-[14px] overflow-hidden h-[440px]"
          role="img"
          aria-label={`Interactive 3D floor model of ${b.name}${ownedHere ? ` with ${ownedHere.unitLabel} selected on floor ${ownedHere.floor}` : ''}`}
        >
          <Building3DScene
            floors={b.floors}
            basements={b.basements}
            unitFloor={unitFloor}
            size={2.2}
          />
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-ink/80 text-white text-[11px] px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 pointer-events-none whitespace-nowrap">
            <MousePointer size={12} /> Drag or swipe to rotate
          </div>
          <div className="absolute bottom-3 left-3 bg-surface/95 border border-line rounded-[10px] px-3 py-2 flex flex-col gap-1 text-[11px] text-ink">
            {ownedHere ? (
              <span className="inline-flex items-center gap-1.5">
                <CircleDot size={11} className="text-[#D6423A]" /> {ownedHere.unitLabel} selected
              </span>
            ) : (
              <span>No owned unit highlighted</span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="bg-surface border border-line rounded-[14px] p-4">
            <h3 className="text-sm font-bold text-ink mb-3">Building summary</h3>
            <DetailGrid
              fields={[
                { label: 'Floors', value: b.floors },
                { label: 'Total Units', value: b.units.length },
                { label: 'Height', value: `${b.height} m` },
                { label: 'Basements', value: b.basements },
                { label: 'Extraction', value: b.extraction, },
              ]}
            />
          </div>
          <div className="bg-surface border border-line rounded-[14px] p-4">
            <h3 className="text-sm font-bold text-ink mb-1">About this model</h3>
            <p className="text-xs text-ink-mid leading-relaxed">
              This is a schematic demonstration, not a surveyed or authoritative
              volume record. Use the ULPIN view to inspect generated unit geometry.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}