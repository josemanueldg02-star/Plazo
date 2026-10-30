// Construye la app sin dependencias externas.
//   dist/pwa  -> app instalable con CSP estricta por hash, Trusted Types y modo sin conexión.
//   dist/demo -> un único HTML autocontenido para publicarlo como demo.
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { verifySignedCatalog } from '../core/catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const MODULES = ['core/dates.js', 'core/legal-es.js', 'core/validate.js', 'core/vault.js', 'core/catalog-keys.js', 'core/catalog.js', 'core/letter.js', 'app/src/main.js'];
const FORBIDDEN = [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function\s*\(/, /setTimeout\(\s*['"`]/];

function fail(msg) { console.error('BUILD ERROR: ' + msg); process.exit(1); }

async function bundle(target, catalogText) {
  const seen = new Map();
  const parts = ["const __PLAZO_TARGET__ = '" + target + "';", 'const __PLAZO_CATALOG__ = ' + JSON.stringify(catalogText) + ';'];
  for (const rel of MODULES) {
    let src = await readFile(join(root, rel), 'utf8');
    for (const re of FORBIDDEN) if (re.test(src)) fail(rel + ' usa un patrón prohibido: ' + re);
    src = src.split('\n').filter((l) => !/^import\s/.test(l)).join('\n');
    src = src.replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, '');
    if (/^\s*(import|export)\s/m.test(src)) fail(rel + ': import/export no soportado por el empaquetador');
    for (const m of src.matchAll(/^(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (seen.has(m[1])) fail('Nombre duplicado "' + m[1] + '" en ' + rel + ' y ' + seen.get(m[1]));
      seen.set(m[1], rel);
    }
    parts.push('// ---- ' + rel + ' ----\n' + src);
  }
  const js = parts.join('\n');
  if (/<\/script/i.test(js)) fail('El script contiene </script>');
  return js;
}

const sha = (s) => "'sha256-" + createHash('sha256').update(s, 'utf8').digest('base64') + "'";

async function build() {
  const font = (await readFile(join(here, 'assets/fonts/bricolage-grotesque-latin.woff2'))).toString('base64');
  const fontFace = "@font-face{font-family:'Bricolage Grotesque';font-style:normal;font-weight:400 700;font-display:swap;"
    + "src:url(data:font/woff2;base64," + font + ") format('woff2');}\n";
  const css = fontFace + await readFile(join(here, 'src/styles.css'), 'utf8');
  if (/<\/style/i.test(css)) fail('El CSS contiene </style>');
  const template = await readFile(join(here, 'src/index.html'), 'utf8');

  // El catálogo se verifica también al construir: una firma rota no llega nunca a producción.
  const catalogText = await readFile(join(root, 'catalog', 'catalog.signed.json'), 'utf8');
  const catalog = await verifySignedCatalog(catalogText).catch((e) => fail('catálogo inválido: ' + e.code));

  await rm(join(root, 'dist'), { recursive: true, force: true });

  for (const target of ['pwa', 'demo']) {
    const js = await bundle(target, catalogText);
    const out = join(root, 'dist', target);
    await mkdir(out, { recursive: true });
    const policy = [
      "default-src 'none'", 'script-src ' + sha(js), 'style-src ' + sha(css), 'font-src data:', "img-src 'self' data:",
      "manifest-src 'self'", "worker-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
      "require-trusted-types-for 'script'", 'trusted-types plazo-sw',
    ].join('; ');
    const pwaHead = [
      '<link rel="manifest" href="manifest.webmanifest">',
      '<link rel="icon" href="icon.svg" type="image/svg+xml">',
      '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
      '<meta name="mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-title" content="Plazo">',
    ].join('\n');
    const html = template
      .replace('<!--CSP-->', target === 'pwa' ? '<meta http-equiv="Content-Security-Policy" content="' + policy + '">' : '')
      .replace('<!--PWA_HEAD-->', target === 'pwa' ? pwaHead : '')
      .replace('/*STYLE*/', () => css)
      .replace('/*SCRIPT*/', () => js);
    await writeFile(join(out, 'index.html'), html);

    if (target === 'pwa') {
      const buildId = createHash('sha256').update(html).digest('hex').slice(0, 12);
      const sw = (await readFile(join(here, 'src/sw.js'), 'utf8')).replace('/*BUILD_ID*/', buildId);
      await writeFile(join(out, 'sw.js'), sw);
      await copyFile(join(here, 'src/manifest.webmanifest'), join(out, 'manifest.webmanifest'));
      await copyFile(join(here, 'src/icon.svg'), join(out, 'icon.svg'));
      await writeFile(join(out, 'catalog.json'), catalogText);
      for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
        await copyFile(join(here, 'assets/icons', f), join(out, f));
      }
      // Cabeceras para el hosting (formato _headers de Cloudflare Pages / Netlify).
      const common = [
        'Strict-Transport-Security: max-age=63072000; includeSubDomains; preload',
        'X-Content-Type-Options: nosniff',
        'Referrer-Policy: no-referrer',
        'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'Cross-Origin-Opener-Policy: same-origin',
        'Cross-Origin-Embedder-Policy: require-corp',
        'Cross-Origin-Resource-Policy: same-origin',
      ];
      const headers = [
        // connect-src 'self': solo el propio dominio (catálogo público y caché del service worker).
        '/*', ...common.map((l) => '  ' + l),
        '  Content-Security-Policy: ' + policy + "; frame-ancestors 'none'", '',
        '/catalog.json', '  Cache-Control: no-cache', '',
        '/sw.js', '  Cache-Control: no-cache', '',
      ].join('\n');
      await writeFile(join(out, '_headers'), headers);
      console.log('pwa  -> dist/pwa (' + Math.round(html.length / 1024) + ' KB, build ' + buildId + ', catálogo seq ' + catalog.seq + ')');
    } else {
      console.log('demo -> dist/demo/index.html (' + Math.round(html.length / 1024) + ' KB)');
    }
  }
}

build().catch((e) => fail(e.stack || String(e)));
