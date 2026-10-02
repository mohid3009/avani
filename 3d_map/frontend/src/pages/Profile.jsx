import { useNavigate, useOutletContext } from 'react-router-dom'
import { Globe, Bell, Shield, HelpCircle, LogOut, ArrowLeft } from 'lucide-react'
import Breadcrumb from '../components/ui/Breadcrumb.jsx'
import { useProfile } from '../portalData.js'

export default function Profile({ onLogout: propLogout }) {
  const navigate = useNavigate()
  const outlet = useOutletContext()
  const onLogout = propLogout || outlet?.onLogout || (() => {})
  const { data: profile, loading } = useProfile()

  const settings = [
    { icon: <Globe size={16} />, label: 'Language', value: 'English' },
    { icon: <Bell size={16} />, label: 'Notifications', value: 'On' },
    { icon: <Shield size={16} />, label: 'Privacy & Data', value: 'Coming soon' },
    { icon: <HelpCircle size={16} />, label: 'Help & Support', value: 'Coming soon' },
  ]

  if (loading) return <div className="loading muted">loading profile…</div>
  if (!profile) return <div className="loading muted">Sign in as a citizen to see your profile.</div>
  const initials = profile.name.split(' ').map((w) => w[0]).join('')

  return (
    <div className="max-w-[640px]">
      <Breadcrumb current="Profile & Settings" />
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-mid hover:text-ink mb-2 mt-2">
        <ArrowLeft size={13} /> Back
      </button>

      <div className="bg-surface border border-line rounded-[14px] p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue to-accent grid place-items-center text-white text-lg font-extrabold">
          {initials}
        </div>
        <div>
          <div className="text-lg font-extrabold text-ink">{profile.name}</div>
          <div className="text-xs text-ink-mid font-id">{profile.owner_id}</div>
        </div>
      </div>

      <div className="bg-surface border border-line rounded-[14px] p-4 mt-4">
        <h3 className="text-sm font-bold text-ink mb-3">Linked identity</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-mid mb-0.5">Aadhaar</div>
            <div className="text-sm font-bold text-ink font-id">{profile.aadhaar}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-mid mb-0.5">Mobile</div>
            <div className="text-sm font-bold text-ink font-id">{profile.phone}</div>
          </div>
        </div>
        <p className="text-[11px] text-ink-soft mt-3">
          Demo citizen registry record — not linked to Aadhaar or DigiLocker.
        </p>
      </div>

      <div className="bg-surface border border-line rounded-[14px] p-2 mt-4">
        {settings.map((s, i) => (
          <div
            key={s.label}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-[10px] ${
              i === settings.length - 1 ? '' : 'border-b border-dashed border-line'
            }`}
          >
            <span className="text-ink-mid">{s.icon}</span>
            <span className="text-sm font-medium text-ink">{s.label}</span>
            <span className="ml-auto text-xs text-ink-mid">{s.value}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => {
          onLogout()
          navigate('/')
        }}
        className="mt-4 w-full bg-surface border border-[#F5C6C2] text-[#B42318] text-sm font-semibold rounded-[10px] px-4 py-2.5 hover:bg-[#FDECEC] inline-flex items-center justify-center gap-2"
      >
        <LogOut size={15} /> Log Out
      </button>
    </div>
  )
}