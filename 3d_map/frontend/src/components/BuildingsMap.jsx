import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl, Marker, addProtocol } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as pmtiles from 'pmtiles'
import { peekUnits, digipin } from '../api.js'
import { floorSlices, shadowFeatures, unitSliceFeatures } from '../floors.js'
import { TIME_LIGHTING_PRESETS } from '../constants.js'

let pmtilesRegistered = false
if (!pmtilesRegistered) {
  const protocol = new pmtiles.Protocol()
  addProtocol('pmtiles', protocol.tile)
  pmtilesRegistered = true
}

// Keyless tile providers (no {r} placeholder — MapLibre does not expand it).
const TILES = {
  satellite: {
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© Esri, Maxar, Earthstar Geographics',
    maxzoom: 19,
  },
  dark: {
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attr: '© Esri, HERE, Garmin, FAO, NOAA, USGS · © OpenStreetMap contributors',
    maxzoom: 16,
  },
  light: {
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attr: '© Esri, HERE, Garmin, FAO, NOAA, USGS · © OpenStreetMap contributors',
    maxzoom: 16,
  },
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] }

// Bounds of the densest city-sized cluster, so scans far apart (Chennai + Mumbai)
// don't zoom the map out to where buildings are invisible specks.
function bboxOf(all) {
  const cell = (f) => {
    const [x, y] = f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0][0] : f.geometry?.coordinates?.flat()?.[0] || []
    return `${Math.round(x)},${Math.round(y)}`
  }
  const groups = new Map()
  for (const f of all) {
    if (!f.geometry) continue
    const k = cell(f)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(f)
  }
  let features = [...groups.values()].sort((a, b) => b.length - a.length)[0] || []
  if (features.length > 50) {
    // drop the outer 2% each way so a few stray scans don't stretch the frame
    const first = (f) => (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0][0] : f.geometry.coordinates.flat()[0])
    const q = (i, p) => first(features.slice().sort((a, b) => first(a)[i] - first(b)[i])[Math.floor(features.length * p)])[i]
    const [xl, xh, yl, yh] = [q(0, 0.02), q(0, 0.98), q(1, 0.02), q(1, 0.98)]
    features = features.filter((f) => { const [x, y] = first(f); return x >= xl && x <= xh && y >= yl && y <= yh })
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const f of features) {
    const g = f.geometry
    if (!g) continue
    const coords = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates.flat()
    for (const [x, y] of coords) {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  return x0 === Infinity ? null : [[x0, y0], [x1, y1]]
}

// Pannable/zoomable map of every building saved in PostGIS. Starts framed on
// the saved set; you can pan/zoom anywhere in the world afterwards.
// Surveyor/registrar can free-draw a replacement footprint for the selected
// building (click points, Enter / double-click / first-point to finish).
export default function BuildingsMap({
  features,
  selectedId,
  onSelect,
  canEdit = false,
  onFootprintDrawn = null,
  ownedIds = null, // citizen view: building_ids the signed-in citizen owns
  floorGap = 1.2, // explosion gap between floor slices (m), default 1.2m
  onFloorGapChange = null,
  onOvertureSelect = null,
  frameKey = null, // change it to re-frame the map on the current features (area switched)
  onFirstDraw = null, // called once the buildings have been painted for the first time
}) {
  const drawnRef = useRef(false)
  const onFirstDrawRef = useRef(onFirstDraw)
  onFirstDrawRef.current = onFirstDraw
  const [tileStyle, setTileStyle] = useState('satellite')
  const [timeOfDay, setTimeOfDay] = useState('noon')
  const [drawMode, setDrawMode] = useState(false)
  const [mapFloorGap, setMapFloorGap] = useState(floorGap)

  useEffect(() => {
    setMapFloorGap(floorGap)
  }, [floorGap])

  // bumped whenever generated units change anywhere (generate/clear/edit) —
  // the selected building's section slices on the map follow its units
  const [unitsVersion, setUnitsVersion] = useState(0)
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const loadedRef = useRef(false)
  const featuresRef = useRef(features)
  featuresRef.current = features
  const drawPtsRef = useRef([]) // committed freeform vertices [lng, lat]
  const firstPixRef = useRef(null) // pixel pos of the first vertex (click-to-close)
  const drawModeRef = useRef(false)
  const finishRef = useRef(() => {})
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  // per-floor render slices — memoize static unselected features so slider dragging
  // only recomputes the selected building's slices for 60fps responsive explosion
  const baseStaticSlices = useMemo(() => floorSlices(features, 0, null), [features])

  const renderFeatures = useMemo(() => {
    if (!selectedId || mapFloorGap === 0) return baseStaticSlices
    const targetFeature = features.find((x) => x.properties?.building_id === selectedId)
    if (!targetFeature) return baseStaticSlices

    const targetExplodedSlices = floorSlices([targetFeature], mapFloorGap, selectedId)
    const remainingSlices = baseStaticSlices.filter((f) => f.properties?.building_id !== selectedId)
    return [...remainingSlices, ...targetExplodedSlices]
  }, [features, baseStaticSlices, selectedId, mapFloorGap])

  const renderRef = useRef(renderFeatures)
  renderRef.current = renderFeatures

  // ground cast-shadows — computed from the raw building-level features so the
  // length comes from each building's TOTAL height, not per-floor slices
  const shadowFc = useMemo(() => shadowFeatures(features), [features])
  const shadowsRef = useRef(shadowFc)
  shadowsRef.current = shadowFc

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        light: { anchor: 'viewport', color: '#ffffff', intensity: 0.5 },
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          ...Object.fromEntries(
            Object.entries(TILES).map(([key, t]) => [
              `base-${key}`,
              { type: 'raster', tiles: [t.url], tileSize: 256, attribution: t.attr, maxzoom: t.maxzoom },
            ]),
          ),
          buildings: { type: 'geojson', data: EMPTY_FC },
          shadows: { type: 'geojson', data: EMPTY_FC }, // ground cast-shadows
          draft: { type: 'geojson', data: EMPTY_FC }, // free-draw preview
          'overture-buildings': {
            type: 'vector',
            url: 'pmtiles://https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-08-19.0/buildings.pmtiles'
          },
        },
        layers: [
          ...Object.keys(TILES).map((key, i) => ({
            id: `base-raster-${key}`,
            type: 'raster',
            source: `base-${key}`,
            layout: { visibility: i === 0 ? 'visible' : 'none' },
          })),
          { id: 'bldg-shadow', type: 'fill', source: 'shadows',
            // dark ground polygon swept away from the sun — denser for taller buildings
            paint: {
              'fill-color': '#0d1321',
              'fill-opacity': ['interpolate', ['linear'], ['get', 'height_m'], 0, 0.06, 8, 0.2, 40, 0.34],
            } },
          { id: 'bldg-flat', type: 'fill', source: 'buildings',
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } },
          { id: 'overture-bldg-extrude', type: 'fill-extrusion', source: 'overture-buildings', 'source-layer': 'building',
            paint: {
              'fill-extrusion-color': '#77777C',
              'fill-extrusion-height': ['coalesce', ['get', 'height'], 6],
              'fill-extrusion-opacity': 0.35,
              'fill-extrusion-vertical-gradient': true,
            } },
          { id: 'bldg-extrude', type: 'fill-extrusion', source: 'buildings',
            paint: {
              'fill-extrusion-color': ['get', 'color'],
              'fill-extrusion-height': ['get', 'height_m'],
              'fill-extrusion-base': ['coalesce', ['get', 'base_m'], 0],
              'fill-extrusion-opacity': 1,
              'fill-extrusion-vertical-gradient': true,
            } },
          { id: 'bldg-line', type: 'line', source: 'buildings',
            paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.45 } },
          { id: 'bldg-basement', type: 'line', source: 'buildings',
            // dashed grey outline marking buildings that have basements
            filter: ['any',
              ['<', ['coalesce', ['get', 'floor'], 0], 0],
              ['all', ['>=', ['coalesce', ['get', 'basements'], 0], 1], ['!', ['has', 'floor']]],
            ],
            paint: { 'line-color': '#9ba1ad', 'line-width': 1.5, 'line-dasharray': [2, 2] } },
          {
            id: 'bldg-selected',
            type: 'line',
            source: 'buildings',
            filter: ['==', ['get', 'building_id'], ''],
            paint: { 'line-color': '#FF8A00', 'line-width': 4, 'line-opacity': 1 },
          },
          { id: 'bldg-pending', type: 'line', source: 'buildings',
            // amber dashed outline marking buildings with unconfirmed edits
            filter: ['==', ['get', 'edit_status'], 'pending'],
            paint: { 'line-color': '#ffb84d', 'line-width': 2.5, 'line-dasharray': [2, 2], 'line-opacity': 0.95 } },
          { id: 'draft-fill', type: 'fill', source: 'draft',
            paint: { 'fill-color': '#ff5533', 'fill-opacity': 0.2 } },
          { id: 'draft-line', type: 'line', source: 'draft',
            paint: { 'line-color': '#ff5533', 'line-width': 2 } },
        ],
      },
      center: [80.2337, 13.0404],
      zoom: 14.6,
      pitch: 52, // tilt into the city so the storey banding reads as a skyline
      bearing: -17,
      attributionControl: false,
    })
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left')

    // tell the page when the buildings are on screen; never keep its loading overlay up for more than 8 s,
    // even when the base-map tiles or a slow graphics card hold the map back
    const fire = () => { if (!drawnRef.current) { drawnRef.current = true; onFirstDrawRef.current?.() } }
    const fallback = setTimeout(fire, 8000)

    map.on('load', () => {
      loadedRef.current = true
      map.getSource('buildings')?.setData({ type: 'FeatureCollection', features: renderRef.current })
      map.getSource('shadows')?.setData({ type: 'FeatureCollection', features: shadowsRef.current })
      map.once('idle', fire)
      const bb = bboxOf(featuresRef.current)
      if (bb) map.fitBounds(bb, { padding: 60, duration: 1400, maxZoom: 17 })
    })
    map.on('click', 'bldg-extrude', (e) => {
      if (drawModeRef.current) return // drawing — clicks add vertices, not select
      if (e.features?.length && onSelect) onSelect(e.features[0].properties.building_id)
    })
    map.on('mouseenter', 'bldg-extrude', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'bldg-extrude', () => (map.getCanvas().style.cursor = ''))
    
    map.on('click', 'overture-bldg-extrude', (e) => {
      if (drawModeRef.current || !onOvertureSelect || !e.features?.length) return
      // Ignore click if it also hit an existing building (handled by bldg-extrude)
      const hits = map.queryRenderedFeatures(e.point, { layers: ['bldg-extrude'] })
      if (hits.length) return
      onOvertureSelect(e.features[0])
    })
    map.on('mouseenter', 'overture-bldg-extrude', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'overture-bldg-extrude', () => (map.getCanvas().style.cursor = ''))

    // ── unit hover tooltip: floor-level 3D ULPIN · DIGIPIN · owner ──────────
    const tip = document.createElement('div')
    tip.className = 'unit-tip'
    tip.style.display = 'none'
    map.getContainer().appendChild(tip)
    map.on('mousemove', 'bldg-extrude', (e) => {
      if (drawModeRef.current || !e.features?.length) {
        tip.style.display = 'none'
        return
      }
      const p = e.features[0].properties
      const floor = p.floor || 1
      const floorLabel = floor < 0 ? `basement B${-floor}` : `floor ${floor}`
      // unit identities exist once the building was segmented in the ULPIN view
      const generated = peekUnits(p.building_id)
      // section slices carry their own unit_ulpin — show that exact unit
      const mine = p.unit_ulpin ? generated.find((u) => u.unit_ulpin === p.unit_ulpin) : null
      const floorUnits = mine ? [mine] : generated.filter((u) => u.floor_index === floor)
      const ulpin = mine
        ? mine.unit_ulpin
        : floorUnits.length
          ? floorUnits[0].unit_ulpin
          : 'not yet assigned'
      const owner = mine
        ? mine.owner_name
        : floorUnits.length
          ? floorUnits[0].owner_name
          : 'not registered'
      const pin = digipin(e.lngLat.lat, e.lngLat.lng)
      const subTitle = mine?.subunit_name ? ` (${mine.subunit_name})` : ''
      const subType = mine?.subunit_type ? `<div class="ut-row"><span>type</span><b>${mine.subunit_type}</b></div>` : ''
      const areaNote = mine
        ? `<div class="ut-row"><span>area</span><b>${mine.area_sqm} m²</b></div>`
        : ''
      const unitRows = !mine && floorUnits.length
        ? floorUnits
            .map((u) => `<div class="ut-row"><span>${u.subunit_name || u.unit_ulpin.split('-F')[1]}</span><b>${u.owner_name} · ${u.area_sqm} m²</b></div>`)
            .join('')
        : ''
      const slab = Math.max(0, (p.height_m || 0) - (p.base_m || 0))
      tip.innerHTML = `
        <div class="ut-head">${p.name ? `${p.name} · ` : ''}${floorLabel}${subTitle}</div>
        <div class="ut-row"><span>3D ULPIN</span><b class="mono">${ulpin}</b></div>
        <div class="ut-row"><span>DIGIPIN</span><b class="mono">${pin}</b></div>
        ${subType}
        <div class="ut-row"><span>owner</span><b>${owner}</b></div>
        ${areaNote}
        ${unitRows}
        <div class="ut-foot">slab ${slab.toFixed(1)} m · ${p.stories || 1}-storey building — click for details</div>
      `
      tip.style.display = 'block'
      const cw = map.getCanvas().clientWidth || 800
      const ch = map.getCanvas().clientHeight || 600
      tip.style.left = `${Math.min(e.point.x + 16, cw - 265)}px`
      tip.style.top = `${Math.min(e.point.y + 16, ch - 150)}px`
    })
    map.on('mouseleave', 'bldg-extrude', () => {
      tip.style.display = 'none'
    })

    // ── free-draw footprint replacement for the selected building ──────────
    const updateDraft = (cursor) => {
      const pts = drawPtsRef.current
      const feats = []
      if (pts.length) {
        feats.push({
          type: 'Feature',
          properties: { kind: 'line' },
          geometry: { type: 'LineString', coordinates: cursor ? [...pts, cursor] : [...pts] },
        })
      }
      if (pts.length >= 2) {
        const ring = cursor ? [...pts, cursor, pts[0]] : [...pts, pts[0]]
        feats.push({
          type: 'Feature',
          properties: { kind: 'poly' },
          geometry: { type: 'Polygon', coordinates: [ring] },
        })
      }
      map.getSource('draft')?.setData({ type: 'FeatureCollection', features: feats })
    }

    map.on('click', (e) => {
      if (!drawModeRef.current) {
        // clicked empty map — clear the selection (dimming resets with it);
        // clicks that hit a building are handled by the bldg-extrude listener
        const hits = map.queryRenderedFeatures(e.point, { layers: ['bldg-extrude'] })
        if (!hits.length && onSelect) onSelect(null)
        return
      }
      const pts = drawPtsRef.current
      // clicking back on the first vertex closes the shape
      if (pts.length >= 3 && firstPixRef.current && e.point.dist(firstPixRef.current) < 12) {
        finishRef.current()
        return
      }
      pts.push([e.lngLat.lng, e.lngLat.lat])
      if (pts.length === 1) firstPixRef.current = e.point
      updateDraft([e.lngLat.lng, e.lngLat.lat])
    })
    map.on('mousemove', (e) => {
      if (!drawModeRef.current || !drawPtsRef.current.length) return
      updateDraft([e.lngLat.lng, e.lngLat.lat])
    })
    map.on('dblclick', (e) => {
      if (!drawModeRef.current) return
      e.preventDefault()
      // the double-click added two vertices — drop them, then finish
      drawPtsRef.current.length = Math.max(0, drawPtsRef.current.length - 2)
      updateDraft(null)
      finishRef.current()
    })

    mapRef.current = map
    return () => { clearTimeout(fallback); map.remove(); mapRef.current = null; loadedRef.current = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // follow unit-store changes (generate / clear / registrar edits)
  useEffect(() => {
    const bump = () => setUnitsVersion((v) => v + 1)
    window.addEventListener('demo-units-changed', bump)
    return () => window.removeEventListener('demo-units-changed', bump)
  }, [])

  // push updated features into the source — when the selected building has
  // generated units, its exploded floors render as their ACTUAL sections
  const rafRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    const selUnits = selectedId ? peekUnits(selectedId) : []
    const selFeature =
      selectedId && selUnits.length
        ? featuresRef.current.find((x) => x.properties?.building_id === selectedId)
        : null
    const unitSlices = selFeature ? unitSliceFeatures(selFeature, selUnits, mapFloorGap) : []
    const layers = unitSlices.length
      ? [
          ...renderFeatures.filter((f) => f.properties?.building_id !== selectedId),
          ...unitSlices,
        ]
      : renderFeatures

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      map.getSource('buildings')?.setData({ type: 'FeatureCollection', features: layers })
      map.getSource('shadows')?.setData({ type: 'FeatureCollection', features: shadowsRef.current })
    })

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [renderFeatures, selectedId, unitsVersion, mapFloorGap])

  // frame the saved city only when initially loading the data set
  const initialFramedRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current || initialFramedRef.current) return
    const bb = bboxOf(features)
    if (bb) {
      map.fitBounds(bb, { padding: 60, duration: 1200, maxZoom: 17, bearing: map.getBearing(), pitch: map.getPitch() })
      initialFramedRef.current = true
    }
  }, [features])

  // switching area (country / region / scan) flies to it
  const lastFrameKeyRef = useRef(frameKey)
  useEffect(() => {
    if (lastFrameKeyRef.current === frameKey) return
    lastFrameKeyRef.current = frameKey
    const map = mapRef.current
    const bb = map && loadedRef.current ? bboxOf(featuresRef.current) : null
    if (bb) map.fitBounds(bb, { padding: 60, duration: 1200, maxZoom: 17 })
  }, [frameKey])

  // selection highlight + zoom-to-building: the WHOLE selected building is
  // repainted in a uniform highlight colour (registrar: orange above ground /
  // purple basements; citizen: indigo above ground), everything else dims to
  // grey — and in citizen view owned buildings keep their colour with an
  // indigo rim so "yours" is always identifiable.
  const basementMarkerRef = useRef(null)
  const ownedListRef = useRef(ownedIds)
  ownedListRef.current = ownedIds
  const ownedKey = ownedIds ? ownedIds.join('|') : ''
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    map.setFilter('bldg-selected', ['==', ['get', 'building_id'], selectedId || ''])

    const ownedList = ownedListRef.current || []
    // sentinel label keeps 'match' valid even when the citizen owns nothing
    const ownedMatch = (t, f) =>
      ['match', ['get', 'building_id'], ownedList.length ? ownedList : ['∅'], t, f]

    // dim: selected full, owned slightly faded, everything else grey/ghost
    const dimExtrusions = selectedId
      ? ['case',
          ['==', ['get', 'building_id'], selectedId], 1,
          ownedMatch(0.85, 0.45)]
      : 1
    const dimLines = selectedId
      ? ['case',
          ['==', ['get', 'building_id'], selectedId], 0.9,
          ownedMatch(0.55, 0.18)]
      : ownedList.length
        ? ownedMatch(0.55, 0.28)
        : 0.5
    map.setPaintProperty('bldg-extrude', 'fill-extrusion-opacity', dimExtrusions)
    map.setPaintProperty('bldg-line', 'line-opacity', dimLines)

    // owned buildings wear an indigo rim (citizen view), even when unselected
    map.setPaintProperty('bldg-line', 'line-color',
      ownedList.length
        ? ['case',
            ['==', ['get', 'building_id'], selectedId || ''], '#FFFFFF',
            ownedMatch('#8B93E8', 'rgba(255,255,255,0.5)')]
        : '#FFFFFF')

    // ground footprints + cast shadows of the other buildings dim as well
    map.setPaintProperty('bldg-flat', 'fill-opacity',
      selectedId ? ['case', ['==', ['get', 'building_id'], selectedId], 0.12, 0.04] : 0.12)
    const shadowBase = ['interpolate', ['linear'], ['get', 'height_m'], 0, 0.06, 8, 0.2, 40, 0.34]
    map.setPaintProperty('bldg-shadow', 'fill-opacity',
      selectedId ? ['case', ['==', ['get', 'building_id'], selectedId], shadowBase, 0.04] : shadowBase)

    // selected building: citizen -> indigo above ground (purple basements),
    // registrar -> orange; everything else flat grey, owned keep their colour
    const selAbove = ownedList.length ? '#5E6AD2' : '#FF8C1A'
    const selColors = selectedId
      ? ['case',
          ['==', ['get', 'building_id'], selectedId],
          ['case', ['<', ['coalesce', ['get', 'floor'], 0], 0], '#8B5CF6', selAbove],
          ownedMatch(['get', 'color'], '#77777C')]
      : ['get', 'color']
    map.setPaintProperty('bldg-extrude', 'fill-extrusion-color', selColors)

    // selected outline follows the role accent
    map.setPaintProperty('bldg-selected', 'line-color', ownedList.length ? '#8B93E8' : '#FF8A00')

    const restBase = ['coalesce', ['get', 'base_m'], 0]
    map.setPaintProperty('bldg-extrude', 'fill-extrusion-base', restBase)
    map.setPaintProperty('bldg-extrude', 'fill-extrusion-height', ['get', 'height_m'])

    // clear the previous basement indicator chip
    if (basementMarkerRef.current) {
      basementMarkerRef.current.remove()
      basementMarkerRef.current = null
    }

    if (!selectedId) return
    const f = featuresRef.current.find((x) => x.properties?.building_id === selectedId)
    if (!f?.geometry) return

    // floating basement indicator (B×n) pinned to the footprint centroid
    const basements = parseInt(f.properties.basements, 10) || 0
    if (basements > 0) {
      const ring = f.geometry.coordinates[0]
      const pts = ring.length && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        ? ring.slice(0, -1)
        : ring
      const clon = pts.reduce((s, c) => s + c[0], 0) / pts.length
      const clat = pts.reduce((s, c) => s + c[1], 0) / pts.length
      const el = document.createElement('div')
      el.className = 'basement-indicator'
      el.textContent = `▼ B×${basements} basement${basements > 1 ? 's' : ''}`
      basementMarkerRef.current = new Marker({ element: el, anchor: 'center' })
        .setLngLat([clon, clat])
        .addTo(map)
    }

    const coords =
      f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates.flat()
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of coords) {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
    if (x0 === Infinity) return
    map.fitBounds(
      [[x0, y0], [x1, y1]],
      {
        padding: 120,
        maxZoom: 18.5,
        duration: 900,
        essential: true,
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      },
    )
  }, [selectedId, ownedKey])




  // free-draw mode bookkeeping (cursor, dblclick-zoom, pending shape)
  useEffect(() => {
    drawModeRef.current = drawMode
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    if (drawMode) {
      map.doubleClickZoom.disable()
      map.getCanvas().style.cursor = 'crosshair'
    } else {
      drawPtsRef.current = []
      firstPixRef.current = null
      map.getSource('draft')?.setData(EMPTY_FC)
      map.doubleClickZoom.enable()
      map.getCanvas().style.cursor = ''
    }
  }, [drawMode])

  // finish the free-draw: hand the new ring to the parent for persistence
  finishRef.current = () => {
    const pts = drawPtsRef.current
    drawPtsRef.current = []
    firstPixRef.current = null
    mapRef.current?.getSource('draft')?.setData(EMPTY_FC)
    setDrawMode(false)
    if (pts.length >= 3 && onFootprintDrawn && selectedIdRef.current) {
      onFootprintDrawn(selectedIdRef.current, pts)
    }
  }

  // Escape cancels the free-draw, Enter finishes it
  useEffect(() => {
    if (!drawMode) return
    const onKey = (e) => {
      if (e.key === 'Escape') setDrawMode(false)
      if (e.key === 'Enter') finishRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawMode])

  // selection changed mid-draw — cancel so the ring can't land on the wrong building
  const prevSelRef = useRef(selectedId)
  useEffect(() => {
    if (prevSelRef.current !== selectedId) {
      prevSelRef.current = selectedId
      if (drawModeRef.current) setDrawMode(false)
    }
  }, [selectedId])

  // tile style switch
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    for (const key of Object.keys(TILES)) {
      map.setLayoutProperty(`base-raster-${key}`, 'visibility', key === tileStyle ? 'visible' : 'none')
    }
    // white outlines vanish on the light basemap — switch to dark grey there
    map.setPaintProperty('bldg-line', 'line-color', tileStyle === 'light' ? '#3a3a3a' : '#ffffff')
  }, [tileStyle])

  // time of day solar lighting switch
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    const preset = TIME_LIGHTING_PRESETS[timeOfDay] || TIME_LIGHTING_PRESETS.noon
    map.setLight({
      anchor: preset.mapLight.anchor,
      color: preset.mapLight.color,
      intensity: preset.mapLight.intensity,
      position: preset.mapLight.position,
    })
    if (map.getLayer('bldg-shadow')) {
      map.setPaintProperty('bldg-shadow', 'fill-color', preset.shadowColor)
      map.setPaintProperty('bldg-shadow', 'fill-opacity', preset.shadowOpacity)
    }
  }, [timeOfDay])

  return (
    <>
      <div className="map-controls">
        <label className="tile-toggle">
          <span>tiles</span>
          <select value={tileStyle} onChange={(e) => setTileStyle(e.target.value)}>
            <option value="satellite">satellite</option>
            <option value="dark">dark</option>
            <option value="light">light</option>
          </select>
        </label>

        <label className="tile-toggle" title="Adjust lighting according to time of day">
          <span>sun</span>
          <select value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)}>
            {Object.values(TIME_LIGHTING_PRESETS).map((t) => (
              <option key={t.key} value={t.key}>{t.shortLabel}</option>
            ))}
          </select>
        </label>

        {selectedId && (
          <label className="tile-toggle map-gap-slider" title="Adjust exploded height gap between floor slices">
            <span>explode gap</span>
            <input
              type="range"
              min="0"
              max="4"
              step="0.1"
              value={mapFloorGap}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0
                setMapFloorGap(val)
                if (onFloorGapChange) onFloorGapChange(val)
              }}
              style={{ width: 80, cursor: 'pointer' }}
            />
            <b className="mono tiny">{mapFloorGap.toFixed(1)}m</b>
          </label>
        )}

        {canEdit && selectedId && (
          <button
            className={`btn ${drawMode ? 'primary' : ''}`}
            title={
              drawMode
                ? 'click the corners of the new outline — close on the first point, double-click, or press Enter · Esc cancels'
                : 'free-draw a replacement footprint for the selected building'
            }
            onClick={() => setDrawMode((v) => !v)}
          >
            {drawMode ? 'drawing… (Enter to finish)' : '✏ free-draw footprint'}
          </button>
        )}
      </div>
      <div ref={containerRef} className="maplibre-map" />
    </>
  )
}
