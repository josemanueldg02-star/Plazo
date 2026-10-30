// Configuración solo desde variables de entorno: nada sensible en el código.
// Si falta algo crítico, el servidor no arranca (fail fast).

function int(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('Valor numérico fuera de rango: ' + value);
  return n;
}

export function loadConfig(env = process.env) {
  const pepperB64 = env.SERVER_PEPPER || '';
  const pepper = Buffer.from(pepperB64, 'base64');
  if (pepper.length < 32) {
    throw new Error('SERVER_PEPPER debe ser un secreto aleatorio de al menos 32 bytes en base64. Genera uno con: openssl rand -base64 32');
  }
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const o of allowedOrigins) {
    if (!/^(https:\/\/[a-z0-9.-]+(:\d+)?|capacitor:\/\/localhost|http:\/\/localhost(:\d+)?)$/i.test(o)) {
      throw new Error('Origen no permitido en ALLOWED_ORIGINS: ' + o);
    }
  }
  return Object.freeze({
    port: int(env.PORT, 8787, 1, 65535),
    host: env.HOST || '127.0.0.1',
    pepper,
    allowedOrigins,
    trustProxy: env.TRUST_PROXY === 'true',
    dataFile: env.DATA_FILE || null,
    sessionTtlSeconds: int(env.SESSION_TTL_SECONDS, 3600, 60, 86400),
    requireSubscription: env.REQUIRE_SUBSCRIPTION !== 'false',
    maxVaultBodyBytes: int(env.MAX_VAULT_BODY_BYTES, 6 * 1024 * 1024, 1024, 20 * 1024 * 1024),
  });
}
