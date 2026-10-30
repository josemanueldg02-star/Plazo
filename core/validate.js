// Validación estricta de todo lo que entra: formularios, datos descifrados del
// almacenamiento y datos sincronizados. Nunca confiamos en datos "porque son
// nuestros": un dispositivo comprometido o una versión antigua podría escribir
// cualquier cosa.
import { compareISO, isISODate } from './dates.js';
import { CHANNELS, CONDITIONS, KINDS } from './legal-es.js';

export const LIMITS = { name: 80, store: 60, notes: 500, issue: 200, repairs: 20, items: 2000, priceCents: 100000000 };

// Caracteres de control y marcas bidireccionales (ataques de suplantación visual).
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function cleanText(value, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  let s = value.normalize('NFC').replace(CONTROL_RE, '');
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/\t/g, ' ') : s.replace(/\s+/g, ' ');
  return s.trim();
}

// Acepta "299", "299,99", "1.299,50", "1299.5" o un número.
export function parsePriceToCents(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  if (typeof input !== 'string') return null;
  let s = input.replace(/[€\s]/g, '');
  if (s === '') return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function formatCents(cents) {
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (rest ? grouped + ',' + String(rest).padStart(2, '0') : grouped) + ' €';
}

function optionalInt(value, min, max) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) return { ok: false };
  return { ok: true, value: n };
}

// Solo enlaces https sin credenciales: nunca javascript:, data: ni http.
export function isSafeHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.');
  } catch { return false; }
}

const POLICY_KEYS = ['storeId', 'storeName', 'variantId', 'variantLabel', 'returnDays', 'countFrom', 'returnUntil',
  'campaignLabel', 'note', 'source', 'checkedAt', 'policyUpdatedAt', 'catalogSeq'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

// Foto de la política de la tienda guardada con la compra. Se valida igual que
// cualquier otra entrada aunque venga de un catálogo firmado.
export function validateStorePolicy(p) {
  if (p === null || p === undefined) return { ok: true, value: null };
  if (typeof p !== 'object' || Array.isArray(p)) return { ok: false, value: null };
  for (const k of Object.keys(p)) if (!POLICY_KEYS.includes(k)) return { ok: false, value: null };
  const v = {
    storeId: p.storeId, storeName: cleanText(p.storeName), variantId: p.variantId, variantLabel: cleanText(p.variantLabel),
    returnDays: p.returnDays ?? null, countFrom: p.countFrom, returnUntil: p.returnUntil ?? null,
    campaignLabel: p.campaignLabel ? cleanText(p.campaignLabel) : null, note: cleanText(p.note || ''),
    source: p.source, checkedAt: p.checkedAt, policyUpdatedAt: p.policyUpdatedAt ?? null, catalogSeq: p.catalogSeq,
  };
  const ok = SLUG_RE.test(v.storeId || '') && SLUG_RE.test(v.variantId || '')
    && v.storeName.length >= 1 && v.storeName.length <= 60 && v.variantLabel.length >= 1 && v.variantLabel.length <= 60
    && (v.returnDays === null || (Number.isInteger(v.returnDays) && v.returnDays >= 1 && v.returnDays <= 365))
    && ['entrega', 'compra'].includes(v.countFrom)
    && (v.returnUntil === null || isISODate(v.returnUntil))
    && (v.campaignLabel === null || v.campaignLabel.length <= 60)
    && v.note.length <= 240 && isSafeHttpsUrl(v.source) && isISODate(v.checkedAt)
    && (v.policyUpdatedAt === null || isISODate(v.policyUpdatedAt))
    && Number.isInteger(v.catalogSeq) && v.catalogSeq >= 1;
  return ok ? { ok: true, value: v } : { ok: false, value: null };
}

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// maxDate: último día aceptable (hoy en formularios; hoy + margen para datos
// guardados en otro dispositivo con otra zona horaria).
export function validateItem(input, maxDate) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};
  const out = {};

  out.id = typeof src.id === 'string' && ID_RE.test(src.id) ? src.id : null;
  if (!out.id) errors.id = 'Identificador no válido.';

  out.name = cleanText(src.name);
  if (!out.name) errors.name = 'Escribe qué compraste.';
  else if (out.name.length > LIMITS.name) errors.name = 'Máximo ' + LIMITS.name + ' caracteres.';

  out.store = cleanText(src.store);
  if (out.store.length > LIMITS.store) errors.store = 'Máximo ' + LIMITS.store + ' caracteres.';

  const cents = typeof src.priceCents === 'number' ? src.priceCents : parsePriceToCents(src.price ?? '');
  if (src.priceCents === undefined && (src.price === undefined || src.price === '')) out.priceCents = 0;
  else if (cents === null || !Number.isInteger(cents) || cents < 0 || cents > LIMITS.priceCents) errors.price = 'Precio no válido. Ejemplo: 299,99';
  else out.priceCents = cents;

  out.purchaseDate = src.purchaseDate;
  if (!isISODate(src.purchaseDate)) errors.purchaseDate = 'Indica la fecha de compra.';
  else if (compareISO(src.purchaseDate, maxDate) > 0) errors.purchaseDate = 'La fecha de compra no puede ser futura.';

  out.deliveryDate = src.deliveryDate ? src.deliveryDate : null;
  if (out.deliveryDate !== null) {
    if (!isISODate(out.deliveryDate)) errors.deliveryDate = 'Fecha de entrega no válida.';
    else if (!errors.purchaseDate && compareISO(out.deliveryDate, out.purchaseDate) < 0) errors.deliveryDate = 'La entrega no puede ser anterior a la compra.';
    else if (compareISO(out.deliveryDate, maxDate) > 0) errors.deliveryDate = 'Si aún no lo has recibido, deja la entrega vacía.';
  }

  out.channel = CHANNELS.includes(src.channel) ? src.channel : null;
  if (!out.channel) errors.channel = 'Elige dónde lo compraste.';
  out.condition = CONDITIONS.includes(src.condition) ? src.condition : 'nuevo';
  out.kind = KINDS.includes(src.kind) ? src.kind : 'bien';

  const agreed = optionalInt(src.agreedGuaranteeYears, 1, 3);
  if (!agreed.ok) errors.agreedGuaranteeYears = 'Entre 1 y 3 años.';
  out.agreedGuaranteeYears = out.condition === 'segunda_mano' ? agreed.value : null;

  out.withdrawalInfoMissing = src.withdrawalInfoMissing === true;

  const ret = optionalInt(src.storeReturnDays, 1, 365);
  if (!ret.ok) errors.storeReturnDays = 'Entre 1 y 365 días.';
  out.storeReturnDays = ret.value;

  const com = optionalInt(src.commercialGuaranteeMonths, 1, 240);
  if (!com.ok) errors.commercialGuaranteeMonths = 'Entre 1 y 240 meses.';
  out.commercialGuaranteeMonths = com.value;

  const policy = validateStorePolicy(src.storePolicy);
  if (!policy.ok) errors.storePolicy = 'La política de la tienda guardada no es válida.';
  out.storePolicy = out.channel === 'particular' ? null : policy.value;
  if (out.storePolicy) out.storeReturnDays = null; // la política del catálogo sustituye al dato manual

  out.notes = cleanText(src.notes, { multiline: true });
  if (out.notes.length > LIMITS.notes) errors.notes = 'Máximo ' + LIMITS.notes + ' caracteres.';

  out.repairs = [];
  const repairs = Array.isArray(src.repairs) ? src.repairs : [];
  if (repairs.length > LIMITS.repairs) errors.repairs = 'Demasiadas reparaciones.';
  let open = 0;
  const startRef = out.deliveryDate || out.purchaseDate;
  for (const r of repairs.slice(0, LIMITS.repairs)) {
    const rep = {
      id: typeof r?.id === 'string' && ID_RE.test(r.id) ? r.id : null,
      sentDate: r?.sentDate,
      returnedDate: r?.returnedDate || null,
      issue: cleanText(r?.issue),
    };
    const bad = !rep.id || !isISODate(rep.sentDate) || compareISO(rep.sentDate, maxDate) > 0
      || (isISODate(startRef) && compareISO(rep.sentDate, startRef) < 0)
      || (rep.returnedDate !== null && (!isISODate(rep.returnedDate) || compareISO(rep.returnedDate, rep.sentDate) < 0 || compareISO(rep.returnedDate, maxDate) > 0))
      || rep.issue.length > LIMITS.issue;
    if (bad) { errors.repairs = 'Revisa las fechas de la reparación.'; continue; }
    if (rep.returnedDate === null) open += 1;
    out.repairs.push(rep);
  }
  if (open > 1) errors.repairs = 'Solo puede haber una reparación en curso.';

  out.createdAt = Number.isInteger(src.createdAt) && src.createdAt > 0 ? src.createdAt : Date.now();
  out.updatedAt = Date.now();
  if (Number.isInteger(src.updatedAt) && src.updatedAt > 0 && src.preserveTimestamps) out.updatedAt = src.updatedAt;

  const ok = Object.keys(errors).length === 0;
  return ok ? { ok, value: out, errors } : { ok, value: null, errors };
}

// Valida el contenido completo de la bóveda tras descifrarla.
export function validateVaultData(data, maxDate) {
  if (!data || typeof data !== 'object' || data.v !== 1 || !Array.isArray(data.items)) {
    return { ok: false, value: null, rejected: 0 };
  }
  const items = [];
  let rejected = 0;
  for (const raw of data.items.slice(0, LIMITS.items)) {
    const res = validateItem({ ...raw, preserveTimestamps: true }, maxDate);
    if (res.ok) items.push(res.value); else rejected += 1;
  }
  const settings = {
    autoLockMinutes: [1, 3, 5, 15].includes(data.settings?.autoLockMinutes) ? data.settings.autoLockMinutes : 3,
  };
  return { ok: true, value: { v: 1, items, settings }, rejected };
}

const COMMON = ['contraseña', 'password', 'qwertyuiop', '1234567890', '0123456789', 'contrasena', 'iloveyou', 'abcdefghij', 'barcelona', 'realmadrid', 'tequiero', 'españa', 'espana'];

// Política de clave: larga antes que complicada. Una frase de 4 palabras
// aleatorias es más fuerte y fácil de recordar que "P@ssw0rd!".
export function checkPassphrase(pass) {
  if (typeof pass !== 'string' || pass.length < 10) {
    return { ok: false, score: 0, message: 'Usa al menos 10 caracteres. Mejor una frase de varias palabras.' };
  }
  const lower = pass.toLowerCase().normalize('NFC');
  if (COMMON.some((c) => lower.includes(c))) {
    return { ok: false, score: 0, message: 'Contiene una contraseña muy común. Prueba con otra frase.' };
  }
  if (/^(.)\1+$/.test(pass)) return { ok: false, score: 0, message: 'No repitas el mismo carácter.' };
  const unique = new Set(pass).size;
  if (unique < 6) return { ok: false, score: 1, message: 'Usa más variedad de caracteres.' };
  let score = 1;
  if (pass.length >= 14) score += 1;
  if (pass.length >= 20) score += 1;
  if (/\s/.test(pass.trim()) || (/[A-Z]/.test(pass) && /[0-9]/.test(pass))) score += 1;
  score = Math.min(4, score);
  const messages = ['', 'Aceptable. Más larga sería mejor.', 'Buena.', 'Muy buena.', 'Excelente.'];
  return { ok: true, score, message: messages[score] };
}
