// Firma del catálogo. Solo se usa en tu ordenador (nunca va dentro de la app).
import { readFile } from 'node:fs/promises';
import { bytesToB64 } from '../core/vault.js';

export async function loadPrivateKey(path) {
  const jwk = JSON.parse(await readFile(path, 'utf8'));
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || typeof jwk.kid !== 'string') throw new Error('La clave privada no es una JWK EC P-256 válida con "kid".');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { key, keyId: jwk.kid };
}

export async function signCatalog(data, key, keyId) {
  const payload = new TextEncoder().encode(JSON.stringify(data));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, payload));
  return { v: 1, keyId, payload: bytesToB64(payload), sig: bytesToB64(sig) };
}
