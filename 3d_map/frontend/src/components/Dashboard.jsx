import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, NavLink, useNavigate } from 'react-router-dom'
import {
  getSavedBuildings, getSessions, deleteSession, updateBuilding,
  confirmBuildingEdit, deleteBuilding as deleteBuildingApi,
  getRegion, allUnits, digipin, citizenOwns, peekUnits, segmentationStatus,
  getPendingUnitEdits, confirmUnitCorrection, rejectUnitCorrection,
  proposeBuildingEdit, confirmPendingBuildingEdit, rejectPendingBuildingEdit, getPendingBuildingEdits,
} from '../api.js'
import BuildingsMap from './BuildingsMap.jsx'
import CitizenDashboard from './CitizenDashboard.jsx'
import Topbar from './layout/Topbar.jsx'
import './staff.css'
import EvidenceBadge from './ui/EvidenceBadge.jsx'
import StackPanel from './StackPanel.jsx'
import ReportsPanel from './ui/ReportsPanel.jsx'
import { MEASURED } from '../portalData.js'

// ── helpers ──────────────────────────────────────────────────────────────────

/** Geographic bbox of one GeoJSON Polygon feature. */
function bboxOfFeature(feature) {
  const ring = feature?.geometry?.type === 'Polygon' ? feature.geometry.coordinates[0] : null
  if (!ring?.length) return null
  // Use a loop rather than Math.min/max spread to avoid RangeError on large rings
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity
  for (const [lon, lat] of ring) {
    if (lat < latMin) latMin = lat
    if (lat > latMax) latMax = lat
    if (lon < lonMin) lonMin = lon
    if (lon > lonMax) lonMax = lon
  }
  return { latMin, lonMin, spanLat: latMax - latMin, spanLon: lonMax - lonMin }
}

// plain-language height provenance; MEASURED ones count as real data
const HEIGHT_SOURCE = {
  lidar: 'Measured by LiDAR',
  'google-open-buildings-2.5d': 'Google Open Buildings 2.5D',
  'surveyor-verified': 'Verified by surveyor',
  'registrar-approved': 'Approved by registrar',
  'tag-height': 'OpenStreetMap height tag',
  'tag-levels': 'Estimated from OSM storey count',
  'assumed-1-story': 'Assumed 1 storey (no data)',
  edited: 'Footprint edited',
  manual: 'Drawn manually',
}
const heightLabel = (p) => {
  const label = HEIGHT_SOURCE[p.height_source] || 'Estimated from building type'
  return p.height_source === 'google-open-buildings-2.5d' && p.height_year ? `${label} (${p.height_year})` : label
}

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

// [label, before, after, unit] rows that a building proposal actually changes
const proposalChanges = (p) => [
  ['Height', p.before.height_m, p.after.height_m, ' m'],
  ['Storeys', p.before.stories, p.after.stories, ''],
  ['Basements', p.before.basements ?? 0, p.after.basements ?? 0, ''],
].filter(([, a, b]) => a !== b)

// ── component ─────────────────────────────────────────────────────────────────

export default function Dashboard(props) {
  if (!props.session) return <Navigate to="/" replace />
  return <DashboardContent {...props} />
}

function DashboardContent({ session, onLogout, activeLanguage, onLanguageChange }) {

  const [state, setState]               = useState('loading') // loading | ready | empty | unavailable
  const [features, setFeatures]         = useState([])
  const [drawn, setDrawn]               = useState(false) // the map has painted the buildings at least once
  const [sessions, setSessions]         = useState([])
  const [focusSid, setFocusSid]         = useState(null)   // focused session inside a region
  const [regionData, setRegionData]     = useState({})     // cluster key -> { country, region }
  const [selCountry, setSelCountry]     = useState(null)
  const [selRegion, setSelRegion]       = useState(null)   // "country||region" key
  const [selectedId, setSelectedId]     = useState(null)
  const [reloadKey, setReloadKey]       = useState(0)
  const [editingBld, setEditingBld]     = useState(false)  // inline dashboard edit
  const [editDraft, setEditDraft]       = useState(null)
  const [toast, setToast]               = useState(null)   // { kind: 'success' | 'info', text }
  const [resolvingIds, setResolvingIds] = useState(() => new Set())
  const [unavailableErr, setUnavailableErr] = useState(null)
  const toastTimerRef = useRef(null)

  // first-run orientation: dismissible, remembered for the browser session
  const [guideOpen, setGuideOpen] = useState(() => !sessionStorage.getItem('avani-guide-seen'))
  const dismissGuide = () => {
    setGuideOpen(false)
    sessionStorage.setItem('avani-guide-seen', '1')
  }

  // ── data loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setState('loading')
    setDrawn(false)
    Promise.all([getSavedBuildings(), getSessions()])
      .then(([fc, ss]) => {
        if (cancelled) return
        setFeatures(fc.features || [])
        setSessions(ss)
        setSelCountry(null)
        setSelRegion(null)
        setFocusSid(null)
        setState(fc.features?.length ? 'ready' : 'empty')
      })
      .catch((e) => {
        if (cancelled) return
        setFeatures([])
        setSessions([])
        setUnavailableErr(e?.message || 'unknown error')
        setState('unavailable')
      })
    return () => { cancelled = true }
  }, [reloadKey])

  // If PostgreSQL wasn't reachable, keep retrying every 5 s
  useEffect(() => {
    if (state !== 'unavailable') return
    const t = setTimeout(() => setReloadKey((k) => k + 1), 5000)
    return () => clearTimeout(t)
  }, [state, reloadKey])

  // ── proximity clusters ────────────────────────────────────────────────────
  const clusters = useMemo(() => {
    const meta = new Map() // session_id -> { count, lon, lat }
    for (const f of features) {
      const sid = f.properties.session_id
      const g   = f.geometry
      if (!sid || !g) continue
      const coords = g.type === 'Polygon' ? g.coordinates[0] : (g.coordinates || []).flat()
      if (!coords?.length) continue
      let lon = 0, lat = 0
      for (const [x, y] of coords) { lon += x; lat += y }
      lon /= coords.length; lat /= coords.length
      const m = meta.get(sid) || { count: 0, lon: 0, lat: 0 }
      m.count += 1; m.lon += lon; m.lat += lat
      meta.set(sid, m)
    }
    const TH  = 0.5 // degrees (~55 km)
    const raw = []
    for (const [sid, m] of meta) {
      const s   = { sid, count: m.count, lon: m.lon / m.count, lat: m.lat / m.count }
      let grp   = raw.find((g) => Math.abs(g.lat - s.lat) < TH && Math.abs(g.lon - s.lon) < TH)
      if (!grp) { grp = { sids: [], lonSum: 0, latSum: 0, buildings: 0 }; raw.push(grp) }
      grp.sids.push(sid); grp.lonSum += s.lon; grp.latSum += s.lat; grp.buildings += s.count
    }
    const labelOf = (sid) => sessions.find((x) => x.session_id === sid)?.label || sid
    return raw.map((g) => ({
      key:       `${(g.latSum / g.sids.length).toFixed(2)},${(g.lonSum / g.sids.length).toFixed(2)}`,
      lat:       g.latSum / g.sids.length,
      lon:       g.lonSum / g.sids.length,
      sids:      g.sids,
      buildings: g.buildings,
      objs:      g.sids.map((sid) => ({ sid, label: labelOf(sid), count: meta.get(sid).count })),
    }))
  }, [features, sessions])

  // ── region resolution (Nominatim-backed in production, stub in demo) ──────
  useEffect(() => {
    const missing = clusters.filter((g) => !regionData[g.key])
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      for (const g of missing) {
        try {
          const v = await getRegion(g.lat, g.lon)
          if (cancelled) return
          setRegionData((prev) => ({ ...prev, [g.key]: v }))
        } catch {
          if (cancelled) return
          setRegionData((prev) => ({ ...prev, [g.key]: { country: null, region: null } }))
        }
      }
    })()
    return () => { cancelled = true }
  }, [clusters, regionData])

  const regionKeyOf = (g) => {
    const info = regionData[g.key]
    if (!info) return { country: '⏳ locating…', region: '…', pending: true }
    if (!info.country)
      return { country: 'Unknown area', region: `near ${g.lat.toFixed(2)}, ${g.lon.toFixed(2)}`, pending: false }
    return { country: info.country, region: info.region || '—', pending: false }
  }

  // country → region → scans hierarchy
  const countryTree = useMemo(() => {
    const countries = new Map()
    for (const g of clusters) {
      const { country, region } = regionKeyOf(g)
      if (!countries.has(country))
        countries.set(country, { name: country, regions: new Map(), sids: [], buildings: 0 })
      const c  = countries.get(country)
      const rk = `${country}||${region}`
      if (!c.regions.has(rk))
        c.regions.set(rk, { key: rk, name: region, sids: [], buildings: 0, scans: [] })
      const r = c.regions.get(rk)
      for (const sid of g.sids) c.sids.push(sid)
      c.buildings += g.buildings
      for (const sid of g.sids) r.sids.push(sid)
      r.buildings += g.buildings
      r.scans.push(...g.objs)
    }
    return [...countries.values()].map((c) => ({ ...c, regions: [...c.regions.values()] }))
  }, [clusters, regionData])

  // sids visible under the current country/region selection (null = everything)
  const visibleSids = useMemo(() => {
    if (!selCountry) return null
    const c = countryTree.find((x) => x.name === selCountry)
    if (!c) return null
    if (!selRegion) return new Set(c.sids)
    const r = c.regions.find((x) => x.key === selRegion)
    return r ? new Set(r.sids) : null
  }, [countryTree, selCountry, selRegion])

  const visibleFeatures = useMemo(() => {
    if (focusSid) return features.filter((f) => f.properties.session_id === focusSid)
    if (visibleSids) return features.filter((f) => visibleSids.has(f.properties.session_id))
    return features
  }, [features, focusSid, visibleSids])

  // open the scan page with this set of buildings (plus a margin, so neighbours help line the survey up)
  const rescanArea = (feats, name) => {
    const pts = feats.flatMap((f) => (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]))
    const pad = 0.002
    const box = [Math.min(...pts.map((p) => p[0])) - pad, Math.min(...pts.map((p) => p[1])) - pad, Math.max(...pts.map((p) => p[0])) + pad, Math.max(...pts.map((p) => p[1])) + pad].map((n) => n.toFixed(6))
    navigate(`/lidar?rescan=${box.join(',')}&name=${encodeURIComponent(name)}${feats.length > 1 ? `&count=${feats.length}` : ''}`)
  }
  const focusSession  = (sid) => setFocusSid((cur) => (cur === sid ? null : sid))
  const removeSession = (sid) => {
    deleteSession(sid)
      .then(() => setReloadKey((k) => k + 1))
      .catch((e) => console.error('session delete failed:', e))
  }

  const canEdit         = session?.role === 'surveyor'
  const isRegistrar     = session?.role === 'registrar'
  const isSurveyor      = session?.role === 'surveyor'
  const isCitizen       = session?.role === 'citizen'
  const canEditBuildings = isSurveyor || isRegistrar
  const navigate        = useNavigate()

  const [citizenMapView, setCitizenMapView] = useState(false)

  const ownedIds = useMemo(
    () => isCitizen
      ? features.filter((f) => citizenOwns(f.properties.building_id)).map((f) => f.properties.building_id)
      : null,
    [features, isCitizen],
  )

  const citizenMapFeatures = useMemo(() => {
    if (!isCitizen) return null
    if (selectedId) {
      const f = features.find((x) => x.properties.building_id === selectedId)
      if (f) return [f]
    }
    return features.filter((f) => citizenOwns(f.properties.building_id))
  }, [isCitizen, features, selectedId])

  // ── registrar search ──────────────────────────────────────────────────────
  const [searchQ, setSearchQ]       = useState('')
  const [searchFocus, setSearchFocus] = useState(false)
  const [unitsVersion, setUnitsVersion] = useState(0)
  useEffect(() => {
    const bump = () => setUnitsVersion((v) => v + 1)
    window.addEventListener('demo-units-changed', bump)
    return () => window.removeEventListener('demo-units-changed', bump)
  }, [])

  const [pendingUnitEdits, setPendingUnitEdits] = useState(() => getPendingUnitEdits())
  const [pendingBuildingProposals, setPendingBuildingProposals] = useState(() => getPendingBuildingEdits())

  useEffect(() => {
    const refresh = () => {
      setPendingUnitEdits(getPendingUnitEdits())
      setPendingBuildingProposals(getPendingBuildingEdits())
    }
    window.addEventListener('demo-pending-unit-edits-changed', refresh)
    window.addEventListener('demo-pending-building-edits-changed', refresh)
    window.addEventListener('demo-units-changed', refresh)
    return () => {
      window.removeEventListener('demo-pending-unit-edits-changed', refresh)
      window.removeEventListener('demo-pending-building-edits-changed', refresh)
      window.removeEventListener('demo-units-changed', refresh)
    }
  }, [])

  const [rejectBldProposalId, setRejectBldProposalId] = useState(null)
  const [rejectBldProposalReason, setRejectBldProposalReason] = useState('')

  const handleApproveBuildingProposal = async (proposalId) => {
    try {
      const res = await confirmPendingBuildingEdit(proposalId, session)
      showToast('success', `✓ Building proposal approved & updated live`)
      setFeatures((prev) =>
        prev.map((f) => (f.properties.building_id === res.building.properties.building_id ? res.building : f))
      )
    } catch (e) {
      showToast('info', `Error: ${e.message}`)
    }
  }

  const handleRejectBuildingProposal = async () => {
    if (!rejectBldProposalId) return
    try {
      await rejectPendingBuildingEdit(rejectBldProposalId, session, rejectBldProposalReason)
      setRejectBldProposalId(null)
      setRejectBldProposalReason('')
      showToast('info', 'Building proposal rejected')
      setReloadKey((k) => k + 1)
    } catch (e) {
      showToast('info', `Error: ${e.message}`)
    }
  }

  const [rejectUnitId, setRejectUnitId]       = useState(null)
  const [rejectUnitReason, setRejectUnitReason] = useState('')

  const handleApproveUnitEdit = async (editId) => {
    try {
      await confirmUnitCorrection(editId, session)
      showToast('success', '✓ Unit correction approved')
    } catch (e) {
      showToast('info', `Error: ${e.message}`)
    }
  }

  const handleRejectUnitEdit = async () => {
    if (!rejectUnitId) return
    try {
      await rejectUnitCorrection(rejectUnitId, session, rejectUnitReason)
      setRejectUnitId(null)
      setRejectUnitReason('')
      showToast('info', 'Unit correction rejected')
    } catch (e) {
      showToast('info', `Error: ${e.message}`)
    }
  }

  const unitIndex = useMemo(() => {
    const byId = new Map(features.map((f) => [f.properties.building_id, f]))
    return allUnits().map((u) => {
      const f    = byId.get(u.building_id)
      let pin    = ''
      const ring = u.polygon || []
      if (f && ring.length) {
        const bb = bboxOfFeature(f)
        if (bb) {
          const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
          const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
          pin = digipin(bb.latMin + cy * bb.spanLat, bb.lonMin + cx * bb.spanLon)
        }
      }
      return {
        buildingId: u.building_id,
        ulpin: u.unit_ulpin,
        sub:   `${u.owner_name} · ${u.validation_status}${pin ? ` · ${pin}` : ''}`,
        hay:   `${u.unit_ulpin} ${u.owner_name} ${pin}`.toLowerCase(),
      }
    })
  }, [features, unitsVersion])

  const searchResults = useMemo(() => {
    const needle = searchQ.trim().toLowerCase()
    if (!needle) return []
    const out = []
    for (const f of features) {
      const p = f.properties
      if (
        (p.name || '').toLowerCase().includes(needle) ||
        (p.building_id || '').toLowerCase().includes(needle)
      ) {
        out.push({ id: p.building_id, name: p.name || p.building_id, note: `${p.stories ?? '—'} str`, sub: null })
        continue
      }
      const hits = unitIndex.filter((e) => e.buildingId === p.building_id && e.hay.includes(needle))
      if (hits.length) {
        out.push({
          id:   p.building_id,
          name: p.name || p.building_id,
          note: hits[0].ulpin,
          sub:  hits.length > 1 ? `${hits[0].sub} · +${hits.length - 1} more` : hits[0].sub,
        })
      }
    }
    return out.slice(0, 8)
  }, [searchQ, features, unitIndex])

  const goToSearchResult = (r) => {
    setSearchQ(''); setSearchFocus(false)
    setSelCountry(null); setSelRegion(null); setFocusSid(null)
    setSelectedId(r.id)
  }

  const showToast = (kind, text) => {
    setToast({ kind, text })
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 4200)
  }

  const pendingFeatures = useMemo(
    () => features.filter((f) => f.properties.edit_status === 'pending'),
    [features],
  )

  // ── building edit / confirm / delete ─────────────────────────────────────
  const saveBuildingEdit = async () => {
    if (!selectedId || !editDraft) return
    const feature = features.find((f) => f.properties.building_id === selectedId)
    if (!feature) return

    const stories = Math.min(60, Math.max(1, parseInt(editDraft.floors) || 1))
    const basements = Math.min(6, Math.max(0, parseInt(editDraft.basements) || 0))
    const height_m = Math.min(250, Math.max(0.5, parseFloat(editDraft.height) || stories * 3))
    const note = (editDraft.note || '').trim()
    const file = editDraft.spatialFile || null
    if (session?.role === 'surveyor' && !note) {
      showToast('info', 'Add a reason so the registrar knows where the new numbers come from')
      return
    }

    try {
      const res = await proposeBuildingEdit(
        selectedId,
        { height_m, stories, basements, asset_type: editDraft.assetType, note },
        session,
        file
      )

      if (res.pending) {
        showToast('info', 'Sent to the registrar for approval')
        setFeatures((prev) =>
          prev.map((f) =>
            f.properties.building_id === selectedId
              ? { ...f, properties: { ...f.properties, edit_status: 'pending', pending_proposal: res.proposal, pending_proposal_id: res.proposal.id } }
              : f
          )
        )
      } else {
        showToast('success', 'Saved')
        setFeatures((prev) =>
          prev.map((f) => (f.properties.building_id === selectedId ? res.building : f))
        )
      }
      setEditingBld(false)
      setEditDraft(null)
    } catch (err) {
      console.error('Save building edit error:', err)
      showToast('info', `Error: ${err.message}`)
    }
  }

  const confirmBuilding = (bid) => {
    const entry = {
      at: new Date().toISOString(), by: session.name, role: session.role,
      change: 'edit confirmed by registrar',
    }
    setResolvingIds((prev) => new Set(prev).add(bid))
    confirmBuildingEdit(bid, 'confirmed', entry)
      .then(() => {
        showToast('success', `✓ edit confirmed — ${bid}`)
        setTimeout(() => {
          setFeatures((prev) =>
            prev.map((f) =>
              f.properties.building_id === bid
                ? { ...f, properties: { ...f.properties, edit_status: 'confirmed', edit_history: [...(f.properties.edit_history || []), entry] } }
                : f,
            ),
          )
          setResolvingIds((prev) => { const next = new Set(prev); next.delete(bid); return next })
        }, 700)
      })
      .catch((e) => {
        setResolvingIds((prev) => { const next = new Set(prev); next.delete(bid); return next })
        console.error('confirm failed:', e.message)
      })
  }

  const handleFootprintDrawn = (bid, ring) => {
    const feature = features.find((f) => f.properties.building_id === bid)
    if (!feature) return
    const p      = feature.properties
    const status = session.role === 'registrar' ? 'confirmed' : 'pending'
    const updated = {
      ...feature,
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        ...p,
        height_source: p.height_source === 'manual' ? 'manual' : 'edited',
        color:        '#2fbf8f',
        edit_status:  status,
        edit_history: [
          ...(p.edit_history || []),
          {
            at: new Date().toISOString(), by: session.name, role: session.role,
            change: `footprint redrawn (${ring.length} corners)${status === 'confirmed' ? ' (auto-confirmed)' : ' — awaiting registrar confirmation'}`,
          },
        ],
      },
    }
    updateBuilding(updated)
      .then(() => {
        setFeatures((prev) => prev.map((f) => (f.properties.building_id === bid ? updated : f)))
        showToast(
          status === 'confirmed' ? 'success' : 'info',
          status === 'confirmed'
            ? `✓ footprint redrawn & auto-confirmed — ${bid}`
            : `footprint redrawn — awaiting registrar confirmation`,
        )
      })
      .catch((e) => console.error('footprint update failed:', e.message))
  }

  const removeBuilding = (bid) => {
    if (!window.confirm(`Delete building ${bid} and its record? This cannot be undone.`)) return
    deleteBuildingApi(bid)
      .then(() => {
        setFeatures((prev) => prev.filter((f) => f.properties.building_id !== bid))
        setSelectedId(null); setEditingBld(false); setEditDraft(null)
        showToast('info', `building deleted — ${bid}`)
      })
      .catch((e) => console.error('building delete failed:', e.message))
  }

  const selected = useMemo(
    () => visibleFeatures.find((f) => f.properties.building_id === selectedId)?.properties ?? null,
    [visibleFeatures, selectedId],
  )

  const proposedRows = useMemo(() => {
    if (!selected || selected.edit_status !== 'pending') return []
    const rows = []
    if (selected.original_height_m != null && selected.original_height_m !== selected.height_m)
      rows.push(['height', `${selected.original_height_m} m`, `${selected.height_m} m`])
    if (selected.original_stories != null && selected.original_stories !== selected.stories)
      rows.push(['storeys', selected.original_stories, selected.stories])
    if (selected.original_basements != null && selected.original_basements !== (selected.basements || 0))
      rows.push(['basements', selected.original_basements, selected.basements || 0])
    return rows
  }, [selected])

  const stats = useMemo(() => {
    const n = visibleFeatures.length
    if (!n) return null
    const fromLidar = visibleFeatures.filter((f) => MEASURED.has(f.properties.height_source)).length
    const assumed   = visibleFeatures.filter((f) => f.properties.height_source === 'assumed-1-story').length
    const edited    = visibleFeatures.filter((f) => ['edited', 'manual'].includes(f.properties.height_source)).length
    const heights   = visibleFeatures.map((f) => f.properties.height_m || 0)
    return {
      n, fromLidar, assumed, edited,
      tallest: heights.reduce((a, b) => Math.max(a, b), 0),
      mean:    heights.reduce((a, b) => a + b, 0) / n,
    }
  }, [visibleFeatures])

  // ── staff work queue ──────────────────────────────────────────────────────
  const [modelStatus, setModelStatus] = useState(null)
  useEffect(() => {
    if (!canEditBuildings) return
    segmentationStatus().then(setModelStatus).catch(() => setModelStatus({ ready: false, reason: 'could not reach the server' }))
  }, [canEditBuildings])

  const focusBuilding = (bid) => {
    setSelCountry(null); setSelRegion(null); setFocusSid(null)
    setEditingBld(false); setEditDraft(null)
    setSelectedId(bid)
  }
  const nameOf = (bid) => features.find((f) => f.properties.building_id === bid)?.properties.name || bid

  const unitSummary = (bid) => {
    const us = peekUnits(bid)
    return {
      total: us.length,
      fromModel: us.filter((u) => u.segmentation === 'model').length,
      conflicts: us.filter((u) => u.validation_status === 'conflict').length,
    }
  }

  const work = useMemo(() => {
    if (!canEditBuildings) return null
    const needsPlan = []
    let unmeasured = 0
    for (const f of visibleFeatures) {
      const p = f.properties
      if (!MEASURED.has(p.height_source)) unmeasured++
      if (!peekUnits(p.building_id).some((u) => u.segmentation === 'model')) needsPlan.push(p)
    }
    needsPlan.sort((a, b) => (b.stories || 0) - (a.stories || 0))
    const conflicts = new Map()
    for (const u of allUnits()) {
      if (u.validation_status === 'conflict') conflicts.set(u.building_id, (conflicts.get(u.building_id) || 0) + 1)
    }
    const footprintPending = features.filter((f) => f.properties.edit_status === 'pending' && !f.properties.pending_proposal)
    const rejected = []
    for (const f of features) {
      for (const h of f.properties.edit_history || []) {
        if (/^Rejected Surveyor proposal/.test(h.change || '')) rejected.push({ building_id: f.properties.building_id, ...h })
      }
    }
    rejected.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
    return { needsPlan, unmeasured, conflicts: [...conflicts], footprintPending, rejected: rejected.slice(0, 5) }
  }, [canEditBuildings, visibleFeatures, features, unitsVersion])

  // staff start inside the biggest scan area instead of a whole-world view where its buildings are specks
  const autoPickedRef = useRef(false)
  useEffect(() => {
    if (autoPickedRef.current || !canEditBuildings || selCountry || !countryTree.length) return
    if (countryTree.some((c) => c.name === '⏳ locating…')) return
    autoPickedRef.current = true
    if (countryTree.length > 1) setSelCountry([...countryTree].sort((x, y) => y.buildings - x.buildings)[0].name)
  }, [canEditBuildings, selCountry, countryTree])

  const myProposals = pendingBuildingProposals.filter((p) => p.proposed_by === session?.name)
  const reviewCount = pendingBuildingProposals.length + pendingUnitEdits.length + (work?.footprintPending.length || 0)

  // ── citizen map view ──────────────────────────────────────────────────────
  if (isCitizen && !citizenMapView) {
    return (
      <div className="app min-h-screen citizen-dash" style={{ background: '#F5F6F8', color: '#1C2530', overflowY: 'auto' }}>
        <Topbar
          session={session}
          onLogout={onLogout}
          activeLanguage={activeLanguage}
          onLanguageChange={onLanguageChange}
        />
        <div className="citizen-shell-body flex min-w-0">
          <CitizenDashboard
            session={session}
            activeLanguage={activeLanguage}
            onOpenMap={(id) => {
              setSelCountry(null); setSelRegion(null); setFocusSid(null)
              setSelectedId(id || null)
              setCitizenMapView(true)
            }}
          />
        </div>
      </div>
    )
  }

  // ── main layout ───────────────────────────────────────────────────────────
  return (
    <div className="app">
      <Topbar
        session={session}
        onLogout={onLogout}
        activeLanguage={activeLanguage}
        onLanguageChange={onLanguageChange}
      >
        {isRegistrar && (
          <div className="top-search">
            <input
              className="search"
              placeholder="search building, owner, ULPIN or DIGIPIN…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onFocus={() => setSearchFocus(true)}
              onBlur={() => setTimeout(() => setSearchFocus(false), 150)}
            />
            {searchFocus && searchQ.trim() && (
              <div className="search-results">
                {searchResults.length === 0 && (
                  <p className="muted tiny" style={{ padding: '8px 10px', margin: 0 }}>
                    no matches for "{searchQ.trim()}".
                  </p>
                )}
                {searchResults.map((r) => (
                  <div
                    key={r.id}
                    className="nav-row"
                    title={r.sub || r.id}
                    onMouseDown={() => goToSearchResult(r)}
                  >
                    <span className="session-label" title={r.id}>{r.name}</span>
                    <span className="muted tiny">{r.note}</span>
                    <span className="enter-hint tiny">go →</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Topbar>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}

      {guideOpen && state === 'ready' && (
        <div className="guide-strip">
          <span className="guide-title tiny muted">how it works</span>
          {isRegistrar ? (
            <>
              <span className="guide-step tiny"><b>1</b> everything waiting for you is under <i>To review</i> on the right</span>
              <span className="guide-step tiny"><b>2</b> approve, or reject with a reason the surveyor will see</span>
            </>
          ) : (
            <>
              <span className="guide-step tiny"><b>1</b> pick a building from <i>Your work</i> or the map</span>
              <span className="guide-step tiny"><b>2</b> upload its floor plan to extract the units</span>
              <span className="guide-step tiny"><b>3</b> propose height fixes; the registrar approves them</span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn tiny" onClick={dismissGuide}>got it</button>
        </div>
      )}

      <div className="parcel-strip">
        <span className="muted tiny">
          saved scans from PostGIS — pan, zoom &amp; tilt freely
        </span>
        <span style={{ flex: 1 }} />
        {state === 'ready' && stats && !isCitizen && (
          <span className="mono tiny">{stats.n} buildings · tallest {stats.tallest} m</span>
        )}
        {isRegistrar && pendingFeatures.length > 0 && (
          <span className="pending-badge">
            ⚑ {pendingFeatures.length} edit{pendingFeatures.length > 1 ? 's' : ''} awaiting confirmation
          </span>
        )}
        {isCitizen && (
          <button className="btn" onClick={() => setCitizenMapView(false)}>← my properties</button>
        )}
        <button className="btn" onClick={() => setReloadKey((k) => k + 1)}>refresh</button>
      </div>

      <main className="workspace">
        <section className="viewport">
          {state === 'ready' && (
            <BuildingsMap
              features={isCitizen ? citizenMapFeatures : visibleFeatures}
              selectedId={selectedId}
              onSelect={setSelectedId}
              canEdit={canEditBuildings}
              onFootprintDrawn={handleFootprintDrawn}
              ownedIds={ownedIds}
              frameKey={`${selCountry}|${selRegion}|${focusSid}`}
              onFirstDraw={() => setDrawn(true)}
            />
          )}
          {state === 'ready' && !visibleFeatures.length && (
            <div className="map-note muted tiny">no buildings in this view — go back to all areas</div>
          )}
          {(state === 'loading' || (state === 'ready' && !drawn && visibleFeatures.length > 0)) && (
            <div className="map-loading" role="status" aria-live="polite">
              <div className="map-loading-card">
                <span className="map-loading-spinner" aria-hidden="true" />
                <strong>{state === 'loading' ? 'Loading buildings' : `Drawing ${visibleFeatures.length.toLocaleString('en-IN')} buildings`}</strong>
                <span>{state === 'loading' ? 'Fetching them from the registry' : 'Putting them on the map'}</span>
                <span className="map-loading-bar" aria-hidden="true" />
              </div>
            </div>
          )}
          {state === 'empty' && (
            <div className="lidar-empty muted">
              <h3>No buildings yet</h3>
              <p>the demo dataset is empty — clear this browser's localStorage to restore the baked Chennai data.</p>
            </div>
          )}
          {state === 'unavailable' && (
            <div className="lidar-empty muted">
              <h3>Demo data failed to load</h3>
              <p>refresh the page to retry.</p>
              {unavailableErr && <p className="error mono tiny">reason: {unavailableErr}</p>}
              <button className="btn" onClick={() => setReloadKey((k) => k + 1)}>retry now</button>
            </div>
          )}
        </section>

        <aside className="sidebar">
          {/* ── selected building ─────────────────────────────────────── */}
          {selected && (() => {
            const us = unitSummary(selected.building_id)
            const proposal = selected.pending_proposal
            const measured = MEASURED.has(selected.height_source)
            return (
              <section className="sp-card">
                <div className="sp-card-head">
                  <div>
                    <h2 className="sp-title">{selected.name || selected.building_id}</h2>
                    {selected.name && <p className="sp-muted mono">{selected.building_id}</p>}
                  </div>
                  <button className="sp-icon" aria-label="Close building" title="Back to the list"
                    onClick={() => { setSelectedId(null); setEditingBld(false); setEditDraft(null) }}>×</button>
                </div>

                <dl className="sp-facts">
                  <div><dt>Storeys</dt><dd>{selected.stories ?? '—'}</dd></div>
                  <div><dt>Height</dt><dd>{selected.height_m != null ? `${selected.height_m} m` : '—'}</dd></div>
                  <div><dt>Basements</dt><dd>{selected.basements || 0}</dd></div>
                </dl>
                <p className={`sp-chip ${measured ? 'is-ok' : 'is-warn'}`}>{heightLabel(selected)}</p>
                <EvidenceBadge heightSource={selected.height_source} segmentations={peekUnits(selected.building_id).map((u) => u.segmentation)} />
                <StackPanel feature={visibleFeatures.find((f) => f.properties.building_id === selected.building_id)} />
                <ReportsPanel buildingId={selected.building_id} geometry={visibleFeatures.find((f) => f.properties.building_id === selected.building_id)?.geometry} />

                <div className="sp-block">
                  <h3 className="sp-h3">Units</h3>
                  <p className="sp-text">
                    {us.total === 0
                      ? 'No units yet.'
                      : us.fromModel === us.total
                        ? `${us.total} units, all extracted from a floor plan.`
                        : us.fromModel
                          ? `${us.total} units: ${us.fromModel} from a floor plan, the rest estimated.`
                          : `${us.total} estimated units. No floor plan has been processed yet.`}
                    {us.conflicts > 0 && ` ${us.conflicts} overlap and need fixing.`}
                  </p>
                  <button className="btn sp-wide"
                    onClick={() => rescanArea(visibleFeatures.filter((f) => f.properties.building_id === selected.building_id), selected.name || 'this building')}>
                    Rescan this area
                  </button>
                  <button className="btn primary sp-wide"
                    onClick={() => navigate(`/ulpin?building=${encodeURIComponent(selected.building_id)}`)}>
                    {!canEditBuildings ? 'View units' : us.fromModel ? 'Open unit editor' : 'Extract units from floor plan'}
                  </button>
                </div>

                {proposal && (
                  <div className="sp-callout">
                    <h3 className="sp-h3">Waiting for approval</h3>
                    <p className="sp-muted">Proposed by {proposal.proposed_by}, {when(proposal.created_at)}</p>
                    <ul className="sp-diff">
                      {proposalChanges(proposal).map(([k, a, b, u]) => (
                        <li key={k}>{k}: <s>{a}{u}</s> → <b>{b}{u}</b></li>
                      ))}
                    </ul>
                    {proposal.note && <p className="sp-note">{proposal.note}</p>}
                    {isRegistrar && (rejectBldProposalId === proposal.id ? (
                      <div className="sp-form">
                        <label className="sp-field">Reason for rejecting (the surveyor sees this)
                          <textarea rows={2} value={rejectBldProposalReason} onChange={(ev) => setRejectBldProposalReason(ev.target.value)} />
                        </label>
                        <div className="sp-actions">
                          <button className="btn danger" disabled={!rejectBldProposalReason.trim()} onClick={handleRejectBuildingProposal}>Reject proposal</button>
                          <button className="btn" onClick={() => setRejectBldProposalId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="sp-actions">
                        <button className="btn primary" onClick={() => handleApproveBuildingProposal(proposal.id)}>Approve</button>
                        <button className="btn" onClick={() => { setRejectBldProposalId(proposal.id); setRejectBldProposalReason('') }}>Reject…</button>
                      </div>
                    ))}
                  </div>
                )}

                {!proposal && selected.edit_status === 'pending' && (
                  <div className="sp-callout">
                    <h3 className="sp-h3">Footprint change waiting for approval</h3>
                    {isRegistrar
                      ? <button className="btn primary" disabled={resolvingIds.has(selected.building_id)} onClick={() => confirmBuilding(selected.building_id)}>Confirm footprint</button>
                      : <p className="sp-muted">The registrar will review the redrawn outline.</p>}
                  </div>
                )}

                {canEditBuildings && !proposal && (editingBld ? (
                  <div className="sp-block sp-form">
                    <h3 className="sp-h3">{isSurveyor ? 'Propose a height change' : 'Edit height'}</h3>
                    <div className="sp-grid">
                      <label className="sp-field">Storeys
                        <input type="number" min="1" max="60" value={editDraft.floors}
                          onChange={(e) => {
                            const fl = Math.min(60, Math.max(1, parseInt(e.target.value) || 1))
                            setEditDraft({ ...editDraft, floors: fl, height: +(fl * 3).toFixed(1) })
                          }} />
                      </label>
                      <label className="sp-field">Height (m)
                        <input type="number" min="0.5" max="250" step="0.1" value={editDraft.height}
                          onChange={(e) => setEditDraft({ ...editDraft, height: e.target.value })} />
                      </label>
                      <label className="sp-field">Basements
                        <input type="number" min="0" max="6" value={editDraft.basements ?? 0}
                          onChange={(e) => setEditDraft({ ...editDraft, basements: Math.max(0, parseInt(e.target.value) || 0) })} />
                      </label>
                    </div>
                    <label className="sp-field">{isSurveyor ? 'Reason (required, shown to the registrar)' : 'Note (optional)'}
                      <textarea rows={2} value={editDraft.note || ''} placeholder="e.g. measured on site with a laser rangefinder"
                        onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })} />
                    </label>
                    <label className="sp-field">Evidence file (optional; its name is kept as a reference)
                      <input type="file"
                        accept=".dwg,.dxf,.pdf,.svg,.png,.jpg,.jpeg,.tiff,.tif,.zip,.las,.laz,.ply,.pcd,.gltf,.glb,.obj,.fbx,.ifc"
                        onChange={(e) => setEditDraft({ ...editDraft, spatialFile: e.target.files[0] || null })} />
                    </label>
                    <div className="sp-actions">
                      <button className="btn primary" onClick={saveBuildingEdit}>{isSurveyor ? 'Send for approval' : 'Save'}</button>
                      <button className="btn" onClick={() => { setEditingBld(false); setEditDraft(null) }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn"
                    onClick={() => {
                      setEditDraft({ height: selected.height_m, floors: selected.stories, basements: selected.basements || 0, spatialFile: null, note: '' })
                      setEditingBld(true)
                    }}>
                    {isSurveyor ? 'Propose a height change' : 'Edit height'}
                  </button>
                ))}

                {selected.spatial_assets?.length > 0 && (
                  <div className="sp-block">
                    <h3 className="sp-h3">Evidence on file</h3>
                    <ul className="sp-history">
                      {selected.spatial_assets.map((a, i) => (
                        <li key={i}>{a.asset_type}: {a.file_name}<time>{a.uploaded_by}, {when(a.uploaded_at)}</time></li>
                      ))}
                    </ul>
                  </div>
                )}

                {selected.edit_history?.length > 0 && (
                  <div className="sp-block">
                    <h3 className="sp-h3">History</h3>
                    <ul className="sp-history">
                      {[...selected.edit_history].reverse().slice(0, 6).map((h, i) => (
                        <li key={i}>{h.change}<time>{h.by}{h.role ? ` (${h.role})` : ''}, {when(h.at)}</time></li>
                      ))}
                    </ul>
                  </div>
                )}

                {isRegistrar && (
                  <button className="sp-danger" onClick={() => removeBuilding(selected.building_id)}>Delete this building</button>
                )}
              </section>
            )
          })()}

          {/* ── registrar: one review list ────────────────────────────── */}
          {state === 'loading' && !selected && (
            <section className="sp-card" aria-busy="true" aria-label="Loading">
              <span className="sp-skel" style={{ width: '40%', height: 18 }} />
              <span className="sp-skel" style={{ width: '90%' }} />
              <span className="sp-skel" style={{ width: '75%' }} />
              <span className="sp-skel" style={{ width: '85%' }} />
            </section>
          )}
          {!selected && state === 'ready' && isRegistrar && work && (
            <>
              <section className="sp-card">
                <h2 className="sp-title">To review</h2>
                <p className="sp-muted">
                  {reviewCount
                    ? `${reviewCount} item${reviewCount > 1 ? 's' : ''} waiting for your decision.`
                    : 'All caught up. New proposals from surveyors show up here.'}
                </p>
              </section>

              {pendingBuildingProposals.length > 0 && (
                <section className="sp-card">
                  <h3 className="sp-h3">Height changes <span className="sp-count">{pendingBuildingProposals.length}</span></h3>
                  {pendingBuildingProposals.map((p) => (
                    <article key={p.id} className="sp-item">
                      <div className="sp-item-head">
                        <button className="sp-link" onClick={() => focusBuilding(p.building_id)}>{nameOf(p.building_id)}</button>
                        <span className="sp-muted">{when(p.created_at)}</span>
                      </div>
                      <p className="sp-muted">Proposed by {p.proposed_by}</p>
                      <ul className="sp-diff">
                        {proposalChanges(p).map(([k, a, b, u]) => <li key={k}>{k}: <s>{a}{u}</s> → <b>{b}{u}</b></li>)}
                        {p.after.spatial_assets?.length > p.before.spatial_assets?.length && (
                          <li>Evidence: {p.after.spatial_assets.at(-1).file_name}</li>
                        )}
                      </ul>
                      {p.note && <p className="sp-note">{p.note}</p>}
                      {rejectBldProposalId === p.id ? (
                        <div className="sp-form">
                          <label className="sp-field">Reason for rejecting (the surveyor sees this)
                            <textarea rows={2} value={rejectBldProposalReason} onChange={(ev) => setRejectBldProposalReason(ev.target.value)} />
                          </label>
                          <div className="sp-actions">
                            <button className="btn danger" disabled={!rejectBldProposalReason.trim()} onClick={handleRejectBuildingProposal}>Reject proposal</button>
                            <button className="btn" onClick={() => setRejectBldProposalId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="sp-actions">
                          <button className="btn primary" onClick={() => handleApproveBuildingProposal(p.id)}>Approve</button>
                          <button className="btn" onClick={() => { setRejectBldProposalId(p.id); setRejectBldProposalReason('') }}>Reject…</button>
                        </div>
                      )}
                    </article>
                  ))}
                </section>
              )}

              {work.footprintPending.length > 0 && (
                <section className="sp-card">
                  <h3 className="sp-h3">Redrawn footprints <span className="sp-count">{work.footprintPending.length}</span></h3>
                  <ul className="sp-list">
                    {work.footprintPending.map((f) => (
                      <li key={f.properties.building_id}>
                        <button className="sp-row" onClick={() => focusBuilding(f.properties.building_id)}>
                          <span>{f.properties.name || f.properties.building_id}</span><span className="sp-muted">Review</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {pendingUnitEdits.length > 0 && (
                <section className="sp-card">
                  <h3 className="sp-h3">Unit corrections <span className="sp-count">{pendingUnitEdits.length}</span></h3>
                  {pendingUnitEdits.map((e) => (
                    <article key={e.id} className="sp-item">
                      <div className="sp-item-head">
                        <span className="sp-text mono">{e.unit_ulpin}</span>
                        <span className="sp-muted">{when(e.created_at)}</span>
                      </div>
                      <p className="sp-muted">Proposed by {e.proposed_by} in {nameOf(e.building_id)}</p>
                      <ul className="sp-diff">
                        {Object.keys(e.after).filter((k) => String(e.before[k]) !== String(e.after[k])).map((k) => (
                          <li key={k}>{k.replace(/_/g, ' ')}: <s>{e.before[k] ?? '—'}</s> → <b>{e.after[k] ?? '—'}</b></li>
                        ))}
                        <li>Overlap: <s>{e.overlap_before_m3} m³</s> → <b>{e.overlap_after_m3} m³</b></li>
                      </ul>
                      {e.resolution_note && <p className="sp-note">{e.resolution_note}</p>}
                      {rejectUnitId === e.id ? (
                        <div className="sp-form">
                          <label className="sp-field">Reason for rejecting
                            <textarea rows={2} value={rejectUnitReason} onChange={(ev) => setRejectUnitReason(ev.target.value)} />
                          </label>
                          <div className="sp-actions">
                            <button className="btn danger" disabled={!rejectUnitReason.trim()} onClick={handleRejectUnitEdit}>Reject correction</button>
                            <button className="btn" onClick={() => setRejectUnitId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="sp-actions">
                          <button className="btn primary" onClick={() => handleApproveUnitEdit(e.id)}>Approve</button>
                          <button className="btn" onClick={() => { setRejectUnitId(e.id); setRejectUnitReason('') }}>Reject…</button>
                          <button className="btn" onClick={() => navigate(`/ulpin?building=${encodeURIComponent(e.building_id)}`)}>Open in unit editor</button>
                        </div>
                      )}
                    </article>
                  ))}
                </section>
              )}

              {work.conflicts.length > 0 && (
                <section className="sp-card">
                  <h3 className="sp-h3">Overlapping units <span className="sp-count is-quiet">{work.conflicts.length}</span></h3>
                  <p className="sp-muted">Units on the same floor overlap. A surveyor needs to correct them before the titles are clean.</p>
                  <ul className="sp-list">
                    {work.conflicts.slice(0, 6).map(([bid, n]) => (
                      <li key={bid}>
                        <button className="sp-row" onClick={() => navigate(`/ulpin?building=${encodeURIComponent(bid)}`)}>
                          <span>{nameOf(bid)}</span><span className="sp-muted">{n} units</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {/* ── surveyor: what to do next ─────────────────────────────── */}
          {!selected && state === 'ready' && isSurveyor && work && (
            <>
              <section className="sp-card">
                <h2 className="sp-title">Your work</h2>
                {modelStatus && (
                  <p className={`sp-chip ${modelStatus.ready ? 'is-ok' : 'is-bad'}`}
                    title={modelStatus.ready ? modelStatus.path : modelStatus.reason}>
                    {modelStatus.ready
                      ? `Floor-plan model ready (${modelStatus.file})`
                      : 'No floor-plan model installed. Units will be estimated.'}
                  </p>
                )}
              </section>

              <section className="sp-card">
                <h3 className="sp-h3">Needs a floor plan <span className="sp-count is-quiet">{work.needsPlan.length}</span></h3>
                <p className="sp-muted">Units in these buildings are estimated. Upload the approved plan to extract the real layout. Tallest first.</p>
                <ul className="sp-list">
                  {work.needsPlan.slice(0, 6).map((p) => (
                    <li key={p.building_id}>
                      <button className="sp-row" onClick={() => focusBuilding(p.building_id)}>
                        <span>{p.name || p.building_id}</span><span className="sp-muted">{p.stories ?? '?'} storeys</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              {work.unmeasured > 0 && (
                <section className="sp-card">
                  <h3 className="sp-h3">Height not measured <span className="sp-count is-quiet">{work.unmeasured}</span></h3>
                  <p className="sp-muted">These heights are estimated. Import Google Open Buildings 2.5D heights or run a LiDAR scan to measure them.</p>
                  <NavLink to="/lidar" className="btn">Run a LiDAR scan</NavLink>
                </section>
              )}

              <section className="sp-card">
                <h3 className="sp-h3">Your proposals <span className="sp-count is-quiet">{myProposals.length}</span></h3>
                {myProposals.length === 0 && work.rejected.length === 0 && (
                  <p className="sp-muted">Nothing waiting. Height changes you propose appear here until the registrar decides.</p>
                )}
                <ul className="sp-list">
                  {myProposals.map((p) => (
                    <li key={p.id}>
                      <button className="sp-row" onClick={() => focusBuilding(p.building_id)}>
                        <span>{nameOf(p.building_id)}</span><span className="sp-muted">Waiting</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {work.rejected.length > 0 && (
                  <>
                    <p className="sp-muted">Recently rejected</p>
                    <ul className="sp-history">
                      {work.rejected.map((r, i) => (
                        <li key={i}>
                          <button className="sp-link" onClick={() => focusBuilding(r.building_id)}>{nameOf(r.building_id)}</button>
                          {': '}{r.change.replace(/^Rejected Surveyor proposal:\s*/, '')}
                          <time>{r.by}, {when(r.at)}</time>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </>
          )}

          {/* ── browse scan areas (secondary) ─────────────────────────── */}
          <details className="sp-card sp-browse" open={!!selCountry}>
            <summary>Browse scan areas</summary>
            {selRegion ? (
              <button className="btn tiny" onClick={() => setSelRegion(null)}>← {selCountry}</button>
            ) : selCountry ? (
              <button className="btn tiny" onClick={() => { setSelCountry(null); setSelRegion(null) }}>← all countries</button>
            ) : null}

            {!selCountry && countryTree.map((c) => (
              <button key={c.name} className="sp-row" disabled={c.name === '⏳ locating…'} onClick={() => setSelCountry(c.name)}>
                <span>{c.name}</span>
                <span className="sp-muted">{c.name === '⏳ locating…' ? 'locating…' : `${c.buildings} buildings`}</span>
              </button>
            ))}

            {selCountry && !selRegion && countryTree.find((x) => x.name === selCountry)?.regions.map((r) => (
              <button key={r.key} className="sp-row" onClick={() => setSelRegion(r.key)}>
                <span>{r.name}</span><span className="sp-muted">{r.buildings} buildings</span>
              </button>
            ))}

            {selCountry && selRegion && countryTree.find((x) => x.name === selCountry)?.regions.find((x) => x.key === selRegion)?.scans.map((sc) => (
              <div key={sc.sid} className="sp-actions" style={{ flexWrap: 'nowrap' }}>
                <button className="sp-row" onClick={() => focusSession(sc.sid)} title={sc.label}>
                  <span>{sc.label}</span><span className="sp-muted">{focusSid === sc.sid ? 'showing' : `${sc.count}`}</span>
                </button>
                <button className="sp-icon" title="Rescan this area" aria-label={`Rescan ${sc.label}`}
                  onClick={() => rescanArea(features.filter((f) => f.properties.session_id === sc.sid), sc.label)}>↻</button>
                {isRegistrar && (
                  <button className="sp-icon" title="Delete this scan and its buildings"
                    onClick={() => { if (window.confirm(`Delete scan "${sc.label}" and its ${sc.count} buildings?`)) removeSession(sc.sid) }}>×</button>
                )}
              </div>
            ))}

            {stats && (
              <p className="sp-muted">
                {stats.n} buildings in view, {stats.fromLidar} with a measured height, tallest {stats.tallest} m.
              </p>
            )}
          </details>
        </aside>
      </main>
    </div>
  )
}
