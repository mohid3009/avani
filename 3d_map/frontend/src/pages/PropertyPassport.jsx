import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Building2, ChevronRight, Box, ShieldCheck, Printer, AlertTriangle,
  Copy, Check, FileCheck, Layers, Hash, ArrowLeft, Stamp, FileText, CheckCircle2
} from 'lucide-react'
import Breadcrumb from '../components/ui/Breadcrumb.jsx'
import DetailGrid from '../components/ui/DetailGrid.jsx'
import QRBlock from '../components/ui/QRBlock.jsx'
import MapInset from '../components/ui/MapInset.jsx'
import CubeMark from '../components/CubeMark.jsx'
import IndianEmblem from '../components/ui/IndianEmblem.jsx'
import { useUnit } from '../portalData.js'

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

export default function PropertyPassport() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState('deed') // 'deed' (Formal Govt E-Stamp) | 'dashboard' (Interactive 3D)
  const [showFull, setShowFull] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState('specs') // 'specs' | 'encumbrance' | 'ledger'

  const { data: unit, loading } = useUnit(id)

  const copyUlpin = () => {
    if (!unit) return
    navigator.clipboard?.writeText(unit.ulpin)
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }

  if (loading) return <div className="loading muted">loading passport…</div>
  if (!unit) {
    return (
      <div className="max-w-[720px] mx-auto p-6">
        <Breadcrumb current="Property Passport" />
        <div className="bg-white border border-[#E4E7EC] rounded-[14px] p-8 text-center text-sm text-[#1C2530] mt-4 shadow-sm">
          <p className="text-base font-bold text-[#1C2530] mb-2">Property Record Not Found</p>
          <p className="mb-4">No 3D unit record exists with identifier &ldquo;{id}&rdquo;.</p>
          <Link
            to="/dashboard"
            className="btn primary inline-flex items-center gap-2"
          >
            <ArrowLeft size={14} /> Back to My Properties
          </Link>
        </div>
      </div>
    )
  }

  const b = unit.building

  return (
    <div className="max-w-[880px] mx-auto pb-16 text-[#1C2530] govt-deed-container">
      {/* Top Action & Mode Switch Bar */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap no-print">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="btn tiny inline-flex items-center gap-1.5"
            title="Return to your dashboard"
          >
            <ArrowLeft size={13} /> Dashboard
          </button>
          <Breadcrumb current="Formal Government Deed" />
        </div>

        {/* View Mode Toggle: Formal Indian Govt Deed vs Interactive 3D Passport */}
        <div className="flex items-center bg-[#E2E8F0] p-1 rounded-xl gap-1 border border-[#CBD5E1]">
          <button
            type="button"
            onClick={() => setViewMode('deed')}
            aria-pressed={viewMode === 'deed'}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all ${
              viewMode === 'deed'
                ? 'bg-white text-[#8B6508] shadow-xs'
                : 'text-[#334155] hover:text-[#0F172A]'
            }`}
          >
            <Stamp size={13} /> Formal E-Stamp Deed
          </button>
          <button
            type="button"
            onClick={() => setViewMode('dashboard')}
            aria-pressed={viewMode === 'dashboard'}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all ${
              viewMode === 'dashboard'
                ? 'bg-white text-[#176B55] shadow-xs'
                : 'text-[#334155] hover:text-[#0F172A]'
            }`}
          >
            <Box size={13} /> Interactive 3D Passport
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="btn tiny primary inline-flex items-center gap-1.5 bg-[#8B6508] hover:bg-[#6D4F05] text-white border-none shadow-sm"
            title="Print or save as official PDF Certificate"
          >
            <Printer size={13} /> Print E-Stamp Certificate
          </button>
          <button
            onClick={() => navigate(`/portal/report/${unit.id}`)}
            className="btn tiny inline-flex items-center gap-1.5 text-[#8A6410] border-[#F0DCAE] hover:bg-[#FDF4E3]"
            title="File dispute if details do not match"
          >
            <AlertTriangle size={13} /> Report Problem
          </button>
        </div>
      </div>

      {/* =========================================================================
          VIEW MODE 1: FORMAL INDIAN GOVERNMENT E-STAMP & TITLE DEED CERTIFICATE
          ========================================================================= */}
      {viewMode === 'deed' && (
        <div className="govt-deed-paper govt-border-frame p-6 sm:p-10 rounded-xs">
          {/* Watermark Pattern */}
          <div className="estamp-watermark">
            <IndianEmblem size={320} color="#8B6508" />
          </div>

          {/* Top Header & Crest */}
          <div className="relative z-10 text-center pb-6 border-b-2 border-[#8B6508]/40">
            <IndianEmblem size={56} color="#8B6508" className="mb-2" />
            <div className="text-[12px] font-bold uppercase tracking-[0.25em] text-[#8B6508]">
              भारत सरकार · GOVERNMENT OF INDIA
            </div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#554114] mt-0.5">
              राजस्व एवं भूमि संसाधन विभाग · DEPARTMENT OF LAND RESOURCES
            </div>
            <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-[#1E293B] mt-2 font-serif">
              3D त्रि-विमीय भू-स्थानिक संपत्ति विलेख एवं प्रमाण पत्र
            </h1>
            <div className="text-sm font-bold uppercase tracking-wider text-[#8B6508] mt-0.5">
              CERTIFICATE OF TITLE &amp; VOLUMETRIC 3D ULPIN DEED
            </div>
            <div className="text-[10px] uppercase tracking-widest text-[#64748B] mt-1 font-mono">
              Issued under Article 33 of Indian Stamp Act, 1899 &amp; NGDRS 3D Cadastre Rules, 2026
            </div>
          </div>

          {/* E-Stamp Official Metadata Table Box */}
          <div className="relative z-10 mt-6 estamp-header-box p-4 rounded-xs text-xs">
            <div className="flex items-center justify-between border-b border-[#D4AF37]/50 pb-2 mb-3">
              <span className="font-extrabold uppercase tracking-wider text-[#8B6508] flex items-center gap-1.5">
                <Stamp size={14} /> Official Government E-Stamp Paper Details (e-Stamping)
              </span>
              <span className="font-mono text-[10px] bg-[#8B6508] text-white px-2 py-0.5 rounded font-bold">
                NON-JUDICIAL
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-[11px] text-[#292318]">
              <div>
                <span className="text-[9.5px] text-[#786134] uppercase block font-sans font-semibold">Certificate No.</span>
                <span className="font-bold text-[#1E293B]">IN-TN9843210459812M</span>
              </div>
              <div>
                <span className="text-[9.5px] text-[#786134] uppercase block font-sans font-semibold">Certificate Issued Date</span>
                <span className="font-bold text-[#1E293B]">14-Nov-2024 10:45 AM</span>
              </div>
              <div>
                <span className="text-[9.5px] text-[#786134] uppercase block font-sans font-semibold">Account Reference</span>
                <span className="font-bold text-[#1E293B]">IMPACC (SH)/ tn991204/ CHENNAI</span>
              </div>
              <div>
                <span className="text-[9.5px] text-[#786134] uppercase block font-sans font-semibold">Unique Doc Ref (GRN)</span>
                <span className="font-bold text-[#8B6508]">GRN-2024-8849-0192</span>
              </div>
              <div>
                <span className="text-[9.5px] text-[#786134] uppercase block font-sans font-semibold">Purchased / Executed By</span>
                <span className="font-bold text-[#1E293B] uppercase">{unit.owner}</span>
              </div>
              <div>
                <span className="text-[9.5px] text-[#786134] uppercase block font-sans font-semibold">Description of Document</span>
                <span className="font-bold text-[#1E293B]">Article 33 Conveyance of 3D Property</span>
              </div>
              <div>
                <span className="text-[9.5px] text-[#786134] uppercase block font-sans font-semibold">Stamp Duty Amount</span>
                <span className="font-bold text-[#1E293B]">₹ 500/- (Five Hundred Only)</span>
              </div>
              <div>
                <span className="text-[9.5px] text-[#786134] uppercase block font-sans font-semibold">Registration Fee Paid</span>
                <span className="font-bold text-[#166534]">₹ 5,95,000/- (7% Duty + 1% Surcharge)</span>
              </div>
            </div>
          </div>

          {/* National 3D ULPIN Identity Badge */}
          <div className="relative z-10 mt-6 bg-[#FAF4E6] border-2 border-[#8B6508] p-4 rounded-xs flex items-center justify-between flex-wrap gap-4">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-[#786134] block">
                NATIONAL 3D UNIQUE LAND PARCEL IDENTIFIER (3D ULPIN)
              </span>
              <div className="font-mono text-base sm:text-lg font-black text-[#1E293B] tracking-wider mt-0.5">
                {unit.ulpin}
              </div>
              <span className="text-[11px] text-[#554114] mt-0.5 block font-sans">
                Sub-Registrar Office: <strong className="text-[#1E293B]">SRO T. Nagar (Code 309), Central Chennai District</strong>
              </span>
            </div>

            <div className="text-right">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#166534] text-white text-xs font-bold rounded shadow-xs uppercase tracking-wider">
                <CheckCircle2 size={13} /> DEMO RECORD — {unit.status.toUpperCase()}
              </span>
              <span className="text-[10px] text-[#786134] block mt-1 font-mono">
                DIGIPIN Grid: <strong className="text-[#1E293B]">3M-889-J21-K0</strong>
              </span>
            </div>
          </div>

          {/* Legal Schedule Sections */}
          <div className="relative z-10 mt-8 space-y-6">
            {/* SCHEDULE A */}
            <div className="border border-[#D4AF37] rounded-xs overflow-hidden">
              <div className="govt-schedule-banner px-4 py-2 font-bold text-xs uppercase tracking-wider flex items-center justify-between">
                <span>अनुसूची 'क' — संपत्ति विवरण · SCHEDULE 'A' — PARCEL &amp; LOCATION DETAILS</span>
                <span className="text-[10px] text-[#D4AF37] font-mono">LOCATION PARCEL</span>
              </div>
              <div className="p-4 bg-[#FFFDF8] grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-sans text-[#1E293B]">
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">State / Territory</span>
                  <span className="font-bold">Tamil Nadu</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Registration District</span>
                  <span className="font-bold">Chennai Central</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Sub-Registrar Office (SRO)</span>
                  <span className="font-bold">SRO T. Nagar</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Revenue Village / Ward</span>
                  <span className="font-bold">Triplicane-Mylapore / Ward 114</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Survey Ward &amp; Block</span>
                  <span className="font-bold">Block 24 · Town Survey TS 104/2</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Base Footprint Area</span>
                  <span className="font-bold">420.00 m² (Ground Parcel)</span>
                </div>
              </div>
            </div>

            {/* SCHEDULE B */}
            <div className="border border-[#D4AF37] rounded-xs overflow-hidden">
              <div className="govt-schedule-banner px-4 py-2 font-bold text-xs uppercase tracking-wider flex items-center justify-between">
                <span>अनुसूची 'ख' — 3D त्रि-विमीय सीमाएँ · SCHEDULE 'B' — 3D VOLUMETRIC SPATIAL ENVELOPE</span>
                <span className="text-[10px] text-[#D4AF37] font-mono">3D VOLUMETRIC BOUNDS</span>
              </div>
              <div className="p-4 bg-[#FFFDF8] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-sans text-[#1E293B]">
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Unit Label &amp; Level</span>
                  <span className="font-bold">{unit.unitLabel} ({ordinal(unit.floor)} Floor)</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Carpet Area</span>
                  <span className="font-bold text-[#1E293B]">{unit.area} m² (~{Math.round(unit.area * 10.764)} sq.ft)</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Storey Height</span>
                  <span className="font-bold">3.05 metres</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">3D Volumetric Enclosure</span>
                  <span className="font-bold text-[#8B6508]">{(unit.area * 3.05).toFixed(1)} m³</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Centroid Geographical Frame</span>
                  <span className="font-mono font-bold text-[11px]">13.04128° N, 80.23381° E</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Vertical Z-Bounds (Above MSL)</span>
                  <span className="font-mono font-bold text-[11px] text-[#166534]">Z-Min: +18.20m | Z-Max: +21.25m</span>
                </div>
              </div>
            </div>

            {/* SCHEDULE C */}
            <div className="border border-[#D4AF37] rounded-xs overflow-hidden">
              <div className="govt-schedule-banner px-4 py-2 font-bold text-xs uppercase tracking-wider flex items-center justify-between">
                <span>अनुसूची 'ग' — अधिकार अभिलेख एवं स्वामित्व · SCHEDULE 'C' — RECORD OF RIGHTS &amp; TITLE VESTING</span>
                <span className="text-[10px] text-[#D4AF37] font-mono">RECORD OF RIGHTS</span>
              </div>
              <div className="p-4 bg-[#FFFDF8] grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-sans text-[#1E293B]">
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Registered Title Holder</span>
                  <span className="font-bold text-[#1E293B]">{unit.owner}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Nature of Title</span>
                  <span className="font-bold text-[#166534]">Absolute Freehold Title (कब्ज़ा / मालकाना)</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Aadhaar Linkage</span>
                  <span className="font-bold">Verified (XXXX-XXXX-4821)</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Execution Sale Deed</span>
                  <span className="font-bold">Doc # 44821/2024 at SRO T. Nagar</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Registration Date</span>
                  <span className="font-bold">14 November 2024</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#786134] font-semibold block uppercase">Consideration Value</span>
                  <span className="font-bold">₹ 85,00,000/-</span>
                </div>
              </div>
            </div>

            {/* SCHEDULE D */}
            <div className="border border-[#D4AF37] rounded-xs overflow-hidden">
              <div className="govt-schedule-banner px-4 py-2 font-bold text-xs uppercase tracking-wider flex items-center justify-between">
                <span>अनुसूची 'घ' — भारहीनता प्रमाण पत्र · SCHEDULE 'D' — NO-ENCUMBRANCE CLEARANCE &amp; NOC</span>
                <span className="text-[10px] text-[#D4AF37] font-mono">ENCUMBRANCE SEARCH</span>
              </div>
              <div className="p-4 bg-[#FFFDF8] space-y-2 text-xs font-sans text-[#1E293B]">
                <div className="flex items-center justify-between p-2 bg-[#FAF4E6] rounded border border-[#D4AF37]/40">
                  <span>30-Year Lien &amp; Bank Mortgage Search (1996 - 2026)</span>
                  <span className="font-bold text-[#166534]">NIL (Clear &amp; Marketable Title)</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-white rounded border border-[#E2E8F0]">
                  <span>Civil Court Lis Pendens &amp; Injunction Claims</span>
                  <span className="font-bold text-[#166534]">NONE FILED</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-white rounded border border-[#E2E8F0]">
                  <span>Greater Chennai Municipal Property Tax Dues</span>
                  <span className="font-bold text-[#166534]">PAID IN FULL (FY 2026-27 Receipt # 9918)</span>
                </div>
              </div>
            </div>

            {/* SCHEDULE E - AUDIT TRAIL */}
            <div className="border border-[#D4AF37] rounded-xs overflow-hidden">
              <div className="govt-schedule-banner px-4 py-2 font-bold text-xs uppercase tracking-wider flex items-center justify-between">
                <span>अनुसूची 'ङ' — क्रिप्टो ग्राफिक ऑडिट ट्रेल · SCHEDULE 'E' — CRYPTOGRAPHIC AUDIT TRAIL &amp; IMMUTABLE LEDGER</span>
                <span className="text-[10px] text-[#D4AF37] font-mono">BLOCKCHAIN LEDGER</span>
              </div>
              <div className="p-4 bg-[#FFFDF8] space-y-2.5 font-mono text-xs">
                <div className="p-2.5 bg-white rounded border border-[#E2E8F0] border-l-4 border-l-[#166534]">
                  <div className="flex items-center justify-between text-[11px] text-[#554114] mb-1 font-sans">
                    <span className="font-bold text-[#1E293B]">BLOCK #3 · 3D ULPIN VOLUMETRIC REGISTRATION</span>
                    <span>2026-09-02 14:10 UTC</span>
                  </div>
                  <div className="text-[#1E293B] font-sans text-xs mb-1">
                    Vertical 3D volumetric boundaries minted and registered to {unit.owner}
                  </div>
                  <div className="text-[10px] text-[#64748B]">
                    Prev Hash: <span className="text-[#176B55]">9e8a71b2...4401</span> · Block Hash: <span className="text-[#166534] font-bold">d7204f1e...b891</span> · Validator: PKI-CDAC-TN-991
                  </div>
                </div>

                <div className="p-2.5 bg-white rounded border border-[#E2E8F0] border-l-4 border-l-[#176B55]">
                  <div className="flex items-center justify-between text-[11px] text-[#554114] mb-1 font-sans">
                    <span className="font-bold text-[#1E293B]">BLOCK #2 · SPATIAL SURVEY CERTIFICATION</span>
                    <span>2026-08-20 09:30 UTC</span>
                  </div>
                  <div className="text-[#1E293B] font-sans text-xs mb-1">
                    OpenStreetMap &amp; 3D LiDAR footprint topology validated with 0 volumetric overlaps
                  </div>
                  <div className="text-[10px] text-[#64748B]">
                    Prev Hash: <span className="text-[#176B55]">1a2b3c4d...9981</span> · Block Hash: <span className="text-[#176B55] font-bold">9e8a71b2...4401</span> · Surveyor: TN-SURV-309
                  </div>
                </div>

                <div className="p-2.5 bg-white rounded border border-[#E2E8F0] border-l-4 border-l-[#8B6508]">
                  <div className="flex items-center justify-between text-[11px] text-[#554114] mb-1 font-sans">
                    <span className="font-bold text-[#1E293B]">BLOCK #1 · GENESIS TITLE REGISTRATION</span>
                    <span>2024-11-14 11:20 UTC</span>
                  </div>
                  <div className="text-[#1E293B] font-sans text-xs mb-1">
                    Sale Deed executed at SRO T. Nagar · Absolute title conveyed to {unit.owner}
                  </div>
                  <div className="text-[10px] text-[#64748B]">
                    Prev Hash: <span className="text-[#64748B]">00000000...0000</span> · Block Hash: <span className="text-[#8B6508] font-bold">1a2b3c4d...9981</span> · SRO Code: 309
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sub-Registrar Official Signatures & Seal Block */}
          <div className="relative z-10 mt-10 pt-6 border-t-2 border-[#8B6508]/40 flex items-center justify-between flex-wrap gap-6">
            {/* Scannable Verification QR */}
            <div className="flex items-center gap-3">
              <QRBlock reference={unit.ulpin} />
            </div>

            {/* Red Circular Embossed Government Seal */}
            <div className="govt-seal-circle">
              <span className="text-[7.5px] font-bold uppercase tracking-tighter">OFFICIAL SEAL</span>
              <IndianEmblem size={24} color="#991B1B" />
              <span className="text-[7px] font-black uppercase tracking-widest mt-0.5">SUB-REGISTRAR</span>
              <span className="text-[6px] font-bold">T. NAGAR · CHENNAI</span>
            </div>

            {/* Digital Signature Block */}
            <div className="text-right font-serif">
              <div className="text-xs font-bold text-[#1E293B]">Digitally Signed &amp; Attested by:</div>
              <div className="text-sm font-black text-[#8B6508] uppercase mt-0.5">REGISTRAR 1, IAS</div>
              <div className="text-[10.5px] font-semibold text-[#554114]">District Land Registrar &amp; Authority</div>
              <div className="text-[9.5px] font-mono text-[#64748B] mt-1">
                e-Sign PKI Certificate: <span className="font-bold text-[#1E293B]">CDAC-TN-8842910</span>
              </div>
              <div className="text-[9px] font-mono text-[#166534] font-bold">
                ✓ Aadhaar OTP Verified at 2024-11-14 11:20:00 IST
              </div>
            </div>
          </div>

          {/* Micro-text Security Footer */}
          <div className="relative z-10 mt-8 text-center text-[9px] font-mono text-[#786134] uppercase tracking-widest border-t border-[#D4AF37]/50 pt-3">
            ★ GOVERNMENT OF INDIA ★ REVENUE DEPARTMENT ★ NATIONAL URBAN 3D CADASTRE &amp; PROPERTY REGISTRATION SYSTEM ★
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW MODE 2: INTERACTIVE 3D DIGITAL PASSPORT (MODERN APP VIEW)
          ========================================================================= */}
      {viewMode === 'dashboard' && (
        <div className="bg-white border border-[#E4E7EC] rounded-[16px] overflow-hidden shadow-md">
          {/* Official Header Strip */}
          <div className="bg-gradient-to-r from-[#0D1126] via-[#141A38] to-[#0D1126] border-b border-[#1E2548] p-5 text-white flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-[10px] bg-white/10 backdrop-blur border border-white/15 grid place-items-center shrink-0">
                <CubeMark size={24} tint="#8B93E8" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#A5B4FC]">
                  Government of India · National Urban 3D Cadastre
                </div>
                <h1 className="text-lg font-extrabold text-white tracking-tight flex items-center gap-2 mt-0.5 flex-wrap">
                  Digital Property Passport
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-[#34D399]/20 text-[#34D399] border border-[#34D399]/40 px-2.5 py-0.5 rounded-full">
                    <ShieldCheck size={12} /> VERIFIED TITLE
                  </span>
                </h1>
              </div>
            </div>

            <div className="text-right text-xs text-white/70">
              <span className="text-[10px] uppercase tracking-wider block text-white/50">Jurisdiction</span>
              <span className="font-semibold text-white">Greater Chennai · Ward 114</span>
            </div>
          </div>

          {/* Identity & ULPIN Hero */}
          <div className="p-6 bg-white border-b border-[#E4E7EC]">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="text-xs uppercase font-semibold tracking-wider text-[#1C2530] mb-1">
                  {b.name}
                </div>
                <div className="text-2xl font-black text-[#1C2530] tracking-tight flex items-center gap-2">
                  {unit.unitLabel}
                  <span className="text-sm font-medium text-[#1C2530]">
                    ({ordinal(unit.floor)} Floor)
                  </span>
                </div>
                <div className="text-xs text-[#1C2530] mt-1 flex items-center gap-2">
                  <span>{b.address}</span>
                </div>
              </div>

              {/* ULPIN Copy Badge */}
              <div className="bg-[#F9FAFB] border border-[#E4E7EC] rounded-[12px] p-3 w-full sm:w-auto min-w-0 flex flex-col items-start sm:items-end">
                <span className="text-[10px] uppercase font-bold tracking-widest text-[#1C2530] block mb-1">
                  3D ULPIN (National Spatial ID)
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-id text-[13px] font-semibold text-[#176B55] min-w-0 break-all">
                    {showFull ? unit.ulpin : `${unit.ulpin.slice(0, 22)}…`}
                  </span>
                  <button
                    onClick={copyUlpin}
                    className="p-1.5 rounded-md hover:bg-black/5 text-[#1C2530] hover:text-[#1C2530] transition-colors"
                    title="Copy full ULPIN"
                  >
                    {copied ? <Check size={14} className="text-[#1B7A4A]" /> : <Copy size={14} />}
                  </button>
                </div>
                <button
                  onClick={() => setShowFull(!showFull)}
                  className="text-[11px] text-[#176B55] hover:underline mt-1 font-medium"
                >
                  {showFull ? 'Show condensed' : 'Show full national key'}
                </button>
              </div>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
              <div className="bg-[#FFFFFF] border border-[#E4E7EC] rounded-[10px] p-3 shadow-xs">
                <span className="text-[10.5px] uppercase font-semibold text-[#1C2530] block">Carpet Area</span>
                <span className="text-base font-bold text-[#1C2530]">{unit.area} m²</span>
                <span className="text-[10px] text-[#1C2530] block">~{Math.round(unit.area * 10.764)} sq.ft</span>
              </div>
              <div className="bg-[#FFFFFF] border border-[#E4E7EC] rounded-[10px] p-3 shadow-xs">
                <span className="text-[10.5px] uppercase font-semibold text-[#1C2530] block">Registered Owner</span>
                <span className="text-base font-bold text-[#1C2530] truncate block">{unit.owner}</span>
                <span className="text-[10px] text-[#1B7A4A] font-medium block">✓ Sole Freehold Title</span>
              </div>
              <div className="bg-[#FFFFFF] border border-[#E4E7EC] rounded-[10px] p-3 shadow-xs">
                <span className="text-[10.5px] uppercase font-semibold text-[#1C2530] block">Encumbrance (NOC)</span>
                <span className="text-base font-bold text-[#1B7A4A]">Clear</span>
                <span className="text-[10px] text-[#1C2530] block">No Bank Lien / Claims</span>
              </div>
              <div className="bg-[#FFFFFF] border border-[#E4E7EC] rounded-[10px] p-3 shadow-xs">
                <span className="text-[10.5px] uppercase font-semibold text-[#1C2530] block">Property Tax</span>
                <span className="text-base font-bold text-[#1B7A4A]">Paid</span>
                <span className="text-[10px] text-[#1C2530] block">FY 2026-27 Cleared</span>
              </div>
            </div>
          </div>

          {/* Navigation Tabs inside Passport */}
          <div className="flex border-b border-[#E4E7EC] px-6 pt-2 bg-[#F9FAFB] gap-4 overflow-x-auto">
            <button
              onClick={() => setActiveTab('specs')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border-b-2 transition-all ${
                activeTab === 'specs'
                  ? 'border-[#176B55] text-[#176B55]'
                  : 'border-transparent text-[#1C2530] hover:text-[#1C2530]'
              }`}
            >
              <Layers size={14} /> 3D Spatial Specs &amp; Map
            </button>
            <button
              onClick={() => setActiveTab('encumbrance')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border-b-2 transition-all ${
                activeTab === 'encumbrance'
                  ? 'border-[#176B55] text-[#176B55]'
                  : 'border-transparent text-[#1C2530] hover:text-[#1C2530]'
              }`}
            >
              <FileCheck size={14} /> Record of Rights &amp; Encumbrance
            </button>
            <button
              onClick={() => setActiveTab('ledger')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border-b-2 transition-all ${
                activeTab === 'ledger'
                  ? 'border-[#176B55] text-[#176B55]'
                  : 'border-transparent text-[#1C2530] hover:text-[#1C2530]'
              }`}
            >
              <Hash size={14} /> Blockchain Audit Trail
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-6 bg-white">
            {activeTab === 'specs' && (
              <div className="space-y-5">
                <div className="bg-[#F9FAFB] border border-[#E4E7EC] rounded-[12px] p-4">
                  <h3 className="text-xs uppercase tracking-wider font-bold text-[#1C2530] mb-3">
                    Volumetric &amp; Cadastral Dimensions
                  </h3>
                  <DetailGrid
                    fields={[
                      { label: 'Vertical Level', value: `Floor ${unit.floor} of ${b.floors}` },
                      { label: 'Ceiling Height', value: '3.05 metres' },
                      { label: 'Volumetric Envelope', value: `${(unit.area * 3.05).toFixed(1)} m³` },
                      { label: 'Base Parcel ULPIN', value: <span className="font-id">{b.baseUlpin}</span> },
                      { label: 'Rights Category', value: unit.rightsType || 'Freehold Title' },
                      { label: 'Survey Source', value: b.extraction || 'LiDAR & Cadastre Mesh' },
                    ]}
                    columns={3}
                  />
                </div>

                {/* QR Verification Block */}
                <div className="bg-[#F9FAFB] border border-[#E4E7EC] rounded-[12px] p-4">
                  <QRBlock reference={unit.ulpin} />
                </div>

                {/* Map Inset */}
                <div>
                  <MapInset highlightUnit geometry={b.feature.geometry} ulpin={b.baseUlpin} />
                </div>
              </div>
            )}

            {activeTab === 'encumbrance' && (
              <div className="space-y-4">
                <div className="bg-[#F9FAFB] border border-[#E4E7EC] rounded-[12px] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-[#1C2530]">Record of Rights (RoR) Certificate</h3>
                    <span className="chip status-valid">
                      Clear &amp; Marketable
                    </span>
                  </div>
                  <DetailGrid
                    fields={[
                      { label: 'Registry Document #', value: 'DOC-2024-TN07-44821' },
                      { label: 'Registration Date', value: '14 November 2024' },
                      { label: 'Sub-Registrar Office', value: 'SRO T. Nagar, Central Chennai' },
                      { label: 'Survey Ward & Block', value: 'Block 24 · Town Survey # 104/2' },
                      { label: 'Aadhaar Linkage', value: 'Verified (Masked · XXXX 4821)' },
                      { label: 'DigiLocker Doc URI', value: 'gov.in.tn.rev.ror/44821' },
                    ]}
                    columns={2}
                  />
                </div>

                <div className="bg-[#F9FAFB] border border-[#E4E7EC] rounded-[12px] p-5">
                  <h3 className="text-sm font-bold text-[#1C2530] mb-3">No-Encumbrance Status (NOC)</h3>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-start justify-between gap-3 flex-wrap p-2.5 bg-white rounded-[8px] border border-[#E4E7EC]">
                      <span className="text-[#1C2530]">Mortgage / Bank Lien Search (Past 30 Years)</span>
                      <span className="text-[#1B7A4A] font-bold sm:text-right">NIL (No registered encumbrance)</span>
                    </div>
                    <div className="flex items-start justify-between gap-3 flex-wrap p-2.5 bg-white rounded-[8px] border border-[#E4E7EC]">
                      <span className="text-[#1C2530]">Civil Court Lis Pendens / Injunctions</span>
                      <span className="text-[#1B7A4A] font-bold sm:text-right">NONE FILED</span>
                    </div>
                    <div className="flex items-start justify-between gap-3 flex-wrap p-2.5 bg-white rounded-[8px] border border-[#E4E7EC]">
                      <span className="text-[#1C2530]">Municipal Property Tax Dues</span>
                      <span className="text-[#1B7A4A] font-bold sm:text-right">ZERO DUES (Receipt #2026-CH-991)</span>
                    </div>
                    <div className="flex items-start justify-between gap-3 flex-wrap p-2.5 bg-white rounded-[8px] border border-[#E4E7EC]">
                      <span className="text-[#1C2530]">Electricity &amp; Water Board Arrears</span>
                      <span className="text-[#1B7A4A] font-bold sm:text-right">ACTIVE &amp; PAID</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'ledger' && (
              <div className="space-y-4">
                <div className="bg-[#F9FAFB] border border-[#E4E7EC] rounded-[12px] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-[#1C2530]">Cryptographic Audit Chain</h3>
                      <p className="text-xs text-[#1C2530]">
                        Every transaction is hashed into an immutable append-only ledger
                      </p>
                    </div>
                    <span className="chip status-valid flex items-center gap-1">
                      <Check size={13} /> Chain Valid
                    </span>
                  </div>

                  <div className="space-y-3 font-mono text-xs">
                    {/* Block 3 */}
                    <div className="p-3 bg-white rounded-[8px] border border-[#E4E7EC] border-l-4 border-l-[#1B7A4A]">
                      <div className="flex items-center justify-between text-[11px] text-[#1C2530] mb-1">
                        <span className="font-bold text-[#1C2530]">BLOCK #3 · 3D ULPIN REGISTRATION</span>
                        <span>2026-09-02 14:10 UTC</span>
                      </div>
                      <div className="text-[#1C2530] font-sans text-xs mb-1">
                        Vertical volumetric boundaries minted and assigned to {unit.owner}
                      </div>
                      <div className="text-[11px] text-[#1C2530]">
                        Prev Hash: <span className="text-[#176B55]">9e8a71...4401</span> · Block Hash:{' '}
                        <span className="text-[#1B7A4A]">d7204f...b891</span>
                      </div>
                    </div>

                    {/* Block 2 */}
                    <div className="p-3 bg-white rounded-[8px] border border-[#E4E7EC] border-l-4 border-l-[#176B55]">
                      <div className="flex items-center justify-between text-[11px] text-[#1C2530] mb-1">
                        <span className="font-bold text-[#1C2530]">BLOCK #2 · SPATIAL SURVEY CERTIFICATION</span>
                        <span>2026-08-20 09:30 UTC</span>
                      </div>
                      <div className="text-[#1C2530] font-sans text-xs mb-1">
                        OpenStreetMap footprint topology validated with 0 overlap conflicts
                      </div>
                      <div className="text-[11px] text-[#1C2530]">
                        Prev Hash: <span className="text-[#1A2B3C]">1a2b3c...9981</span> · Block Hash:{' '}
                        <span className="text-[#176B55]">9e8a71...4401</span>
                      </div>
                    </div>

                    {/* Block 1 */}
                    <div className="p-3 bg-white rounded-[8px] border border-[#E4E7EC] border-l-4 border-l-[#98A2B3]">
                      <div className="flex items-center justify-between text-[11px] text-[#1C2530] mb-1">
                        <span className="font-bold text-[#1C2530]">BLOCK #1 · GENESIS TITLE REGISTRATION</span>
                        <span>2024-11-14 11:20 UTC</span>
                      </div>
                      <div className="text-[#1C2530] font-sans text-xs mb-1">
                        Sale Deed executed at SRO T. Nagar · Title conveyed to {unit.owner}
                      </div>
                      <div className="text-[11px] text-[#1C2530]">
                        Prev Hash: <span className="text-[#1C2530]">000000...0000</span> · Block Hash:{' '}
                        <span className="text-[#176B55]">1a2b3c...9981</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="bg-[#F9FAFB] border-t border-[#E4E7EC] p-5 flex items-center justify-between gap-3 flex-wrap">
            <Link
              to={`/portal/upc/${b.id}`}
              className="text-xs font-semibold text-[#176B55] hover:underline inline-flex items-center gap-1"
            >
              Part of {b.name} parcel record <ChevronRight size={13} />
            </Link>

            <div className="flex items-center gap-2.5">
              <button
                onClick={() => navigate('/dashboard')}
                className="btn text-xs"
              >
                ← Back to My Properties
              </button>
              <button
                onClick={() => navigate(`/portal/report/${unit.id}`)}
                className="btn text-xs"
              >
                Report Discrepancy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}