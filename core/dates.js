// Fechas civiles 'YYYY-MM-DD'. Todo el cálculo se hace en UTC para que el
// cambio de hora (y la diferencia Península/Canarias) nunca desplace un día.
// Cómputo según el art. 5 del Código Civil: los plazos por días excluyen el
// día inicial; los plazos por meses o años van "de fecha a fecha" y, si el mes
// final no tiene ese día, vencen el último día de ese mes.

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_ES_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

function pad2(n) { return String(n).padStart(2, '0'); }

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseISODate(value) {
  if (typeof value !== 'string') return null;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

export function isISODate(value) { return parseISODate(value) !== null; }

function mustParse(value) {
  const p = parseISODate(value);
  if (!p) throw new RangeError('Fecha no válida: ' + String(value));
  return p;
}

function toUTC(p) { return Date.UTC(p.y, p.m - 1, p.d); }

function fromUTC(ms) {
  const dt = new Date(ms);
  return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
}

export function addDays(iso, days) {
  return fromUTC(toUTC(mustParse(iso)) + days * DAY_MS);
}

export function addMonths(iso, months) {
  const p = mustParse(iso);
  const total = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(p.d, daysInMonth(y, m));
  return y + '-' + pad2(m) + '-' + pad2(d);
}

export function addYears(iso, years) { return addMonths(iso, years * 12); }

export function diffDays(fromIso, toIso) {
  return Math.round((toUTC(mustParse(toIso)) - toUTC(mustParse(fromIso))) / DAY_MS);
}

// Las fechas ISO se comparan bien como texto.
export function compareISO(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

export function maxISO(a, b) { return compareISO(a, b) >= 0 ? a : b; }

// Fecha local del dispositivo (no UTC): para el usuario "hoy" es su calendario.
export function todayISO(now = new Date()) {
  return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
}

export function formatDateES(iso) {
  const p = mustParse(iso);
  return p.d + ' de ' + MONTHS_ES[p.m - 1] + ' de ' + p.y;
}

export function formatDateShortES(iso) {
  const p = mustParse(iso);
  return p.d + ' ' + MONTHS_ES_SHORT[p.m - 1] + ' ' + p.y;
}
