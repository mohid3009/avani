import test from 'node:test'
import assert from 'node:assert/strict'
import { unitZRange, unitRenderRange } from '../3d_map/frontend/src/verticalGeometry.js'
import { unitSliceFeatures } from '../3d_map/frontend/src/floors.js'
import {
  detectVolumetricOverlaps, proposeUnitCorrection, confirmUnitCorrection,
  rejectUnitCorrection, updateUnit, getPendingUnitEdits,
} from '../3d_map/frontend/src/api.js'

const polygon = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
const unit = (floor, extra = {}) => ({
  unit_ulpin: `test-F${floor}`, floor_index: floor, polygon, ...extra,
})
const building = {
  type: 'Feature',
  properties: { building_id: 'test-building', stories: 2, height_m: 6, basements: 1 },
  geometry: { type: 'Polygon', coordinates: [[[80, 13], [80.001, 13], [80.001, 13.001], [80, 13.001], [80, 13]]] },
}

test('floor 1 starts at ground; floor 2 stacks above it; basements stay below ground', () => {
  assert.deepEqual(unitZRange(unit(1)), { zMin: 0, zMax: 3 })
  assert.deepEqual(unitZRange(unit(2)), { zMin: 3, zMax: 6 })
  assert.deepEqual(unitZRange(unit(-1)), { zMin: -3, zMax: 0 })
  assert.deepEqual(unitZRange(unit(-2)), { zMin: -6, zMax: -3 })
})

test('explicit corrections determine base, top and mesh depth', () => {
  const corrected = unit(2, { z_min: 5, z_max: 9 })
  assert.deepEqual(unitZRange(corrected), { zMin: 5, zMax: 9 })
  const range = unitRenderRange(corrected, 0.7)
  assert.deepEqual(range, { base: 5.7, top: 9.7 })
  assert.ok(Math.abs((range.top - range.base) - 4) < 1e-10)
  assert.deepEqual(unitRenderRange(unit(-1), 0.7), { base: -3.7, top: -0.7 })
  assert.deepEqual(unitZRange(unit(2, { floor_height_m: 4 })), { zMin: 4, zMax: 8 })
})

test('invalid or incomplete vertical ranges are rejected', () => {
  for (const extra of [
    { z_min: 4, z_max: 2 }, { z_min: 2, z_max: 2 },
    { z_min: 2 }, { z_max: 4 }, { z_min: NaN, z_max: 4 },
    { z_min: 2, z_max: Infinity }, { z_min: '2', z_max: 4 },
  ]) assert.throws(() => unitZRange(unit(1, extra)), /Vertical bounds/)
  assert.throws(() => unitZRange(unit(0)), /floor 1/)
  assert.throws(() => unitZRange(unit(1.5)), /floor 1/)
})

test('touching floor boundaries do not overlap; corrections change overlap volume', () => {
  const a = unit(1)
  const b = unit(2)
  assert.equal(detectVolumetricOverlaps([a, b], 100).length, 0)
  assert.equal(detectVolumetricOverlaps([unit(-1), a], 100).length, 0)
  const overlaps = detectVolumetricOverlaps([a, { ...b, z_min: 2, z_max: 6 }], 100)
  assert.equal(overlaps.length, 1)
  assert.equal(overlaps[0].volumeM3, 100) // 100 m² shared XY area × 1 m shared height
  assert.equal(detectVolumetricOverlaps([a, { ...b, z_min: 3, z_max: 6 }], 100).length, 0)
})

test('MapLibre slices use corrected elevations and negative basement bases', () => {
  const slices = unitSliceFeatures(building, [
    unit(-1), unit(1), unit(2, { z_min: 5, z_max: 9 }),
  ], 0.7)
  assert.deepEqual(slices.map(({ properties: p }) => [p.base_m, p.height_m]), [
    [-3.7, -0.7], [0, 3], [5.7, 9.7],
  ])
  for (const slice of slices) {
    const ring = slice.geometry.coordinates[0]
    assert.deepEqual(ring[0], ring.at(-1))
  }
})


// minimal in-memory stand-in for the FastAPI unit + correction endpoints
function fakeBackend(units) {
  const db = { units: structuredClone(units), edits: [] }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
  const handler = async (url, opts = {}) => {
    const u = new URL(url, 'http://test')
    const body = opts.body ? JSON.parse(opts.body) : null
    const route = `${opts.method || 'GET'} ${u.pathname}`
    if (route === 'GET /api/lidar/units') return json({ units: structuredClone(db.units[u.searchParams.get('building_id')] || []) })
    if (route === 'PUT /api/lidar/units') { db.units[body.building_id] = structuredClone(body.units); return json({ saved: body.units.length }) }
    if (route === 'GET /api/lidar/units/pending') return json(db.edits.filter((e) => e.status === 'pending'))
    if (route === 'POST /api/lidar/units/update') {
      if (db.edits.some((e) => e.unit_ulpin === body.unit_ulpin && e.status === 'pending')) return json({ detail: 'This unit already has a pending correction' }, 409)
      const id = `edit-${db.edits.length + 1}`
      db.edits.push({ ...body.patch, id, status: 'pending' })
      return json({ id })
    }
    if (route === 'POST /api/lidar/units/confirm') {
      const e = db.edits.find((x) => x.id === body.id && x.status === 'pending')
      if (!e) return json({ detail: 'pending edit not found' }, 404)
      Object.assign(e, body.resolution, { status: body.status })
      return json(e)
    }
    return json({ detail: `unexpected ${route}` }, 500)
  }
  return { db, handler }
}

test('correction decisions validate overlaps, preserve heights and reject stale or repeated decisions', async () => {
  const { db, handler } = fakeBackend({ test: [
    unit(1, { owner_name: 'A', area_sqm: 100, validation_status: 'confirmed' }),
    unit(2, { owner_name: 'B', area_sqm: 100, validation_status: 'confirmed' }),
  ] })
  const previousFetch = globalThis.fetch
  globalThis.fetch = handler
  const surveyor = { name: 'Surveyor 1', role: 'surveyor' }
  const registrar = { name: 'Registrar 1', role: 'registrar' }
  try {
    await assert.rejects(proposeUnitCorrection('test', 'test-F2', { z_min: '', z_max: 6 }, surveyor), /required/)
    assert.equal(getPendingUnitEdits().length, 0)
    const bad = await proposeUnitCorrection('test', 'test-F2', { z_min: 2, z_max: 6 }, surveyor)
    assert.ok(bad.overlapAfter > 0)
    assert.equal(getPendingUnitEdits().length, 1)
    await assert.rejects(confirmUnitCorrection(bad.editId, registrar), /overlaps/)
    await assert.rejects(proposeUnitCorrection('test', 'test-F2', {}, surveyor), /already has/)
    await assert.rejects(updateUnit('test', 'test-F2', { owner_name: 'Other' }), /pending correction/)
    await rejectUnitCorrection(bad.editId, registrar, 'Overlap remains')
    await assert.rejects(confirmUnitCorrection(bad.editId, registrar), /no longer pending/)
    await assert.rejects(rejectUnitCorrection(bad.editId, registrar), /no longer pending/)
    assert.equal(db.units.test[1].validation_status, 'confirmed')

    const good = await proposeUnitCorrection('test', 'test-F2', { z_min: 3, z_max: 7 }, surveyor)
    const result = await confirmUnitCorrection(good.editId, registrar)
    assert.deepEqual(unitZRange(result.unit), { zMin: 3, zMax: 7 })
    assert.equal(result.unit.pending_edit_id, null)
    assert.equal(result.unit.revision, 1)
    assert.equal(result.unit.edit_history.length, 2)
    assert.equal(getPendingUnitEdits().length, 0)
    await assert.rejects(confirmUnitCorrection(good.editId, registrar), /no longer pending/)
    const updated = await updateUnit('test', 'test-F2', { owner_name: 'Updated' })
    const current = updated.units[1]
    assert.equal(current.revision, 2)
    assert.deepEqual(unitRenderRange(current, 0.7), { base: 3.7, top: 7.7 })
    assert.equal(unitSliceFeatures(building, [current], 0.7)[0].properties.height_m, 7.7)

    // another user edits the unit after the proposal → approval must be refused
    const stale = await proposeUnitCorrection('test', 'test-F2', { z_min: 3, z_max: 8 }, surveyor)
    db.units.test[1].revision++
    await assert.rejects(confirmUnitCorrection(stale.editId, registrar), /changed after/)
  } finally {
    globalThis.fetch = previousFetch
  }
})
