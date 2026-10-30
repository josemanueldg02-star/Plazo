# Plazo

**Que no se te pase ninguna devolución ni garantía.** Plazo apunta tus compras y calcula, con la ley española de consumo, hasta cuándo puedes devolverlas y reclamarlas. Además redacta la carta de reclamación. Todo se guarda cifrado en el móvil: sin cuenta, sin anuncios y sin rastreo.

## Qué calcula

| Situación | Plazo | Fuente |
|---|---|---|
| Compra online, por teléfono o fuera de tienda | 14 días naturales para devolver sin motivo (12 meses más si no te informaron) | Arts. 102, 104 y 105 TRLGDCU |
| Garantía legal de un producto nuevo (compras desde el 1/1/2022) | 3 años desde la entrega | Art. 120 TRLGDCU |
| Presunción de que el fallo viene de origen | 2 primeros años (1 en contenido digital) | Art. 121 TRLGDCU |
| Segunda mano a una empresa | Lo pactado, nunca menos de 1 año (3 si no se pactó nada) | Art. 120 TRLGDCU |
| Producto reparado | Plazo congelado durante la reparación y 1 año más para ese fallo | TRLGDCU tras el RDL 7/2021 |
| Reclamar judicialmente | 5 años desde que aparece el fallo | Art. 124 TRLGDCU |
| Compra a un particular | 6 meses por vicios ocultos | Art. 1490 Código Civil |
| Compras anteriores a 2022 | 2 años de garantía y 6 meses de presunción | Régimen anterior |

Las fechas se cuentan «de fecha a fecha» y, si el mes final no tiene ese día, vencen el último día del mes (art. 5 del Código Civil).

## Arquitectura

```
core/            Lógica compartida, sin dependencias
  dates.js       Fechas civiles en UTC (sin errores por el cambio de hora)
  legal-es.js    Motor de plazos
  validate.js    Validación estricta de toda entrada
  vault.js       Cifrado de conocimiento cero
  letter.js      Carta de reclamación
  catalog.js     Catálogo firmado de políticas de tiendas
  sync-client.js Cliente de sincronización (Plazo Plus)
app/             App móvil (PWA) y su build
server/          API de sincronización cifrada (Node.js, sin dependencias)
catalog/         Catálogo de tiendas (fuente editable y versión firmada)
legal/           Política de privacidad, aviso legal, condiciones, registro de actividades
```

Seguridad y modelo de amenazas: [SECURITY.md](SECURITY.md).

## Puesta en marcha paso a paso

Necesitas Node.js 22 o superior (probado en 22 y en 26, la LTS actual) y Python 3.10 o superior. **No necesitas base de datos ni Docker**: la app guarda todo cifrado en el navegador y el servidor de sincronización, opcional, usa un fichero JSON.

**1. Abre la Terminal del sistema** (en Ubuntu: `Ctrl + Alt + T`; en macOS: la aplicación *Terminal*). Usa esta y no la terminal integrada del editor, para que los procesos en segundo plano no se cierren al cerrar el editor.

**2. Descomprime, crea el repositorio, activa el hook antisecretos y pasa las pruebas** (ajusta la ruta si tu carpeta de descargas se llama `Downloads`):

```bash
unzip ~/Descargas/plazo.zip -d ~
cd ~/plazo
git init
npm run hooks
npm test
```

Deberías ver `pass 65` y `fail 0` (en Node 22 empiezan por `#`; en Node 24 o superior, por `ℹ`).

**3. Pruebas de extremo a extremo (simulan un móvil de 390x844):**

En Ubuntu 23.04 o superior, `pip` no deja instalar paquetes en el Python del sistema, así que se usa un entorno virtual (`.venv/`, ignorado por git):

```bash
sudo apt install -y python3-venv
python3 -m venv .venv
source .venv/bin/activate
pip install playwright==1.56.0
python -m playwright install --with-deps chromium
npm run e2e
```

En sesiones posteriores basta con `source .venv/bin/activate` antes de `npm run e2e`.

Deberías ver `50 de 50 pruebas superadas`.

**4. Abre la app en tu navegador:**

```bash
npm run serve
```

Visita `http://localhost:8080`. Para pararla, vuelve a la Terminal y pulsa `Ctrl + C`.

Para probarla en el móvil no sirve abrir `http://IP-del-portátil:8080`: el cifrado del navegador solo funciona en `https` o en `localhost`. Usa la demo publicada o despliégala con HTTPS.

**5. (Opcional) Arranca el servidor de sincronización.** Primero crea tu `.env`, que git ignora:

```bash
cp .env.example .env
openssl rand -base64 32
```

Abre `.env` con un editor y sustituye `cambia-esto-por-un-secreto-aleatorio` por el texto que imprimió el segundo comando. Después:

```bash
set -a && . ./.env && set +a && npm run server
```

## Catálogo de tiendas

Al elegir una tienda de la lista, Plazo aplica su política de devoluciones publicada y guarda una **foto** de esa política dentro de la compra cifrada. Lo que obliga a la tienda es la política del día en que compraste, no la que publique después.

- **Privacidad:** todo el mundo descarga el mismo fichero completo (`catalog.json`), así que nadie sabe qué tienda eliges.
- **Integridad:** firmado con ECDSA P-256. La app solo acepta las claves públicas de `core/catalog-keys.js` y rechaza catálogos manipulados o más antiguos que el último visto.
- **Regla legal:** una política de tienda solo puede ampliar el plazo; los 14 días legales se calculan aparte y nunca se recortan.
- **Estado actual:** solo PcComponentes, verificado en su página oficial. El resto está en [`catalog/PENDIENTES.md`](catalog/PENDIENTES.md).

Para editar el catálogo, la primera vez genera tu propia clave de firma. La privada se guarda fuera del repositorio, en `~/.config/plazo/`, con permisos 600:

```bash
npm run catalog:keygen
```

Después, cada vez que cambies `catalog/catalog.json` (subiendo `seq`):

```bash
npm run catalog:sign
npm test
```

La clave con la que está firmado el catálogo actual se generó en un entorno temporal que ya no existe: **nadie la tiene**. Cuando generes la tuya, borra la antigua de `core/catalog-keys.js`. Guarda una copia de tu clave privada en un gestor de contraseñas; si se filtra, quítala de `catalog-keys.js` y publica una versión nueva de la app.

## Antes de cada subida a GitHub

```bash
npm run check:secrets
git status
```

Si `git status` muestra `.env`, `data/` o cualquier `.pem`/`.key`, **para**: algo falla en el `.gitignore`. El hook pre-commit bloquea el commit si detecta secretos, y en GitHub lo vuelve a comprobar gitleaks.

## Modelo de negocio

- **Gratis y sin límites:** plazos, avisos y cartas de reclamación, todo en el móvil.
- **Plazo Plus (2,49 €/mes o 19,99 €/año, IVA incluido):** copia cifrada en la nube, varios dispositivos, compras compartidas en familia, escaneo de tickets en el propio móvil y PDF.
- El muro de pago está en el servidor (responde `402` sin suscripción), porque cualquier función de pago calculada en el móvil se puede desbloquear manipulando la app.

## Hoja de ruta

1. App nativa con Capacitor: avisos locales antes de cada vencimiento, clave envuelta en Keychain/Keystore con biometría y escaneo de tickets en el dispositivo.
2. Validación de compras con App Store Server API y Google Play Developer API.
3. Adaptador PostgreSQL (`server/schema.sql`) y límites de peticiones en Redis para varias instancias.
4. Fusión de conflictos entre dispositivos y protección contra reversión.
5. Sustituir la autenticación por OPAQUE y añadir segundo factor.
6. Pentest externo y revisión legal antes del lanzamiento.

## Aviso

Plazo orienta sobre la regla general de la ley; no es asesoramiento jurídico. Los textos de `legal/` son borradores técnicos que debe revisar un profesional.
