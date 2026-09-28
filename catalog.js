// ---------------------------------------------------------------------------
// Catalogue des types d'appareils : valeurs par défaut, puissance électrique,
// résumé lisible. AUCUNE valeur d'interface n'est codée ailleurs : l'UI et la
// 3D lisent tout via ce catalogue et via l'état du magasin (store.js).
// ---------------------------------------------------------------------------

export const fmt1 = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');
export const fmtTemp = (n) => `${fmt1(n)}°`;
export function fmtPower(w) {
  if (w >= 1000) return `${(w / 1000).toFixed(1).replace('.', ',')} kW`;
  return `${Math.round(w)} W`;
}

export const CATEGORIES = {
  lighting: { label: 'Éclairage', color: '#ffd60a' },
  climate: { label: 'Chauffage & clim', color: '#ff9f0a' },
  appliances: { label: 'Prises & appareils', color: '#0a84ff' },
  pool: { label: 'Piscine', color: '#64d2ff' },
  vehicle: { label: 'Véhicule', color: '#30d158' },
  other: { label: 'Autres', color: '#bf5af2' },
};

export const DEVICE_TYPES = {
  light: {
    label: 'Éclairage', icon: 'bulb', category: 'lighting',
    defaults: () => ({ on: false, brightness: 70, tone: 'warm' }),
    isOn: (s) => !!s.on,
    power: (s, p) => (s.on ? (p.watts || 10) * (0.15 + 0.85 * s.brightness / 100) : 0),
    summary: (s) => (s.on ? `${Math.round(s.brightness)} %` : 'Éteint'),
  },
  thermostat: {
    label: 'Thermostat', icon: 'thermo', category: 'climate',
    defaults: () => ({ current: 20, target: 20, mode: 'heat', heating: false }),
    isOn: (s) => s.mode !== 'off',
    power: (s, p) => (s.heating ? (p.watts || 800) : 0),
    summary: (s) => `${fmtTemp(s.current)} → ${fmtTemp(s.target)}`,
  },
  ac: {
    label: 'Climatisation', icon: 'wind', category: 'climate',
    defaults: () => ({ on: false, mode: 'cool', target: 24 }),
    isOn: (s) => !!s.on,
    power: (s, p) => (s.on ? (p.watts || 1100) : 0),
    summary: (s) => (s.on ? `${s.mode === 'cool' ? 'Froid' : s.mode === 'heat' ? 'Chaud' : 'Ventil.'} ${fmtTemp(s.target)}` : 'Éteinte'),
  },
  heater: {
    label: 'Chauffage', icon: 'flame', category: 'climate',
    defaults: () => ({ on: false }),
    isOn: (s) => !!s.on,
    power: (s, p) => (s.on ? (p.watts || 500) : 0),
    summary: (s) => (s.on ? 'Actif' : 'Éteint'),
  },
  shutter: {
    label: 'Volet', icon: 'blinds', category: 'other',
    defaults: () => ({ position: 100 }),
    isOn: (s) => s.position > 5,
    power: () => 0,
    summary: (s) => (s.position >= 95 ? 'Ouverts' : s.position <= 5 ? 'Fermés' : `${Math.round(s.position)} %`),
  },
  plug: {
    label: 'Prise', icon: 'plug', category: 'appliances',
    defaults: () => ({ on: true }),
    isOn: (s) => !!s.on,
    power: (s, p) => (s.on ? (p.watts || 60) : 0),
    summary: (s, p) => (s.on ? `${p.watts || 60} W` : 'Éteinte'),
  },
  camera: {
    label: 'Caméra', icon: 'camera', category: 'other',
    defaults: () => ({ on: true, recording: false }),
    isOn: (s) => !!s.on,
    power: (s) => (s.on ? 6 : 0),
    summary: (s) => (s.on ? (s.recording ? 'Enregistre' : 'En direct') : 'Éteinte'),
  },
  motion: {
    label: 'Détecteur', icon: 'motion', category: 'other',
    defaults: () => ({ detected: false, armed: false, detectedUntil: 0 }),
    isOn: (s) => !!s.detected,
    power: () => 0,
    summary: (s) => (s.detected ? 'Présence' : s.armed ? 'Armé' : 'Aucune'),
  },
  lock: {
    label: 'Serrure', icon: 'lock', category: 'other',
    defaults: () => ({ locked: true }),
    isOn: (s) => !s.locked,
    power: () => 0,
    summary: (s) => (s.locked ? 'Verrouillée' : 'Déverrouillée'),
  },
  temp: {
    label: 'Capteur', icon: 'thermo', category: 'other',
    defaults: () => ({ temperature: 21, humidity: 50 }),
    isOn: () => false,
    power: () => 0,
    summary: (s) => `${fmtTemp(s.temperature)} · ${Math.round(s.humidity)} %`,
  },
  garage: {
    label: 'Porte de garage', icon: 'garage', category: 'vehicle',
    defaults: () => ({ position: 0, target: 0 }),
    isOn: (s) => s.position > 1,
    power: (s) => (Math.abs(s.position - s.target) > 0.5 ? 350 : 0),
    summary: (s) => (s.position <= 1 ? 'Fermée' : s.position >= 99 ? 'Ouverte' : 'En mouvement'),
  },
  pool: {
    label: 'Piscine', icon: 'waves', category: 'pool',
    defaults: () => ({ pump: true, temperature: 26, target: 26 }),
    isOn: (s) => !!s.pump,
    power: (s, p) => (s.pump ? (p.watts || 650) : 0),
    summary: (s) => `${fmtTemp(s.temperature)}${s.pump ? ' · Pompe active' : ' · Pompe arrêtée'}`,
  },
};

export function deviceCategory(d) {
  return (d.props && d.props.category) || (DEVICE_TYPES[d.type] && DEVICE_TYPES[d.type].category) || 'other';
}
export function devicePower(d) {
  const t = DEVICE_TYPES[d.type];
  return t ? t.power(d.state, d.props || {}) : 0;
}

export const TONES = {
  warm: { label: 'Chaud', rgb: [1.0, 0.78, 0.45] },
  neutral: { label: 'Neutre', rgb: [1.0, 0.93, 0.8] },
  cool: { label: 'Froid', rgb: [0.78, 0.9, 1.0] },
  aqua: { label: 'Aqua', rgb: [0.35, 0.85, 1.0] },
};
