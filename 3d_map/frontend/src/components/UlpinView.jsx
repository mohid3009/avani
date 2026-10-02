import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { getSavedBuildings, fetchUnits, generateUnits, generateFloorUnits, deleteUnits, saveBuildingFeature, segmentationStatus } from '../api.js'
import BuildingsMap from './BuildingsMap.jsx'
import './staff.css'

const floorName = (f) => (f < 0 ? `Basement ${-f}` : `Floor ${f}`)
const fromModel = (u) => u.segmentation === 'model'

// drag-and-drop or click-to-pick image field with a preview
function PlanDrop({ file, onFile, label }) {
  const [over, setOver] = useState(false)
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => url && URL.revokeObjectURL(url), [url])
  return (
    <label
      className={`sp-drop${over ? ' is-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0] || null) }}
    >
      <input type="file" accept="image/png,image/jpeg" onChange={(e) => onFile(e.target.files[0] || null)} />
      {url ? <img src={url} alt="Selected floor plan" /> : <span>{label}</span>}
      {file && <span className="sp-muted">{file.name} (click to change)</span>}
    </label>
  )
}

const FH = 3          // storey height used by the generator (m)
const FLOOR_GAP = 0.7 // vertical gap between floors (m) — keeps every level visible in 3D

function floorColor(floorIndex, maxFloor) {
  if (floorIndex < 0) return '#595969' // basement grey
  const t = maxFloor <= 1 ? 0 : (floorIndex - 1) / (maxFloor - 1)
  return `hsl(216, 68%, ${28 + t * 30}%)`
}

const UnitMesh = React.memo(function UnitMesh({ unit, w, d, fh, color, selected, onPick }) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape(
      unit.polygon.map(([x, y]) => new THREE.Vector2(x * w - w / 2, y * d - d / 2)),
    )
    const g = new THREE.ExtrudeGeometry(shape, { depth: fh * 0.88, bevelEnabled: false })
    g.rotateX(-Math.PI / 2) // extrude upward, footprint flat on the ground plane
    return g
  }, [unit, w, d, fh])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh
      geometry={geo}
      position={[0, unit.floor_index * (fh + FLOOR_GAP), 0]}
      castShadow
      receiveShadow
      onClick={(e) => {
        e.stopPropagation()
        onPick(unit)
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'auto')}
    >
      <meshLambertMaterial
        color={selected ? '#ffffff' : unit.validation_status === 'conflict' ? '#e05252' : color}
        transparent
        opacity={selected ? 1 : 0.96}
      />
    </mesh>
  )
})

export default function UlpinView({ session }) {
  const [searchParams] = useSearchParams()
  const initialBuilding = searchParams.get('building')
  const bootstrappedRef = useRef(false)
  const canManage = session?.role !== 'citizen'

  const [buildings, setBuildings] = useState([])
  const [selId, setSelId]         = useState(null)
  const [units, setUnits]         = useState([])
  const [selUlpin, setSelUlpin]   = useState(null)
  const [floors, setFloors]       = useState(3)
  const [basements, setBasements] = useState(0)
  const [fh, setFh]               = useState(3)
  const [planFile, setPlanFile]   = useState(null)
  const [floorPlanFile, setFloorPlanFile] = useState(null)
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState(null)
  const [query, setQuery]         = useState('')
  const [model, setModel]         = useState(null)
  const [result, setResult]       = useState(null) // last extraction: { source, note, unit_count, conflicts }
  const [floorTarget, setFloorTarget] = useState(1)

  useEffect(() => {
    if (canManage) segmentationStatus().then(setModel).catch(() => setModel({ ready: false, reason: 'could not reach the server' }))
  }, [canManage])

  useEffect(() => {
    getSavedBuildings()
      .then((fc) => setBuildings(fc.features || []))
      .catch(() => {})
  }, [])

  // searchable list of buildings for the picker (name or id, case-insensitive)
  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const props = buildings.map((b) => b.properties)
    if (!needle) return props
    return props.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(needle) ||
        (p.building_id || '').toLowerCase().includes(needle),
    )
  }, [buildings, query])

  const selected = buildings.find((b) => b.properties.building_id === selId) || null

  // Load the building's 3D slices + generated ULPIN units when selected
  useEffect(() => {
    setUnits([])
    setSelUlpin(null)
    setFloorPlanFile(null)
    setPlanFile(null)
    setResult(null)
    setBusy(false)
    setErr(null)
    const p = buildings.find((b) => b.properties.building_id === selId)?.properties
    if (p) {
      setFloors(Math.max(1, p.stories || 1))
      setBasements(Math.max(0, p.basements || 0))
    }
    if (selId) {
      setBusy(true)
      fetchUnits(selId)
        .then((r) => setUnits(r.units || r || []))
        .catch((e) => setErr(e.message))
        .finally(() => setBusy(false))
    }
  }, [selId]) // eslint-disable-line react-hooks/exhaustive-deps

  const importOvertureBuilding = async (feature) => {
    // We synthesize a local ID and save it via the API
    const id = feature.id || feature.properties?.id || `ovt-${Math.random().toString(36).slice(2, 10)}`
    
    // Overture PMTiles features are vector tile features; we convert to GeoJSON
    const geojson = {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        building_id: id,
        height_m: feature.properties.height || 6,
        color: '#FF8A00'
      }
    }
    
    setBusy(true)
    try {
      await saveBuildingFeature(geojson)
      const fc = await getSavedBuildings()
      setBuildings(fc.features)
      setSelId(id)
    } catch (e) {
      setErr(`Failed to import building: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const selectBuilding = (bid) => {
    setSelId(bid)
    setSelUlpin(null)
  }

  // deep link (/ulpin?building=<id>): select and open that building
  useEffect(() => {
    if (bootstrappedRef.current || !buildings.length || !initialBuilding) return
    bootstrappedRef.current = true
    selectBuilding(initialBuilding)
  }, [buildings, initialBuilding]) // eslint-disable-line react-hooks/exhaustive-deps

  const generate = () => {
    if (!selId) return
    setBusy(true); setErr(null)
    generateUnits(selId, { floors, basements, floorHeight: fh, planFile })
      .then((r) => {
        setUnits(r.units)
        setResult({ ...r, scope: 'building' })
        setBusy(false)
      })
      .catch((e) => { setErr(e.message); setBusy(false) })
  }

  const generateFloor = () => {
    if (!selId || !floorPlanFile) return
    setBusy(true); setErr(null)
    generateFloorUnits(selId, floorTarget, floorPlanFile)
      .then((r) => {
        setUnits(r.units)
        setResult({ ...r, scope: floorName(floorTarget) })
        setBusy(false)
        setFloorPlanFile(null)
      })
      .catch((e) => { setErr(e.message); setBusy(false) })
  }

  const clear = () => {
    if (!window.confirm('Remove every unit of this building? Owners and corrections on them are lost.')) return
    deleteUnits(selId)
      .then(() => { setUnits([]); setSelUlpin(null); setResult(null) })
      .catch(() => {})
  }

  // footprint dimensions in metres (for the 3D mapping)
  const dims = useMemo(() => {
    if (!selected) return null
    const ring   = selected.geometry.coordinates[0]
    const lons   = ring.map((c) => c[0])
    const lats   = ring.map((c) => c[1])
    const latMid = (Math.min(...lats) + Math.max(...lats)) / 2
    return {
      w: Math.max(1, (Math.max(...lons) - Math.min(...lons)) * 111320 * Math.cos((latMid * Math.PI) / 180)),
      d: Math.max(1, (Math.max(...lats) - Math.min(...lats)) * 110540),
    }
  }, [selected])

  const selUnit = units.find((u) => u.unit_ulpin === selUlpin) || null

  // before units are generated, show the building's sections as mock slabs
  const mockSlabs = useMemo(() => {
    if (!selected || units.length) return []
    const stories  = selected.properties.stories || 1
    const bsmt     = selected.properties.basements || 0
    const out = []
    for (let f = -bsmt; f <= stories; f++) {
      if (f === 0) continue
      out.push({
        unit_ulpin:  `section-F${f}`,
        floor_index: f,
        unit_no:     0,
        polygon:     [[0.02, 0.02], [0.98, 0.02], [0.98, 0.98], [0.02, 0.98], [0.02, 0.02]],
        area_sqm:    null,
        mock:        true,
      })
    }
    return out
  }, [selected, units.length])

  const displayUnits = units.length ? units : mockSlabs
  const maxFloor     = displayUnits.reduce((m, u) => Math.max(m, u.floor_index), 1)
  const minFloor     = displayUnits.reduce((m, u) => Math.min(m, u.floor_index), 0)
  const totalH       = (maxFloor - minFloor + 2) * (FH + FLOOR_GAP)
  const span         = Math.max(dims ? Math.max(dims.w, dims.d) : 10, totalH) * 2.2
  const baseUlpin    = units[0]?.base_ulpin || null

  // units grouped by floor for the sidebar list
  const byFloor = useMemo(() => {
    const m = new Map()
    for (const u of units) {
      if (!m.has(u.floor_index)) m.set(u.floor_index, [])
      m.get(u.floor_index).push(u)
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [units])

  return (
    <main className="workspace">
      <section className="viewport">
        <BuildingsMap
          features={buildings}
          selectedId={selId}
          onSelect={(bid) => selectBuilding(bid)}
          onOvertureSelect={importOvertureBuilding}
        />
        {!selId && (
          <div className="map-note muted tiny">
            click a building on the map to open its 3D ULPIN unit tree
          </div>
        )}
        {selId && dims && (
          <div className="ulpin-3d">
            <div className="ulpin-3d-bar">
              <button className="btn tiny" onClick={() => setSelId(null)}>← choose on map</button>
              <span className="mono tiny">{selected?.properties.name || selId}</span>
              {baseUlpin && <span className="muted tiny mono">base {baseUlpin}</span>}
            </div>
            <div className="ulpin-3d-stage">
              <Canvas
                shadows
                camera={{
                  position: [
                    0,
                    Math.max(dims.w, dims.d) * 1.3 + totalH * 0.9,
                    Math.max(dims.w, dims.d) * 1.6 + totalH * 0.55,
                  ],
                  fov: 42,
                  near: 0.1,
                  far: 12000,
                }}
              >
                <ambientLight intensity={0.8} />
                <directionalLight
                  position={[dims.w * 1.2, (maxFloor + 4) * (FH + FLOOR_GAP) + dims.d, dims.d * 1.2]}
                  intensity={1.05}
                  castShadow
                  shadow-mapSize-width={2048}
                  shadow-mapSize-height={2048}
                  shadow-camera-near={1}
                  shadow-camera-far={span * 8}
                  shadow-camera-left={-span}
                  shadow-camera-right={span}
                  shadow-camera-top={span}
                  shadow-camera-bottom={-span}
                />
                <gridHelper args={[Math.max(dims.w, dims.d) * 4, 24, '#2c2c2c', '#1c1c1c']} />
                {/* shadow catcher — a plane just below the lowest level */}
                <mesh
                  receiveShadow
                  rotation={[-Math.PI / 2, 0, 0]}
                  position={[0, minFloor * (FH + FLOOR_GAP) - 0.02, 0]}
                >
                  <planeGeometry args={[span * 8, span * 8]} />
                  <shadowMaterial transparent opacity={0.38} />
                </mesh>
                {displayUnits.map((u) => (
                  <UnitMesh
                    key={u.unit_ulpin}
                    unit={u}
                    w={dims.w}
                    d={dims.d}
                    fh={FH}
                    color={floorColor(u.floor_index, maxFloor)}
                    selected={selUlpin === u.unit_ulpin}
                    onPick={(unit) => setSelUlpin(unit.unit_ulpin)}
                  />
                ))}
                <OrbitControls
                  enableDamping
                  dampingFactor={0.05}
                  minPolarAngle={0}
                  maxPolarAngle={Math.PI / 2 - 0.05}
                />
              </Canvas>
            </div>
          </div>
        )}
      </section>

      <aside className="sidebar">
        {!selId && (
          <section className="sp-card">
            <h2 className="sp-title">Unit editor</h2>
            {buildings.length === 0 ? (
              <>
                <p className="sp-muted">No saved buildings yet. Run a scan first, then open a building here to extract its units.</p>
                <div className="sp-actions">
                  {canManage && <Link to="/lidar" className="btn primary">Run a LiDAR scan</Link>}
                  <Link to="/dashboard" className="btn">Open dashboard</Link>
                </div>
              </>
            ) : (
              <>
                <p className="sp-muted">Pick a building on the map or search for it below.</p>
                <label className="sp-field">Search
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="building name or id" />
                </label>
                <ul className="sp-list picker-list">
                  {candidates.slice(0, 50).map((p) => (
                    <li key={p.building_id}>
                      <button className="sp-row" onClick={() => selectBuilding(p.building_id)} title={p.building_id}>
                        <span>{p.name || p.building_id}</span><span className="sp-muted">{p.stories ?? '?'} storeys</span>
                      </button>
                    </li>
                  ))}
                  {!candidates.length && <li className="sp-muted">No building matches "{query}".</li>}
                </ul>
              </>
            )}
          </section>
        )}

        {selected && canManage && (
          <section className="sp-card">
            <div className="sp-card-head">
              <div>
                <h2 className="sp-title">{selected.properties.name || selId}</h2>
                <p className="sp-muted mono">{baseUlpin ? `Base ULPIN ${baseUlpin}` : selId}</p>
              </div>
            </div>

            <ol className="sp-steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              <li className="sp-step is-done">
                <span className="sp-step-no">1</span>
                <div className="sp-step-body">
                  <h3 className="sp-h3">Check the building</h3>
                  <div className="sp-form"><div className="sp-grid">
                    <label className="sp-field">Floors
                      <input type="number" min="1" max="60" value={floors} onChange={(e) => setFloors(Math.max(1, parseInt(e.target.value) || 1))} />
                    </label>
                    <label className="sp-field">Basements
                      <input type="number" min="0" max="6" value={basements} onChange={(e) => setBasements(Math.max(0, parseInt(e.target.value) || 0))} />
                    </label>
                    <label className="sp-field">Floor height
                      <input type="number" min="0.5" step="0.1" value={fh} onChange={(e) => setFh(Math.max(0.5, parseFloat(e.target.value) || 3))} />
                    </label>
                  </div></div>
                  <p className="sp-muted">Prefilled from the building record.</p>
                </div>
              </li>

              <li className={`sp-step${planFile ? ' is-done' : ''}`}>
                <span className="sp-step-no">2</span>
                <div className="sp-step-body">
                  <h3 className="sp-h3">Add the floor plan</h3>
                  {model && (
                    <p className={`sp-chip ${model.ready ? 'is-ok' : 'is-bad'}`} title={model.ready ? model.path : model.reason}>
                      {model.ready ? `Model ready: ${model.file}` : 'No floor-plan model installed'}
                    </p>
                  )}
                  <PlanDrop file={planFile} onFile={setPlanFile} label="Drop the approved floor plan here (PNG or JPG), or click to choose" />
                  <p className="sp-muted">The same layout is used on every floor. If one floor differs, fix it below after extracting.</p>
                </div>
              </li>

              <li className={`sp-step${result ? ' is-done' : ''}`}>
                <span className="sp-step-no">3</span>
                <div className="sp-step-body">
                  <h3 className="sp-h3">Extract the units</h3>
                  <button className="btn primary sp-wide" disabled={busy} onClick={generate}>
                    {busy ? 'Working…' : planFile ? 'Extract units from plan' : 'Estimate units (no plan)'}
                  </button>
                  {units.length > 0 && !busy && <p className="sp-muted">This replaces the current {units.length} units.</p>}
                </div>
              </li>
            </ol>

            {result && (
              <div className={result.segmentation === 'model' ? 'sp-chip is-ok' : 'sp-callout'} style={{ alignSelf: 'stretch' }}>
                {result.segmentation === 'model'
                  ? `${result.unit_count} units extracted from the plan${result.scope === 'building' ? '' : ` for ${result.scope}`}.${result.conflicts ? ` ${result.conflicts} overlap, check them below.` : ' No overlaps.'}`
                  : <><b>Units were estimated, not extracted.</b><span className="sp-muted">Reason: {result.note}</span></>}
              </div>
            )}
            {err && <p className="sp-chip is-bad">{err}</p>}
            {units.length > 0 && <button className="sp-danger" onClick={clear}>Remove all units</button>}
          </section>
        )}

        {selected && canManage && units.length > 0 && (
          <section className="sp-card">
            <h3 className="sp-h3">One floor is different?</h3>
            <label className="sp-field">Floor
              <select value={floorTarget} onChange={(e) => setFloorTarget(parseInt(e.target.value))}>
                {byFloor.map(([f]) => <option key={f} value={f}>{floorName(f)}</option>)}
              </select>
            </label>
            <PlanDrop file={floorPlanFile} onFile={setFloorPlanFile} label={`Drop the plan for ${floorName(floorTarget)}`} />
            <button className="btn" disabled={busy || !floorPlanFile} onClick={generateFloor}>Re-extract {floorName(floorTarget)}</button>
          </section>
        )}

        {byFloor.length > 0 && (
          <section className="sp-card">
            <h3 className="sp-h3">Units <span className="sp-count is-quiet">{units.length}</span></h3>
            {byFloor.map(([floor, us]) => {
              const modelUnits = us.filter(fromModel)
              const conflicts = us.filter((u) => u.validation_status === 'conflict').length
              const conf = modelUnits.length ? Math.round(100 * modelUnits.reduce((s, u) => s + (u.confidence || 0), 0) / modelUnits.length) : null
              return (
                <div key={floor} className="sp-block" style={{ paddingTop: 8 }}>
                  <p className="sp-text" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <b>{floorName(floor)}</b>
                    <span className={`sp-badge ${conflicts ? 'is-bad' : modelUnits.length ? 'is-model' : ''}`}>
                      {conflicts ? `${conflicts} overlap` : modelUnits.length ? `from plan, ${conf}% sure` : 'estimated'}
                    </span>
                  </p>
                  <ul className="sp-list">
                    {us.map((u) => (
                      <li key={u.unit_ulpin}>
                        <button className="sp-row" onClick={() => setSelUlpin(u.unit_ulpin)}
                          style={selUlpin === u.unit_ulpin ? { borderColor: 'var(--accent)' } : undefined} title={u.unit_ulpin}>
                          <span>Unit {u.unit_no}, {Math.round(u.area_sqm)} m²</span>
                          <span className="sp-muted">{u.owner_name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </section>
        )}

        {selUnit && (
          <section className="sp-card">
            <div className="sp-card-head">
              <h3 className="sp-h3">Unit {selUnit.unit_no}, {floorName(selUnit.floor_index)}</h3>
              <button className="sp-icon" aria-label="Close unit" onClick={() => setSelUlpin(null)}>×</button>
            </div>
            {selUnit.validation_status === 'conflict' && <p className="sp-chip is-bad">Overlaps another unit on this floor</p>}
            <dl className="sp-facts">
              <div><dt>Area</dt><dd>{selUnit.area_sqm} m²</dd></div>
              <div><dt>Rights</dt><dd>{selUnit.rights_type}</dd></div>
              <div><dt>Status</dt><dd>{selUnit.validation_status}</dd></div>
            </dl>
            <p className="sp-text">Owner: {selUnit.owner_name} <span className="sp-muted mono">({selUnit.owner_id})</span></p>
            <p className="sp-muted mono">{selUnit.unit_ulpin}</p>
            <p className={`sp-chip ${fromModel(selUnit) ? 'is-ok' : 'is-warn'}`}>
              {fromModel(selUnit)
                ? `Extracted by the floor-plan model${selUnit.confidence != null ? `, ${Math.round(selUnit.confidence * 100)}% confidence` : ''}`
                : 'Estimated layout, no floor plan yet'}
            </p>
          </section>
        )}
      </aside>
    </main>
  )
}
