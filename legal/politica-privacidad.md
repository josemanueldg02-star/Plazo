# Política de privacidad de Plazo

> **Borrador técnico.** Redactado a partir de cómo funciona realmente el código. Debe revisarlo un profesional antes de publicar la app. Los campos entre corchetes se rellenan con los datos reales del responsable.

**Última actualización:** [FECHA]

## 1. Quién es el responsable

[NOMBRE O RAZÓN SOCIAL], con NIF [NIF] y domicilio en [DOMICILIO]. Contacto para privacidad: [EMAIL DE PRIVACIDAD].

## 2. Resumen en una frase

En el modo gratuito tus datos no salen de tu móvil: están cifrados con una clave que solo tú conoces y no tenemos ninguna forma de verlos. Si contratas Plazo Plus, guardamos una copia cifrada que tampoco podemos leer.

## 3. Modo gratuito: no tratamos tus datos

Las compras, fechas, precios, tiendas, notas y reparaciones que introduces se guardan únicamente en el almacenamiento de tu dispositivo, cifradas con AES-256-GCM. La clave se obtiene de tu frase de acceso mediante PBKDF2-SHA256 con 600.000 iteraciones y no se guarda en ningún sitio. En este modo la app solo se conecta para descargar la lista pública de políticas de devolución de tiendas. Es el mismo fichero para todos los usuarios y la petición no incluye ningún dato tuyo ni de tus compras: la tienda que eliges se guarda cifrada en tu dispositivo. Como en cualquier visita a una web, nuestro proveedor de alojamiento recibe técnicamente tu dirección IP para entregar el fichero y la conserva [X] días en sus registros de seguridad. La app no usa cookies, no tiene analítica, publicidad ni servicios de terceros.

El nombre que escribes al redactar una carta de reclamación se usa solo para generar el texto en pantalla y no se guarda.

Si eliges una tienda del catálogo, la app guarda junto a tu compra, cifrada, una copia de la política de devoluciones vigente ese día: plazo, fecha de consulta y enlace a la web de la tienda.

## 4. Plazo Plus: qué datos tratamos

| Dato | Para qué | Base jurídica |
|---|---|---|
| Identificador de cuenta aleatorio (no contiene tu nombre ni tu email) | Identificar tu copia en el servidor | Ejecución del contrato (art. 6.1.b RGPD) |
| Resumen criptográfico (scrypt) de una clave de autenticación derivada de tu frase | Comprobar que eres tú al iniciar sesión | Ejecución del contrato |
| Parámetros de derivación (sal aleatoria e iteraciones) | Que otro dispositivo tuyo pueda derivar tu clave | Ejecución del contrato |
| Copia cifrada de tus compras | Sincronización y copia de seguridad | Ejecución del contrato |
| Estado de la suscripción (identificador de la compra y fecha de caducidad facilitados por Apple o Google) | Saber si tu suscripción está activa | Ejecución del contrato |
| Dirección IP, solo en memoria y durante minutos | Limitar intentos y frenar ataques. No se registra en ficheros | Interés legítimo en la seguridad del servicio (art. 6.1.f RGPD) |

No pedimos email, nombre ni teléfono para crear una cuenta. Tratamos la copia cifrada como dato personal aunque no podamos leerla.

## 5. Cuánto tiempo los conservamos

Mientras tu cuenta exista. Si la borras desde la app, eliminamos de inmediato la cuenta, la copia cifrada y las sesiones. Las copias de seguridad del servidor se sobrescriben en un máximo de [30] días. Las sesiones caducan a la hora.

## 6. Con quién los compartimos

Con nuestro proveedor de alojamiento, [PROVEEDOR], que actúa como encargado del tratamiento con contrato conforme al art. 28 RGPD y servidores en la Unión Europea. No vendemos ni cedemos datos, y no hay transferencias internacionales. Apple y Google gestionan el pago de la suscripción como responsables independientes según sus propias políticas.

## 7. Tus derechos

Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad:

- Desde la propia app: «Ajustes > Tus datos» para obtener una copia y «Borrar todos mis datos» para suprimirlos.
- Escribiendo a [EMAIL DE PRIVACIDAD].

Si consideras que no hemos atendido bien tu solicitud, puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).

Importante: como no conocemos tu frase, no podemos recuperar tus datos si la olvidas, ni entregarte una copia legible desde el servidor.

## 8. Menores

Para contratar Plazo Plus debes tener al menos 14 años (art. 7 de la Ley Orgánica 3/2018).

## 9. Decisiones automatizadas

Plazo calcula plazos legales de forma automática en tu dispositivo, pero no toma decisiones con efectos jurídicos sobre ti ni elabora perfiles.

## 10. Seguridad

Cifrado de extremo a extremo, conexión HTTPS obligatoria, bloqueo automático, límites de intentos y una política de seguridad del contenido estricta. El detalle técnico está en SECURITY.md.

## 11. Cambios

Si cambia algo relevante, te lo indicaremos en la app antes de que se aplique.
