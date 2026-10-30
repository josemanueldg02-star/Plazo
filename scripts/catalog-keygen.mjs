// Genera tu par de claves para firmar el catálogo.
//   npm run catalog:keygen
// La clave PRIVADA se guarda FUERA del repositorio (~/.config/plazo/) con permisos 600.
// La PÚBLICA se añade a core/catalog-keys.js, que sí se versiona.
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = resolve(process.env.PLAZO_CATALOG_KEY || join(homedir(), '.config', 'plazo', 'catalog-signing-key.jwk'));
const rel = relative(repo, keyPath);
if (!rel.startsWith('..') && !isAbsolute(rel)) {
  console.error('✖ La clave privada no puede guardarse dentro del repositorio (' + keyPath + ').');
  process.exit(1);
}
try {
  await access(keyPath);
  if (!process.argv.includes('--force')) { console.error('✖ Ya existe ' + keyPath + '. Usa --force solo si quieres sustituirla.'); process.exit(1); }
} catch { /* no existe: seguimos */ }

const kid = 'plazo-' + new Date().toISOString().slice(0, 10) + '-' + Math.random().toString(36).slice(2, 6);
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const priv = { ...(await crypto.subtle.exportKey('jwk', pair.privateKey)), kid };
const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);

await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
await writeFile(keyPath, JSON.stringify(priv), { mode: 0o600 });

const keysFile = join(repo, 'core', 'catalog-keys.js');
const current = await readFile(keysFile, 'utf8');
const entry = "  '" + kid + "': { x: '" + pub.x + "', y: '" + pub.y + "' },\n";
await writeFile(keysFile, current.replace('export const CATALOG_KEYS = Object.freeze({\n', (m) => m + entry));

console.log('✔ Clave privada: ' + keyPath + ' (permisos 600, fuera de git)');
console.log('✔ Clave pública "' + kid + '" añadida a core/catalog-keys.js');
console.log('  Haz copia de seguridad de la privada en un gestor de contraseñas. Si se pierde, generas otra; si se filtra, bórrala de catalog-keys.js y publica una versión nueva de la app.');
