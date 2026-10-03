import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { verifyUlpin } from '../../api.js'

const TONE = { verified: 'text-[#0F5442]', unknown: 'text-[#8A6410]', bad_checksum: 'text-[#B3261E]', missing_check: 'text-[#B3261E]' }

// Paste a unit ID with its check character; the registry says if it is genuine.
export default function VerifyId() {
  const [code, setCode] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = (e) => {
    e.preventDefault()
    setBusy(true)
    verifyUlpin(code.trim())
      .then(setRes)
      .catch((err) => setRes({ status: 'unknown', message: err.message }))
      .finally(() => setBusy(false))
  }

  return (
    <form onSubmit={submit} className="bg-surface border border-line rounded-[14px] p-4 mt-4">
      <label className="text-sm font-bold text-ink flex items-center gap-1.5" htmlFor="verify-id">
        <ShieldCheck size={15} /> Check an ID
      </label>
      <p className="text-xs text-ink-mid mt-0.5">The last character of every unit ID is a check character. Paste an ID to see if it is genuine.</p>
      <div className="flex gap-2 mt-2">
        <input
          id="verify-id"
          className="flex-1 bg-surface border border-line rounded-[10px] px-3 py-2 text-sm text-ink font-id outline-none focus:border-[#176B55]"
          placeholder="e.g. AH-75-5220-2164-4516-F1-U1-Q"
          value={code}
          onChange={(e) => { setCode(e.target.value); setRes(null) }}
        />
        <button className="px-4 py-2 rounded-[10px] bg-[#176B55] text-white text-sm font-semibold disabled:opacity-50" disabled={busy || !code.trim()}>
          {busy ? 'Checking…' : 'Check'}
        </button>
      </div>
      {res && (
        <p role="status" className={`text-sm font-semibold mt-2 ${TONE[res.status] || ''}`}>
          {res.status === 'verified'
            ? `Genuine. Unit ${res.unit.unit_no}, floor ${res.unit.floor_index}, ${Math.round(res.unit.area_sqm)} m².`
            : res.message}
        </p>
      )}
    </form>
  )
}
