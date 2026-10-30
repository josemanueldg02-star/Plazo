// Escáner de secretos sin dependencias. Se ejecuta en el hook pre-commit y en CI.
//   node scripts/check-secrets.mjs           -> revisa todos los ficheros versionados
//   node scripts/check-secrets.mjs --staged  -> solo lo que vas a commitear
// Complementa (no sustituye) a gitleaks en CI.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const staged = process.argv.includes('--staged');
const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files'];
const files = execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);

const RULES = [
  ['clave privada', /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['clave de AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['token de GitHub', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['clave de Stripe', /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ['clave de Google', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['token de Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['asignación de secreto', /\b(SERVER_PEPPER|SECRET|PASSWORD|PASSWD|API_KEY|TOKEN|PRIVATE_KEY)\s*[=:]\s*['"]?(?!cambia-esto)[A-Za-z0-9+/_=-]{20,}/i],
  ['clave privada JWK', /"d"\s*:\s*"[A-Za-z0-9_-]{40,}"/],
  ['URL con credenciales', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]{6,}@/i],
];
const FORBIDDEN_FILES = [/(^|\/)\.env$/, /(^|\/)\.env\.(?!example$)/, /\.(pem|key|p12|pfx|keystore|jks|jwk)$/, /(^|\/)data\//];
const SKIP = [/\.(png|jpg|jpeg|gif|webp|woff2?|ico|zip)$/, /^scripts\/check-secrets\.mjs$/];

let problems = 0;
for (const file of files) {
  if (FORBIDDEN_FILES.some((re) => re.test(file))) { console.error('✖ ' + file + ': este tipo de fichero no debe versionarse'); problems++; continue; }
  if (SKIP.some((re) => re.test(file))) continue;
  let text;
  try { if (statSync(file).size > 2_000_000) continue; text = readFileSync(file, 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of RULES) {
      if (re.test(line)) { console.error('✖ ' + file + ':' + (i + 1) + ' posible ' + name); problems++; }
    }
  });
}
if (problems) {
  console.error('\n' + problems + ' posible(s) secreto(s). Muévelos a .env (ignorado por git) y vuelve a intentarlo.');
  process.exit(1);
}
console.log('✔ Sin secretos detectados en ' + files.length + ' ficheros' + (staged ? ' preparados' : '') + '.');
