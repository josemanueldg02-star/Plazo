// Bóveda cifrada de conocimiento cero.
// clave del usuario --PBKDF2-SHA256 (600.000 it.)--> secreto maestro
//   --HKDF "plazo/v1/enc"-->  clave AES-256-GCM (nunca sale del dispositivo, no extraíble)
//   --HKDF "plazo/v1/auth"--> clave de autenticación (lo único que ve el servidor de sync)
// El servidor no puede descifrar nada: solo guarda texto cifrado.

export const VAULT_VERSION = 1;
export const KDF_ITERATIONS = 600000; // recomendación OWASP para PBKDF2-HMAC-SHA256
export const MAX_CIPHERTEXT_BYTES = 4 * 1024 * 1024;
const KDF_NAME = 'PBKDF2-SHA256';
const MAX_ITERATIONS = 10000000;

const ENC = new TextEncoder();
const DEC = new TextDecoder('utf-8', { fatal: true });

export class VaultError extends Error {
  constructor(code, message) { super(message || code); this.name = 'VaultError'; this.code = code; }
}

export function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function b64ToBytes(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) {
    throw new VaultError('formato', 'Base64 no válido');
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function normalizePassphrase(pass) {
  if (typeof pass !== 'string' || pass.length === 0) throw new VaultError('clave_vacia');
  // NFKC: la misma frase con tildes produce la misma clave en iOS, Android y escritorio.
  return ENC.encode(pass.normalize('NFKC'));
}

export async function deriveKeys(passphrase, salt, iterations) {
  if (!(salt instanceof Uint8Array) || salt.length !== 16) throw new VaultError('formato', 'Sal no válida');
  if (!Number.isInteger(iterations) || iterations < KDF_ITERATIONS || iterations > MAX_ITERATIONS) {
    // Impide que un servidor malicioso fuerce un KDF débil para robar la clave por fuerza bruta.
    throw new VaultError('kdf_debil', 'Parámetros de derivación inseguros');
  }
  const base = await crypto.subtle.importKey('raw', normalizePassphrase(passphrase), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  const hkdf = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: ENC.encode('plazo/v1/enc') },
    hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const authBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: ENC.encode('plazo/v1/auth') }, hkdf, 256);
  return { encKey, authKey: new Uint8Array(authBits) };
}

function aadFor(kdf) {
  // La cabecera va autenticada: si alguien la manipula, el descifrado falla.
  return ENC.encode('plazo|v' + VAULT_VERSION + '|' + kdf.alg + '|' + kdf.iter + '|' + kdf.salt);
}

export function newKdfParams() {
  return { alg: KDF_NAME, iter: KDF_ITERATIONS, salt: bytesToB64(crypto.getRandomValues(new Uint8Array(16))) };
}

export async function seal(encKey, kdf, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // IV único por cifrado
  const plain = ENC.encode(JSON.stringify(data));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(kdf), tagLength: 128 }, encKey, plain));
  if (ct.length > MAX_CIPHERTEXT_BYTES) throw new VaultError('demasiado_grande');
  return { v: VAULT_VERSION, kdf: { ...kdf }, iv: bytesToB64(iv), ct: bytesToB64(ct) };
}

// Valida la forma del blob sin confiar en él.
export function parseBlob(input) {
  let blob = input;
  if (typeof input === 'string') {
    if (input.length > MAX_CIPHERTEXT_BYTES * 1.4) throw new VaultError('demasiado_grande');
    try { blob = JSON.parse(input); } catch { throw new VaultError('formato'); }
  }
  if (!blob || typeof blob !== 'object' || blob.v !== VAULT_VERSION || !blob.kdf || typeof blob.kdf !== 'object') throw new VaultError('formato');
  const { alg, iter, salt } = blob.kdf;
  if (alg !== KDF_NAME || !Number.isInteger(iter) || iter < KDF_ITERATIONS || iter > MAX_ITERATIONS) throw new VaultError('kdf_debil');
  if (b64ToBytes(salt).length !== 16 || b64ToBytes(blob.iv).length !== 12) throw new VaultError('formato');
  const ctLen = b64ToBytes(blob.ct).length;
  if (ctLen < 16 || ctLen > MAX_CIPHERTEXT_BYTES) throw new VaultError('formato');
  return { v: blob.v, kdf: { alg, iter, salt }, iv: blob.iv, ct: blob.ct };
}

export async function unseal(encKey, input) {
  const blob = parseBlob(input);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(blob.iv), additionalData: aadFor(blob.kdf), tagLength: 128 }, encKey, b64ToBytes(blob.ct));
  } catch {
    throw new VaultError('clave_incorrecta', 'Clave incorrecta o datos manipulados');
  }
  try { return JSON.parse(DEC.decode(plain)); } catch { throw new VaultError('formato'); }
}

export async function createVault(passphrase, data) {
  const kdf = newKdfParams();
  const keys = await deriveKeys(passphrase, b64ToBytes(kdf.salt), kdf.iter);
  const blob = await seal(keys.encKey, kdf, data);
  return { blob, kdf, ...keys };
}

export async function openVault(passphrase, input) {
  const blob = parseBlob(input);
  const keys = await deriveKeys(passphrase, b64ToBytes(blob.kdf.salt), blob.kdf.iter);
  const data = await unseal(keys.encKey, blob);
  return { data, kdf: blob.kdf, ...keys };
}
