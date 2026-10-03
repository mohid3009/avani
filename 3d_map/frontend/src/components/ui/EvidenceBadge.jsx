import './EvidenceBadge.css'
import { MEASURED } from '../../portalData.js'

// What a building's record is built on: each step is either backed by evidence or not yet.
//   footprint -> always there; height -> measured (not guessed); plan -> units read from a floor plan
export default function EvidenceBadge({ heightSource, segmentations = [] }) {
  const steps = [
    ['Footprint', true],
    ['Measured height', MEASURED.has(heightSource)],
    ['Floor plan', segmentations.length > 0 && segmentations.every((s) => s === 'model')],
  ]
  const next = steps.find(([, ok]) => !ok)
  return (
    <ul className="ev" aria-label="Evidence behind this record" title={next ? `Missing: ${next[0].toLowerCase()}` : 'Fully evidenced'}>
      {steps.map(([label, ok]) => (
        <li key={label} className={ok ? 'is-on' : ''}>
          <span aria-hidden="true">{ok ? '✓' : '○'}</span> {label}
          <span className="ev-sr">{ok ? ' (done)' : ' (missing)'}</span>
        </li>
      ))}
    </ul>
  )
}
