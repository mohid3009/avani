import React, { useCallback, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { Move3d, RotateCcw, ZoomIn } from 'lucide-react'

// ── color ramp: cool (blue) to warm (red) mapped over normalised 0..1 ─────────
function heightColor(t) {
  const stops = [[0,0.1,0.8],[0,0.9,0.9],[0.1,0.9,0.1],[1,0.9,0],[0.9,0.1,0]]
  t = Math.max(0, Math.min(1, t))
  const seg = t * (stops.length - 1)
  const lo = Math.floor(seg), hi = Math.min(lo + 1, stops.length - 1), f = seg - lo
  const lerp = (a, b) => a + (b - a) * f
  return [lerp(stops[lo][0], stops[hi][0]), lerp(stops[lo][1], stops[hi][1]), lerp(stops[lo][2], stops[hi][2])]
}

// ── build vertex colours and return a cloned geometry with colour attribute ───
function buildColoredGeometry(geometry, colorMode) {
  const pos = geometry.attributes.position
  const n   = pos.count
  const arr = new Float32Array(n * 3)

  if (colorMode === 'flat') {
    for (let i = 0; i < n; i++) arr.set([1, 1, 1], i * 3)
  } else if (colorMode === 'intensity' && geometry.attributes.intensity) {
    const iv = geometry.attributes.intensity
    let iMin = Infinity, iMax = -Infinity
    for (let i = 0; i < n; i++) { const v = iv.getX(i); if (v < iMin) iMin = v; if (v > iMax) iMax = v }
    const range = iMax - iMin || 1
    for (let i = 0; i < n; i++) arr.set(heightColor((iv.getX(i) - iMin) / range), i * 3)
  } else {
    let zMin = Infinity, zMax = -Infinity
    for (let i = 0; i < n; i++) { const z = pos.getZ(i); if (z < zMin) zMin = z; if (z > zMax) zMax = z }
    const range = zMax - zMin || 1
    for (let i = 0; i < n; i++) arr.set(heightColor((pos.getZ(i) - zMin) / range), i * 3)
  }

  const g = geometry.clone()
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

// ── Three.js points mesh ───────────────────────────────────────────────────────
function PointsObject({ geometry, colorMode, pointSize }) {
  const colored = React.useMemo(
    () => geometry ? buildColoredGeometry(geometry, colorMode) : null,
    [geometry, colorMode]
  )
  if (!colored) return null
  return (
    <points geometry={colored}>
      <pointsMaterial vertexColors size={pointSize} sizeAttenuation={false} />
    </points>
  )
}

// ── Fit camera to bounding box after load ──────────────────────────────────────
function FitCamera({ geometry, trigger }) {
  const { camera, controls } = useThree()
  React.useEffect(() => {
    if (!geometry) return
    geometry.computeBoundingBox()
    const box    = geometry.boundingBox
    const centre = new THREE.Vector3()
    box.getCenter(centre)
    const size = new THREE.Vector3()
    box.getSize(size)
    const dist = Math.max(size.x, size.y, size.z) * 1.8
    camera.position.set(dist, dist * 0.6, dist)
    camera.lookAt(centre)
    if (controls && controls.target) { controls.target.copy(centre); controls.update() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])
  return null
}

// ── Stats sidebar panel ────────────────────────────────────────────────────────
function CloudStats({ geometry, filename }) {
  if (!geometry) return null
  geometry.computeBoundingBox()
  const size = new THREE.Vector3()
  geometry.boundingBox.getSize(size)
  return (
    <div className="panel-section" style={{ marginBottom: 12 }}>
      <h3>stats</h3>
      <table className="kv">
        <tbody>
          <tr><td>file</td><td className="mono" style={{ wordBreak:'break-all', fontSize:10 }}>{filename}</td></tr>
          <tr><td>points</td><td>{geometry.attributes.position.count.toLocaleString()}</td></tr>
          <tr><td>X span</td><td>{size.x.toFixed(2)} m</td></tr>
          <tr><td>Y span</td><td>{size.y.toFixed(2)} m</td></tr>
          <tr><td>Z span</td><td>{size.z.toFixed(2)} m</td></tr>
          {geometry.attributes.intensity && <tr><td>intensity</td><td className="muted tiny">available</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
const LAZ_EXTS = ['.laz', '.las']

export default function PointCloudViewer() {
  const [geometry, setGeometry]     = useState(null)
  const [filename, setFilename]     = useState(null)
  const [error, setError]           = useState(null)
  const [loading, setLoading]       = useState(false)
  const [colorMode, setColorMode]   = useState('height')
  const [pointSize, setPointSize]   = useState(2)
  const [showAxes, setShowAxes]     = useState(false)
  const [fitTrigger, setFitTrigger] = useState(0)
  const inputRef = useRef()

  const loadFile = useCallback((file) => {
    if (!file) return
    const ext = '.' + file.name.split('.').pop().toLowerCase()
    if (LAZ_EXTS.includes(ext)) {
      setError('LAZ/LAS files require server-side parsing. Export as PLY first (e.g. via CloudCompare or PDAL).')
      return
    }
    if (ext !== '.ply') { setError(`Unsupported format "${ext}". Please upload a .ply file.`); return }
    setError(null); setLoading(true); setGeometry(null); setFilename(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const geom = new PLYLoader().parse(ev.target.result)
        geom.computeBoundingBox()
        const centre = new THREE.Vector3()
        geom.boundingBox.getCenter(centre)
        geom.translate(-centre.x, -centre.y, -centre.z)
        setGeometry(geom)
        setFitTrigger((t) => t + 1)
      } catch (e) { setError(`Failed to parse PLY: ${e.message}`) }
      finally { setLoading(false) }
    }
    reader.onerror = () => { setError('File read error.'); setLoading(false) }
    reader.readAsArrayBuffer(file)
  }, [])

  const onDrop = useCallback((e) => { e.preventDefault(); loadFile(e.dataTransfer.files?.[0]) }, [loadFile])

  const loadFromUrl = useCallback(async (url, name) => {
    setError(null); setLoading(true); setGeometry(null); setFilename(name)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buffer = await res.arrayBuffer()
      const geom = new PLYLoader().parse(buffer)
      geom.computeBoundingBox()
      const centre = new THREE.Vector3()
      geom.boundingBox.getCenter(centre)
      geom.translate(-centre.x, -centre.y, -centre.z)
      setGeometry(geom)
      setFitTrigger((t) => t + 1)
    } catch (e) { setError(`Failed to load sample: ${e.message}`) }
    finally { setLoading(false) }
  }, [])

  return (
    <main className="workspace" style={{ display:'flex', flex: 1, minHeight: 0, overflow:'hidden' }}>
      {/* ── sidebar ── */}
      <aside className="sidebar" style={{ overflowY:'auto', flexShrink:0 }}>
        <div className="panel-section acc-blue">
          <h3>point cloud viewer</h3>
          <p className="muted tiny" style={{ marginBottom:10, lineHeight:1.5 }}>
            Drop a <span className="mono">.ply</span> file to visualise in 3D.
            For LAZ/LAS, export to PLY via CloudCompare or PDAL first.
          </p>
          <div
            onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            style={{ border:'2px dashed var(--border)', borderRadius:8, padding:'20px 12px', textAlign:'center', cursor:'pointer', marginBottom:10 }}
          >
            <input ref={inputRef} type="file" accept=".ply" style={{ display:'none' }}
              onChange={(e) => loadFile(e.target.files?.[0])} />
            <span className="muted tiny">{loading ? 'parsing…' : 'drop .ply here or click to browse'}</span>
          </div>
          {error && <p style={{ color:'var(--danger,#e05)', fontSize:11, margin:'4px 0' }}>{error}</p>}
          <div style={{ marginTop: 12 }}>
            <span className="muted tiny" style={{ display: 'block', marginBottom: 6 }}>Or load a sample:</span>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button className="btn tiny" onClick={() => loadFromUrl('/samples/sample_lidar.ply', 'sample_lidar.ply')}>
                load sample_lidar.ply
              </button>
              <button className="btn tiny" onClick={() => loadFromUrl('/samples/full_lidar_centered.ply', 'full_lidar_centered.ply')}>
                load full_lidar_centered.ply
              </button>
            </div>
          </div>
        </div>

        {geometry && (
          <>
            <CloudStats geometry={geometry} filename={filename} />
            <div className="panel-section">
              <h3>display</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <label className="muted tiny" style={{ display:'flex', alignItems:'center', gap:6 }}>
                  color
                  <select value={colorMode} onChange={(e) => setColorMode(e.target.value)}
                    style={{ flex:1, background:'var(--panel2)', border:'1px solid var(--border)', color:'var(--text)', padding:'3px 6px', borderRadius:4, fontSize:11 }}>
                    <option value="height">height gradient</option>
                    <option value="intensity">intensity</option>
                    <option value="flat">flat white</option>
                  </select>
                </label>
                <label className="muted tiny" style={{ display:'flex', alignItems:'center', gap:6 }}>
                  size&nbsp;<span className="mono">{pointSize}px</span>
                  <input type="range" min="0.5" max="6" step="0.5" value={pointSize}
                    onChange={(e) => setPointSize(parseFloat(e.target.value))} style={{ flex:1 }} />
                </label>
                <label className="muted tiny" style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <input type="checkbox" checked={showAxes} onChange={(e) => setShowAxes(e.target.checked)} />
                  show axes
                </label>
              </div>
              <div className="btn-row" style={{ marginTop:10 }}>
                <button className="btn" onClick={() => setFitTrigger((t) => t + 1)}>reset camera</button>
              </div>
            </div>
            <div className="panel-section acc-brass">
              <h3>controls</h3>
              <table className="kv">
                <tbody>
                  <tr><td><Move3d size={11} /></td><td className="muted tiny">left drag — orbit</td></tr>
                  <tr><td><ZoomIn size={11} /></td><td className="muted tiny">scroll — zoom</td></tr>
                  <tr><td><RotateCcw size={11} /></td><td className="muted tiny">right drag — pan</td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </aside>

      {/* ── 3D canvas ── */}
      <section style={{ flex:1, background:'#0e1117', position:'relative' }}>
        {!geometry && !loading && (
          <div onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
            className="muted"
            style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, pointerEvents:'all' }}>
            <span style={{ fontSize:48, opacity:0.2 }}>&#x2601;</span>
            <p style={{ margin:0, fontSize:14 }}>drop a <span className="mono">.ply</span> file here</p>
            <p className="tiny" style={{ margin:0 }}>or use the sidebar to browse</p>
          </div>
        )}
        {loading && (
          <div className="muted loading"
            style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
            parsing point cloud…
          </div>
        )}
        <Canvas style={{ width:'100%', height:'100%' }} camera={{ position:[0, 5, 10], fov:50, near:1, far:100000 }} gl={{ antialias:false }}>
          <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
          {geometry && <FitCamera geometry={geometry} trigger={fitTrigger} />}
          {showAxes && <axesHelper args={[5]} />}
          {geometry && <PointsObject geometry={geometry} colorMode={colorMode} pointSize={pointSize} />}
        </Canvas>
      </section>
    </main>
  )
}
