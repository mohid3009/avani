import { useState } from 'react'
import { Copy, Printer, Share2 } from 'lucide-react'
import QRBlock from './QRBlock.jsx'
import { MEASURED, checkedId, digipinOf, verifyUrl } from '../../portalData.js'

const RIGHTS = { Owned: 'Full ownership', Leased: 'Leasehold', Common: 'Common area' }
const today = () => new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })

// A row label in English with the Hindi underneath
const Label = ({ en, hi }) => (<>{en}<small lang="hi">{hi}</small></>)

// Unified Property Card for one unit, laid out as an official form: letterhead, reference block,
// three numbered parts of particulars, and a QR code that checks the card against the registry.
export default function UpcCard({ unit }) {
  const [note, setNote] = useState('')
  const b = unit.building
  const code = checkedId(unit)
  const pin = digipinOf(b.feature.geometry, unit.raw?.polygon, unit.floor)
  const verified = unit.status === 'verified'

  const flash = (m) => { setNote(m); setTimeout(() => setNote(''), 2500) }
  const share = async () => {
    const data = { title: `Unified Property Card, ${unit.unitLabel}`, text: `${b.name}, ${unit.unitLabel}`, url: verifyUrl(code) }
    try {
      if (navigator.share) await navigator.share(data)
      else { await navigator.clipboard.writeText(data.url); flash('Link copied') }
    } catch { /* share sheet dismissed */ }
  }
  const copy = (text, what) => navigator.clipboard.writeText(text).then(() => flash(`${what} copied`)).catch(() => {})

  const parts = [
    ['Part 1', 'भाग 1', 'Property particulars', 'संपत्ति का विवरण', [
      [<Label en="Building" hi="भवन" />, b.name],
      [<Label en="Unit" hi="इकाई" />, unit.unitLabel],
      [<Label en="Floor" hi="मंज़िल" />, unit.floor < 0 ? `Basement ${-unit.floor}` : `Floor ${unit.floor}`],
      [<Label en="Extent" hi="क्षेत्रफल" />, `${Math.round(unit.area).toLocaleString('en-IN')} m² (${Math.round(unit.area * 10.764).toLocaleString('en-IN')} sq ft)`],
    ]],
    ['Part 2', 'भाग 2', 'Holder and rights', 'धारक एवं अधिकार', [
      [<Label en="Registered holder" hi="पंजीकृत धारक" />, unit.owner],
      [<Label en="Nature of rights" hi="अधिकार का प्रकार" />, RIGHTS[unit.rightsType] || unit.rightsType],
      [<Label en="Unit layout" hi="इकाई का विन्यास" />, unit.raw?.segmentation === 'model' ? 'Read from the floor plan' : 'Estimated, no floor plan yet'],
      ...(MEASURED.has(b.feature.properties.height_source) ? [[<Label en="Building height" hi="भवन की ऊँचाई" />, `${b.height} m (${b.extraction})`]] : []),
    ]],
    ['Part 3', 'भाग 3', 'Identifiers', 'पहचान संख्या', [
      [<Label en="3D ULPIN" hi="3D यूएलपिन" />, code, 'ULPIN', true],
      [<Label en="Parcel ULPIN" hi="भूखंड यूएलपिन" />, b.baseUlpin, null, true],
      [<Label en="DIGIPIN" hi="डिजिपिन" />, pin, 'DIGIPIN', true],
    ]],
  ]

  return (
    <div>
      <article className="upc-paper" aria-label="Unified Property Card">
        <header className="upc-head">
          <img className="upc-emblem" src="/emblem.svg" alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          <p className="upc-gov"><span lang="hi">भारत सरकार</span> · Government of India</p>
          <p className="upc-dept"><span lang="hi">भूमि संसाधन विभाग</span> · Department of Land Resources</p>
          <div className="upc-tricolour" aria-hidden="true" />
          <h2 className="upc-title" lang="hi">एकीकृत संपत्ति कार्ड</h2>
          <p className="upc-title-en">Unified Property Card (UPC)</p>
          <p className="upc-sub">Record of rights over a unit of a 3D property</p>
        </header>

        <table className="upc-meta">
          <tbody>
            <tr>
              <th scope="row"><Label en="UPC number" hi="यूपीसी क्रमांक" /></th>
              <td className="upc-mono">{code}</td>
            </tr>
            <tr>
              <th scope="row"><Label en="Date of issue" hi="जारी करने की तिथि" /></th>
              <td>{today()}</td>
            </tr>
            <tr>
              <th scope="row"><Label en="Record status" hi="अभिलेख की स्थिति" /></th>
              <td><b>{verified ? 'Verified' : 'Under review'}</b></td>
            </tr>
          </tbody>
        </table>

        <span className={`upc-stamp${verified ? '' : ' is-review'}`} aria-hidden="true">{verified ? 'सत्यापित · Verified' : 'समीक्षाधीन · Under review'}</span>

        {parts.map(([en, hi, title, titleHi, rows]) => (
          <section key={en} className="upc-part">
            <div className="upc-part-head" role="heading" aria-level="3">
              {en} · {title} <span lang="hi">/ {hi} · {titleHi}</span>
            </div>
            <table className="upc-table">
              <tbody>
                {rows.map(([label, value, copyAs, mono], i) => (
                  <tr key={i}>
                    <th scope="row">{label}</th>
                    <td className={mono ? 'upc-mono' : undefined}>
                      {value}
                      {copyAs && (
                        <button type="button" className="upc-copy no-print" onClick={() => copy(value, copyAs)} aria-label={`Copy ${copyAs}`}>
                          <Copy size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        <footer className="upc-foot">
          <QRBlock reference={code} />
          <div>
            <p className="upc-foot-title">Verification <span lang="hi">/ सत्यापन</span></p>
            <p>Scan the QR code to check this card against the registry. It shows whether the record is genuine and current.</p>
            <p className="upc-notice">Prototype built for the Smart India Hackathon. This is not an issued government document or a deed of title.</p>
          </div>
        </footer>
      </article>

      <div className="upc-actions no-print">
        <button type="button" onClick={share} className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#1B2A4A] px-4 py-2 text-sm font-bold text-white hover:bg-[#12203B]">
          <Share2 size={15} /> Share
        </button>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface px-4 py-2 text-sm font-bold text-ink hover:bg-neutralbg">
          <Printer size={15} /> Print or save PDF
        </button>
        <span role="status" className="text-sm font-semibold text-[#0F5442]">{note}</span>
      </div>
    </div>
  )
}
