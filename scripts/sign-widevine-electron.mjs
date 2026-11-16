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
import { existsSync } from 'node:fs';

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

// sign-pkg só pede nova assinatura se a existente for inválida
const result = spawnSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', dist], { stdio: 'inherit' });
if (result.status !== 0) {
  console.log('[vmp] A assinatura falhou. Se for erro de sessão, entra de novo: python -m castlabs_evs.account reauth');
  process.exit(quiet ? 0 : 1);
}
console.log('[vmp] Electron assinado.');
