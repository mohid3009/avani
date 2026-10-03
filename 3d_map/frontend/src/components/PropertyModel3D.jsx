import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { footprintMeters } from '../footprint.js'

// A building built from its own records: the real footprint outline, one block per
// storey, and the unit outlines on the chosen floor, with the citizen's unit lit.
// Unit polygons are normalized to the footprint's bounding box (see backend _floor_units).
// Click any floor to open it. Modes: exploded (floors rise apart), cutaway (roof removed
// above the chosen floor), x-ray (other floors see-through), whole building.

const FH = 3 // storey height (m)
const GAP = 0.5 // resting gap between storeys (m)
const MODES = [['explode', 'Exploded'], ['cutaway', 'Cutaway'], ['xray', 'X-ray'], ['whole', 'Whole']]
const LOW = new THREE.Color('#D3E6DB')
const HIGH = new THREE.Color('#6FB894')
const floorName = (f) => (f < 0 ? `Basement ${-f}` : `Floor ${f}`)

function flatGeometry(points, depth) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: false })
  g.rotateX(-Math.PI / 2) // extrude upward, outline flat on the ground
  return g
}

// one prism with its outline; geo may be shared between floors
function Prism({ geo, y = 0, color, opacity = 1, edge, glow, onClick }) {
  const edges = useMemo(() => (edge ? new THREE.EdgesGeometry(geo) : null), [geo, edge])
  useEffect(() => () => edges?.dispose(), [edges])
  return (
    <group position={[0, y, 0]}>
      <mesh
        geometry={geo}
        castShadow
        receiveShadow
        onClick={onClick}
        onPointerOver={onClick ? () => (document.body.style.cursor = 'pointer') : undefined}
        onPointerOut={onClick ? () => (document.body.style.cursor = '') : undefined}
      >
        <meshLambertMaterial color={color} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 0.9} emissive={glow || '#000000'} emissiveIntensity={glow ? 0.45 : 0} />
      </mesh>
      {edges && <lineSegments geometry={edges}><lineBasicMaterial color={edge} transparent opacity={Math.max(0.35, opacity)} /></lineSegments>}
    </group>
  )
}

// a storey that glides to its target height, so changing mode animates
function Floor({ y0, targetY, children }) {
  const ref = useRef()
  useFrame(() => { if (ref.current) ref.current.position.y += (targetY - ref.current.position.y) * 0.1 })
  return <group ref={ref} position={[0, y0, 0]}>{children}</group>
}

// for a moment after the view changes, glides the orbit target and camera distance to
// the new framing (then leaves the user's own zoom alone); runs the turntable
function Rig({ controls, focusY, dist, spin, viewKey }) {
  const { camera } = useThree()
  const until = useRef(0)
  useEffect(() => { until.current = performance.now() + 1800 }, [viewKey])
  useFrame(() => {
    const c = controls.current
    if (!c) return
    c.autoRotate = spin
    if (performance.now() > until.current) return
    c.target.y += (focusY - c.target.y) * 0.08
    const v = camera.position.clone().sub(c.target)
    camera.position.copy(c.target).add(v.setLength(v.length() + (dist - v.length()) * 0.06))
  })
  return null
}

// unit prisms are tiny and few; cache by outline so re-renders reuse the geometry
const geoCache = new Map()
function unitGeo(points, depth = FH - 0.25) {
  const key = depth + JSON.stringify(points)
  if (!geoCache.has(key)) {
    if (geoCache.size > 400) geoCache.clear()
    geoCache.set(key, flatGeometry(points, depth))
  }
  return geoCache.get(key)
}

// markable: the citizen outlines a disputed area by clicking corners on the open floor.
// region = { floor, polygon } (corners as 0..1 of the footprint bounding box, like unit polygons);
// onRegion is told the outline once it has three corners, or null when it is cleared.
export default function PropertyModel3D({ geometry, units, unit, markable = false, region = null, onRegion = null }) {
  const fp = useMemo(() => footprintMeters(geometry), [geometry])
  const [mode, setMode] = useState(markable ? 'cutaway' : 'explode')
  const [floor, setFloor] = useState(unit.floor)
  const [spin, setSpin] = useState(!markable)
  const [corners, setCorners] = useState(region?.polygon || [])
  const [cornersFloor, setCornersFloor] = useState(region?.floor ?? unit.floor)
  const [picked, setPicked] = useState(markable) // true once a floor is chosen: frame it close, otherwise show the whole stack
  const controls = useRef()
  useEffect(() => { setFloor(unit.floor); setPicked(markable) }, [unit.floor, unit.ulpin]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCorners(region?.polygon || []); setCornersFloor(region?.floor ?? unit.floor) }, [unit.ulpin]) // eslint-disable-line react-hooks/exhaustive-deps

  const block = useMemo(() => (fp ? flatGeometry(fp.pts, FH - 0.25) : null), [fp])
  const plate = useMemo(() => (fp ? flatGeometry(fp.pts, 0.35) : null), [fp])
  useEffect(() => () => { block?.dispose(); plate?.dispose() }, [block, plate])
  if (!fp) return <p className="muted">This building has no footprint on record, so it cannot be shown in 3D.</p>

  const floors = units.map((u) => u.floor)
  const top = Math.max(...floors, unit.floor)
  const bottom = Math.min(...floors, unit.floor, 1)
  const levels = []
  for (let f = bottom; f <= top; f++) if (f !== 0) levels.push(f)
  const step = FH + GAP
  const yOf = (f) => (f < 0 ? f * step : (f - 1) * step) // floor 1 sits on the ground, basements below it
  const rank = (f) => levels.indexOf(f) - Math.max(0, levels.indexOf(1))
  const gap = mode === 'explode' ? Math.min(3.5, Math.max(0.8, 42 / levels.length)) : 0
  const targetY = (f) => yOf(f) + rank(f) * gap
  const here = units.filter((u) => u.floor === floor)
  const reach = Math.max(fp.w, fp.d, 12)
  const spread = (top - bottom + 1) * (step + gap)
  const poly = (u) => u.raw.polygon.map(([x, y]) => [x * fp.w - fp.w / 2, y * fp.d - fp.d / 2])
  const shade = (f) => (f < 0 ? '#A8B5AE' : `#${LOW.clone().lerp(HIGH, (f - 1) / Math.max(1, top - 1)).getHexString()}`)
  const labelEvery = Math.max(1, Math.ceil(levels.length / 8))
  const close = picked || mode === 'cutaway'
  const focusY = close ? targetY(floor) + FH / 2 : (targetY(top) + targetY(bottom)) / 2 + FH / 2
  const dist = close ? reach * (markable ? 1.45 : 2.6) : Math.max(reach * 2.6, spread * 1.5)
  const pick = (f) => {
    setFloor(f); setPicked(true)
    if (markable && f !== cornersFloor) { setCorners([]); setCornersFloor(f); onRegion?.(null) } // an outline belongs to one floor
  }
  const commit = (next, onFloor = floor) => {
    setCorners(next); setCornersFloor(onFloor)
    onRegion?.(next.length >= 3 ? { floor: onFloor, polygon: next } : null)
  }
  // a click on the open floor: world x and z back to 0..1 of the footprint box (shape y runs along -z)
  const addCorner = (e) => {
    e.stopPropagation()
    const nx = Math.min(1, Math.max(0, (e.point.x + fp.w / 2) / fp.w))
    const ny = Math.min(1, Math.max(0, (-e.point.z + fp.d / 2) / fp.d))
    commit(floor === cornersFloor ? [...corners, [nx, ny]] : [[nx, ny]])
  }
  const marked = (markable || region) && floor === cornersFloor && corners.length > 0
  const shapeCorners = corners.map(([x, y]) => [x * fp.w - fp.w / 2, y * fp.d - fp.d / 2])
  const dim = { explode: 0.55, cutaway: 0.96, xray: 0.12, whole: 0.94 }[mode]

  return (
    <div className="pm3d">
      <div className="pm3d-stage">
        <Canvas shadows dpr={[1, 2]} camera={{ position: markable ? [dist * 0.2, focusY + dist * 0.85, dist * 0.45] : [dist * 0.55, focusY + dist * 0.3, dist * 0.78], fov: 40, near: 0.1, far: dist * 6 }}>
          <ambientLight intensity={0.85} />
          <directionalLight position={[reach, spread + reach, reach]} intensity={1} castShadow />
          <gridHelper args={[reach * 5, 30, '#9DBDAF', '#CFE0D7']} position={[0, yOf(bottom) - 0.05, 0]} />
          {levels.map((f) => {
            if (mode === 'cutaway' && f > floor) return null
            const open = f === floor
            return (
              <Floor key={f} y0={yOf(f)} targetY={targetY(f)}>
                {open ? (
                  <>
                    <Prism geo={plate} color="#F3E3B3" edge="#B07812" onClick={markable ? addCorner : undefined} />
                    {here.map((u) => {
                      const mine = u.ulpin === unit.ulpin
                      const pts = poly(u)
                      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length
                      const cz = pts.reduce((a, p) => a + p[1], 0) / pts.length
                      return (
                        <React.Fragment key={u.ulpin}>
                          <Prism
                            geo={unitGeo(pts, mine ? FH + 0.9 : FH - 0.25)}
                            color={mine ? '#F2B33D' : '#E6F1EB'}
                            glow={mine ? '#F2B33D' : undefined}
                            opacity={mine ? 1 : 0.8}
                            edge={mine ? '#8A5A05' : '#7FA793'}
                            onClick={markable ? addCorner : undefined}
                          />
                          {mine && (
                            <>
                              <mesh position={[cx, FH + 2.4, -cz]}>
                                <cylinderGeometry args={[0.12, 0.12, 3, 8]} />
                                <meshBasicMaterial color="#B07812" />
                              </mesh>
                              <Html position={[cx, FH + 4.2, -cz]} center zIndexRange={[20, 0]}>
                                <span className="pm3d-pin">Your unit</span>
                              </Html>
                            </>
                          )}
                        </React.Fragment>
                      )
                    })}
                    {marked && (
                      <>
                        {shapeCorners.length >= 3 && <Prism geo={unitGeo(shapeCorners, FH + 0.7)} color="#E5484D" glow="#E5484D" opacity={0.78} edge="#8F1D22" />}
                        {shapeCorners.length >= 2 && <Line points={[...shapeCorners, shapeCorners[0]].map(([x, y]) => [x, FH + 0.8, -y])} color="#8F1D22" lineWidth={2} />}
                        {shapeCorners.map(([x, y], i) => (
                          <mesh key={i} position={[x, FH + 0.9, -y]}>
                            <sphereGeometry args={[Math.max(0.35, reach / 90), 12, 12]} />
                            <meshBasicMaterial color={i === 0 ? '#FFFFFF' : '#E5484D'} />
                          </mesh>
                        ))}
                      </>
                    )}
                  </>
                ) : (
                  <Prism geo={block} color={shade(f)} opacity={dim} edge="#6E9D86" onClick={(e) => { e.stopPropagation(); pick(f) }} />
                )}
                {(open || f === top || f === bottom || f % labelEvery === 0) && (
                  <Html position={[fp.w / 2 + 1, FH / 2, 0]} zIndexRange={[10, 0]}>
                    <button className={`pm3d-flabel${open ? ' is-open' : ''}`} onClick={() => pick(f)}>{floorName(f)}</button>
                  </Html>
                )}
              </Floor>
            )
          })}
          <Rig controls={controls} focusY={focusY} dist={dist} spin={spin} viewKey={`${mode}|${floor}|${picked}`} />
          <OrbitControls ref={controls} enableDamping dampingFactor={0.08} autoRotateSpeed={0.9} onStart={() => setSpin(false)} target={[0, focusY, 0]} maxPolarAngle={Math.PI / 2 - 0.05} />
        </Canvas>
        <p className="pm3d-hint">{markable ? 'Click the floor to outline the disputed area. Each click adds a corner.' : 'Drag to turn, scroll to zoom, click a floor to open it.'}</p>
      </div>
      <div className="pm3d-legend">
        <span className="pm3d-modes" role="radiogroup" aria-label="View">
          {MODES.map(([key, label]) => (
            <button key={key} role="radio" aria-checked={mode === key} onClick={() => { setMode(key); setPicked(key === 'cutaway') }}>{label}</button>
          ))}
        </span>
        <span><i style={{ background: '#F2B33D' }} /> Your unit</span>
        <span><i style={{ background: '#DCEBE3' }} /> Neighbours</span>
        {floor !== unit.floor && <button className="pm3d-jump" onClick={() => pick(unit.floor)}>Back to my floor</button>}
        {picked && mode !== 'cutaway' && <button className="pm3d-jump" onClick={() => setPicked(false)}>Whole building</button>}
        <label>
          <input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} /> Spin
        </label>
        {markable && (
          <span className="pm3d-mark">
            <button type="button" className="pm3d-jump" disabled={!corners.length || floor !== cornersFloor} onClick={() => commit(corners.slice(0, -1))}>Undo corner</button>
            <button type="button" className="pm3d-jump" disabled={!corners.length} onClick={() => commit([])}>Clear</button>
          </span>
        )}
        <span className="pm3d-floor">{floorName(floor)}: {here.length ? `${here.length} units` : 'no units on record'}{markable && (floor === cornersFloor && corners.length ? `. ${corners.length} corner${corners.length === 1 ? '' : 's'} marked${corners.length < 3 ? ', add at least 3' : ''}.` : '. Nothing marked yet.')}</span>
      </div>
    </div>
  )
}
