// Assina o Electron com a assinatura VMP gratuita da castlabs (EVS).
// Sem ela, o Spotify recusa a licença de DRM (HTTP 500) e as faixas saltam sem tocar.
//   Uso:   npm run sign:widevine          (mostra erros e ajuda)
//          node scripts/sign-widevine-electron.mjs --quiet   (usado em `npm run desktop`; nunca falha)
// Passos únicos (a conta é tua, a palavra-passe e o código do email são introduzidos por ti):
//   python -m pip install --upgrade castlabs-evs
//   python -m castlabs_evs.account signup
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const quiet = process.argv.includes('--quiet');
const require = createRequire(import.meta.url);
let dist;
try { dist = path.join(path.dirname(require.resolve('electron/package.json')), 'dist'); } catch { process.exit(quiet ? 0 : 1); }
if (process.platform !== 'win32' || !existsSync(path.join(dist, 'electron.exe')) || !existsSync(path.join(dist, '.wvcus-version'))) {
  if (!quiet) console.log('[vmp] Corre primeiro: npm run setup:widevine');
  process.exit(quiet ? 0 : 1);
}

const python = ['python', 'py', 'python3'].find((name) => spawnSync(name, ['--version'], { stdio: 'ignore' }).status === 0);
const help = () => console.log('[vmp] Para o Spotify tocar dentro da app falta a assinatura VMP (grátis). Passos únicos:\n[vmp]   python -m pip install --upgrade castlabs-evs\n[vmp]   python -m castlabs_evs.account signup\n[vmp]   npm run sign:widevine');
if (!python) { console.log('[vmp] Python 3.7+ não encontrado.'); if (!quiet) help(); process.exit(quiet ? 0 : 1); }

const hasModule = spawnSync(python, ['-c', 'import castlabs_evs.vmp'], { stdio: 'ignore' }).status === 0;
if (!hasModule) { if (!quiet) help(); else console.log('[vmp] Spotify: falta a assinatura VMP (corre npm run sign:widevine para ver os passos).'); process.exit(quiet ? 0 : 1); }

// sign-pkg só pede nova assinatura se a existente for inválida.
// No arranque (--quiet) nunca pode pedir nada: sem terminal interativo (stdin fechado), e depois de uma falha só volta a tentar passadas 12 horas.
const failMarker = path.join(dist, '.vmp-last-fail');
if (quiet && existsSync(failMarker) && Date.now() - Number(readFileSync(failMarker, 'utf8') || 0) < 12 * 3600 * 1000) {
  console.log('[vmp] Spotify: assinatura VMP ainda em falta (corre npm run sign:widevine uma vez e inicia sessão).');
  process.exit(0);
}
const result = spawnSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', dist], quiet ? { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 60000 } : { stdio: 'inherit' });
if (result.status !== 0) {
  if (quiet) {
    writeFileSync(failMarker, String(Date.now()));
    console.log('[vmp] Spotify: não foi possível assinar sem a tua palavra-passe. Corre uma vez: npm run sign:widevine (e, se pedir, python -m castlabs_evs.account reauth).');
    process.exit(0);
  }
  console.log('[vmp] A assinatura falhou. Se for erro de sessão, entra de novo: python -m castlabs_evs.account reauth');
  process.exit(1);
}
rmSync(failMarker, { force: true });
console.log('[vmp] Electron assinado.');
