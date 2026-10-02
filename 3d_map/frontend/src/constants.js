export const ROLE_LABELS = {
  citizen:   'Citizen',
  surveyor:  'Surveyor',
  registrar: 'Registrar',
}

export const SESSION_KEY = 'avani-session'

export const TIME_LIGHTING_PRESETS = {
  dawn: {
    key: 'dawn',
    label: '🌅 Dawn (06:00)',
    shortLabel: '🌅 Dawn',
    mapLight: { anchor: 'viewport', color: '#ffaa66', intensity: 0.65, position: [1.5, 90, 20] },
    shadowColor: '#1a0b16',
    shadowOpacity: 0.35,
    three: {
      ambientColor: '#ffd1a9',
      ambientIntensity: 0.6,
      sunColor: '#ff9944',
      sunIntensity: 1.25,
      sunPosOffset: [2.5, 1.2, 0.8],
      bgColor: '#181018',
    },
  },
  noon: {
    key: 'noon',
    label: '☀️ Noon (12:00)',
    shortLabel: '☀️ Noon',
    mapLight: { anchor: 'viewport', color: '#ffffff', intensity: 0.85, position: [1.1, 180, 75] },
    shadowColor: '#0d1321',
    shadowOpacity: 0.38,
    three: {
      ambientColor: '#ffffff',
      ambientIntensity: 0.85,
      sunColor: '#ffffff',
      sunIntensity: 1.4,
      sunPosOffset: [0.5, 3.5, 0.5],
      bgColor: '#050505',
    },
  },
  dusk: {
    key: 'dusk',
    label: '🌇 Sunset (18:00)',
    shortLabel: '🌇 Sunset',
    mapLight: { anchor: 'viewport', color: '#ff7733', intensity: 0.6, position: [1.5, 270, 15] },
    shadowColor: '#1c0914',
    shadowOpacity: 0.42,
    three: {
      ambientColor: '#ffaa88',
      ambientIntensity: 0.55,
      sunColor: '#ff5522',
      sunIntensity: 1.2,
      sunPosOffset: [-2.5, 1.2, 0.8],
      bgColor: '#1c1018',
    },
  },
  night: {
    key: 'night',
    label: '🌙 Night (22:00)',
    shortLabel: '🌙 Night',
    mapLight: { anchor: 'viewport', color: '#4466aa', intensity: 0.3, position: [1.2, 210, 50] },
    shadowColor: '#030611',
    shadowOpacity: 0.6,
    three: {
      ambientColor: '#182848',
      ambientIntensity: 0.35,
      sunColor: '#6688cc',
      sunIntensity: 0.45,
      sunPosOffset: [1.5, 2.0, -1.5],
      bgColor: '#03050c',
    },
  },
}

