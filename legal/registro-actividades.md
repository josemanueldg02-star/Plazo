# Registro de actividades de tratamiento (art. 30 RGPD)

> Obligatorio aunque la empresa tenga menos de 250 empleados, porque la sincronización de Plazo Plus es un tratamiento continuo, no ocasional (art. 30.5 RGPD). El modo gratuito no figura porque no hay tratamiento por parte del responsable.

**Responsable:** [NOMBRE], NIF [NIF], [EMAIL]. **Delegado de protección de datos:** no obligatorio según el art. 37 RGPD y el art. 34 LOPDGDD; revisar si cambia la actividad.

## 1. Cuentas y sincronización cifrada (Plazo Plus)

- **Finalidad:** guardar y sincronizar entre dispositivos la copia cifrada del usuario.
- **Base jurídica:** ejecución del contrato (art. 6.1.b).
- **Interesados:** usuarios suscritos.
- **Datos:** identificador aleatorio, hash scrypt de la clave de autenticación, sal y parámetros de derivación, bloque cifrado ilegible para el responsable.
- **Destinatarios:** proveedor de alojamiento [PROVEEDOR] (encargado, contrato art. 28).
- **Transferencias internacionales:** no.
- **Conservación:** mientras exista la cuenta; supresión inmediata al borrarla; copias de seguridad sobrescritas en [30] días.
- **Medidas de seguridad:** cifrado de extremo a extremo (AES-256-GCM, PBKDF2 600.000 iteraciones, HKDF), TLS, hash scrypt con sal única, tokens de sesión guardados como SHA-256, límites de peticiones, bloqueo progresivo, cabeceras de seguridad, mínimo privilegio en base de datos, registros sin datos personales.

## 2. Gestión de suscripciones

- **Finalidad:** comprobar si la suscripción está activa.
- **Base jurídica:** ejecución del contrato.
- **Datos:** identificador de transacción y fecha de caducidad facilitados por Apple o Google.
- **Destinatarios:** ninguno adicional. Apple y Google son responsables independientes del cobro.
- **Conservación:** durante la suscripción y el plazo legal de obligaciones fiscales y de consumo que corresponda. [Confirmar con asesor.]

## 3. Seguridad y prevención de abusos

- **Finalidad:** limitar intentos de acceso y ataques de denegación de servicio.
- **Base jurídica:** interés legítimo (art. 6.1.f) en proteger el servicio y las cuentas.
- **Datos:** dirección IP, solo en memoria durante minutos; no se escribe en registros.
- **Conservación:** se descarta automáticamente al rellenarse el cubo de límite (minutos).

## 4. Atención de derechos y soporte

- **Finalidad:** responder solicitudes por email.
- **Base jurídica:** obligación legal (art. 6.1.c, arts. 12 a 22 RGPD).
- **Datos:** email y contenido de la solicitud.
- **Conservación:** [3] años para acreditar la atención de la solicitud. [Confirmar con asesor.]
