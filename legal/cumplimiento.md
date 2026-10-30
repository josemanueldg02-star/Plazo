# Lista de cumplimiento antes de publicar

Estado a fecha de este borrador. ✅ resuelto en el código · ⏳ pendiente · ⚖️ requiere revisión profesional.

## Protección de datos (RGPD y LOPDGDD)

- ✅ **Privacidad desde el diseño y por defecto (art. 25):** modo local sin tratamiento; Plus sin email ni nombre; el servidor no puede leer nada.
- ✅ **Derecho de supresión (art. 17):** borrado completo desde la app, en local y en el servidor (`DELETE /v1/account`, exige reconfirmar la clave).
- ✅ **Portabilidad (art. 20):** exportación de los datos en JSON desde Ajustes.
- ✅ **Minimización en registros:** el servidor no registra IPs, tokens ni cuerpos de petición.
- ✅ **Edad mínima de 14 años** para cuentas Plus (art. 7 LOPDGDD) recogida en la política. ⏳ Falta la casilla en la pantalla de alta de Plus.
- ✅ **Brechas de seguridad:** al estar los datos cifrados, el art. 34.3.a permite no comunicar la brecha a cada usuario si los datos son ininteligibles. Sigue siendo obligatorio documentarla y valorar la notificación a la AEPD en 72 horas (art. 33). ⏳ Redactar el procedimiento interno y quién lo ejecuta.
- ✅ **Evaluación de impacto (art. 35):** no parece obligatoria (sin categorías especiales a gran escala, sin perfiles, sin observación sistemática). ⚖️ Documentar el análisis con la lista de la AEPD.
- ⏳ Contrato de encargo (art. 28) con el proveedor de alojamiento en la UE.

## Comercio electrónico y cookies (LSSI)

- ✅ **Sin cookies ni rastreo:** el almacenamiento local es estrictamente necesario para el servicio que pide el usuario, por lo que no requiere banner de consentimiento (art. 22.2 LSSI).
- ✅ **Fuente tipográfica alojada en la propia app:** cargar Google Fonts desde los servidores de Google envía la IP del usuario a un tercero (un tribunal de Múnich condenó por ello a una web en 2022).
- ⏳ Rellenar el aviso legal (art. 10 LSSI).

## Consumo (suscripción propia)

- ⚖️ Precios con IVA incluido, información precontractual, renovación y desistimiento en servicios digitales.
- ✅ Baja tan sencilla como el alta: se gestiona desde la tienda de aplicaciones.

## Tiendas de aplicaciones

- ⏳ **Apple:** borrado de cuenta dentro de la app (ya implementado en el servidor; falta la pantalla en la app nativa). Etiqueta de privacidad: «Datos no recopilados» en el modo gratuito.
- ⏳ **Google Play:** formulario de seguridad de los datos y enlace web para solicitar el borrado.

## Accesibilidad

- ✅ Auditoría automática con axe-core sin fallos graves, contraste WCAG AA, foco visible, movimiento reducido y etiquetas en todos los campos.
- ⚖️ Comprobar si aplica la Ley 11/2023 de accesibilidad de productos y servicios (las microempresas que prestan servicios están exentas).

## Catálogo de políticas de tiendas

- ✅ Solo se publican datos de hecho (días, desde cuándo y enlace a la fuente), no los textos de las tiendas, que tienen derechos de autor.
- ✅ Cada entrada muestra la fecha de consulta y el enlace oficial, con aviso de que vale la política vigente el día de la compra.
- ✅ Nunca reduce los derechos legales: el desistimiento de 14 días se calcula aparte.
- ⚖️ Si una tienda pide retirar o corregir su ficha, hay que atenderlo con rapidez. Valorar un canal de contacto para tiendas.
- ⚖️ Si en el futuro se cobra a las tiendas por «ficha verificada», debe quedar claro que no altera el cálculo y que no es publicidad encubierta.

## Riesgos de negocio a evitar

- ⚖️ **No** vender «garantías extendidas» ni seguros con afiliación sin revisar la normativa de distribución de seguros: es una actividad regulada.
- ✅ Sin publicidad ni venta de datos: la confianza es el producto.
