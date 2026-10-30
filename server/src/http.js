import { timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, headers = {}) { super(code); this.status = status; this.code = code; this.headers = headers; }
}

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function corsHeaders(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function send(res, status, body, extra = {}) {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, ...extra, 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

// Lee JSON con límite de tamaño real (no solo el Content-Length declarado).
export async function readJson(req, maxBytes) {
  const type = (req.headers['content-type'] || '').toLowerCase();
  if (!/^application\/json(;\s*charset=utf-8)?$/.test(type)) throw new HttpError(415, 'tipo_no_soportado');
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > maxBytes) throw new HttpError(413, 'demasiado_grande');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'demasiado_grande');
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'json_invalido'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'json_invalido');
  return data;
}

// Rechaza campos desconocidos: el esquema es un contrato cerrado.
export function exactKeys(obj, allowed) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new HttpError(400, 'campo_desconocido');
}

export function b64Exact(value, bytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new HttpError(400, 'formato');
  const buf = Buffer.from(value, 'base64');
  if (buf.length !== bytes) throw new HttpError(400, 'formato');
  return buf;
}

export function safeEqual(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    // Con un único proxy de confianza, la IP real es la ÚLTIMA que añadió ese proxy.
    // La primera la puede inventar el cliente.
    if (typeof fwd === 'string' && fwd.length < 500) {
      const parts = fwd.split(',');
      return parts[parts.length - 1].trim();
    }
  }
  return req.socket.remoteAddress || 'desconocida';
}
