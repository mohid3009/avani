import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { verifyUrl } from '../../portalData.js'

// A real QR code: scanning it opens the public verify page for this unit ID.
export default function QRBlock({ reference, size = 112 }) {
  const [svg, setSvg] = useState('')
  const url = verifyUrl(reference)
  useEffect(() => {
    let live = true
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((s) => live && setSvg(s))
    return () => { live = false }
  }, [url])
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div
        role="img"
        aria-label={`QR code that opens ${url}`}
        className="shrink-0 rounded-lg border border-linesoft bg-white p-1"
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div>
        <div className="text-sm font-bold text-ink">Scan to verify</div>
        <div className="text-xs text-ink-mid mt-0.5 font-id break-all">{reference}</div>
      </div>
    </div>
  )
}
