import React, { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

// A building built from its own records: the real footprint outline, one slab per
// storey, and the unit outlines on the chosen floor, with the citizen's unit lit.
// Unit polygons are normalized to the footprint's bounding box (see backend `_floor_units`).

const FH = 3 // storey height (m)
const GAP = 0.5 // visual gap between storeys (m)
const M_PER_DEG = 111320

function footprintMeters(geometry) {
  const ring = geometry?.type === 'Polygon' ? geometry.coordinates[0] : geometry?.coordinates?.[0]?.[0]
  if (!ring?.length) return null
  const lons = ring.map((c) => c[0])
  const lats = ring.map((c) => c[1])
  const minLon = Math.min(...lons)
  const minLat = Math.min(...lats)
  const latMid = (minLat + Math.max(...lats)) / 2
  const kx = M_PER_DEG * Math.cos((latMid * Math.PI) / 180)
  const w = Math.max(1, (Math.max(...lons) - minLon) * kx)
  const d = Math.max(1, (Math.max(...lats) - minLat) * 110540)
  const pts = ring.map(([lon, lat]) => [(lon - minLon) * kx - w / 2, (lat - minLat) * 110540 - d / 2])
  return { w, d, pts }
}

function flatGeometry(points, depth) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: false })
  g.rotateX(-Math.PI / 2) // extrude upward, outline flat on the ground
  return g
}

function Extrusion({ points, depth, y, color, opacity = 1, edge }) {
  const geo = useMemo(() => flatGeometry(points, depth), [points, depth])
  const edges = useMemo(() => (edge ? new THREE.EdgesGeometry(geo) : null), [geo, edge])
  useEffect(() => () => { geo.dispose(); edges?.dispose() }, [geo, edges])
  return (
    <group position={[0, y, 0]}>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshLambertMaterial color={color} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      {edges && <lineSegments geometry={edges}><lineBasicMaterial color={edge} /></lineSegments>}
    </group>
  )
}

export default function PropertyModel3D({ geometry, units, unit }) {
  const fp = useMemo(() => footprintMeters(geometry), [geometry])
  const [solid, setSolid] = useState(false)
  if (!fp) return <p className="muted">This building has no footprint on record, so it cannot be shown in 3D.</p>

  const floors = units.map((u) => u.floor)
  const top = Math.max(...floors, unit.floor)
  const bottom = Math.min(...floors, unit.floor, 1)
  const levels = []
  for (let f = bottom; f <= top; f++) if (f !== 0) levels.push(f)
  const step = FH + GAP
  const yOf = (f) => (f < 0 ? f * step : (f - 1) * step) // floor 1 sits on the ground, basements below it
  const sameFloor = units.filter((u) => u.floor === unit.floor)
  const reach = Math.max(fp.w, fp.d, 12) // frame the unit's floor, not the whole tower
  const focusY = yOf(unit.floor) + FH / 2
  const poly = (u) => u.raw.polygon.map(([x, y]) => [x * fp.w - fp.w / 2, y * fp.d - fp.d / 2])

  return (
    <div className="pm3d">
      <div className="pm3d-stage">
      <Canvas shadows dpr={[1, 2]} camera={{ position: [reach * 1.3, focusY + reach * 1.1, reach * 1.6], fov: 40, near: 0.1, far: (top - bottom + 4) * step + reach * 20 }}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[reach, focusY + reach * 2, reach]} intensity={1} castShadow />
        <gridHelper args={[reach * 4, 24, '#9DBDAF', '#CFE0D7']} position={[0, bottom < 0 ? yOf(bottom) - 0.02 : -0.02, 0]} />
        {levels.map((f) => (
          f === unit.floor ? null : (
            <Extrusion key={f} points={fp.pts} depth={0.35} y={yOf(f)} color={f < 0 ? '#A8B5AE' : '#BFD9CC'} opacity={solid ? 0.7 : 0.16} edge="#7FA793" />
          )
        ))}
        {sameFloor.map((u) => {
          const mine = u.ulpin === unit.ulpin
          return (
            <Extrusion
              key={u.ulpin}
              points={poly(u)}
              depth={FH}
              y={yOf(unit.floor)}
              color={mine ? '#F2B33D' : '#DCEBE3'}
              opacity={mine ? 1 : 0.9}
              edge={mine ? '#8A5A05' : '#7FA793'}
            />
          )
        })}
        <OrbitControls enableDamping dampingFactor={0.08} target={[0, focusY, 0]} maxPolarAngle={Math.PI / 2 - 0.05} />
      </Canvas>
      <p className="pm3d-hint">Drag to turn the building, scroll to zoom.</p>
      </div>
      <div className="pm3d-legend">
        <span><i style={{ background: '#F2B33D' }} /> Your unit</span>
        <span><i style={{ background: '#DCEBE3' }} /> Neighbours on this floor</span>
        <span><i style={{ background: '#BFD9CC' }} /> Other floors</span>
        <label>
          <input type="checkbox" checked={solid} onChange={(e) => setSolid(e.target.checked)} /> Solid floors
        </label>
      </div>
    </div>
  )
}
