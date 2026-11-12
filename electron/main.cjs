const { app, BrowserWindow, ipcMain, safeStorage, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');

const RD_API = 'https://api.real-debrid.com/rest/1.0';
const RD_OAUTH = 'https://api.real-debrid.com/oauth/v2';
const SESSION_FILE = 'real-debrid-session.bin';
const INTEGRATIONS_FILE = 'integrations.bin';
const DEV_URL = 'http://127.0.0.1:5173';
const releaseCache = new Map();

let mainWindow;
let authWindow;

function apiUrl(base, resource) {
  if (typeof resource !== 'string' || !resource.startsWith('/') || resource.startsWith('//') || resource.includes('\\') || resource.includes('..')) {
    throw new Error('Pedido Real-Debrid inválido.');
  }
  return `${base}${resource}`;
}

async function requestApi(base, { path: resource, method = 'GET', body, token } = {}) {
  try {
    const response = await fetch(apiUrl(base, resource), {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: body ? new URLSearchParams(body) : undefined,
    });
    if (response.status === 204 || response.status === 202) return { ok: true, data: null };
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (!response.ok) {
      return { ok: false, status: response.status, message: data?.error_description || data?.error || data?.message || `Real-Debrid respondeu com erro ${response.status}.` };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, status: 0, message: error?.message || 'Não foi possível ligar à API Real-Debrid.' };
  }
}

function sessionFilePath() {
  return path.join(app.getPath('userData'), SESSION_FILE);
}

async function readStoredSession() {
  const file = sessionFilePath();
  try {
    const encrypted = await fs.readFile(file);
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('O armazenamento seguro do Windows não está disponível.');
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted);
    const value = JSON.parse(result);
    if (shouldReEncrypt) {
      const replacement = await safeStorage.encryptStringAsync(JSON.stringify(value));
      await fs.writeFile(file, replacement);
    }
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeStoredSession(value) {
  const file = sessionFilePath();
  if (!value) {
    await fs.rm(file, { force: true });
    return true;
  }
  if (!value.access_token || !value.client_id || !value.client_secret || !value.refresh_token) {
    throw new Error('A sessão Real-Debrid está incompleta.');
  }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('O armazenamento seguro do Windows não está disponível.');
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, encrypted);
  return true;
}

function integrationsFilePath() {
  return path.join(app.getPath('userData'), INTEGRATIONS_FILE);
}

async function readIntegrations() {
  try {
    const encrypted = await fs.readFile(integrationsFilePath());
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('O armazenamento seguro do Windows não está disponível.');
    const { result } = await safeStorage.decryptStringAsync(encrypted);
    return JSON.parse(result);
  } catch (error) {
    if (error.code === 'ENOENT') return { prowlarrUrl: '', prowlarrApiKey: '' };
    throw error;
  }
}

async function writeIntegrations(value) {
  const settings = {
    prowlarrUrl: String(value?.prowlarrUrl || '').trim().replace(/\/+$/, ''),
    prowlarrApiKey: String(value?.prowlarrApiKey || '').trim(),
  };
  if (settings.prowlarrUrl) {
    let url;
    try { url = new URL(settings.prowlarrUrl); } catch { throw new Error('O endereço do Prowlarr não é válido.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Usa um endereço HTTP ou HTTPS válido para o Prowlarr.');
  }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('O armazenamento seguro do Windows não está disponível.');
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(settings));
  await fs.mkdir(path.dirname(integrationsFilePath()), { recursive: true });
  await fs.writeFile(integrationsFilePath(), encrypted);
  return { configured: Boolean(settings.prowlarrUrl && settings.prowlarrApiKey) };
}

function pURL(base, pathname) {
  const root = new URL(`${base.replace(/\/+$/, '')}/`);
  return new URL(pathname.replace(/^\/+/, ''), root);
}

async function searchProwlarr({ query, type, categories = [] } = {}) {
  const settings = await readIntegrations();
  if (!settings.prowlarrUrl || !settings.prowlarrApiKey) throw new Error('Configura primeiro o endereço e a API key do Prowlarr.');
  const allowedTypes = new Set(['search', 'tvsearch', 'movie', 'music', 'book']);
  if (!allowedTypes.has(type)) throw new Error('Tipo de pesquisa inválido.');
  const params = new URLSearchParams({ query: String(query || '').slice(0, 160), type });
  for (const category of categories) {
    if (/^\d{3,5}$/.test(String(category))) params.append('categories', String(category));
  }
  const url = pURL(settings.prowlarrUrl, `api/v1/search?${params}`);
  const response = await fetch(url, { headers: { 'X-Api-Key': settings.prowlarrApiKey, Accept: 'application/json' } });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : []; } catch { data = null; }
  if (!response.ok || !Array.isArray(data)) {
    const message = data?.message || data?.error || `Prowlarr respondeu com erro ${response.status}.`;
    throw new Error(message);
  }
  const rows = data.filter((release) => {
    const protocol = String(release.protocol || '').toLowerCase();
    return ['torrent', '1'].includes(protocol) || (!protocol && (String(release.magnetUrl || '').startsWith('magnet:') || String(release.downloadUrl || '').startsWith('magnet:')));
  }).slice(0, 120).map((release) => {
    const id = randomUUID();
    if (releaseCache.size > 400) releaseCache.delete(releaseCache.keys().next().value);
    releaseCache.set(id, { release, baseUrl: settings.prowlarrUrl, apiKey: settings.prowlarrApiKey });
    return {
      id,
      title: release.title || 'Lançamento sem título',
      indexer: release.indexer || 'Indexer',
      size: Number(release.size) || 0,
      seeders: Number.isFinite(Number(release.seeders)) ? Number(release.seeders) : null,
      leechers: Number.isFinite(Number(release.leechers)) ? Number(release.leechers) : null,
      protocol: release.protocol || 'torrent',
      hasMagnet: Boolean(release.magnetUrl || String(release.downloadUrl || '').startsWith('magnet:')),
      canGrab: Boolean(release.magnetUrl || release.downloadUrl),
    };
  });
  return rows;
}

async function testProwlarr(value = {}) {
  const base = String(value.prowlarrUrl || '').trim().replace(/\/+$/, '');
  const key = String(value.prowlarrApiKey || '').trim();
  let parsed;
  try { parsed = new URL(base); } catch { throw new Error('O endereço do Prowlarr não é válido.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !key) throw new Error('Indica um endereço HTTP/HTTPS e uma API key do Prowlarr.');
  const response = await fetch(pURL(base, 'api/v1/system/status'), { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Prowlarr respondeu com erro ${response.status}. Confirma o endereço e a API key.`);
  const status = await response.json();
  return { version: status.version || '', appName: status.appName || 'Prowlarr' };
}

async function fetchReleaseMagnet(entry) {
  const { release, baseUrl, apiKey } = entry;
  const direct = String(release.magnetUrl || release.downloadUrl || '');
  if (direct.startsWith('magnet:?')) return direct;
  if (!release.downloadUrl) throw new Error('Este resultado não disponibiliza um link magnet nem um ficheiro torrent.');
  let current;
  try { current = new URL(release.downloadUrl); } catch { throw new Error('O link de transferência deste resultado não é válido.'); }
  if (!['http:', 'https:'].includes(current.protocol)) throw new Error('O tipo de link deste resultado não é suportado.');
  if (current.username || current.password) throw new Error('O link de transferência deste resultado não é válido.');
  const trustedOrigin = new URL(baseUrl).origin;
  for (let hop = 0; hop < 6; hop += 1) {
    current.searchParams.delete('apikey');
    current.searchParams.delete('apiKey');
    current.searchParams.delete('api_key');
    if (current.origin !== trustedOrigin) await assertPublicReleaseHost(current.hostname);
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { ...(current.origin === trustedOrigin ? { 'X-Api-Key': apiKey } : {}) },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('O indexador devolveu uma redireção inválida.');
      if (location.startsWith('magnet:?')) return location;
      current = new URL(location, current);
      if (!['http:', 'https:'].includes(current.protocol)) throw new Error('O tipo de link devolvido pelo indexador não é suportado.');
      continue;
    }
    if (!response.ok) throw new Error(`Não foi possível obter o torrent do indexador (HTTP ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('O ficheiro torrent excede o limite de 25 MB.');
    const text = bytes.toString('utf8').trim();
    if (text.startsWith('magnet:?')) return text;
    return bytes;
  }
  throw new Error('O indexador excedeu o limite de redireções.');
}

async function assertPublicReleaseHost(hostname) {
  const blockedV4 = (ip) => {
    const parts = ip.split('.').map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  };
  const validate = (address) => {
    const version = net.isIP(address);
    if (!version) throw new Error('O endereço do indexador não é válido.');
    if (version === 4 && blockedV4(address)) throw new Error('O resultado apontou para um endereço de rede privada.');
    if (version === 6) {
      const mappedV4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
      if (mappedV4) { validate(mappedV4[1]); return; }
      if (/^(::1|::|fc|fd|fe8|fe9|fea|feb)/i.test(address)) throw new Error('O resultado apontou para um endereço de rede privada.');
    }
  };
  if (net.isIP(hostname)) { validate(hostname); return; }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('O resultado apontou para um endereço local.');
  const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!resolved.length) throw new Error('Não foi possível resolver o endereço do indexador.');
  for (const item of resolved) validate(item.address);
}

async function addReleaseToRealDebrid({ releaseId, token } = {}) {
  if (!token) throw new Error('Liga primeiro a tua conta Real-Debrid.');
  const entry = releaseCache.get(releaseId);
  if (!entry) throw new Error('Este resultado expirou. Faz a pesquisa novamente.');
  const payload = await fetchReleaseMagnet(entry);
  let response;
  if (typeof payload === 'string') {
    response = await fetch(`${RD_API}/torrents/addMagnet`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ magnet: payload }),
    });
  } else {
    const form = new FormData();
    form.append('file', new Blob([payload], { type: 'application/x-bittorrent' }), 'release.torrent');
    response = await fetch(`${RD_API}/torrents/addTorrent`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  }
  const raw = await response.text();
  let result;
  try { result = raw ? JSON.parse(raw) : null; } catch { result = raw; }
  if (!response.ok) throw new Error(result?.error || result?.message || `Real-Debrid respondeu com erro ${response.status}.`);
  releaseCache.delete(releaseId);
  return result;
}

function isRealDebridUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'real-debrid.com' || url.hostname.endsWith('.real-debrid.com'));
  } catch { return false; }
}

function openAuthWindow(url) {
  if (!isRealDebridUrl(url)) throw new Error('O endereço de autorização Real-Debrid não é válido.');
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.loadURL(url);
    authWindow.focus();
    return true;
  }
  authWindow = new BrowserWindow({
    parent: mainWindow,
    width: 520,
    height: 720,
    minWidth: 420,
    minHeight: 560,
    title: 'Autorizar Real-Debrid · StreamNexus',
    autoHideMenuBar: true,
    backgroundColor: '#101117',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  authWindow.once('ready-to-show', () => authWindow?.show());
  authWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  authWindow.webContents.on('will-navigate', (event, target) => {
    if (!isRealDebridUrl(target)) event.preventDefault();
  });
  authWindow.on('closed', () => { authWindow = null; });
  authWindow.loadURL(url);
  return true;
}

function configureContentSecurityPolicy() {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https://image.tmdb.org",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' ${DEV_URL} ws://127.0.0.1:5173`,
    "media-src 'self' blob: https:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isAppResponse = details.url.startsWith('file://') || details.url.startsWith(DEV_URL);
    if (!isAppResponse) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } });
  });
}

function registerIpc() {
  const resultHandler = (operation) => async (_event, value) => {
    try { return { ok: true, data: await operation(value) }; }
    catch (error) { return { ok: false, status: error?.status || 0, message: error?.message || 'O pedido não foi concluído.' }; }
  };
  ipcMain.handle('rd:request', (_event, request) => requestApi(RD_API, request));
  ipcMain.handle('rd:oauth', (_event, request) => requestApi(RD_OAUTH, request));
  ipcMain.handle('oauth:open-window', (_event, url) => openAuthWindow(url));
  ipcMain.handle('session:read', () => readStoredSession());
  ipcMain.handle('session:write', (_event, value) => writeStoredSession(value));
  ipcMain.handle('integrations:read', () => readIntegrations());
  ipcMain.handle('integrations:write', (_event, value) => writeIntegrations(value));
  ipcMain.handle('prowlarr:search', resultHandler(searchProwlarr));
  ipcMain.handle('prowlarr:test', resultHandler(testProwlarr));
  ipcMain.handle('prowlarr:add-release', resultHandler(addReleaseToRealDebrid));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: 'StreamNexus',
    autoHideMenuBar: true,
    backgroundColor: '#090a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, target) => {
    const allowed = app.isPackaged ? target.startsWith('file://') : target.startsWith(DEV_URL);
    if (!allowed) event.preventDefault();
  });
  if (app.isPackaged) mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  else mainWindow.loadURL(DEV_URL);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.setAppUserModelId('com.streamnexus.desktop');
app.whenReady().then(() => {
  configureContentSecurityPolicy();
  registerIpc();
  createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
