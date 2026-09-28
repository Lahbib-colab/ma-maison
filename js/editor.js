// ---------------------------------------------------------------------------
// Éditeur de plan : dessine pièces, portes/fenêtres, meubles, sols extérieurs
// et appareils sur un plan 2D ; la maison 3D (au-dessus) se reconstruit en
// direct depuis les mêmes données. Même design que l'application.
// ---------------------------------------------------------------------------
import { computeWalls, FURN_INFO, GROUND } from './world.js';
import * as P from './plan.js';
import { icon } from './icons.js';
import { esc, toast } from './dom.js';
import { DEVICE_TYPES } from './catalog.js';

const FLOORS_IN = [['wood', 'Parquet'], ['tile', 'Carrelage'], ['concrete', 'Béton']];
const FLOORS_OUT = [['deck', 'Terrasse'], ['concrete', 'Béton'], ['grass', 'Pelouse'], ['water', 'Piscine']];
const FILL = { wood: '#8a6a48', tile: '#8c95a3', concrete: '#666c76', deck: '#8a6a44', grass: '#23532f', water: '#1f78b4' };
const GFILL = { stone: '#6b7280', driveway: '#454a54', deck: '#8a6a44', gravel: '#8b877c' };
const ICONS = ['sofa', 'utensils', 'bed', 'drop', 'car', 'home', 'leaf', 'waves'];
const PRIMARY = [['light', 'Éclairage'], ['temp', 'Température'], ['humidity', 'Humidité'], ['garage', 'Porte de garage'], ['pool', 'Température eau']];
const SNAPS = [[0.05, '5 cm'], [0.1, '10 cm'], [0.25, '25 cm'], [0, 'Libre']];
const OPEN_KINDS = ['door', 'frontdoor', 'window', 'glass', 'garage'];
const fm = (v) => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');
const rad = (d) => (d * Math.PI) / 180;

export function createEditor(ctx) {
  const { store } = ctx;
  const S = () => store.state;
  const ed = {
    open: false, tool: 'select', sel: null, snap: 0.1, layers: { dev: true, furn: true }, no3d: false,
    openKind: 'window', furnType: 'sofa', groundKind: 'stone', hist: [], redo: [], walls: [], drag: null, drawing: null, draw: 0, rebuildT: 0,
    view: { x: 0, y: 0, s: 30 }, bgImg: null, bgSrc: '',
  };
  let el = null, cv = null, g = null, home = null;
  const $e = (s) => el.querySelector(s);

  // ------------------------------------------------------------ coordonnées
  const V = ed.view;
  const w2s = (x, z) => [V.x + x * V.s, V.y + z * V.s];
  const s2w = (px, py) => [(px - V.x) / V.s, (py - V.y) / V.s];
  function fit() {
    const rs = S().rooms.filter((r) => r.id !== 'jardin'); let x1 = 1e9, z1 = 1e9, x2 = -1e9, z2 = -1e9;
    (rs.length ? rs : S().rooms).forEach((r) => { x1 = Math.min(x1, r.rect[0]); z1 = Math.min(z1, r.rect[1]); x2 = Math.max(x2, r.rect[2]); z2 = Math.max(z2, r.rect[3]); });
    if (x1 > x2) { x1 = 0; z1 = 0; x2 = 8; z2 = 8; }
    const w = cv.clientWidth || 300, h = cv.clientHeight || 300;
    V.s = Math.max(6, Math.min(80, Math.min(w / (x2 - x1 + 3), h / (z2 - z1 + 3))));
    V.x = w / 2 - ((x1 + x2) / 2) * V.s; V.y = h / 2 - ((z1 + z2) / 2) * V.s; requestDraw();
  }

  // ------------------------------------------------------------- historique
  const snapshot = () => JSON.stringify({ rooms: S().rooms, layout: S().layout, devices: S().devices });
  function pushHist() { ed.hist.push(snapshot()); if (ed.hist.length > 60) ed.hist.shift(); ed.redo = []; updateTop(); }
  function restore(json) { store.replacePlan(JSON.parse(json)); ed.sel = null; refreshWalls(); renderAll(); }
  function undo() { if (!ed.hist.length) return; ed.redo.push(snapshot()); restore(ed.hist.pop()); }
  function redo() { if (!ed.redo.length) return; ed.hist.push(snapshot()); restore(ed.redo.pop()); }

  function refreshWalls() { ed.walls = computeWalls(S().rooms); }
  // fin d'une modification : recale, valide, sauvegarde, reconstruit la 3D et l'app
  function commit() {
    const s = S(); P.fitGarden(s); P.reconcileOpenings(s); P.syncOwnership(s);
    refreshWalls(); store.planChanged('rooms'); renderAll();
  }
  function liveRebuild() {
    refreshWalls(); requestDraw();
    if (ed.rebuildT) return;
    ed.rebuildT = setTimeout(() => { ed.rebuildT = 0; P.fitGarden(S()); if (ctx.house && ctx.house.rebuild) ctx.house.rebuild(); }, 120);
  }

  // ------------------------------------------------------------------ pick
  const segOf = (o) => {
    const w = ed.walls.find((q) => (q.orient === 'h' ? Math.abs(o.z - q.c) < 0.03 && o.x >= q.a - 0.02 && o.x <= q.b + 0.02 : Math.abs(o.x - q.c) < 0.03 && o.z >= q.a - 0.02 && o.z <= q.b + 0.02));
    const h = !w || w.orient === 'h';
    return { w, h, x1: h ? o.x - o.w / 2 : o.x, z1: h ? o.z : o.z - o.w / 2, x2: h ? o.x + o.w / 2 : o.x, z2: h ? o.z : o.z + o.w / 2 };
  };
  function distSeg(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1; let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }
  function handlePts(r) {
    const [x1, z1, x2, z2] = r.rect, mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    return { nw: [x1, z1], n: [mx, z1], ne: [x2, z1], e: [x2, mz], se: [x2, z2], s: [mx, z2], sw: [x1, z2], w: [x1, mz] };
  }
  function pick(px, py) {
    const [x, z] = s2w(px, py), s = S();
    if (ed.sel && ed.sel.kind === 'room') { const hp = handlePts(ed.sel.ref); for (const k in hp) { const [sx, sy] = w2s(hp[k][0], hp[k][1]); if (Math.hypot(px - sx, py - sy) < 17) return { kind: 'handle', h: k, ref: ed.sel.ref }; } }
    if (ed.layers.dev) for (let i = s.devices.length - 1; i >= 0; i--) { const d = s.devices[i], [sx, sy] = w2s(d.pos[0], d.pos[2]); if (Math.hypot(px - sx, py - sy) < 15) return { kind: 'dev', ref: d }; }
    for (const o of s.layout.openings) { const q = segOf(o), a = w2s(q.x1, q.z1), b = w2s(q.x2, q.z2); if (distSeg(px, py, a, b) < 13) return { kind: 'open', ref: o }; }
    if (ed.layers.furn) for (let i = s.layout.furniture.length - 1; i >= 0; i--) {
      const f = s.layout.furniture[i], fp = P.footprint(f), c = Math.cos(rad(f.r || 0)), sn = Math.sin(rad(f.r || 0)), dx = x - f.x, dz = z - f.z;
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c, m = 6 / V.s;
      if (Math.abs(lx) <= fp.w / 2 + m && Math.abs(lz) <= fp.d / 2 + m) return { kind: 'furn', ref: f };
    }
    for (const gr of s.layout.ground || []) if (P.inRect(x, z, gr.rect)) return { kind: 'ground', ref: gr };
    const cands = s.rooms.filter((r) => r.id !== 'jardin' && P.inRect(x, z, r.rect)).sort((a, b) => P.area(a) - P.area(b));
    if (cands.length) return { kind: 'room', ref: cands[0] };
    return null;
  }

  // --------------------------------------------------------------- magnétisme
  const others = (id) => S().rooms.filter((r) => r.id !== id && r.id !== 'jardin');
  function mag(v, axis, id, tol = 0.16) {
    let best = null;
    others(id).forEach((r) => { (axis === 'x' ? [r.rect[0], r.rect[2]] : [r.rect[1], r.rect[3]]).forEach((e) => { const d = Math.abs(v - e); if (d < tol && (!best || d < best.d)) best = { e, d }; }); });
    return best ? best.e : null;
  }
  const sn = (v) => P.snapv(v, ed.snap);

  // ---------------------------------------------------------------- dessin
  function requestDraw() { if (ed.draw) return; ed.draw = requestAnimationFrame(() => { ed.draw = 0; draw(); }); }
  function resizeCanvas() {
    if (!cv) return; const dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); requestDraw();
  }
  function draw() {
    if (!ed.open || !g) return; if (!g.roundRect) g.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
    const s = S(), W = cv.clientWidth, H = cv.clientHeight, sc = V.s;
    g.clearRect(0, 0, W, H); g.fillStyle = '#0a1220'; g.fillRect(0, 0, W, H);
    // fond image
    if (s.bg && ed.bgImg && ed.bgSrc === s.bg.src) {
      const bw = s.bg.w * sc, bh = bw * (ed.bgImg.naturalHeight / ed.bgImg.naturalWidth), [bx, by] = w2s(s.bg.x, s.bg.z);
      g.globalAlpha = s.bg.op; g.drawImage(ed.bgImg, bx, by, bw, bh); g.globalAlpha = 1;
      if (ed.tool === 'bg') { g.strokeStyle = '#4db2ff'; g.setLineDash([6, 4]); g.strokeRect(bx, by, bw, bh); g.setLineDash([]); }
    }
    // grille
    const step = sc >= 18 ? 1 : 5, [wx0, wz0] = s2w(0, 0), [wx1, wz1] = s2w(W, H);
    g.lineWidth = 1;
    for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) { const px = Math.round(w2s(x, 0)[0]) + 0.5; g.strokeStyle = x % 5 === 0 ? 'rgba(255,255,255,.11)' : 'rgba(255,255,255,.045)'; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); }
    for (let z = Math.floor(wz0 / step) * step; z <= wz1; z += step) { const py = Math.round(w2s(0, z)[1]) + 0.5; g.strokeStyle = z % 5 === 0 ? 'rgba(255,255,255,.11)' : 'rgba(255,255,255,.045)'; g.beginPath(); g.moveTo(0, py); g.lineTo(W, py); g.stroke(); }
    // terrain
    const jd = s.rooms.find((r) => r.id === 'jardin');
    if (jd) { const [a, b] = w2s(jd.rect[0], jd.rect[1]); g.fillStyle = 'rgba(40,120,70,.14)'; g.fillRect(a, b, (jd.rect[2] - jd.rect[0]) * sc, (jd.rect[3] - jd.rect[1]) * sc); g.setLineDash([5, 5]); g.strokeStyle = 'rgba(80,190,110,.4)'; g.strokeRect(a, b, (jd.rect[2] - jd.rect[0]) * sc, (jd.rect[3] - jd.rect[1]) * sc); g.setLineDash([]); }
    (s.layout.ground || []).forEach((q) => { const [a, b] = w2s(q.rect[0], q.rect[1]); g.fillStyle = GFILL[q.kind] || '#666'; g.globalAlpha = 0.75; g.fillRect(a, b, (q.rect[2] - q.rect[0]) * sc, (q.rect[3] - q.rect[1]) * sc); g.globalAlpha = 1; if (isSel('ground', q)) rectOutline(q.rect); });
    // pièces
    s.rooms.forEach((r) => {
      if (r.id === 'jardin') return; const [a, b] = w2s(r.rect[0], r.rect[1]), w = (r.rect[2] - r.rect[0]) * sc, h = (r.rect[3] - r.rect[1]) * sc;
      g.fillStyle = FILL[r.floor] || '#666'; g.globalAlpha = r.outdoor ? 0.6 : 0.5; g.fillRect(a, b, w, h); g.globalAlpha = 1;
      if (w > 46 && h > 30) {
        g.fillStyle = 'rgba(255,255,255,.92)'; g.textAlign = 'center'; g.font = `600 ${Math.max(10, Math.min(15, sc * 0.42))}px -apple-system, system-ui, sans-serif`; g.fillText(r.name, a + w / 2, b + h / 2 - 2);
        g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `${Math.max(9, Math.min(12, sc * 0.32))}px -apple-system, system-ui, sans-serif`; g.fillText(`${fm(P.area(r))} m²`, a + w / 2, b + h / 2 + Math.max(12, sc * 0.4));
      }
      if (r.outdoor) { g.setLineDash([4, 3]); g.strokeStyle = 'rgba(255,255,255,.55)'; g.strokeRect(a, b, w, h); g.setLineDash([]); }
    });
    // meubles
    if (ed.layers.furn) s.layout.furniture.forEach((f) => {
      const fp = P.footprint(f), [sx, sy] = w2s(f.x, f.z), selected = isSel('furn', f);
      g.save(); g.translate(sx, sy); g.rotate(-rad(f.r || 0));
      const w = fp.w * sc, d = fp.d * sc; g.fillStyle = f.t === 'tree' || f.t === 'bush' ? 'rgba(60,150,80,.55)' : f.t === 'rug' ? 'rgba(180,190,220,.2)' : 'rgba(255,255,255,.2)';
      g.strokeStyle = selected ? '#4db2ff' : 'rgba(255,255,255,.55)'; g.lineWidth = selected ? 2.5 : 1;
      if (f.t === 'tree' || f.t === 'bush' || f.t === 'postlamp' || f.t === 'plant') { g.beginPath(); g.ellipse(0, 0, w / 2, d / 2, 0, 0, 7); g.fill(); g.stroke(); }
      else { g.beginPath(); g.roundRect(-w / 2, -d / 2, w, d, Math.min(4, w / 4)); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-w * 0.25, d / 2 - 1.5); g.lineTo(w * 0.25, d / 2 - 1.5); g.strokeStyle = selected ? '#4db2ff' : 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.stroke(); }
      g.restore();
      if (w2s(0, 0) && fp.w * sc > 28) { g.fillStyle = 'rgba(255,255,255,.85)'; g.textAlign = 'center'; g.font = `500 ${Math.max(8, Math.min(11, sc * 0.28))}px -apple-system, system-ui, sans-serif`; g.fillText((FURN_INFO[f.t] || {}).label || f.t, sx, sy + 3); }
    });
    // murs
    ed.walls.forEach((w) => {
      const t = (w.ext ? 0.24 : 0.12) * sc, isH = w.orient === 'h';
      const ops = s.layout.openings.filter((o) => (isH ? Math.abs(o.z - w.c) < 0.03 && o.x >= w.a - 0.02 && o.x <= w.b + 0.02 : Math.abs(o.x - w.c) < 0.03 && o.z >= w.a - 0.02 && o.z <= w.b + 0.02)).map((o) => ({ o, p: isH ? o.x : o.z })).sort((p, q) => p.p - q.p);
      g.strokeStyle = w.ext ? '#eef1f5' : '#c3c9d3'; g.lineWidth = Math.max(w.ext ? 4 : 2.5, t); g.lineCap = 'butt';
      let cur = w.a;
      const seg = (a, b) => { if (b - a < 0.004) return; const p1 = isH ? w2s(a - (a === w.a ? (w.ext ? 0.12 : 0.06) : 0), w.c) : w2s(w.c, a - (a === w.a ? (w.ext ? 0.12 : 0.06) : 0)), p2 = isH ? w2s(b + (b === w.b ? (w.ext ? 0.12 : 0.06) : 0), w.c) : w2s(w.c, b + (b === w.b ? (w.ext ? 0.12 : 0.06) : 0)); g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke(); };
      ops.forEach(({ o, p }) => { seg(cur, p - o.w / 2); cur = p + o.w / 2; }); seg(cur, w.b);
    });
    // ouvertures
    s.layout.openings.forEach((o) => {
      const q = segOf(o), a = w2s(q.x1, q.z1), b = w2s(q.x2, q.z2), sel = isSel('open', o), tw = Math.max(5, (q.w && q.w.ext ? 0.24 : 0.12) * sc);
      g.lineCap = 'butt';
      if (o.orphan) { g.strokeStyle = '#ff453a'; g.lineWidth = 3; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]); return; }
      if (o.kind === 'window' || o.kind === 'glass') { g.strokeStyle = '#7fc0ff'; g.lineWidth = tw * 0.55; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); if (o.shutter) { g.fillStyle = '#39414d'; g.beginPath(); g.arc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 3, 0, 7); g.fill(); } }
      else if (o.kind === 'garage') { g.strokeStyle = '#b6bdc9'; g.lineWidth = tw * 0.7; g.setLineDash([7, 4]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]); }
      else { // porte : battant + arc
        const isH = q.h, side = q.w && q.w.ext ? -q.w.n : 1, r = o.w * sc; g.strokeStyle = o.kind === 'frontdoor' ? '#ffd60a' : 'rgba(255,255,255,.75)'; g.lineWidth = 1.5;
        g.beginPath(); if (isH) { g.moveTo(a[0], a[1]); g.lineTo(a[0], a[1] + side * r); g.arc(a[0], a[1], r, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0, side < 0); } else { g.moveTo(a[0], a[1]); g.lineTo(a[0] + side * r, a[1]); g.arc(a[0], a[1], r, side > 0 ? 0 : Math.PI, Math.PI / 2, side < 0); } g.stroke();
      }
      if (sel) { g.strokeStyle = '#4db2ff'; g.lineWidth = 2; g.beginPath(); g.arc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.max(10, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 5), 0, 7); g.stroke(); }
    });
    // appareils
    if (ed.layers.dev) s.devices.forEach((d) => {
      const [sx, sy] = w2s(d.pos[0], d.pos[2]), T = DEVICE_TYPES[d.type], on = T && T.isOn(d.state), sel = isSel('dev', d);
      g.beginPath(); g.arc(sx, sy, sel ? 8 : 6, 0, 7); g.fillStyle = d.type === 'light' ? (on ? '#ffd60a' : '#5a606c') : d.type === 'camera' ? '#bf5af2' : d.type === 'motion' ? '#ff9f0a' : '#0a84ff'; g.fill(); g.lineWidth = sel ? 2.5 : 1.5; g.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,.6)'; g.stroke();
    });
    // sélection de pièce + poignées + cotes
    if (ed.sel && ed.sel.kind === 'room') {
      const r = ed.sel.ref; rectOutline(r.rect);
      const hp = handlePts(r); g.fillStyle = '#fff'; g.strokeStyle = '#0a84ff'; g.lineWidth = 2;
      Object.values(hp).forEach(([x, z]) => { const [sx, sy] = w2s(x, z); g.beginPath(); g.arc(sx, sy, 7, 0, 7); g.fill(); g.stroke(); });
      g.fillStyle = '#4db2ff'; g.font = '600 12px -apple-system, system-ui, sans-serif'; g.textAlign = 'center';
      const [tx, ty] = w2s((r.rect[0] + r.rect[2]) / 2, r.rect[1]); g.fillText(`${fm(r.rect[2] - r.rect[0])} m`, tx, ty - 14);
      const [lx, ly] = w2s(r.rect[2], (r.rect[1] + r.rect[3]) / 2); g.textAlign = 'left'; g.fillText(`${fm(r.rect[3] - r.rect[1])} m`, lx + 14, ly + 4);
    }
    // aperçu de dessin
    if (ed.drawing) { const rc = ed.drawing.rect; const [a, b] = w2s(rc[0], rc[1]); g.fillStyle = 'rgba(10,132,255,.25)'; g.fillRect(a, b, (rc[2] - rc[0]) * sc, (rc[3] - rc[1]) * sc); g.strokeStyle = '#4db2ff'; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(a, b, (rc[2] - rc[0]) * sc, (rc[3] - rc[1]) * sc); g.setLineDash([]); g.fillStyle = '#fff'; g.font = '600 12px -apple-system, system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(`${fm(rc[2] - rc[0])} × ${fm(rc[3] - rc[1])} m`, a + ((rc[2] - rc[0]) * sc) / 2, b + ((rc[3] - rc[1]) * sc) / 2); }
    // échelle
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(14, H - 16); g.lineTo(14 + sc, H - 16); g.moveTo(14, H - 20); g.lineTo(14, H - 12); g.moveTo(14 + sc, H - 20); g.lineTo(14 + sc, H - 12); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '11px -apple-system, system-ui, sans-serif'; g.textAlign = 'left'; g.fillText('1 m', 14 + sc + 6, H - 12);
  }
  function rectOutline(rc) { const [a, b] = w2s(rc[0], rc[1]); g.strokeStyle = '#4db2ff'; g.lineWidth = 2.5; g.strokeRect(a, b, (rc[2] - rc[0]) * V.s, (rc[3] - rc[1]) * V.s); }
  const isSel = (k, ref) => ed.sel && ed.sel.kind === k && ed.sel.ref === ref;

  // --------------------------------------------------------------- gestes
  function bindGestures() {
    const pts = new Map(); let pinch = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId); const p = pos(e); pts.set(e.pointerId, p);
      if (pts.size === 2) { ed.drag = null; ed.drawing = null; const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; return; }
      if (pts.size > 2) return; down(p);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return; const p = pos(e), prev = pts.get(e.pointerId); pts.set(e.pointerId, p);
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const k = Math.max(0.5, Math.min(2, d / (pinch.d || 1))), [wx, wz] = s2w(pinch.m[0], pinch.m[1]); V.s = Math.max(5, Math.min(140, V.s * k)); V.x = m[0] - wx * V.s; V.y = m[1] - wz * V.s; pinch = { d, m }; requestDraw(); return;
      }
      if (pts.size === 1) move(p, [p[0] - prev[0], p[1] - prev[1]]);
    });
    const end = (e) => { if (!pts.has(e.pointerId)) return; const p = pos(e); pts.delete(e.pointerId); if (pts.size === 0) { if (pinch) pinch = null; else up(p); } else if (pts.size < 2) pinch = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch = null; ed.drag = null; ed.drawing = null; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const [px, py] = pos(e), [wx, wz] = s2w(px, py); V.s = Math.max(5, Math.min(140, V.s * Math.exp(-e.deltaY * 0.0015))); V.x = px - wx * V.s; V.y = py - wz * V.s; requestDraw(); }, { passive: false });
  }

  function down(p) {
    const [x, z] = s2w(p[0], p[1]), t = ed.tool; ed.drag = { start: p, w0: [x, z], moved: false, type: 'pan' };
    if (t === 'room' || t === 'ground') {
      let ax = sn(x), az = sn(z); if (t === 'room') { ax = mag(ax, 'x', null) ?? ax; az = mag(az, 'z', null) ?? az; }
      ed.drag.type = 'draw'; ed.drawing = { rect: [ax, az, ax, az], a: [ax, az] }; return;
    }
    if (t === 'bg') { ed.drag.type = S().bg ? 'bg' : 'pan'; ed.drag.orig = S().bg ? [S().bg.x, S().bg.z] : null; return; }
    if (t !== 'select') { ed.drag.type = 'tap'; return; }
    const hit = pick(p[0], p[1]);
    if (!hit) { if (ed.sel) { ed.sel = null; renderAll(); } return; }
    if (hit.kind !== 'handle') { ed.sel = { kind: hit.kind, ref: hit.ref }; renderInsp(); requestDraw(); }
    const D = ed.drag;
    if (hit.kind === 'handle') { D.type = 'resize'; D.h = hit.h; D.orig = hit.ref.rect.slice(); D.ref = hit.ref; }
    else if (hit.kind === 'room') { D.type = 'moveRoom'; D.ref = hit.ref; D.orig = hit.ref.rect.slice(); }
    else if (hit.kind === 'furn') { D.type = 'moveFurn'; D.ref = hit.ref; D.orig = [hit.ref.x, hit.ref.z]; }
    else if (hit.kind === 'open') { D.type = 'moveOpen'; D.ref = hit.ref; }
    else if (hit.kind === 'dev') { D.type = 'moveDev'; D.ref = hit.ref; D.orig = hit.ref.pos.slice(); }
    else if (hit.kind === 'ground') { D.type = 'moveGround'; D.ref = hit.ref; D.orig = hit.ref.rect.slice(); }
  }
  function move(p, dp) {
    const D = ed.drag; if (!D) return;
    if (!D.moved) { if (Math.hypot(p[0] - D.start[0], p[1] - D.start[1]) < 6) return; D.moved = true; if (!['pan', 'draw', 'tap'].includes(D.type)) pushHist(); }
    const [x, z] = s2w(p[0], p[1]), dx = x - D.w0[0], dz = z - D.w0[1], s = S();
    switch (D.type) {
      case 'pan': case 'tap': V.x += dp[0]; V.y += dp[1]; requestDraw(); break;
      case 'draw': { const a = ed.drawing.a; let nx = sn(x), nz = sn(z); if (ed.tool === 'room') { nx = mag(nx, 'x', null) ?? nx; nz = mag(nz, 'z', null) ?? nz; } ed.drawing.rect = [Math.min(a[0], nx), Math.min(a[1], nz), Math.max(a[0], nx), Math.max(a[1], nz)]; requestDraw(); break; }
      case 'bg': s.bg.x = P.r3(D.orig[0] + dx); s.bg.z = P.r3(D.orig[1] + dz); requestDraw(); break;
      case 'moveRoom': {
        const r = D.ref, w = D.orig[2] - D.orig[0], h = D.orig[3] - D.orig[1];
        let nx = sn(D.orig[0] + dx), nz = sn(D.orig[1] + dz);
        const mx = mag(nx, 'x', r.id) ?? (mag(nx + w, 'x', r.id) !== null ? mag(nx + w, 'x', r.id) - w : null); if (mx !== null) nx = mx;
        const mz = mag(nz, 'z', r.id) ?? (mag(nz + h, 'z', r.id) !== null ? mag(nz + h, 'z', r.id) - h : null); if (mz !== null) nz = mz;
        const test = [nx, nz, nx + w, nz + h]; if (P.findOverlap(s, r.id, test)) return;
        P.moveRoom(s, r.id, P.r3(nx - r.rect[0]), P.r3(nz - r.rect[1])); liveRebuild(); renderInsp(true); break;
      }
      case 'resize': {
        const r = D.ref; let [x1, z1, x2, z2] = D.orig; let nx = sn(x), nz = sn(z); nx = mag(nx, 'x', r.id) ?? nx; nz = mag(nz, 'z', r.id) ?? nz;
        if (D.h.includes('w')) x1 = nx; if (D.h.includes('e')) x2 = nx; if (D.h.includes('n')) z1 = nz; if (D.h.includes('s')) z2 = nz;
        if (x2 - x1 < 1 || z2 - z1 < 1) return; if (P.findOverlap(s, r.id, [x1, z1, x2, z2])) return;
        P.setRoomRect(s, r.id, [x1, z1, x2, z2]); liveRebuild(); renderInsp(true); break;
      }
      case 'moveFurn': P.moveFurniture(s, D.ref, sn(D.orig[0] + dx), sn(D.orig[1] + dz)); liveRebuild(); break;
      case 'moveOpen': if (P.moveOpeningTo(s, D.ref, x, z)) liveRebuild(); break;
      case 'moveDev': D.ref.pos = [sn(D.orig[0] + dx), D.orig[1], sn(D.orig[2] + dz)]; liveRebuild(); break;
      case 'moveGround': { const q = D.ref, w = D.orig[2] - D.orig[0], h = D.orig[3] - D.orig[1], nx = sn(D.orig[0] + dx), nz = sn(D.orig[1] + dz); q.rect = [nx, nz, P.r3(nx + w), P.r3(nz + h)]; liveRebuild(); break; }
      default: break;
    }
  }
  function up(p) {
    const D = ed.drag; ed.drag = null; if (!D) return; const [x, z] = s2w(p[0], p[1]), s = S();
    if (D.type === 'draw') {
      const rc = ed.drawing && ed.drawing.rect; ed.drawing = null;
      if (!rc || rc[2] - rc[0] < 0.8 || rc[3] - rc[1] < 0.8) { requestDraw(); if (D.moved) toast('Trop petit : minimum 0,8 m'); return; }
      if (ed.tool === 'room') {
        if (P.findOverlap(s, null, rc)) { toast('Les pièces ne peuvent pas se chevaucher'); requestDraw(); return; }
        if (s.rooms.filter((r) => r.id !== 'jardin').length >= P.MAX_ROOMS) { toast(`Maximum ${P.MAX_ROOMS} pièces`); return; }
        pushHist(); const r = P.addRoom(s, rc); ed.sel = { kind: 'room', ref: r }; ed.tool = 'select'; commit();
      } else { pushHist(); s.layout.ground.push({ rect: rc.map(P.r3), kind: ed.groundKind }); ed.sel = { kind: 'ground', ref: s.layout.ground[s.layout.ground.length - 1] }; ed.tool = 'select'; commit(); }
      return;
    }
    if (D.moved) { if (['moveRoom', 'resize', 'moveFurn', 'moveOpen', 'moveDev', 'moveGround'].includes(D.type)) commit(); else if (D.type === 'bg') { store.save(); renderInsp(); } return; }
    // simple toucher selon l'outil
    if (ed.tool === 'open') { pushHist(); const res = P.addOpening(s, ed.openKind, x, z); if (res.error) { ed.hist.pop(); updateTop(); toast(res.error); } else { commit(); toast(`${P.OPEN_DEFAULTS[ed.openKind].label} ajoutée`, 1400); } }
    else if (ed.tool === 'furn') { pushHist(); const f = P.addFurniture(s, ed.furnType, sn(x), sn(z)); ed.sel = { kind: 'furn', ref: f }; ed.tool = 'select'; commit(); }
  }

  // --------------------------------------------------------------- inspecteur
  const chip = (act, v, label, on, extra = '') => `<button class="chip ${on ? 'on' : ''}" data-e="${act}" data-v="${esc(v)}" ${extra}>${label}</button>`;
  const stepperRow = (label, key, val, unit = 'm') => `<div class="row3"><span>${label}</span><div class="stepper"><button class="round" data-e="step" data-k="${key}" data-d="-1">−</button><div class="val">${fm(val)}${unit === 'm' ? '' : unit}</div><button class="round" data-e="step" data-k="${key}" data-d="1">+</button></div></div>`;
  function renderInsp(soft) {
    const box = $e('#ed-insp'); if (!box) return;
    if (soft && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { updateNums(); return; }
    box.innerHTML = inspHTML(); box.scrollTop = 0;
    $e('#ed-hint').textContent = hintText();
  }
  function updateNums() { const r = ed.sel && ed.sel.kind === 'room' && ed.sel.ref; if (!r) return; ['x', 'z', 'w', 'd'].forEach((k) => { const i = el.querySelector(`[data-ec="rn-${k}"]`); if (i && document.activeElement !== i) i.value = ({ x: r.rect[0], z: r.rect[1], w: r.rect[2] - r.rect[0], d: r.rect[3] - r.rect[1] })[k]; }); }
  function hintText() {
    if (ed.tool === 'room') return 'Glissez pour dessiner une pièce · deux doigts pour déplacer/zoomer';
    if (ed.tool === 'open') return `Touchez un mur pour poser : ${P.OPEN_DEFAULTS[ed.openKind].label}`;
    if (ed.tool === 'furn') return `Touchez le plan pour poser : ${(FURN_INFO[ed.furnType] || {}).label}`;
    if (ed.tool === 'ground') return 'Glissez pour dessiner un sol extérieur';
    if (ed.tool === 'bg') return 'Glissez pour déplacer le fond du plan';
    return 'Touchez un élément · glissez pour le déplacer · pincez pour zoomer';
  }
  function inspHTML() {
    const s = S(), t = ed.tool, sel = ed.sel;
    if (t === 'open') return `<div class="sec-t" style="margin-top:0">Type d’ouverture</div><div class="chips">${OPEN_KINDS.map((k) => chip('okind', k, P.OPEN_DEFAULTS[k].label, ed.openKind === k)).join('')}</div><div class="hint">Touchez un mur du plan. Puis, en mode Sélection, touchez l’ouverture pour régler sa taille ou lui ajouter un volet.</div>`;
    if (t === 'ground') return `<div class="sec-t" style="margin-top:0">Type de sol</div><div class="chips">${Object.entries(GROUND).map(([k, v]) => chip('gkind', k, v.label, ed.groundKind === k)).join('')}</div><div class="hint">Glissez sur le plan pour dessiner : allée, terrasse, parking…</div>`;
    if (t === 'room') return `<div class="hint" style="margin:0">Glissez sur le plan pour tracer un rectangle. Les bords s’alignent automatiquement sur les pièces voisines : le mur mitoyen est créé tout seul.</div>`;
    if (t === 'furn') return `<div class="row3"><b>${esc((FURN_INFO[ed.furnType] || {}).label || '')}</b><button class="chip" data-e="lib">Changer</button></div><div class="hint" style="margin:0">Touchez le plan pour poser le meuble.</div>`;
    if (t === 'bg') return bgHTML();
    if (!sel) return emptyHTML();
    const r = sel.ref;
    if (sel.kind === 'room') return roomHTML(r);
    if (sel.kind === 'furn') return furnHTML(r);
    if (sel.kind === 'open') return openHTML(r);
    if (sel.kind === 'dev') return devHTML(r);
    if (sel.kind === 'ground') return `<div class="sh-head"><div><div class="cap">Sol extérieur</div><h2>${esc(GROUND[r.kind].label)}</h2></div></div><div class="chips">${Object.entries(GROUND).map(([k, v]) => chip('gsetkind', k, v.label, r.kind === k)).join('')}</div><div class="btn-row"><button class="btn danger" data-e="del">${icon('trash', 17)} Supprimer</button></div>`;
    return '';
  }
  function emptyHTML() {
    const s = S(), rooms = s.rooms.filter((r) => r.id !== 'jardin'), tot = rooms.filter((r) => !r.outdoor).reduce((a, r) => a + P.area(r), 0), iss = P.validate(s);
    return `<div class="btn-row" style="margin-top:0"><button class="btn sec" data-e="equip">${icon('bolt', 17)} Équiper les pièces</button><button class="btn sec" data-e="templates">${icon('home', 17)} Modèles</button></div>
      ${iss.length ? `<div class="ed-issues">${iss.map(esc).join('<br>')}</div>` : ''}
      <div class="hint" style="margin-top:6px">${s.layout.openings.length} ouvertures · ${s.layout.furniture.length} meubles · touchez un élément du plan pour le modifier.</div>`;
  }
  function roomHTML(r) {
    const fl = r.outdoor ? FLOORS_OUT : FLOORS_IN;
    const water = S().rooms.some((q) => q.floor === 'water' && q.id !== r.id);
    return `<div class="sh-head"><div><div class="cap">${r.outdoor ? 'Zone extérieure' : 'Pièce'} · ${fm(P.area(r))} m²</div><h2>${esc(r.name)}</h2></div></div>
      <div class="field" style="margin-top:0"><label>Nom</label><input class="inp" data-ec="rname" value="${esc(r.name)}" maxlength="28"></div>
      <div class="field"><label>Dimensions (m) — position du coin haut-gauche, largeur, profondeur</label><div class="num">${[['x', 'X', r.rect[0]], ['z', 'Z', r.rect[1]], ['w', 'Larg.', r.rect[2] - r.rect[0]], ['d', 'Prof.', r.rect[3] - r.rect[1]]].map(([k, l, v]) => `<div><label>${l}</label><input class="inp" type="number" inputmode="decimal" step="0.05" data-ec="rn-${k}" value="${P.r3(v)}"></div>`).join('')}</div></div>
      <div class="field"><label>Sol</label><div class="chips">${fl.filter(([k]) => !(k === 'water' && water)).map(([k, l]) => chip('floor', k, l, r.floor === k)).join('')}</div></div>
      <div class="field"><label>Icône</label><div class="chips">${ICONS.map((k) => chip('ricon', k, icon(k, 18), r.icon === k)).join('')}</div></div>
      <div class="field"><label>Information affichée sur la carte</label><select class="inp" data-ec="rprimary">${PRIMARY.map(([k, l]) => `<option value="${k}" ${r.primary === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="row3" style="margin-top:6px"><span>${store.devicesIn(r.id).length} appareil(s) dans cette pièce</span></div>
      <div class="btn-row"><button class="btn danger" data-e="del">${icon('trash', 17)} Supprimer la pièce</button></div>`;
  }
  function furnHTML(f) {
    const i = FURN_INFO[f.t] || { label: f.t }, sw = ['#3a4658', '#7a4b3a', '#c9c2b6', '#41537a', '#3f6b4f', '#8a3b3b'];
    return `<div class="sh-head"><div><div class="cap">${i.cat || 'Meuble'}</div><h2>${esc(i.label)}</h2></div></div>
      <div class="chips"><button class="chip" data-e="rot" data-v="-90">${icon('rotl', 16)} 90°</button><button class="chip" data-e="rot" data-v="90">${icon('rotr', 16)} 90°</button><button class="chip" data-e="rot" data-v="-15">−15°</button><button class="chip" data-e="rot" data-v="15">+15°</button><button class="chip" data-e="dup">${icon('copy', 16)} Dupliquer</button></div>
      <div class="hint" style="margin-top:6px">Rotation : ${Math.round(f.r || 0)}° · position ${fm(f.x)} ; ${fm(f.z)}${f.light ? ' · lampe reliée à un appareil « éclairage »' : ''}</div>
      ${f.t === 'rug' ? stepperRow('Largeur', 'w', f.w) + stepperRow('Profondeur', 'd', f.d) : ''}${f.t === 'counter' ? stepperRow('Longueur', 'len', f.len || 3) : ''}
      ${f.t === 'bed' ? `<div class="chips" style="margin-top:8px">${chip('bedsize', 'double', 'Lit double', !f.single)}${chip('bedsize', 'single', 'Lit simple', !!f.single)}</div>` : ''}
      ${f.t === 'rug' || f.t === 'bed' ? `<div class="chips" style="margin-top:8px">${sw.map((c) => `<button class="chip ${f.c === c ? 'on' : ''}" data-e="color" data-v="${c}" style="padding:0;width:34px;height:34px;justify-content:center"><span style="width:18px;height:18px;border-radius:50%;background:${c};display:block"></span></button>`).join('')}</div>` : ''}
      <div class="btn-row"><button class="btn danger" data-e="del">${icon('trash', 17)} Supprimer</button></div>`;
  }
  function openHTML(o) {
    const d = P.OPEN_DEFAULTS[o.kind], win = o.kind === 'window' || o.kind === 'glass';
    return `<div class="sh-head"><div><div class="cap">Ouverture${o.orphan ? ' · hors mur !' : ''}</div><h2>${esc(d.label)}</h2></div></div>
      <div class="chips">${OPEN_KINDS.map((k) => chip('osetkind', k, P.OPEN_DEFAULTS[k].label, o.kind === k)).join('')}</div>
      ${stepperRow('Largeur', 'ow', o.w)}${stepperRow('Hauteur', 'oh', o.h)}${win ? stepperRow('Allège (bas)', 'osill', o.sill || 0) : ''}
      ${win ? `<div class="row3"><span>Volet roulant motorisé</span><button class="sw ${o.shutter ? 'on' : ''}" data-e="shutter" role="switch"></button></div>` : ''}
      <div class="hint">Glissez l’ouverture le long du mur pour la déplacer. Elle reste collée au mur.</div>
      <div class="btn-row"><button class="btn danger" data-e="del">${icon('trash', 17)} Supprimer</button></div>`;
  }
  function devHTML(d) {
    const T = DEVICE_TYPES[d.type], r = store.room(d.roomId);
    return `<div class="sh-head"><div><div class="cap">${esc(T.label)} · ${esc(r ? r.name : '—')}</div><h2>${esc(d.name)}</h2></div></div>
      ${stepperRow('Hauteur du repère', 'dy', d.pos[1])}
      <div class="hint">Glissez l’appareil sur le plan : il apparaît au même endroit dans la maison 3D (les lumières éclairent la pièce à cette position).</div>
      <div class="btn-row"><button class="btn danger" data-e="del">${icon('trash', 17)} Supprimer l’appareil</button></div>`;
  }
  function bgHTML() {
    const b = S().bg;
    if (!b) return `<div class="hint" style="margin:0 0 10px">Importez une photo ou un plan de votre vraie maison, calez-le à l’échelle, puis tracez les pièces par-dessus.</div><div class="btn-row" style="margin-top:0"><button class="btn" data-e="bgpick">${icon('image', 18)} Choisir une image</button></div>`;
    return `<div class="sec-t" style="margin-top:0">Plan de fond</div>
      <div class="field" style="margin-top:0"><label>Largeur réelle de l’image (mètres)</label><input class="inp" type="number" inputmode="decimal" step="0.1" min="1" data-ec="bgw" value="${b.w}"></div>
      <div class="field"><label>Opacité</label><input class="rng" type="range" min="0.1" max="1" step="0.05" value="${b.op}" data-ei="bgop" style="--c:var(--blue);--p:${((b.op - 0.1) / 0.9) * 100}%"></div>
      <div class="btn-row"><button class="btn sec" data-e="bgpick">Changer</button><button class="btn danger" data-e="bgdel">Retirer</button></div>
      <div class="hint">Glissez sur le plan pour déplacer l’image. Astuce : mesurez une longueur connue (ex. un mur) et ajustez la largeur jusqu’à ce que les dimensions correspondent.</div>`;
  }

  // --------------------------------------------------------------- actions
  function applySel(fn, { push = true } = {}) { if (push) pushHist(); fn(); commit(); }
  function setRoomRectChecked(r, rect) {
    if (rect[2] - rect[0] < 1 || rect[3] - rect[1] < 1) { toast('Dimension minimale : 1 m'); renderInsp(); return; }
    if (P.findOverlap(S(), r.id, rect)) { toast('Chevauche une autre pièce'); renderInsp(); return; }
    applySel(() => { P.setRoomRect(S(), r.id, rect); });
  }
  const actions = {
    close: () => close(), undo, redo, fit,
    zoomin: () => { zoomBy(1.3); }, zoomout: () => { zoomBy(1 / 1.3); },
    tool: (b) => { $e('#ed-modal').hidden = true; ed.tool = b.dataset.v; ed.drawing = null; if (ed.tool !== 'select') ed.sel = null; if (ed.tool === 'furn' && b.dataset.lib !== 'skip') { openLib(); } if (ed.tool === 'bg' && !S().bg) { /* inspecteur propose l'import */ } renderAll(); },
    snap: (b) => { ed.snap = +b.dataset.v; renderAll(); openMore(); },
    layer: (b) => { ed.layers[b.dataset.v] = !ed.layers[b.dataset.v]; renderAll(); if (!$e('#ed-modal').hidden) openMore(); },
    toggle3d: () => { ed.no3d = !ed.no3d; el.classList.toggle('no3d', ed.no3d); requestAnimationFrame(() => { resizeCanvas(); fit(); if (!ed.no3d && ctx.house) ctx.house.resize(); }); renderAll(); },
    okind: (b) => { ed.openKind = b.dataset.v; renderAll(); },
    gkind: (b) => { ed.groundKind = b.dataset.v; renderAll(); },
    gsetkind: (b) => applySel(() => { ed.sel.ref.kind = b.dataset.v; }),
    floor: (b) => applySel(() => { const r = ed.sel.ref; r.floor = b.dataset.v; }),
    ricon: (b) => applySel(() => { ed.sel.ref.icon = b.dataset.v; }),
    rot: (b) => applySel(() => { const f = ed.sel.ref; f.r = ((Math.round(((f.r || 0) + +b.dataset.v) * 100) / 100 + 540) % 360) - 180; if (f.r === -180) f.r = 180; }),
    dup: () => applySel(() => { ed.sel.ref = P.cloneFurniture(S(), ed.sel.ref); }),
    color: (b) => applySel(() => { ed.sel.ref.c = b.dataset.v; }),
    bedsize: (b) => applySel(() => { ed.sel.ref.single = b.dataset.v === 'single'; }),
    osetkind: (b) => applySel(() => { const o = ed.sel.ref, d = P.OPEN_DEFAULTS[b.dataset.v]; o.kind = b.dataset.v; o.w = d.w; o.h = d.h; if (d.sill !== undefined) o.sill = d.sill; else delete o.sill; if (b.dataset.v === 'garage' && !o.device) { const nw = P.nearestWall(S(), o.x, o.z, 0.3); const rm = nw && P.wallRoom(S(), nw.wall); if (rm) o.device = P.newDevice(S(), { roomId: rm.id, type: 'garage', name: 'Porte de garage', pos: [o.x, 2, o.z] }).id; } }),
    shutter: () => applySel(() => { const o = ed.sel.ref; P.setShutter(S(), o, !o.shutter); }),
    step: (b) => {
      const k = b.dataset.k, dl = +b.dataset.d, r = ed.sel && ed.sel.ref; if (!r) return;
      applySel(() => {
        if (k === 'w' || k === 'd') r[k] = Math.max(0.3, P.r3((r[k] || 1) + dl * 0.1));
        else if (k === 'len') r.len = Math.max(0.6, P.r3((r.len || 3) + dl * 0.1));
        else if (k === 'ow') { r.w = Math.max(0.4, P.r3(r.w + dl * 0.1)); }
        else if (k === 'oh') r.h = Math.max(0.4, Math.min(2.5, P.r3(r.h + dl * 0.1)));
        else if (k === 'osill') r.sill = Math.max(0, Math.min(2, P.r3((r.sill || 0) + dl * 0.1)));
        else if (k === 'dy') r.pos = [r.pos[0], Math.max(-0.5, Math.min(3, P.r3(r.pos[1] + dl * 0.1))), r.pos[2]];
      });
    },
    del: () => {
      const { kind, ref } = ed.sel, s = S();
      if (kind === 'room') { const n = store.devicesIn(ref.id).length; ctx.confirm(`Supprimer « ${ref.name} »${n ? ` et ses ${n} appareil(s)` : ''} ?`, 'Supprimer', () => applySel(() => { P.deleteRoom(s, ref.id); ed.sel = null; })); return; }
      applySel(() => {
        if (kind === 'furn') P.removeFurniture(s, ref); else if (kind === 'open') P.removeOpening(s, ref);
        else if (kind === 'ground') s.layout.ground = s.layout.ground.filter((q) => q !== ref); else if (kind === 'dev') { s.devices = s.devices.filter((q) => q !== ref); s.layout.furniture.forEach((f) => { if (f.light === ref.id) delete f.light; }); s.layout.openings.forEach((o) => { if (o.shutter === ref.id) delete o.shutter; if (o.device === ref.id) delete o.device; }); }
        ed.sel = null;
      });
    },
    equip: () => { $e('#ed-modal').hidden = true; pushHist(); const n = P.autoEquip(S()); commit(); toast(n ? `${n} appareil(s) ajouté(s)` : 'Toutes les pièces sont déjà équipées'); },
    lib: () => openLib(), templates: () => openTemplates(), more: () => openMore(),
    modalclose: () => { $e('#ed-modal').hidden = true; },
    pickfurn: (b) => { ed.furnType = b.dataset.v; ed.tool = 'furn'; $e('#ed-modal').hidden = true; renderAll(); },
    tpl: (b) => {
      const k = b.dataset.v, make = { blank: P.blankPlan, t2: P.t2Plan, villa: P.villaPlan }[k];
      ctx.confirm('Remplacer le plan actuel par ce modèle ? (annulable avec ↶)', 'Remplacer', () => { pushHist(); store.replacePlan(make()); P.fitGarden(S()); ed.sel = null; $e('#ed-modal').hidden = true; refreshWalls(); commit(); fit(); });
    },
    bgpick: () => $e('#ed-file').click(),
    bgdel: () => { delete S().bg; ed.bgImg = null; store.save(); renderAll(); },
    endinsp: () => {},
  };
  function zoomBy(k) { const W = cv.clientWidth / 2, H = cv.clientHeight / 2, [wx, wz] = s2w(W, H); V.s = Math.max(5, Math.min(140, V.s * k)); V.x = W - wx * V.s; V.y = H - wz * V.s; requestDraw(); }
  function openLib() {
    const cats = [...new Set(Object.values(FURN_INFO).map((i) => i.cat))], m = $e('#ed-modal');
    m.innerHTML = `<div class="ed-modal-in"><div class="sh-head"><div><div class="cap">Bibliothèque</div><h2>Ajouter un meuble</h2></div><button class="close" data-e="modalclose">${icon('x', 16)}</button></div>${cats.map((c) => `<div class="sec-t">${c}</div><div class="lib">${Object.entries(FURN_INFO).filter(([, i]) => i.cat === c).map(([k, i]) => `<button data-e="pickfurn" data-v="${k}" class="${ed.furnType === k ? 'on' : ''}">${esc(i.label)}</button>`).join('')}</div>`).join('')}</div>`;
    m.hidden = false;
  }
  function openTemplates() {
    $e('#ed-modal').innerHTML = `<div class="ed-modal-in"><div class="sh-head"><div><div class="cap">Modèles</div><h2>Partir d’un plan</h2></div><button class="close" data-e="modalclose">${icon('x', 16)}</button></div>
      <button class="tpl" data-e="tpl" data-v="blank"><span class="ri" style="width:42px;height:42px;border-radius:14px;background:rgba(255,255,255,.1);display:grid;place-items:center">${icon('plus', 20)}</span><span><b>Plan vide</b><small>Une pièce à agrandir et à compléter</small></span></button>
      <button class="tpl" data-e="tpl" data-v="t2"><span class="ri" style="width:42px;height:42px;border-radius:14px;background:rgba(255,255,255,.1);display:grid;place-items:center">${icon('grid', 20)}</span><span><b>Appartement T2</b><small>5 pièces, meublé et équipé (≈ 60 m²)</small></span></button>
      <button class="tpl" data-e="tpl" data-v="villa"><span class="ri" style="width:42px;height:42px;border-radius:14px;background:rgba(255,255,255,.1);display:grid;place-items:center">${icon('home', 20)}</span><span><b>Villa avec piscine</b><small>Le plan d’exemple d’origine</small></span></button>
      <div class="hint">Les scénarios et automatisations sont conservés. Les appareils sont remplacés par ceux du modèle.</div></div>`;
    $e('#ed-modal').hidden = false;
  }
  function openMore() {
    $e('#ed-modal').innerHTML = `<div class="ed-modal-in"><div class="sh-head"><div><div class="cap">Plan</div><h2>Options</h2></div><button class="close" data-e="modalclose">${icon('x', 16)}</button></div>
      <div class="sec-t" style="margin-top:0">Magnétisme</div><div class="chips">${SNAPS.map(([v, l]) => chip('snap', v, l, ed.snap === v)).join('')}</div>
      <div class="sec-t">Calques</div><div class="chips">${chip('layer', 'furn', 'Meubles', ed.layers.furn)}${chip('layer', 'dev', 'Appareils', ed.layers.dev)}</div>
      <div class="sec-t">Actions</div><div class="list">
        <div class="row" data-e="equip" role="button"><div class="ri">${icon('bolt', 18)}</div><div class="rt"><b>Équiper les pièces</b><small>Ajoute lumière + thermostat aux pièces qui n’en ont pas</small></div></div>
        <div class="row" data-e="templates" role="button"><div class="ri">${icon('home', 18)}</div><div class="rt"><b>Modèles de plans</b><small>Plan vide, T2, villa</small></div></div>
        <div class="row" data-e="tool" data-v="bg" role="button"><div class="ri">${icon('image', 18)}</div><div class="rt"><b>Plan de fond (image)</b><small>Calquer une vraie maison</small></div></div></div></div>`;
    $e('#ed-modal').hidden = false;
  }

  // ------------------------------------------------------------ rendu UI
  function updateTop() {
    if (!el) return; $e('[data-e=undo]').disabled = !ed.hist.length; $e('[data-e=redo]').disabled = !ed.redo.length;
    const s = S(), rooms = s.rooms.filter((r) => r.id !== 'jardin'), tot = rooms.filter((r) => !r.outdoor).reduce((a, r) => a + P.area(r), 0);
    $e('#ed-sub').textContent = `${rooms.length} pièces · ${fm(tot).replace(',00', '')} m² · ${s.devices.length} appareils`;
  }
  function renderTools() {
    const T = (k, ic, label) => `<button class="tool ${ed.tool === k ? 'on' : ''}" data-e="tool" data-v="${k}">${icon(ic, 17)}<span>${label}</span></button>`;
    $e('#ed-tools').innerHTML = `${T('select', 'cursor', 'Sélection')}${T('room', 'room', 'Pièce')}${T('open', 'door', 'Porte / fenêtre')}${T('furn', 'sofa', 'Meuble')}${T('ground', 'path', 'Sol ext.')}${T('bg', 'image', 'Fond')}<span class="tool sep"></span>
      <button class="tool ${ed.layers.dev ? 'on' : ''}" data-e="layer" data-v="dev">${icon('bulb', 17)}<span>Appareils</span></button><button class="tool" data-e="more">${icon('sliders', 17)}<span>${ed.snap ? `Grille ${ed.snap * 100} cm` : 'Grille libre'}</span></button><button class="tool ${ed.no3d ? '' : 'on'}" data-e="toggle3d">${icon('cube', 17)}<span>3D</span></button>`;
  }
  function renderAll() { if (!el) return; updateTop(); renderTools(); renderInsp(); requestDraw(); }

  // ---------------------------------------------------------- image de fond
  function importImage(file) {
    if (!file) return; const rd = new FileReader();
    rd.onload = () => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, 1400 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        const src = c.toDataURL('image/jpeg', 0.72), old = S().bg;
        S().bg = { src, w: old ? old.w : 12, x: old ? old.x : 0, z: old ? old.z : 0, op: old ? old.op : 0.5 };
        ed.bgImg = null; loadBg(); store.save(); ed.tool = 'bg'; renderAll(); toast('Plan de fond ajouté : réglez sa largeur réelle');
      };
      im.src = rd.result;
    };
    rd.readAsDataURL(file);
  }
  function loadBg() { const b = S().bg; if (!b) { ed.bgImg = null; return; } if (ed.bgSrc === b.src && ed.bgImg) return; const im = new Image(); im.onload = () => { ed.bgImg = im; ed.bgSrc = b.src; requestDraw(); }; im.src = b.src; }

  // ------------------------------------------------------------ ouverture
  function build() {
    el = document.createElement('div'); el.id = 'editor'; el.className = 'editor';
    el.innerHTML = `<div class="ed-top"><button class="round" data-e="close" aria-label="Fermer l’éditeur">${icon('back', 20)}</button>
      <div class="ed-title"><b>Éditeur de plan</b><small id="ed-sub"></small></div>
      <div class="ed-top-r"><button class="round" data-e="undo" aria-label="Annuler">${icon('undo', 18)}</button><button class="round" data-e="redo" aria-label="Rétablir">${icon('redo', 18)}</button></div></div>
      <div class="ed-body"><div class="ed-prev" id="ed-prev"></div>
        <div class="ed-work"><div class="ed-tools" id="ed-tools"></div>
          <div class="ed-cwrap"><canvas id="ed-canvas"></canvas><div class="ed-hint" id="ed-hint"></div><div class="ed-zoom"><button class="round" data-e="zoomin" aria-label="Zoom +">${icon('plus', 16)}</button><button class="round" data-e="zoomout" aria-label="Zoom −"><span style="font-size:22px;line-height:1">−</span></button><button class="round" data-e="fit" aria-label="Recentrer">${icon('fit', 16)}</button></div></div>
          <div class="ed-insp panel" id="ed-insp" style="margin:8px 8px 0;border-radius:22px 22px 0 0;padding-top:12px"></div></div></div>
      <div class="ed-modal" id="ed-modal" hidden></div><input type="file" id="ed-file" accept="image/*" hidden>`;
    document.body.appendChild(el); cv = $e('#ed-canvas'); g = cv.getContext('2d');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-e]'); if (b) { const f = actions[b.dataset.e]; if (f) f(b, e); return; }
      if (e.target.id === 'ed-modal') $e('#ed-modal').hidden = true;
    });
    el.addEventListener('change', (e) => {
      const t = e.target.closest('[data-ec]'), s = S(); if (!t) { if (e.target.id === 'ed-file') importImage(e.target.files[0]); return; }
      const k = t.dataset.ec, r = ed.sel && ed.sel.ref;
      if (k === 'rname' && r) { if (t.value.trim()) applySel(() => { r.name = t.value.trim(); }); }
      else if (k === 'rprimary' && r) applySel(() => { r.primary = t.value; });
      else if (k.startsWith('rn-') && r) {
        const v = parseFloat(t.value); if (!Number.isFinite(v)) { renderInsp(); return; }
        const [x1, z1, x2, z2] = r.rect, w = x2 - x1, d = z2 - z1, n = { 'rn-x': [v, z1, v + w, z2], 'rn-z': [x1, v, x2, v + d], 'rn-w': [x1, z1, x1 + v, z2], 'rn-d': [x1, z1, x2, z1 + v] }[k];
        if (k === 'rn-x' || k === 'rn-z') { if (P.findOverlap(s, r.id, n)) { toast('Chevauche une autre pièce'); renderInsp(); return; } applySel(() => { P.moveRoom(s, r.id, n[0] - x1, n[1] - z1); }); }
        else setRoomRectChecked(r, n);
      } else if (k === 'bgw' && s.bg) { const v = parseFloat(t.value); if (v >= 1) { s.bg.w = v; store.save(); requestDraw(); } }
    });
    el.addEventListener('input', (e) => { const t = e.target.closest('[data-ei]'); if (t && t.dataset.ei === 'bgop' && S().bg) { S().bg.op = parseFloat(t.value); t.style.setProperty('--p', `${((t.value - 0.1) / 0.9) * 100}%`); requestDraw(); } });
    el.addEventListener('pointerup', (e) => { if (e.target.dataset && e.target.dataset.ei === 'bgop') store.save(); });
    bindGestures();
    new ResizeObserver(() => { resizeCanvas(); }).observe(cv);
  }
  function openEd() {
    if (ed.open) return; ctx.closeSheets && ctx.closeSheets();
    if (!el) build(); el.hidden = false; ed.open = true; ed.hist = []; ed.redo = []; ed.sel = null; ed.tool = 'select'; ed.no3d = false; el.classList.remove('no3d');
    const wrap = document.querySelector('.stage-wrap'); home = { parent: wrap.parentNode, next: wrap.nextSibling, wrap };
    $e('#ed-prev').appendChild(wrap); wrap.classList.add('editing');
    refreshWalls(); loadBg(); renderAll();
    const h = ctx.house; if (h) { h.setActive(true); h.select && h.selId && h.select(null); if (h.setMarkers) h.setMarkers([]); }
    requestAnimationFrame(() => requestAnimationFrame(() => { resizeCanvas(); fit(); if (h) { h.userMoved = false; h.resize(); h.resetView && h.resetView(); } }));
  }
  function close() {
    if (!ed.open) return; ed.open = false; if (ed.rebuildT) { clearTimeout(ed.rebuildT); ed.rebuildT = 0; }
    const s = S(); P.fitGarden(s); P.reconcileOpenings(s); P.syncOwnership(s); store.planChanged('rooms');
    if (home) { home.wrap.classList.remove('editing'); home.parent.insertBefore(home.wrap, home.next); home = null; }
    el.remove(); el = null; cv = null; g = null;
    const h = ctx.house; if (h) { h.setActive(ctx.currentTab() === 'home'); requestAnimationFrame(() => { h.userMoved = false; h.resize(); h.resetView && h.resetView(); }); }
    if (ctx.nav) ctx.nav(ctx.currentTab());
  }
  return { open: openEd, close, isOpen: () => ed.open, view: ed.view };
}
