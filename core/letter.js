// Genera una carta de reclamación por falta de conformidad (texto plano).
// El resultado se muestra en un <textarea> como valor, nunca como HTML.
import { compareISO, formatDateES, isISODate } from './dates.js';
import { computeDeadlines } from './legal-es.js';
import { cleanText, formatCents } from './validate.js';

export const REMEDIES = {
  reparacion: 'la reparación del producto',
  sustitucion: 'la sustitución del producto por otro igual',
  rebaja: 'una reducción proporcional del precio',
  resolucion: 'la resolución del contrato y la devolución del importe pagado',
};

export function generateClaimLetter({ item, consumerName, issue, issueDate, remedy, today }) {
  const errors = {};
  const name = cleanText(consumerName);
  const problem = cleanText(issue, { multiline: true });
  if (!name || name.length > 80) errors.consumerName = 'Escribe tu nombre completo.';
  if (problem.length < 5 || problem.length > 500) errors.issue = 'Describe el fallo (entre 5 y 500 caracteres).';
  if (!Object.hasOwn(REMEDIES, remedy)) errors.remedy = 'Elige qué quieres pedir.';
  const delivery = item.deliveryDate || item.purchaseDate;
  if (!isISODate(issueDate) || compareISO(issueDate, delivery) < 0 || compareISO(issueDate, today) > 0) {
    errors.issueDate = 'La fecha del fallo debe estar entre la entrega y hoy.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  if (item.channel === 'particular') {
    return { ok: false, errors: { general: 'Las compras a particulares no tienen garantía de consumo: la carta no aplica.' } };
  }
  const { deadlines } = computeDeadlines(item, today);
  const guarantee = deadlines.find((d) => d.id === 'garantia');
  const presumption = deadlines.find((d) => d.id === 'presuncion');
  const repairCover = deadlines.filter((d) => d.id.startsWith('reparacion_'));
  const coveredByRepair = repairCover.some((d) => compareISO(issueDate, d.endDate) <= 0);
  if (compareISO(issueDate, guarantee.endDate) > 0 && !coveredByRepair) {
    return { ok: false, errors: { general: 'El fallo apareció después de que terminara la garantía legal (' + formatDateES(guarantee.endDate) + ').' } };
  }
  if ((remedy === 'rebaja' || remedy === 'resolucion') && !(item.repairs && item.repairs.length)) {
    // No bloquea, pero la ley prioriza reparar o sustituir.
    errors.warning = 'La rebaja o la devolución del dinero normalmente solo proceden si la reparación o sustitución no es posible o no ha funcionado.';
  }

  const store = item.store || 'su establecimiento';
  const priceText = item.priceCents > 0 ? ', por un importe de ' + formatCents(item.priceCents) : '';
  const deliveryText = item.deliveryDate && item.deliveryDate !== item.purchaseDate
    ? ' y que me fue entregado el ' + formatDateES(item.deliveryDate) : '';
  const inPresumption = compareISO(issueDate, presumption.endDate) <= 0;

  const lines = [
    'A la atención de: ' + (item.store ? item.store + ', servicio de atención al cliente' : 'Servicio de atención al cliente'),
    'Fecha: ' + formatDateES(today),
    '',
    'Asunto: Reclamación por falta de conformidad de «' + item.name + '»',
    '',
    'Muy señores míos:',
    '',
    'El ' + formatDateES(item.purchaseDate) + ' adquirí en ' + store + ' el producto «' + item.name + '»' + priceText + deliveryText + '.',
    '',
    'El ' + formatDateES(issueDate) + ' el producto presentó el siguiente problema: ' + problem,
    '',
    'Este fallo se ha manifestado dentro del plazo de garantía legal, que finaliza el ' + formatDateES(guarantee.endDate)
      + ', según el artículo 120 del texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios (Real Decreto Legislativo 1/2007).'
      + (inPresumption ? ' Además, al haberse manifestado dentro del plazo del artículo 121, se presume que la falta de conformidad ya existía en el momento de la entrega.' : ''),
    '',
    'Por ello, conforme a los artículos 117 y siguientes de dicha norma, solicito ' + REMEDIES[remedy]
      + (remedy === 'reparacion' || remedy === 'sustitucion' ? ', de forma gratuita, incluidos los gastos de envío, mano de obra y materiales, en un plazo razonable.' : '.'),
    '',
    'Les ruego que, si recogen el producto, me entreguen un justificante con la fecha de entrega y la descripción del fallo.',
    '',
    'De no obtener una respuesta satisfactoria, acudiré a los servicios de consumo de mi comunidad autónoma, al Sistema Arbitral de Consumo o a la vía judicial.',
    '',
    'Atentamente,',
    name,
  ];
  return { ok: true, text: lines.join('\n'), warning: errors.warning || null };
}
