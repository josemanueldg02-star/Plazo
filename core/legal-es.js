// Motor de plazos de consumo en España.
// Fuentes: TRLGDCU (RDLeg. 1/2007) tras la reforma del RDL 7/2021 (compras
// desde el 1/1/2022) y Código Civil para compras entre particulares.
// Es una herramienta de orientación: la app lo dice siempre en la interfaz.
import { addDays, addMonths, addYears, compareISO, diffDays, formatDateES, maxISO } from './dates.js';

export const REFORM_DATE = '2022-01-01';
export const CHANNELS = ['tienda', 'online', 'fuera_tienda', 'particular'];
export const CONDITIONS = ['nuevo', 'segunda_mano'];
export const KINDS = ['bien', 'digital'];

const WARN_DAYS = { desistimiento: 3, devolucion: 3 };
const DEFAULT_WARN_DAYS = 30;

function deadline(id, label, endDate, basis, explanation) {
  return { id, label, endDate, basis, explanation };
}

function repairSuspensionDays(repairs, today) {
  let total = 0;
  for (const r of repairs || []) {
    const end = r.returnedDate || today;
    const days = diffDays(r.sentDate, end);
    if (days > 0) total += days;
  }
  return total;
}

function clampAgreedYears(value, maxYears) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return maxYears;
  return Math.min(maxYears, Math.max(1, Math.floor(value)));
}

export function computeDeadlines(item, today) {
  const delivery = item.deliveryDate || item.purchaseDate;
  const post2022 = compareISO(item.purchaseDate, REFORM_DATE) >= 0;
  const deadlines = [];
  const notes = [];

  if (item.channel === 'particular') {
    deadlines.push(deadline('vicios_ocultos', 'Reclamar defectos ocultos',
      addMonths(delivery, 6), 'Art. 1490 del Código Civil',
      'Entre particulares no hay garantía de consumo. Puedes reclamar defectos ocultos graves que no se veían al comprarlo durante 6 meses desde la entrega.'));
    notes.push({ id: 'plataforma', text: 'Si compraste en una plataforma de segunda mano, su protección al comprador es aparte de la ley y suele tener plazos de pocos días.' });
    return finalize(deadlines, notes, today);
  }

  if (item.channel === 'online' || item.channel === 'fuera_tienda') {
    if (item.kind === 'digital') {
      notes.push({ id: 'desistimiento_digital', text: 'En contenido digital pierdes el derecho a devolverlo sin motivo si aceptaste empezar la descarga o el uso antes de que pasaran 14 días.' });
    } else {
      let end = addDays(delivery, 14);
      let basis = 'Arts. 102 y 104 TRLGDCU';
      let explanation = 'Al comprar a distancia o fuera de la tienda puedes devolverlo sin dar explicaciones: 14 días naturales desde que lo recibes.';
      if (item.withdrawalInfoMissing) {
        end = addMonths(end, 12);
        basis = 'Art. 105 TRLGDCU';
        explanation = 'La tienda no te informó del derecho a devolverlo, así que el plazo de 14 días se amplía 12 meses.';
      }
      deadlines.push(deadline('desistimiento', 'Devolverlo sin dar motivos', end, basis, explanation));
      notes.push({ id: 'desistimiento_excepciones', text: 'No se aplica a productos personalizados, perecederos ni a artículos precintados por higiene que ya hayas abierto.' });
    }
  }

  const policy = item.storePolicy;
  if (policy) {
    // Foto de la política publicada por la tienda (catálogo firmado). Solo amplía: el
    // desistimiento legal se sigue calculando aparte y nunca se recorta.
    let end = policy.returnDays ? addDays(policy.countFrom === 'compra' ? item.purchaseDate : delivery, policy.returnDays) : null;
    if (policy.returnUntil) end = end ? maxISO(end, policy.returnUntil) : policy.returnUntil;
    if (end) {
      const how = policy.returnUntil && (!policy.returnDays || end === policy.returnUntil)
        ? 'por su ' + (policy.campaignLabel || 'campaña').toLowerCase()
        : policy.returnDays + ' días desde ' + (policy.countFrom === 'compra' ? 'la compra' : 'la entrega');
      deadlines.push(deadline('devolucion', 'Devolución según ' + policy.storeName, end,
        'Política publicada por ' + policy.storeName + ', consultada el ' + formatDateES(policy.checkedAt),
        policy.storeName + ' permite devolverlo ' + how + '. ' + (policy.note ? policy.note : 'Revisa sus condiciones antes de enviarlo.')));
    } else {
      notes.push({ id: 'politica_vendedor', text: policy.note || 'El plazo de devolución depende del vendedor: revisa su política en tu pedido.' });
    }
    if (compareISO(policy.checkedAt, item.purchaseDate) > 0) {
      notes.push({ id: 'politica_posterior', text: 'La política de ' + policy.storeName + ' se consultó después de tu compra. Si cambió entre medias, vale la que había publicada el día que compraste.' });
    }
  } else if (item.storeReturnDays > 0) {
    deadlines.push(deadline('devolucion', 'Devolución según la tienda',
      addDays(delivery, item.storeReturnDays), 'Política voluntaria de la tienda',
      'En tienda física devolver un producto sin defecto no es un derecho legal: depende de lo que la tienda ofrezca. Conserva el ticket.'));
  }

  const suspension = repairSuspensionDays(item.repairs, today);
  let guaranteeEnd; let presumptionEnd;
  if (item.kind === 'digital') {
    guaranteeEnd = addYears(delivery, 2);
    presumptionEnd = post2022 ? addYears(delivery, 1) : addMonths(delivery, 6);
  } else if (item.condition === 'segunda_mano') {
    const agreed = clampAgreedYears(item.agreedGuaranteeYears, post2022 ? 3 : 2);
    guaranteeEnd = addYears(delivery, agreed);
    presumptionEnd = post2022 ? addYears(delivery, Math.min(2, agreed)) : addMonths(delivery, 6);
  } else {
    guaranteeEnd = addYears(delivery, post2022 ? 3 : 2);
    presumptionEnd = post2022 ? addYears(delivery, 2) : addMonths(delivery, 6);
  }
  guaranteeEnd = addDays(guaranteeEnd, suspension);
  presumptionEnd = addDays(presumptionEnd, suspension);

  deadlines.push(deadline('presuncion', 'Fallos que se presumen de origen', presumptionEnd,
    'Art. 121 TRLGDCU',
    'Hasta esta fecha, si aparece un fallo se presume que ya venía de origen: es la tienda quien tendría que demostrar lo contrario.'));
  deadlines.push(deadline('garantia', 'Garantía legal', guaranteeEnd,
    'Arts. 117, 118 y 120 TRLGDCU',
    'La tienda responde de cualquier fallo que aparezca hasta esta fecha. Puedes pedir reparación o sustitución gratis y, si no se resuelve, una rebaja o la devolución del dinero.'));

  (item.repairs || []).forEach((r, i) => {
    if (!r.returnedDate) {
      notes.push({ id: 'en_reparacion_' + i, text: 'Está en reparación desde el ' + formatDateES(r.sentDate) + ': los plazos de garantía están congelados mientras tanto.' });
      return;
    }
    const end = post2022 ? addYears(r.returnedDate, 1) : addMonths(r.returnedDate, 6);
    deadlines.push(deadline('reparacion_' + i, 'Garantía de la reparación', end,
      'TRLGDCU, régimen de reparación',
      'Tras devolverte el producto reparado, la tienda sigue respondiendo de ese mismo fallo durante ' + (post2022 ? 'un año.' : 'seis meses.')));
  });

  if (item.commercialGuaranteeMonths > 0) {
    deadlines.push(deadline('comercial', 'Garantía comercial adicional',
      addMonths(delivery, item.commercialGuaranteeMonths), 'Art. 127 TRLGDCU',
      'Es voluntaria del fabricante o la tienda. Su alcance depende del documento de garantía: consérvalo.'));
  }

  if (post2022) {
    notes.push({ id: 'prescripcion', text: 'Si un fallo aparece dentro de la garantía, tienes 5 años desde que se manifiesta para reclamarlo (art. 124 TRLGDCU).' });
  }
  if (item.kind === 'bien') {
    notes.push({ id: 'repuestos', text: 'El fabricante debe ofrecer repuestos durante 10 años desde que deja de fabricar el modelo (art. 127 bis TRLGDCU).' });
  }
  notes.push({ id: 'justificante', text: 'Si lo dejas en reparación, pide un justificante con la fecha y el fallo: prueba que el plazo quedó congelado.' });

  return finalize(deadlines, notes, today);
}

function finalize(deadlines, notes, today) {
  // Si la tienda da más tiempo que la ley, el plazo legal sigue existiendo (y no exige
  // condiciones), pero el que importa para "¿aún puedo devolverlo?" es el más largo.
  const legal = deadlines.find((d) => d.id === 'desistimiento');
  const store = deadlines.find((d) => d.id === 'devolucion');
  if (legal && store && compareISO(store.endDate, legal.endDate) > 0) {
    legal.superseded = true;
    legal.explanation += ' Tu tienda te da más tiempo con su propia política.';
  }
  const enriched = deadlines.map((d) => {
    const warnDays = WARN_DAYS[d.id] ?? DEFAULT_WARN_DAYS;
    const daysLeft = diffDays(today, d.endDate);
    const status = daysLeft < 0 ? 'vencido' : daysLeft <= warnDays ? 'pronto' : 'activo';
    return { ...d, daysLeft, status, warnDays };
  });
  enriched.sort((a, b) => compareISO(a.endDate, b.endDate));
  return { deadlines: enriched, notes };
}

// Resumen para la pantalla principal.
export function summarize(items, today) {
  let next = null;
  let protectedCents = 0;
  let soonCount = 0;
  for (const item of items) {
    const { deadlines } = computeDeadlines(item, today);
    const legal = deadlines.find((d) => d.id === 'garantia' || d.id === 'vicios_ocultos');
    if (legal && legal.status !== 'vencido') protectedCents += item.priceCents || 0;
    for (const d of deadlines) {
      if (d.status === 'vencido' || d.superseded) continue;
      if (d.status === 'pronto') soonCount += 1;
      if (!next || compareISO(d.endDate, next.deadline.endDate) < 0) next = { item, deadline: d };
    }
  }
  return { next, protectedCents, soonCount };
}

// Rango para dibujar la línea de tiempo de un producto.
export function timelineRange(item, deadlines, today) {
  const start = item.deliveryDate || item.purchaseDate;
  let end = start;
  for (const d of deadlines) end = maxISO(end, d.endDate);
  end = maxISO(end, today);
  return { start, end, span: Math.max(1, diffDays(start, end)) };
}
