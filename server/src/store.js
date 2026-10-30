// Almacenamiento. Interfaz asíncrona para poder cambiar a PostgreSQL
// (ver server/schema.sql) sin tocar la lógica de la API.
import { writeFile, rename, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class MemoryStore {
  constructor() {
    this.accounts = new Map(); // id -> { id, authSalt, authHash, kdf, plan, planExpiresAt, createdAt }
    this.vaults = new Map();   // id -> { version, blob, updatedAt }
    this.sessions = new Map(); // sha256(token) -> { accountId, expiresAt, createdAt }
  }

  async createAccount(acc) {
    if (this.accounts.has(acc.id)) throw new Error('duplicado');
    this.accounts.set(acc.id, { ...acc });
    await this.persist();
  }

  async getAccount(id) {
    const a = this.accounts.get(id);
    return a ? { ...a } : null;
  }

  async updateAccount(id, patch) {
    const a = this.accounts.get(id);
    if (!a) return false;
    this.accounts.set(id, { ...a, ...patch, id });
    await this.persist();
    return true;
  }

  async deleteAccount(id) {
    this.accounts.delete(id);
    this.vaults.delete(id);
    for (const [h, s] of this.sessions) if (s.accountId === id) this.sessions.delete(h);
    await this.persist();
  }

  async getVault(id) {
    const v = this.vaults.get(id);
    return v ? { ...v } : null;
  }

  // Compare-and-set: solo escribe si nadie ha escrito antes (evita perder datos entre dispositivos).
  async putVault(id, baseVersion, blob) {
    const current = this.vaults.get(id);
    const version = current ? current.version : 0;
    if (version !== baseVersion) return { ok: false, version };
    const next = { version: version + 1, blob, updatedAt: Date.now() };
    this.vaults.set(id, next);
    await this.persist();
    return { ok: true, version: next.version };
  }

  async createSession(hash, session) { this.sessions.set(hash, { ...session }); }
  async getSession(hash) { const s = this.sessions.get(hash); return s ? { ...s } : null; }
  async deleteSession(hash) { this.sessions.delete(hash); }

  async pruneSessions(accountId, keep, now) {
    const mine = [];
    for (const [h, s] of this.sessions) {
      if (s.expiresAt <= now) { this.sessions.delete(h); continue; }
      if (s.accountId === accountId) mine.push([h, s]);
    }
    mine.sort((a, b) => a[1].createdAt - b[1].createdAt);
    while (mine.length > keep) this.sessions.delete(mine.shift()[0]);
  }

  async persist() {}
}

// Persistencia en un fichero JSON con escritura atómica y permisos 600.
// Válido para una sola instancia; para escalar horizontalmente, PostgreSQL.
export class FileStore extends MemoryStore {
  constructor(path) {
    super();
    this.path = path;
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8'));
      for (const a of raw.accounts || []) this.accounts.set(a.id, a);
      for (const [id, v] of raw.vaults || []) this.vaults.set(id, v);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    return this;
  }

  async persist() {
    const snapshot = JSON.stringify({ accounts: [...this.accounts.values()], vaults: [...this.vaults.entries()] });
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const tmp = this.path + '.' + process.pid + '.tmp';
      await writeFile(tmp, snapshot, { mode: 0o600 });
      await rename(tmp, this.path);
    });
    return this.queue;
  }
}
