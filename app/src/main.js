// Interfaz de Plazo.
// Reglas de seguridad de este archivo:
//  1. Nunca se inserta HTML como texto (el build lo bloquea): todo entra con textContent.
//  2. Los datos solo existen descifrados en memoria mientras la app está desbloqueada.
//  3. Todo lo que se lee del almacenamiento se valida como si viniera de un atacante.
import { addDays, compareISO, diffDays, formatDateES, formatDateShortES, todayISO } from '../../core/dates.js';
import { computeDeadlines, summarize, timelineRange } from '../../core/legal-es.js';
import { checkPassphrase, formatCents, isSafeHttpsUrl, newId, validateItem, validateVaultData } from '../../core/validate.js';
import { b64ToBytes, createVault, deriveKeys, newKdfParams, openVault, seal } from '../../core/vault.js';
import { generateClaimLetter } from '../../core/letter.js';
import { isCatalogStale, policySnapshot, variantsFor, verifySignedCatalog } from '../../core/catalog.js';

const STORAGE_KEY = 'plazo.vault.v1';
const ATTEMPTS_KEY = 'plazo.intentos.v1';
const APP_VERSION = '0.1.0';
const TARGET = typeof __PLAZO_TARGET__ === 'string' ? __PLAZO_TARGET__ : 'dev';
const HIDDEN_LOCK_MS = 30000;
const CATALOG_KEY = 'plazo.catalogo.v1';
const EMBEDDED_CATALOG = typeof __PLAZO_CATALOG__ === 'string' ? __PLAZO_CATALOG__ : null;

// El catálogo es público y firmado: vive fuera del estado cifrado y sobrevive al bloqueo.
let catalog = null;

const appRoot = document.getElementById('app');
const toastEl = document.getElementById('toast');

let state = freshState();
let lastActivity = Date.now();
let hiddenAt = 0;
let toastTimer = 0;

function freshState(phase = 'loading') {
  return { phase, encKey: null, kdf: null, data: null, view: 'home', selectedId: null, query: '' };
}

// ---------- DOM seguro ----------
const ALLOWED_ATTRS = /^(id|type|name|for|placeholder|min|max|step|maxlength|autocomplete|inputmode|rows|role|tabindex|hidden|disabled|required|readonly|spellcheck|autocapitalize|enterkeyhint|title|lang|open|aria-[a-z]+|data-[a-z-]+)$/;

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = Boolean(v);
      else if (ALLOWED_ATTRS.test(k)) el.setAttribute(k, v === true ? '' : String(v));
      else throw new Error('Atributo no permitido: ' + k);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M5 11h14v10H5z'],
  gear: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  back: ['M15 18l-6-6 6-6'],
};

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

// Enlaces externos: solo https validado, sin enviar la página de origen.
function safeLink(url, label) {
  if (!isSafeHttpsUrl(url)) return null;
  const a = document.createElement('a');
  a.href = url;
  a.textContent = label;
  a.rel = 'noopener noreferrer';
  a.target = '_blank';
  a.referrerPolicy = 'no-referrer';
  a.className = 'link';
  return a;
}

function toast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastTimer = setTimeout(() => { toastEl.textContent = ''; }, 3200);
}

function setError(el, message) {
  el.textContent = message || '';
}

function markInvalid(input, errorEl, message) {
  if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  setError(errorEl, message);
}

// ---------- Almacenamiento ----------
function storageAvailable() {
  try {
    const k = 'plazo.prueba';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

function readBlob() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

async function persist() {
  const blob = await seal(state.encKey, state.kdf, state.data);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    toast('No se ha podido guardar: el almacenamiento del navegador está lleno o bloqueado.');
    throw new Error('almacenamiento');
  }
}

function getAttempts() {
  try {
    const a = JSON.parse(localStorage.getItem(ATTEMPTS_KEY));
    if (a && Number.isInteger(a.count) && a.count >= 0 && Number.isFinite(a.until)) return a;
  } catch { /* valor corrupto: se reinicia */ }
  return { count: 0, until: 0 };
}

function setAttempts(a) {
  try { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a)); } catch { /* sin almacenamiento */ }
}

// Espera creciente tras 5 fallos: 30 s, 1 min, 2 min... hasta 15 min.
function lockoutMs(count) {
  return count < 5 ? 0 : Math.min(15 * 60000, 30000 * 2 ** (count - 5));
}

function wipeEverything() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(CATALOG_KEY);
    localStorage.removeItem(CATALOG_KEY + '.seq');
  } catch { /* nada que borrar */ }
  state = freshState('onboarding');
}

// ---------- Navegación y bloqueo ----------
function go(view, selectedId = state.selectedId) {
  state.view = view;
  state.selectedId = selectedId;
  render();
  window.scrollTo(0, 0);
}

function lock(message) {
  if (state.phase !== 'unlocked') return;
  state = freshState('locked'); // la clave y los datos descifrados se descartan
  render();
  if (message) toast(message);
}

function checkIdle() {
  if (state.phase !== 'unlocked') return;
  const minutes = state.data.settings.autoLockMinutes;
  if (Date.now() - lastActivity >= minutes * 60000) lock('Plazo se ha bloqueado por inactividad.');
}

// ---------- Textos ----------
function duration(n) {
  if (n <= 0) return 'hoy';
  if (n === 1) return '1 día';
  if (n < 60) return n + ' días';
  const months = Math.round(n / 30.44);
  if (months < 24) return months + ' meses';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return years + ' años' + (rest ? ' y ' + rest + (rest === 1 ? ' mes' : ' meses') : '');
}

function heroSentence(d) {
  const n = d.daysLeft;
  const t = duration(n);
  const kind = d.id.startsWith('reparacion_') ? 'reparacion' : d.id;
  const today = n === 0;
  switch (kind) {
    case 'desistimiento': return today ? 'Hoy es el último día para devolverlo sin dar motivos.' : 'Te quedan ' + t + ' para devolverlo sin dar motivos.';
    case 'devolucion': return today ? 'Hoy es el último día para devolverlo según la política de la tienda.' : 'Te quedan ' + t + ' para devolverlo según la política de la tienda.';
    case 'presuncion': return today ? 'Hoy termina el plazo en que la tienda debe probar que un fallo no venía de origen.' : 'En ' + t + ' tendrás que demostrar tú que un fallo venía de origen.';
    case 'garantia': return today ? 'Hoy termina su garantía legal.' : 'Su garantía legal termina en ' + t + '.';
    case 'reparacion': return today ? 'Hoy termina la garantía de su reparación.' : 'La garantía de su reparación termina en ' + t + '.';
    case 'comercial': return today ? 'Hoy termina su garantía comercial.' : 'Su garantía comercial termina en ' + t + '.';
    case 'vicios_ocultos': return today ? 'Hoy es el último día para reclamar defectos ocultos.' : 'Te quedan ' + t + ' para reclamar defectos ocultos.';
    default: return d.label + ': ' + t + '.';
  }
}

function whenText(d) {
  if (d.status === 'vencido') return 'Venció el ' + formatDateShortES(d.endDate);
  if (d.daysLeft === 0) return 'Hoy, último día';
  return 'Hasta el ' + formatDateShortES(d.endDate) + ', ' + duration(d.daysLeft);
}

function rowStatus(all) {
  const deadlines = all.filter((d) => !d.superseded);
  const soon = deadlines.find((d) => d.status === 'pronto');
  if (soon) return { status: 'pronto', text: soon.label + ': ' + (soon.daysLeft === 0 ? 'hoy es el último día' : 'quedan ' + duration(soon.daysLeft)) };
  const legal = deadlines.find((d) => d.id === 'garantia' || d.id === 'vicios_ocultos');
  const active = deadlines.filter((d) => d.status !== 'vencido');
  if (legal && legal.status !== 'vencido') return { status: 'activo', text: legal.label + ' hasta el ' + formatDateShortES(legal.endDate) };
  if (active.length) return { status: 'activo', text: active[active.length - 1].label + ' hasta el ' + formatDateShortES(active[active.length - 1].endDate) };
  return { status: 'vencido', text: 'Todos los plazos han vencido' };
}

// ---------- Componentes ----------
function ruler(item, deadlines, today, large = false) {
  const { start, end, span } = timelineRange(item, deadlines, today);
  const pos = (iso) => Math.min(100, Math.max(0, (diffDays(start, iso) / span) * 100)) + '%';
  const next = deadlines.find((d) => d.status !== 'vencido');
  const label = 'Línea de tiempo desde la entrega, el ' + formatDateES(start) + ', hasta el ' + formatDateES(end) + '. '
    + (next ? 'Próximo plazo: ' + next.label + ', el ' + formatDateES(next.endDate) + '.' : 'Todos los plazos han vencido.');
  const track = h('span', { class: 'ruler-track' }, h('span', { class: 'ruler-elapsed', style: { width: pos(today) } }));
  for (const d of deadlines) track.append(h('span', { class: 'ruler-tick ruler-tick--' + d.status, style: { left: pos(d.endDate) } }));
  track.append(h('span', { class: 'ruler-today', style: { left: pos(today) } }));
  if (large) {
    track.append(h('span', { class: 'ruler-today-label', style: { left: pos(today) }, text: 'Hoy' }));
    const firstYear = Number(start.slice(0, 4)) + 1;
    const lastYear = Number(end.slice(0, 4));
    const step = lastYear - firstYear > 6 ? 2 : 1;
    for (let y = firstYear; y <= lastYear; y += step) {
      track.append(h('span', { class: 'ruler-year', style: { left: pos(y + '-01-01') }, text: String(y) }));
    }
  }
  return h('span', { class: large ? 'ruler ruler--large' : 'ruler', role: 'img', 'aria-label': label }, track);
}

function topbar({ back = null } = {}) {
  return h('header', { class: 'topbar' },
    back
      ? h('button', { class: 'btn-text back', type: 'button', on: { click: back.onClick } }, icon('back'), back.label)
      : h('p', { class: 'wordmark' }, h('span', { class: 'wordmark-mark', 'aria-hidden': 'true' }), 'Plazo'),
    h('div', { class: 'topbar-actions' },
      h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Bloquear Plazo', title: 'Bloquear', on: { click: () => lock('Plazo bloqueado.') } }, icon('lock')),
      state.view !== 'settings' ? h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Ajustes', title: 'Ajustes', on: { click: () => go('settings') } }, icon('gear')) : null));
}

let fieldSeq = 0;
function field({ label, input, hint = null, control = input }) {
  const id = 'f' + (++fieldSeq);
  input.id = id;
  const err = h('span', { class: 'error', id: id + '-err', 'aria-live': 'polite' });
  const hintEl = hint ? h('span', { class: 'hint', id: id + '-hint', text: hint }) : null;
  input.setAttribute('aria-describedby', (hint ? id + '-hint ' : '') + id + '-err');
  // El error desaparece en cuanto el usuario corrige el campo.
  input.addEventListener('input', () => { if (input.getAttribute('aria-invalid')) markInvalid(input, err, ''); });
  return { el: h('div', { class: 'field' }, h('label', { for: id, text: label }), hintEl, control, err), input, err };
}

function choices({ legend, name, options, value, onChange }) {
  const set = h('fieldset', { class: 'choices' }, h('legend', { class: 'legend', text: legend }));
  for (const o of options) {
    const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === value, on: { change: onChange } });
    set.append(h('label', { class: 'choice' }, input, h('span', { class: 'choice-label', text: o.label }),
      o.hint ? h('span', { class: 'choice-hint', text: o.hint }) : null));
  }
  const err = h('span', { class: 'error', 'aria-live': 'polite' });
  set.append(err);
  return { el: set, err, get value() { const c = set.querySelector('input:checked'); return c ? c.value : null; } };
}

function passwordInput(autocomplete) {
  const input = h('input', { type: 'password', autocomplete, autocapitalize: 'off', spellcheck: 'false', maxlength: '256' });
  const toggle = h('button', { class: 'btn-text pass-toggle', type: 'button', 'aria-pressed': 'false', text: 'Mostrar' });
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Ocultar' : 'Mostrar';
    toggle.setAttribute('aria-pressed', String(show));
  });
  return { input, wrap: h('div', { class: 'pass-wrap' }, input, toggle) };
}

function busy(button, label) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  return () => { button.disabled = false; button.textContent = original; };
}

function inlineConfirm({ question, confirmLabel, requireWord = null, onConfirm }) {
  const box = h('div', { class: 'confirm', hidden: true, role: 'group' });
  const input = requireWord ? h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Escribe ' + requireWord + ' para confirmar' }) : null;
  const err = h('span', { class: 'error', 'aria-live': 'polite' });
  const yes = h('button', { class: 'btn btn-danger', type: 'button', text: confirmLabel });
  const no = h('button', { class: 'btn', type: 'button', text: 'Cancelar', on: { click: () => { box.hidden = true; } } });
  yes.addEventListener('click', () => {
    if (requireWord && input.value.trim().toUpperCase() !== requireWord) { setError(err, 'Escribe ' + requireWord + ' para confirmar.'); return; }
    onConfirm();
  });
  box.append(h('p', { text: question }), input, err, h('div', { class: 'actions-row', style: { marginTop: '10px' } }, yes, no));
  return { box, open: () => { box.hidden = false; (input || yes).focus(); } };
}

// ---------- Vistas: acceso ----------
function viewUnsupported(reason) {
  return h('main', { class: 'shell' }, h('h1', { tabindex: '-1', text: 'Plazo no puede funcionar aquí' }), h('p', { class: 'lead', text: reason }));
}

function viewOnboarding() {
  const p1 = passwordInput('new-password');
  const p2 = passwordInput('new-password');
  const f1 = field({ label: 'Crea tu clave', input: p1.input, control: p1.wrap, hint: 'Una frase de varias palabras es más fuerte y fácil de recordar. Mínimo 10 caracteres.' });
  const strength = h('p', { class: 'strength', 'aria-live': 'polite' });
  f1.el.append(strength);
  const f2 = field({ label: 'Repítela', input: p2.input, control: p2.wrap });
  const ack = h('input', { type: 'checkbox' });
  const ackErr = h('span', { class: 'error', 'aria-live': 'polite' });
  const create = h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Crear mi bóveda cifrada' });

  p1.input.addEventListener('input', () => {
    const v = p1.input.value;
    const c = checkPassphrase(v);
    strength.textContent = !v ? '' : c.ok ? 'Fuerza: ' + c.message.toLowerCase() : 'Faltan requisitos: sigue escribiendo.';
  });

  const form = h('form', { 'aria-label': 'Crear clave', on: { submit: async (e) => {
    e.preventDefault();
    const pass = p1.input.value;
    const check = checkPassphrase(pass);
    markInvalid(p1.input, f1.err, check.ok ? '' : check.message);
    markInvalid(p2.input, f2.err, check.ok && pass !== p2.input.value ? 'Las dos claves no coinciden.' : '');
    setError(ackErr, ack.checked ? '' : 'Marca la casilla para continuar.');
    if (!check.ok || pass !== p2.input.value || !ack.checked) return;
    const done = busy(create, 'Cifrando…');
    try {
      const data = { v: 1, items: [], settings: { autoLockMinutes: 3 } };
      const { blob, encKey, kdf } = await createVault(pass, data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
      setAttempts({ count: 0, until: 0 });
      state = { ...freshState('unlocked'), encKey, kdf, data };
      render();
      toast('Bóveda creada en este dispositivo.');
    } catch {
      done();
      setError(ackErr, 'No se ha podido crear la bóveda. Comprueba que el navegador permite guardar datos.');
    }
  } } },
  f1.el, f2.el,
  h('label', { class: 'check' }, ack, h('span', { text: 'Entiendo que si olvido la clave nadie puede recuperar mis datos, ni siquiera Plazo.' })),
  ackErr, create);

  return h('main', { class: 'shell' },
    h('header', { class: 'topbar', style: { padding: '10px 0' } }, h('p', { class: 'wordmark' }, h('span', { class: 'wordmark-mark', 'aria-hidden': 'true' }), 'Plazo')),
    h('section', { class: 'empty' },
      h('h1', { class: 'hero-text', tabindex: '-1', text: 'Que no se te pase ninguna devolución ni garantía.' }),
      h('ul', { class: 'points' },
        h('li', { text: 'Calcula tus plazos con la ley de consumo española: devoluciones, garantía legal de 3 años y reparaciones.' }),
        h('li', { text: 'Tus compras se guardan cifradas en este móvil. Sin tu clave nadie puede leerlas.' }),
        h('li', { text: 'Sin cuenta, sin anuncios y sin rastreo. Nada sobre ti ni sobre tus compras sale del móvil.' }))),
    form,
    h('p', { class: 'fine', style: { marginTop: '18px' } }, h('button', { class: 'btn-text', type: 'button', style: { padding: '0' }, on: { click: () => { state.view = 'privacy'; render(); } }, text: 'Cómo protegemos tus datos' })));
}

function viewLocked() {
  const p = passwordInput('current-password');
  const f = field({ label: 'Tu clave', input: p.input, control: p.wrap });
  const unlock = h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Desbloquear' });
  let timer = 0;
  let waitShown = false;

  // Solo borra el mensaje si era el de espera: no debe tapar "Clave incorrecta".
  function showWait() {
    const left = getAttempts().until - Date.now();
    if (left <= 0) {
      unlock.disabled = false;
      if (waitShown) { setError(f.err, ''); waitShown = false; }
      clearInterval(timer);
      return false;
    }
    unlock.disabled = true;
    waitShown = true;
    setError(f.err, 'Demasiados intentos. Espera ' + Math.ceil(left / 1000) + ' s.');
    return true;
  }
  if (showWait()) timer = setInterval(showWait, 1000);

  const reset = inlineConfirm({
    question: 'Se borrarán todas tus compras de este dispositivo. No se puede deshacer.',
    confirmLabel: 'Borrar todo', requireWord: 'BORRAR',
    onConfirm: () => { wipeEverything(); render(); toast('Datos borrados. Puedes empezar de cero.'); },
  });

  const form = h('form', { 'aria-label': 'Desbloquear', on: { submit: async (e) => {
    e.preventDefault();
    if (showWait()) return;
    const pass = p.input.value;
    if (!pass) { markInvalid(p.input, f.err, 'Escribe tu clave.'); return; }
    const done = busy(unlock, 'Descifrando…');
    try {
      const opened = await openVault(pass, readBlob());
      const valid = validateVaultData(opened.data, addDays(todayISO(), 2));
      if (!valid.ok) throw Object.assign(new Error('formato'), { code: 'formato' });
      setAttempts({ count: 0, until: 0 });
      clearInterval(timer);
      state = { ...freshState('unlocked'), encKey: opened.encKey, kdf: opened.kdf, data: valid.value };
      lastActivity = Date.now();
      render();
      if (valid.rejected) toast(valid.rejected + ' registros dañados se han ignorado.');
    } catch (err) {
      done();
      p.input.value = '';
      if (err && err.code === 'clave_incorrecta') {
        const a = getAttempts();
        const count = a.count + 1;
        setAttempts({ count, until: Date.now() + lockoutMs(count) });
        markInvalid(p.input, f.err, 'Clave incorrecta.' + (count >= 3 && count < 5 ? ' Tras 5 intentos tendrás que esperar.' : ''));
        if (showWait()) { clearInterval(timer); timer = setInterval(showWait, 1000); }
      } else {
        markInvalid(p.input, f.err, 'Los datos guardados están dañados o no son compatibles con esta versión.');
      }
      p.input.focus();
    }
  } } }, f.el, unlock);

  return h('main', { class: 'shell' },
    h('header', { class: 'topbar', style: { padding: '10px 0' } }, h('p', { class: 'wordmark' }, h('span', { class: 'wordmark-mark', 'aria-hidden': 'true' }), 'Plazo')),
    h('h1', { tabindex: '-1', text: 'Plazo está bloqueado' }),
    h('p', { class: 'lead', text: 'Tus compras están cifradas en este dispositivo.' }),
    form,
    h('details', { class: 'more', style: { marginTop: '28px' } },
      h('summary', { text: '¿Has olvidado la clave?' }),
      h('p', { class: 'small', text: 'Por seguridad la clave no se guarda en ningún sitio, así que no se puede recuperar. Si la has perdido, la única opción es borrar los datos y empezar de nuevo.' }),
      h('button', { class: 'btn btn-danger', type: 'button', text: 'Borrar todo y empezar de cero', on: { click: reset.open } }),
      reset.box));
}

// ---------- Vistas: principal ----------
function viewHome() {
  const today = todayISO();
  const items = state.data.items;
  const s = summarize(items, today);
  const main = h('main', { class: 'shell' });

  if (!items.length) {
    main.append(h('section', { class: 'empty' },
      h('h1', { class: 'hero-text', tabindex: '-1', text: 'Añade tu primera compra.' }),
      h('p', { class: 'lead', text: 'Te diremos hasta cuándo puedes devolverla y hasta cuándo te cubre la garantía, con la ley española en la mano.' })));
  } else if (s.next) {
    const d = s.next.deadline;
    main.append(h('section', { class: 'hero' + (d.status === 'pronto' ? ' hero--pronto' : ''), 'aria-label': 'Próximo plazo' },
      h('p', { class: 'hero-item', text: '«' + s.next.item.name + '»' }),
      h('h1', { class: 'hero-text', tabindex: '-1', text: heroSentence(d) }),
      h('p', { class: 'hero-date', text: (d.daysLeft === 0 ? 'Vence hoy, ' : 'Vence el ') + formatDateES(d.endDate) + '.' }),
      h('button', { class: 'btn-text', type: 'button', style: { paddingLeft: '0' }, on: { click: () => go('detail', s.next.item.id) }, text: 'Ver todos sus plazos' })));
  } else {
    main.append(h('section', { class: 'hero' }, h('h1', { class: 'hero-text', tabindex: '-1', text: 'Ningún plazo pendiente.' }),
      h('p', { class: 'lead', text: 'Todas tus compras tienen los plazos vencidos.' })));
  }

  if (items.length) {
    main.append(h('p', { class: 'stat' }, h('strong', { class: 'price-line', text: formatCents(s.protectedCents) }),
      ' en compras con garantía vigente' + (s.soonCount ? '. ' + s.soonCount + (s.soonCount === 1 ? ' plazo vence pronto.' : ' plazos vencen pronto.') : '.')));
    main.append(h('h2', { text: 'Tus compras' }));
    const listItems = items.map((item) => ({ item, ...computeDeadlines(item, today) }));
    if (items.length >= 6) {
      const search = h('input', { type: 'text', placeholder: 'Buscar por producto o tienda', 'aria-label': 'Buscar compras', value: state.query, autocomplete: 'off' });
      search.addEventListener('input', () => { state.query = search.value; renderList(); });
      main.append(h('div', { class: 'search' }, search));
    }
    const list = h('ul', { class: 'list' });
    main.append(list);
    const renderList = () => {
      const q = state.query.trim().toLowerCase();
      const filtered = listItems.filter(({ item }) => !q || item.name.toLowerCase().includes(q) || item.store.toLowerCase().includes(q));
      const rank = (x) => {
        const n = x.deadlines.find((d) => d.status !== 'vencido');
        return n ? n.endDate : '9999-12-31';
      };
      filtered.sort((a, b) => compareISO(rank(a), rank(b)));
      list.replaceChildren(...filtered.map(({ item, deadlines }) => {
        const st = rowStatus(deadlines);
        const meta = [item.store, item.priceCents ? formatCents(item.priceCents) : null].filter(Boolean).join(', ');
        return h('li', null, h('button', { class: 'row', type: 'button', on: { click: () => go('detail', item.id) } },
          h('span', { class: 'row-name', text: item.name }),
          meta ? h('span', { class: 'row-meta', text: meta }) : h('span', { class: 'row-meta', text: 'Comprado el ' + formatDateShortES(item.purchaseDate) }),
          ruler(item, deadlines, today),
          h('span', { class: 'row-status row-status--' + st.status, text: st.text })));
      }));
      if (!filtered.length) list.append(h('li', null, h('p', { class: 'small', style: { padding: '14px 0' }, text: 'Ninguna compra coincide con la búsqueda.' })));
    };
    renderList();
  }

  return [topbar(), main,
    h('div', { class: 'bottombar' }, h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => go('edit', null) }, text: 'Añadir compra' }))];
}

function findItem(id) { return state.data.items.find((i) => i.id === id) || null; }

function viewDetail() {
  const item = findItem(state.selectedId);
  if (!item) { state.view = 'home'; return viewHome(); }
  const today = todayISO();
  const { deadlines, notes } = computeDeadlines(item, today);
  const purchase = 'Comprado el ' + formatDateES(item.purchaseDate) + (item.store ? ' en ' + item.store : '')
    + (item.priceCents ? ' por ' + formatCents(item.priceCents) : '') + '.'
    + (item.deliveryDate && item.deliveryDate !== item.purchaseDate ? ' Entregado el ' + formatDateES(item.deliveryDate) + '.' : '');

  const del = inlineConfirm({
    question: '¿Eliminar «' + item.name + '»? No se puede deshacer.',
    confirmLabel: 'Eliminar definitivamente',
    onConfirm: async () => {
      state.data.items = state.data.items.filter((i) => i.id !== item.id);
      await persist();
      go('home', null);
      toast('Compra eliminada.');
    },
  });

  const main = h('main', { class: 'shell' },
    h('h1', { tabindex: '-1', text: item.name }),
    h('p', { class: 'lead', text: purchase }),
    ruler(item, deadlines, today, true),
    h('h2', { text: 'Tus plazos' }),
    h('ul', { class: 'deadlines' }, deadlines.map((d) => h('li', { class: 'deadline deadline--' + d.status },
      h('span', { class: 'deadline-marker', 'aria-hidden': 'true' }),
      h('div', null,
        h('div', { class: 'deadline-head' }, h('span', { class: 'deadline-label', text: d.label }), h('span', { class: 'deadline-when', text: whenText(d) })),
        h('p', { class: 'deadline-text', text: d.explanation }),
        h('span', { class: 'deadline-basis', text: d.basis + (d.id === 'devolucion' && item.storePolicy && item.storePolicy.policyUpdatedAt
          ? '. La tienda la actualizó el ' + formatDateES(item.storePolicy.policyUpdatedAt) + '.' : '') }),
        d.id === 'devolucion' && item.storePolicy ? h('p', { style: { margin: '6px 0 0' } }, safeLink(item.storePolicy.source, 'Ver la política en la web de ' + item.storePolicy.storeName)) : null)))),
    h('h2', { text: 'A tener en cuenta' }),
    h('ul', { class: 'notes' }, notes.map((n) => h('li', { text: n.text }))),
    item.notes ? [h('h2', { text: 'Tus notas' }), h('p', { class: 'small', style: { whiteSpace: 'pre-wrap' }, text: item.notes })] : null,
    item.channel !== 'particular' ? repairSection(item) : null,
    h('div', { class: 'actions' },
      item.channel !== 'particular' ? h('button', { class: 'btn btn-primary btn-block', type: 'button', on: { click: () => go('letter') }, text: 'Preparar reclamación' }) : null,
      h('div', { class: 'actions-row' },
        h('button', { class: 'btn', type: 'button', on: { click: () => go('edit', item.id) }, text: 'Editar' }),
        h('button', { class: 'btn btn-danger', type: 'button', on: { click: del.open }, text: 'Eliminar' })),
      del.box),
    h('p', { class: 'fine', style: { marginTop: '28px' }, text: 'Plazo te orienta sobre plazos legales; no sustituye el asesoramiento de un profesional.' }));

  return [topbar({ back: { label: 'Tus compras', onClick: () => go('home', null) } }), main];
}

function repairSection(item) {
  const wrap = h('section', { 'aria-label': 'Reparaciones' }, h('h2', { text: 'Reparaciones' }));
  const open = item.repairs.find((r) => !r.returnedDate);
  if (!item.repairs.length) wrap.append(h('p', { class: 'small', text: 'Si lo llevas a reparar en garantía, regístralo: el plazo se congela mientras está en el taller.' }));
  for (const r of item.repairs) {
    wrap.append(h('div', { class: 'panel' },
      h('p', { style: { margin: '0' }, text: (r.issue ? r.issue + '. ' : '') + 'Entregado el ' + formatDateShortES(r.sentDate) + (r.returnedDate ? ', devuelto el ' + formatDateShortES(r.returnedDate) + '.' : ', sigue en reparación.') }),
      !r.returnedDate ? h('button', { class: 'btn-text', type: 'button', style: { paddingLeft: '0' }, text: 'Ya me lo han devuelto hoy', on: { click: async () => {
        r.returnedDate = todayISO();
        item.updatedAt = Date.now();
        await persist();
        render();
        toast('Reparación actualizada.');
      } } }) : null));
  }
  if (open) return wrap;

  const sent = field({ label: 'Fecha en que lo entregaste', input: h('input', { type: 'date', max: todayISO(), min: item.deliveryDate || item.purchaseDate, value: todayISO() }) });
  const back = field({ label: 'Fecha en que te lo devolvieron', hint: 'Déjala vacía si sigue en reparación.', input: h('input', { type: 'date', max: todayISO() }) });
  const issue = field({ label: 'Qué fallo tenía', input: h('input', { type: 'text', maxlength: '200', autocomplete: 'off' }) });
  const formErr = h('span', { class: 'error', 'aria-live': 'polite' });
  const form = h('form', { hidden: true, 'aria-label': 'Registrar reparación', on: { submit: async (e) => {
    e.preventDefault();
    const candidate = { ...item, repairs: [...item.repairs, { id: newId(), sentDate: sent.input.value, returnedDate: back.input.value || null, issue: issue.input.value }] };
    const res = validateItem({ ...candidate, preserveTimestamps: false }, todayISO());
    if (!res.ok) { setError(formErr, res.errors.repairs || 'Revisa los datos.'); return; }
    Object.assign(item, res.value);
    await persist();
    render();
    toast('Reparación registrada.');
  } } }, sent.el, back.el, issue.el, formErr, h('button', { class: 'btn btn-primary', type: 'submit', text: 'Guardar reparación' }));
  const openBtn = h('button', { class: 'btn', type: 'button', text: 'Registrar reparación', on: { click: () => { form.hidden = false; openBtn.hidden = true; sent.input.focus(); } } });
  wrap.append(openBtn, form);
  return wrap;
}

// ---------- Vista: añadir / editar ----------
function viewEdit() {
  const existing = state.selectedId ? findItem(state.selectedId) : null;
  const v = existing || { channel: 'tienda', condition: 'nuevo', kind: 'bien', purchaseDate: todayISO() };
  const today = todayISO();

  const name = field({ label: 'Qué compraste', input: h('input', { type: 'text', maxlength: '80', autocomplete: 'off', enterkeyhint: 'next', value: v.name || '', placeholder: 'Ej.: Auriculares inalámbricos' }) });
  const store = field({ label: 'Dónde (tienda o web)', input: h('input', { type: 'text', maxlength: '60', autocomplete: 'off', value: v.store || '' }) });
  const price = field({ label: 'Precio', input: h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00 €', value: existing && existing.priceCents ? (existing.priceCents / 100).toFixed(2).replace('.', ',') : '' }) });
  const purchase = field({ label: 'Fecha de compra', input: h('input', { type: 'date', max: today, required: true, value: v.purchaseDate }) });
  const delivery = field({ label: 'Fecha de entrega', hint: 'Si lo recibiste otro día. La garantía cuenta desde la entrega.', input: h('input', { type: 'date', max: today, value: v.deliveryDate || '' }) });

  const channel = choices({ legend: 'Cómo lo compraste', name: 'channel', value: v.channel, onChange: () => { syncStore(); update(); }, options: [
    { value: 'tienda', label: 'En una tienda física' },
    { value: 'online', label: 'Por internet o por teléfono' },
    { value: 'fuera_tienda', label: 'Fuera de una tienda', hint: 'En casa, en la calle o en una excursión organizada por el vendedor.' },
    { value: 'particular', label: 'A otra persona, no a una empresa', hint: 'Por ejemplo, entre particulares en una app de segunda mano.' },
  ] });
  const condition = choices({ legend: 'Estado', name: 'condition', value: v.condition, onChange: () => update(), options: [
    { value: 'nuevo', label: 'Nuevo' }, { value: 'segunda_mano', label: 'Segunda mano o reacondicionado' },
  ] });
  const kind = choices({ legend: 'Tipo', name: 'kind', value: v.kind, onChange: () => update(), options: [
    { value: 'bien', label: 'Producto físico' },
    { value: 'digital', label: 'Contenido digital', hint: 'Apps, juegos, películas o programas descargados.' },
  ] });

  const agreedSel = h('select', { on: { change: () => update() } },
    h('option', { value: '', text: 'No me dijeron nada: 3 años' }), h('option', { value: '2', text: '2 años' }), h('option', { value: '1', text: '1 año (mínimo legal)' }));
  agreedSel.value = v.agreedGuaranteeYears ? String(v.agreedGuaranteeYears) : '';
  const agreed = field({ label: 'Garantía que pactaste con el vendedor', hint: 'En segunda mano pueden pactar menos de 3 años, nunca menos de 1.', input: agreedSel });
  const infoMissing = h('input', { type: 'checkbox', checked: v.withdrawalInfoMissing, on: { change: () => update() } });
  const infoLabel = h('label', { class: 'check' }, infoMissing, h('span', { text: 'No me informaron de que podía devolverlo en 14 días' }));

  const ret = field({ label: 'Días de devolución que da la tienda', hint: 'Opcional. Muchas tiendas físicas dan 15 o 30 días aunque no sea obligatorio.', input: h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '365', step: '1', value: v.storeReturnDays ?? '' }) });
  const com = field({ label: 'Garantía comercial en meses', hint: 'Opcional. Por ejemplo, 60 si el fabricante da 5 años.', input: h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '240', step: '1', value: v.commercialGuaranteeMonths ?? '' }) });
  const notes = field({ label: 'Notas', input: h('textarea', { maxlength: '500', rows: '3', value: v.notes || '' }) });

  // Tienda del catálogo firmado: rellena el plazo publicado por la tienda.
  const storeSel = h('select', { on: { change: () => { syncStore(); update(); } } },
    h('option', { value: '', text: 'Otra tienda' }),
    (catalog ? catalog.stores : []).map((st) => h('option', { value: st.id, text: st.name })));
  storeSel.value = existing && existing.storePolicy && catalog && catalog.stores.some((st) => st.id === existing.storePolicy.storeId)
    ? existing.storePolicy.storeId : '';
  const storeField = field({ label: 'Tienda', hint: 'Si está en la lista, Plazo aplica la política de devoluciones que publica.', input: storeSel });
  const variantBox = h('div');
  const policyInfo = h('div', { class: 'policy', 'aria-live': 'polite' });
  let variantChoices = null;

  function currentStore() {
    return catalog && storeSel.value ? catalog.stores.find((st) => st.id === storeSel.value) || null : null;
  }

  function selectedVariant() {
    const list = variantsFor(currentStore(), channel.value);
    if (list.length === 1) return list[0];
    const id = variantChoices ? variantChoices.value : null;
    return list.find((x) => x.id === id) || null;
  }

  function renderPolicyInfo() {
    const st = currentStore();
    const variant = selectedVariant();
    policyInfo.replaceChildren();
    if (!st) return;
    if (!variantsFor(st, channel.value).length) {
      policyInfo.append(h('p', { class: 'small', text: 'No tenemos la política de ' + st.name + ' para este tipo de compra. Si te dieron un plazo, indícalo en «Más detalles».' }));
      return;
    }
    if (!variant) return;
    const days = variant.returnDays
      ? st.name + ': ' + variant.returnDays + ' días desde ' + (variant.countFrom === 'compra' ? 'la compra.' : 'la entrega.')
      : 'Plazo según el vendedor.';
    policyInfo.append(
      h('p', { class: 'small', style: { margin: '0 0 4px' } }, h('strong', { text: days }), ' ' + variant.note),
      h('p', { class: 'fine', style: { margin: '0 0 4px' }, text: 'Política consultada el ' + formatDateES(variant.checkedAt) + '.'
        + (isCatalogStale(catalog, today) ? ' La lista de tiendas está desactualizada: compruébalo en su web.' : '') }),
      safeLink(variant.source, 'Ver la política en su web'));
  }

  function syncStore() {
    const st = currentStore();
    store.el.hidden = Boolean(st);
    if (st) store.input.value = st.name;
    const list = variantsFor(st, channel.value);
    const keepId = variantChoices ? variantChoices.value : existing && existing.storePolicy ? existing.storePolicy.variantId : null;
    variantChoices = null;
    variantBox.replaceChildren();
    if (list.length > 1) {
      variantChoices = choices({ legend: '¿Quién te lo vendió?', name: 'variant', value: list.some((x) => x.id === keepId) ? keepId : list[0].id,
        onChange: () => { renderPolicyInfo(); update(); }, options: list.map((x) => ({ value: x.id, label: x.label })) });
      variantBox.append(variantChoices.el);
    }
    storeField.el.hidden = !catalog || channel.value === 'particular';
    renderPolicyInfo();
  }

  function buildPolicy() {
    if (channel.value === 'particular') return null;
    if (!catalog) return existing ? existing.storePolicy : null; // sin catálogo se conserva la foto guardada
    const st = currentStore();
    const variant = selectedVariant();
    if (!st || !variant) return null;
    const prev = existing && existing.storePolicy;
    // La foto no se rehace al editar: vale la política del día de la compra.
    if (prev && prev.storeId === st.id && prev.variantId === variant.id && existing.purchaseDate === purchase.input.value) return prev;
    return policySnapshot(catalog, st.id, variant.id, purchase.input.value);
  }

  const preview = h('p', { class: 'preview', 'aria-live': 'polite' });
  const formErr = h('span', { class: 'error', 'aria-live': 'polite' });

  const gather = () => ({
    id: existing ? existing.id : newId(),
    name: name.input.value, store: store.input.value, price: price.input.value,
    purchaseDate: purchase.input.value, deliveryDate: delivery.input.value || null,
    channel: channel.value, condition: condition.value, kind: kind.value,
    agreedGuaranteeYears: agreedSel.value ? Number(agreedSel.value) : null,
    withdrawalInfoMissing: infoMissing.checked,
    storeReturnDays: ret.input.value === '' ? null : Number(ret.input.value),
    commercialGuaranteeMonths: com.input.value === '' ? null : Number(com.input.value),
    notes: notes.input.value,
    repairs: existing ? existing.repairs : [],
    createdAt: existing ? existing.createdAt : undefined,
    storePolicy: buildPolicy(),
  });

  function update() {
    const ch = channel.value;
    condition.el.hidden = ch === 'particular';
    kind.el.hidden = ch === 'particular';
    agreed.el.hidden = !(condition.value === 'segunda_mano' && kind.value === 'bien' && ch !== 'particular');
    infoLabel.hidden = !((ch === 'online' || ch === 'fuera_tienda') && kind.value === 'bien');
    const res = validateItem(gather(), today);
    ret.el.hidden = Boolean(res.ok && res.value.storePolicy);
    if (!res.ok) { preview.textContent = ''; return; }
    const { deadlines } = computeDeadlines(res.value, today);
    const legal = deadlines.find((d) => d.id === 'garantia') || deadlines.find((d) => d.id === 'vicios_ocultos');
    const withdraw = deadlines.find((d) => d.id === 'desistimiento' && !d.superseded);
    const storeReturn = deadlines.find((d) => d.id === 'devolucion');
    preview.textContent = (storeReturn ? 'Devolución según la tienda: ' + whenText(storeReturn).toLowerCase() + '. ' : '')
      + (withdraw ? 'Devolución sin motivo: ' + whenText(withdraw).toLowerCase() + '. ' : '')
      + (legal ? legal.label + ': ' + whenText(legal).toLowerCase() + '.' : '');
  }

  for (const f of [name, store, price, purchase, delivery]) f.input.addEventListener('input', update);
  for (const f of [ret, com]) f.input.addEventListener('input', update);

  const fieldMap = { name, store, price, purchaseDate: purchase, deliveryDate: delivery, agreedGuaranteeYears: agreed, storeReturnDays: ret, commercialGuaranteeMonths: com, notes };
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: existing ? 'Guardar cambios' : 'Guardar compra' });

  const form = h('form', { 'aria-label': existing ? 'Editar compra' : 'Añadir compra', on: { submit: async (e) => {
    e.preventDefault();
    const res = validateItem(gather(), todayISO());
    let first = null;
    for (const [key, f] of Object.entries(fieldMap)) {
      markInvalid(f.input, f.err, res.errors[key] || '');
      if (res.errors[key] && !first) first = f.input;
    }
    setError(channel.err, res.errors.channel || '');
    setError(formErr, res.ok ? '' : 'Revisa los campos marcados.');
    if (!res.ok) { (first || channel.el.querySelector('input')).focus(); return; }
    const done = busy(save, 'Guardando…');
    try {
      if (existing) Object.assign(existing, res.value);
      else state.data.items.push(res.value);
      await persist();
      go('detail', res.value.id);
      toast(existing ? 'Cambios guardados.' : 'Compra guardada.');
    } catch { done(); }
  } } },
  name.el, price.el, purchase.el, delivery.el, channel.el, storeField.el, store.el, variantBox, policyInfo, condition.el, kind.el, agreed.el, infoLabel,
  h('details', { class: 'more', open: Boolean(v.storeReturnDays || v.commercialGuaranteeMonths || v.notes) },
    h('summary', { text: 'Más detalles' }), ret.el, com.el, notes.el),
  preview, formErr, save);
  form.noValidate = true;
  syncStore();
  update();

  return [topbar({ back: { label: existing ? 'Volver' : 'Tus compras', onClick: () => go(existing ? 'detail' : 'home') } }),
    h('main', { class: 'shell' }, h('h1', { tabindex: '-1', text: existing ? 'Editar compra' : 'Añadir compra' }), form)];
}

// ---------- Vista: reclamación ----------
function viewLetter() {
  const item = findItem(state.selectedId);
  if (!item) { state.view = 'home'; return viewHome(); }
  const today = todayISO();
  const who = field({ label: 'Tu nombre y apellidos', hint: 'Solo se usa para la carta. No se guarda.', input: h('input', { type: 'text', autocomplete: 'name', maxlength: '80' }) });
  const when = field({ label: 'Cuándo apareció el fallo', input: h('input', { type: 'date', max: today, min: item.deliveryDate || item.purchaseDate, value: today }) });
  const what = field({ label: 'Describe el fallo', hint: 'Qué pasa y desde cuándo. Ej.: la batería no carga desde el 3 de octubre.', input: h('textarea', { maxlength: '500', rows: '4' }) });
  const remedy = choices({ legend: 'Qué pides', name: 'remedy', value: 'reparacion', onChange: () => {}, options: [
    { value: 'reparacion', label: 'Que lo reparen' },
    { value: 'sustitucion', label: 'Que lo cambien por otro' },
    { value: 'rebaja', label: 'Una rebaja del precio', hint: 'Normalmente solo si reparar o cambiar no es posible o no ha funcionado.' },
    { value: 'resolucion', label: 'Devolverlo y recuperar el dinero', hint: 'Igual que la rebaja: suele exigir que antes fallara la reparación o el cambio.' },
  ] });
  const formErr = h('span', { class: 'error', 'aria-live': 'polite' });
  const output = h('section', { hidden: true, 'aria-label': 'Carta generada' });
  const letterBox = h('textarea', { class: 'letter', readonly: true, 'aria-label': 'Texto de la carta', spellcheck: 'false' });
  const warning = h('p', { class: 'small', style: { color: 'var(--aviso)' } });

  const form = h('form', { 'aria-label': 'Preparar reclamación', on: { submit: (e) => {
    e.preventDefault();
    const r = generateClaimLetter({ item, consumerName: who.input.value, issue: what.input.value, issueDate: when.input.value, remedy: remedy.value, today: todayISO() });
    markInvalid(who.input, who.err, r.ok ? '' : r.errors.consumerName || '');
    markInvalid(what.input, what.err, r.ok ? '' : r.errors.issue || '');
    markInvalid(when.input, when.err, r.ok ? '' : r.errors.issueDate || '');
    setError(remedy.err, r.ok ? '' : r.errors.remedy || '');
    setError(formErr, r.ok ? '' : r.errors.general || 'Revisa los campos marcados.');
    if (!r.ok) { output.hidden = true; return; }
    letterBox.value = r.text;
    warning.textContent = r.warning || '';
    output.hidden = false;
    letterBox.focus();
  } } }, who.el, when.el, what.el, remedy.el, formErr, h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Redactar carta' }));

  output.append(h('h2', { text: 'Tu carta' }), warning, letterBox,
    h('div', { class: 'actions-row', style: { marginTop: '12px' } }, h('button', { class: 'btn btn-primary', type: 'button', text: 'Copiar carta', on: { click: () => copyFrom(letterBox) } })),
    h('h2', { text: 'Cómo enviarla' }),
    h('ul', { class: 'notes' },
      h('li', { text: 'Por un medio que deje constancia: email, formulario de la tienda con acuse, o burofax si es importante. Guarda la respuesta.' }),
      h('li', { text: 'Adjunta el ticket o la factura y fotos del fallo si las tienes.' }),
      h('li', { text: 'Si no responden o se niegan, pide la hoja de reclamaciones en la tienda o acude a la oficina de consumo de tu ayuntamiento o comunidad.' })));

  return [topbar({ back: { label: 'Volver', onClick: () => go('detail') } }),
    h('main', { class: 'shell' }, h('h1', { tabindex: '-1', text: 'Preparar reclamación' }),
      h('p', { class: 'lead', text: 'Plazo redacta una carta para «' + item.name + '» citando la ley de consumo. Revísala antes de enviarla.' }),
      form, output)];
}

async function copyFrom(textarea) {
  try {
    await navigator.clipboard.writeText(textarea.value);
    toast('Copiado.');
  } catch {
    textarea.focus();
    textarea.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    toast(ok ? 'Copiado.' : 'Texto seleccionado: cópialo desde el menú del sistema.');
  }
}

// ---------- Vista: ajustes ----------
function viewSettings() {
  const sel = h('select', { 'aria-label': 'Bloqueo automático' },
    [1, 3, 5, 15].map((m) => h('option', { value: String(m), text: m === 1 ? '1 minuto' : m + ' minutos' })));
  sel.value = String(state.data.settings.autoLockMinutes);
  sel.addEventListener('change', async () => {
    state.data.settings.autoLockMinutes = Number(sel.value);
    await persist();
    toast('Ajuste guardado.');
  });
  const autolock = field({ label: 'Bloqueo automático', hint: 'Plazo se bloquea tras este tiempo sin usarlo, y siempre al salir de la app más de 30 segundos.', input: sel });

  const cur = passwordInput('current-password');
  const nw = passwordInput('new-password');
  const nw2 = passwordInput('new-password');
  const fCur = field({ label: 'Clave actual', input: cur.input, control: cur.wrap });
  const fNew = field({ label: 'Clave nueva', input: nw.input, control: nw.wrap });
  const fNew2 = field({ label: 'Repite la clave nueva', input: nw2.input, control: nw2.wrap });
  const changeBtn = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Cambiar clave' });
  const changeForm = h('form', { 'aria-label': 'Cambiar clave', on: { submit: async (e) => {
    e.preventDefault();
    const check = checkPassphrase(nw.input.value);
    markInvalid(nw.input, fNew.err, check.ok ? '' : check.message);
    markInvalid(nw2.input, fNew2.err, check.ok && nw.input.value !== nw2.input.value ? 'Las dos claves no coinciden.' : '');
    if (!check.ok || nw.input.value !== nw2.input.value) return;
    const done = busy(changeBtn, 'Cifrando…');
    try {
      await openVault(cur.input.value, readBlob());
    } catch {
      done();
      markInvalid(cur.input, fCur.err, 'La clave actual no es correcta.');
      return;
    }
    markInvalid(cur.input, fCur.err, '');
    const kdf = newKdfParams();
    const keys = await deriveKeys(nw.input.value, b64ToBytes(kdf.salt), kdf.iter);
    state.kdf = kdf;
    state.encKey = keys.encKey;
    await persist();
    render();
    toast('Clave cambiada. Úsala la próxima vez que desbloquees.');
  } } }, fCur.el, fNew.el, fNew2.el, changeBtn);

  const exportBox = h('textarea', { class: 'letter', readonly: true, 'aria-label': 'Copia de tus datos', spellcheck: 'false', hidden: true });
  const exportCopy = h('button', { class: 'btn', type: 'button', hidden: true, text: 'Copiar datos', on: { click: () => copyFrom(exportBox) } });
  const exportBtn = h('button', { class: 'btn', type: 'button', text: 'Ver mis datos sin cifrar', on: { click: () => {
    exportBox.value = JSON.stringify({ app: 'Plazo', version: APP_VERSION, exportadoEl: new Date().toISOString(), compras: state.data.items }, null, 2);
    exportBox.hidden = false; exportCopy.hidden = false; exportBtn.hidden = true;
  } } });

  const wipe = inlineConfirm({
    question: 'Se borrarán todas tus compras de este dispositivo. No se puede deshacer.',
    confirmLabel: 'Borrar todo', requireWord: 'BORRAR',
    onConfirm: () => { wipeEverything(); render(); toast('Todos tus datos se han borrado de este dispositivo.'); },
  });

  return [topbar({ back: { label: 'Tus compras', onClick: () => go('home') } }),
    h('main', { class: 'shell' },
      h('h1', { tabindex: '-1', text: 'Ajustes' }),
      autolock.el,
      h('button', { class: 'btn btn-block', type: 'button', text: 'Bloquear ahora', on: { click: () => lock('Plazo bloqueado.') } }),
      h('h2', { text: 'Clave' }),
      h('details', { class: 'more' }, h('summary', { text: 'Cambiar clave' }), changeForm),
      h('h2', { text: 'Tus datos' }),
      h('p', { class: 'small', text: 'Puedes llevarte tus datos cuando quieras. Esta copia no está cifrada: no la compartas.' }),
      exportBtn, exportBox, h('div', { style: { marginTop: '10px' } }, exportCopy),
      h('div', { style: { marginTop: '18px' } }, h('button', { class: 'btn btn-danger', type: 'button', text: 'Borrar todos mis datos', on: { click: wipe.open } })),
      wipe.box,
      h('h2', { text: 'Más' }),
      h('div', { class: 'actions-row' },
        h('button', { class: 'btn', type: 'button', text: 'Privacidad y seguridad', on: { click: () => go('privacy') } }),
        h('button', { class: 'btn', type: 'button', text: 'Plazo Plus', on: { click: () => go('plus') } })),
      h('p', { class: 'fine', style: { marginTop: '28px' }, text: 'Plazo ' + APP_VERSION + '. Te orienta sobre plazos legales en España; no sustituye el asesoramiento de un profesional.' }))];
}

function viewPrivacy() {
  const unlocked = state.phase === 'unlocked';
  const backTo = unlocked ? () => go('settings') : () => { state.view = 'home'; render(); };
  const sections = [
    ['Dónde están tus datos', 'Solo en este dispositivo, cifrados con AES-256-GCM. La clave se obtiene de tu frase con PBKDF2 (600.000 iteraciones) y nunca se guarda. Sin tu frase, nadie puede leerlos: tampoco nosotros.'],
    ['Qué no hacemos', 'No hay cuentas, anuncios, analítica ni cookies de seguimiento, y no usamos servicios de terceros, ni siquiera para las fuentes tipográficas. Lo único que la app puede descargar es la lista pública de políticas de tiendas: es el mismo fichero para todo el mundo, así que nadie sabe en qué tienda compras.'],
    ['Quién trata tus datos', 'En el modo gratuito tus datos no salen de tu dispositivo, así que nadie más los trata. Si activas Plazo Plus, se sube una copia cifrada a servidores en la Unión Europea que solo ven datos ilegibles.'],
    ['Tus derechos', 'Puedes ver y llevarte tus datos (Ajustes, Tus datos) y borrarlos por completo en cualquier momento. Si alguna vez tratamos datos tuyos, podrás ejercer tus derechos ante nosotros y reclamar ante la Agencia Española de Protección de Datos.'],
    ['Protecciones', 'Bloqueo automático por inactividad y al salir de la app, espera creciente tras intentos fallidos, y validación de todo lo que se guarda.'],
  ];
  const main = h('main', { class: 'shell' }, h('h1', { tabindex: '-1', text: 'Privacidad y seguridad' }));
  for (const [title, text] of sections) main.append(h('h2', { text: title }), h('p', { class: 'lead', text }));
  return [unlocked ? topbar({ back: { label: 'Ajustes', onClick: backTo } })
    : h('header', { class: 'topbar' }, h('button', { class: 'btn-text back', type: 'button', on: { click: backTo } }, icon('back'), 'Volver')), main];
}

function viewPlus() {
  return [topbar({ back: { label: 'Ajustes', onClick: () => go('settings') } }),
    h('main', { class: 'shell' },
      h('h1', { tabindex: '-1', text: 'Plazo Plus' }),
      h('p', { class: 'lead', text: 'Para no perder nada aunque cambies de móvil.' }),
      h('ul', { class: 'points' },
        h('li', { text: 'Copia cifrada en la nube y uso en varios dispositivos. El servidor solo guarda datos que no puede leer.' }),
        h('li', { text: 'Compras compartidas con tu familia.' }),
        h('li', { text: 'Escaneo de tickets con la cámara, procesado en el propio móvil.' }),
        h('li', { text: 'Exportación de reclamaciones en PDF.' })),
      h('p', { class: 'price-line', text: '2,49 € al mes o 19,99 € al año, IVA incluido. Cancelas cuando quieras desde la tienda de aplicaciones.' }),
      h('p', { class: 'small', text: 'Calcular plazos y redactar reclamaciones seguirá siendo gratis y sin límites.' }),
      h('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: true, text: 'Disponible en las apps de iOS y Android' }))];
}

// ---------- Render ----------
function render() {
  let view;
  if (state.phase === 'unsupported') view = viewUnsupported(state.reason);
  else if (state.view === 'privacy' && state.phase !== 'loading') view = viewPrivacy();
  else if (state.phase === 'onboarding') view = viewOnboarding();
  else if (state.phase === 'locked') view = viewLocked();
  else if (state.phase === 'unlocked') {
    const views = { home: viewHome, detail: viewDetail, edit: viewEdit, letter: viewLetter, settings: viewSettings, plus: viewPlus };
    view = (views[state.view] || viewHome)();
  } else view = h('main', { class: 'shell' }, h('p', { class: 'lead', text: 'Cargando…' }));
  appRoot.replaceChildren(...[view].flat());
  const heading = appRoot.querySelector('h1');
  if (heading) heading.focus({ preventScroll: true });
}

function registerServiceWorker() {
  if (TARGET !== 'pwa' || !('serviceWorker' in navigator)) return;
  let url = './sw.js';
  if (globalThis.trustedTypes && trustedTypes.createPolicy) {
    // Trusted Types: el único script de worker permitido es el nuestro.
    const policy = trustedTypes.createPolicy('plazo-sw', {
      createScriptURL: (u) => { if (u === './sw.js') return u; throw new TypeError('URL de worker no permitida'); },
    });
    url = policy.createScriptURL('./sw.js');
  }
  navigator.serviceWorker.register(url, { scope: './' }).catch(() => { /* sin modo sin conexión */ });
}

function storedCatalogSeq() {
  try { const n = Number(localStorage.getItem(CATALOG_KEY + '.seq')); return Number.isInteger(n) && n > 0 ? n : 0; } catch { return 0; }
}

// Usa el catálogo válido más reciente entre: el incluido en la app, el último guardado y,
// en la PWA, el publicado en el propio dominio. Todo se verifica con firma y antirreversión.
async function loadCatalog() {
  const minSeq = storedCatalogSeq();
  const candidates = [EMBEDDED_CATALOG];
  try { candidates.push(localStorage.getItem(CATALOG_KEY)); } catch { /* sin almacenamiento */ }
  for (const text of candidates) {
    if (!text) continue;
    try {
      const c = await verifySignedCatalog(text, { minSeq });
      if (!catalog || c.seq > catalog.seq) { catalog = c; acceptCatalog(text, c); }
    } catch { /* inválido o antiguo: se ignora */ }
  }
}

// En segundo plano, sin retrasar el arranque.
async function refreshCatalog() {
  if (TARGET !== 'pwa') return;
  const minSeq = storedCatalogSeq();
  try {
    const res = await fetch('./catalog.json', { cache: 'no-cache', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!res.ok) return;
    const text = await res.text();
    const fresh = await verifySignedCatalog(text, { minSeq: Math.max(minSeq, catalog ? catalog.seq : 0) });
    if (!catalog || fresh.seq > catalog.seq) { catalog = fresh; acceptCatalog(text, fresh); }
  } catch { /* sin red o catálogo manipulado: seguimos con el que había */ }
}

function acceptCatalog(text, c) {
  try {
    localStorage.setItem(CATALOG_KEY, text);
    localStorage.setItem(CATALOG_KEY + '.seq', String(c.seq));
  } catch { /* sin almacenamiento */ }
}

async function boot() {
  if (!globalThis.crypto || !crypto.subtle) {
    state = { ...freshState('unsupported'), reason: 'Este navegador no permite cifrar de forma segura. Ábrela desde una conexión segura (https) y un navegador actualizado.' };
  } else if (!storageAvailable()) {
    state = { ...freshState('unsupported'), reason: 'Este navegador no permite guardar datos (puede pasar en modo privado). Plazo necesita guardar tu bóveda cifrada en el dispositivo.' };
  } else {
    state = freshState(readBlob() ? 'locked' : 'onboarding');
    try { await loadCatalog(); } catch { catalog = null; }
  }
  render();
  refreshCatalog();
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'scroll']) {
    document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (state.phase === 'unlocked' && hiddenAt && Date.now() - hiddenAt >= HIDDEN_LOCK_MS) lock('Plazo se ha bloqueado al salir de la app.');
  });
  setInterval(checkIdle, 5000);
  registerServiceWorker();
}

boot();
