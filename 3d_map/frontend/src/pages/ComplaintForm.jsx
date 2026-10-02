import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, Clock, ChevronRight, ArrowLeft } from 'lucide-react'
import Breadcrumb from '../components/ui/Breadcrumb.jsx'
import MiniRow from '../components/ui/MiniRow.jsx'
import StatusPill from '../components/ui/StatusPill.jsx'
import { fileComplaint } from '../api.js'
import { useComplaints, useUnit } from '../portalData.js'

const ISSUE_TYPES = [
  'Boundary mismatch',
  'Area mismatch',
  'Wrong floor',
  'Ownership mismatch',
]

export default function ComplaintForm() {
  const { unitId } = useParams()
  const navigate = useNavigate()
  const { data: unit, loading } = useUnit(unitId)
  const { data: complaints } = useComplaints()
  const [issueType, setIssueType] = useState(ISSUE_TYPES[0])
  const [description, setDescription] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const citizenComplaints = complaints || []

  if (loading) return <div className="loading muted">loading unit…</div>
  if (!unit) {
    return (
      <div className="max-w-[640px]">
        <Breadcrumb current="Report Issue" />
        <div className="bg-surface border border-line rounded-[14px] p-6 text-sm text-ink-mid">
          Unit not found.{' '}
          <Link to="/portal/records" className="text-[#176B55] font-semibold">Back to records</Link>
        </div>
      </div>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!description.trim()) {
      setError('Please describe the issue before submitting.')
      return
    }
    setBusy(true)
    let ticketId
    try {
      ticketId = await fileComplaint({ unitId: unit.id, buildingId: unit.building.id, issueType, description })
    } catch (err) {
      setError(`Could not submit: ${err.message}`)
      setBusy(false)
      return
    }
    navigate(`/portal/passport/${unit.id}`, {
      state: { toast: `Complaint ${ticketId} filed — the registry will respond within 7 days.` },
    })
  }

  return (
    <div className="max-w-[640px]">
      <Breadcrumb current="Report Issue" />
      <Link
        to={`/portal/passport/${unit.id}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-mid hover:text-ink mb-2"
      >
        <ArrowLeft size={13} /> Back to passport
      </Link>
      <h1 className="text-xl font-extrabold text-ink">Report an Issue</h1>
      <p className="text-sm text-ink-mid mt-0.5 mb-4">
        {unit.unitLabel} · {unit.building.name} ·{' '}
        <span className="font-id">{unit.ulpin}</span>
      </p>

      <form onSubmit={submit} className="bg-surface border border-line rounded-[14px] p-4">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-ink-mid">Issue type</span>
          <select
            value={issueType}
            onChange={(e) => setIssueType(e.target.value)}
            className="mt-1 w-full bg-page border border-line rounded-[10px] px-3 py-2.5 text-sm text-ink outline-none focus:border-[#176B55]"
          >
            {ISSUE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block mt-3">
          <span className="text-[10px] uppercase tracking-wide text-ink-mid">Description</span>
          <textarea
            id="issue-description"
            rows={4}
            required
            aria-invalid={!!error}
            aria-describedby={error ? 'issue-description-error' : undefined}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setError(null)
            }}
            className="mt-1 w-full bg-page border border-line rounded-[10px] px-3 py-2.5 text-sm text-ink placeholder-ink-soft outline-none focus:border-[#176B55] resize-y"
            placeholder="Describe what does not match the record…"
          />
        </label>
        {error && <p id="issue-description-error" role="alert" className="text-xs text-[#B42318] mt-2">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full bg-[#176B55] text-white text-sm font-semibold rounded-[10px] px-4 py-2.5 hover:bg-[#0F5442]"
        >
          Submit report
        </button>
      </form>

      <div className="bg-surface border border-line rounded-[14px] p-4 mt-4">
        <h3 className="text-sm font-bold text-ink mb-1">Your previous complaints</h3>
        {citizenComplaints.length === 0 && (
          <p className="text-sm text-ink-mid">Nothing reported yet.</p>
        )}
        {citizenComplaints.map((c, i) => {
          return (
            <MiniRow
              key={c.id}
              icon={
                c.status === 'resolved' ? (
                  <CheckCircle2 size={15} className="text-[#1B7A4A]" />
                ) : (
                  <Clock size={15} className="text-[#8A6410]" />
                )
              }
              title={`${c.id} · ${c.issueType}`}
              subtitle={`${c.unitId} · ${c.description}`}
              pill={
                <StatusPill variant={c.status === 'resolved' ? 'verified' : 'review'}>
                  {c.status}
                </StatusPill>
              }
              last={i === citizenComplaints.length - 1}
            />
          )
        })}
        <Link
          to="/portal/records"
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#176B55] hover:underline"
        >
          Browse records <ChevronRight size={13} />
        </Link>
      </div>
    </div>
  )
}