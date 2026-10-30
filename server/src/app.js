// API de sincronización de conocimiento cero. El servidor solo guarda:
// id aleatorio de cuenta, hash (scrypt) de la clave de autenticación,
// parámetros de derivación y un blob cifrado que no puede leer.
// No hay email, nombre ni teléfono: no hay datos personales que filtrar.
import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { parseBlob, KDF_ITERATIONS } from '../../core/vault.js';
import { HttpError, b64Exact, clientIp, corsHeaders, exactKeys, readJson, safeEqual, send } from './http.js';
import { LoginGuard, TokenBucket } from './ratelimit.js';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SMALL_BODY = 4096;
const MAX_SESSIONS = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN_RE = /^Bearer ([A-Za-z0-9_-]{43})$/;

const sha256 = (s) => createHash('sha256').update(s).digest('base64');

function validKdf(kdf) {
  if (!kdf || typeof kdf !== 'object') throw new HttpError(400, 'formato');
  exactKeys(kdf, ['alg', 'iter', 'salt']);
  if (kdf.alg !== 'PBKDF2-SHA256' || !Number.isInteger(kdf.iter) || kdf.iter < KDF_ITERATIONS || kdf.iter > 10000000) {
    throw new HttpError(400, 'kdf_debil');
  }
  b64Exact(kdf.salt, 16);
  return { alg: kdf.alg, iter: kdf.iter, salt: kdf.salt };
}

export function createApp(config, store, { log = () => {}, now = () => Date.now() } = {}) {
  const limits = {
    register: new TokenBucket({ capacity: 5, refillPerSecond: 5 / 3600, now }),
    auth: new TokenBucket({ capacity: 20, refillPerSecond: 20 / 60, now }),
    api: new TokenBucket({ capacity: 120, refillPerSecond: 2, now }),
  };
  const guard = new LoginGuard({ now });
  // Sal ficticia para igualar tiempos cuando la cuenta no existe.
  const dummySalt = createHmac('sha256', config.pepper).update('dummy-salt').digest().subarray(0, 16);

  function limit(bucket, key) {
    const r = limits[bucket].take(key);
    if (!r.ok) throw new HttpError(429, 'demasiadas_peticiones', { 'Retry-After': String(r.retryAfter) });
  }

  async function hashAuth(authKey, salt) {
    return scrypt(authKey, salt, 32, SCRYPT);
  }

  async function authenticate(req) {
    const m = TOKEN_RE.exec(req.headers.authorization || '');
    if (!m) throw new HttpError(401, 'no_autenticado');
    const hash = sha256(m[1]);
    const session = await store.getSession(hash);
    if (!session || session.expiresAt <= now()) {
      if (session) await store.deleteSession(hash);
      throw new HttpError(401, 'no_autenticado');
    }
    const account = await store.getAccount(session.accountId);
    if (!account) throw new HttpError(401, 'no_autenticado');
    return { account, sessionHash: hash };
  }

  function requirePlan(account) {
    if (!config.requireSubscription) return;
    if (account.plan === 'plus' && (account.planExpiresAt || 0) > now()) return;
    throw new HttpError(402, 'suscripcion_requerida');
  }

  async function verifyAuthKey(accountId, authKeyB64) {
    const authKey = b64Exact(authKeyB64, 32);
    const lock = guard.check(accountId);
    if (!lock.ok) throw new HttpError(429, 'cuenta_bloqueada_temporalmente', { 'Retry-After': String(lock.retryAfter) });
    const account = UUID_RE.test(accountId) ? await store.getAccount(accountId) : null;
    const salt = account ? Buffer.from(account.authSalt, 'base64') : dummySalt;
    const computed = await hashAuth(authKey, salt);
    const expected = account ? Buffer.from(account.authHash, 'base64') : Buffer.alloc(32);
    if (!account || !safeEqual(computed, expected)) {
      guard.fail(accountId);
      throw new HttpError(401, 'credenciales');
    }
    guard.success(accountId);
    return account;
  }

  const routes = {
    'GET /healthz': async () => [200, { ok: true }],

    'POST /v1/accounts': async (req, ip) => {
      limit('register', ip);
      const body = await readJson(req, SMALL_BODY);
      exactKeys(body, ['authKey', 'kdf']);
      const authKey = b64Exact(body.authKey, 32);
      const kdf = validKdf(body.kdf);
      const id = randomUUID();
      const authSalt = randomBytes(16);
      const authHash = await hashAuth(authKey, authSalt);
      await store.createAccount({
        id, kdf, authSalt: authSalt.toString('base64'), authHash: authHash.toString('base64'),
        plan: 'free', planExpiresAt: 0, createdAt: now(),
      });
      return [201, { accountId: id }];
    },

    // Devuelve los parámetros para derivar la clave en un dispositivo nuevo.
    // Para ids inexistentes responde parámetros falsos pero estables: no revela qué cuentas existen.
    'POST /v1/kdf-params': async (req, ip) => {
      limit('auth', ip);
      const body = await readJson(req, SMALL_BODY);
      exactKeys(body, ['accountId']);
      if (typeof body.accountId !== 'string' || body.accountId.length > 64) throw new HttpError(400, 'formato');
      const account = UUID_RE.test(body.accountId) ? await store.getAccount(body.accountId) : null;
      if (account) return [200, { kdf: account.kdf }];
      const fakeSalt = createHmac('sha256', config.pepper).update('kdf|' + body.accountId).digest().subarray(0, 16);
      return [200, { kdf: { alg: 'PBKDF2-SHA256', iter: KDF_ITERATIONS, salt: fakeSalt.toString('base64') } }];
    },

    'POST /v1/sessions': async (req, ip) => {
      limit('auth', ip);
      const body = await readJson(req, SMALL_BODY);
      exactKeys(body, ['accountId', 'authKey']);
      if (typeof body.accountId !== 'string' || body.accountId.length > 64) throw new HttpError(400, 'formato');
      const account = await verifyAuthKey(body.accountId, body.authKey);
      const token = randomBytes(32).toString('base64url');
      const t = now();
      await store.createSession(sha256(token), { accountId: account.id, createdAt: t, expiresAt: t + config.sessionTtlSeconds * 1000 });
      await store.pruneSessions(account.id, MAX_SESSIONS, t);
      return [201, { token, expiresIn: config.sessionTtlSeconds }];
    },

    'DELETE /v1/sessions/current': async (req, ip) => {
      limit('api', ip);
      const { sessionHash } = await authenticate(req);
      await store.deleteSession(sessionHash);
      return [204, null];
    },

    'GET /v1/vault': async (req, ip) => {
      limit('api', ip);
      const { account } = await authenticate(req);
      requirePlan(account);
      const vault = await store.getVault(account.id);
      if (!vault) return [404, { error: 'sin_datos' }];
      return [200, { version: vault.version, blob: vault.blob }];
    },

    'PUT /v1/vault': async (req, ip) => {
      limit('api', ip);
      const { account } = await authenticate(req);
      requirePlan(account);
      const body = await readJson(req, config.maxVaultBodyBytes);
      exactKeys(body, ['baseVersion', 'blob']);
      if (!Number.isInteger(body.baseVersion) || body.baseVersion < 0) throw new HttpError(400, 'formato');
      if (typeof body.blob !== 'string') throw new HttpError(400, 'formato');
      let parsed;
      try { parsed = parseBlob(body.blob); } catch { throw new HttpError(400, 'blob_invalido'); }
      if (parsed.kdf.salt !== account.kdf.salt || parsed.kdf.iter !== account.kdf.iter) throw new HttpError(400, 'kdf_distinto');
      const r = await store.putVault(account.id, body.baseVersion, JSON.stringify(parsed));
      if (!r.ok) return [409, { error: 'conflicto', version: r.version }];
      return [200, { version: r.version }];
    },

    // Derecho de supresión (art. 17 RGPD): borra todo. Exige reconfirmar la clave.
    'DELETE /v1/account': async (req, ip) => {
      limit('auth', ip);
      const { account } = await authenticate(req);
      const body = await readJson(req, SMALL_BODY);
      exactKeys(body, ['authKey']);
      await verifyAuthKey(account.id, body.authKey);
      await store.deleteAccount(account.id);
      return [204, null];
    },
  };

  const knownPaths = new Set(Object.keys(routes).map((k) => k.split(' ')[1]));

  async function handler(req, res) {
    const started = now();
    const path = (req.url || '').split('?')[0];
    const cors = corsHeaders(req, config.allowedOrigins);
    let status = 500;
    try {
      if (req.method === 'OPTIONS') {
        status = cors['Access-Control-Allow-Origin'] ? 204 : 403;
        send(res, status, null, cors);
        return;
      }
      const route = routes[req.method + ' ' + path];
      if (!route) throw new HttpError(knownPaths.has(path) ? 405 : 404, knownPaths.has(path) ? 'metodo_no_permitido' : 'no_encontrado');
      const [s, body] = await route(req, clientIp(req, config.trustProxy));
      status = s;
      send(res, s, body, cors);
    } catch (err) {
      if (err instanceof HttpError) {
        status = err.status;
        send(res, err.status, { error: err.code }, { ...cors, ...err.headers });
      } else {
        status = 500;
        log({ level: 'error', msg: 'error_interno', name: err && err.name });
        send(res, 500, { error: 'interno' }, cors);
      }
    } finally {
      // Registro mínimo: sin IPs, tokens ni cuerpos (minimización de datos).
      log({ level: 'info', method: req.method, path: knownPaths.has(path) ? path : '(otra)', status, ms: now() - started });
    }
  }

  const server = createServer({ requestTimeout: 30000, headersTimeout: 10000, maxHeaderSize: 8192 }, handler);
  server.keepAliveTimeout = 5000;
  return { server, handler };
}
