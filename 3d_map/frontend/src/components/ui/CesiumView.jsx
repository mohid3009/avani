import { useEffect, useRef, useState } from 'react'
import { unitOnMap } from '../../footprint.js'

// CesiumJS is large, so it is loaded from a CDN the first time a globe is opened, not bundled.
const CESIUM = 'https://cdn.jsdelivr.net/npm/cesium@1.124.0/Build/Cesium/'
let loading = null
function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      window.CESIUM_BASE_URL = CESIUM
      const css = document.createElement('link')
      css.rel = 'stylesheet'
      css.href = `${CESIUM}Widgets/widgets.css`
      document.head.appendChild(css)
      const js = document.createElement('script')
      js.src = `${CESIUM}Cesium.js`
      js.onload = () => resolve(window.Cesium)
      js.onerror = () => { loading = null; reject(new Error('Cesium could not be loaded')) }
      document.head.appendChild(js)
    })
  }
  return loading
}

const ring = (geometry) => (geometry?.type === 'Polygon' ? geometry.coordinates[0] : geometry?.coordinates?.[0]?.[0]) || []

// The building on a 3D globe: its footprint raised to its measured height, the unit's floor as a band, the unit in yellow.
export default function CesiumView({ geometry, heightM = 0, floorNo = null, unitPolygon = null, floorHeight = 3 }) {
  const box = useRef(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false) // the first frame has been drawn

  useEffect(() => {
    let viewer
    let gone = false
    setReady(false)
    loadCesium().then((Cesium) => {
      if (gone || !box.current) return
      viewer = new Cesium.Viewer(box.current, {
        baseLayer: new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
          url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
          credit: 'Esri, Maxar, Earthstar Geographics',
        })),
        baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
        animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      })
      const poly = (coords, base, top, color, outline) => viewer.entities.add({
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(coords.flat()),
          height: base, extrudedHeight: top,
          material: color, outline: true, outlineColor: outline,
        },
      })
      const foot = ring(geometry)
      const building = poly(foot, 0, Math.max(heightM, 3), Cesium.Color.fromCssColorString('#6FB894').withAlpha(0.7), Cesium.Color.fromCssColorString('#0F5442'))
      if (floorNo >= 1) {
        const [base, top] = [(floorNo - 1) * floorHeight, floorNo * floorHeight]
        poly(foot, base, top, Cesium.Color.fromCssColorString('#F3E3B3').withAlpha(0.95), Cesium.Color.fromCssColorString('#B07812'))
        const u = unitOnMap(unitPolygon, geometry)
        if (u) {
          poly(u.coordinates[0], base, top, Cesium.Color.fromCssColorString('#F2B33D'), Cesium.Color.fromCssColorString('#8A5A05'))
          const c = u.coordinates[0]
          viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length, top + 6),
            label: { text: 'Your unit', font: '600 14px sans-serif', fillColor: Cesium.Color.fromCssColorString('#3D2800'), showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#F2B33D'), pixelOffset: new Cesium.Cartesian2(0, -8) },
          })
        }
      }
      // the cover stays until the camera has arrived and the map tiles around the building are loaded (or 25 s pass)
      const fallback = setTimeout(() => !gone && setReady(true), 25000)
      viewer.zoomTo(building, new Cesium.HeadingPitchRange(Cesium.Math.toRadians(-25), Cesium.Math.toRadians(-32), Math.max(120, heightM * 2.5))).then(() => {
        const stop = viewer.scene.postRender.addEventListener(() => {
          if (viewer.scene.globe.tilesLoaded) { stop(); clearTimeout(fallback); if (!gone) setReady(true) }
        })
      })
    }).catch((e) => setError(e.message))
    return () => { gone = true; if (viewer && !viewer.isDestroyed()) viewer.destroy() }
  }, [geometry, heightM, floorNo, unitPolygon, floorHeight])

  if (error) return <div className="pm3d-loading">The globe needs an internet connection to load. {error}.</div>
  return (
    <div className="cesium-wrap">
      <div ref={box} className="cesium-box" />
      {!ready && <div className="pm3d-loading cesium-cover">Loading the globe…</div>}
    </div>
  )
}
