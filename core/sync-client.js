// Cliente de sincronización (función de pago "Plazo Plus").
// Envía solo: clave de autenticación derivada y blob cifrado.
import { b64ToBytes, bytesToB64, deriveKeys } from './vault.js';

export class SyncError extends Error {
  constructor(code, status = 0, data = null) { super(code); this.name = 'SyncError'; this.code = code; this.status = status; this.data = data; }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createSyncClient(baseUrl, { fetchImpl = globalThis.fetch } = {}) {
  // HTTPS obligatorio; HTTP solo contra localhost para desarrollo.
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) {
    throw new SyncError('url_insegura');
  }

  async function call(method, path, body, token) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetchImpl(baseUrl + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      });
    } catch {
      throw new SyncError('sin_conexion');
    }
    let data = null;
    if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
    if (!res.ok) throw new SyncError((data && typeof data.error === 'string') ? data.error : 'http_' + res.status, res.status, data);
    return data;
  }

  return {
    async register(kdf, authKey) {
      const data = await call('POST', '/v1/accounts', { authKey: bytesToB64(authKey), kdf });
      if (!data || !UUID_RE.test(data.accountId)) throw new SyncError('respuesta_invalida');
      return data.accountId;
    },

    // En un dispositivo nuevo: pide parámetros, deriva claves en local y abre sesión.
    // deriveKeys rechaza parámetros débiles aunque el servidor los envíe.
    async login(accountId, passphrase) {
      if (!UUID_RE.test(accountId)) throw new SyncError('cuenta_invalida');
      const { kdf } = await call('POST', '/v1/kdf-params', { accountId });
      const keys = await deriveKeys(passphrase, b64ToBytes(kdf.salt), kdf.iter);
      const session = await call('POST', '/v1/sessions', { accountId, authKey: bytesToB64(keys.authKey) });
      return { token: session.token, kdf, ...keys };
    },

    async openSession(accountId, authKey) {
      const session = await call('POST', '/v1/sessions', { accountId, authKey: bytesToB64(authKey) });
      return session.token;
    },

    async pull(token) {
      try {
        return await call('GET', '/v1/vault', undefined, token);
      } catch (e) {
        if (e.code === 'sin_datos') return null;
        throw e;
      }
    },

    async push(token, baseVersion, blob) {
      const data = await call('PUT', '/v1/vault', { baseVersion, blob: JSON.stringify(blob) }, token);
      return data.version;
    },

    async logout(token) { await call('DELETE', '/v1/sessions/current', undefined, token); },

    async deleteAccount(token, authKey) { await call('DELETE', '/v1/account', { authKey: bytesToB64(authKey) }, token); },
  };
}
