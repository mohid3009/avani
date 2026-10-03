import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Breadcrumb from '../components/ui/Breadcrumb.jsx'
import UpcCard from '../components/ui/UpcCard.jsx'
import { useUnit } from '../portalData.js'

export default function UnitUpc() {
  const { unitId } = useParams()
  const navigate = useNavigate()
  const { data: unit, loading } = useUnit(unitId)

  if (loading) return <div className="loading muted">loading card…</div>
  if (!unit) {
    return (
      <div className="max-w-[640px] bg-surface border border-line rounded-[14px] p-6 text-sm text-ink-mid">
        Card not found. <Link to="/portal/records" className="text-[#176B55] font-semibold">Back to records</Link>
      </div>
    )
  }
  return (
    <div className="max-w-[760px]">
      <Breadcrumb current="Unified Property Card" />
      <button onClick={() => navigate(-1)} className="no-print inline-flex items-center gap-1.5 text-xs font-semibold text-ink-mid hover:text-ink mb-3 mt-2">
        <ArrowLeft size={13} /> Back
      </button>
      <UpcCard unit={unit} />
    </div>
  )
}
