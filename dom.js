// Utilitaires DOM : échappement, toast, gestionnaire de feuilles, liaisons live.
import { fmtTemp, fmtPower, DEVICE_TYPES } from './catalog.js';
import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

// ------------------------------------------------------------------ toast
let toastTimer = 0;
export function toast(msg, ms = 2400) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// -------------------------------------------------------- liaisons "live"
// <span data-live="temp:salon"> est mis à jour chaque seconde sans recréer le DOM.
export function makeLive(store) {
  const LIVE = {
    avgTemp: () => { const m = store.metrics(); return m.avgTemp == null ? '—' : fmtTemp(m.avgTemp); },
    lights: () => { const m = store.metrics(); return `${m.lightsOn} allumée${m.lightsOn > 1 ? 's' : ''}`; },
    security: () => store.metrics().security.text,
    power: () => fmtPower(store.powerW()),
    kw: () => (store.powerW() / 1000).toFixed(2).replace('.', ','),
    today: () => store.energyToday().toFixed(1).replace('.', ','),
    cost: () => (store.energyToday() * store.state.settings.energyPrice).toFixed(2).replace('.', ','),
    temp: (a) => { const t = store.roomTemp(a); return t == null ? '—' : fmtTemp(t); },
    hum: (a) => { const d = store.devicesIn(a).find((x) => x.type === 'temp'); return d ? `${Math.round(d.state.humidity)} %` : '—'; },
    roomsum: (a) => { const r = store.room(a); return r ? store.roomSummary(r).text : ''; },
    sum: (a) => { const d = store.device(a); return d ? DEVICE_TYPES[d.type].summary(d.state, d.props) : ''; },
    cur: (a) => { const d = store.device(a); return d ? fmtTemp(d.state.current) : ''; },
    poolt: (a) => { const d = store.device(a); return d ? fmtTemp(d.state.temperature) : ''; },
    devpow: (a) => { const d = store.device(a); return d ? `${Math.round(DEVICE_TYPES[d.type].power(d.state, d.props || {}))} W` : ''; },
    roompow: (a) => fmtPower(store.roomPower(a)),
    garage: (a) => { const d = store.device(a); return d ? `${Math.round(d.state.position)} %` : ''; },
  };
  return function apply(root = document) {
    root.querySelectorAll('[data-live]').forEach((el) => {
      const [k, a] = el.dataset.live.split(':');
      const fn = LIVE[k]; if (!fn) return;
      let v = ''; try { v = fn(a); } catch (e) { v = ''; }
      if (el.textContent !== v) { el.textContent = v; if (el.dataset.flash !== undefined) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }
    });
  };
}

// ------------------------------------------------------ feuilles (sheets)
// show({ id, dock, render, actions, inputs, onClose }) — même id : contenu remplacé
// sans animation ; id différent : le contenu bascule dans la feuille ouverte.
export const sheets = (() => {
  const layer = () => $('#sheet-layer');
  let cur = null, busy = 0;

  function bind(s) {
    const inner = s.el.querySelector('.sheet-in');
    inner.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]'); if (!t || !inner.contains(t)) return;
      const fn = cur && cur.actions && cur.actions[t.dataset.act]; if (fn) fn(t, e);
    });
    const onInput = (e) => {
      const t = e.target.closest('[data-input]'); if (!t) return;
      const fn = cur && cur.inputs && cur.inputs[t.dataset.input]; if (fn) fn(t.type === 'checkbox' ? t.checked : t.value, t, e);
    };
    inner.addEventListener('input', onInput); inner.addEventListener('change', (e) => { const t = e.target.closest('[data-change]'); if (t && cur.inputs && cur.inputs[t.dataset.change]) cur.inputs[t.dataset.change](t.value, t, e); });
    // suspendre les re-rendus pendant qu'un curseur est manipulé
    inner.addEventListener('pointerdown', (e) => { if (e.target.closest('input[type=range]')) busy = 1; });
    const rel = () => { if (busy) { busy = 0; if (cur && cur.afterBusy) cur.afterBusy(); } };
    window.addEventListener('pointerup', rel); window.addEventListener('pointercancel', rel);
    // glisser vers le bas pour fermer
    let y0 = null, dy = 0;
    const handle = s.el.querySelector('.grab');
    handle.addEventListener('pointerdown', (e) => { y0 = e.clientY; dy = 0; handle.setPointerCapture(e.pointerId); s.el.style.transition = 'none'; });
    handle.addEventListener('pointermove', (e) => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); s.el.style.transform = s.dockOrDesktop(dy); });
    const up = () => { if (y0 === null) return; y0 = null; s.el.style.transition = ''; s.el.style.transform = ''; if (dy > 90) api.close(); dy = 0; };
    handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  }

  const api = {
    get current() { return cur; },
    get busy() { return !!busy; },
    show(o) {
      if (!cur) {
        const bd = document.createElement('div'); bd.className = 'backdrop';
        const el = document.createElement('div'); el.className = 'sheet';
        el.setAttribute('role', 'dialog');
        el.innerHTML = '<div class="grab"></div><div class="sheet-in"></div>';
        layer().append(bd, el);
        cur = { el, bd, dockOrDesktop: (dy) => (matchMedia('(min-width:900px)').matches ? `translate(-50%, ${dy}px)` : `translateY(${dy}px)`) };
        bd.addEventListener('click', () => api.close());
        bind(cur);
        requestAnimationFrame(() => { el.classList.add('open'); bd.classList.toggle('open', !o.dock); });
      }
      Object.assign(cur, { id: o.id, render: o.render, actions: o.actions, inputs: o.inputs, onClose: o.onClose, afterBusy: o.afterBusy, dock: !!o.dock });
      cur.el.classList.toggle('dock', !!o.dock);
      cur.bd.classList.toggle('open', !o.dock); cur.bd.style.pointerEvents = o.dock ? 'none' : '';
      api.rerender(true);
    },
    rerender(force) {
      if (!cur || (busy && !force)) return;
      const inner = cur.el.querySelector('.sheet-in'), top = inner.scrollTop;
      inner.innerHTML = cur.render(); inner.scrollTop = top;
      inner.querySelectorAll('.rng').forEach((r) => r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`));
    },
    isOpen: (id) => !!cur && (!id || cur.id === id),
    close() {
      if (!cur) return; const c = cur; cur = null; busy = 0;
      c.el.classList.remove('open'); c.bd.classList.remove('open');
      setTimeout(() => { c.el.remove(); c.bd.remove(); }, 460);
      if (c.onClose) c.onClose();
    },
  };
  return api;
})();

// --------------------------------------------------- petits gabarits HTML
export const sw = (on, act, id, extra = '') => `<button class="sw ${on ? 'on' : ''}" role="switch" aria-checked="${!!on}" data-act="${act}" data-id="${esc(id)}" ${extra}></button>`;
export const rangeHTML = (o) => `<input class="rng" type="range" min="${o.min}" max="${o.max}" step="${o.step || 1}" value="${o.value}" data-input="${o.name}" ${o.id ? `data-id="${esc(o.id)}"` : ''} style="--c:${o.color || 'var(--yellow)'}" aria-label="${esc(o.label || '')}">`;
export const head = (cap, title, closeAct = 'close') => `<div class="sh-head"><div><div class="cap">${esc(cap)}</div><h2>${esc(title)}</h2></div><button class="close" data-act="${closeAct}" aria-label="Fermer">${icon('x', 16)}</button></div>`;
