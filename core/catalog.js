// Catálogo de políticas de devolución de tiendas.
// Privacidad: todos los usuarios descargan el MISMO fichero completo; nadie sabe qué tienda eliges.
// Integridad: firmado con ECDSA P-256; la app solo acepta claves que lleva incorporadas.
// Antirreversión: nunca acepta un catálogo con número de secuencia menor que el último visto.
// Regla legal: una política de tienda solo puede AMPLIAR el plazo; el desistimiento legal se calcula aparte.
import { compareISO, isISODate } from './dates.js';
import { cleanText, isSafeHttpsUrl } from './validate.js';
import { b64ToBytes } from './vault.js';
import { CATALOG_KEYS } from './catalog-keys.js';

export const CATALOG_VERSION = 1;
export const MAX_SIGNED_CATALOG_BYTES = 512 * 1024;
const CATALOG_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const CATALOG_CHANNELS = ['tienda', 'online', 'fuera_tienda'];
const CATALOG_DEC = new TextDecoder('utf-8', { fatal: true });

export class CatalogError extends Error {
  constructor(code) { super(code); this.name = 'CatalogError'; this.code = code; }
}

function onlyKeys(obj, allowed) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new CatalogError('esquema');
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new CatalogError('esquema');
}

function text(value, max, { required = true } = {}) {
  const t = cleanText(value);
  if ((required && !t) || t.length > max) throw new CatalogError('esquema');
  return t;
}

function date(value) {
  if (!isISODate(value)) throw new CatalogError('esquema');
  return value;
}

function uniqueIds(list) {
  const ids = new Set(list.map((x) => x.id));
  if (ids.size !== list.length) throw new CatalogError('esquema');
}

// Valida y normaliza el contenido. Se aplica DESPUÉS de comprobar la firma
// y también al firmar: un error de edición no llega nunca a los usuarios.
export function validateCatalog(data) {
  onlyKeys(data, ['v', 'seq', 'issuedAt', 'expiresAt', 'stores']);
  if (data.v !== CATALOG_VERSION || !Number.isInteger(data.seq) || data.seq < 1) throw new CatalogError('esquema');
  const issuedAt = date(data.issuedAt);
  const expiresAt = date(data.expiresAt);
  if (compareISO(expiresAt, issuedAt) <= 0) throw new CatalogError('esquema');
  if (!Array.isArray(data.stores) || data.stores.length > 500) throw new CatalogError('esquema');

  const stores = data.stores.map((s) => {
    onlyKeys(s, ['id', 'name', 'variants']);
    if (!CATALOG_SLUG_RE.test(s.id || '')) throw new CatalogError('esquema');
    if (!Array.isArray(s.variants) || s.variants.length < 1 || s.variants.length > 6) throw new CatalogError('esquema');
    const variants = s.variants.map((v) => {
      onlyKeys(v, ['id', 'label', 'channels', 'returnDays', 'countFrom', 'note', 'source', 'checkedAt', 'policyUpdatedAt', 'campaigns']);
      if (!CATALOG_SLUG_RE.test(v.id || '')) throw new CatalogError('esquema');
      if (!Array.isArray(v.channels) || !v.channels.length || !v.channels.every((c) => CATALOG_CHANNELS.includes(c))) throw new CatalogError('esquema');
      if (v.returnDays !== null && !(Number.isInteger(v.returnDays) && v.returnDays >= 1 && v.returnDays <= 365)) throw new CatalogError('esquema');
      if (!['entrega', 'compra'].includes(v.countFrom)) throw new CatalogError('esquema');
      if (!isSafeHttpsUrl(v.source)) throw new CatalogError('esquema');
      const checkedAt = date(v.checkedAt);
      if (compareISO(checkedAt, issuedAt) > 0) throw new CatalogError('esquema');
      const policyUpdatedAt = v.policyUpdatedAt === undefined || v.policyUpdatedAt === null ? null : date(v.policyUpdatedAt);
      const campaigns = (v.campaigns || []).map((c) => {
        onlyKeys(c, ['id', 'label', 'purchaseFrom', 'purchaseTo', 'returnUntil']);
        if (!CATALOG_SLUG_RE.test(c.id || '')) throw new CatalogError('esquema');
        const from = date(c.purchaseFrom); const to = date(c.purchaseTo); const until = date(c.returnUntil);
        if (compareISO(to, from) < 0 || compareISO(until, to) < 0) throw new CatalogError('esquema');
        return { id: c.id, label: text(c.label, 60), purchaseFrom: from, purchaseTo: to, returnUntil: until };
      });
      if (campaigns.length > 4) throw new CatalogError('esquema');
      uniqueIds(campaigns);
      return {
        id: v.id, label: text(v.label, 60), channels: [...v.channels], returnDays: v.returnDays, countFrom: v.countFrom,
        note: text(v.note || '', 240, { required: false }), source: v.source, checkedAt, policyUpdatedAt, campaigns,
      };
    });
    uniqueIds(variants);
    return { id: s.id, name: text(s.name, 60), variants };
  });
  uniqueIds(stores);
  stores.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return { v: data.v, seq: data.seq, issuedAt, expiresAt, stores };
}

export async function verifySignedCatalog(input, { keys = CATALOG_KEYS, minSeq = 0 } = {}) {
  let signed = input;
  if (typeof input === 'string') {
    if (input.length > MAX_SIGNED_CATALOG_BYTES) throw new CatalogError('demasiado_grande');
    try { signed = JSON.parse(input); } catch { throw new CatalogError('formato'); }
  }
  onlyKeys(signed, ['v', 'keyId', 'payload', 'sig']);
  if (signed.v !== 1 || typeof signed.keyId !== 'string' || typeof signed.payload !== 'string' || typeof signed.sig !== 'string') {
    throw new CatalogError('formato');
  }
  if (!Object.hasOwn(keys, signed.keyId)) throw new CatalogError('clave_desconocida');
  const jwk = keys[signed.keyId];
  let payload; let sig;
  try { payload = b64ToBytes(signed.payload); sig = b64ToBytes(signed.sig); } catch { throw new CatalogError('formato'); }
  if (sig.length !== 64) throw new CatalogError('formato');
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, payload);
  if (!valid) throw new CatalogError('firma_invalida');
  let data;
  try { data = JSON.parse(CATALOG_DEC.decode(payload)); } catch { throw new CatalogError('formato'); }
  const catalog = validateCatalog(data);
  if (catalog.seq < minSeq) throw new CatalogError('version_antigua');
  return catalog;
}

export function isCatalogStale(catalog, today) {
  return compareISO(today, catalog.expiresAt) > 0;
}

export function variantsFor(store, channel) {
  return store ? store.variants.filter((v) => v.channels.includes(channel)) : [];
}

// Foto que se guarda (cifrada) con la compra: lo que vale es la política del día de la compra,
// no la que publique la tienda después.
export function policySnapshot(catalog, storeId, variantId, purchaseDate) {
  const store = catalog.stores.find((s) => s.id === storeId);
  const variant = store && store.variants.find((v) => v.id === variantId);
  if (!variant) return null;
  const campaign = variant.campaigns.find((c) => isISODate(purchaseDate)
    && compareISO(purchaseDate, c.purchaseFrom) >= 0 && compareISO(purchaseDate, c.purchaseTo) <= 0);
  return {
    storeId: store.id, storeName: store.name, variantId: variant.id, variantLabel: variant.label,
    returnDays: variant.returnDays, countFrom: variant.countFrom,
    returnUntil: campaign ? campaign.returnUntil : null, campaignLabel: campaign ? campaign.label : null,
    note: variant.note, source: variant.source, checkedAt: variant.checkedAt,
    policyUpdatedAt: variant.policyUpdatedAt, catalogSeq: catalog.seq,
  };
}
