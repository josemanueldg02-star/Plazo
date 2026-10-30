// Claves PÚBLICAS de confianza para el catálogo de tiendas. Publicarlas es seguro.
// Para rotar: npm run catalog:keygen añade una nueva; cuando todos los catálogos
// estén firmados con ella, borra la antigua y publica una versión nueva de la app.
export const CATALOG_KEYS = Object.freeze({
  'plazo-2026-10-30-34tq': { x: '_xGvO3QG_MZESjVg3Ouvb73f1haucyQC-d_DX_P0JeA', y: 'SLD4FQ0B1J_3C5EOHc0BL2g6VV0hYDDm0ZDrYUNsodg' },
});
