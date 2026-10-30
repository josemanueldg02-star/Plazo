// Limitación de peticiones en memoria (una instancia). Con varias instancias
// detrás de un balanceador, mover a Redis con la misma interfaz.

export class TokenBucket {
  constructor({ capacity, refillPerSecond, maxKeys = 50000, now = () => Date.now() }) {
    this.capacity = capacity;
    this.refill = refillPerSecond;
    this.maxKeys = maxKeys;
    this.now = now;
    this.buckets = new Map();
  }

  take(key, cost = 1) {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.evict(t);
      b = { tokens: this.capacity, last: t };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.last) / 1000) * this.refill);
    b.last = t;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { ok: true, retryAfter: 0 };
    }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((cost - b.tokens) / this.refill)) };
  }

  evict(t) {
    // Elimina cubos llenos (inactivos) y, si no basta, los más antiguos: memoria acotada ante inundaciones.
    for (const [k, b] of this.buckets) {
      if (b.tokens + ((t - b.last) / 1000) * this.refill >= this.capacity) this.buckets.delete(k);
    }
    const it = this.buckets.keys();
    while (this.buckets.size >= this.maxKeys) this.buckets.delete(it.next().value);
  }
}

// Bloqueo progresivo por cuenta tras fallos de inicio de sesión.
export class LoginGuard {
  constructor({ freeAttempts = 5, baseLockMs = 60000, maxLockMs = 3600000, now = () => Date.now() } = {}) {
    this.free = freeAttempts;
    this.base = baseLockMs;
    this.max = maxLockMs;
    this.now = now;
    this.state = new Map();
  }

  check(key) {
    const s = this.state.get(key);
    if (!s || !s.lockedUntil) return { ok: true, retryAfter: 0 };
    const left = s.lockedUntil - this.now();
    return left > 0 ? { ok: false, retryAfter: Math.ceil(left / 1000) } : { ok: true, retryAfter: 0 };
  }

  fail(key) {
    const s = this.state.get(key) || { failures: 0, lockedUntil: 0 };
    s.failures += 1;
    if (s.failures >= this.free) {
      const lock = Math.min(this.max, this.base * 2 ** (s.failures - this.free));
      s.lockedUntil = this.now() + lock;
    }
    this.state.set(key, s);
  }

  success(key) { this.state.delete(key); }
}
