import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateCatalog, verifySignedCatalog, policySnapshot, variantsFor, isCatalogStale, CatalogError } from '../catalog.js';
import { computeDeadlines, summarize } from '../legal-es.js';
import { validateItem, newId } from '../validate.js';
import { b64ToBytes, bytesToB64 } from '../vault.js';
import { signCatalog } from '../../scripts/catalog-lib.mjs';

const TODAY = '2026-10-30';
const sample = (over = {}) => ({
  v: 1, seq: 5, issuedAt: '2026-10-30', expiresAt: '2027-01-31',
  stores: [{
    id: 'tienda-demo', name: 'Tienda Demo',
    variants: [
      { id: 'propio', label: 'Vendido por la tienda', channels: ['online'], returnDays: 30, countFrom: 'entrega',
        note: 'Sin usar.', source: 'https://tienda.example/devoluciones', checkedAt: '2026-10-20', policyUpdatedAt: null,
        campaigns: [{ id: 'navidad', label: 'Campaña de Navidad', purchaseFrom: '2026-11-01', purchaseTo: '2026-12-31', returnUntil: '2027-01-31' }] },
      { id: 'externo', label: 'Vendedor externo', channels: ['online'], returnDays: null, countFrom: 'entrega',
        note: 'Depende del vendedor.', source: 'https://tienda.example/devoluciones', checkedAt: '2026-10-20', campaigns: [] },
      { id: 'fisica', label: 'Compra en tienda', channels: ['tienda'], returnDays: 7, countFrom: 'compra',
        note: '', source: 'https://tienda.example/devoluciones', checkedAt: '2026-10-20', campaigns: [] },
    ],
  }],
  ...over,
});

async function keypair(kid = 'test-a') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kid, priv: pair.privateKey, keys: { [kid]: { x: pub.x, y: pub.y } } };
}

test('catálogo firmado: se verifica y se normaliza', async () => {
  const k = await keypair();
  const signed = await signCatalog(sample(), k.priv, k.kid);
  const cat = await verifySignedCatalog(JSON.stringify(signed), { keys: k.keys });
  assert.equal(cat.seq, 5);
  assert.equal(cat.stores[0].variants.length, 3);
});

test('catálogo: cualquier cambio tras firmar invalida la firma', async () => {
  const k = await keypair();
  const signed = await signCatalog(sample(), k.priv, k.kid);
  const tampered = new TextDecoder().decode(b64ToBytes(signed.payload)).replace('"returnDays":30', '"returnDays":90');
  const forged = { ...signed, payload: bytesToB64(new TextEncoder().encode(tampered)) };
  await assert.rejects(verifySignedCatalog(forged, { keys: k.keys }), (e) => e.code === 'firma_invalida');
});

test('catálogo: rechaza claves desconocidas o de otro firmante', async () => {
  const k = await keypair('a');
  const intruder = await keypair('a');
  const signed = await signCatalog(sample(), intruder.priv, 'a');
  await assert.rejects(verifySignedCatalog(signed, { keys: k.keys }), (e) => e.code === 'firma_invalida');
  await assert.rejects(verifySignedCatalog({ ...signed, keyId: 'otra' }, { keys: k.keys }), (e) => e.code === 'clave_desconocida');
  await assert.rejects(verifySignedCatalog({ ...signed, keyId: '__proto__' }, { keys: k.keys }), (e) => e.code === 'clave_desconocida');
});

test('catálogo: antirreversión, no acepta una versión anterior a la ya vista', async () => {
  const k = await keypair();
  const old = await signCatalog(sample({ seq: 3 }), k.priv, k.kid);
  await assert.rejects(verifySignedCatalog(old, { keys: k.keys, minSeq: 4 }), (e) => e.code === 'version_antigua');
  assert.equal((await verifySignedCatalog(old, { keys: k.keys, minSeq: 3 })).seq, 3);
});

test('catálogo: formato y tamaño', async () => {
  const k = await keypair();
  const signed = await signCatalog(sample(), k.priv, k.kid);
  await assert.rejects(verifySignedCatalog('{no json', { keys: k.keys }), (e) => e.code === 'formato');
  await assert.rejects(verifySignedCatalog('x'.repeat(600 * 1024), { keys: k.keys }), (e) => e.code === 'demasiado_grande');
  await assert.rejects(verifySignedCatalog({ ...signed, extra: 1 }, { keys: k.keys }), (e) => e.code === 'esquema');
  await assert.rejects(verifySignedCatalog({ ...signed, sig: 'AAAA' }, { keys: k.keys }), (e) => e.code === 'formato');
});

test('catálogo: el esquema rechaza datos peligrosos o incoherentes aunque estén firmados', () => {
  const variant = (over) => sample({ stores: [{ id: 'x1', name: 'X', variants: [{ ...sample().stores[0].variants[0], ...over }] }] });
  const bad = [
    variant({ source: 'javascript:alert(1)' }),
    variant({ source: 'http://tienda.example' }),
    variant({ source: 'https://user:pass@tienda.example' }),
    variant({ returnDays: 0 }),
    variant({ returnDays: 9999 }),
    variant({ countFrom: 'nunca' }),
    variant({ channels: ['particular'] }),
    variant({ checkedAt: '2027-05-05' }),
    variant({ campaigns: [{ id: 'c1', label: 'X', purchaseFrom: '2026-12-31', purchaseTo: '2026-11-01', returnUntil: '2027-01-31' }] }),
    variant({ extra: true }),
    sample({ stores: [sample().stores[0], sample().stores[0]] }),
    sample({ expiresAt: '2026-01-01' }),
    sample({ v: 2 }),
  ];
  for (const c of bad) assert.throws(() => validateCatalog(c), CatalogError, JSON.stringify(c).slice(0, 120));
});

test('foto de la política: aplica la campaña solo si la compra cae dentro', () => {
  const cat = validateCatalog(sample());
  const normal = policySnapshot(cat, 'tienda-demo', 'propio', '2026-10-10');
  assert.equal(normal.returnUntil, null);
  assert.equal(normal.catalogSeq, 5);
  const xmas = policySnapshot(cat, 'tienda-demo', 'propio', '2026-11-20');
  assert.equal(xmas.returnUntil, '2027-01-31');
  assert.equal(xmas.campaignLabel, 'Campaña de Navidad');
  assert.equal(policySnapshot(cat, 'tienda-demo', 'no-existe', '2026-11-20'), null);
  assert.deepEqual(variantsFor(cat.stores[0], 'online').map((v) => v.id), ['propio', 'externo']);
  assert.deepEqual(variantsFor(cat.stores[0], 'tienda').map((v) => v.id), ['fisica']);
  assert.equal(isCatalogStale(cat, '2027-02-01'), true);
  assert.equal(isCatalogStale(cat, TODAY), false);
});

const item = (policy, over = {}, maxDate = TODAY) => validateItem({
  id: newId(), name: 'Monitor', purchaseDate: '2026-10-20', deliveryDate: '2026-10-22', channel: 'online',
  condition: 'nuevo', kind: 'bien', storePolicy: policy, ...over,
}, maxDate);

test('motor: si la tienda da más tiempo, ese es el plazo que manda', () => {
  const cat = validateCatalog(sample());
  const r = item(policySnapshot(cat, 'tienda-demo', 'propio', '2026-10-20'));
  assert.ok(r.ok, JSON.stringify(r.errors));
  const d = computeDeadlines(r.value, TODAY);
  const store = d.deadlines.find((x) => x.id === 'devolucion');
  const legal = d.deadlines.find((x) => x.id === 'desistimiento');
  assert.equal(store.endDate, '2026-11-21');
  assert.equal(legal.endDate, '2026-11-05', 'el plazo legal se sigue mostrando');
  assert.equal(legal.superseded, true);
  assert.equal(summarize([r.value], TODAY).next.deadline.id, 'devolucion');
});

test('motor: una política más corta nunca recorta los 14 días legales', () => {
  const cat = validateCatalog(sample({ stores: [{ id: 'corta', name: 'Corta', variants: [{ ...sample().stores[0].variants[2], channels: ['online'] }] }] }));
  const r = item(policySnapshot(cat, 'corta', 'fisica', '2026-10-20'));
  const d = computeDeadlines(r.value, TODAY);
  assert.equal(d.deadlines.find((x) => x.id === 'devolucion').endDate, '2026-10-27', '7 días desde la compra');
  const legal = d.deadlines.find((x) => x.id === 'desistimiento');
  assert.equal(legal.endDate, '2026-11-05');
  assert.equal(legal.superseded, undefined);
  assert.equal(summarize([r.value], TODAY).next.deadline.id, 'desistimiento');
});

test('motor: vendedor externo sin plazo propio, se mantiene el legal y una nota', () => {
  const cat = validateCatalog(sample());
  const d = computeDeadlines(item(policySnapshot(cat, 'tienda-demo', 'externo', '2026-10-20')).value, TODAY);
  assert.equal(d.deadlines.find((x) => x.id === 'devolucion'), undefined);
  assert.ok(d.deadlines.find((x) => x.id === 'desistimiento'));
  assert.ok(d.notes.some((n) => n.id === 'politica_vendedor'));
});

test('motor: campaña de Navidad amplía hasta la fecha fija', () => {
  const cat = validateCatalog(sample());
  const r = item(policySnapshot(cat, 'tienda-demo', 'propio', '2026-11-20'), { purchaseDate: '2026-11-20', deliveryDate: '2026-11-21' }, '2026-11-25');
  const store = computeDeadlines(r.value, '2026-11-25').deadlines.find((x) => x.id === 'devolucion');
  assert.equal(store.endDate, '2027-01-31');
  assert.match(store.explanation, /campaña de navidad/);
});

test('motor: avisa si la política se consultó después de la compra', () => {
  const cat = validateCatalog(sample());
  const r = item(policySnapshot(cat, 'tienda-demo', 'propio', '2026-10-01'), { purchaseDate: '2026-10-01', deliveryDate: '2026-10-02' });
  assert.ok(computeDeadlines(r.value, TODAY).notes.some((n) => n.id === 'politica_posterior'));
});

test('validación: la foto guardada se revisa como cualquier entrada', () => {
  const cat = validateCatalog(sample());
  const snap = policySnapshot(cat, 'tienda-demo', 'propio', '2026-10-20');
  assert.equal(item({ ...snap, source: 'javascript:alert(1)' }).ok, false);
  assert.equal(item({ ...snap, evil: 1 }).ok, false);
  assert.equal(item({ ...snap, returnDays: -1 }).ok, false);
  assert.equal(item(snap, { channel: 'particular' }).value.storePolicy, null, 'entre particulares no aplica');
  const manual = item(snap, { storeReturnDays: 15 }).value;
  assert.equal(manual.storeReturnDays, null, 'la política del catálogo sustituye al dato manual');
});

test('el catálogo publicado en el repositorio es válido con las claves de la app', async () => {
  const signed = await readFile(new URL('../../catalog/catalog.signed.json', import.meta.url), 'utf8');
  const cat = await verifySignedCatalog(signed);
  const pc = cat.stores.find((s) => s.id === 'pccomponentes');
  assert.equal(pc.variants.find((v) => v.id === 'propio').returnDays, 30);
  assert.equal(pc.variants.find((v) => v.id === 'marketplace').returnDays, null);
  const source = JSON.parse(await readFile(new URL('../../catalog/catalog.json', import.meta.url), 'utf8'));
  assert.equal(source.seq, cat.seq, 'el catálogo firmado corresponde al fichero fuente');
});
