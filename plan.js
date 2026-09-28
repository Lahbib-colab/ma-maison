// ---------------------------------------------------------------------------
// Opérations sur le PLAN (fonctions pures, sans DOM) : pièces, ouvertures,
// mobilier, appareils, modèles. L'éditeur ne fait qu'appeler ces fonctions ;
// les murs 3D sont ensuite dérivés des rectangles de pièces par world.js.
// ---------------------------------------------------------------------------
import { computeWalls, FURN_INFO } from './world.js';
import { DEVICE_TYPES } from './catalog.js';
import { defaultHouse } from './data.js';

export const MAX_ROOMS = 15;
export const r3 = (v) => Math.round(v * 1000) / 1000;
export const snapv = (v, st) => (st ? r3(Math.round(v / st) * st) : r3(v));
const rid = (p) => `${p}-${Math.random().toString(36).slice(2, 7)}`;

export const OPEN_DEFAULTS = {
  door: { w: 0.9, h: 2.1, label: 'Porte' }, frontdoor: { w: 1.0, h: 2.1, label: 'Porte d’entrée' },
  window: { w: 1.2, h: 1.3, sill: 0.9, label: 'Fenêtre' }, glass: { w: 2.4, h: 2.1, sill: 0, label: 'Baie vitrée' },
  garage: { w: 2.6, h: 2.3, label: 'Porte de garage' },
};

export const area = (r) => (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]);
export const inRect = (x, z, rc, e = 0) => x >= rc[0] - e && x <= rc[2] + e && z >= rc[1] - e && z <= rc[3] + e;
const rectsOverlap = (a, b, eps = 0.01) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > eps && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > eps;
const others = (S, id) => S.rooms.filter((r) => r.id !== id && r.id !== 'jardin');

export function roomAt(S, x, z) {
  return S.rooms.find((q) => !q.outdoor && x >= q.rect[0] && x < q.rect[2] && z >= q.rect[1] && z < q.rect[3])
    || S.rooms.find((q) => q.outdoor && q.id !== 'jardin' && x >= q.rect[0] && x < q.rect[2] && z >= q.rect[1] && z < q.rect[3])
    || S.rooms.find((q) => q.id === 'jardin') || null;
}

// Chevauchement interdit : entre pièces, sauf le terrain ("jardin")
export function findOverlap(S, id, rect) {
  return others(S, id).find((r) => rectsOverlap(r.rect, rect)) || null;
}

export function fitGarden(S, margin = 1.2) {
  let g = S.rooms.find((r) => r.id === 'jardin');
  const rs = S.rooms.filter((r) => r.id !== 'jardin');
  let x1 = 1e9, z1 = 1e9, x2 = -1e9, z2 = -1e9;
  const add = (r, m) => { x1 = Math.min(x1, r[0] - m); z1 = Math.min(z1, r[1] - m); x2 = Math.max(x2, r[2] + m); z2 = Math.max(z2, r[3] + m); };
  rs.forEach((r) => add(r.rect, margin)); (S.layout.ground || []).forEach((q) => add(q.rect, 0.3));
  S.layout.furniture.forEach((f) => { if (f.t === 'tree' || f.t === 'bush') add([f.x, f.z, f.x, f.z], 0.9); });
  if (x1 > x2) { x1 = -1; z1 = -1; x2 = 9; z2 = 9; }
  if (!g) { g = { id: 'jardin', name: 'Jardin', icon: 'leaf', rect: [0, 0, 1, 1], floor: 'grass', outdoor: true, primary: 'light', hideLabel: true }; S.rooms.push(g); }
  g.rect = [r3(x1), r3(z1), r3(x2), r3(z2)];
}

// ----------------------------------------------------------------- pièces
export function addRoom(S, rect, opts = {}) {
  const n = S.rooms.filter((r) => r.id !== 'jardin').length + 1;
  const room = { id: rid('r'), name: opts.name || `Pièce ${n}`, icon: opts.icon || 'sofa', rect: rect.map(r3), floor: opts.floor || 'wood', primary: opts.primary || 'light', ...(opts.outdoor ? { outdoor: true } : {}) };
  S.rooms.splice(S.rooms.findIndex((r) => r.id === 'jardin') >= 0 ? S.rooms.findIndex((r) => r.id === 'jardin') : S.rooms.length, 0, room);
  fitGarden(S);
  return room;
}
function shiftContents(S, room, dx, dz) {
  const old = room.rect;
  S.layout.furniture.forEach((f) => { if (f.room === room.id || inRect(f.x, f.z, old)) { f.x = r3(f.x + dx); f.z = r3(f.z + dz); f.room = room.id; } });
  S.devices.forEach((d) => { if (d.roomId === room.id) { d.pos = [r3(d.pos[0] + dx), d.pos[1], r3(d.pos[2] + dz)]; } });
  S.layout.openings.forEach((o) => { if (inRect(o.x, o.z, old, 0.15)) { o.x = r3(o.x + dx); o.z = r3(o.z + dz); } });
}
export function moveRoom(S, id, dx, dz) {
  const r = S.rooms.find((q) => q.id === id); if (!r) return;
  shiftContents(S, r, dx, dz);
  r.rect = [r3(r.rect[0] + dx), r3(r.rect[1] + dz), r3(r.rect[2] + dx), r3(r.rect[3] + dz)];
}
export function setRoomRect(S, id, rect) { const r = S.rooms.find((q) => q.id === id); if (r) r.rect = rect.map(r3); }
export function deleteRoom(S, id) {
  const r = S.rooms.find((q) => q.id === id); if (!r || id === 'jardin') return { devices: 0 };
  const devs = S.devices.filter((d) => d.roomId === id);
  S.devices = S.devices.filter((d) => d.roomId !== id);
  S.layout.furniture = S.layout.furniture.filter((f) => !(f.room === id || inRect(f.x, f.z, r.rect)));
  S.layout.openings.forEach((o) => { if (o.shutter && !S.devices.some((d) => d.id === o.shutter)) delete o.shutter; if (o.device && !S.devices.some((d) => d.id === o.device)) delete o.device; });
  S.rooms = S.rooms.filter((q) => q.id !== id);
  fitGarden(S); reconcileOpenings(S);
  return { devices: devs.length };
}

// ------------------------------------------------------------ murs / ouvertures
export function wallLen(w) { return w.b - w.a; }
export function nearestWall(S, x, z, maxDist = 0.6) {
  let best = null;
  computeWalls(S.rooms).forEach((w) => {
    const isH = w.orient === 'h', perp = Math.abs((isH ? z : x) - w.c), al = isH ? x : z;
    const out = Math.max(0, w.a - al, al - w.b);
    const d = perp + out;
    if (d <= maxDist && (!best || d < best.dist)) best = { wall: w, dist: d, along: Math.min(w.b, Math.max(w.a, al)) };
  });
  return best;
}
export function wallRoom(S, w) {
  const isH = w.orient === 'h', mid = (w.a + w.b) / 2;
  const probe = (s) => (isH ? roomAt(S, mid, w.c + s * 0.3) : roomAt(S, w.c + s * 0.3, mid));
  const a = probe(1), b = probe(-1);
  return [a, b].find((r) => r && r.id !== 'jardin' && !r.outdoor) || a || b;
}
function openingsOnWall(S, w) {
  const isH = w.orient === 'h';
  return S.layout.openings.filter((o) => (isH ? Math.abs(o.z - w.c) < 0.02 : Math.abs(o.x - w.c) < 0.02) && (isH ? o.x : o.z) >= w.a - 0.01 && (isH ? o.x : o.z) <= w.b + 0.01);
}
const along = (o, w) => (w.orient === 'h' ? o.x : o.z);

export function reconcileOpenings(S) {
  const walls = computeWalls(S.rooms);
  S.layout.openings.forEach((o) => {
    let best = null;
    walls.forEach((w) => {
      const isH = w.orient === 'h', perp = Math.abs((isH ? o.z : o.x) - w.c), al = isH ? o.x : o.z;
      const lo = w.a + o.w / 2 + 0.05, hi = w.b - o.w / 2 - 0.05;
      if (hi < lo) return;
      const c = Math.min(hi, Math.max(lo, al)), d = perp + Math.abs(c - al) * 0.5;
      if (perp < 0.6 && (!best || d < best.d)) best = { w, c, d };
    });
    if (best) { if (best.w.orient === 'h') { o.z = r3(best.w.c); o.x = r3(best.c); } else { o.x = r3(best.w.c); o.z = r3(best.c); } delete o.orphan; }
    else o.orphan = true;
  });
}

export function addOpening(S, kind, x, z) {
  const def = OPEN_DEFAULTS[kind]; if (!def) return { error: 'Type inconnu' };
  const nw = nearestWall(S, x, z, 0.7); if (!nw) return { error: 'Touchez près d’un mur' };
  const w = nw.wall, len = wallLen(w);
  if (len < 0.6) return { error: 'Mur trop court' };
  const width = Math.min(def.w, len - 0.2);
  const lo = w.a + width / 2 + 0.1, hi = w.b - width / 2 - 0.1;
  let p = Math.min(hi, Math.max(lo, nw.along));
  const taken = openingsOnWall(S, w);
  if (taken.some((q) => Math.abs(along(q, w) - p) < (q.w + width) / 2 + 0.05)) return { error: 'Emplacement déjà occupé' };
  const o = { id: rid('o'), kind, x: w.orient === 'h' ? r3(p) : r3(w.c), z: w.orient === 'h' ? r3(w.c) : r3(p), w: r3(width), h: def.h, ...(def.sill !== undefined ? { sill: def.sill } : {}) };
  S.layout.openings.push(o);
  const room = wallRoom(S, w);
  if (kind === 'garage' && room) {
    const d = newDevice(S, { roomId: room.id, type: 'garage', name: 'Porte de garage', pos: [o.x, 2.0, o.z - (w.n || 0) * 0.15] }); o.device = d.id;
  }
  return { opening: o };
}
export function removeOpening(S, o) {
  S.layout.openings = S.layout.openings.filter((q) => q !== o);
  [o.shutter, o.device].forEach((id) => { if (id) S.devices = S.devices.filter((d) => d.id !== id); });
}
export function setShutter(S, o, on) {
  if (!on) { if (o.shutter) S.devices = S.devices.filter((d) => d.id !== o.shutter); delete o.shutter; return; }
  const nw = nearestWall(S, o.x, o.z, 0.3); const room = nw && wallRoom(S, nw.wall); if (!room) return;
  const d = newDevice(S, { roomId: room.id, type: 'shutter', name: `Volet ${room.name}`, pos: [o.x, (o.sill || 0) + o.h, o.z], state: { position: 100 } });
  o.shutter = d.id;
}
export function moveOpeningTo(S, o, x, z) {
  const nw = nearestWall(S, x, z, 1.2); if (!nw) return false;
  const w = nw.wall, lo = w.a + o.w / 2 + 0.05, hi = w.b - o.w / 2 - 0.05; if (hi < lo) return false;
  const p = Math.min(hi, Math.max(lo, nw.along));
  const taken = openingsOnWall(S, w).filter((q) => q !== o);
  if (taken.some((q) => Math.abs(along(q, w) - p) < (q.w + o.w) / 2 + 0.05)) return false;
  if (w.orient === 'h') { o.x = r3(p); o.z = r3(w.c); } else { o.z = r3(p); o.x = r3(w.c); }
  delete o.orphan; return true;
}

// ----------------------------------------------------------------- appareils
export function newDevice(S, { roomId, type, name, pos, state = {}, props = {} }) {
  const t = DEVICE_TYPES[type];
  const d = { id: `${type}-${rid('d')}`, roomId, type, name: name || t.label, pos, props, state: { ...t.defaults(), ...state } };
  S.devices.push(d); return d;
}
export function syncOwnership(S) {
  S.devices.forEach((d) => { const r = roomAt(S, d.pos[0], d.pos[2]); if (r) d.roomId = r.id; });
  S.layout.furniture.forEach((f) => { const r = roomAt(S, f.x, f.z); if (r) f.room = r.id; });
}

// ------------------------------------------------------------------- mobilier
export function footprint(f) {
  const i = FURN_INFO[f.t] || { w: 0.5, d: 0.5 };
  if (f.t === 'rug') return { w: f.w || i.w, d: f.d || i.d };
  if (f.t === 'counter') return { w: f.len || i.w, d: i.d };
  if (f.t === 'bed') return { w: f.single ? 1.0 : 1.75, d: 2.05 };
  return { w: i.w, d: i.d };
}
export function addFurniture(S, t, x, z) {
  const info = FURN_INFO[t]; if (!info) return null;
  const room = roomAt(S, x, z);
  const f = { t, room: room ? room.id : 'jardin', x: r3(x), z: r3(z), r: 0 };
  if (t === 'rug') { f.w = 2.4; f.d = 1.6; f.c = '#3a4658'; }
  if (t === 'counter') f.len = 3;
  if (t === 'bed') f.c = '#41537a';
  if (info.light) { const d = newDevice(S, { roomId: f.room, type: 'light', name: info.light.name, pos: [f.x, info.light.y, f.z], state: { on: true, brightness: 60 }, props: { watts: info.light.watts } }); f.light = d.id; }
  S.layout.furniture.push(f); return f;
}
export function removeFurniture(S, f) {
  S.layout.furniture = S.layout.furniture.filter((q) => q !== f);
  if (f.light) S.devices = S.devices.filter((d) => d.id !== f.light);
}
export function moveFurniture(S, f, x, z) {
  const dx = x - f.x, dz = z - f.z; f.x = r3(x); f.z = r3(z);
  if (f.light) { const d = S.devices.find((q) => q.id === f.light); if (d) d.pos = [r3(d.pos[0] + dx), d.pos[1], r3(d.pos[2] + dz)]; }
  const r = roomAt(S, f.x, f.z); if (r) { f.room = r.id; if (f.light) { const d = S.devices.find((q) => q.id === f.light); if (d) d.roomId = r.id; } }
}
export function cloneFurniture(S, f) {
  const c = JSON.parse(JSON.stringify(f)); delete c.light; c.x = r3(f.x + 0.4); c.z = r3(f.z + 0.4);
  const info = FURN_INFO[f.t];
  if (info && info.light) { const d = newDevice(S, { roomId: f.room, type: 'light', name: info.light.name, pos: [c.x, info.light.y, c.z], state: { on: true, brightness: 60 }, props: { watts: info.light.watts } }); c.light = d.id; }
  S.layout.furniture.push(c); return c;
}

// ------------------------------------------------------------- équipement auto
export function autoEquip(S) {
  let n = 0;
  S.rooms.forEach((r) => {
    if (r.outdoor) return;
    const [x1, z1, x2, z2] = r.rect, cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, has = (t) => S.devices.some((d) => d.roomId === r.id && d.type === t);
    if (!has('light')) { newDevice(S, { roomId: r.id, type: 'light', name: `Plafonnier ${r.name}`, pos: [r3(cx), 2.4, r3(cz)], state: { on: true, brightness: 70 }, props: { watts: 12 } }); n++; }
    if (r.primary !== 'garage' && r.floor !== 'concrete' && !has('thermostat')) { newDevice(S, { roomId: r.id, type: 'thermostat', name: `Thermostat ${r.name}`, pos: [r3(x1 + 0.15), 1.5, r3(cz)], state: { current: 20, target: 20 } }); n++; }
    if (r.icon === 'drop' && !has('temp')) { newDevice(S, { roomId: r.id, type: 'temp', name: 'Capteur température', pos: [r3(x2 - 0.15), 1.6, r3(cz)], state: { temperature: 22, humidity: 55 } }); r.primary = 'humidity'; n++; }
  });
  return n;
}

// ------------------------------------------------------------------ validation
export function validate(S) {
  const issues = [];
  const real = S.rooms.filter((r) => r.id !== 'jardin');
  for (let i = 0; i < real.length; i++) for (let j = i + 1; j < real.length; j++) if (rectsOverlap(real[i].rect, real[j].rect)) issues.push(`« ${real[i].name} » et « ${real[j].name} » se chevauchent`);
  const orphans = S.layout.openings.filter((o) => o.orphan).length;
  if (orphans) issues.push(`${orphans} ouverture${orphans > 1 ? 's' : ''} hors mur (à replacer ou supprimer)`);
  if (S.rooms.filter((r) => r.floor === 'water').length > 1) issues.push('Une seule piscine est affichée en 3D');
  return issues;
}

// ---------------------------------------------------------------------- modèles
const R = (id, name, icon, rect, floor, primary, extra = {}) => ({ id, name, icon, rect, floor, primary, ...extra });
export function blankPlan() {
  const S = { rooms: [R('piece1', 'Pièce 1', 'sofa', [0, 0, 5, 4], 'wood', 'light')], layout: { wallHeight: 2.6, openings: [], furniture: [], ground: [] }, devices: [] };
  fitGarden(S); return S;
}
export function villaPlan() { const h = defaultHouse(); return { rooms: h.rooms, layout: h.layout, devices: h.devices }; }
export function t2Plan() {
  const S = {
    rooms: [
      R('sejour', 'Séjour', 'sofa', [0, 0, 6, 5], 'wood', 'light'), R('cuisine', 'Cuisine', 'utensils', [0, 5, 3.5, 7.5], 'tile', 'light'),
      R('entree', 'Entrée', 'home', [3.5, 5, 6, 7.5], 'tile', 'light'), R('chambre', 'Chambre', 'bed', [6, 0, 10, 4.2], 'wood', 'temp'),
      R('sdb', 'Salle de bain', 'drop', [6, 4.2, 10, 7.5], 'tile', 'humidity'),
    ],
    layout: {
      wallHeight: 2.6,
      openings: [
        { id: 'o1', kind: 'frontdoor', x: 4.7, z: 7.5, w: 1.0, h: 2.1 }, { id: 'o2', kind: 'window', x: 3, z: 0, w: 1.6, h: 1.3, sill: 0.9 },
        { id: 'o3', kind: 'glass', x: 0, z: 2.5, w: 2.0, h: 2.1, sill: 0 }, { id: 'o4', kind: 'window', x: 0, z: 6.2, w: 1.0, h: 1.1, sill: 1.0 },
        { id: 'o5', kind: 'window', x: 8, z: 0, w: 1.4, h: 1.3, sill: 0.9 }, { id: 'o6', kind: 'window', x: 10, z: 2, w: 1.2, h: 1.3, sill: 0.9 },
        { id: 'o7', kind: 'window', x: 10, z: 5.8, w: 0.7, h: 0.7, sill: 1.4 }, { id: 'd1', kind: 'door', x: 4.7, z: 5, w: 0.9, h: 2.1 },
        { id: 'd2', kind: 'door', x: 1.7, z: 5, w: 0.9, h: 2.1 }, { id: 'd3', kind: 'door', x: 6, z: 2, w: 0.9, h: 2.1 },
        { id: 'd4', kind: 'door', x: 8.8, z: 4.2, w: 0.8, h: 2.1 }, { id: 'd5', kind: 'door', x: 6, z: 6.4, w: 0.8, h: 2.1 },
      ],
      furniture: [
        { t: 'rug', room: 'sejour', x: 2.6, z: 2.6, w: 2.8, d: 2.0, c: '#3a4658' }, { t: 'sofa', room: 'sejour', x: 4.6, z: 2.6, r: -90 },
        { t: 'coffee', room: 'sejour', x: 3.1, z: 2.6 }, { t: 'tv', room: 'sejour', x: 0.4, z: 3.9, r: 90 }, { t: 'plant', room: 'sejour', x: 5.5, z: 4.5 },
        { t: 'table', room: 'sejour', x: 3.2, z: 0.9 }, { t: 'chair', room: 'sejour', x: 2.7, z: 1.5, r: 0 }, { t: 'chair', room: 'sejour', x: 3.7, z: 1.5, r: 0 },
        { t: 'counter', room: 'cuisine', x: 3.15, z: 6.3, r: -90, len: 2.2 }, { t: 'fridge', room: 'cuisine', x: 0.6, z: 7.0 },
        { t: 'bed', room: 'chambre', x: 8, z: 1.4, c: '#41537a' }, { t: 'wardrobe', room: 'chambre', x: 9.0, z: 3.85, r: 180 },
        { t: 'nightstand', room: 'chambre', x: 6.6, z: 0.5 }, { t: 'nightstand', room: 'chambre', x: 9.4, z: 0.5 },
        { t: 'shower', room: 'sdb', x: 9.4, z: 4.9 }, { t: 'vanity', room: 'sdb', x: 7.4, z: 7.2, r: 180 }, { t: 'toilet', room: 'sdb', x: 6.5, z: 5.0, r: 90 },
      ],
      ground: [],
    },
    devices: [],
  };
  // luminaires des meubles liés
  S.layout.furniture.forEach((f) => { const i = FURN_INFO[f.t]; if (i && i.light) { const d = newDevice(S, { roomId: f.room, type: 'light', name: i.light.name, pos: [f.x, i.light.y, f.z], state: { on: true, brightness: 60 }, props: { watts: i.light.watts } }); f.light = d.id; } });
  S.layout.openings.filter((o) => o.kind === 'window' || o.kind === 'glass').slice(0, 3).forEach((o) => setShutter(S, o, true));
  autoEquip(S); fitGarden(S); reconcileOpenings(S); syncOwnership(S);
  return S;
}
