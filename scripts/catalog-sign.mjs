// Valida y firma catalog/catalog.json -> catalog/catalog.signed.json
//   npm run catalog:sign
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, verifySignedCatalog } from '../core/catalog.js';
import { todayISO, compareISO } from '../core/dates.js';
import { loadPrivateKey, signCatalog } from './catalog-lib.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = resolve(process.env.PLAZO_CATALOG_KEY || join(homedir(), '.config', 'plazo', 'catalog-signing-key.jwk'));
const source = JSON.parse(await readFile(join(repo, 'catalog', 'catalog.json'), 'utf8'));
const catalog = validateCatalog(source); // falla si hay cualquier error de edición

if (compareISO(catalog.issuedAt, todayISO()) > 0) { console.error('✖ issuedAt está en el futuro.'); process.exit(1); }
let previousSeq = 0;
try { previousSeq = (await verifySignedCatalog(await readFile(join(repo, 'catalog', 'catalog.signed.json'), 'utf8'))).seq; } catch { /* primero */ }
if (catalog.seq <= previousSeq) { console.error('✖ Sube "seq" por encima de ' + previousSeq + ': las apps rechazan catálogos antiguos.'); process.exit(1); }

const { key, keyId } = await loadPrivateKey(keyPath);
const signed = await signCatalog(source, key, keyId);
await verifySignedCatalog(JSON.stringify(signed)); // comprobación final con las claves públicas de la app
await writeFile(join(repo, 'catalog', 'catalog.signed.json'), JSON.stringify(signed, null, 2) + '\n');
console.log('✔ Catálogo seq ' + catalog.seq + ' firmado con "' + keyId + '" (' + catalog.stores.length + ' tiendas).');
