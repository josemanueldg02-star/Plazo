# Seguridad de Plazo

Principio de diseño: **lo que no tenemos no se puede robar.** En lugar de proteger una base de datos llena de información legible, Plazo cifra todo en el dispositivo y el servidor solo almacena bloques que no puede descifrar.

## Arquitectura criptográfica

```
frase del usuario ──PBKDF2-SHA256, 600.000 iteraciones, sal de 16 bytes──▶ secreto maestro (256 bits)
   ├─ HKDF "plazo/v1/enc"  ──▶ clave AES-256-GCM (no extraíble, nunca sale del dispositivo)
   └─ HKDF "plazo/v1/auth" ──▶ clave de autenticación ──▶ servidor: scrypt(N=2^14) con sal propia
```

- Cada cifrado usa un IV aleatorio de 12 bytes. La cabecera (versión, algoritmo, iteraciones, sal) va como dato autenticado: si se manipula, el descifrado falla.
- La frase se normaliza en NFKC para que «canción» produzca la misma clave en iOS, Android y escritorio.
- El cliente **rechaza** derivaciones con menos de 600.000 iteraciones, aunque el servidor las pida. Así un servidor comprometido no puede forzar una clave débil para atacarla por fuerza bruta.

## Modelo de amenazas

| Amenaza | Defensa | Riesgo que queda |
|---|---|---|
| Roban el móvil desbloqueado | Bloqueo automático por inactividad (1 a 15 min) y al salir de la app más de 30 s | Ventana de pocos minutos si el móvil se pierde con la app abierta |
| Extraen el almacenamiento del móvil | Datos cifrados con AES-256-GCM; PBKDF2 encarece cada intento | Una frase débil sigue siendo atacable sin conexión; por eso exigimos 10 caracteres y avisamos de frases comunes |
| Prueban claves en la app | Espera creciente tras 5 fallos (30 s hasta 15 min) | Quien copie el almacenamiento puede saltarse la espera; ver fila anterior |
| Hackean el servidor | Solo hay identificadores aleatorios, hashes scrypt y bloques cifrados; tokens guardados como SHA-256 | Pueden borrar o retener copias (disponibilidad), no leerlas |
| El servidor se vuelve malicioso | Parámetros mínimos verificados en el cliente; bloques autenticados con GCM | Podría servir una versión antigua de la copia (reversión) |
| Inyección de código (XSS) | Nada de inserción de HTML (el build falla si aparece), CSP por hash sin `unsafe-inline`, Trusted Types, `connect-src 'self'` (solo el propio dominio) | Un fallo del propio navegador |
| Clickjacking | `frame-ancestors 'none'` y `X-Frame-Options: DENY` | — |
| Fuerza bruta contra el servidor | Límite por IP, bloqueo progresivo por cuenta, mismo tiempo de respuesta exista o no la cuenta | Botnets con muchas IPs: añadir límites en el proxy o en Redis |
| Descubrir qué cuentas existen | Parámetros falsos y estables para cuentas inexistentes; errores genéricos | — |
| Pérdida de datos entre dispositivos | Escritura condicionada por versión (409 en conflicto) | Fusión de conflictos: pendiente en el cliente |
| Catálogo de tiendas falso o manipulado | Firma ECDSA P-256 verificada en el dispositivo y al construir la app; solo claves incorporadas; esquema estricto tras verificar (enlaces solo https) | Robo de la clave privada de firma: se guarda fuera del repo con permisos 600 |
| Reenvío de un catálogo antiguo (reversión) | Número de secuencia: se rechaza cualquier catálogo anterior al último visto | Un dispositivo que nunca vio el nuevo acepta el último que reciba firmado |
| Saber en qué tiendas compra alguien | El catálogo se descarga entero y es idéntico para todos; la elección se guarda cifrada | El alojamiento ve que alguien descargó el catálogo, como cualquier visita a una web |
| Secretos subidos a GitHub | `.gitignore`, `.env.example`, hook pre-commit, escáner propio y gitleaks en CI | Un secreto pegado en un fichero con otro nombre: por eso hay dos escáneres |
| Dependencias comprometidas | Cero dependencias en tiempo de ejecución | Las herramientas de CI y pruebas |

## Controles del servidor

- Configuración solo por variables de entorno; si falta el secreto, el servidor no arranca.
- JSON estricto: tipo de contenido obligatorio, tamaño máximo real, campos desconocidos rechazados.
- Cabeceras: HSTS, CSP `default-src 'none'`, `nosniff`, `no-referrer`, `no-store`, CORS solo para orígenes declarados.
- Tiempos límite de cabeceras y peticiones contra ataques lentos.
- Errores internos sin detalles: siempre `{"error":"interno"}`.
- Registros sin IPs, tokens ni contenido.

## Limitaciones conocidas (honestas)

1. JavaScript no permite borrar la memoria de forma garantizada; la clave se descarta al bloquear, pero puede quedar en memoria hasta que el recolector la libere.
2. La versión web no usa el chip seguro del móvil. La versión nativa (Capacitor) debe guardar una clave envuelta en Keychain/Keystore con biometría.
3. La clave de autenticación viaja al servidor dentro de TLS. Un protocolo PAKE (OPAQUE) evitaría incluso eso; está en la hoja de ruta.
4. Los límites de peticiones viven en memoria de una instancia. Con varias instancias hay que moverlos a Redis.
5. Sin segundo factor de autenticación ni rotación del secreto `SERVER_PEPPER` todavía.
6. No ha pasado una auditoría externa. Antes de manejar usuarios reales, conviene un pentest independiente.

## Cómo comunicar una vulnerabilidad

Escribe a [EMAIL DE SEGURIDAD] con los pasos para reproducirla. No publiques el fallo hasta que esté corregido; responderemos en un máximo de 72 horas.
