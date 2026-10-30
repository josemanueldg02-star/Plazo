# Tiendas pendientes de verificar

Regla: en `catalog.json` solo entra lo leído en la **página oficial** de la tienda, abierta por una persona. Estas notas salen de fuentes secundarias y **no** se publican hasta comprobarlas.

| Tienda | Lo que dicen fuentes secundarias | Por qué no está | Qué verificar |
|---|---|---|---|
| Amazon.es | 30 días desde la entrega para lo vendido o gestionado por Amazon; vendedores externos pueden tener otra política. En Navidad de 2025 amplió hasta el 31 de enero, con plazo distinto para productos Apple | Su web prohíbe el acceso automatizado (robots) | «Devoluciones y reembolsos» en la ayuda de Amazon.es; campaña de Navidad 2026 cuando la publiquen |
| Decathlon | 30 días para vendedores de su Marketplace | Su web bloquea el acceso automatizado | Plazo de productos propios, online y en tienda |
| El Corte Inglés | 14 días habituales y ampliación en electrónica tras el Black Friday | Solo hay referencias de prensa | Política vigente y campaña 2026 |
| Worten | 15 días, 30 con su tarjeta | Solo hay referencias de prensa | Política vigente |

## Cómo añadir una tienda

1. Abre su página oficial de devoluciones en tu navegador.
2. Copia a `catalog.json` solo los **datos**: días, desde cuándo cuentan, a quién se aplica, enlace y fecha. No copies sus textos (tienen derechos de autor).
3. Si cuentan desde el **envío**, usa `"countFrom": "compra"`: da una fecha igual o anterior, nunca posterior. Ante la duda, la app debe quedarse corta, no larga.
4. Campañas solo cuando estén anunciadas oficialmente, con sus fechas exactas.
5. Sube `seq`, ejecuta `npm run catalog:sign` y `npm test`.
