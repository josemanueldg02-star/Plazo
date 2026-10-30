import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, parsePriceToCents, formatCents, validateItem, validateVaultData, checkPassphrase, newId } from '../validate.js';
import { createVault, openVault, seal, unseal, parseBlob, deriveKeys, b64ToBytes, bytesToB64, VaultError, KDF_ITERATIONS } from '../vault.js';
import { generateClaimLetter } from '../letter.js';

const TODAY = '2026-10-30';
const PASS = 'caballo grapa batería correcto';
const form = (over = {}) => ({
  id: newId(), name: 'Auriculares', store: 'Tienda', price: '299,99', purchaseDate: '2026-10-20',
  deliveryDate: '2026-10-22', channel: 'online', condition: 'nuevo', kind: 'bien', ...over,
});

test('precios en formato español', () => {
  assert.equal(parsePriceToCents('299'), 29900);
  assert.equal(parsePriceToCents('299,99'), 29999);
  assert.equal(parsePriceToCents('1.299,50'), 129950);
  assert.equal(parsePriceToCents('1.299'), 129900);
  assert.equal(parsePriceToCents('12.5'), 1250);
  assert.equal(parsePriceToCents('12 €'), 1200);
  for (const bad of ['abc', '-5', '1,2,3', '1e5', '0x10', 'Infinity']) assert.equal(parsePriceToCents(bad), null, bad);
  assert.equal(formatCents(129950), '1.299,50 €');
  assert.equal(formatCents(29900), '299 €');
});

test('cleanText elimina caracteres de control y marcas bidi', () => {
  assert.equal(cleanText('  Hola\u202Eadnem\u0000  '), 'Holaadnem');
  assert.equal(cleanText('a\n\nb'), 'a b');
  assert.equal(cleanText('a\r\nb', { multiline: true }), 'a\nb');
  assert.equal(cleanText(42), '');
});

test('validateItem acepta un formulario correcto', () => {
  const r = validateItem(form(), TODAY);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.value.priceCents, 29999);
  assert.equal(r.value.agreedGuaranteeYears, null);
});

test('validateItem rechaza datos incoherentes', () => {
  const cases = [
    [{ name: '' }, 'name'],
    [{ name: 'x'.repeat(81) }, 'name'],
    [{ purchaseDate: '2026-11-01' }, 'purchaseDate'],
    [{ purchaseDate: '2026-02-30' }, 'purchaseDate'],
    [{ deliveryDate: '2026-10-01' }, 'deliveryDate'],
    [{ deliveryDate: '2026-12-01' }, 'deliveryDate'],
    [{ channel: 'darkweb' }, 'channel'],
    [{ price: '-3' }, 'price'],
    [{ storeReturnDays: 9999 }, 'storeReturnDays'],
    [{ commercialGuaranteeMonths: 1.5 }, 'commercialGuaranteeMonths'],
    [{ id: '../../etc/passwd' }, 'id'],
    [{ repairs: [{ id: 'rep0000001', sentDate: '2026-10-01', returnedDate: null }] }, 'repairs'],
  ];
  for (const [over, field] of cases) {
    const r = validateItem(form(over), TODAY);
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.ok(r.errors[field], field + ' debería fallar con ' + JSON.stringify(over));
  }
});

test('validateItem descarta claves desconocidas y no permite contaminar prototipos', () => {
  const evil = JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}},"extra":"<script>"}');
  const r = validateItem({ ...form(), ...evil }, TODAY);
  assert.ok(r.ok);
  assert.equal(({}).isAdmin, undefined);
  assert.equal(r.value.extra, undefined);
  assert.equal(Object.getPrototypeOf(r.value), Object.prototype);
});

test('el HTML se guarda como texto literal (la defensa está en el renderizado)', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const r = validateItem(form({ name: payload }), TODAY);
  assert.equal(r.value.name, payload);
});

test('validateVaultData filtra elementos inválidos y normaliza ajustes', () => {
  const good = validateItem(form(), TODAY).value;
  const res = validateVaultData({ v: 1, items: [good, { name: 'roto' }], settings: { autoLockMinutes: 999 } }, TODAY);
  assert.ok(res.ok);
  assert.equal(res.value.items.length, 1);
  assert.equal(res.rejected, 1);
  assert.equal(res.value.settings.autoLockMinutes, 3);
  assert.equal(validateVaultData({ v: 2, items: [] }, TODAY).ok, false);
  assert.equal(validateVaultData(null, TODAY).ok, false);
});

test('política de clave', () => {
  assert.equal(checkPassphrase('corta').ok, false);
  assert.equal(checkPassphrase('aaaaaaaaaaaa').ok, false);
  assert.equal(checkPassphrase('mipassword123').ok, false);
  assert.equal(checkPassphrase('1212121212').ok, false);
  const strong = checkPassphrase(PASS);
  assert.ok(strong.ok);
  assert.ok(strong.score >= 3);
});

test('bóveda: cifra, descifra y no deja texto en claro', async () => {
  const data = { v: 1, items: [{ name: 'Nevera Secreta' }] };
  const { blob, encKey, authKey } = await createVault(PASS, data);
  assert.equal(blob.kdf.iter, KDF_ITERATIONS);
  assert.ok(!JSON.stringify(blob).includes('Nevera'));
  assert.equal(authKey.length, 32);
  await assert.rejects(crypto.subtle.exportKey('raw', encKey), 'la clave AES no es extraíble');
  const opened = await openVault(PASS, JSON.stringify(blob));
  assert.deepEqual(opened.data, data);
  assert.deepEqual(opened.authKey, authKey);
});

test('bóveda: clave incorrecta falla sin pistas', async () => {
  const { blob } = await createVault(PASS, { v: 1, items: [] });
  await assert.rejects(openVault('otra frase distinta larga', blob), (e) => e instanceof VaultError && e.code === 'clave_incorrecta');
});

test('bóveda: detecta manipulación del texto cifrado y de la cabecera', async () => {
  const { blob } = await createVault(PASS, { v: 1, items: [] });
  const ct = b64ToBytes(blob.ct); ct[0] ^= 1;
  await assert.rejects(openVault(PASS, { ...blob, ct: bytesToB64(ct) }), (e) => e.code === 'clave_incorrecta');
  const otherSalt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
  await assert.rejects(openVault(PASS, { ...blob, kdf: { ...blob.kdf, salt: otherSalt } }), (e) => e.code === 'clave_incorrecta');
});

test('bóveda: rechaza derivaciones débiles (ataque de degradación)', async () => {
  const { blob } = await createVault(PASS, { v: 1, items: [] });
  assert.throws(() => parseBlob({ ...blob, kdf: { ...blob.kdf, iter: 1000 } }), (e) => e.code === 'kdf_debil');
  await assert.rejects(deriveKeys(PASS, new Uint8Array(16), 1), (e) => e.code === 'kdf_debil');
  assert.throws(() => parseBlob({ ...blob, iv: 'AAAA' }), (e) => e.code === 'formato');
  assert.throws(() => parseBlob('{no json'), (e) => e.code === 'formato');
  assert.throws(() => parseBlob({ ...blob, ct: 'no*base64' }), (e) => e.code === 'formato');
});

test('bóveda: IV distinto en cada cifrado', async () => {
  const { encKey, kdf } = await createVault(PASS, {});
  const a = await seal(encKey, kdf, { x: 1 });
  const b = await seal(encKey, kdf, { x: 1 });
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
  assert.deepEqual(await unseal(encKey, b), { x: 1 });
});

test('bóveda: la misma frase con tildes compuestas o descompuestas abre igual (NFKC)', async () => {
  const composed = 'canci\u00f3n del verano largo';
  const decomposed = 'cancio\u0301n del verano largo';
  const { blob } = await createVault(composed, { ok: true });
  assert.deepEqual((await openVault(decomposed, blob)).data, { ok: true });
});

const item = (over = {}) => validateItem(form({ channel: 'tienda', purchaseDate: '2025-03-10', deliveryDate: null, ...over }), TODAY).value;

test('carta: incluye producto, artículos y presunción cuando aplica', () => {
  const r = generateClaimLetter({ item: item(), consumerName: 'Ana Pérez', issue: 'La pantalla parpadea', issueDate: '2026-10-01', remedy: 'reparacion', today: TODAY });
  assert.ok(r.ok);
  assert.match(r.text, /«Auriculares»/);
  assert.match(r.text, /artículo 120/);
  assert.match(r.text, /artículo 121/);
  assert.match(r.text, /de forma gratuita/);
  assert.match(r.text, /Ana Pérez$/);
});

test('carta: sin presunción después de 2 años, y bloqueada fuera de plazo', () => {
  const old = item({ purchaseDate: '2024-01-15' });
  const r = generateClaimLetter({ item: old, consumerName: 'Ana', issue: 'No enciende', issueDate: '2026-10-01', remedy: 'sustitucion', today: TODAY });
  assert.ok(r.ok);
  assert.doesNotMatch(r.text, /artículo 121/);
  const expired = item({ purchaseDate: '2022-03-01' });
  const late = generateClaimLetter({ item: expired, consumerName: 'Ana', issue: 'No enciende', issueDate: '2026-10-01', remedy: 'reparacion', today: TODAY });
  assert.equal(late.ok, false);
  assert.match(late.errors.general, /después/);
});

test('carta: valida entradas y avisa en rebaja sin reparación previa', () => {
  const bad = generateClaimLetter({ item: item(), consumerName: '', issue: 'x', issueDate: '2030-01-01', remedy: 'regalo', today: TODAY });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.consumerName && bad.errors.issue && bad.errors.issueDate && bad.errors.remedy);
  const rebaja = generateClaimLetter({ item: item(), consumerName: 'Ana', issue: 'Ruido raro', issueDate: '2026-10-01', remedy: 'rebaja', today: TODAY });
  assert.ok(rebaja.ok);
  assert.ok(rebaja.warning);
  const priv = generateClaimLetter({ item: item({ channel: 'particular' }), consumerName: 'Ana', issue: 'Ruido raro', issueDate: '2026-10-01', remedy: 'reparacion', today: TODAY });
  assert.equal(priv.ok, false);
});
