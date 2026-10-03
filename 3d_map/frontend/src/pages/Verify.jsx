import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { getBuilding, verifyUlpin } from '../api.js'
import { buildingName, digipinOf } from '../portalData.js'

// Public page behind every Unified Property Card QR code. It shows what the registry confirms, never the full name of the holder.
const mask = (name) => (name || '').split(' ').map((w) => `${w[0]}${'•'.repeat(Math.max(2, w.length - 1))}`).join(' ')

export default function Verify() {
  const { code } = useParams()
  const [res, setRes] = useState(null)
  const [where, setWhere] = useState(null)

  useEffect(() => {
    verifyUlpin(code).then(async (r) => {
      setRes(r)
      if (r.status === 'verified') {
        const f = await getBuilding(r.unit.building_id).catch(() => null)
        if (f) setWhere({ name: buildingName(f.properties), pin: digipinOf(f.geometry, r.unit.polygon, r.unit.floor_index) })
      }
    }).catch((e) => setRes({ status: 'error', message: e.message }))
  }, [code])

  const ok = res?.status === 'verified'
  const Icon = ok ? CheckCircle2 : res?.status === 'unknown' || res?.status === 'error' ? AlertTriangle : XCircle
  const tone = ok ? 'text-[#0F5442] bg-[#E3F1EA]' : 'text-[#8A1C14] bg-[#FBE9E4]'
  return (
    <main className="min-h-screen grid place-items-center p-5" style={{ background: '#F5F6F8', color: '#1C2530' }}>
      <section className="w-full max-w-[460px] bg-white border border-[#E2E7E4] rounded-[16px] p-6">
        <p className="text-sm font-bold text-[#176B55]">Avani, National 3D Cadastre</p>
        {!res && <p className="mt-4 text-sm">Checking the registry…</p>}
        {res && (
          <>
            <div className={`mt-4 flex items-center gap-2 rounded-[12px] px-4 py-3 font-extrabold ${tone}`}>
              <Icon size={22} /> {ok ? 'Genuine record' : 'Could not be verified'}
            </div>
            {ok ? (
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  ['Building', where?.name],
                  ['Unit', `${res.unit.unit_no}, ${res.unit.floor_index < 0 ? `basement ${-res.unit.floor_index}` : `floor ${res.unit.floor_index}`}`],
                  ['Extent', `${Math.round(res.unit.area_sqm)} m²`],
                  ['Rights', res.unit.rights_type?.replace(/^./, (c) => c.toUpperCase())],
                  ['Holder', mask(res.unit.owner_name)],
                  ['DIGIPIN', where?.pin],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k}><dt className="text-xs font-semibold text-[#4A5561]">{k}</dt><dd className="font-bold">{v}</dd></div>
                ))}
              </dl>
            ) : (
              <p className="mt-4 text-sm">{res.message}</p>
            )}
            <p className="mt-4 font-mono text-xs break-all text-[#4A5561]">{decodeURIComponent(code)}</p>
          </>
        )}
        <Link to="/" className="mt-5 inline-block text-sm font-bold text-[#176B55]">Open Avani</Link>
      </section>
    </main>
  )
}
