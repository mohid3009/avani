import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, ChevronDown, Clock, FileText, HelpCircle, MapPin, Search, X,
  Building2, PlusCircle,
} from 'lucide-react'
import { citizenProperties, citizenComplaints as loadComplaints, fileComplaint, peekUnits } from '../api.js'
import { VERIFIED } from '../portalData.js'
import './CitizenDashboard.css'

// ── copy (English is the key; [हिंदी, தமிழ்]) ────────────────────────────────
const T = {
  'Home': ['होम', 'முகப்பு'],
  'My units': ['मेरी इकाइयाँ', 'என் அலகுகள்'],
  'Complaints': ['शिकायतें', 'புகார்கள்'],
  'City map': ['शहर का नक्शा', 'நகர வரைபடம்'],
  'Namaste': ['नमस्ते', 'வணக்கம்'],
  'You own {units} units across {buildings} buildings.': ['{buildings} इमारतों में आपकी {units} इकाइयाँ हैं।', '{buildings} கட்டடங்களில் உங்களுக்கு {units} அலகுகள் உள்ளன.'],
  'Everything is on record. Nothing needs you right now.': ['सब कुछ रिकॉर्ड में है। अभी आपको कुछ करने की ज़रूरत नहीं है।', 'அனைத்தும் பதிவில் உள்ளது. இப்போது நீங்கள் எதுவும் செய்ய வேண்டியதில்லை.'],
  '{n} of your units need a quick look.': ['आपकी {n} इकाइयों पर एक नज़र डालनी है।', 'உங்கள் {n} அலகுகளை ஒருமுறை சரிபார்க்க வேண்டும்.'],
  'Your floors glow yellow. Tap a building to see your units.': ['आपकी मंज़िलें पीली चमकती हैं। अपनी इकाइयाँ देखने के लिए किसी इमारत पर टैप करें।', 'உங்கள் தளங்கள் மஞ்சளாக ஒளிரும். உங்கள் அலகுகளைப் பார்க்க ஒரு கட்டடத்தைத் தட்டவும்.'],
  '+ {n} more buildings': ['+ {n} और इमारतें', '+ மேலும் {n} கட்டடங்கள்'],
  'See my units': ['मेरी इकाइयाँ देखें', 'என் அலகுகளைப் பார்'],
  'Browse them floor by floor': ['मंज़िल दर मंज़िल देखें', 'தளம் தளமாகப் பாருங்கள்'],
  'Property passport': ['संपत्ति पासपोर्ट', 'சொத்து கடவுச்சீட்டு'],
  'Your official record with a QR code': ['QR कोड के साथ आपका आधिकारिक रिकॉर्ड', 'QR குறியீட்டுடன் உங்கள் அதிகாரப்பூர்வ பதிவு'],
  'Report a problem': ['समस्या बताएं', 'சிக்கலைப் புகாரளி'],
  'Wrong area, floor or name?': ['गलत क्षेत्रफल, मंज़िल या नाम?', 'தவறான பரப்பு, தளம் அல்லது பெயர்?'],
  "What's new": ['नया क्या है', 'புதியவை'],
  'Nothing new yet. Changes to your units will show up here.': ['अभी कुछ नया नहीं। आपकी इकाइयों में बदलाव यहाँ दिखेंगे।', 'இன்னும் புதிதாக எதுவும் இல்லை. உங்கள் அலகுகளில் மாற்றங்கள் இங்கே தோன்றும்.'],
  'Questions': ['सवाल', 'கேள்விகள்'],
  'What is a 3D ULPIN?': ['3D ULPIN क्या है?', '3D ULPIN என்றால் என்ன?'],
  "It's an ID for your flat or shop itself, not just the land under the building. It records which floor and which space is yours, so nobody can claim the same space twice.": ['यह आपके फ़्लैट या दुकान की अपनी पहचान संख्या है, सिर्फ़ इमारत के नीचे की ज़मीन की नहीं। इसमें दर्ज होता है कि कौन सी मंज़िल और कौन सी जगह आपकी है, ताकि कोई और उसी जगह पर दावा न कर सके।', 'இது கட்டடத்தின் கீழுள்ள நிலத்துக்கு மட்டுமல்ல, உங்கள் வீடு அல்லது கடைக்கே உரிய அடையாள எண். எந்தத் தளம், எந்த இடம் உங்களுடையது என்பதை இது பதிவு செய்கிறது; அதனால் அதே இடத்தை வேறு யாரும் உரிமை கோர முடியாது.'],
  'Can I show the property passport to my bank?': ['क्या मैं संपत्ति पासपोर्ट अपने बैंक को दिखा सकता हूँ?', 'சொத்து கடவுச்சீட்டை என் வங்கியிடம் காட்டலாமா?'],
  'Yes. It lists your unit, its owner and any open disputes, with a QR code anyone can scan to check it against the registry.': ['हाँ। इसमें आपकी इकाई, उसका मालिक और कोई खुला विवाद दर्ज होता है, साथ में एक QR कोड जिसे स्कैन करके कोई भी रजिस्ट्री से मिलान कर सकता है।', 'ஆம். அதில் உங்கள் அலகு, அதன் உரிமையாளர், நிலுவையிலுள்ள தகராறுகள் உள்ளன; பதிவேட்டுடன் சரிபார்க்க யாரும் ஸ்கேன் செய்யக்கூடிய QR குறியீடும் உண்டு.'],
  "My area doesn't match my sale deed. What now?": ['मेरा क्षेत्रफल विक्रय विलेख से मेल नहीं खाता। अब क्या करूँ?', 'என் பரப்பு விற்பனைப் பத்திரத்துடன் பொருந்தவில்லை. இப்போது என்ன செய்வது?'],
  'Use Report a problem. A surveyor compares your deed with the 3D survey and the registrar replies, usually within 7 working days.': ['"समस्या बताएं" का उपयोग करें। सर्वेक्षक आपके विलेख की तुलना 3D सर्वे से करेगा और रजिस्ट्रार आमतौर पर 7 कार्य दिवसों में जवाब देगा।', '"சிக்கலைப் புகாரளி" என்பதைப் பயன்படுத்துங்கள். நில அளவையாளர் உங்கள் பத்திரத்தை 3D அளவீட்டுடன் ஒப்பிடுவார்; பதிவாளர் வழக்கமாக 7 வேலை நாட்களில் பதிலளிப்பார்.'],
  'Search by building or ULPIN': ['इमारत या ULPIN से खोजें', 'கட்டடம் அல்லது ULPIN மூலம் தேடுங்கள்'],
  'All': ['सभी', 'அனைத்தும்'],
  'All clear': ['सब ठीक', 'அனைத்தும் சரி'],
  'Needs a look': ['जाँच ज़रूरी', 'சரிபார்க்க வேண்டும்'],
  '{n} units': ['{n} इकाइयाँ', '{n} அலகுகள்'],
  '{n} need a look': ['{n} की जाँच ज़रूरी', '{n} சரிபார்க்க வேண்டும்'],
  '{n} storeys': ['{n} मंज़िला', '{n} மாடிகள்'],
  'Floor {n}': ['मंज़िल {n}', 'தளம் {n}'],
  'Basement {n}': ['तहखाना {n}', 'அடித்தளம் {n}'],
  'Unit {n}': ['इकाई {n}', 'அலகு {n}'],
  'Show on map': ['नक्शे पर दिखाएं', 'வரைபடத்தில் காட்டு'],
  'No buildings match your search.': ['आपकी खोज से कोई इमारत नहीं मिली।', 'உங்கள் தேடலுக்கு எந்தக் கட்டடமும் பொருந்தவில்லை.'],
  'Clear search': ['खोज साफ़ करें', 'தேடலை அழி'],
  'No units in your name yet': ['अभी आपके नाम पर कोई इकाई नहीं', 'இன்னும் உங்கள் பெயரில் அலகுகள் இல்லை'],
  'When a surveyor registers a unit in your name, it shows up here.': ['जब सर्वेक्षक आपके नाम पर कोई इकाई दर्ज करेगा, वह यहाँ दिखेगी।', 'நில அளவையாளர் உங்கள் பெயரில் ஒரு அலகைப் பதிவு செய்தால், அது இங்கே தோன்றும்.'],
  'Submitted': ['जमा हुई', 'சமர்ப்பிக்கப்பட்டது'],
  'In review': ['जाँच में', 'பரிசீலனையில்'],
  'Resolved': ['सुलझ गई', 'தீர்க்கப்பட்டது'],
  'Filed on {date}': ['{date} को दर्ज', '{date} அன்று பதிவு'],
  'No complaints yet': ['अभी कोई शिकायत नहीं', 'இன்னும் புகார்கள் இல்லை'],
  'If something in your record looks wrong, tell us and follow the fix here.': ['अगर आपके रिकॉर्ड में कुछ गलत लगे, तो हमें बताएं और सुधार यहाँ देखें।', 'உங்கள் பதிவில் ஏதாவது தவறாகத் தெரிந்தால், எங்களிடம் சொல்லுங்கள்; திருத்தத்தை இங்கே பின்தொடருங்கள்.'],
  'Which unit?': ['कौन सी इकाई?', 'எந்த அலகு?'],
  "What's wrong?": ['क्या गलत है?', 'என்ன தவறு?'],
  'Tell us more': ['थोड़ा और बताएं', 'மேலும் சொல்லுங்கள்'],
  'For example: my deed says 79.5 m² but the record shows 78 m².': ['उदाहरण: मेरे विलेख में 79.5 m² है, पर रिकॉर्ड में 78 m² दिखता है।', 'உதாரணம்: என் பத்திரத்தில் 79.5 m², ஆனால் பதிவில் 78 m² காட்டுகிறது.'],
  'Area is wrong': ['क्षेत्रफल गलत है', 'பரப்பு தவறு'],
  'Floor is wrong': ['मंज़िल गलत है', 'தளம் தவறு'],
  'Owner name is wrong': ['मालिक का नाम गलत है', 'உரிமையாளர் பெயர் தவறு'],
  'Wall or boundary problem': ['दीवार या सीमा की समस्या', 'சுவர் அல்லது எல்லைச் சிக்கல்'],
  'Something else': ['कुछ और', 'வேறு ஏதாவது'],
  'Cancel': ['रद्द करें', 'ரத்துசெய்'],
  'Close': ['बंद करें', 'மூடு'],
  'Send report': ['रिपोर्ट भेजें', 'புகாரை அனுப்பு'],
  'Sending…': ['भेज रहे हैं…', 'அனுப்புகிறது…'],
  'Report sent. Your ticket is {id}.': ['रिपोर्ट भेज दी गई। आपका टिकट {id} है।', 'புகார் அனுப்பப்பட்டது. உங்கள் டிக்கெட் {id}.'],
  'Could not send the report: {msg}': ['रिपोर्ट नहीं भेजी जा सकी: {msg}', 'புகாரை அனுப்ப முடியவில்லை: {msg}'],
  'Loading your units…': ['आपकी इकाइयाँ लोड हो रही हैं…', 'உங்கள் அலகுகள் ஏற்றப்படுகின்றன…'],
}
const LANG_INDEX = { 'हिंदी': 0, 'தமிழ்': 1 }

const ISSUES = ['Area is wrong', 'Floor is wrong', 'Owner name is wrong', 'Wall or boundary problem', 'Something else']
const STEPS = ['Submitted', 'In review', 'Resolved']
const stepOf = (status) => (status === 'resolved' ? 2 : status === 'submitted' ? 0 : 1)

const buildingName = (p) => p.name || `Building ${String(p.building_id).slice(-4)}`
const needsLook = (u) => !VERIFIED.has(u.validation_status)

// ── isometric tower: one band per storey, the citizen's floors lit marigold ──
const COS = 0.866
const SIN = 0.5

function Tower({ x, ground, stories, lit, fh, size, rise }) {
  const F = [x, ground]
  const L = [x - size * COS, ground - size * SIN]
  const R = [x + size * COS, ground - size * SIN]
  const B = [x, ground - size]
  const H = stories * fh
  const pts = (list, dy) => list.map(([px, py]) => `${px},${py - dy}`).join(' ')
  const bands = [...lit].filter((f) => f >= 1 && f <= stories)
  const tankY = ground - size / 2 - H
  return (
    <g className={rise != null ? 'cd-rise' : undefined} style={rise != null ? { '--i': rise } : undefined}>
      <polygon points={`${pts([F, L], 0)} ${pts([L, F], H)}`} className="cd-face-left" />
      <polygon points={`${pts([F, R], 0)} ${pts([R, F], H)}`} className="cd-face-right" />
      {fh >= 4 && Array.from({ length: stories - 1 }, (_, i) => (
        <polyline key={i} points={pts([L, F, R], (i + 1) * fh)} className="cd-floor-line" />
      ))}
      {bands.map((f) => (
        <g key={f}>
          <polygon points={`${pts([F, L], (f - 1) * fh)} ${pts([L, F], f * fh)}`} className="cd-lit-left" />
          <polygon points={`${pts([F, R], (f - 1) * fh)} ${pts([R, F], f * fh)}`} className="cd-lit-right" />
        </g>
      ))}
      <polygon points={pts([F, L, B, R], H)} className="cd-face-top" />
      {/* the rooftop water tank every Indian terrace has */}
      <rect x={x - size * 0.16} y={tankY - size * 0.3} width={size * 0.32} height={size * 0.3} rx={size * 0.06} className="cd-tank" />
    </g>
  )
}

function Skyline({ buildings, onPick, t }) {
  const H = 230
  const ground = 186
  const size = 26
  const step = size * COS * 2 + 44 // room for the name under each tower
  const maxStories = Math.max(...buildings.map((b) => b.stories))
  const fh = Math.min(12, 140 / maxStories)
  const width = buildings.length * step + 30
  return (
    <svg className="cd-skyline" viewBox={`0 0 ${width} ${H}`} role="group" aria-label={t('Your floors glow yellow. Tap a building to see your units.')}>
      <line x1="0" x2={width} y1={ground + 1} y2={ground + 1} className="cd-ground" />
      {buildings.map((b, i) => {
        const x = 15 + step / 2 + i * step
        return (
          <g
            key={b.id}
            className="cd-tower"
            role="button"
            tabIndex={0}
            aria-label={`${b.name}: ${t('{n} units', { n: b.units.length })}, ${t('{n} storeys', { n: b.stories })}`}
            onClick={() => onPick(b.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(b.id) } }}
          >
            <title>{b.name}</title>
            <Tower x={x} ground={ground} stories={b.stories} lit={b.lit} fh={fh} size={size} rise={i} />
            <text x={x} y={ground + 22} className="cd-tower-label">
              {b.name.length > 13 ? `${b.name.slice(0, 12)}…` : b.name}
            </text>
            <text x={x} y={ground + 37} className="cd-tower-count">{t('{n} units', { n: b.units.length })}</text>
          </g>
        )
      })}
    </svg>
  )
}

function MiniTower({ stories, lit }) {
  const fh = Math.min(5, 40 / stories)
  return (
    <svg className="cd-mini" viewBox="-20 -58 40 66" aria-hidden="true">
      <Tower x={0} ground={6} stories={stories} lit={lit} fh={fh} size={14} />
    </svg>
  )
}

export default function CitizenDashboard({ session, onOpenMap, activeLanguage = 'English' }) {
  const navigate = useNavigate()
  const [props, setProps] = useState([])
  const [loading, setLoading] = useState(true)
  const [unitsVersion, setUnitsVersion] = useState(0)
  const [complaints, setComplaints] = useState([])
  const [view, setView] = useState('home') // home | units | complaints
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all') // all | clear | attention
  const [openBuilding, setOpenBuilding] = useState(null)
  const [openFaq, setOpenFaq] = useState(null)
  const [toast, setToast] = useState(null)
  const [reporting, setReporting] = useState(null) // unit_ulpin preselected in the report form, or ''

  const li = LANG_INDEX[activeLanguage]
  const t = (key, vars = {}) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), (li != null && T[key]?.[li]) || key)

  useEffect(() => {
    let alive = true
    citizenProperties()
      .then((rows) => { if (alive) setProps(rows) })
      .finally(() => { if (alive) setLoading(false) })
    const bump = () => setUnitsVersion((v) => v + 1)
    window.addEventListener('demo-units-changed', bump)
    return () => { alive = false; window.removeEventListener('demo-units-changed', bump) }
  }, [])

  const reloadComplaints = () => loadComplaints().then(setComplaints).catch(() => {})
  useEffect(() => { reloadComplaints() }, [])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  // buildings where this citizen owns units, with their own units attached
  const buildings = useMemo(() => props.map((f) => {
    const p = f.properties
    const units = peekUnits(p.building_id)
      .filter((u) => u.owner_id === session?.owner_id)
      .sort((a, b) => a.floor_index - b.floor_index || a.unit_no - b.unit_no)
    return {
      id: p.building_id,
      name: buildingName(p),
      stories: Math.max(1, p.stories || 1),
      units,
      lit: new Set(units.map((u) => u.floor_index)),
      attention: units.filter(needsLook).length,
    }
  }).filter((b) => b.units.length), [props, unitsVersion, session?.owner_id])

  const totalUnits = buildings.reduce((s, b) => s + b.units.length, 0)
  const totalAttention = buildings.reduce((s, b) => s + b.attention, 0)
  const firstUnit = buildings[0]?.units[0]
  const openComplaints = complaints.filter((c) => c.status !== 'resolved').length

  // skyline: the 6 buildings holding most of the citizen's units, tallest in the middle
  const skyline = useMemo(() => {
    const pick = [...buildings].sort((a, b) => b.units.length - a.units.length).slice(0, 6)
    const out = []
    pick.sort((a, b) => b.stories - a.stories).forEach((b, i) => (i % 2 ? out.push(b) : out.unshift(b)))
    return out
  }, [buildings])

  // what's new: units that need attention, then registry decisions and own complaints
  const news = useMemo(() => {
    const urgent = []
    const recent = []
    for (const b of buildings) {
      for (const u of b.units) {
        if (u.validation_status === 'conflict') urgent.push({ id: `c-${u.unit_ulpin}`, tone: 'warn', text: `Unit ${u.unit_no} on floor ${u.floor_index} in ${b.name} needs a quick look`, sub: 'A surveyor will check its boundaries.' })
        else if (u.validation_status === 'pending_approval') urgent.push({ id: `p-${u.unit_ulpin}`, tone: 'warn', text: `A correction to unit ${u.unit_no} in ${b.name} is waiting for the registrar`, sub: `Proposed by ${u.last_edited_by || 'a surveyor'}` })
        for (const h of u.edit_history || []) recent.push({ id: `${u.unit_ulpin}-${h.at}`, tone: 'ok', text: h.change, sub: (h.at || '').slice(0, 10), date: h.at || '' })
      }
    }
    for (const c of complaints) {
      recent.push({ id: c.id, tone: c.status === 'resolved' ? 'ok' : 'info', text: `You reported: ${c.issueType}`, sub: `${c.unitId}, ${c.date}`, date: c.date })
    }
    recent.sort((a, b) => b.date.localeCompare(a.date))
    return [...urgent, ...recent].slice(0, 3)
  }, [buildings, complaints])

  const shownBuildings = useMemo(() => {
    const q = query.trim().toLowerCase()
    return buildings.filter((b) => {
      if (filter === 'clear' && b.attention) return false
      if (filter === 'attention' && !b.attention) return false
      return !q || b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q) ||
        b.units.some((u) => u.unit_ulpin.toLowerCase().includes(q))
    })
  }, [buildings, query, filter])

  const pickBuilding = (id) => {
    setFilter('all')
    setQuery('')
    setOpenBuilding(id)
    setView('units')
  }

  const floorLabel = (f) => (f < 0 ? t('Basement {n}', { n: -f }) : t('Floor {n}', { n: f }))

  const faqs = [
    ['What is a 3D ULPIN?', "It's an ID for your flat or shop itself, not just the land under the building. It records which floor and which space is yours, so nobody can claim the same space twice."],
    ['Can I show the property passport to my bank?', 'Yes. It lists your unit, its owner and any open disputes, with a QR code anyone can scan to check it against the registry.'],
    ["My area doesn't match my sale deed. What now?", 'Use Report a problem. A surveyor compares your deed with the 3D survey and the registrar replies, usually within 7 working days.'],
  ]

  const tabs = [
    ['home', t('Home')],
    ['units', t('My units'), totalUnits],
    ['complaints', t('Complaints'), openComplaints || null],
  ]

  return (
    <main className={`citizen-main-content cd${reporting != null ? ' has-modal' : ''}`}>
      {toast && <div className="cb-toast" role="status" aria-live="polite"><CheckCircle2 size={14} /> {toast}</div>}

      <nav className="cd-nav">
        <div className="cd-tabs" role="tablist">
          {tabs.map(([key, label, badge]) => (
            <button key={key} role="tab" aria-selected={view === key} className="cd-tab" onClick={() => setView(key)}>
              {label}{badge ? <span className="cd-badge">{badge}</span> : null}
            </button>
          ))}
        </div>
        <button className="cd-btn cd-btn-quiet" onClick={() => onOpenMap(null)}>
          <MapPin size={15} /> {t('City map')}
        </button>
      </nav>

      {loading && <div className="cd-loading" aria-busy="true">{t('Loading your units…')}</div>}

      {!loading && view === 'home' && (
        <>
          <section className="cd-hero">
            <div className="cd-hero-text">
              <h1 className="cd-hello">{t('Namaste')}, {session?.name?.split(' ')[0] || ''}</h1>
              {totalUnits > 0 ? (
                <>
                  <p className="cd-lead">{t('You own {units} units across {buildings} buildings.', { units: totalUnits, buildings: buildings.length })}</p>
                  <p className={`cd-status ${totalAttention ? 'is-warn' : 'is-ok'}`}>
                    {totalAttention ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                    {totalAttention
                      ? t('{n} of your units need a quick look.', { n: totalAttention })
                      : t('Everything is on record. Nothing needs you right now.')}
                  </p>
                </>
              ) : (
                <p className="cd-lead">{t('When a surveyor registers a unit in your name, it shows up here.')}</p>
              )}
            </div>
            {skyline.length > 0 && (
              <div className="cd-hero-art">
                <Skyline buildings={skyline} onPick={pickBuilding} t={t} />
                <p className="cd-hint">
                  <span className="cd-swatch" aria-hidden="true" /> {t('Your floors glow yellow. Tap a building to see your units.')}
                  {buildings.length > skyline.length && (
                    <button className="cd-link" onClick={() => setView('units')}>
                      {t('+ {n} more buildings', { n: buildings.length - skyline.length })}
                    </button>
                  )}
                </p>
              </div>
            )}
          </section>

          <section className="cd-actions">
            <button className="cd-action is-leaf" onClick={() => setView('units')}>
              <span className="cd-action-icon"><Building2 size={22} /></span>
              <span className="cd-action-title">{t('See my units')}</span>
              <span className="cd-action-sub">{t('Browse them floor by floor')}</span>
            </button>
            <button className="cd-action is-marigold" disabled={!firstUnit} onClick={() => navigate(`/passport/${encodeURIComponent(firstUnit.unit_ulpin)}`)}>
              <span className="cd-action-icon"><FileText size={22} /></span>
              <span className="cd-action-title">{t('Property passport')}</span>
              <span className="cd-action-sub">{t('Your official record with a QR code')}</span>
            </button>
            <button className="cd-action is-brick" disabled={!firstUnit} onClick={() => setReporting('')}>
              <span className="cd-action-icon"><AlertTriangle size={22} /></span>
              <span className="cd-action-title">{t('Report a problem')}</span>
              <span className="cd-action-sub">{t('Wrong area, floor or name?')}</span>
            </button>
          </section>

          <div className="cd-columns">
            <section className="cd-panel">
              <h2 className="cd-h2">{t("What's new")}</h2>
              {news.length === 0 && <p className="cd-muted">{t('Nothing new yet. Changes to your units will show up here.')}</p>}
              <ul className="cd-news">
                {news.map((n) => (
                  <li key={n.id} className={`cd-news-item is-${n.tone}`}>
                    <span className="cd-dot" aria-hidden="true" />
                    <div>
                      <p className="cd-news-text">{n.text}</p>
                      <p className="cd-muted">{n.sub}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="cd-panel">
              <h2 className="cd-h2"><HelpCircle size={18} /> {t('Questions')}</h2>
              {faqs.map(([q, a], i) => (
                <div key={q} className="cd-faq">
                  <button className="cd-faq-q" aria-expanded={openFaq === i} onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                    {t(q)} <ChevronDown size={16} className="cd-chev" />
                  </button>
                  {openFaq === i && <p className="cd-faq-a">{t(a)}</p>}
                </div>
              ))}
            </section>
          </div>
        </>
      )}

      {!loading && view === 'units' && (
        <>
          <div className="cd-toolbar">
            <label className="cd-search">
              <Search size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search by building or ULPIN')} />
            </label>
            <div className="cd-chips" role="radiogroup">
              {[['all', t('All')], ['clear', t('All clear')], ['attention', t('Needs a look')]].map(([key, label]) => (
                <button key={key} role="radio" aria-checked={filter === key} className="cd-chip" onClick={() => setFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {buildings.length === 0 && (
            <div className="cd-empty">
              <Building2 size={28} />
              <h2 className="cd-h2">{t('No units in your name yet')}</h2>
              <p className="cd-muted">{t('When a surveyor registers a unit in your name, it shows up here.')}</p>
            </div>
          )}
          {buildings.length > 0 && shownBuildings.length === 0 && (
            <div className="cd-empty">
              <Search size={28} />
              <p className="cd-muted">{t('No buildings match your search.')}</p>
              <button className="cd-btn cd-btn-quiet" onClick={() => { setQuery(''); setFilter('all') }}>{t('Clear search')}</button>
            </div>
          )}

          <ul className="cd-buildings">
            {shownBuildings.map((b) => {
              const open = openBuilding === b.id
              return (
                <li key={b.id} className={`cd-building${open ? ' is-open' : ''}`}>
                  <button className="cd-building-head" aria-expanded={open} onClick={() => setOpenBuilding(open ? null : b.id)}>
                    <MiniTower stories={b.stories} lit={b.lit} />
                    <span className="cd-building-name">
                      {b.name}
                      <span className="cd-muted">{t('{n} storeys', { n: b.stories })}</span>
                    </span>
                    <span className="cd-pill">{t('{n} units', { n: b.units.length })}</span>
                    <span className={`cd-pill ${b.attention ? 'is-warn' : 'is-ok'}`}>
                      {b.attention ? t('{n} need a look', { n: b.attention }) : t('All clear')}
                    </span>
                    <ChevronDown size={18} className="cd-chev" />
                  </button>
                  {open && (
                    <div className="cd-building-body">
                      <div className="cd-unit-grid">
                        {b.units.map((u) => (
                          <button
                            key={u.unit_ulpin}
                            className={`cd-unit${needsLook(u) ? ' is-warn' : ''}`}
                            onClick={() => navigate(`/portal/property/${encodeURIComponent(u.unit_ulpin)}`)}
                            title={u.unit_ulpin}
                          >
                            <span className="cd-unit-floor">{floorLabel(u.floor_index)}</span>
                            <span>{t('Unit {n}', { n: u.unit_no })}</span>
                            <span className="cd-muted">{Math.round(u.area_sqm).toLocaleString('en-IN')} m²</span>
                          </button>
                        ))}
                      </div>
                      <button className="cd-link" onClick={() => onOpenMap(b.id)}><MapPin size={14} /> {t('Show on map')}</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {!loading && view === 'complaints' && (
        <>
          <div className="cd-toolbar">
            <h2 className="cd-h2">{t('Complaints')}</h2>
            <button className="cd-btn cd-btn-primary" disabled={!firstUnit} onClick={() => setReporting('')}>
              <PlusCircle size={16} /> {t('Report a problem')}
            </button>
          </div>
          {complaints.length === 0 ? (
            <div className="cd-empty">
              <CheckCircle2 size={28} />
              <h2 className="cd-h2">{t('No complaints yet')}</h2>
              <p className="cd-muted">{t('If something in your record looks wrong, tell us and follow the fix here.')}</p>
            </div>
          ) : (
            <ul className="cd-tickets">
              {complaints.map((c) => {
                const step = stepOf(c.status)
                return (
                  <li key={c.id} className="cd-ticket">
                    <div className="cd-ticket-head">
                      <h3 className="cd-ticket-title">{c.issueType}</h3>
                      <span className="cd-muted">{c.id}</span>
                    </div>
                    <p className="cd-muted">{c.unitId}. {t('Filed on {date}', { date: c.date })}</p>
                    <p className="cd-ticket-desc">{c.description}</p>
                    <ol className="cd-steps" aria-label={t(STEPS[step])}>
                      {STEPS.map((s, i) => (
                        <li key={s} className={i <= step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
                          {i < step ? <CheckCircle2 size={14} /> : i === step ? <Clock size={14} /> : <span className="cd-step-dot" />}
                          {t(s)}
                        </li>
                      ))}
                    </ol>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {reporting != null && (
        <ReportDialog
          t={t}
          buildings={buildings}
          initialUnit={reporting || firstUnit?.unit_ulpin}
          floorLabel={floorLabel}
          onClose={() => setReporting(null)}
          onSent={(ticket) => {
            setReporting(null)
            reloadComplaints()
            setView('complaints')
            showToast(t('Report sent. Your ticket is {id}.', { id: ticket }))
          }}
        />
      )}
    </main>
  )
}

function ReportDialog({ t, buildings, initialUnit, floorLabel, onClose, onSent }) {
  const [unit, setUnit] = useState(initialUnit)
  const [issue, setIssue] = useState(ISSUES[0])
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('modal-scroll-lock')
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('modal-scroll-lock') }
  }, [onClose])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const building = buildings.find((b) => b.units.some((u) => u.unit_ulpin === unit))
      onSent(await fileComplaint({ unitId: unit, buildingId: building?.id, issueType: issue, description: details.trim() }))
    } catch (err) {
      setError(t('Could not send the report: {msg}', { msg: err.message }))
      setBusy(false)
    }
  }

  return (
    <div className="citizen-modal-backdrop" onClick={onClose}>
      <form className="citizen-modal cd-dialog" role="dialog" aria-modal="true" aria-labelledby="cd-report-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="cd-dialog-head">
          <h2 id="cd-report-title" className="cd-h2">{t('Report a problem')}</h2>
          <button type="button" className="cd-icon-btn" onClick={onClose} aria-label={t('Close')}><X size={18} /></button>
        </div>

        <label className="cd-field">
          <span>{t('Which unit?')}</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {buildings.map((b) => (
              <optgroup key={b.id} label={b.name}>
                {b.units.map((u) => (
                  <option key={u.unit_ulpin} value={u.unit_ulpin}>{floorLabel(u.floor_index)}, {t('Unit {n}', { n: u.unit_no })}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <fieldset className="cd-field">
          <legend>{t("What's wrong?")}</legend>
          <div className="cd-chips">
            {ISSUES.map((k) => (
              <label key={k} className="cd-chip">
                <input type="radio" name="issue" value={k} checked={issue === k} onChange={() => setIssue(k)} />
                {t(k)}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="cd-field">
          <span>{t('Tell us more')}</span>
          <textarea rows={4} required value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t('For example: my deed says 79.5 m² but the record shows 78 m².')} />
        </label>

        {error && <p className="cd-error" role="alert">{error}</p>}

        <div className="cd-dialog-foot">
          <button type="button" className="cd-btn cd-btn-quiet" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="cd-btn cd-btn-primary" disabled={busy || !details.trim()}>
            {busy ? t('Sending…') : t('Send report')}
          </button>
        </div>
      </form>
    </div>
  )
}
