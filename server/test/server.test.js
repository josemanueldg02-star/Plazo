import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { MemoryStore, FileStore } from '../src/store.js';
import { createVault, openVault, seal, bytesToB64 } from '../../core/vault.js';
import { createSyncClient, SyncError } from '../../core/sync-client.js';

const ORIGIN = 'https://app.plazo.example';
const PASS = 'caballo grapa batería correcto';
const env = (extra = {}) => ({ SERVER_PEPPER: randomBytes(32).toString('base64'), ALLOWED_ORIGINS: ORIGIN, ...extra });

async function start({ store = new MemoryStore(), envExtra = {}, now } = {}) {
  const config = loadConfig(env(envExtra));
  const { server } = createApp(config, store, { now });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  const api = (method, path, body, { token, headers = {}, raw } = {}) => fetch(url + path, {
    method,
    headers: { ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  return { url, store, api, client: createSyncClient(url), close: () => new Promise((r) => server.close(r)) };
}

async function plusAccount(t, data = { v: 1, items: [{ name: 'Nevera Secreta' }] }) {
  const vault = await createVault(PASS, data);
  const accountId = await t.client.register(vault.kdf, vault.authKey);
  await t.store.updateAccount(accountId, { plan: 'plus', planExpiresAt: Date.now() + 86400000 });
  const token = await t.client.openSession(accountId, vault.authKey);
  return { ...vault, accountId, token };
}

test('config: sin secreto o con orígenes inseguros no arranca', () => {
  assert.throws(() => loadConfig({}), /SERVER_PEPPER/);
  assert.throws(() => loadConfig(env({ SERVER_PEPPER: 'corto' })), /SERVER_PEPPER/);
  assert.throws(() => loadConfig(env({ ALLOWED_ORIGINS: 'http://evil.com' })), /Origen/);
  assert.throws(() => loadConfig(env({ ALLOWED_ORIGINS: '*' })), /Origen/);
});

test('cabeceras de seguridad en todas las respuestas', async () => {
  const t = await start();
  try {
    for (const res of [await t.api('GET', '/healthz'), await t.api('GET', '/no-existe')]) {
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
      assert.match(res.headers.get('strict-transport-security'), /max-age=/);
      assert.equal(res.headers.get('x-powered-by'), null);
    }
  } finally { await t.close(); }
});

test('conocimiento cero: otro dispositivo descifra; el servidor nunca ve texto en claro', async () => {
  const t = await start();
  try {
    const a = await plusAccount(t);
    const v1 = await t.client.push(a.token, 0, a.blob);
    assert.equal(v1, 1);

    const b = createSyncClient(t.url);
    const session = await b.login(a.accountId, PASS);
    const remote = await b.pull(session.token);
    const opened = await openVault(PASS, remote.blob);
    assert.deepEqual(opened.data.items[0], { name: 'Nevera Secreta' });

    const everything = JSON.stringify({ a: [...t.store.accounts.values()], v: [...t.store.vaults.values()] });
    assert.ok(!everything.includes('Nevera'), 'el servidor no debe contener texto en claro');
    assert.ok(!everything.includes(bytesToB64(a.authKey)), 'la clave de autenticación no se guarda tal cual');
    assert.deepEqual(Object.keys(t.store.accounts.get(a.accountId)).sort(), ['authHash', 'authSalt', 'createdAt', 'id', 'kdf', 'plan', 'planExpiresAt']);
  } finally { await t.close(); }
});

test('clave incorrecta: 401 genérico y bloqueo progresivo tras 5 fallos', async () => {
  const t = await start();
  try {
    const a = await plusAccount(t);
    const other = createSyncClient(t.url);
    for (let i = 0; i < 5; i++) {
      await assert.rejects(other.login(a.accountId, 'frase equivocada larga'), (e) => e.status === 401 && e.code === 'credenciales');
    }
    const res = await t.api('POST', '/v1/sessions', { accountId: a.accountId, authKey: bytesToB64(a.authKey) });
    assert.equal(res.status, 429, 'bloqueada incluso con la clave correcta');
    assert.ok(Number(res.headers.get('retry-after')) > 0);
  } finally { await t.close(); }
});

test('no revela qué cuentas existen', async () => {
  const t = await start();
  try {
    const a = await plusAccount(t);
    const fakeId = '3f2b8c1e-9d4a-4b7e-8f6a-1c2d3e4f5a6b';
    const r1 = await (await t.api('POST', '/v1/kdf-params', { accountId: fakeId })).json();
    const r2 = await (await t.api('POST', '/v1/kdf-params', { accountId: fakeId })).json();
    const real = await (await t.api('POST', '/v1/kdf-params', { accountId: a.accountId })).json();
    assert.deepEqual(r1, r2, 'parámetros falsos estables');
    assert.deepEqual(Object.keys(r1.kdf), Object.keys(real.kdf));
    assert.equal(r1.kdf.iter, real.kdf.iter);
    const s = await t.api('POST', '/v1/sessions', { accountId: fakeId, authKey: bytesToB64(randomBytes(32)) });
    assert.equal(s.status, 401);
    assert.deepEqual(await s.json(), { error: 'credenciales' });
  } finally { await t.close(); }
});

test('la sincronización exige suscripción activa (402)', async () => {
  const t = await start();
  try {
    const vault = await createVault(PASS, { v: 1, items: [] });
    const id = await t.client.register(vault.kdf, vault.authKey);
    const token = await t.client.openSession(id, vault.authKey);
    await assert.rejects(t.client.pull(token), (e) => e.status === 402);
    await t.store.updateAccount(id, { plan: 'plus', planExpiresAt: Date.now() - 1 });
    await assert.rejects(t.client.pull(token), (e) => e.status === 402, 'suscripción caducada');
  } finally { await t.close(); }
});

test('conflictos entre dispositivos: 409 en vez de pisar datos', async () => {
  const t = await start();
  try {
    const a = await plusAccount(t);
    assert.equal(await t.client.push(a.token, 0, a.blob), 1);
    const newer = await seal(a.encKey, a.kdf, { v: 1, items: [] });
    assert.equal(await t.client.push(a.token, 1, newer), 2);
    await assert.rejects(t.client.push(a.token, 1, newer), (e) => e.status === 409 && e.data.version === 2);
  } finally { await t.close(); }
});

test('rechaza blobs que no son una bóveda válida o con otros parámetros', async () => {
  const t = await start();
  try {
    const a = await plusAccount(t);
    const plain = await t.api('PUT', '/v1/vault', { baseVersion: 0, blob: JSON.stringify({ items: ['texto en claro'] }) }, { token: a.token });
    assert.equal(plain.status, 400);
    assert.equal((await plain.json()).error, 'blob_invalido');
    const foreign = await createVault('otra frase totalmente distinta', {});
    const mism = await t.api('PUT', '/v1/vault', { baseVersion: 0, blob: JSON.stringify(foreign.blob) }, { token: a.token });
    assert.equal((await mism.json()).error, 'kdf_distinto');
  } finally { await t.close(); }
});

test('entrada estricta: tipo, tamaño, JSON, campos y métodos', async () => {
  const t = await start();
  try {
    const vault = await createVault(PASS, {});
    const good = { authKey: bytesToB64(vault.authKey), kdf: vault.kdf };
    assert.equal((await t.api('POST', '/v1/accounts', { ...good, isAdmin: true })).status, 400);
    assert.equal((await t.api('POST', '/v1/accounts', undefined, { raw: '{"a":', headers: {} })).status, 400);
    assert.equal((await t.api('POST', '/v1/accounts', undefined, { raw: JSON.stringify(good), headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await t.api('POST', '/v1/accounts', undefined, { raw: JSON.stringify({ pad: 'x'.repeat(5000) }) })).status, 413);
    assert.equal((await t.api('POST', '/v1/accounts', { ...good, kdf: { ...vault.kdf, iter: 1000 } })).status, 400);
    // El límite de registro se aplica ANTES de validar: las peticiones basura también cuentan.
    assert.equal((await t.api('POST', '/v1/accounts', good)).status, 429);
  } finally { await t.close(); }
  const t2 = await start();
  try {
    const vault = await createVault(PASS, {});
    const good = { authKey: bytesToB64(vault.authKey), kdf: vault.kdf };
    assert.equal((await t2.api('POST', '/v1/accounts', { ...good, authKey: 'AAAA' })).status, 400);
    assert.equal((await t2.api('POST', '/v1/accounts', [1, 2])).status, 400);
    assert.equal((await t2.api('POST', '/v1/kdf-params', { accountId: 'x'.repeat(65) })).status, 400);
    assert.equal((await t2.api('GET', '/v1/accounts')).status, 405);
    assert.equal((await t2.api('GET', '/v1/../etc/passwd')).status, 404);
  } finally { await t2.close(); }
});

test('tokens: formato estricto, caducidad y cierre de sesión', async () => {
  let clock = Date.now();
  const t = await start({ now: () => clock });
  try {
    const a = await plusAccount(t);
    assert.equal((await t.api('GET', '/v1/vault', undefined, { headers: { Authorization: 'Bearer x' } })).status, 401);
    assert.equal((await t.api('GET', '/v1/vault', undefined, { headers: { Authorization: 'Basic abc' } })).status, 401);
    assert.equal((await t.api('GET', '/v1/vault', undefined, { token: a.token })).status, 404, 'sesión válida, aún sin datos');
    await t.client.logout(a.token);
    assert.equal((await t.api('GET', '/v1/vault', undefined, { token: a.token })).status, 401, 'token revocado');
    const tok = await t.client.openSession(a.accountId, a.authKey);
    clock += 3601 * 1000;
    assert.equal((await t.api('GET', '/v1/vault', undefined, { token: tok })).status, 401, 'token caducado');
  } finally { await t.close(); }
});

test('máximo 10 sesiones por cuenta: las antiguas se revocan', async () => {
  const t = await start();
  try {
    const a = await plusAccount(t);
    for (let i = 0; i < 10; i++) await t.client.openSession(a.accountId, a.authKey);
    assert.equal((await t.api('GET', '/v1/vault', undefined, { token: a.token })).status, 401);
    const count = [...t.store.sessions.values()].filter((s) => s.accountId === a.accountId).length;
    assert.equal(count, 10);
  } finally { await t.close(); }
});

test('límite de registros por IP', async () => {
  const t = await start();
  try {
    const vault = await createVault(PASS, {});
    const body = { authKey: bytesToB64(vault.authKey), kdf: vault.kdf };
    for (let i = 0; i < 5; i++) assert.equal((await t.api('POST', '/v1/accounts', body)).status, 201);
    const blocked = await t.api('POST', '/v1/accounts', body);
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
  } finally { await t.close(); }
});

test('CORS solo para orígenes autorizados', async () => {
  const t = await start();
  try {
    const ok = await t.api('GET', '/healthz', undefined, { headers: { Origin: ORIGIN } });
    assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
    const evil = await t.api('GET', '/healthz', undefined, { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    assert.equal((await t.api('OPTIONS', '/v1/vault', undefined, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await t.api('OPTIONS', '/v1/vault', undefined, { headers: { Origin: ORIGIN } })).status, 204);
  } finally { await t.close(); }
});

test('derecho de supresión: borrar la cuenta exige la clave y elimina todo', async () => {
  const t = await start();
  try {
    const a = await plusAccount(t);
    await t.client.push(a.token, 0, a.blob);
    const noKey = await t.api('DELETE', '/v1/account', { authKey: bytesToB64(randomBytes(32)) }, { token: a.token });
    assert.equal(noKey.status, 401);
    await t.client.deleteAccount(a.token, a.authKey);
    assert.equal(t.store.accounts.size, 0);
    assert.equal(t.store.vaults.size, 0);
    assert.equal(t.store.sessions.size, 0);
    await assert.rejects(createSyncClient(t.url).login(a.accountId, PASS), (e) => e.status === 401);
  } finally { await t.close(); }
});

test('un error interno no filtra detalles', async () => {
  const store = new MemoryStore();
  store.getSession = async () => { throw new Error('detalle secreto de la base de datos'); };
  const t = await start({ store });
  try {
    const res = await t.api('GET', '/v1/vault', undefined, { token: 'A'.repeat(43) });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.equal(text, '{"error":"interno"}');
  } finally { await t.close(); }
});

test('cliente: rechaza HTTP inseguro y la degradación del KDF por un servidor malicioso', async () => {
  assert.throws(() => createSyncClient('http://plazo.example'), (e) => e instanceof SyncError && e.code === 'url_insegura');
  const evilFetch = async (url) => ({
    ok: true, status: 200,
    json: async () => (url.endsWith('/v1/kdf-params') ? { kdf: { alg: 'PBKDF2-SHA256', iter: 1, salt: bytesToB64(randomBytes(16)) } } : { token: 'x' }),
  });
  const c = createSyncClient('https://evil.example', { fetchImpl: evilFetch });
  await assert.rejects(c.login('3f2b8c1e-9d4a-4b7e-8f6a-1c2d3e4f5a6b', PASS), (e) => e.code === 'kdf_debil');
});

test('FileStore: persiste con permisos 600 y sobrevive a un reinicio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plazo-'));
  const path = join(dir, 'data', 'store.json');
  const s1 = await new FileStore(path).load();
  await s1.createAccount({ id: 'abc', kdf: {}, authSalt: 'x', authHash: 'y', plan: 'free', planExpiresAt: 0, createdAt: 1 });
  await s1.putVault('abc', 0, '{"cifrado":true}');
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
  const s2 = await new FileStore(path).load();
  assert.equal((await s2.getVault('abc')).version, 1);
  assert.ok(!(await readFile(path, 'utf8')).includes('session'));
});
