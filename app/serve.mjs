// Servidor estático local para probar la PWA con las mismas cabeceras que en producción.
// Solo sirve una lista cerrada de ficheros: no hay forma de salir de dist/pwa.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'pwa');
const TYPES = {
  '/index.html': 'text/html; charset=utf-8', '/sw.js': 'text/javascript; charset=utf-8',
  '/manifest.webmanifest': 'application/manifest+json', '/icon.svg': 'image/svg+xml',
  '/catalog.json': 'application/json; charset=utf-8',
  '/icon-192.png': 'image/png', '/icon-512.png': 'image/png', '/icon-maskable-512.png': 'image/png', '/apple-touch-icon.png': 'image/png',
};

function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!line.startsWith(' ')) { current = { path: line.trim(), headers: {} }; rules.push(current); continue; }
    const i = line.indexOf(':');
    current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return rules;
}

const rules = parseHeaders(await readFile(join(dir, '_headers'), 'utf8'));
const port = Number(process.env.PORT || 8080);

createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0] === '/' ? '/index.html' : (req.url || '/').split('?')[0];
  const headers = {};
  for (const r of rules) if (r.path === '/*' || r.path === path) Object.assign(headers, r.headers);
  if (!TYPES[path] || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
    return;
  }
  const body = await readFile(join(dir, path.slice(1)));
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[path], 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(port, '127.0.0.1', () => console.log('Plazo en http://localhost:' + port));
