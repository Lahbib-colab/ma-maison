// ---------------------------------------------------------------------------
// Construction de la maison 3D À PARTIR DES DONNÉES (pièces, ouvertures,
// mobilier, appareils). Fonction pure : aucune dépendance GL/DOM, donc
// testable. Les murs sont déduits des bords des pièces (bord partagé =
// cloison, bord isolé = mur extérieur), avec vraies ouvertures (linteau,
// allège, vitrage, cadre).
// ---------------------------------------------------------------------------
import { MeshBuilder, MAT, hex } from './gl.js';
import { TONES } from './catalog.js';

const COL = {
  outer: '#2b313b', outerTop: '#e9edf2', plaster: '#e6e1d7', part: '#dcd7cd', partTop: '#f3f0e9',
  frame: '#cfd6de', shutter: '#39414d', wood: '#a9784a', tile: '#c6cbd3', concrete: '#7f858e',
  grass: '#3f7d3a', deck: '#9c7248', driveway: '#3a3e46', stone: '#575d67', poolTile: '#8fd3e6',
};
const FLOOR = {
  wood: { c: COL.wood, mat: MAT.WOOD }, tile: { c: COL.tile, mat: MAT.TILE }, concrete: { c: COL.concrete, mat: MAT.CONCRETE },
};
const EXT_T = 0.24, INT_T = 0.12, INT_H = 1.7;
export const GROUND = {
  stone: { c: COL.stone, mat: MAT.CONCRETE, h: 0.03, label: 'Allée pavée' },
  driveway: { c: COL.driveway, mat: MAT.CONCRETE, h: 0.03, label: 'Enrobé / béton' },
  deck: { c: COL.deck, mat: MAT.DECK, h: 0.05, label: 'Terrasse bois' },
  gravel: { c: '#8b877c', mat: MAT.CONCRETE, h: 0.03, label: 'Gravier' },
};

export function lightRadius(state, d) {
  const r = state.rooms.find((x) => x.id === d.roomId);
  if (r && r.outdoor) return 4.4;
  return d.pos[1] > 2 ? 5.4 : 3.5;
}

// -------------------------------------------------------------------- murs
export function computeWalls(rooms) {
  const H = new Map(), V = new Map();
  const add = (map, c, a, b, side) => {
    const k = c.toFixed(3);
    if (!map.has(k)) map.set(k, { c, items: [] });
    map.get(k).items.push({ a, b, side });
  };
  rooms.forEach((r) => {
    if (r.outdoor) return;
    const [x1, z1, x2, z2] = r.rect;
    add(H, z1, x1, x2, +1); add(H, z2, x1, x2, -1);
    add(V, x1, z1, z2, +1); add(V, x2, z1, z2, -1);
  });
  const out = [];
  const proc = (map, orient) => map.forEach(({ c, items }) => {
    const pts = [...new Set(items.flatMap((i) => [+i.a.toFixed(3), +i.b.toFixed(3)]))].sort((p, q) => p - q);
    let cur = null;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const cov = items.filter((i) => i.a <= a + 1e-6 && i.b >= b - 1e-6);
      if (!cov.length) { cur = null; continue; }
      const ext = cov.length === 1, n = ext ? -cov[0].side : 0, key = ext ? `e${n}` : 'i';
      if (cur && cur.key === key && Math.abs(cur.b - a) < 1e-6) cur.b = b;
      else { cur = { orient, c, a, b, ext, n, key }; out.push(cur); }
    }
  });
  proc(H, 'h'); proc(V, 'v');
  return out;
}

// --------------------------------------------------------------- construction
export function buildHouse(state) {
  const mb = new MeshBuilder();
  const rooms = state.rooms, layout = state.layout;
  const roomIdx = Object.fromEntries(rooms.map((r, i) => [r.id, i]));
  const lightDevs = state.devices.filter((d) => d.type === 'light').slice(0, 16);
  const lightIdx = Object.fromEntries(lightDevs.map((d, i) => [d.id, i]));
  const dynamics = [];
  const H = layout.wallHeight;

  const roomAtPoint = (x, z) => {
    const r = rooms.find((q) => !q.outdoor && x >= q.rect[0] && x < q.rect[2] && z >= q.rect[1] && z < q.rect[3]);
    return r ? roomIdx[r.id] : -1;
  };
  const jardin = roomIdx.jardin ?? -1;

  // ------------------------------------------------------------ sol / île
  const G = (rooms.find((r) => r.id === 'jardin') || { rect: [-1.6, -1.6, 18, 17] }).rect;
  const pool = rooms.find((r) => r.floor === 'water');
  const SIDE = '#161c25';
  const gBox = (x1, z1, x2, z2, y0, h, c, mat, room, thick = false) => {
    if (x2 - x1 < 0.01 || z2 - z1 < 0.01) return;
    const f = thick ? { px: SIDE, nx: SIDE, pz: SIDE, nz: SIDE } : undefined;
    mb.attr({ room, mat }).box((x1 + x2) / 2, y0, (z1 + z2) / 2, x2 - x1, h, z2 - z1, c, { ao: thick ? 0.55 : 1, noBottom: true, faces: f });
  };
  if (pool) {
    const P = pool.rect;
    gBox(G[0], G[1], G[2], P[1], -0.9, 0.9, COL.grass, MAT.GRASS, jardin, true);
    gBox(G[0], P[3], G[2], G[3], -0.9, 0.9, COL.grass, MAT.GRASS, jardin, true);
    gBox(G[0], P[1], P[0], P[3], -0.9, 0.9, COL.grass, MAT.GRASS, jardin, true);
    gBox(P[2], P[1], G[2], P[3], -0.9, 0.9, COL.grass, MAT.GRASS, jardin, true);
    // bassin : parois + fond + eau
    const pi = roomIdx[pool.id];
    mb.attr({ room: pi, mat: MAT.PLAIN });
    const pw = P[2] - P[0], pd = P[3] - P[1], pcx = (P[0] + P[2]) / 2, pcz = (P[1] + P[3]) / 2;
    mb.box(pcx, -1.0, pcz, pw, 0.05, pd, COL.poolTile, { ao: 1 });
    [[pcx, P[1] - 0.05, pw + 0.2, 0.1], [pcx, P[3] + 0.05, pw + 0.2, 0.1]].forEach(([x, z, sx, sz]) => mb.box(x, -1.0, z, sx, 1.0, sz, COL.poolTile, { ao: 0.9 }));
    [[P[0] - 0.05, pcz], [P[2] + 0.05, pcz]].forEach(([x, z]) => mb.box(x, -1.0, z, 0.1, 1.0, pd, COL.poolTile, { ao: 0.9 }));
    const pl = lightDevs.find((d) => d.roomId === pool.id);
    mb.attr({ room: pi, mat: MAT.WATER, emis: pl ? 10 + lightIdx[pl.id] : 0 });
    mb.box(pcx, -0.16, pcz, pw, 0.03, pd, '#1d7fc0', { ao: 1, noBottom: true });
    mb.attr({ emis: 0 });
    // margelle
    mb.attr({ room: jardin, mat: MAT.PLAIN });
    const cp = 0.3;
    [[pcx, P[1] - cp / 2 - 0.1, pw + 0.2 + cp * 2, cp], [pcx, P[3] + cp / 2 + 0.1, pw + 0.2 + cp * 2, cp]].forEach(([x, z, sx, sz]) => mb.box(x, 0, z, sx, 0.09, sz, '#e8ebef', { ao: 1 }));
    [[P[0] - cp / 2 - 0.1, pcz], [P[2] + cp / 2 + 0.1, pcz]].forEach(([x, z]) => mb.box(x, 0, z, cp, 0.09, pd, '#e8ebef', { ao: 1 }));
    // terrasse en bois autour du bassin
    gBox(P[0] - 1.0, P[1] - 1.0, P[2] + 1.6, P[1] - cp - 0.1, 0, 0.05, COL.deck, MAT.DECK, jardin);
    gBox(P[0] - 1.0, P[3] + cp + 0.1, P[2] + 1.6, P[3] + 0.9, 0, 0.05, COL.deck, MAT.DECK, jardin);
    gBox(P[0] - 1.0, P[1] - cp - 0.1, P[0] - cp - 0.1, P[3] + cp + 0.1, 0, 0.05, COL.deck, MAT.DECK, jardin);
    gBox(P[2] + cp + 0.1, P[1] - cp - 0.1, P[2] + 1.6, P[3] + cp + 0.1, 0, 0.05, COL.deck, MAT.DECK, jardin);
  } else {
    gBox(G[0], G[1], G[2], G[3], -0.9, 0.9, COL.grass, MAT.GRASS, jardin, true);
  }
  // sols extérieurs (allées, terrasses…) : données layout.ground + pièces extérieures non aquatiques
  const groundItems = (layout.ground || []).map((g) => ({ rect: g.rect, kind: g.kind }));
  rooms.forEach((r) => { if (r.outdoor && r.id !== 'jardin' && r.floor !== 'water' && GROUND[r.floor === 'concrete' ? 'driveway' : r.floor]) groundItems.push({ rect: r.rect, kind: r.floor === 'concrete' ? 'driveway' : r.floor }); });
  groundItems.forEach((g) => { const k = GROUND[g.kind]; if (k) gBox(g.rect[0], g.rect[1], g.rect[2], g.rect[3], 0, k.h, k.c, k.mat, jardin); });

  // planchers des pièces
  rooms.forEach((r) => {
    if (r.outdoor) return;
    const [x1, z1, x2, z2] = r.rect, f = FLOOR[r.floor] || FLOOR.wood;
    mb.attr({ room: roomIdx[r.id], mat: f.mat }).box((x1 + x2) / 2, -0.06, (z1 + z2) / 2, x2 - x1, 0.12, z2 - z1, f.c, { ao: 1, noBottom: true });
  });
  mb.attr({ mat: MAT.PLAIN, room: -1 });

  // ---------------------------------------------------------------- murs
  const walls = computeWalls(rooms);
  walls.forEach((w) => {
    const t = w.ext ? EXT_T : INT_T, top = w.ext ? H : INT_H;
    const isH = w.orient === 'h';
    const cd = w.ext ? (isH ? [0, w.n] : [w.n, 0]) : [0, 0];
    const a0 = w.a - t / 2, b0 = w.b + t / 2;
    const ops = (layout.openings || [])
      .filter((o) => (isH ? Math.abs(o.z - w.c) < 0.02 && o.x - o.w / 2 >= w.a - 1e-3 && o.x + o.w / 2 <= w.b + 1e-3
        : Math.abs(o.x - w.c) < 0.02 && o.z - o.w / 2 >= w.a - 1e-3 && o.z + o.w / 2 <= w.b + 1e-3))
      .map((o) => ({ ...o, p: isH ? o.x : o.z })).sort((p, q) => p.p - q.p);

    // Boîte de mur : along = centre le long de l'axe, len = longueur, y0..y1, off = décalage vers l'extérieur
    const block = (along, len, y0, y1, off, thick, colors, opts = {}) => {
      if (len < 0.005 || y1 - y0 < 0.005) return;
      const faces = colors || {};
      if (isH) mb.box(along, y0, w.c + off, len, y1 - y0, thick, faces.base, { ao: 0.88, faces: { top: faces.top, pz: w.n === 1 ? faces.out : faces.in, nz: w.n === 1 ? faces.in : faces.out, px: faces.end, nx: faces.end }, ...opts });
      else mb.box(w.c + off, y0, along, thick, y1 - y0, len, faces.base, { ao: 0.88, faces: { top: faces.top, px: w.n === 1 ? faces.out : faces.in, nx: w.n === 1 ? faces.in : faces.out, pz: faces.end, nz: faces.end }, ...opts });
    };
    const cols = w.ext
      ? { base: COL.plaster, top: COL.outerTop, out: COL.outer, in: COL.plaster, end: COL.plaster }
      : { base: COL.part, top: COL.partTop, out: COL.part, in: COL.part, end: COL.part };
    const colsEdge = w.ext ? { ...cols, end: COL.outer } : cols;
    mb.attr({ room: -1, mat: MAT.PLAIN, cx: cd[0], cz: cd[1] });

    let cursor = a0;
    ops.forEach((o) => {
      const s = o.p - o.w / 2, e = o.p + o.w / 2;
      const seg = (from, to, y0, y1, isFirst) => block((from + to) / 2, to - from, y0, y1, 0, t, isFirst ? colsEdge : cols);
      seg(cursor, s, 0, top, cursor === a0);
      const sill = o.sill || 0, oh = Math.min(o.h, top);
      if (sill > 0.01) block(o.p, o.w, 0, sill, 0, t, cols);
      if (sill + oh < top - 0.01) block(o.p, o.w, sill + oh, top, 0, t, cols);
      // remplissage de l'ouverture
      const inside = w.ext ? roomAtPoint(isH ? o.p : w.c - w.n * 0.4, isH ? w.c - w.n * 0.4 : o.p) : -1;
      if (o.kind === 'window' || o.kind === 'glass') {
        mb.attr({ room: inside, mat: MAT.GLASS });
        block(o.p, o.w - 0.06, sill + 0.03, sill + oh - 0.03, 0, 0.03, { base: '#0b1626', top: '#0b1626', out: '#0b1626', in: '#0b1626', end: '#0b1626' }, { ao: 1 });
        mb.attr({ room: -1, mat: MAT.PLAIN });
        const fr = { base: COL.frame, top: COL.frame, out: COL.frame, in: COL.frame, end: COL.frame };
        const ft = 0.05, fo = w.ext ? 0.0 : 0;
        block(o.p, o.w, sill, sill + ft, fo, t + 0.02, fr, { ao: 1 });
        block(o.p, o.w, sill + oh - ft, sill + oh, fo, t + 0.02, fr, { ao: 1 });
        block(o.p - o.w / 2 + ft / 2, ft, sill, sill + oh, fo, t + 0.02, fr, { ao: 1 });
        block(o.p + o.w / 2 - ft / 2, ft, sill, sill + oh, fo, t + 0.02, fr, { ao: 1 });
        if (o.kind === 'glass' || o.w > 1.6) block(o.p, 0.05, sill, sill + oh, fo, t + 0.02, fr, { ao: 1 });
        if (o.shutter) dynamics.push(shutterMesh(o, w, isH, sill, oh, t, cd, inside));
      } else if (o.kind === 'frontdoor') {
        block(o.p, o.w - 0.04, 0.02, oh, 0, 0.06, { base: '#6b4a2e', top: '#6b4a2e', out: '#6b4a2e', in: '#7a5636', end: '#6b4a2e' }, { ao: 0.9 });
        mb.attr({ emis: 0.0 });
        block(o.p + o.w / 2 - 0.15, 0.03, 1.0, 1.25, w.n * 0.06, 0.04, { base: '#d6dbe2', top: '#d6dbe2', out: '#d6dbe2', in: '#d6dbe2', end: '#d6dbe2' }, { ao: 1 });
      } else if (o.kind === 'garage') {
        dynamics.push(garageMesh(o, w, isH, oh, t, cd));
      }
      cursor = e;
    });
    block((cursor + b0) / 2, b0 - cursor, 0, top, 0, t, cursor === a0 ? colsEdge : { ...colsEdge, end: colsEdge.end }, {});
  });
  mb.attr({ room: -1, mat: MAT.PLAIN, cx: 0, cz: 0, emis: 0 });

  // ------------------------------------------------------------- mobilier
  (layout.furniture || []).forEach((f) => {
    const fn = FURN[f.t]; if (!fn) return;
    const ri = roomIdx[f.room] ?? -1;
    mb.attr({ room: ri, mat: MAT.PLAIN, emis: 0 });
    mb.group(f.x, f.z, f.r || 0);
    const li = f.light !== undefined && lightIdx[f.light] !== undefined ? 10 + lightIdx[f.light] : 0;
    fn(mb, f, li);
    mb.ungroup();
  });
  mb.attr({ room: -1, mat: MAT.PLAIN, emis: 0 });

  return { mb, dynamics, lightDevs, lightIdx, roomIdx, walls };
}

// Volets roulants : lames ancrées en haut, l'échelle Y varie avec la position
function shutterMesh(o, w, isH, sill, oh, t, cd, room) {
  const b = new MeshBuilder();
  b.attr({ room, mat: MAT.PLAIN, cx: cd[0], cz: cd[1] });
  const off = w.n * (t / 2 + 0.05);
  const c = COL.shutter;
  if (isH) b.box(o.p, sill - 0.02, w.c + off, o.w + 0.06, oh + 0.06, 0.05, c, { ao: 0.9, faces: { top: '#4a5462' } });
  else b.box(w.c + off, sill - 0.02, o.p, 0.05, oh + 0.06, o.w + 0.06, c, { ao: 0.9, faces: { top: '#4a5462' } });
  return { builder: b, kind: 'shutter', deviceId: o.shutter, pivotY: sill + oh + 0.04 };
}
function garageMesh(o, w, isH, oh, t, cd) {
  const b = new MeshBuilder();
  b.attr({ room: -1, mat: MAT.PLAIN, cx: 0, cz: 0 });
  const panel = { base: '#c3c9d2', top: '#c3c9d2', out: '#c3c9d2', in: '#a8aeb8', end: '#c3c9d2' };
  const add = (y0, y1, off, thick, col) => {
    if (isH) b.box(o.p, y0, w.c + off, o.w - 0.06, y1 - y0, thick, col, { ao: 0.9, faces: { pz: col, nz: col } });
    else b.box(w.c + off, y0, o.p, thick, y1 - y0, o.w - 0.06, col, { ao: 0.9 });
  };
  add(0.02, oh - 0.02, 0, 0.07, '#bfc5ce');
  for (let k = 1; k < 5; k++) add((oh / 5) * k - 0.015, (oh / 5) * k + 0.015, w.n * 0.04, 0.03, '#8a919c');
  return { builder: b, kind: 'garage', deviceId: o.device, pivotY: oh };
}

// ------------------------------------------------------ constructeurs de meubles
const B = (mb, x, y, z, sx, sy, sz, c, o) => mb.box(x, y, z, sx, sy, sz, c, o);
const FURN = {
  rug(mb, f) {
    const w = f.w || 2.4, d = f.d || 1.6;
    if (f.round) mb.prism(0, 0.06, 0, w / 2, w / 2, 0.02, 20, f.c || '#555', { ao: 1 });
    else B(mb, 0, 0.06, 0, w, 0.02, d, f.c || '#555', { ao: 1 });
  },
  sofa(mb) {
    const c = '#cdc6ba', c2 = '#b9b2a6';
    B(mb, 0, 0.1, 0, 2.5, 0.32, 0.95, c); B(mb, 0, 0.42, -0.4, 2.5, 0.5, 0.2, c2);
    B(mb, -1.2, 0.42, 0.05, 0.16, 0.3, 0.85, c2); B(mb, 1.2, 0.42, 0.05, 0.16, 0.3, 0.85, c2);
    B(mb, 0.9, 0.1, 0.95, 0.7, 0.32, 0.95, c);
    [-0.6, 0.15].forEach((x) => B(mb, x, 0.42, 0.05, 0.7, 0.14, 0.7, '#dcd6cb'));
    B(mb, -0.85, 0.55, -0.22, 0.42, 0.34, 0.14, '#5b6b86', { ry: 12 });
    B(mb, 0.3, 0.55, -0.22, 0.42, 0.34, 0.14, '#c9a35f', { ry: -10 });
  },
  armchair(mb) {
    B(mb, 0, 0.08, 0, 0.9, 0.3, 0.85, '#8a6f52'); B(mb, 0, 0.36, -0.36, 0.9, 0.5, 0.16, '#7b6146');
    B(mb, -0.42, 0.36, 0, 0.12, 0.28, 0.8, '#7b6146'); B(mb, 0.42, 0.36, 0, 0.12, 0.28, 0.8, '#7b6146');
  },
  coffee(mb) {
    B(mb, 0, 0.36, 0, 1.1, 0.05, 0.6, '#1c2027'); [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]].forEach(([x, z]) => B(mb, x, 0.06, z, 0.05, 0.3, 0.05, '#0e1014'));
    B(mb, -0.2, 0.41, 0, 0.3, 0.03, 0.2, '#d8d2c6'); mb.prism(0.25, 0.41, 0.05, 0.07, 0.07, 0.12, 8, '#8fa987');
  },
  tv(mb) {
    B(mb, 0, 0.06, 0, 1.9, 0.42, 0.42, '#2a2119');
    B(mb, 0, 0.66, -0.05, 1.5, 0.86, 0.05, '#0e1116');
    mb.attr({ emis: 0.5 }); B(mb, 0, 0.7, -0.02, 1.4, 0.78, 0.02, '#1c3358', { ao: 1 }); mb.attr({ emis: 0 });
  },
  floorlamp(mb, f, li) {
    mb.prism(0, 0.06, 0, 0.12, 0.12, 0.03, 10, '#20242b'); mb.prism(0, 0.09, 0, 0.018, 0.018, 1.4, 6, '#20242b');
    mb.attr({ emis: li || 0.4 }); mb.prism(0, 1.42, 0, 0.26, 0.19, 0.3, 12, '#ffd9a0', { ao: 1 }); mb.attr({ emis: 0 });
  },
  plant(mb) {
    mb.prism(0, 0.06, 0, 0.2, 0.15, 0.32, 10, '#c9c2b6'); mb.sphere(0, 0.75, 0, 0.32, 0.4, 0.32, '#2f7a3f'); mb.sphere(0.12, 1.0, 0.05, 0.22, 0.3, 0.22, '#3b8a4b');
  },
  shelf(mb) {
    B(mb, 0, 0.06, 0, 1.4, 1.9, 0.36, '#7a5a3a'); [0.5, 0.95, 1.4].forEach((y) => B(mb, 0, y, 0.02, 1.3, 0.03, 0.36, '#5a422b'));
    const cols = ['#b5533c', '#3a6ea5', '#d1a23a', '#5a8f5a', '#8a5a9c'];
    [0.1, 0.55, 1.0, 1.45].forEach((y, r) => { for (let k = 0; k < 7; k++) B(mb, -0.55 + k * 0.17, y + 0.03, 0.05, 0.1, 0.32, 0.22, cols[(k + r) % 5], { ao: 1 }); });
  },
  counter(mb, f) {
    const L = f.len || 3;
    B(mb, 0, 0.06, -0.05, L, 0.86, 0.62, '#e6e2da'); B(mb, 0, 0.92, -0.05, L, 0.04, 0.66, '#2d3138');
    B(mb, 0, 1.55, -0.2, L, 0.7, 0.34, '#e6e2da');
    for (let k = -1; k <= 1; k++) B(mb, k * (L / 3), 0.1, 0.27, 0.01, 0.75, 0.01, '#a8a39a', { ao: 1 });
    B(mb, -L / 4, 0.965, -0.05, 0.6, 0.012, 0.5, '#0d0f13', { ao: 1 }); [[-0.15, -0.1], [0.15, -0.1], [-0.15, 0.1], [0.15, 0.1]].forEach(([x, z]) => mb.prism(-L / 4 + x, 0.98, -0.05 + z, 0.07, 0.07, 0.006, 10, '#3a3f47'));
    B(mb, L / 4, 0.965, -0.05, 0.6, 0.012, 0.4, '#aeb6c1', { ao: 1 });
    mb.prism(L / 4, 0.97, -0.28, 0.018, 0.018, 0.3, 6, '#c9d0d8');
  },
  island(mb) {
    B(mb, 0, 0.06, 0, 2.3, 0.86, 0.9, '#2d3540'); B(mb, 0, 0.92, 0, 2.4, 0.05, 1.0, '#e8e5df');
    [-0.55, 0.55].forEach((x) => { mb.prism(x, 0.06, 0.85, 0.16, 0.16, 0.62, 10, '#1d2128'); });
  },
  fridge(mb) {
    B(mb, 0, 0.06, 0, 0.75, 1.85, 0.7, '#cfd5dc'); B(mb, 0, 1.0, 0.36, 0.72, 0.012, 0.01, '#8a919b', { ao: 1 });
    B(mb, 0.3, 1.1, 0.38, 0.03, 0.4, 0.03, '#9aa3ae', { ao: 1 }); B(mb, 0.3, 1.5, 0.38, 0.03, 0.3, 0.03, '#9aa3ae', { ao: 1 });
  },
  table(mb) {
    B(mb, 0, 0.72, 0, 1.7, 0.05, 0.9, '#6b4a30'); [[-0.75, -0.38], [0.75, -0.38], [-0.75, 0.38], [0.75, 0.38]].forEach(([x, z]) => B(mb, x, 0.06, z, 0.07, 0.68, 0.07, '#4a331f'));
    mb.prism(0, 0.77, 0, 0.09, 0.07, 0.16, 8, '#d9d3c7');
  },
  chair(mb) {
    B(mb, 0, 0.44, 0, 0.42, 0.04, 0.42, '#2b2f36'); B(mb, 0, 0.66, -0.2, 0.42, 0.46, 0.04, '#2b2f36');
    [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]].forEach(([x, z]) => B(mb, x, 0.06, z, 0.04, 0.4, 0.04, '#171a1f'));
  },
  bed(mb, f) {
    const single = f.single, w = single ? 1.0 : 1.75, d = 2.05, c = f.c || '#41537a';
    B(mb, 0, 0.06, 0, w + 0.1, 0.28, d + 0.06, '#59452f'); B(mb, 0, 0.34, 0.02, w, 0.2, d, '#f1eee8');
    B(mb, 0, 0.36, 0.5, w + 0.02, 0.2, d * 0.55, c, { ao: 0.92 });
    B(mb, 0, 0.06, -d / 2 - 0.04, w + 0.2, 1.0, 0.09, '#4a3a28');
    (single ? [0] : [-0.42, 0.42]).forEach((x) => B(mb, x, 0.54, -d / 2 + 0.3, single ? 0.6 : 0.68, 0.12, 0.36, '#f7f5f0', { ao: 1 }));
  },
  nightstand(mb, f, li) {
    B(mb, 0, 0.06, 0, 0.44, 0.5, 0.4, '#59452f');
    mb.prism(0, 0.58, 0, 0.05, 0.05, 0.03, 8, '#1c1f24');
    mb.attr({ emis: li || 0.3 }); mb.prism(0, 0.62, 0, 0.11, 0.08, 0.17, 10, '#ffe0b0', { ao: 1 }); mb.attr({ emis: 0 });
  },
  wardrobe(mb) {
    B(mb, 0, 0.06, 0, 1.6, 2.1, 0.6, '#d9d3c8'); B(mb, 0, 0.5, 0.31, 0.012, 1.6, 0.01, '#9b9588', { ao: 1 });
    [-0.06, 0.06].forEach((x) => B(mb, x, 1.0, 0.32, 0.015, 0.25, 0.015, '#7c7a72', { ao: 1 }));
  },
  desk(mb) {
    B(mb, 0, 0.72, 0, 1.2, 0.04, 0.6, '#d8c4a3'); [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]].forEach(([x, z]) => B(mb, x, 0.06, z, 0.04, 0.66, 0.04, '#3a3f47'));
    B(mb, 0, 0.98, -0.2, 0.52, 0.32, 0.03, '#0e1116'); mb.attr({ emis: 0.35 }); B(mb, 0, 1.0, -0.185, 0.48, 0.28, 0.01, '#274a7a', { ao: 1 }); mb.attr({ emis: 0 });
    B(mb, 0.0, 0.76, 0.05, 0.4, 0.01, 0.14, '#2b2f36', { ao: 1 });
  },
  shower(mb, f) {
    B(mb, 0, 0.06, 0, 1.0, 0.08, 1.0, '#e8ebef');
    [[0, 0.5, 1.0, 0.03], [-0.5, 0, 0.03, 1.0]].forEach(([x, z, sx, sz]) => B(mb, x, 0.12, z, sx, 1.95, sz, '#9fc4d6', { ao: 1 }));
    mb.prism(0.3, 1.9, -0.3, 0.02, 0.02, 0.15, 6, '#c9d0d8'); mb.prism(0.3, 2.05, -0.3, 0.13, 0.13, 0.02, 12, '#c9d0d8');
  },
  vanity(mb) {
    B(mb, 0, 0.06, 0, 1.2, 0.8, 0.5, '#d9d3c8'); B(mb, 0, 0.86, 0, 1.24, 0.04, 0.54, '#eceff3');
    mb.prism(-0.25, 0.9, 0.02, 0.15, 0.12, 0.03, 12, '#ffffff'); mb.prism(0.25, 0.9, 0.02, 0.15, 0.12, 0.03, 12, '#ffffff');
    mb.attr({ emis: 0.28 }); B(mb, 0, 1.25, -0.24, 1.1, 0.7, 0.02, '#a9c4d6', { ao: 1 }); mb.attr({ emis: 0 });
  },
  toilet(mb) {
    B(mb, 0, 0.06, 0, 0.4, 0.4, 0.55, '#f2f4f7'); B(mb, 0, 0.5, -0.24, 0.42, 0.42, 0.18, '#f2f4f7');
  },
  bathtub(mb) {
    B(mb, 0, 0.06, 0, 1.7, 0.55, 0.75, '#f2f4f7'); B(mb, 0, 0.6, 0, 1.5, 0.02, 0.55, '#bcd7e6', { ao: 1 });
    mb.prism(-0.75, 0.6, 0, 0.03, 0.03, 0.25, 6, '#c9d0d8');
  },
  washer(mb) {
    B(mb, 0, 0.06, 0, 0.6, 0.85, 0.6, '#e9edf1'); mb.attr({ emis: 0.15 }); mb.prism(0, 0.3, 0.31, 0.2, 0.2, 0.02, 14, '#31485f', { ao: 1 }); mb.attr({ emis: 0 });
  },
  car(mb) {
    // capot vers +z local
    B(mb, 0, 0.32, 0, 1.92, 0.55, 4.5, '#1c2432'); B(mb, 0, 0.87, -0.15, 1.7, 0.5, 2.5, '#1c2432');
    B(mb, 0, 0.92, -0.15, 1.72, 0.32, 2.3, '#0b1119', { ao: 1 });
    [[-0.98, 1.4], [0.98, 1.4], [-0.98, -1.35], [0.98, -1.35]].forEach(([x, z]) => B(mb, x, 0.06, z, 0.26, 0.64, 0.64, '#0b0c0e'));
    mb.attr({ emis: 0.9 }); B(mb, -0.65, 0.62, 2.27, 0.42, 0.1, 0.04, '#dfeaff', { ao: 1 }); B(mb, 0.65, 0.62, 2.27, 0.42, 0.1, 0.04, '#dfeaff', { ao: 1 });
    B(mb, -0.7, 0.66, -2.27, 0.4, 0.1, 0.04, '#ff2a2a', { ao: 1 }); B(mb, 0.7, 0.66, -2.27, 0.4, 0.1, 0.04, '#ff2a2a', { ao: 1 }); mb.attr({ emis: 0 });
  },
  charger(mb) { B(mb, 0, 0.9, 0, 0.3, 0.5, 0.12, '#e9edf1'); mb.attr({ emis: 0.8 }); B(mb, 0, 1.25, 0.07, 0.16, 0.03, 0.01, '#3cff8a', { ao: 1 }); mb.attr({ emis: 0 }); },
  lounger(mb) {
    B(mb, 0, 0.28, 0, 0.7, 0.05, 1.9, '#e8e3d8'); B(mb, 0, 0.4, -0.8, 0.7, 0.05, 0.6, '#e8e3d8', { ry: 0 });
    [[-0.3, -0.85], [0.3, -0.85], [-0.3, 0.85], [0.3, 0.85]].forEach(([x, z]) => B(mb, x, 0.02, z, 0.04, 0.27, 0.04, '#333941'));
  },
  tree(mb, f) {
    const s = f.s || 1;
    mb.prism(0, 0, 0, 0.12 * s, 0.09 * s, 1.5 * s, 7, '#4b3a2a');
    mb.sphere(0, 2.1 * s, 0, 1.15 * s, 1.0 * s, 1.15 * s, '#2c6b3e', 9, 6);
    mb.sphere(0.5 * s, 1.75 * s, 0.25 * s, 0.8 * s, 0.7 * s, 0.8 * s, '#367a47', 8, 5);
    mb.sphere(-0.45 * s, 1.85 * s, -0.25 * s, 0.75 * s, 0.7 * s, 0.75 * s, '#2a6238', 8, 5);
  },
  bush(mb) { mb.sphere(0, 0.35, 0, 0.6, 0.42, 0.55, '#2f7a45', 8, 5); mb.sphere(0.4, 0.28, 0.15, 0.4, 0.3, 0.4, '#3a8a4f', 7, 4); },
  postlamp(mb, f, li) {
    mb.prism(0, 0, 0, 0.03, 0.03, 0.8, 6, '#1a1d22');
    mb.attr({ emis: li || 0.4 }); mb.sphere(0, 0.88, 0, 0.1, 0.09, 0.1, '#ffe2a8', 6, 4); mb.attr({ emis: 0 });
  },
  poollight(mb, f, li) { mb.attr({ emis: li || 0.4 }); mb.prism(0, -0.13, 0, 0.16, 0.16, 0.01, 10, '#bff3ff', { ao: 1 }); mb.attr({ emis: 0 }); },
};

export function toneRgb(tone) { return (TONES[tone] || TONES.warm).rgb; }

// Catalogue d'édition : libellé, catégorie, emprise au sol (m) pour le plan 2D
export const FURN_INFO = {
  sofa: { label: 'Canapé', cat: 'Salon', w: 2.5, d: 1.9, ox: 0, oz: 0.45 }, armchair: { label: 'Fauteuil', cat: 'Salon', w: 0.9, d: 0.85 },
  coffee: { label: 'Table basse', cat: 'Salon', w: 1.1, d: 0.6 }, tv: { label: 'Meuble TV', cat: 'Salon', w: 1.9, d: 0.42 },
  shelf: { label: 'Bibliothèque', cat: 'Salon', w: 1.4, d: 0.36 }, rug: { label: 'Tapis', cat: 'Salon', w: 2.4, d: 1.6 },
  plant: { label: 'Plante', cat: 'Salon', w: 0.5, d: 0.5 }, floorlamp: { label: 'Lampadaire', cat: 'Salon', w: 0.3, d: 0.3, light: { y: 1.7, name: 'Lampadaire', watts: 9 } },
  counter: { label: 'Plan de travail', cat: 'Cuisine', w: 3, d: 0.65 }, island: { label: 'Îlot', cat: 'Cuisine', w: 2.4, d: 1.0 },
  fridge: { label: 'Réfrigérateur', cat: 'Cuisine', w: 0.75, d: 0.7 }, table: { label: 'Table à manger', cat: 'Cuisine', w: 1.7, d: 0.9 },
  chair: { label: 'Chaise', cat: 'Cuisine', w: 0.42, d: 0.42 },
  bed: { label: 'Lit', cat: 'Chambre', w: 1.75, d: 2.05 }, nightstand: { label: 'Chevet + lampe', cat: 'Chambre', w: 0.44, d: 0.4, light: { y: 1.0, name: 'Lampe de chevet', watts: 6 } },
  wardrobe: { label: 'Armoire', cat: 'Chambre', w: 1.6, d: 0.6 }, desk: { label: 'Bureau', cat: 'Chambre', w: 1.2, d: 0.6 },
  shower: { label: 'Douche', cat: 'Salle de bain', w: 1.0, d: 1.0 }, bathtub: { label: 'Baignoire', cat: 'Salle de bain', w: 1.7, d: 0.75 },
  vanity: { label: 'Vasque', cat: 'Salle de bain', w: 1.2, d: 0.5 }, toilet: { label: 'WC', cat: 'Salle de bain', w: 0.4, d: 0.55 },
  washer: { label: 'Lave-linge', cat: 'Salle de bain', w: 0.6, d: 0.6 },
  car: { label: 'Voiture', cat: 'Garage', w: 1.92, d: 4.5 }, charger: { label: 'Borne de recharge', cat: 'Garage', w: 0.3, d: 0.12 },
  tree: { label: 'Arbre', cat: 'Jardin', w: 1.6, d: 1.6 }, bush: { label: 'Buisson', cat: 'Jardin', w: 1.1, d: 1.0 },
  lounger: { label: 'Transat', cat: 'Jardin', w: 0.7, d: 1.9 }, postlamp: { label: 'Borne lumineuse', cat: 'Jardin', w: 0.2, d: 0.2, light: { y: 0.9, name: 'Borne extérieure', watts: 8 } },
};
