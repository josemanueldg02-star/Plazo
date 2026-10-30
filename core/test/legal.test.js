import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, addYears, diffDays, parseISODate, formatDateES } from '../dates.js';
import { computeDeadlines, summarize, timelineRange } from '../legal-es.js';

const TODAY = '2026-10-30';
const base = (over = {}) => ({
  id: 'item000001', name: 'Portátil', store: 'Tienda', priceCents: 99900,
  purchaseDate: '2025-03-10', deliveryDate: null, channel: 'tienda', condition: 'nuevo', kind: 'bien',
  agreedGuaranteeYears: null, withdrawalInfoMissing: false, storeReturnDays: null,
  commercialGuaranteeMonths: null, repairs: [], notes: '', ...over,
});
const get = (res, id) => res.deadlines.find((d) => d.id === id);

test('fechas: cómputo de fecha a fecha y fin de mes (art. 5 CC)', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addYears('2024-02-29', 3), '2027-02-28');
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(addMonths('2026-11-15', -11), '2025-12-15');
});

test('fechas: el cambio de hora no altera los días', () => {
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2);
  assert.equal(diffDays('2026-10-24', '2026-10-26'), 2);
});

test('fechas: rechaza fechas imposibles o mal formadas', () => {
  for (const bad of ['2026-02-30', '2026-1-01', '2026-13-01', '1989-12-31', '', null, 20260101, '2026-01-01T00:00']) {
    assert.equal(parseISODate(bad), null, String(bad));
  }
  assert.throws(() => addDays('nope', 1), RangeError);
  assert.equal(formatDateES('2026-11-05'), '5 de noviembre de 2026');
});

test('bien nuevo en tienda tras la reforma: 3 años de garantía y 2 de presunción', () => {
  const r = computeDeadlines(base(), TODAY);
  assert.equal(get(r, 'garantia').endDate, '2028-03-10');
  assert.equal(get(r, 'presuncion').endDate, '2027-03-10');
  assert.equal(get(r, 'desistimiento'), undefined, 'en tienda física no hay desistimiento legal');
  assert.ok(r.notes.some((n) => n.id === 'prescripcion'));
  assert.ok(r.notes.some((n) => n.id === 'repuestos'));
});

test('límite de la reforma: 31/12/2021 son 2 años, 1/1/2022 son 3', () => {
  assert.equal(get(computeDeadlines(base({ purchaseDate: '2021-12-31' }), TODAY), 'garantia').endDate, '2023-12-31');
  assert.equal(get(computeDeadlines(base({ purchaseDate: '2021-12-31' }), TODAY), 'presuncion').endDate, '2022-06-30');
  assert.equal(get(computeDeadlines(base({ purchaseDate: '2022-01-01' }), TODAY), 'garantia').endDate, '2025-01-01');
});

test('compra online: 14 días naturales desde la entrega', () => {
  const r = computeDeadlines(base({ channel: 'online', purchaseDate: '2026-10-20', deliveryDate: '2026-10-22' }), TODAY);
  const d = get(r, 'desistimiento');
  assert.equal(d.endDate, '2026-11-05');
  assert.equal(d.daysLeft, 6);
  assert.equal(d.status, 'activo');
  assert.equal(get(r, 'garantia').endDate, '2029-10-22', 'la garantía cuenta desde la entrega');
});

test('desistimiento: aviso a 3 días, último día incluido, después vencido', () => {
  const item = base({ channel: 'online', purchaseDate: '2026-10-16', deliveryDate: '2026-10-16' });
  assert.equal(get(computeDeadlines(item, '2026-10-27'), 'desistimiento').status, 'pronto');
  const lastDay = get(computeDeadlines(item, '2026-10-30'), 'desistimiento');
  assert.equal(lastDay.daysLeft, 0);
  assert.equal(lastDay.status, 'pronto');
  assert.equal(get(computeDeadlines(item, '2026-10-31'), 'desistimiento').status, 'vencido');
});

test('si no informaron del desistimiento, se amplía 12 meses (art. 105)', () => {
  const r = computeDeadlines(base({ channel: 'fuera_tienda', purchaseDate: '2026-10-22', withdrawalInfoMissing: true }), TODAY);
  assert.equal(get(r, 'desistimiento').endDate, '2027-11-05');
  assert.match(get(r, 'desistimiento').basis, /105/);
});

test('segunda mano: plazo pactado mínimo 1 año; sin pacto, 3 años', () => {
  const pact = computeDeadlines(base({ condition: 'segunda_mano', agreedGuaranteeYears: 1 }), TODAY);
  assert.equal(get(pact, 'garantia').endDate, '2026-03-10');
  assert.equal(get(pact, 'presuncion').endDate, '2026-03-10');
  const noPact = computeDeadlines(base({ condition: 'segunda_mano' }), TODAY);
  assert.equal(get(noPact, 'garantia').endDate, '2028-03-10');
  const tooLow = computeDeadlines(base({ condition: 'segunda_mano', agreedGuaranteeYears: 0 }), TODAY);
  assert.equal(get(tooLow, 'garantia').endDate, '2026-03-10', 'nunca menos de 1 año');
});

test('contenido digital: 2 años, presunción 1 año y sin plazo de desistimiento', () => {
  const r = computeDeadlines(base({ kind: 'digital', channel: 'online' }), TODAY);
  assert.equal(get(r, 'garantia').endDate, '2027-03-10');
  assert.equal(get(r, 'presuncion').endDate, '2026-03-10');
  assert.equal(get(r, 'desistimiento'), undefined);
  assert.ok(r.notes.some((n) => n.id === 'desistimiento_digital'));
  assert.ok(!r.notes.some((n) => n.id === 'repuestos'));
});

test('compra a particular: solo vicios ocultos, 6 meses (art. 1490 CC)', () => {
  const r = computeDeadlines(base({ channel: 'particular', purchaseDate: '2026-08-01' }), TODAY);
  assert.deepEqual(r.deadlines.map((d) => d.id), ['vicios_ocultos']);
  assert.equal(r.deadlines[0].endDate, '2027-02-01');
});

test('reparación: congela la garantía y cubre el mismo fallo 1 año', () => {
  const item = base({ purchaseDate: '2024-01-10', repairs: [{ id: 'rep0000001', sentDate: '2025-02-01', returnedDate: '2025-03-03', issue: 'No carga' }] });
  const r = computeDeadlines(item, TODAY);
  assert.equal(get(r, 'garantia').endDate, '2027-02-09', '3 años + 30 días de reparación');
  assert.equal(get(r, 'reparacion_0').endDate, '2026-03-03');
  assert.equal(get(r, 'reparacion_0').status, 'vencido');
});

test('reparación en curso: el plazo sigue congelado hasta hoy', () => {
  const item = base({ purchaseDate: '2024-01-10', repairs: [{ id: 'rep0000001', sentDate: '2026-10-01', returnedDate: null, issue: '' }] });
  const r = computeDeadlines(item, TODAY);
  assert.equal(get(r, 'garantia').endDate, addDays('2027-01-10', 29));
  assert.ok(r.notes.some((n) => n.id === 'en_reparacion_0'));
});

test('devolución de tienda y garantía comercial', () => {
  const r = computeDeadlines(base({ purchaseDate: '2026-10-15', storeReturnDays: 30, commercialGuaranteeMonths: 60 }), TODAY);
  assert.equal(get(r, 'devolucion').endDate, '2026-11-14');
  assert.equal(get(r, 'comercial').endDate, '2031-10-15');
});

test('los plazos salen ordenados por fecha', () => {
  const r = computeDeadlines(base({ channel: 'online', purchaseDate: '2026-10-20', storeReturnDays: 30, commercialGuaranteeMonths: 60 }), TODAY);
  const dates = r.deadlines.map((d) => d.endDate);
  assert.deepEqual(dates, [...dates].sort());
});

test('resumen: próximo plazo e importe protegido', () => {
  const items = [
    base({ id: 'aaaaaaaa01', name: 'Viejo', purchaseDate: '2021-01-01', priceCents: 10000 }),
    base({ id: 'aaaaaaaa02', name: 'Auriculares', channel: 'online', purchaseDate: '2026-10-25', priceCents: 29999 }),
    base({ id: 'aaaaaaaa03', name: 'Nevera', purchaseDate: '2025-05-01', priceCents: 60000 }),
  ];
  const s = summarize(items, TODAY);
  assert.equal(s.next.item.name, 'Auriculares');
  assert.equal(s.next.deadline.id, 'desistimiento');
  assert.equal(s.protectedCents, 89999);
  assert.equal(summarize([], TODAY).next, null);
});

test('línea de tiempo: abarca de la entrega al último plazo', () => {
  const item = base();
  const r = computeDeadlines(item, TODAY);
  const t = timelineRange(item, r.deadlines, TODAY);
  assert.equal(t.start, '2025-03-10');
  assert.equal(t.end, '2028-03-10');
  assert.equal(t.span, diffDays('2025-03-10', '2028-03-10'));
});
