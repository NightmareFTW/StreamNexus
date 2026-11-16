// Troca o Electron instalado pela build oficial da castlabs com Widevine (DRM),
// necessária para o Spotify tocar dentro da app. É idempotente: se já estiver instalada, não faz nada.
//   https://github.com/castlabs/electron-releases
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const VERSION = '45.2.1+wvcus';
const FILE = `electron-v${VERSION}-win32-x64.zip`;
const BASE = `https://github.com/castlabs/electron-releases/releases/download/v${encodeURIComponent(VERSION)}`;

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('[widevine] Esta instalação automática só existe para Windows x64; a usar o Electron normal (sem Spotify integrado).');
  process.exit(0);
}

const require = createRequire(import.meta.url);
let electronDir;
try { electronDir = path.dirname(require.resolve('electron/package.json')); } catch { console.error('[widevine] O pacote electron não está instalado. Corre npm install primeiro.'); process.exit(1); }
const dist = path.join(electronDir, 'dist');
const marker = path.join(dist, '.wvcus-version');
if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === VERSION) process.exit(0);

console.log(`[widevine] A instalar o Electron ${VERSION} (Widevine) — descarga única de ~150 MB…`);
const work = path.join(electronDir, '.wvcus-download');
await mkdir(work, { recursive: true });
const zipPath = path.join(work, FILE);
const sha256 = async (file) => { const hash = createHash('sha256'); await pipeline(createReadStream(file), hash); return hash.digest('hex'); };

const sums = await (await fetch(`${BASE}/SHASUMS256.txt`)).text();
const expected = sums.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find(([, name]) => name?.replace(/^\*/, '') === FILE)?.[0];
if (!expected) { console.error('[widevine] Não encontrei o checksum oficial desta build.'); process.exit(1); }

if (!(existsSync(zipPath) && (await sha256(zipPath)) === expected.toLowerCase())) {
  const response = await fetch(`${BASE}/${encodeURIComponent(FILE)}`, { redirect: 'follow' });
  if (!response.ok || !response.body) { console.error(`[widevine] A descarga falhou (${response.status}).`); process.exit(1); }
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  let lastPct = -1;
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => {
    received += chunk.length;
    const pct = total ? Math.floor((received / total) * 10) * 10 : -1;
    if (pct !== lastPct && pct >= 0) { lastPct = pct; console.log(`[widevine] ${pct}%`); }
  });
  await pipeline(source, createWriteStream(zipPath));
}

if ((await sha256(zipPath)) !== expected.toLowerCase()) { console.error('[widevine] O checksum não corresponde; descarga rejeitada.'); await rm(work, { recursive: true, force: true }); process.exit(1); }

const staging = path.join(work, 'dist');
await mkdir(staging, { recursive: true });
const extract = spawnSync(path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe'), ['-xf', FILE, '-C', 'dist'], { cwd: work, stdio: 'inherit' });
if (extract.status !== 0 || !existsSync(path.join(staging, 'electron.exe'))) { console.error('[widevine] Não consegui extrair o Electron.'); process.exit(1); }
await writeFile(path.join(staging, '.wvcus-version'), VERSION);

try {
  await rm(dist, { recursive: true, force: true });
  await rename(staging, dist);
} catch (error) {
  console.error(`[widevine] Não consegui substituir o Electron (a app está aberta?). Fecha o StreamNexus e tenta de novo. ${error.message}`);
  process.exit(1);
}
await rm(work, { recursive: true, force: true });
console.log('[widevine] Pronto.');
