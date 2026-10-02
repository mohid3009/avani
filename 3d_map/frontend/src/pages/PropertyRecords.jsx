import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Building2, MapPin, ArrowLeft } from 'lucide-react'
import Breadcrumb from '../components/ui/Breadcrumb.jsx'
import MiniRow from '../components/ui/MiniRow.jsx'
import StatusPill from '../components/ui/StatusPill.jsx'
import { myOwnerId } from '../api.js'
import { useRegisteredBuildings } from '../portalData.js'

const CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'verified', label: 'Verified' },
  { key: 'review', label: 'Under Review' },
  { key: 'mine', label: 'My Parcel' },
]

export default function PropertyRecords() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')

  const { data: buildings, loading } = useRegisteredBuildings()
  const me = myOwnerId()

  const rows = (buildings || [])
    .map((b) => ({
      b,
      status: b.units.every((u) => u.status === 'verified')
        ? 'verified'
        : 'review',
      mine: !!me && b.units.some((u) => u.ownerId === me),
    }))
    .filter((r) => {
      if (filter === 'verified' && r.status !== 'verified') return false
      if (filter === 'review' && r.status !== 'review') return false
      if (filter === 'mine' && !r.mine) return false
      const needle = q.trim().toLowerCase()
      if (!needle) return true
      return (
        r.b.name.toLowerCase().includes(needle) ||
        r.b.baseUlpin.toLowerCase().includes(needle) ||
        r.b.address.toLowerCase().includes(needle)
      )
    })

  return (
    <div className="max-w-[1080px]">
      <Breadcrumb current="Property Records" />
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-mid hover:text-ink mb-2 mt-2">
        <ArrowLeft size={13} /> Back
      </button>
      <h1 className="text-xl font-extrabold text-ink">Property Records</h1>
      <p className="text-sm text-ink-mid mt-0.5">
        Browse every parcel in the national 3D registry — filter, search and open a record.
      </p>

      <div className="flex items-center gap-2 mt-4">
        <div className="relative flex-1 max-w-[420px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            className="w-full bg-surface border border-line rounded-[10px] pl-9 pr-3 py-2 text-sm text-ink placeholder-ink-soft outline-none focus:border-[#176B55]"
            placeholder="Search by name, ULPIN or address…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2 mt-3 flex-wrap">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            aria-pressed={filter === c.key}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              filter === c.key
                ? 'bg-[#176B55] text-white border-[#176B55]'
                : 'bg-surface text-ink-mid border-line hover:text-ink hover:bg-neutralbg'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="bg-surface border border-line rounded-[14px] p-3 mt-4">
        {loading && <p className="text-sm text-ink-mid px-2 py-4">loading registry…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-ink-mid px-2 py-4">No parcels match your search.</p>
        )}
        {rows.map((r, i) => (
          <MiniRow
            key={r.b.id}
            icon={<Building2 size={16} />}
            title={r.b.name}
            subtitle={
              <span className="inline-flex items-center gap-1">
                <MapPin size={11} className="text-ink-soft" />
                <span className="font-id">{r.b.baseUlpin}</span> · {r.b.address}
              </span>
            }
            pill={
              <StatusPill variant={r.status === 'verified' ? 'verified' : 'review'}>
                {r.status === 'verified' ? 'Verified' : 'Under Review'}
              </StatusPill>
            }
            onClick={() => navigate(`/portal/upc/${r.b.id}`)}
            last={i === rows.length - 1}
          />
        ))}
      </div>
    </div>
  )
}