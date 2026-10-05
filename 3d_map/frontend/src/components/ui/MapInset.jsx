import { useEffect, useMemo, useRef } from 'react'
import { AttributionControl, LngLatBounds, Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { unitOnMap } from '../../footprint.js'

const MAP_STYLE = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© Esri, Maxar, Earthstar Geographics',
    },
    property: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    floor: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    unit: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  layers: [
    { id: 'imagery', type: 'raster', source: 'imagery' },
    {
      id: 'property-fill',
      type: 'fill',
      source: 'property',
      paint: { 'fill-color': '#176B55', 'fill-opacity': 0.42 },
    },
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'property',
      paint: { 'fill-extrusion-color': '#6FB894', 'fill-extrusion-height': ['coalesce', ['get', 'h'], 0], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.72, 'fill-extrusion-vertical-gradient': true },
    },
    {
      id: 'floor-3d',
      type: 'fill-extrusion',
      source: 'floor',
      paint: { 'fill-extrusion-color': '#F3E3B3', 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.95 },
    },
    {
      id: 'unit-3d',
      type: 'fill-extrusion',
      source: 'unit',
      paint: { 'fill-extrusion-color': '#F2B33D', 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 1 },
    },
    {
      id: 'property-outline',
      type: 'line',
      source: 'property',
      paint: { 'line-color': '#FFFFFF', 'line-width': 3 },
    },
  ],
}

function boundsForGeometry(geometry) {
  const coordinates = geometry?.type === 'Polygon'
    ? geometry.coordinates.flat()
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates.flat(2)
      : []
  if (!coordinates.length) return null

  return coordinates.reduce((bounds, [lon, lat]) => bounds.extend([lon, lat]), new LngLatBounds(coordinates[0], coordinates[0]))
}

export default function MapInset({ geometry, highlightUnit = false, ulpin, address, label, heightM = 0, floorNo = null, unitPolygon = null, floorHeight = 3 }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const propertyFeature = useMemo(
    () => (geometry ? { type: 'Feature', properties: { h: heightM }, geometry } : null),
    [geometry, heightM],
  )

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [80.23, 13.04],
      zoom: 15,
      pitch: 58,
      bearing: -25,
      attributionControl: false,
      cooperativeGestures: true, // ctrl + scroll to zoom, so the page can still scroll
    })
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !propertyFeature) return

    const update = () => {
      map.resize()
      const source = map.getSource('property')
      if (source) source.setData({ type: 'FeatureCollection', features: [propertyFeature] })
      // the unit's floor as a band through the building, and the unit itself inside it
      const band = floorNo >= 1 ? { base: (floorNo - 1) * floorHeight, top: floorNo * floorHeight } : null
      const fc = (g, extra) => ({ type: 'FeatureCollection', features: g && extra ? [{ type: 'Feature', properties: extra, geometry: g }] : [] })
      map.getSource('floor')?.setData(fc(propertyFeature.geometry, band))
      map.getSource('unit')?.setData(fc(unitOnMap(unitPolygon, propertyFeature.geometry), band))
      const bounds = boundsForGeometry(propertyFeature.geometry)
      if (bounds) map.fitBounds(bounds, { padding: 70, maxZoom: 18, pitch: 58, bearing: -25, duration: 0 })
    }

    if (map.isStyleLoaded()) update()
    else map.once('load', update)
  }, [propertyFeature, floorNo, unitPolygon, floorHeight])

  return (
    <div className="property-map-inset">
      <div ref={containerRef} className="property-map-canvas" aria-label={`Map showing ${address || label || 'property location'}`} />
      <div className="property-map-label">
        {label && <div className="property-map-title">{label}</div>}
        {address && <div className="property-map-address">{address}</div>}
        <div className="property-map-ulpin">Parcel {ulpin}</div>
      </div>
      {highlightUnit && <span className="property-map-badge">LIVE MAP</span>}
    </div>
  )
}
