const { app, BrowserWindow, ipcMain, safeStorage, session, shell, components } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');
const http = require('node:http');
const { Readable } = require('node:stream');

let staticFfmpegPath = '';
try { staticFfmpegPath = require('ffmpeg-static') || ''; } catch { /* o binário é opcional na pré-visualização */ }

const RD_API = 'https://api.real-debrid.com/rest/1.0';
const RD_OAUTH = 'https://api.real-debrid.com/oauth/v2';
const TMDB_API = 'https://api.themoviedb.org/3';
const OPENSUBTITLES_API = 'https://api.opensubtitles.com/api/v1';
const SESSION_FILE = 'real-debrid-session.bin';
const INTEGRATIONS_FILE = 'integrations.bin';
const DEV_URL = process.env.STREAMNEXUS_DEV_URL || 'http://127.0.0.1:5173';
const releaseCache = new Map();

let mainWindow;
let authWindow;
let openSubtitlesSession = null;
let spotifyToken = null;
let openSubtitlesLoginPromise = null;
const audioStreams = new Map();

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
    return { prowlarrUrl: '', prowlarrApiKey: '', tmdbApiKey: '', spotifyClientId: '', spotifyClientSecret: '', openSubtitlesApiKey: '', openSubtitlesUsername: '', openSubtitlesPassword: '', ...JSON.parse(result) };
  } catch (error) {
    if (error.code === 'ENOENT') return { prowlarrUrl: '', prowlarrApiKey: '', tmdbApiKey: '', spotifyClientId: '', spotifyClientSecret: '', openSubtitlesApiKey: '', openSubtitlesUsername: '', openSubtitlesPassword: '' };
    throw error;
  }
}

async function writeIntegrations(value) {
  const settings = {
    prowlarrUrl: String(value?.prowlarrUrl || '').trim().replace(/\/+$/, ''),
    prowlarrApiKey: String(value?.prowlarrApiKey || '').trim(),
    tmdbApiKey: String(value?.tmdbApiKey || '').trim(),
    spotifyClientId: String(value?.spotifyClientId || '').trim(),
    spotifyClientSecret: String(value?.spotifyClientSecret || '').trim(),
    openSubtitlesApiKey: String(value?.openSubtitlesApiKey || '').trim(),
    openSubtitlesUsername: String(value?.openSubtitlesUsername || '').trim(),
    openSubtitlesPassword: String(value?.openSubtitlesPassword || ''),
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
  openSubtitlesSession = null;
  spotifyToken = null;
  discoveryCache.clear();
  return { configured: Boolean(settings.prowlarrUrl && settings.prowlarrApiKey) };
}

async function tmdbRequest(resource, apiKey) {
  const url = new URL(`${TMDB_API}${resource}`);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.status_message || `TMDB respondeu com erro ${response.status}.`);
  return data;
}

function tmdbImage(pathname, size, baseUrl) {
  return pathname && baseUrl ? `${baseUrl}${size}${pathname}` : '';
}

const TMDB_GENRES = {
  28: 'Ação', 12: 'Aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime', 99: 'Documentário',
  18: 'Drama', 10751: 'Família', 14: 'Fantasia', 36: 'História', 27: 'Terror', 10402: 'Música',
  9648: 'Mistério', 10749: 'Romance', 878: 'Ficção científica', 10770: 'TV', 53: 'Thriller',
  10752: 'Guerra', 37: 'Western', 10759: 'Ação e aventura', 10762: 'Infantil', 10763: 'Notícias',
  10764: 'Reality', 10765: 'Ficção científica', 10766: 'Novela', 10767: 'Talk show', 10768: 'Guerra',
};

function normalizeTmdbItem(item, baseUrl, sizes) {
  const isMovie = item.media_type === 'movie' || Boolean(item.title);
  const title = item.title || item.name || item.original_title || item.original_name || 'Sem título';
  const original = item.original_title || item.original_name || title;
  const date = item.release_date || item.first_air_date || '';
  const type = isMovie ? 'Filme' : 'Série';
  const genres = [...new Set((item.genre_ids || []).map((id) => TMDB_GENRES[id]).filter(Boolean))];
  return {
    id: `${isMovie ? 'movie' : 'tv'}-${item.id}`, tmdbId: item.id, tmdbType: isMovie ? 'movie' : 'tv',
    title, original, type, year: date ? Number(date.slice(0, 4)) : '',
    rating: Number(item.vote_average || 0).toFixed(1), genres, genre: genres[0] || 'Drama',
    runtime: isMovie ? 'Filme' : 'Série', poster: tmdbImage(item.poster_path, sizes.poster, baseUrl),
    backdrop: tmdbImage(item.backdrop_path || item.poster_path, sizes.backdrop, baseUrl),
    description: item.overview || 'Descobre mais sobre este título.', accent: '#b30d1b',
  };
}

async function tmdbImageSettingsRaw(apiKey) {
  const config = await tmdbRequest('/configuration', apiKey);
  const baseUrl = config.images?.secure_base_url || 'https://image.tmdb.org/t/p/';
  const posterSizes = config.images?.poster_sizes || [];
  const backdropSizes = config.images?.backdrop_sizes || [];
  const sizes = {
    poster: posterSizes.includes('w500') ? 'w500' : posterSizes.find((size) => /^w\d+$/.test(size)) || 'original',
    backdrop: backdropSizes.includes('w1280') ? 'w1280' : backdropSizes.find((size) => /^w\d+$/.test(size)) || 'original',
  };
  return { baseUrl, sizes };
}

async function fetchTmdbCatalog() {
  const { tmdbApiKey } = await readIntegrations();
  if (!tmdbApiKey) throw new Error('Adiciona a API key do TMDB em Integrações para atualizar o catálogo.');
  const { baseUrl, sizes } = await tmdbImageSettings(tmdbApiKey);
  const language = 'pt-PT';
  const region = 'PT';
  const paths = {
    trending: `/trending/all/week?language=${language}&region=${region}`,
    popularMovies: `/movie/popular?language=${language}&region=${region}`,
    popularSeries: `/tv/popular?language=${language}&region=${region}`,
    topMovies: `/movie/top_rated?language=${language}&region=${region}`,
    topSeries: `/tv/top_rated?language=${language}&region=${region}`,
    nowPlaying: `/movie/now_playing?language=${language}&region=${region}`,
    airingSeries: `/tv/on_the_air?language=${language}`,
  };
  const entries = await Promise.all(Object.entries(paths).map(async ([key, resource]) => [key, await tmdbRequest(resource, tmdbApiKey)]));
  const rows = Object.fromEntries(entries.map(([key, data]) => [key, (data.results || []).map((item) => normalizeTmdbItem(item, baseUrl, sizes))]));
  const unique = new Map();
  Object.values(rows).flat().forEach((item) => { if (!unique.has(item.id)) unique.set(item.id, item); });
  return { rows, titles: [...unique.values()] };
}

async function fetchTmdbTrailer({ id, type = 'movie', title = '', year = '' } = {}) {
  if (!['movie', 'tv'].includes(type)) throw new Error('O tipo de título TMDB é inválido.');
  const { tmdbApiKey } = await readIntegrations();
  if (!tmdbApiKey) throw new Error('Adiciona a API key do TMDB nas definições.');
  let tmdbId = String(id || '');
  if (!/^\d+$/.test(tmdbId)) {
    if (!String(title || '').trim()) return null;
    const params = new URLSearchParams({ query: String(title).trim(), language: 'pt-PT' });
    if (/^\d{4}$/.test(String(year || ''))) params.set(type === 'movie' ? 'year' : 'first_air_date_year', String(year));
    const search = await tmdbRequest(`/search/${type}?${params.toString()}`, tmdbApiKey);
    tmdbId = String(search.results?.[0]?.id || '');
  }
  if (!/^\d+$/.test(tmdbId)) return null;
  const videos = await tmdbRequest(`/${type}/${tmdbId}/videos?language=pt-PT`, tmdbApiKey);
  let results = videos.results || [];
  if (!results.some((video) => video.site === 'YouTube' && video.type === 'Trailer')) {
    const fallback = await tmdbRequest(`/${type}/${tmdbId}/videos?language=en-US`, tmdbApiKey);
    results = [...results, ...(fallback.results || [])];
  }
  const selected = results
    .filter((video) => video.site === 'YouTube' && video.type === 'Trailer' && video.key)
    .sort((a, b) => Number(Boolean(b.official)) - Number(Boolean(a.official)))[0];
  return selected ? { key: selected.key, name: selected.name || 'Trailer' } : null;
}

// ---- Descoberta de TV (TMDB), música (iTunes Search) e livros (Open Library) ----
const DISCOVERY_TTL = 10 * 60 * 1000;
const discoveryCache = new Map();
const MEDIA_ACCENTS = ['#8f71fc', '#c28d5d', '#68727c', '#b44c7c', '#627c89', '#759065', '#9d454d', '#729caa'];

async function fetchPublicJson(url, timeoutMs = 20000) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'StreamNexus/0.1' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`O serviço respondeu com erro ${response.status}.`);
  return response.json();
}

const TV_SHELVES = [
  { eyebrow: 'EM EMISSÃO HOJE', title: 'Hoje na televisão', path: '/tv/airing_today?language=pt-PT' },
  { eyebrow: 'REALITY E COMPETIÇÃO', title: 'Reality e competição', path: '/discover/tv?language=pt-PT&sort_by=popularity.desc&with_genres=10764' },
  { eyebrow: 'CONVERSA E HUMOR', title: 'Talk shows', path: '/discover/tv?language=pt-PT&sort_by=popularity.desc&with_genres=10767' },
  { eyebrow: 'HISTÓRIAS REAIS', title: 'Documentários', path: '/discover/tv?language=pt-PT&sort_by=popularity.desc&with_genres=99' },
  { eyebrow: 'EM FAMÍLIA', title: 'Para os mais novos', path: '/discover/tv?language=pt-PT&sort_by=popularity.desc&with_genres=10762' },
  { eyebrow: 'DRAMA DIÁRIO', title: 'Novelas', path: '/discover/tv?language=pt-PT&sort_by=popularity.desc&with_genres=10766' },
  { eyebrow: 'ATUALIDADE', title: 'Notícias e atualidade', path: '/discover/tv?language=pt-PT&sort_by=popularity.desc&with_genres=10763' },
];

async function fetchTvDiscovery() {
  const { tmdbApiKey } = await readIntegrations();
  if (!tmdbApiKey) throw new Error('Adiciona a API key do TMDB em Integrações para ver programas de TV.');
  const { baseUrl, sizes } = await tmdbImageSettings(tmdbApiKey);
  return Promise.all(TV_SHELVES.map(async (shelf) => {
    const data = await tmdbRequest(shelf.path, tmdbApiKey);
    return { eyebrow: shelf.eyebrow, title: shelf.title, feedId: shelf.path.startsWith('/tv/airing_today') ? 'tmdb:tv:list:airing_today' : `tmdb:tv:genre:${/with_genres=(\d+)/.exec(shelf.path)?.[1]}:popularity.desc`, cursor: 2, hasMore: true, items: (data.results || []).map((item) => normalizeTmdbItem({ ...item, media_type: 'tv', title: undefined }, baseUrl, sizes)) };
  }));
}

const MUSIC_SHELVES = [
  { eyebrow: 'EM ALTA', title: 'Álbuns populares', term: 'top hits' },
  { eyebrow: 'PARA CANTAR', title: 'Pop', term: 'pop' },
  { eyebrow: 'GUITARRAS NO MÁXIMO', title: 'Rock e metal', term: 'rock' },
  { eyebrow: 'RIMA E RITMO', title: 'Hip-hop', term: 'hip hop' },
  { eyebrow: 'PARA DANÇAR', title: 'Eletrónica', term: 'electronic' },
  { eyebrow: 'MÚSICA PARA CADA HISTÓRIA', title: 'Bandas sonoras', term: 'soundtrack' },
  { eyebrow: 'ESCUTA SEM PRESSA', title: 'Jazz e clássica', term: 'jazz classical' },
  { eyebrow: 'DE PORTUGAL', title: 'Fado e música portuguesa', term: 'fado portugal' },
];

function normalizeAlbum(album, index) {
  const artwork = String(album.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.');
  const year = album.releaseDate ? Number(String(album.releaseDate).slice(0, 4)) : '';
  const tracks = Number(album.trackCount) || 0;
  return {
    id: `album-${album.collectionId}`, type: 'Álbum', title: album.collectionName, original: album.collectionName,
    creator: album.artistName || '', year, rating: '', genre: album.primaryGenreName || 'Música', genres: album.primaryGenreName ? [album.primaryGenreName] : [],
    runtime: tracks ? `${tracks} faixas` : 'Álbum', poster: artwork, backdrop: artwork,
    description: [album.artistName, tracks ? `${tracks} faixas` : '', album.primaryGenreName].filter(Boolean).join(' · '),
    source: 'Apple Music', embedUrl: `https://embed.music.apple.com/pt/album/album/${album.collectionId}`, embedHeight: 450, linkUrl: album.collectionViewUrl || '',
    searchQuery: `${album.artistName || ''} ${String(album.collectionName || '').replace(/\s*[\(\[].*$/, '')}`.trim(), accent: MEDIA_ACCENTS[index % MEDIA_ACCENTS.length],
  };
}

// ---- Spotify (opcional): catálogo de álbuns via client credentials ----
async function spotifyAccessToken(clientId, clientSecret) {
  const fingerprint = `${clientId}:${clientSecret}`;
  if (spotifyToken?.fingerprint === fingerprint && spotifyToken.expiresAt > Date.now() + 30000) return spotifyToken.token;
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(fingerprint).toString('base64')}` },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? 'O Spotify recusou o Client ID ou o Client Secret.' : `O Spotify respondeu com erro ${response.status}.`);
  const data = await response.json();
  spotifyToken = { fingerprint, token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return spotifyToken.token;
}

async function spotifyGet(token, resource, params) {
  for (const limit of ['30', '10']) {
    const query = new URLSearchParams({ ...params, limit });
    const response = await fetch(`https://api.spotify.com/v1${resource}?${query}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (response.status === 400 && limit === '30') continue;
    if (!response.ok) throw new Error(`O Spotify respondeu com erro ${response.status}.`);
    return response.json();
  }
  return {};
}

const SPOTIFY_SHELVES = [
  { eyebrow: 'ACABADOS DE SAIR', title: 'Novos lançamentos', browse: true },
  { eyebrow: 'PARA CANTAR', title: 'Pop', genre: 'pop' },
  { eyebrow: 'GUITARRAS NO MÁXIMO', title: 'Rock e metal', genre: 'rock' },
  { eyebrow: 'RIMA E RITMO', title: 'Hip-hop', genre: 'hip-hop' },
  { eyebrow: 'PARA DANÇAR', title: 'Eletrónica', genre: 'electronic' },
  { eyebrow: 'MÚSICA PARA CADA HISTÓRIA', title: 'Bandas sonoras', genre: 'soundtrack' },
  { eyebrow: 'ESCUTA SEM PRESSA', title: 'Jazz', genre: 'jazz' },
  { eyebrow: 'DE PORTUGAL', title: 'Fado e música portuguesa', genre: 'fado' },
];

function normalizeSpotifyAlbum(album, shelf, index) {
  const art = [...(album.images || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || '';
  const artists = (album.artists || []).map((artist) => artist.name).filter(Boolean).join(', ');
  const year = album.release_date ? Number(String(album.release_date).slice(0, 4)) : '';
  const tracks = Number(album.total_tracks) || 0;
  const genre = shelf.genre ? shelf.title : 'Música';
  return {
    id: `album-sp-${album.id}`, type: 'Álbum', title: album.name, original: album.name, creator: artists, year, rating: '',
    genre, genres: [genre], runtime: tracks ? `${tracks} faixas` : 'Álbum', poster: art, backdrop: art,
    description: [artists, tracks ? `${tracks} faixas` : '', year].filter(Boolean).join(' · '),
    source: 'Spotify', spotifyUri: `spotify:album:${album.id}`, embedUrl: `https://open.spotify.com/embed/album/${album.id}?theme=0`, embedHeight: 380, linkUrl: album.external_urls?.spotify || `https://open.spotify.com/album/${album.id}`,
    searchQuery: `${artists.split(', ')[0] || ''} ${String(album.name || '').replace(/\s*[\(\[].*$/, '')}`.trim(), accent: MEDIA_ACCENTS[index % MEDIA_ACCENTS.length],
  };
}

async function fetchSpotifyMusic(clientId, clientSecret) {
  const token = await spotifyAccessToken(clientId, clientSecret);
  return Promise.all(SPOTIFY_SHELVES.map(async (shelf) => {
    const data = shelf.browse
      ? await spotifyGet(token, '/browse/new-releases', { country: 'PT' })
      : await spotifyGet(token, '/search', { q: `genre:"${shelf.genre}"`, type: 'album', market: 'PT' });
    const list = data.albums?.items || [];
    const seen = new Set();
    const items = list.filter((album) => album?.id && album.name && album.images?.length && !seen.has(album.id) && seen.add(album.id)).map((album, index) => normalizeSpotifyAlbum(album, shelf, index));
    return { eyebrow: shelf.eyebrow, title: shelf.title, items };
  }));
}

async function testSpotify(value = {}) {
  const clientId = String(value.spotifyClientId || '').trim();
  const clientSecret = String(value.spotifyClientSecret || '').trim();
  if (!clientId || !clientSecret) throw new Error('Indica o Client ID e o Client Secret do Spotify.');
  spotifyToken = null;
  const token = await spotifyAccessToken(clientId, clientSecret);
  await spotifyGet(token, '/search', { q: 'genre:"pop"', type: 'album', market: 'PT' });
  return { appName: 'Spotify' };
}

// ---- Spotify Connect: comando remoto (Premium) com login OAuth PKCE ----
// O Spotify só entrega faixas completas a apps com DRM (Widevine), que o Electron normal não tem.
// Por isso a app autentica a conta e COMANDA o Spotify aberto num dispositivo (PC ou telemóvel).
const SPOTIFY_REDIRECT_PORT = 8898;
const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_REDIRECT_PORT}/callback`;
const SPOTIFY_USER_FILE = 'spotify-user.bin';
const SPOTIFY_SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing streaming user-read-email user-read-private';
let spotifyUser = null;
let spotifyLoginServer = null;

const spotifyUserPath = () => path.join(app.getPath('userData'), SPOTIFY_USER_FILE);

async function loadSpotifyUser() {
  if (spotifyUser) return spotifyUser;
  try {
    const encrypted = await fs.readFile(spotifyUserPath());
    const { result } = await safeStorage.decryptStringAsync(encrypted);
    spotifyUser = JSON.parse(result);
  } catch { spotifyUser = null; }
  return spotifyUser;
}

async function saveSpotifyUser(value) {
  spotifyUser = value;
  if (!value) { await fs.rm(spotifyUserPath(), { force: true }); return; }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('O armazenamento seguro do Windows não está disponível.');
  await fs.writeFile(spotifyUserPath(), await safeStorage.encryptStringAsync(JSON.stringify(value)));
}

async function spotifyTokenRequest(params) {
  const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || `O Spotify recusou o pedido (${response.status}).`);
  return data;
}

async function spotifyUserToken() {
  const user = await loadSpotifyUser();
  if (!user?.refreshToken) throw new Error('Liga primeiro a tua conta Spotify.');
  if (user.accessToken && user.expiresAt > Date.now() + 30000) return user.accessToken;
  const { spotifyClientId } = await readIntegrations();
  if (!spotifyClientId) throw new Error('Indica o Client ID do Spotify nas Integrações.');
  const data = await spotifyTokenRequest({ grant_type: 'refresh_token', refresh_token: user.refreshToken, client_id: spotifyClientId });
  await saveSpotifyUser({ ...user, accessToken: data.access_token, refreshToken: data.refresh_token || user.refreshToken, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

// ---- Spotify dentro da app: janela oculta com o SDK oficial (Web Playback) ----
// Precisa do Electron com Widevine (castlabs, ver scripts/ensure-widevine-electron.mjs).
// No Electron normal `components` não existe e a app volta ao comando remoto de outro dispositivo.
const WIDEVINE_AVAILABLE = Boolean(components);
let spotifyPlayerWindow = null;
let spotifyPlayerServer = null;
let spotifyPlayerState = { ready: false, deviceId: '', error: '' };
let spotifyPlayerLastError = { message: '', at: 0 };
let spotifyLicenseFailures = [];
let spotifyInAppBroken = false; // licença DRM recusada: usa outro dispositivo até reiniciar a app
const SPOTIFY_LICENSE_HELP = 'O Spotify recusou a licença de DRM (erro 500): o Electron da app precisa da assinatura VMP gratuita da castlabs. Corre «npm run sign:widevine» na pasta do projeto e segue os passos (ver README).';
const spotifyPlayerLogPath = () => path.join(app.getPath('userData'), 'spotify-player.log');
function logSpotifyPlayer(line) {
  fs.appendFile(spotifyPlayerLogPath(), `${new Date().toISOString()} ${line}\n`).catch(() => {});
}
let spotifyPlayerWaiters = [];

const SPOTIFY_PLAYER_HTML = `<!doctype html><meta charset="utf-8"><title>StreamNexus · Spotify</title>
<script>
window.onSpotifyWebPlaybackSDKReady = () => {
  const bridge = window.spotifyBridge;
  const player = new Spotify.Player({ name: 'StreamNexus', getOAuthToken: (cb) => bridge.getToken().then(cb).catch(() => cb('')), volume: 0.8 });
  player.addListener('ready', ({ device_id }) => bridge.report({ type: 'ready', deviceId: device_id }));
  player.addListener('not_ready', () => bridge.report({ type: 'not_ready' }));
  ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach((kind) => player.addListener(kind, ({ message }) => bridge.report({ type: 'error', kind, message })));
  player.addListener('autoplay_failed', () => bridge.report({ type: 'error', kind: 'playback_error', message: 'O navegador bloqueou o arranque automático do som.' }));
  player.addListener('player_state_changed', (state) => { if (!state) { bridge.report({ type: 'state', empty: true }); return; } const track = state.track_window && state.track_window.current_track; bridge.report({ type: 'state', paused: state.paused, loading: state.loading, position: state.position, duration: state.duration, name: track && track.name, uri: track && track.uri, next: (state.track_window && state.track_window.next_tracks || []).length, shuffle: state.shuffle, repeat: state.repeat_mode }); });
  player.connect().then((ok) => { if (!ok) bridge.report({ type: 'error', kind: 'connect', message: 'O Spotify recusou a ligação do leitor. Volta a ligar a conta Spotify.' }); });
  try { player.activateElement(); } catch (error) { /* só é necessário em alguns browsers */ }
  bridge.onCommand(({ action, value }) => { if (action === 'volume') player.setVolume(value); });
};
</script>
<script src="https://sdk.scdn.co/spotify-player.js"></script>`;

function notifySpotifyPlayerWaiters() {
  const waiters = spotifyPlayerWaiters;
  spotifyPlayerWaiters = [];
  waiters.forEach((resolve) => resolve());
}

function handleSpotifyPlayerEvent(event) {
  logSpotifyPlayer(JSON.stringify(event));
  if (event?.type === 'ready') spotifyPlayerState = { ready: true, deviceId: String(event.deviceId || ''), error: '' };
  else if (event?.type === 'not_ready') spotifyPlayerState = { ...spotifyPlayerState, ready: false };
  else if (event?.type === 'error') {
    const reason = {
      initialization_error: 'Este Electron não tem Widevine (DRM): não é possível tocar Spotify dentro da app.',
      authentication_error: 'O Spotify recusou a sessão. Volta a ligar a conta Spotify.',
      account_error: 'A conta Spotify tem de ser Premium para tocar dentro da app.',
    }[event.kind];
    if (event.kind === 'playback_error') spotifyPlayerLastError = { message: event.message || 'Erro de reprodução no Spotify.', at: Date.now() };
    else spotifyPlayerState = { ready: false, deviceId: '', error: reason || event.message || 'Erro no leitor Spotify.' };
  }
  notifySpotifyPlayerWaiters();
}

async function ensureSpotifyPlayer() {
  if (!WIDEVINE_AVAILABLE) throw new Error('NO_WIDEVINE');
  const user = await loadSpotifyUser();
  if (!user?.refreshToken) throw new Error('Liga primeiro a tua conta Spotify.');
  if (!String(user.scope || '').split(' ').includes('streaming')) throw new Error('Volta a ligar a conta Spotify para ativar a reprodução dentro da app.');
  if (spotifyPlayerState.ready && spotifyPlayerState.deviceId && spotifyPlayerWindow && !spotifyPlayerWindow.isDestroyed()) return spotifyPlayerState.deviceId;
  await Promise.race([components.whenReady(), new Promise((resolve) => setTimeout(resolve, 60000))]);
  if (!spotifyPlayerWindow || spotifyPlayerWindow.isDestroyed()) {
    spotifyPlayerState = { ready: false, deviceId: '', error: '' };
    spotifyPlayerServer?.close();
    spotifyPlayerServer = http.createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(SPOTIFY_PLAYER_HTML); });
    await new Promise((resolve, reject) => { spotifyPlayerServer.once('error', reject); spotifyPlayerServer.listen(0, '127.0.0.1', resolve); });
    spotifyPlayerWindow = new BrowserWindow({
      show: false, width: 400, height: 300, title: 'StreamNexus · Spotify',
      webPreferences: { preload: path.join(__dirname, 'spotify-player-preload.cjs'), partition: 'persist:streamnexus-spotify', contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    spotifyPlayerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    spotifyPlayerWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    // Diagnóstico: consola do leitor (inclui o iframe do SDK), processos que caem e pedidos de rede falhados
    spotifyPlayerWindow.webContents.on('console-message', (...args) => {
      const detail = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : { level: args[1], message: args[2], sourceId: args[4] };
      logSpotifyPlayer(`console[${detail.level}] ${String(detail.message).slice(0, 400)} ${String(detail.sourceId || '').split('?')[0].slice(-80)}`);
    });
    spotifyPlayerWindow.webContents.on('render-process-gone', (_event, details) => logSpotifyPlayer(`render-process-gone ${JSON.stringify(details)}`));
    spotifyPlayerWindow.webContents.on('did-fail-load', (_event, code, description, url) => logSpotifyPlayer(`did-fail-load ${code} ${description} ${String(url).split('?')[0]}`));
    const playerSession = spotifyPlayerWindow.webContents.session;
    if (!playerSession.__streamnexusNetLog) {
      playerSession.__streamnexusNetLog = true;
      const shortUrl = (value) => { try { const url = new URL(value); return `${url.host}${url.pathname}`.slice(0, 160); } catch { return String(value).slice(0, 160); } };
      playerSession.webRequest.onErrorOccurred((details) => { if (details.error !== 'net::ERR_ABORTED') logSpotifyPlayer(`net-error ${details.error} ${shortUrl(details.url)}`); });
      playerSession.webRequest.onCompleted((details) => {
        if (details.statusCode >= 400 || /licen[sc]e|widevine|drm/i.test(details.url)) logSpotifyPlayer(`http ${details.statusCode} ${details.method} ${shortUrl(details.url)}`);
        // Licença Widevine recusada várias vezes seguidas: sem assinatura VMP nada toca; pára o ciclo de saltos e explica
        if (/widevine-license\/v1\/audio\/license/.test(details.url) && details.statusCode >= 500) {
          const now = Date.now();
          spotifyLicenseFailures = spotifyLicenseFailures.filter((time) => now - time < 15000).concat(now);
          if (spotifyLicenseFailures.length >= 3) {
            spotifyPlayerLastError = { message: SPOTIFY_LICENSE_HELP, at: now };
            spotifyInAppBroken = true;
            spotifyUserApi('PUT', '/me/player/pause').catch(() => {});
            setTimeout(() => closeSpotifyPlayer(), 1500);
          }
        }
      });
    }
    spotifyPlayerWindow.on('closed', () => { spotifyPlayerWindow = null; spotifyPlayerState = { ready: false, deviceId: '', error: '' }; spotifyPlayerServer?.close(); spotifyPlayerServer = null; });
    spotifyPlayerWindow.loadURL(`http://127.0.0.1:${spotifyPlayerServer.address().port}/`);
  }
  const deadline = Date.now() + 25000;
  while (!(spotifyPlayerState.ready && spotifyPlayerState.deviceId) && !spotifyPlayerState.error && Date.now() < deadline) {
    await Promise.race([new Promise((resolve) => spotifyPlayerWaiters.push(resolve)), new Promise((resolve) => setTimeout(resolve, 1000))]);
  }
  if (spotifyPlayerState.error) { const message = spotifyPlayerState.error; spotifyPlayerWindow?.destroy(); throw new Error(message); }
  if (!spotifyPlayerState.deviceId) { spotifyPlayerWindow?.destroy(); throw new Error('O leitor Spotify não arrancou a tempo. Tenta de novo.'); }
  return spotifyPlayerState.deviceId;
}

function closeSpotifyPlayer() {
  if (spotifyPlayerWindow && !spotifyPlayerWindow.isDestroyed()) spotifyPlayerWindow.destroy();
  spotifyPlayerServer?.close();
}

async function spotifyConnectStatus() {
  const { spotifyClientId } = await readIntegrations();
  const user = await loadSpotifyUser();
  const streaming = String(user?.scope || '').split(' ').includes('streaming');
  return { configured: Boolean(spotifyClientId), connected: Boolean(user?.refreshToken), redirectUri: SPOTIFY_REDIRECT_URI, name: user?.name || '', inApp: WIDEVINE_AVAILABLE && !spotifyInAppBroken, inAppBlocked: spotifyInAppBroken, needsReconnect: Boolean(user?.refreshToken && WIDEVINE_AVAILABLE && !streaming) };
}

async function spotifyConnectLogin() {
  const { spotifyClientId } = await readIntegrations();
  if (!spotifyClientId) throw new Error('Indica o Client ID do Spotify nas Integrações.');
  const crypto = require('node:crypto');
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  spotifyLoginServer?.close();
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, SPOTIFY_REDIRECT_URI);
      if (url.pathname !== '/callback') { response.writeHead(404).end(); return; }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
      response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh"><div><h2>${ok ? 'Spotify ligado ao StreamNexus' : 'Não foi possível ligar o Spotify'}</h2><p>Já podes fechar esta janela e voltar à app.</p></div>`);
      clearTimeout(timer);
      server.close();
      if (ok) resolve(url.searchParams.get('code')); else reject(new Error(url.searchParams.get('error') || 'O Spotify recusou a ligação.'));
    });
    const timer = setTimeout(() => { server.close(); reject(new Error('A ligação ao Spotify expirou. Tenta de novo.')); }, 3 * 60 * 1000);
    server.on('error', (error) => { clearTimeout(timer); reject(new Error(error.code === 'EADDRINUSE' ? `A porta ${SPOTIFY_REDIRECT_PORT} está ocupada. Fecha outra instância do StreamNexus e tenta de novo.` : error.message)); });
    server.listen(SPOTIFY_REDIRECT_PORT, '127.0.0.1', () => {
      spotifyLoginServer = server;
      const authorize = new URL('https://accounts.spotify.com/authorize');
      authorize.search = new URLSearchParams({ response_type: 'code', client_id: spotifyClientId, redirect_uri: SPOTIFY_REDIRECT_URI, scope: SPOTIFY_SCOPES, state, code_challenge_method: 'S256', code_challenge: challenge }).toString();
      shell.openExternal(authorize.toString());
    });
  });
  const data = await spotifyTokenRequest({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT_URI, client_id: spotifyClientId, code_verifier: verifier });
  await saveSpotifyUser({ accessToken: data.access_token, refreshToken: data.refresh_token, scope: data.scope || SPOTIFY_SCOPES, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  let name = '';
  try { name = (await spotifyUserApi('GET', '/me'))?.display_name || ''; } catch { /* o nome é opcional */ }
  await saveSpotifyUser({ ...spotifyUser, name });
  return { connected: true, name };
}

async function spotifyConnectLogout() { await saveSpotifyUser(null); return { connected: false }; }

async function spotifyUserApi(method, resource, body, query) {
  const call = async () => fetch(`https://api.spotify.com/v1${resource}${query ? `?${new URLSearchParams(query)}` : ''}`, { method, headers: { Authorization: `Bearer ${await spotifyUserToken()}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let response = await call();
  if (response.status === 401 && spotifyUser) { spotifyUser.expiresAt = 0; response = await call(); }
  if (response.status === 204 || response.status === 202) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.error?.reason || '';
    const error = new Error(reason === 'NO_ACTIVE_DEVICE' || response.status === 404 ? 'NO_DEVICE' : reason === 'PREMIUM_REQUIRED' || response.status === 403 ? 'A conta Spotify tem de ser Premium para ser comandada por outras apps.' : (data?.error?.message || `O Spotify respondeu com erro ${response.status}.`));
    error.status = response.status;
    throw error;
  }
  return data;
}

async function spotifyConnectState() {
  const data = await spotifyUserApi('GET', '/me/player', null, { additional_types: 'track' });
  if (!data?.item) return { active: false, device: data?.device?.name || '' };
  const item = data.item;
  const recentError = Date.now() - spotifyPlayerLastError.at < 15000 ? spotifyPlayerLastError.message : '';
  const art = [...(item.album?.images || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || '';
  return { active: true, playing: Boolean(data.is_playing), title: item.name, artist: (item.artists || []).map((artist) => artist.name).join(', '), album: item.album?.name || '', cover: art, progress: data.progress_ms || 0, duration: item.duration_ms || 0, device: data.device?.name || '', volume: data.device?.volume_percent ?? null, shuffle: Boolean(data.shuffle_state), repeat: data.repeat_state || 'off', uri: item.uri || '', albumUri: item.album?.uri || '', playerError: recentError };
}

async function resolveSpotifyAlbumUri(value = {}) {
  let uri = String(value.uri || '');
  if (!uri) {
    const token = await spotifyUserToken();
    const q = `album:${String(value.album || '').replace(/["]/g, ' ')} artist:${String(value.artist || '').replace(/["]/g, ' ')}`.trim();
    const found = await spotifyGet(token, '/search', { q, type: 'album', limit: '1', market: 'PT' });
    uri = found.albums?.items?.[0]?.uri || '';
    if (!uri) { const loose = await spotifyGet(token, '/search', { q: `${value.artist || ''} ${value.album || ''}`.trim(), type: 'album', limit: '1', market: 'PT' }); uri = loose.albums?.items?.[0]?.uri || ''; }
    if (!uri) throw new Error('Este álbum não foi encontrado no Spotify.');
  }
  if (!/^spotify:(album|track|playlist|artist):[A-Za-z0-9]+$/.test(uri)) throw new Error('Endereço Spotify inválido.');
  return uri;
}

// Faixas de um álbum (para escolher qual tocar)
async function spotifyAlbumTracks(value = {}) {
  const uri = await resolveSpotifyAlbumUri(value);
  if (!uri.startsWith('spotify:album:')) throw new Error('Só é possível listar faixas de álbuns.');
  const token = await spotifyUserToken();
  const id = uri.split(':')[2];
  const tracks = [];
  for (let offset = 0; offset < 200; offset += 50) {
    const page = await spotifyGet(token, `/albums/${id}/tracks`, { limit: '50', offset: String(offset), market: 'PT' });
    (page.items || []).forEach((track) => tracks.push({ uri: track.uri, name: track.name, number: track.track_number, disc: track.disc_number, duration: Math.round((track.duration_ms || 0) / 1000), artists: (track.artists || []).map((artist) => artist.name).join(', '), explicit: Boolean(track.explicit), playable: track.is_playable !== false }));
    if (!page.next) break;
  }
  return { uri, tracks };
}

async function spotifyConnectCommand(value = {}) {
  const action = String(value.action || '');
  const withDevice = async (run) => {
    if (WIDEVINE_AVAILABLE && !spotifyInAppBroken) {
      const deviceId = await ensureSpotifyPlayer();
      let lastError;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try { return await run({ device_id: deviceId }); } catch (error) { lastError = error; if (error.message !== 'NO_DEVICE') throw error; await new Promise((resolve) => setTimeout(resolve, 900)); }
      }
      throw new Error(lastError?.message === 'NO_DEVICE' ? 'O leitor Spotify ainda não ficou disponível. Tenta de novo.' : lastError?.message);
    }
    try { return await run({}); } catch (error) {
      if (error.message !== 'NO_DEVICE') throw error;
      const devices = (await spotifyUserApi('GET', '/me/player/devices'))?.devices || [];
      const target = devices.find((device) => device.is_active) || devices[0];
      if (!target) throw new Error('Abre o Spotify no teu PC ou telemóvel (qualquer dispositivo com sessão iniciada) e tenta de novo.');
      return run({ device_id: target.id });
    }
  };
  if (action === 'play') {
    const uri = await resolveSpotifyAlbumUri(value);
    const trackUri = /^spotify:track:[A-Za-z0-9]+$/.test(String(value.trackUri || '')) ? String(value.trackUri) : '';
    const body = uri.startsWith('spotify:track:') ? { uris: [uri] } : { context_uri: uri, ...(trackUri ? { offset: { uri: trackUri } } : {}) };
    // Aleatório e repetição têm de estar definidos ANTES de arrancar, senão o Spotify mantém o estado anterior
    const query = await withDevice(async (target) => {
      if (typeof value.shuffle === 'boolean') await spotifyUserApi('PUT', '/me/player/shuffle', null, { state: String(value.shuffle), ...target }).catch(() => {});
      if (['off', 'context', 'track'].includes(value.repeat)) await spotifyUserApi('PUT', '/me/player/repeat', null, { state: value.repeat, ...target }).catch(() => {});
      await spotifyUserApi('PUT', '/me/player/play', body, target);
      return target;
    });
    return { ok: true, uri, device: query.device_id || '' };
  }
  if (action === 'shuffle') { await spotifyUserApi('PUT', '/me/player/shuffle', null, { state: String(Boolean(value.value)) }); return { ok: true }; }
  if (action === 'repeat') { await spotifyUserApi('PUT', '/me/player/repeat', null, { state: ['off', 'context', 'track'].includes(value.value) ? value.value : 'off' }); return { ok: true }; }
  if (action === 'resume') { await withDevice((query) => spotifyUserApi('PUT', '/me/player/play', null, query)); return { ok: true }; }
  if (action === 'pause') { await spotifyUserApi('PUT', '/me/player/pause'); return { ok: true }; }
  if (action === 'next') { await spotifyUserApi('POST', '/me/player/next'); return { ok: true }; }
  if (action === 'previous') { await spotifyUserApi('POST', '/me/player/previous'); return { ok: true }; }
  if (action === 'seek') { await spotifyUserApi('PUT', '/me/player/seek', null, { position_ms: String(Math.max(0, Math.floor(Number(value.positionMs) || 0))) }); return { ok: true }; }
  if (action === 'volume') { await spotifyUserApi('PUT', '/me/player/volume', null, { volume_percent: String(Math.max(0, Math.min(100, Math.round(Number(value.volume) || 0)))) }); return { ok: true }; }
  throw new Error('Ação Spotify inválida.');
}

async function fetchMusicDiscovery() {
  const { spotifyClientId, spotifyClientSecret } = await readIntegrations();
  const defs = [...(spotifyClientId && spotifyClientSecret ? [{ eyebrow: 'ACABADOS DE SAIR', title: 'Novos lançamentos', term: 'new-releases' }] : []), ...MUSIC_SHELVES];
  const rows = await Promise.all(defs.map(async (shelf) => {
    const page = await musicPage(shelf.term, 0).catch(() => ({ items: [], cursor: 0, hasMore: false }));
    return { eyebrow: shelf.eyebrow, title: shelf.title, items: page.items, feedId: `music:${shelf.term}`, cursor: page.cursor, hasMore: page.hasMore };
  }));
  if (!rows.some((row) => row.items.length)) throw new Error('Não foi possível obter álbuns agora. Tenta novamente daqui a pouco.');
  return rows;
}

const BOOK_SHELVES = [
  { eyebrow: 'EM ALTA ESTA SEMANA', title: 'Mais procurados', url: 'https://openlibrary.org/trending/weekly.json?limit=30', genre: 'Diversos' },
  { eyebrow: 'MUNDOS PARA DESCOBRIR', title: 'Fantasia', url: 'https://openlibrary.org/subjects/fantasy.json?limit=30', genre: 'Fantasia' },
  { eyebrow: 'OUTROS MUNDOS, OUTRAS IDEIAS', title: 'Ficção científica', url: 'https://openlibrary.org/subjects/science_fiction.json?limit=30', genre: 'Ficção científica' },
  { eyebrow: 'CHEIAS DE PISTAS', title: 'Mistério e crime', url: 'https://openlibrary.org/subjects/mystery_and_detective_stories.json?limit=30', genre: 'Mistério' },
  { eyebrow: 'HISTÓRIAS DE ENCONTROS', title: 'Romance', url: 'https://openlibrary.org/subjects/romance.json?limit=30', genre: 'Romance' },
  { eyebrow: 'PARA ARREPIAR', title: 'Terror e suspense', url: 'https://openlibrary.org/subjects/horror.json?limit=30', genre: 'Terror' },
  { eyebrow: 'HISTÓRIAS REAIS', title: 'Biografias', url: 'https://openlibrary.org/subjects/biography.json?limit=30', genre: 'Biografia' },
  { eyebrow: 'COMICS E MANGA', title: 'Banda desenhada', url: 'https://openlibrary.org/subjects/graphic_novels.json?limit=30', genre: 'Banda desenhada' },
];

function normalizeBook(work, shelf, index) {
  const coverId = work.cover_id || work.cover_i;
  const authors = (work.authors ? work.authors.map((author) => author.name) : work.author_name || []).filter(Boolean);
  const year = Number(work.first_publish_year) || '';
  const key = String(work.key || '').replace('/works/', '');
  const poster = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '';
  return {
    id: `book-${key}`, type: 'Livro', title: work.title, original: work.title, creator: authors.join(', '), year, rating: '',
    genre: shelf.genre, genres: [shelf.genre], runtime: 'Livro', poster, backdrop: poster,
    description: [authors.join(', '), year].filter(Boolean).join(' · ') || 'Descobre mais sobre este livro.',
    workKey: key, searchQuery: `${work.title} ${authors[0] || ''}`.trim(), accent: MEDIA_ACCENTS[index % MEDIA_ACCENTS.length],
  };
}

async function fetchBooksDiscovery() {
  return Promise.all(BOOK_SHELVES.map(async (shelf) => {
    const subject = /\/subjects\/([^.]+)\.json/.exec(shelf.url)?.[1] || 'trending';
    const page = await bookPage(subject, 0, shelf.genre).catch(() => ({ items: [], cursor: 0, hasMore: false }));
    return { eyebrow: shelf.eyebrow, title: shelf.title, items: page.items, feedId: `books:${subject}`, cursor: page.cursor, hasMore: page.hasMore };
  }));
}

// ---- Adultos (TMDB com include_adult, só quando a categoria está ativa) ----
const ADULT_SHELVES = [
  { eyebrow: 'EM ALTA', title: 'Em destaque', keywords: ['erotic', 'softcore', 'erotica'] },
  { eyebrow: 'SUSPENSE E DESEJO', title: 'Thrillers eróticos', keywords: ['erotic thriller'] },
  { eyebrow: 'HISTÓRIAS A DOIS', title: 'Drama erótico', keywords: ['erotic drama', 'sexuality'] },
  { eyebrow: 'LEVE E ATREVIDO', title: 'Comédia', keywords: ['sex comedy', 'erotic comedy'] },
  { eyebrow: 'DESENHADO PARA ADULTOS', title: 'Animação adulta', keywords: ['adult animation', 'hentai'] },
  { eyebrow: 'DE OUTRAS ÉPOCAS', title: 'Clássicos', keywords: ['sexploitation', 'pinku eiga'] },
];

async function fetchAdultDiscovery() {
  const { tmdbApiKey } = await readIntegrations();
  if (!tmdbApiKey) throw new Error('Adiciona a API key do TMDB em Integrações para ver este catálogo.');
  const { baseUrl, sizes } = await tmdbImageSettings(tmdbApiKey);
  const rows = await Promise.all(ADULT_SHELVES.map(async (shelf, shelfIndex) => {
    const ids = new Set();
    for (const keyword of shelf.keywords) {
      try {
        const found = await tmdbRequest(`/search/keyword?query=${encodeURIComponent(keyword)}`, tmdbApiKey);
        (found.results || []).slice(0, 2).forEach((entry) => ids.add(entry.id));
      } catch { /* ignora palavras-chave sem resultados */ }
    }
    if (!ids.size) return { eyebrow: shelf.eyebrow, title: shelf.title, items: [], feedId: `adult:${shelfIndex}`, cursor: 2, hasMore: false };
    const data = await tmdbRequest(`/discover/movie?language=pt-PT&include_adult=true&sort_by=popularity.desc&with_keywords=${[...ids].join('|')}`, tmdbApiKey);
    const items = (data.results || []).filter((item) => item.poster_path).map((item) => ({ ...normalizeTmdbItem({ ...item, media_type: 'movie' }, baseUrl, sizes), adult: true, genre: shelf.title, genres: [shelf.title] }));
    return { eyebrow: shelf.eyebrow, title: shelf.title, items, feedId: `adult:${shelfIndex}`, cursor: 2, hasMore: true };
  }));
  if (!rows.some((row) => row.items.length)) throw new Error('O TMDB não devolveu títulos para esta categoria.');
  return rows;
}

// ---- TV ao vivo (iptv-org: canais e emissões públicas) ----
const LIVE_TTL = 6 * 60 * 60 * 1000;
const liveStreamMeta = new Map();
let liveTvCache = null;
let liveTvPromise = null;
const TV_CATEGORY_LABELS = {
  general: 'Geral', news: 'Notícias', sports: 'Desporto', entertainment: 'Entretenimento', kids: 'Infantil', music: 'Música', movies: 'Filmes', series: 'Séries',
  documentary: 'Documentários', comedy: 'Comédia', culture: 'Cultura', education: 'Educação', family: 'Família', lifestyle: 'Estilo de vida', religious: 'Religião',
  science: 'Ciência', travel: 'Viagens', weather: 'Meteorologia', business: 'Negócios', cooking: 'Culinária', animation: 'Animação', auto: 'Automóvel',
  classic: 'Clássicos', legislative: 'Parlamento', outdoor: 'Natureza', relax: 'Relax', shop: 'Compras', interactive: 'Interativo', public: 'Serviço público',
};

function streamScore(stream) {
  const quality = Math.min(Number(String(stream.quality || '').match(/(\d{3,4})p/)?.[1]) || 480, 1080);
  return (stream.referrer || stream.user_agent ? 100000 : 0) + (/^https:/i.test(stream.url) ? 0 : 50000) - quality;
}

function parseM3u(text) {
  const entries = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      const attrs = {};
      line.replace(/([\w-]+)="([^"]*)"/g, (_match, key, value) => { attrs[key] = value; return ''; });
      current = { name: line.slice(line.lastIndexOf(',') + 1).trim(), group: attrs['group-title'] || '', tvgId: attrs['tvg-id'] || '', country: attrs['tvg-country'] || '', logo: attrs['tvg-logo'] || '', userAgent: '', referrer: '', origin: '' };
    } else if (current && line.startsWith('#EXTVLCOPT:')) {
      const [key, ...rest] = line.slice(11).split('=');
      const value = rest.join('=').replace(/^"|"$/g, '');
      if (key === 'http-user-agent') current.userAgent = value;
      else if (key === 'http-referrer' || key === 'http-referer') current.referrer = value;
      else if (key === 'http-origin') current.origin = value;
    } else if (current && line && !line.startsWith('#')) {
      if (/^https?:/i.test(line)) entries.push({ ...current, url: line });
      current = null;
    }
  }
  return entries;
}

const normalizeChannelName = (name) => String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').replace(/hd$/, '');

function guessTvCategory(name) {
  if (/not[ií]cias|news|cnn|euronews|bfm|sky news|al jazeera|france 24|dw\b|deutsche welle/i.test(name)) return 'Notícias';
  if (/kids|cartoon|anime|gulli|zig ?zag|infantil|disney|panda/i.test(name)) return 'Infantil';
  if (/music|m[úu]sica|trace|xite|deejay|vh1|clubbing|\bfm\b/i.test(name)) return 'Música';
  if (/cine|movie|film/i.test(name)) return 'Filmes';
  if (/sport|desporto|fifa|madrid|tennis|fuel|red bull|nautical|motor/i.test(name)) return 'Desporto';
  if (/ma[nñ]á|igreja|church|canção nova|kuriakos/i.test(name)) return 'Religião';
  return 'Geral';
}

async function loadLiveTv() {
  if (liveTvCache && Date.now() - liveTvCache.at < LIVE_TTL) return liveTvCache;
  if (!liveTvPromise) {
    liveTvPromise = (async () => {
      const base = 'https://iptv-org.github.io/api';
      const [channels, streams, logos, countries] = await Promise.all(['channels', 'streams', 'logos', 'countries'].map((name) => fetchPublicJson(`${base}/${name}.json`)));
      const logoByChannel = new Map();
      for (const logo of logos) {
        if (!logo.channel || !logo.url || logo.in_use === false) continue;
        const list = logoByChannel.get(logo.channel) || [];
        if (list.length < 3 && !list.includes(logo.url)) list.push(logo.url);
        logoByChannel.set(logo.channel, list);
      }
      const streamsByChannel = new Map();
      for (const stream of streams) {
        if (!stream.channel || !/^https?:/i.test(stream.url || '')) continue;
        if (!streamsByChannel.has(stream.channel)) streamsByChannel.set(stream.channel, []);
        streamsByChannel.get(stream.channel).push(stream);
      }
      let regionNames = null;
      try { regionNames = new Intl.DisplayNames(['pt-PT'], { type: 'region' }); } catch { regionNames = null; }
      const countryInfo = new Map(countries.map((country) => {
        let name = '';
        try { name = regionNames?.of(country.code) || ''; } catch { name = ''; }
        return [country.code, { code: country.code, flag: country.flag || '', name: name || country.name }];
      }));
      const byCountry = new Map();
      liveStreamMeta.clear();
      for (const channel of channels) {
        if (channel.is_nsfw || channel.closed || !channel.country || !countryInfo.has(channel.country)) continue;
        const list = streamsByChannel.get(channel.id);
        if (!list?.length) continue;
        const usable = [];
        const seen = new Set();
        for (const stream of list.slice().sort((a, b) => streamScore(a) - streamScore(b))) {
          if (seen.has(stream.url)) continue;
          seen.add(stream.url); usable.push(stream);
          if (usable.length >= 4) break;
        }
        usable.forEach((stream) => liveStreamMeta.set(stream.url, { referrer: stream.referrer || '', userAgent: stream.user_agent || '' }));
        const labels = (channel.categories?.length ? channel.categories : ['general']).map((id) => TV_CATEGORY_LABELS[id] || 'Outros');
        const info = countryInfo.get(channel.country);
        const fallbackLogo = `https://raw.githubusercontent.com/LITUATUI/M3UPT/main/logos/${channel.id}.png`;
        const ownLogos = logoByChannel.get(channel.id) || [];
        const posters = channel.country === 'PT' ? [fallbackLogo, ...ownLogos] : [...ownLogos, fallbackLogo];
        const item = {
          id: `live-${channel.id}`, type: 'Canal', title: channel.name, original: channel.name, creator: info.name, year: '', rating: '',
          genre: labels[0], genres: [...new Set(labels)], runtime: 'Ao vivo', poster: posters[0], posters, backdrop: posters[0], description: `Canal de televisão · ${info.name}`, accent: '#b30d1b',
          streams: usable.map((stream) => ({ url: stream.url, quality: stream.quality || '' })),
        };
        if (!byCountry.has(channel.country)) byCountry.set(channel.country, []);
        byCountry.get(channel.country).push(item);
      }
      const addEntry = (entry, code, priority) => {
        if (code.length !== 2 || !countryInfo.has(code)) return;
        const name = entry.name.replace(/\s*[ⒼⓈⓎⓅ]+\s*$/u, '').trim();
        const key = normalizeChannelName(name);
        if (!key || !/^https?:/i.test(entry.url) || /youtube\.com|youtu\.be/i.test(entry.url)) return;
        if (!byCountry.has(code)) byCountry.set(code, []);
        const list = byCountry.get(code);
        liveStreamMeta.set(entry.url, { referrer: entry.referrer, userAgent: entry.userAgent, origin: entry.origin });
        const stream = { url: entry.url, quality: '' };
        const existing = list.find((item) => normalizeChannelName(item.title) === key);
        if (existing) {
          if (!existing.streams.some((candidate) => candidate.url === entry.url)) existing.streams = (priority ? [stream, ...existing.streams] : [...existing.streams, stream]).slice(0, 6);
          return;
        }
        const label = guessTvCategory(name);
        list.push({
          id: `live-ext-${code}-${key}`, type: 'Canal', title: name, original: name, creator: countryInfo.get(code).name, year: '', rating: '',
          genre: label, genres: [label], runtime: 'Ao vivo', poster: entry.logo, posters: entry.logo ? [entry.logo] : [], backdrop: entry.logo,
          description: `Canal de televisão · ${countryInfo.get(code).name}`, accent: '#b30d1b', streams: [stream],
        });
      };
      const playlists = [
        { url: 'https://raw.githubusercontent.com/LITUATUI/M3UPT/main/M3U/M3UPT.m3u', priority: true, accept: (entry) => entry.group === 'TV', code: (entry) => entry.tvgId.split('.').pop() },
        { url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8', priority: false, accept: () => true, code: (entry) => entry.country || entry.tvgId.split('.').pop() },
      ];
      for (const source of playlists) {
        try {
          const response = await fetch(source.url, { headers: { 'User-Agent': 'StreamNexus/0.1' } });
          for (const entry of parseM3u(await response.text())) if (source.accept(entry)) addEntry(entry, String(source.code(entry) || '').toUpperCase(), source.priority);
        } catch { /* as listas complementares são opcionais */ }
      }
      for (const list of byCountry.values()) list.sort((a, b) => a.title.localeCompare(b.title, 'pt-PT'));
      liveTvCache = { at: Date.now(), byCountry, countryInfo };
      return liveTvCache;
    })().finally(() => { liveTvPromise = null; });
  }
  return liveTvPromise;
}

async function fetchLiveCountries() {
  const { byCountry, countryInfo } = await loadLiveTv();
  return [...byCountry.entries()]
    .map(([code, list]) => ({ ...countryInfo.get(code), count: list.length }))
    .sort((a, b) => (a.code === 'PT' ? -1 : b.code === 'PT' ? 1 : a.name.localeCompare(b.name, 'pt-PT')));
}

async function fetchLiveChannels({ country } = {}) {
  const { byCountry } = await loadLiveTv();
  const items = byCountry.get(String(country || '').toUpperCase());
  if (!items) throw new Error('Não há canais disponíveis para este país.');
  const counts = new Map();
  items.forEach((item) => item.genres.forEach((label) => counts.set(label, (counts.get(label) || 0) + 1)));
  return { items, categories: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })) };
}

function validateLiveStreamUrl(value) {
  const url = String(value || '');
  if (!liveStreamMeta.has(url)) throw new Error('Esta emissão já não está disponível. Volta a abrir a lista de canais.');
  return url;
}

// ---- Adultos (+18): APIs públicas do RedTube, Pornhub (Webmasters) e Eporner ----
const ADULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const adultVideoCache = new Map();
const ADULT_ROWS = [
  { eyebrow: 'EM ALTA', title: 'Mais vistos da semana', rt: { ordering: 'mostviewed', period: 'weekly' }, ph: { ordering: 'mostviewed', period: 'weekly' }, ep: 'top-weekly' },
  { eyebrow: 'ACABADOS DE CHEGAR', title: 'Novidades', rt: { ordering: 'newest' }, ph: { ordering: 'newest' }, ep: 'latest' },
  { eyebrow: 'ESCOLHA DOS UTILIZADORES', title: 'Mais bem avaliados', rt: { ordering: 'rating', period: 'weekly' }, ph: { ordering: 'rating', period: 'weekly' }, ep: 'top-rated' },
];

async function fetchAdultJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': ADULT_UA }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`A fonte respondeu com erro ${response.status}.`);
  return response.json();
}

function adultVideoItem(sourceLabel, code, id, title, thumb, duration, views, embedUrl, tags) {
  const poster = String(thumb || '').replace(/^http:/, 'https:');
  const labels = (tags || []).map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 4);
  return {
    id: `xxx-${code}-${id}`, type: 'Vídeo', title: String(title || 'Sem título').trim(), original: String(title || '').trim(), creator: `${sourceLabel} · ${duration || '—'}`,
    source: sourceLabel, year: '', rating: '', genre: labels[0] || 'Vídeo', genres: labels, runtime: duration || '', poster, backdrop: poster,
    description: `${duration || ''} · ${Number(views || 0).toLocaleString('pt-PT')} visualizações · ${sourceLabel}`, embedUrl, accent: '#b30d1b',
  };
}

const ADULT_ORIENTATIONS = {
  straight: {},
  gay: { rt: 'Gay', ph: 'gay', ep: '2' },
  trans: { rt: 'Transgender', ph: 'transgender', ep: '0', epTerm: 'trans' },
};

const redtubeThumbCache = new Map();
async function redtubeRealThumb(videoId) {
  const key = String(videoId);
  const hit = redtubeThumbCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.url;
  let url = '';
  try {
    const response = await fetch(`https://embed.redtube.com/?id=${encodeURIComponent(key)}`, { headers: { 'User-Agent': ADULT_UA }, signal: AbortSignal.timeout(8000) });
    const match = /"image_url":"([^"]+)"/.exec(await response.text());
    if (match) url = match[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
  } catch { url = ''; }
  if (/^https:\/\/[^/]*rdtcdn\.com\//i.test(url)) redtubeThumbCache.set(key, { at: Date.now(), url });
  else url = '';
  return url;
}

async function mapLimit(list, limit, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) { const index = next; next += 1; await worker(list[index], index); }
  }));
}

async function fetchRedtubeVideos({ ordering, period }, term, orientation, page = 1) {
  const category = ADULT_ORIENTATIONS[orientation]?.rt;
  const params = new URLSearchParams({ data: 'redtube.Videos.searchVideos', output: 'json', thumbsize: 'big', page: String(page), ordering, ...(period ? { period } : {}), ...(term ? { search: term } : {}), ...(category ? { category } : {}) });
  const data = await fetchAdultJson(`https://api.redtube.com/?${params}`);
  const items = (data.videos || []).map(({ video }) => adultVideoItem('RedTube', 'rt', video.video_id, video.title, '', video.duration, video.views, `https://embed.redtube.com/?id=${encodeURIComponent(video.video_id)}`, (video.tags || []).map((tag) => tag.tag_name)));
  await mapLimit(items, 8, async (item) => { const url = await redtubeRealThumb(item.id.slice('xxx-rt-'.length)); item.poster = url; item.backdrop = url; });
  return items.filter((item) => item.poster);
}

async function fetchPornhubVideos({ ordering, period }, term, orientation, page = 1) {
  const category = ADULT_ORIENTATIONS[orientation]?.ph;
  const params = new URLSearchParams({ ordering, thumbsize: 'large', page: String(page), ...(period ? { period } : {}), ...(term ? { search: term } : {}), ...(category ? { category } : {}) });
  let data = await fetchAdultJson(`https://www.pornhub.com/webmasters/search?${params}`);
  if (!data.videos?.length && period) { params.delete('period'); data = await fetchAdultJson(`https://www.pornhub.com/webmasters/search?${params}`); }
  return (data.videos || []).filter((video) => orientation !== 'straight' || video.segment !== 'gay').map((video) => adultVideoItem('Pornhub', 'ph', video.video_id, video.title, video.default_thumb || video.thumb, video.duration, video.views, `https://www.pornhub.com/embed/${encodeURIComponent(video.video_id)}`, (video.tags || []).map((tag) => tag.tag_name))).filter((item) => item.poster);
}

async function fetchEpornerVideos(order, term, orientation, page = 1) {
  const config = ADULT_ORIENTATIONS[orientation] || {};
  const query = [config.epTerm, term].filter(Boolean).join(' ') || 'all';
  const params = new URLSearchParams({ query, per_page: '30', page: String(page), thumbsize: 'big', order, gay: config.ep || '0', lq: '0', format: 'json' });
  const data = await fetchAdultJson(`https://www.eporner.com/api/v2/video/search/?${params}`);
  return (data.videos || []).map((video) => adultVideoItem('Eporner', 'ep', video.id, video.title, video.default_thumb?.src, video.length_min, video.views, video.embed, String(video.keywords || '').split(',').map((word) => word.trim()))).filter((item) => item.poster && item.embedUrl);
}

const adultKey = (title) => String(title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const adultStem = (title) => adultKey(title).split(' ').slice(0, 3).join(' ');

function interleaveAdult(lists, used, limit = 24) {
  const out = [];
  const stems = new Map();
  for (let index = 0; out.length < limit && lists.some((list) => index < list.length); index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (!item) continue;
      const key = adultKey(item.title);
      const stem = adultStem(item.title);
      if (!key || used.has(key) || (stem.length > 8 && (stems.get(stem) || 0) >= 2)) continue;
      used.add(key);
      stems.set(stem, (stems.get(stem) || 0) + 1);
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}

async function fetchAdultVideos(value = {}) {
  const term = String(value.term || '').toLowerCase().trim();
  const orientation = ADULT_ORIENTATIONS[value.orientation] ? value.orientation : 'straight';
  if (term && !/^[a-z0-9 -]{1,40}$/.test(term)) throw new Error('Categoria inválida.');
  const cacheKey = `${orientation}|${term}`;
  const cached = adultVideoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL) return cached.rows;
  const specs = term ? ADULT_ROWS.slice(0, 2) : ADULT_ROWS;
  const fetched = await Promise.all(specs.map(async (spec) => {
    const settled = await Promise.allSettled([fetchRedtubeVideos(spec.rt, term, orientation), fetchPornhubVideos(spec.ph, term, orientation), fetchEpornerVideos(spec.ep, term, orientation)]);
    return { spec, lists: settled.map((entry) => (entry.status === 'fulfilled' ? entry.value : [])) };
  }));
  const used = new Set();
  const rows = fetched.map(({ spec, lists }, rowIndex) => ({ eyebrow: spec.eyebrow, title: spec.title, items: interleaveAdult(lists, used), feedId: `adultv:row:${rowIndex}`, cursor: 2, hasMore: true }));
  if (!rows.some((row) => row.items.length)) throw new Error('Não foi possível obter vídeos das fontes (RedTube, Pornhub e Eporner) para esta seleção. Tenta outra categoria.');
  adultVideoCache.set(cacheKey, { at: Date.now(), rows });
  return rows;
}

// ---- Verificação das emissões (para esconder canais offline) ----
const liveHealth = new Map();
const liveProbeRuns = new Map();
const LIVE_HEALTH_TTL = 15 * 60 * 1000;

async function probeStream(stream) {
  const meta = liveStreamMeta.get(stream.url) || {};
  let origin = meta.origin || '';
  if (!origin && meta.referrer) { try { origin = new URL(meta.referrer).origin; } catch { origin = ''; } }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(stream.url, { headers: { 'User-Agent': meta.userAgent || LIVE_UA, Accept: '*/*', ...(meta.referrer ? { Referer: meta.referrer } : {}), ...(origin ? { Origin: origin } : {}) }, signal: controller.signal });
    if (!response.ok || !response.body) return false;
    const reader = response.body.getReader();
    const { value } = await reader.read();
    reader.cancel().catch(() => {});
    const head = Buffer.from(value || []).subarray(0, 16).toString('latin1');
    return head.startsWith('#EXTM3U') || /video|mpegurl|mp2t/i.test(response.headers.get('content-type') || '');
  } catch { return false; } finally { clearTimeout(timer); }
}

async function runLiveProbes(items, run) {
  const queue = [...items];
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      let best = '';
      for (const stream of item.streams) { if (await probeStream(stream)) { best = stream.url; break; } }
      liveHealth.set(item.id, { online: Boolean(best), best, at: Date.now() });
      run.done += 1;
    }
  };
  await Promise.all(Array.from({ length: 40 }, worker));
  run.running = false;
}

async function fetchLiveHealth({ country } = {}) {
  const code = String(country || '').toUpperCase();
  const { byCountry } = await loadLiveTv();
  const items = byCountry.get(code) || [];
  const now = Date.now();
  const stale = items.filter((item) => { const health = liveHealth.get(item.id); return !health || now - health.at > LIVE_HEALTH_TTL; }).slice(0, 600);
  let run = liveProbeRuns.get(code);
  if (stale.length && !run?.running) {
    run = { running: true, done: 0, total: stale.length };
    liveProbeRuns.set(code, run);
    runLiveProbes(stale, run).catch(() => { run.running = false; });
  }
  const results = {};
  items.forEach((item) => { const health = liveHealth.get(item.id); if (health) results[item.id] = { online: health.online, best: health.best }; });
  return { running: Boolean(run?.running), done: run?.done || 0, total: run?.total || 0, results };
}

// ---- Onde ler um livro (Open Library e Project Gutenberg) e abertura segura de ligações ----
const bookNorm = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function fetchBookSources(value = {}) {
  const key = String(value.key || '').replace(/[^A-Za-z0-9]/g, '');
  const title = String(value.title || '').slice(0, 200);
  const author = String(value.author || '').slice(0, 120);
  const out = { openLibrary: null, gutenberg: null, librivox: null, archive: null };
  await Promise.allSettled([
    (async () => {
      if (!key) return;
      const data = await fetchPublicJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(`key:/works/${key}`)}&fields=key,ebook_access,ia&limit=1`);
      const doc = data.docs?.[0];
      out.openLibrary = { access: doc?.ebook_access || 'no_ebook', url: `https://openlibrary.org/works/${key}`, archiveUrl: doc?.ia?.[0] ? `https://archive.org/details/${doc.ia[0]}` : '' };
    })(),
    (async () => {
      const data = await fetchPublicJson(`https://gutendex.com/books/?search=${encodeURIComponent([title, author].filter(Boolean).join(' '))}`, 8000);
      const wanted = bookNorm(title);
      const surname = bookNorm(author).split(' ').pop();
      const match = (data.results || []).find((entry) => {
        const candidate = bookNorm(entry.title);
        const titleOk = wanted && (candidate.startsWith(wanted.slice(0, 18)) || wanted.startsWith(candidate.slice(0, 18)));
        const authorOk = !surname || (entry.authors || []).some((person) => bookNorm(person.name).includes(surname));
        return titleOk && authorOk;
      });
      if (match) {
        const formats = match.formats || {};
        out.gutenberg = { title: match.title, epub: formats['application/epub+zip'] || '', mobi: formats['application/x-mobipocket-ebook'] || '', html: formats['text/html'] || '', page: `https://www.gutenberg.org/ebooks/${match.id}` };
      }
    })(),
    (async () => {
      const surname = bookNorm(author).split(' ').pop();
      const data = await fetchPublicJson(`https://librivox.org/api/feed/audiobooks/?title=${encodeURIComponent(`^${title}`)}&format=json&limit=5`);
      const match = (data.books || []).find((entry) => !surname || (entry.authors || []).some((person) => bookNorm(person.last_name).includes(surname)));
      if (match) out.librivox = { title: match.title, url: match.url_librivox, time: match.totaltime || '' };
    })(),
    (async () => {
      const surname = bookNorm(author).split(' ').pop();
      const clauses = [`title:("${title.replace(/["\\()]/g, ' ')}")`, surname ? `creator:(${surname})` : '', 'mediatype:texts', 'NOT access-restricted-item:true'].filter(Boolean).join(' AND ');
      const data = await fetchPublicJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(clauses)}&fl[]=identifier&fl[]=title&rows=2&sort[]=${encodeURIComponent('downloads desc')}&output=json`);
      const doc = data.response?.docs?.[0];
      if (doc) out.archive = { title: doc.title, url: `https://archive.org/details/${doc.identifier}` };
    })(),
  ]);
  return out;
}

const LINK_HOSTS = ['gutenberg.org', 'archive.org', 'openlibrary.org', 'librivox.org', 'open.spotify.com', 'music.apple.com', 'audius.co'];
async function openAllowedLink(value = {}) {
  let url;
  try { url = new URL(String(value.url || '')); } catch { throw new Error('Endereço inválido.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !LINK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) throw new Error('Este endereço não é permitido.');
  await shell.openExternal(url.toString());
  return { opened: true };
}

// ---- Logo de último recurso: imagem principal do artigo da Wikipédia do canal ----
const channelLogoCache = new Map();
async function fetchChannelLogo(value = {}) {
  const name = String(value.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) return '';
  const key = name.toLowerCase();
  if (channelLogoCache.has(key)) return channelLogoCache.get(key);
  const wanted = normalizeChannelName(name);
  const imageOf = async (lang, pageKey) => {
    const summary = await fetchPublicJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageKey)}`);
    if (summary.type !== 'standard' || !/televis|television|canal|channel|rede|emissora|network|\bTV\b/i.test(`${summary.description || ''} ${summary.extract || ''}`)) return '';
    const image = summary.thumbnail?.source || summary.originalimage?.source || '';
    return /^https:\/\/(upload|thumb)\.wikimedia\.org\//i.test(image) ? image : '';
  };
  let found = '';
  for (const lang of ['pt', 'en']) {
    try { found = await imageOf(lang, name.replace(/ /g, '_')); } catch { found = ''; }
    if (!found) {
      try {
        const search = await fetchPublicJson(`https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(name)}&limit=4`);
        for (const page of search.pages || []) {
          const title = normalizeChannelName(page.title);
          if (!wanted || !(title.includes(wanted) || wanted.includes(title))) continue;
          found = await imageOf(lang, page.key);
          if (found) break;
        }
      } catch { found = ''; }
    }
    if (found) break;
  }
  channelLogoCache.set(key, found);
  return found;
}

// ---- Música gratuita e completa: Internet Archive e Audius ----
const AUDIO_FORMATS = ['VBR MP3', 'MP3', '128Kbps MP3', '64Kbps MP3', 'Ogg Vorbis'];
async function searchArchiveAudio(artist, album) {
  const quote = (text) => String(text || '').replace(/["\\()]/g, ' ').trim();
  const clauses = [album ? `title:("${quote(album)}")` : '', artist ? `creator:("${quote(artist)}")` : ''].filter(Boolean).join(' AND ');
  const query = `${clauses} AND mediatype:audio`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=3&sort[]=${encodeURIComponent('downloads desc')}&output=json`;
  const data = await fetchPublicJson(url);
  const groups = [];
  for (const doc of data.response?.docs || []) {
    try {
      const meta = await fetchPublicJson(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
      const files = (meta.files || []).filter((file) => AUDIO_FORMATS.includes(file.format));
      const best = AUDIO_FORMATS.find((format) => files.some((file) => file.format === format));
      const tracks = files.filter((file) => file.format === best).slice(0, 30).map((file) => ({ title: file.title || file.name.replace(/\.[^.]+$/, ''), url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${file.name.split('/').map(encodeURIComponent).join('/')}`, duration: Number(file.length) || 0 }));
      if (tracks.length) groups.push({ source: 'Internet Archive', title: doc.title, creator: [].concat(doc.creator || '').join(', '), pageUrl: `https://archive.org/details/${doc.identifier}`, tracks });
    } catch { /* ignora itens sem ficheiros */ }
  }
  return groups;
}

async function searchAudius(artist, album) {
  const query = [artist, album].filter(Boolean).join(' ').slice(0, 120);
  const data = await fetchPublicJson(`https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&limit=8&app_name=StreamNexus`);
  const tracks = (data.data || []).filter((track) => track.id && track.title).map((track) => ({ title: `${track.title} · ${track.user?.name || ''}`.trim(), url: `https://api.audius.co/v1/tracks/${track.id}/stream?app_name=StreamNexus`, duration: Number(track.duration) || 0 }));
  return tracks.length ? [{ source: 'Audius', title: 'Faixas encontradas no Audius', creator: '', pageUrl: '', tracks }] : [];
}

const MUSIC_STOPWORDS = new Set(['the', 'and', 'del', 'les', 'los', 'las', 'der', 'die', 'das', 'van', 'von', 'various', 'artists', 'feat', 'with', 'deluxe', 'edition', 'version', 'remastered', 'remaster', 'original', 'soundtrack', 'motion', 'picture', 'score', 'banda', 'sonora', 'edicao']);
const musicWords = (text) => bookNorm(text).split(' ').filter((word) => word.length > 1 && !MUSIC_STOPWORDS.has(word));
// Fração das palavras pedidas que aparecem no texto (0..1)
const musicCoverage = (wanted, text) => {
  if (!wanted.length) return 0;
  const haystack = ` ${bookNorm(text)} `;
  return wanted.filter((word) => haystack.includes(` ${word} `) || (word.length > 3 && haystack.includes(word))).length / wanted.length;
};

async function fetchFreeMusic(value = {}) {
  const artist = String(value.artist || '').slice(0, 100);
  const album = String(value.album || '').slice(0, 120);
  const albumWords = musicWords(album);
  const artistWords = musicWords(artist);
  const settled = await Promise.allSettled([searchArchiveAudio(artist, album), searchArchiveAudio('', album), searchAudius(artist, album)]);
  const groups = [];
  const seen = new Set();
  for (const entry of settled) {
    if (entry.status !== 'fulfilled') continue;
    for (const group of entry.value) {
      const key = `${group.source}|${group.pageUrl || group.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (group.source === 'Audius') {
        // faixa individual: tem de falar do álbum/faixa pedido E do artista
        group.tracks = group.tracks.filter((track) => musicCoverage(albumWords, track.title) >= 0.99 && (!artistWords.length || musicCoverage(artistWords, track.title) >= 0.5));
        group.title = `Faixas de “${album}” no Audius`;
      } else {
        // coleção: o título tem de corresponder ao álbum (todas as palavras) e o autor, quando conhecido, não pode ser outro
        if (albumWords.length && musicCoverage(albumWords, group.title) < 0.99) continue;
        if (artistWords.length && musicCoverage(artistWords, `${group.creator} ${group.title}`) < 0.34) continue;
      }
      if (group.tracks.length) groups.push(group);
    }
  }
  return groups.slice(0, 4);
}

// ---- Feeds infinitos: páginas seguintes por prateleira, por categoria e prateleiras extra ----
const FEED_TTL = 10 * 60 * 1000;
const feedMemo = new Map();
async function memo(key, loader, ttl = FEED_TTL) {
  const hit = feedMemo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await loader();
  feedMemo.set(key, { at: Date.now(), value });
  if (feedMemo.size > 500) feedMemo.delete(feedMemo.keys().next().value);
  return value;
}
const feedSlug = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const tmdbConfigCache = new Map();
async function tmdbImageSettings(apiKey) {
  const cached = tmdbConfigCache.get(apiKey);
  if (cached && Date.now() - cached.at < 3600000) return cached.value;
  const value = await tmdbImageSettingsRaw(apiKey);
  tmdbConfigCache.set(apiKey, { at: Date.now(), value });
  return value;
}

// --- TMDB (filmes, séries, programas de TV) ---
const TMDB_LIST_PATHS = {
  movie: { trending: '/trending/movie/week', popular: '/movie/popular', now_playing: '/movie/now_playing', top_rated: '/movie/top_rated' },
  tv: { trending: '/trending/tv/week', popular: '/tv/popular', on_the_air: '/tv/on_the_air', top_rated: '/tv/top_rated', airing_today: '/tv/airing_today' },
};
const TMDB_GENRE_IDS = {
  movie: [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53, 10752, 37],
  tv: [10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10764, 10765, 10766, 10767, 10768, 37],
};
const TMDB_LIST_TITLES = {
  trending: ['EM ALTA', 'Em alta esta semana'], popular: ['POPULARES', 'Os mais populares'], now_playing: ['NO CINEMA E EM CASA', 'Estreias recentes'],
  top_rated: ['ESCOLHIDOS PARA TI', 'Mais bem avaliados'], on_the_air: ['NOVOS EPISÓDIOS', 'Séries a acompanhar'], airing_today: ['EM EMISSÃO HOJE', 'Hoje na televisão'],
};
const tmdbGenreId = (type, name) => TMDB_GENRE_IDS[type].find((id) => TMDB_GENRES[id] === name) || 0;

function tmdbShelfResource(type, shelfId, page) {
  const [, , part, first, second] = shelfId.split(':');
  const language = 'language=pt-PT';
  const dateKey = type === 'movie' ? 'primary_release_date' : 'first_air_date';
  if (part === 'list' && TMDB_LIST_PATHS[type][first]) return `${TMDB_LIST_PATHS[type][first]}?${language}&region=PT&page=${page}`;
  if (part === 'genre') {
    const sort = ['popularity.desc', 'vote_average.desc'].includes(second) ? second : 'popularity.desc';
    const votes = sort === 'vote_average.desc' ? `&vote_count.gte=${type === 'movie' ? 400 : 200}` : '';
    return `/discover/${type}?${language}&with_genres=${Number(first)}&sort_by=${sort}${votes}&page=${page}`;
  }
  if (part === 'decade') { const start = Number(first); return `/discover/${type}?${language}&sort_by=popularity.desc&${dateKey}.gte=${start}-01-01&${dateKey}.lte=${start + 9}-12-31&vote_count.gte=100&page=${page}`; }
  if (part === 'lang') return `/discover/${type}?${language}&with_original_language=${encodeURIComponent(first)}&sort_by=popularity.desc&page=${page}`;
  throw new Error('Prateleira inválida.');
}

function tmdbShelfDef(type, shelfId) {
  const [, , part, first, second] = shelfId.split(':');
  if (part === 'list') { const [eyebrow, title] = TMDB_LIST_TITLES[first] || ['EM DESTAQUE', 'Em destaque']; return { eyebrow, title }; }
  if (part === 'genre') { const name = TMDB_GENRES[first] || 'Género'; return second === 'vote_average.desc' ? { eyebrow: 'OS MELHORES', title: `Melhores de ${name}` } : { eyebrow: name.toUpperCase(), title: `Populares em ${name}` }; }
  if (part === 'decade') { const start = Number(first); return { eyebrow: 'VIAGEM NO TEMPO', title: start < 2000 ? `Anos ${String(start).slice(2)}` : `Anos ${start}` }; }
  if (part === 'lang') return { eyebrow: 'DE CASA', title: type === 'movie' ? 'Cinema português' : 'Séries portuguesas' };
  return { eyebrow: 'EM DESTAQUE', title: 'Em destaque' };
}

function tmdbExtraIds(type) {
  const ids = [];
  const decades = [2020, 2010, 2000, 1990, 1980];
  TMDB_GENRE_IDS[type].forEach((genreId, index) => {
    ids.push(`tmdb:${type}:genre:${genreId}:popularity.desc`);
    if (index % 3 === 1) ids.push(`tmdb:${type}:decade:${decades[Math.floor(index / 3) % decades.length]}`);
    ids.push(`tmdb:${type}:genre:${genreId}:vote_average.desc`);
    if (index === 3) ids.push(`tmdb:${type}:lang:pt`);
  });
  return [...new Set(ids)];
}

async function tmdbShelfPage(type, shelfId, cursor) {
  const { tmdbApiKey } = await readIntegrations();
  if (!tmdbApiKey) throw new Error('Adiciona a API key do TMDB em Integrações.');
  const { baseUrl, sizes } = await tmdbImageSettings(tmdbApiKey);
  const page = Math.max(1, Math.min(Number(cursor) || 1, 400));
  const data = await memo(`tmdb|${shelfId}|${page}`, () => tmdbRequest(tmdbShelfResource(type, shelfId, page), tmdbApiKey));
  const items = (data.results || []).filter((item) => item.poster_path).map((item) => normalizeTmdbItem({ ...item, media_type: type, ...(type === 'tv' ? { title: undefined } : {}) }, baseUrl, sizes));
  return { items, cursor: page + 1, hasMore: page < Math.min(data.total_pages || 1, 400) };
}

const tmdbFeed = (type) => ({
  firstCursor: 1,
  def: (id) => tmdbShelfDef(type, id),
  shelf: (id, cursor) => tmdbShelfPage(type, id, cursor),
  extraIds: () => tmdbExtraIds(type),
  category: (name, cursor) => {
    const genreId = tmdbGenreId(type, name);
    if (!genreId) return { items: [], cursor: 1, hasMore: false };
    return tmdbShelfPage(type, `tmdb:${type}:genre:${genreId}:popularity.desc`, cursor);
  },
});

// --- Música (iTunes / Spotify) ---
const MUSIC_EXTRA = [
  ['reggae', 'Reggae', 'O SOM DAS ILHAS'], ['country', 'Country', 'ESTRADAS DE POEIRA'], ['blues', 'Blues', 'ALMA E GUITARRA'], ['latin', 'Música latina', 'RITMOS LATINOS'],
  ['k-pop', 'K-pop', 'DIRETO DA CORÉIA'], ['r&b soul', 'R&B e soul', 'VOZES COM ALMA'], ['indie', 'Indie', 'FORA DO COMUM'], ['heavy metal', 'Heavy metal', 'PESADO E RÁPIDO'],
  ['punk', 'Punk', 'ATITUDE'], ['funk', 'Funk', 'GROOVE'], ['samba bossa nova', 'Samba e bossa nova', 'BRASIL'], ['mpb', 'MPB', 'MÚSICA BRASILEIRA'],
  ['classical', 'Clássica', 'ORQUESTRAS'], ['opera', 'Ópera', 'GRANDES VOZES'], ['gospel', 'Gospel', 'ESPERANÇA'], ['lofi chill', 'Chill e lo-fi', 'PARA RELAXAR'],
  ['disco', 'Disco', 'NOITES DE DISCO'], ['house', 'House', 'NA PISTA'], ['techno', 'Techno', 'BATIDAS'], ['ambient', 'Ambiente', 'SONS SUAVES'],
  ['80s hits', 'Anos 80', 'NOSTALGIA'], ['90s hits', 'Anos 90', 'NOSTALGIA'], ['2000s hits', 'Anos 2000', 'NOSTALGIA'], ['acoustic', 'Acústico', 'SÓ VOZ E GUITARRA'],
  ['workout', 'Treino', 'ENERGIA'], ['christmas', 'Natal', 'ÉPOCA FESTIVA'], ['children songs', 'Para os mais novos', 'EM FAMÍLIA'], ['afrobeats', 'Afrobeats', 'ÁFRICA EM ALTA'],
  ['flamenco', 'Flamenco', 'PAIXÃO'], ['alternative', 'Alternativa', 'OUTRAS VIAS'],
].map(([term, title, eyebrow]) => ({ term, title, eyebrow }));
const MUSIC_ALL = [...MUSIC_SHELVES, ...MUSIC_EXTRA];
const SPOTIFY_TERMS = { 'top hits': 'tag:new', 'hip hop': 'genre:"hip-hop"', 'jazz classical': 'genre:"jazz"', 'fado portugal': 'genre:"fado"', 'r&b soul': 'genre:"r-n-b"', 'heavy metal': 'genre:"metal"', 'lofi chill': 'genre:"chill"', 'samba bossa nova': 'genre:"samba"', 'children songs': 'genre:"children"', 'k-pop': 'genre:"k-pop"' };

const itunesStamps = [];
async function itunesAlbums(term) {
  // a API do iTunes ignora "offset": pede-se o máximo (200) uma vez e pagina-se localmente
  return memo(`itunes|${term}`, async () => {
    while (itunesStamps.length && Date.now() - itunesStamps[0] > 60000) itunesStamps.shift();
    if (itunesStamps.length >= 17) await new Promise((resolve) => setTimeout(resolve, 60000 - (Date.now() - itunesStamps[0]) + 200));
    itunesStamps.push(Date.now());
    const params = new URLSearchParams({ term, media: 'music', entity: 'album', country: 'PT', limit: '200' });
    const data = await fetchPublicJson(`https://itunes.apple.com/search?${params}`);
    const seen = new Set();
    return (data.results || []).filter((album) => album.collectionId && album.collectionName && album.artworkUrl100 && !seen.has(album.collectionId) && seen.add(album.collectionId)).map(normalizeAlbum);
  });
}

async function musicPage(term, cursor) {
  const offset = Math.max(0, Number(cursor) || 0);
  const settings = await readIntegrations();
  if (settings.spotifyClientId && settings.spotifyClientSecret) {
    try {
      const token = await spotifyAccessToken(settings.spotifyClientId, settings.spotifyClientSecret);
      const label = MUSIC_ALL.find((entry) => entry.term === term)?.title || term;
      const data = await memo(`spotify|${term}|${offset}`, () => (term === 'new-releases'
        ? spotifyGet(token, '/browse/new-releases', { country: 'PT', offset: String(offset) })
        : spotifyGet(token, '/search', { q: SPOTIFY_TERMS[term] || (/\s/.test(term) ? term : `genre:"${term}"`), type: 'album', market: 'PT', offset: String(offset) })));
      const list = data.albums?.items || [];
      const seen = new Set();
      const items = list.filter((album) => album?.id && album.name && album.images?.length && !seen.has(album.id) && seen.add(album.id)).map((album, index) => normalizeSpotifyAlbum(album, { genre: term, title: label }, index));
      if (items.length) return { items, cursor: offset + list.length, hasMore: offset + list.length < 900 };
    } catch { /* usa o iTunes como alternativa */ }
  }
  if (term === 'new-releases') return { items: [], cursor: 0, hasMore: false };
  const all = await itunesAlbums(term);
  return { items: all.slice(offset, offset + 30), cursor: offset + 30, hasMore: offset + 30 < all.length };
}

const musicFeed = {
  firstCursor: 0,
  def: (id) => MUSIC_ALL.find((entry) => `music:${entry.term}` === id) || { eyebrow: 'MÚSICA', title: 'Álbuns' },
  shelf: (id, cursor) => musicPage(id.slice(6), cursor),
  extraIds: () => MUSIC_EXTRA.map((entry) => `music:${entry.term}`),
  category: (name, cursor) => musicPage(MUSIC_ALL.find((entry) => entry.title.toLowerCase() === String(name).toLowerCase())?.term || String(name).toLowerCase(), cursor),
};

// --- Livros (Open Library) ---
const BOOK_EXTRA = [
  ['thriller', 'Thriller e suspense', 'TENSÃO ATÉ À ÚLTIMA PÁGINA'], ['historical_fiction', 'Ficção histórica', 'VIAJA NO TEMPO'], ['classic_literature', 'Clássicos', 'PARA LER UMA VEZ NA VIDA'],
  ['young_adult_fiction', 'Jovem adulto', 'JUVENTUDE'], ['childrens_literature', 'Infantil', 'PARA OS MAIS NOVOS'], ['history', 'História', 'O QUE JÁ ACONTECEU'], ['science', 'Ciência', 'CURIOSIDADE'],
  ['philosophy', 'Filosofia', 'GRANDES PERGUNTAS'], ['psychology', 'Psicologia', 'A MENTE HUMANA'], ['self-help', 'Desenvolvimento pessoal', 'MELHORA-TE'], ['business', 'Negócios', 'EMPREENDEDORISMO'],
  ['cooking', 'Culinária', 'À MESA'], ['travel', 'Viagens', 'CONHECE O MUNDO'], ['art', 'Arte', 'OLHA E SENTE'], ['poetry', 'Poesia', 'VERSOS'], ['humor', 'Humor', 'RISO GARANTIDO'],
  ['dystopias', 'Distopia', 'FUTUROS SOMBRIOS'], ['adventure', 'Aventura', 'PARA FUGIR'], ['war', 'Guerra', 'HISTÓRIAS DE CONFLITO'], ['memoirs', 'Memórias', 'VIDAS REAIS'],
  ['religion', 'Religião', 'FÉ E ESPIRITUALIDADE'], ['politics', 'Política', 'PODER'], ['economics', 'Economia', 'DINHEIRO'], ['technology', 'Tecnologia', 'DIGITAL'], ['nature', 'Natureza', 'LÁ FORA'],
  ['sports', 'Desporto', 'EM CAMPO'], ['mythology', 'Mitologia', 'DEUSES E HERÓIS'], ['true_crime', 'Crime real', 'CASOS REAIS'], ['short_stories', 'Contos', 'LEITURAS CURTAS'], ['theatre', 'Teatro', 'PALCO'],
].map(([subject, genre, eyebrow]) => ({ subject, genre, title: genre, eyebrow }));
const BOOK_ALL = [
  ...BOOK_SHELVES.map((shelf) => ({ subject: /\/subjects\/([^.]+)\.json/.exec(shelf.url)?.[1] || 'trending', genre: shelf.genre, title: shelf.title, eyebrow: shelf.eyebrow })),
  ...BOOK_EXTRA,
];

async function bookPage(subject, cursor, genre) {
  const offset = Math.max(0, Number(cursor) || 0);
  const url = subject === 'trending'
    ? `https://openlibrary.org/trending/weekly.json?limit=30&page=${Math.floor(offset / 30) + 1}`
    : `https://openlibrary.org/subjects/${encodeURIComponent(subject)}.json?limit=30&offset=${offset}`;
  const data = await memo(`books|${subject}|${offset}`, () => fetchPublicJson(url));
  const works = data.works || [];
  const items = works.filter((work) => work.title && (work.cover_id || work.cover_i)).map((work, index) => normalizeBook(work, { genre }, index));
  return { items, cursor: offset + 30, hasMore: works.length >= 20 && offset < 600 };
}

const bookFeed = {
  firstCursor: 0,
  def: (id) => BOOK_ALL.find((entry) => `books:${entry.subject}` === id) || { eyebrow: 'LIVROS', title: 'Livros' },
  shelf: (id, cursor) => { const entry = BOOK_ALL.find((candidate) => `books:${candidate.subject}` === id); return bookPage(id.slice(6), cursor, entry?.genre || 'Livros'); },
  extraIds: () => BOOK_EXTRA.map((entry) => `books:${entry.subject}`),
  category: async (name, cursor) => {
    const entry = BOOK_ALL.find((candidate) => candidate.genre.toLowerCase() === String(name).toLowerCase());
    if (entry) return bookPage(entry.subject, cursor, entry.genre);
    const offset = Math.max(0, Number(cursor) || 0);
    const data = await memo(`books|search|${name}|${offset}`, () => fetchPublicJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(`subject:"${name}"`)}&fields=key,title,author_name,cover_i,first_publish_year&limit=30&offset=${offset}`));
    const docs = data.docs || [];
    return { items: docs.filter((work) => work.title && work.cover_i).map((work, index) => normalizeBook(work, { genre: String(name) }, index)), cursor: offset + 30, hasMore: docs.length >= 20 && offset < 600 };
  },
};

// --- Adultos: cinema (TMDB) e vídeos (RedTube, Pornhub, Eporner) ---
const adultKeywordCache = new Map();
async function adultKeywordIds(index, apiKey) {
  if (adultKeywordCache.has(index)) return adultKeywordCache.get(index);
  const ids = new Set();
  for (const keyword of ADULT_SHELVES[index].keywords) {
    try {
      const found = await tmdbRequest(`/search/keyword?query=${encodeURIComponent(keyword)}`, apiKey);
      (found.results || []).slice(0, 2).forEach((entry) => ids.add(entry.id));
    } catch { /* ignora palavras-chave sem resultados */ }
  }
  const joined = [...ids].join('|');
  adultKeywordCache.set(index, joined);
  return joined;
}

async function adultCinemaPage(index, cursor) {
  const shelf = ADULT_SHELVES[index];
  if (!shelf) return { items: [], cursor: 1, hasMore: false };
  const { tmdbApiKey } = await readIntegrations();
  if (!tmdbApiKey) throw new Error('Adiciona a API key do TMDB em Integrações.');
  const { baseUrl, sizes } = await tmdbImageSettings(tmdbApiKey);
  const keywords = await adultKeywordIds(index, tmdbApiKey);
  if (!keywords) return { items: [], cursor: 1, hasMore: false };
  const page = Math.max(1, Math.min(Number(cursor) || 1, 200));
  const data = await memo(`adultc|${index}|${page}`, () => tmdbRequest(`/discover/movie?language=pt-PT&include_adult=true&sort_by=popularity.desc&with_keywords=${keywords}&page=${page}`, tmdbApiKey));
  const items = (data.results || []).filter((item) => item.poster_path).map((item) => ({ ...normalizeTmdbItem({ ...item, media_type: 'movie' }, baseUrl, sizes), adult: true, genre: shelf.title, genres: [shelf.title] }));
  return { items, cursor: page + 1, hasMore: page < Math.min(data.total_pages || 1, 200) };
}

const adultCinemaFeed = {
  firstCursor: 1,
  def: (id) => ADULT_SHELVES[Number(id.split(':')[1])] || { eyebrow: 'EM DESTAQUE', title: 'Cinema' },
  shelf: (id, cursor) => adultCinemaPage(Number(id.split(':')[1]), cursor),
  extraIds: () => [],
  category: (name, cursor) => adultCinemaPage(ADULT_SHELVES.findIndex((shelf) => shelf.title === name), cursor),
};

const ADULTV_CATEGORIES = [
  ["amateur", "Amador"], ["homemade", "Caseiro"], ["couple", "Casal"], ["webcam", "Webcam"], ["hidden cam", "Câmara escondida"],
  ["voyeur", "Voyeur"], ["selfie", "Selfie"], ["asian", "Asiático"], ["japanese", "Japonês"], ["korean", "Coreano"],
  ["thai", "Tailandês"], ["indian", "Indiano"], ["arab", "Árabe"], ["latina", "Latino"], ["brazilian", "Brasileiro"],
  ["colombian", "Colombiano"], ["ebony", "Ébano"], ["african", "Africano"], ["european", "Europeu"], ["czech", "Checo"],
  ["russian", "Russo"], ["german", "Alemão"], ["french", "Francês"], ["british", "Britânico"], ["italian", "Italiano"],
  ["spanish", "Espanhol"], ["portuguese", "Português"], ["turkish", "Turco"], ["interracial", "Interracial"], ["lesbian", "Lésbicas"],
  ["milf", "MILF"], ["mature", "Madura"], ["granny", "Avó"], ["redhead", "Ruiva"], ["blonde", "Loira"],
  ["brunette", "Morena"], ["petite", "Pequena"], ["bbw", "BBW"], ["tall", "Alta"], ["muscular", "Musculada"],
  ["fitness", "Fitness"], ["tattoo", "Tatuagens"], ["piercing", "Piercings"], ["big tits", "Peitos grandes"], ["natural tits", "Peitos naturais"],
  ["big ass", "Rabo grande"], ["legs", "Pernas"], ["feet", "Pés"], ["hairy", "Cabeludo"], ["shaved", "Depilada"],
  ["chubby", "Gordinha"], ["pornstar", "Estrela porno"], ["celebrity", "Celebridade"], ["hands", "Mãos"], ["anal", "Anal"],
  ["blowjob", "Oral"], ["deepthroat", "Garganta funda"], ["cunnilingus", "Sexo oral feminino"], ["masturbation", "Masturbação"], ["handjob", "Masturbação manual"],
  ["fingering", "Dedos"], ["squirt", "Squirt"], ["creampie", "Creampie"], ["facial", "Facial"], ["cumshot", "Ejaculação"],
  ["cum", "Gozada"], ["bukkake", "Bukkake"], ["rimming", "Rimming"], ["titfuck", "Espanholada"], ["69", "Sessenta e nove"],
  ["toys", "Brinquedos"], ["vibrator", "Vibrador"], ["dildo", "Dildo"], ["threesome", "Trio"], ["orgy", "Orgia"],
  ["gangbang", "Gangbang"], ["group sex", "Sexo em grupo"], ["double penetration", "Dupla penetração"], ["swingers", "Swingers"], ["cuckold", "Cuckold"],
  ["hotwife", "Hotwife"], ["swap", "Troca de casais"], ["cowgirl", "Cowgirl"], ["reverse cowgirl", "Cowgirl invertida"], ["doggy style", "Doggy style"],
  ["missionary", "Missionário"], ["slow", "Sexo lento"], ["rough", "Sexo selvagem"], ["hardcore", "Hardcore"], ["softcore", "Softcore"],
  ["sensual", "Sensual"], ["romantic", "Romântico"], ["shy", "Tímida"], ["passionate", "Apaixonados"], ["bdsm", "BDSM"],
  ["bondage", "Bondage"], ["femdom", "Dominação"], ["submissive", "Submissão"], ["spanking", "Palmadas"], ["facesitting", "Facesitting"],
  ["fetish", "Fetiche"], ["latex", "Látex"], ["leather", "Couro"], ["stockings", "Meias"], ["pantyhose", "Collants"],
  ["lingerie", "Lingerie"], ["high heels", "Saltos altos"], ["bikini", "Biquíni"], ["panties", "Roupa interior"], ["massage", "Massagem"],
  ["oil", "Óleo"], ["shower", "Chuveiro"], ["bathroom", "Casa de banho"], ["bathtub", "Banheira"], ["pool", "Piscina"],
  ["beach", "Praia"], ["outdoor", "Ar livre"], ["public", "Sexo em público"], ["car", "Carro"], ["kitchen", "Cozinha"],
  ["couch", "Sofá"], ["bedroom", "Quarto"], ["hotel", "Hotel"], ["office", "Escritório"], ["gym", "Ginásio"],
  ["sauna", "Sauna"], ["nurse", "Enfermeira"], ["teacher", "Professora"], ["secretary", "Secretária"], ["doctor", "Médica"],
  ["masseuse", "Massagista"], ["maid", "Empregada"], ["uniform", "Uniforme"], ["police", "Polícia"], ["roleplay", "Encenação"],
  ["cosplay", "Cosplay"], ["halloween", "Halloween"], ["hentai", "Hentai"], ["anime", "Anime"], ["cartoon", "Desenhos animados"],
  ["3d", "3D"], ["parody", "Paródia"], ["vintage", "Clássico"], ["retro", "Retro"], ["full movie", "Filmes completos"],
  ["compilation", "Compilações"], ["best of", "Melhores momentos"], ["vr", "Realidade virtual"], ["pov", "POV"], ["close up", "Primeiro plano"],
  ["slow motion", "Câmara lenta"],
];
const ADULTV_MONTHLY = { rt: { ordering: 'mostviewed', period: 'monthly' }, ph: { ordering: 'mostviewed', period: 'monthly' }, ep: 'top-monthly' };
const ADULTV_NEWEST = { rt: { ordering: 'newest' }, ph: { ordering: 'newest' }, ep: 'latest' };
const ADULTV_RATED = { rt: { ordering: 'rating', period: 'monthly' }, ph: { ordering: 'rating', period: 'monthly' }, ep: 'top-rated' };

async function adultVideosPage(spec, term, orientation, cursor) {
  const page = Math.max(1, Math.min(Number(cursor) || 1, 25));
  return memo(`adultv|${orientation}|${term}|${JSON.stringify(spec)}|${page}`, async () => {
    const settled = await Promise.allSettled([fetchRedtubeVideos(spec.rt, term, orientation, page), fetchPornhubVideos(spec.ph, term, orientation, page), fetchEpornerVideos(spec.ep, term, orientation, page)]);
    const items = interleaveAdult(settled.map((entry) => (entry.status === 'fulfilled' ? entry.value : [])), new Set(), 36);
    return { items, cursor: page + 1, hasMore: items.length > 0 && page < 25 };
  }, 5 * 60 * 1000);
}

const adultVideosFeed = {
  firstCursor: 1,
  def: (id) => {
    if (id.startsWith('adultv:row:')) { const row = ADULT_ROWS[Number(id.split(':')[2])] || ADULT_ROWS[0]; return { eyebrow: row.eyebrow, title: row.title }; }
    const [, mode, term] = id.split(':');
    const entry = ADULTV_CATEGORIES.find(([key]) => key === term);
    const label = entry ? entry[1] : 'Vídeos';
    return mode === 'new' ? { eyebrow: 'ACABADOS DE CHEGAR', title: `Novidades · ${label}` } : mode === 'rated' ? { eyebrow: 'ESCOLHA DOS UTILIZADORES', title: `Mais bem avaliados · ${label}` } : { eyebrow: 'CATEGORIA', title: `Mais vistos · ${label}` };
  },
  shelf: (id, cursor, ctx) => {
    if (id.startsWith('adultv:row:')) return adultVideosPage(ADULT_ROWS[Number(id.split(':')[2])] || ADULT_ROWS[0], '', ctx.orientation, cursor);
    const [, mode, term] = id.split(':');
    return adultVideosPage(mode === 'new' ? ADULTV_NEWEST : mode === 'rated' ? ADULTV_RATED : ADULTV_MONTHLY, term, ctx.orientation, cursor);
  },
  extraIds: () => [...ADULTV_CATEGORIES.map(([term]) => `adultv:cat:${term}`), ...ADULTV_CATEGORIES.map(([term]) => `adultv:new:${term}`), ...ADULTV_CATEGORIES.map(([term]) => `adultv:rated:${term}`)],
  category: (name, cursor, ctx) => {
    const entry = ADULTV_CATEGORIES.find(([, label]) => label === name);
    return adultVideosPage(ADULTV_MONTHLY, entry ? entry[0] : String(name).toLowerCase(), ctx.orientation, cursor);
  },
};

// --- Pesquisa por separador: resultados paginados e completos ---
const ADULTV_SEARCH = { rt: { ordering: 'mostviewed' }, ph: { ordering: 'mostviewed' }, ep: 'most-popular' };

async function tmdbSearchPage(type, query, cursor, adultOnly = false) {
  const { tmdbApiKey } = await readIntegrations();
  if (!tmdbApiKey) throw new Error('Adiciona a API key do TMDB em Integrações.');
  const { baseUrl, sizes } = await tmdbImageSettings(tmdbApiKey);
  const page = Math.max(1, Math.min(Number(cursor) || 1, 200));
  const data = await memo(`tmdbs|${type}|${adultOnly}|${query}|${page}`, () => tmdbRequest(`/search/${type}?language=pt-PT&query=${encodeURIComponent(query)}&include_adult=${adultOnly}&page=${page}`, tmdbApiKey), 5 * 60 * 1000);
  const items = (data.results || [])
    .filter((item) => item.poster_path && (type !== 'multi' || ['movie', 'tv'].includes(item.media_type)) && (!adultOnly || item.adult))
    .map((item) => {
      const mediaType = type === 'multi' ? item.media_type : type;
      const base = normalizeTmdbItem({ ...item, media_type: mediaType, ...(mediaType === 'tv' ? { title: undefined } : {}) }, baseUrl, sizes);
      return adultOnly ? { ...base, adult: true } : base;
    });
  return { items, cursor: page + 1, hasMore: page < Math.min(data.total_pages || 1, 200) };
}

async function musicSearchPage(query, cursor) {
  const offset = Math.max(0, Number(cursor) || 0);
  const settings = await readIntegrations();
  if (settings.spotifyClientId && settings.spotifyClientSecret) {
    try {
      const token = await spotifyAccessToken(settings.spotifyClientId, settings.spotifyClientSecret);
      const data = await memo(`spotify-s|${query}|${offset}`, () => spotifyGet(token, '/search', { q: query, type: 'album', market: 'PT', offset: String(offset) }), 5 * 60 * 1000);
      const list = data.albums?.items || [];
      const seen = new Set();
      const items = list.filter((album) => album?.id && album.name && album.images?.length && !seen.has(album.id) && seen.add(album.id)).map((album, index) => normalizeSpotifyAlbum(album, { genre: 'Música', title: 'Música' }, index));
      if (items.length) return { items, cursor: offset + list.length, hasMore: offset + list.length < 900 };
    } catch { /* usa o iTunes como alternativa */ }
  }
  const all = await itunesAlbums(query);
  return { items: all.slice(offset, offset + 30), cursor: offset + 30, hasMore: offset + 30 < all.length };
}

async function bookSearchPage(query, cursor) {
  const offset = Math.max(0, Number(cursor) || 0);
  const data = await memo(`books-s|${query}|${offset}`, () => fetchPublicJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key,title,author_name,cover_i,first_publish_year&limit=30&offset=${offset}`), 5 * 60 * 1000);
  const docs = data.docs || [];
  const items = docs.filter((work) => work.title && work.key).map((work, index) => normalizeBook(work, { genre: 'Livros' }, index));
  return { items, cursor: offset + 30, hasMore: docs.length > 0 && offset + docs.length < (data.numFound || 0) && offset < 1000 };
}

const SEARCHES = {
  home: (query, cursor) => tmdbSearchPage('multi', query, cursor),
  films: (query, cursor) => tmdbSearchPage('movie', query, cursor),
  series: (query, cursor) => tmdbSearchPage('tv', query, cursor),
  tv: (query, cursor) => tmdbSearchPage('tv', query, cursor),
  adult: (query, cursor) => tmdbSearchPage('movie', query, cursor, true),
  music: musicSearchPage,
  books: bookSearchPage,
  adultvideos: (query, cursor, ctx) => adultVideosPage(ADULTV_SEARCH, query.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, ' ').replace(/\s+/g, ' ').trim(), ctx.orientation, cursor),
};

async function feedSearch(value = {}) {
  const run = SEARCHES[value.kind];
  if (!run) throw new Error('Tipo de pesquisa inválido.');
  const query = String(value.query || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!query) return { items: [], cursor: 1, hasMore: false };
  const cursor = value.cursor ?? (['music', 'books'].includes(value.kind) ? 0 : 1);
  return withTimeout(run(query, cursor, { orientation: feedOrientation(value.orientation) }));
}

const FEEDS = { films: tmdbFeed('movie'), series: tmdbFeed('tv'), tv: tmdbFeed('tv'), music: musicFeed, books: bookFeed, adult: adultCinemaFeed, adultvideos: adultVideosFeed };
const feedOrientation = (value) => (ADULT_ORIENTATIONS[value] ? value : 'straight');

const withTimeout = (promise, ms = 30000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('A fonte demorou demasiado a responder.')), ms))]);

async function feedShelf(value = {}) {
  const feed = FEEDS[value.kind];
  if (!feed) throw new Error('Tipo de feed inválido.');
  return withTimeout(feed.shelf(String(value.shelfId || ''), value.cursor ?? feed.firstCursor, { orientation: feedOrientation(value.orientation) }));
}

async function feedCategory(value = {}) {
  const feed = FEEDS[value.kind];
  if (!feed) throw new Error('Tipo de feed inválido.');
  return withTimeout(Promise.resolve(feed.category(String(value.category || ''), value.cursor ?? feed.firstCursor, { orientation: feedOrientation(value.orientation) })));
}

async function feedShelves(value = {}) {
  const feed = FEEDS[value.kind];
  if (!feed) throw new Error('Tipo de feed inválido.');
  const ctx = { orientation: feedOrientation(value.orientation) };
  const ids = feed.extraIds(ctx);
  const offset = Math.max(0, Number(value.offset) || 0);
  const slice = ids.slice(offset, offset + Math.max(1, Math.min(Number(value.count) || 2, 4)));
  const shelves = await Promise.all(slice.map(async (id) => {
    try {
      const page = await withTimeout(feed.shelf(id, feed.firstCursor, ctx));
      return { ...feed.def(id), feedId: id, items: page.items, cursor: page.cursor, hasMore: page.hasMore };
    } catch { return null; }
  }));
  return { shelves: shelves.filter(Boolean), consumed: slice.length, done: offset + slice.length >= ids.length };
}

async function fetchDiscovery({ kind } = {}) {
  const loaders = { tv: fetchTvDiscovery, music: fetchMusicDiscovery, books: fetchBooksDiscovery, adult: fetchAdultDiscovery };
  if (!loaders[kind]) throw new Error('Tipo de descoberta inválido.');
  const cached = discoveryCache.get(kind);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL) return cached.rows;
  const rows = await loaders[kind]();
  discoveryCache.set(kind, { at: Date.now(), rows });
  return rows;
}

async function openExternalPlayer(streamUrl) {
  let url;
  try { url = new URL(String(streamUrl || '')); } catch { throw new Error('O endereço do vídeo não é válido.'); }
  if (url.protocol !== 'https:') throw new Error('O leitor externo só aceita ligações HTTPS.');
  let executable;
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe'),
    ];
    for (const candidate of candidates) {
      try { await fs.access(candidate); executable = candidate; break; } catch { /* tenta a pasta seguinte */ }
    }
  } else if (process.platform === 'darwin') {
    const candidate = '/Applications/VLC.app/Contents/MacOS/VLC';
    try { await fs.access(candidate); executable = candidate; } catch { /* VLC não está na localização padrão */ }
  } else {
    executable = 'vlc';
  }
  if (!executable) throw new Error('Não encontrei o VLC. Instala-o ou reproduz o vídeo no leitor integrado.');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [url.toString()], { detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Não encontrei o VLC. Instala-o ou reproduz o vídeo no leitor integrado.');
    throw error;
  }
  return true;
}

async function findFfmpegExecutable() {
  const bundledPath = path.join(process.resourcesPath || '', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const candidates = [bundledPath, staticFfmpegPath, 'ffmpeg'].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (candidate === 'ffmpeg') return candidate;
      await fs.access(candidate);
      return candidate;
    } catch { /* tenta a seguinte localização */ }
  }
  throw new Error('Não encontrei o conversor de áudio da app. Reinstala o StreamNexus para reparar o leitor.');
}

function validateRealDebridStreamUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('O endereço do vídeo não é válido.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || !(host.endsWith('.real-debrid.com') || host === 'real-debrid.com' || host.endsWith('.rdeb.io') || host === 'rdeb.io')) {
    throw new Error('O leitor integrado só aceita ligações seguras do Real-Debrid.');
  }
  return url.toString();
}

// Lista as faixas de áudio (idioma, título, codec, canais) a partir da saída do `ffmpeg -i`.
const AUDIO_LANGS = { por: 'Português', pt: 'Português', eng: 'Inglês', en: 'Inglês', spa: 'Espanhol', es: 'Espanhol', fra: 'Francês', fre: 'Francês', fr: 'Francês', deu: 'Alemão', ger: 'Alemão', de: 'Alemão', ita: 'Italiano', it: 'Italiano', jpn: 'Japonês', ja: 'Japonês', kor: 'Coreano', ko: 'Coreano', zho: 'Chinês', chi: 'Chinês', zh: 'Chinês', rus: 'Russo', ru: 'Russo', ara: 'Árabe', hin: 'Hindi', pol: 'Polaco', nld: 'Neerlandês', dut: 'Neerlandês', swe: 'Sueco', nor: 'Norueguês', dan: 'Dinamarquês', fin: 'Finlandês', tur: 'Turco', ces: 'Checo', cze: 'Checo', hun: 'Húngaro', ron: 'Romeno', rum: 'Romeno', ell: 'Grego', gre: 'Grego', heb: 'Hebraico', tha: 'Tailandês', vie: 'Vietnamita', ind: 'Indonésio', ukr: 'Ucraniano', cat: 'Catalão' };
function parseAudioTracks(output) {
  const blocks = String(output || '').split(/\n(?=\s*Stream #0:)/);
  const tracks = [];
  for (const block of blocks) {
    const head = block.match(/^\s*Stream #0:\d+(?:\[[^\]]*\])?(?:\(([^)]*)\))?[^:\n]*:\s*Audio:\s*([a-z0-9_]+)([^\n]*)/i);
    if (!head) continue;
    const lang = (head[1] || '').toLowerCase();
    const detail = head[3] || '';
    const channels = /\b(mono|stereo)\b/i.exec(detail)?.[1] || /\b(\d\.\d)(?:\([^)]*\))?/.exec(detail)?.[1] || '';
    const title = block.match(/\n\s*title\s*:\s*(.+)/i)?.[1]?.trim() || '';
    tracks.push({ index: tracks.length, lang, label: AUDIO_LANGS[lang] || (lang && lang !== 'und' ? lang.toUpperCase() : 'Desconhecido'), title, codec: head[2].toLowerCase(), channels: channels.toLowerCase() === 'stereo' ? '2.0' : channels.toLowerCase() === 'mono' ? '1.0' : channels, default: /\(default\)/i.test(detail) });
  }
  return tracks;
}

// Lê container e codecs com `ffmpeg -i` (o ffmpeg-static não inclui o ffprobe).
function probeMedia(executable, sourceUrl, inputArgs = []) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(executable, ['-hide_banner', ...inputArgs, '-i', sourceUrl], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 20000);
    child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(0, 30000); });
    const parse = () => {
      const videoLine = [...output.matchAll(/Video:\s*([a-z0-9_]+)[^\n]*/gi)].find((entry) => !['mjpeg', 'png', 'bmp', 'gif'].includes(entry[1].toLowerCase()));
      return {
        container: output.match(/Input #0,\s*(.+?),\s*from\s/i)?.[1]?.toLowerCase() || '',
        video: videoLine?.[1]?.toLowerCase() || '',
        tenBit: Boolean(videoLine && /10le|p10|10be/i.test(videoLine[0])),
        audio: output.match(/Audio:\s*([a-z0-9_]+)/i)?.[1]?.toLowerCase() || '',
        audioTracks: parseAudioTracks(output),
        duration: (() => { const found = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/); return found ? Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3]) : 0; })(),
      };
    };
    child.once('error', () => { clearTimeout(timer); resolve({ container: '', video: '', tenBit: false, audio: '', audioTracks: [], duration: 0 }); });
    child.once('close', () => { clearTimeout(timer); resolve(parse()); });
  });
}

// O Chromium reproduz estes formatos diretamente (e com seek); o resto passa pelo FFmpeg.
function canPlayDirectly(info) {
  return /matroska|webm|mov|mp4/.test(info.container) && ['h264', 'vp9', 'av1', 'vp8'].includes(info.video) && !info.tenBit && (!info.audio || ['aac', 'mp3', 'opus', 'vorbis', 'flac'].includes(info.audio));
}

async function prepareAudioStream(value) {
  const live = Boolean(value?.live);
  const startAt = Math.max(0, Number(value?.startAt) || 0);
  const quality = ['1080', '720'].includes(String(value?.quality)) ? String(value.quality) : '';
  const requestedAudio = Number.isInteger(value?.audioIndex) && value.audioIndex >= 0 && value.audioIndex < 64 ? value.audioIndex : -1;
  const sourceUrl = live ? validateLiveStreamUrl(value?.url) : validateRealDebridStreamUrl(value?.url);
  const liveMeta = live ? liveStreamMeta.get(sourceUrl) || {} : {};
  const inputArgs = [
    ...(liveMeta.userAgent ? ['-user_agent', liveMeta.userAgent] : []),
    ...(liveMeta.referrer ? ['-referer', liveMeta.referrer] : []),
    ...(liveMeta.origin ? ['-headers', `Origin: ${liveMeta.origin}\r\n`] : []),
    ...(live ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4'] : ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_on_http_error', '429,5xx', '-reconnect_delay_max', '15', '-rw_timeout', '60000000']),
  ];
  const executable = await findFfmpegExecutable();
  let probed = null;
  if (!live && !value?.transcodeVideo && !value?.forcePipe) {
    probed = await probeMedia(executable, sourceUrl, inputArgs);
    const defaultAudio = Math.max(0, probed.audioTracks.findIndex((track) => track.default));
    // Com várias faixas e uma escolha diferente da predefinida, a reprodução direta não serve: o Chromium só toca a faixa por defeito.
    if (canPlayDirectly(probed) && (requestedAudio < 0 || requestedAudio === defaultAudio)) return { id: '', url: sourceUrl, direct: true, videoCodec: probed.video, audioCodec: probed.audio, audioTracks: probed.audioTracks, audioIndex: defaultAudio, ...(probed.duration ? { totalDuration: probed.duration } : {}) };
  }
  const id = randomUUID();
  const token = randomUUID();
  const stream = { id, token, sourceUrl, executable, server: null, child: null, started: false, quality, transcodeVideo: Boolean(value?.transcodeVideo) || Boolean(quality) || Boolean(probed && (probed.tenBit || (probed.video && !['h264', 'vp9', 'av1', 'vp8', 'hevc'].includes(probed.video)))), videoCodec: '', error: '', audioIndex: requestedAudio >= 0 ? requestedAudio : Math.max(0, (probed?.audioTracks || []).findIndex((track) => track.default)) };
  stream.server = http.createServer((request, response) => {
    if (request.url !== `/${token}`) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== 'GET' || stream.started) {
      response.writeHead(409).end();
      return;
    }
    stream.started = true;
    const codecReady = stream.transcodeVideo ? Promise.resolve('') : probed ? Promise.resolve(probed.video) : probeMedia(executable, sourceUrl, inputArgs).then((info) => info.video);
    codecReady.then((codec) => { stream.videoCodec = codec; }).catch(() => {}).then(() => {
      if (!response.destroyed) startFfmpeg(request, response);
    });
  });

  function startFfmpeg(_request, response) {
    // HEVC em MP4 só é reconhecido pelo Chromium com a tag hvc1 (o FFmpeg usa hev1 por defeito).
    const videoArgs = stream.transcodeVideo
      ? ['-c:v', 'libx264', '-preset', stream.quality === '720' ? 'superfast' : 'veryfast', ...(stream.quality === '720' ? ['-maxrate', '3M', '-bufsize', '6M', '-crf', '26'] : stream.quality === '1080' ? ['-maxrate', '8M', '-bufsize', '16M', '-crf', '23'] : ['-crf', '23']), '-pix_fmt', 'yuv420p', '-vf', `scale=-2:'min(${stream.quality === '720' ? 720 : 1080},ih)'`]
      : ['-c:v', 'copy', ...(stream.videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : [])];
    const args = [
      '-hide_banner', '-loglevel', 'error', ...inputArgs, ...(startAt ? ['-ss', String(startAt)] : []), '-i', sourceUrl,
      '-map', '0:v:0?', '-map', `0:a:${stream.audioIndex}?`,
      ...videoArgs, '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1',
    ];
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    stream.child = child;
    let responseStarted = false;
    let errorOutput = '';
    const safeErrorOutput = () => errorOutput.replaceAll(sourceUrl, '[link Real-Debrid]').trim();
    child.stderr.on('data', (chunk) => { errorOutput = `${errorOutput}${chunk}`.slice(-4000); });
    child.once('error', (error) => {
      if (response.destroyed) return;
      if (!responseStarted) response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(`FFmpeg could not start: ${error.message}`);
      else response.destroy(error);
      stream.child = null;
    });
    child.stdout.on('data', (chunk) => {
      if (!responseStarted) {
        responseStarted = true;
        response.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'none' });
        response.flushHeaders();
      }
      if (!response.write(chunk)) {
        child.stdout.pause();
        response.once('drain', () => child.stdout?.resume());
      }
    });
    child.stdout.once('end', () => { if (responseStarted && !response.destroyed) response.end(); });
    child.once('close', (code) => {
      if (code !== 0 && safeErrorOutput()) { stream.error = safeErrorOutput().slice(-600); console.error('[StreamNexus audio]', stream.error); }
      if (!response.destroyed && !response.writableEnded) {
        if (!responseStarted) response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(safeErrorOutput() || 'FFmpeg could not read this stream.');
        else response.end();
      }
      stream.child = null;
    });
    response.once('close', () => {
      if (stream.child && !stream.child.killed) stream.child.kill();
    });
  }
  await new Promise((resolve, reject) => {
    stream.server.once('error', reject);
    stream.server.listen(0, '127.0.0.1', resolve);
  });
  audioStreams.set(id, stream);
  const { port } = stream.server.address();
  return { id, url: `http://127.0.0.1:${port}/${token}`, transcoded: stream.transcodeVideo, audioIndex: stream.audioIndex, ...(probed?.audioTracks?.length ? { audioTracks: probed.audioTracks } : {}), ...(probed?.duration ? { totalDuration: probed.duration } : {}) };
}

// ---- Reprodução HLS direta: proxy local que acrescenta os cabeçalhos exigidos e o CORS ----
const LIVE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.local') || host === '::1' || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host);
}

async function prepareLiveHls(value) {
  const sourceUrl = validateLiveStreamUrl(value?.url);
  const meta = liveStreamMeta.get(sourceUrl) || {};
  const id = randomUUID();
  const urls = [sourceUrl];
  // Alguns servidores mudam um parâmetro de sessão em cada pedido; a chave estável evita que o hls.js veja segmentos "diferentes".
  const stableKey = (value) => {
    try { const url = new URL(value); ['nimblesessionid', 'sessionid', 'session_id'].forEach((name) => url.searchParams.delete(name)); return url.toString(); } catch { return value; }
  };
  const indexByUrl = new Map([[stableKey(sourceUrl), 0]]);
  const stream = { id, server: null, child: null, sourceUrl, videoCodec: '', transcodeVideo: false, error: '' };
  let origin = meta.origin || '';
  if (!origin && meta.referrer) { try { origin = new URL(meta.referrer).origin; } catch { origin = ''; } }
  const upstreamHeaders = { 'User-Agent': meta.userAgent || LIVE_UA, Accept: '*/*', ...(meta.referrer ? { Referer: meta.referrer } : {}), ...(origin ? { Origin: origin } : {}) };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Cache-Control': 'no-store' };
  let port = 0;

  const register = (uri, base) => {
    let absolute;
    try { absolute = new URL(uri, base); } catch { return uri; }
    if (!['http:', 'https:'].includes(absolute.protocol) || isPrivateHost(absolute.hostname)) return uri;
    const key = stableKey(absolute.toString());
    let index = indexByUrl.get(key);
    if (index === undefined) { index = urls.length; urls.push(absolute.toString()); indexByUrl.set(key, index); }
    else urls[index] = absolute.toString();
    return `http://127.0.0.1:${port}/p/${index}`;
  };
  const rewritePlaylist = (text, base) => text.split(/\r?\n/).map((line) => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${register(uri, base)}"`);
    return register(line.trim(), base);
  }).join('\n');

  stream.server = http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') { response.writeHead(204, cors).end(); return; }
    const match = /^\/p\/(\d+)/.exec(request.url || '');
    const target = match ? urls[Number(match[1])] : '';
    if (!target) { response.writeHead(404, cors).end(); return; }
    const controller = new AbortController();
    response.once('close', () => controller.abort());
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const upstream = await fetch(target, { headers: upstreamHeaders, signal: controller.signal, redirect: 'follow' });
      clearTimeout(timer);
      const type = upstream.headers.get('content-type') || '';
      if (!upstream.ok) { response.writeHead(upstream.status, cors).end(); return; }
      if (/mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(upstream.url)) {
        const text = await upstream.text();
        const body = text.trimStart().startsWith('#EXTM3U') ? rewritePlaylist(text, upstream.url) : text;
        response.writeHead(200, { ...cors, 'Content-Type': 'application/vnd.apple.mpegurl' }).end(body);
        return;
      }
      response.writeHead(200, { ...cors, 'Content-Type': type || 'application/octet-stream' });
      Readable.fromWeb(upstream.body).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      clearTimeout(timer);
      if (!response.headersSent) response.writeHead(502, cors).end(String(error.message || 'Falha ao contactar a emissão.'));
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    stream.server.once('error', reject);
    stream.server.listen(0, '127.0.0.1', resolve);
  });
  port = stream.server.address().port;
  audioStreams.set(id, stream);
  return { id, url: `http://127.0.0.1:${port}/p/0` };
}

async function stopAudioStream(id) {
  const stream = audioStreams.get(String(id || ''));
  if (!stream) return false;
  audioStreams.delete(stream.id);
  if (stream.child && !stream.child.killed) stream.child.kill();
  if (stream.server?.listening) {
    // sem isto, o fecho espera que o leitor largue a ligação (vários segundos) e atrasa a reprodução seguinte
    stream.server.closeAllConnections?.();
    await new Promise((resolve) => stream.server.close(resolve));
  }
  return true;
}

function getAudioStreamInfo(id) {
  const stream = audioStreams.get(String(id || ''));
  return stream ? { videoCodec: stream.videoCodec, transcodeVideo: stream.transcodeVideo, error: stream.error } : null;
}

async function stopAllAudioStreams() {
  await Promise.all([...audioStreams.keys()].map((id) => stopAudioStream(id)));
}

function openSubtitlesHeaders(apiKey, token) {
  return { 'Api-Key': apiKey, 'User-Agent': 'StreamNexus v0.1.0', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function openSubtitlesLogin(settings) {
  if (!settings.openSubtitlesApiKey || !settings.openSubtitlesUsername || !settings.openSubtitlesPassword) {
    throw new Error('Preenche a API key, o utilizador e a palavra-passe do OpenSubtitles.');
  }
  const fingerprint = `${settings.openSubtitlesUsername}:${settings.openSubtitlesApiKey}`;
  if (openSubtitlesSession?.fingerprint === fingerprint && openSubtitlesSession.expiresAt > Date.now()) return openSubtitlesSession.token;
  if (openSubtitlesLoginPromise) return openSubtitlesLoginPromise;
  openSubtitlesLoginPromise = (async () => {
    const response = await fetch(`${OPENSUBTITLES_API}/login`, {
      method: 'POST', headers: { ...openSubtitlesHeaders(settings.openSubtitlesApiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: settings.openSubtitlesUsername, password: settings.openSubtitlesPassword }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.token) throw new Error(data?.message || `OpenSubtitles respondeu com erro ${response.status}.`);
    openSubtitlesSession = { token: data.token, fingerprint, expiresAt: Date.now() + 15 * 60 * 60 * 1000 };
    return data.token;
  })();
  try { return await openSubtitlesLoginPromise; } finally { openSubtitlesLoginPromise = null; }
}

async function testTmdb(value = {}) {
  const apiKey = String(value.tmdbApiKey || '').trim();
  if (!apiKey) throw new Error('Indica a API key do TMDB.');
  await tmdbRequest('/configuration', apiKey);
  return { appName: 'TMDB' };
}

async function testOpenSubtitles(value = {}) {
  const settings = { ...(await readIntegrations()), ...value };
  await openSubtitlesLogin(settings);
  return { appName: 'OpenSubtitles' };
}

async function searchOpenSubtitles(value = {}) {
  const settings = await readIntegrations();
  if (!settings.openSubtitlesApiKey) throw new Error('Adiciona a API key do OpenSubtitles em Integrações.');
  const params = new URLSearchParams({ languages: 'pt-BR,pt-PT', order_by: 'download_count', order_direction: 'desc' });
  if (value.tmdbId) {
    if (value.tmdbType === 'tv') {
      params.set('parent_tmdb_id', String(value.tmdbId));
      params.set('type', 'episode');
      const episode = String(value.query || '').match(/[Ss](\d{1,2})[ ._-]?[Ee](\d{1,2})/);
      if (episode) { params.set('season_number', String(Number(episode[1]))); params.set('episode_number', String(Number(episode[2]))); }
    } else {
      params.set('tmdb_id', String(value.tmdbId));
      params.set('type', 'movie');
    }
  }
  if (value.query) params.set('query', String(value.query).slice(0, 160));
  const response = await fetch(`${OPENSUBTITLES_API}/subtitles?${params}`, { headers: openSubtitlesHeaders(settings.openSubtitlesApiKey) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `OpenSubtitles respondeu com erro ${response.status}.`);
  return (data?.data || []).flatMap((entry) => {
    const attr = entry.attributes || {};
    return (attr.files || []).map((file) => ({
      fileId: file.file_id, fileName: file.file_name || attr.release || 'Legenda',
      language: attr.language || '', label: attr.language === 'pt-PT' ? 'Português de Portugal' : attr.language === 'pt-BR' ? 'Português do Brasil' : attr.language,
      release: attr.release || '', downloads: Number(attr.download_count || 0), hearingImpaired: Boolean(attr.hearing_impaired),
    }));
  }).filter((item) => item.fileId).sort((a, b) => (a.language === 'pt-PT' ? -1 : 0) - (b.language === 'pt-PT' ? -1 : 0) || b.downloads - a.downloads).slice(0, 30);
}

async function downloadOpenSubtitle(value = {}) {
  const settings = await readIntegrations();
  const token = await openSubtitlesLogin(settings);
  const response = await fetch(`${OPENSUBTITLES_API}/download`, {
    method: 'POST', headers: { ...openSubtitlesHeaders(settings.openSubtitlesApiKey, token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: Number(value.fileId), sub_format: 'srt' }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.link) throw new Error(data?.message || `Não foi possível obter a legenda (HTTP ${response.status}).`);
  const downloadUrl = new URL(data.link);
  if (downloadUrl.protocol !== 'https:' || (downloadUrl.hostname !== 'opensubtitles.com' && !downloadUrl.hostname.endsWith('.opensubtitles.com'))) throw new Error('O OpenSubtitles devolveu um endereço de legenda inválido.');
  const subtitleResponse = await fetch(downloadUrl);
  if (!subtitleResponse.ok) throw new Error(`A transferência da legenda falhou (HTTP ${subtitleResponse.status}).`);
  return { text: await subtitleResponse.text(), fileName: value.fileName || 'subtitle.srt' };
}

function pURL(base, pathname) {
  const root = new URL(`${base.replace(/\/+$/, '')}/`);
  return new URL(pathname.replace(/^\/+/, ''), root);
}

// O Prowlarr pode devolver o magnet em campos diferentes conforme a versão/indexador:
//  - magnetUrl/downloadUrl como `magnet:?…`
//  - magnetUrl como endereço HTTP do próprio Prowlarr (proxy), downloadUrl vazio
//  - o magnet verdadeiro no `guid` e o hash em `infoHash`
const magnetOnly = (value) => { const text = String(value || '').trim(); return /^magnet:\?/i.test(text) ? text : ''; };
const httpOnly = (value) => { const text = String(value || '').trim(); return /^https?:\/\//i.test(text) ? text : ''; };
function releaseMagnet(release) {
  const direct = magnetOnly(release.magnetUrl) || magnetOnly(release.downloadUrl) || magnetOnly(release.guid);
  if (direct) return direct;
  const hash = String(release.infoHash || '').trim();
  if (/^[A-Fa-f0-9]{40}$/.test(hash) || /^[A-Za-z2-7]{32}$/.test(hash)) return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(String(release.title || '').slice(0, 200))}`;
  return '';
}
const releaseLink = (release) => httpOnly(release.downloadUrl) || httpOnly(release.magnetUrl);

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
    return ['torrent', '1'].includes(protocol) || (!protocol && Boolean(releaseMagnet(release)));
  }).map((release) => {
    const id = randomUUID();
    if (releaseCache.size > 5000) releaseCache.delete(releaseCache.keys().next().value);
    releaseCache.set(id, { release, baseUrl: settings.prowlarrUrl, apiKey: settings.prowlarrApiKey });
    return {
      id,
      title: release.title || 'Lançamento sem título',
      indexer: release.indexer || 'Indexer',
      size: Number(release.size) || 0,
      seeders: Number.isFinite(Number(release.seeders)) ? Number(release.seeders) : null,
      leechers: Number.isFinite(Number(release.leechers)) ? Number(release.leechers) : null,
      protocol: release.protocol || 'torrent',
      hasMagnet: Boolean(releaseMagnet(release)),
      canGrab: Boolean(releaseMagnet(release) || releaseLink(release)),
    };
  });
  return rows;
}

// ---- Torrentio (addon do Stremio): lançamentos por IMDb, com infoHash e ficheiro exato ----
// Só pedimos a lista pública; a chave do Real-Debrid nunca sai desta app.
const TORRENTIO_BASE = 'https://torrentio.strem.fun';
async function fetchTorrentioReleases({ tmdbId, tmdbType, season = 1, episode = 1 } = {}) {
  if (!/^\d+$/.test(String(tmdbId || '')) || !['movie', 'tv'].includes(tmdbType)) throw new Error('Título inválido para o Torrentio.');
  const { tmdbApiKey } = await readIntegrations();
  if (!tmdbApiKey) throw new Error('Adiciona a API key do TMDB em Integrações.');
  const external = await memo(`imdb|${tmdbType}|${tmdbId}`, () => tmdbRequest(`/${tmdbType}/${tmdbId}/external_ids`, tmdbApiKey), 24 * 60 * 60 * 1000);
  const imdb = String(external?.imdb_id || '');
  if (!/^tt\d{5,10}$/.test(imdb)) throw new Error('Este título não tem IMDb ID.');
  const safeSeason = Math.max(1, Math.min(Number(season) || 1, 99));
  const safeEpisode = Math.max(1, Math.min(Number(episode) || 1, 999));
  const route = tmdbType === 'movie' ? `stream/movie/${imdb}` : `stream/series/${imdb}:${safeSeason}:${safeEpisode}`;
  const data = await memo(`torrentio|${route}`, () => fetchPublicJson(`${TORRENTIO_BASE}/${route}.json`, 25000), 10 * 60 * 1000);
  const sizeUnits = { TB: 1024 ** 4, GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024 };
  const seen = new Set();
  const rows = [];
  for (const stream of data?.streams || []) {
    const hash = String(stream.infoHash || '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(hash)) continue;
    const key = `${hash}:${stream.fileIdx ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lines = String(stream.title || '').split('\n');
    const meta = lines.find((line) => line.includes('👤')) || '';
    const sizeMatch = /💾\s*([\d.]+)\s*(TB|GB|MB|KB)/i.exec(meta);
    const release = {
      title: lines[0] || stream.behaviorHints?.filename || 'Lançamento',
      magnetUrl: `magnet:?xt=urn:btih:${hash}`,
      infoHash: hash,
      protocol: 'torrent',
      indexer: `Torrentio · ${/⚙️\s*(\S+)/.exec(meta)?.[1] || 'torrent'}`,
      size: sizeMatch ? Number(sizeMatch[1]) * sizeUnits[sizeMatch[2].toUpperCase()] : Number(stream.behaviorHints?.videoSize) || 0,
      seeders: Number(/👤\s*(\d+)/.exec(meta)?.[1]) || 0,
    };
    const id = randomUUID();
    if (releaseCache.size > 5000) releaseCache.delete(releaseCache.keys().next().value);
    releaseCache.set(id, { release, baseUrl: '', apiKey: '' });
    rows.push({ id, title: release.title, indexer: release.indexer, size: release.size, seeders: release.seeders, leechers: null, protocol: 'torrent', hasMagnet: true, canGrab: true, infoHash: hash, fileName: String(stream.behaviorHints?.filename || ''), fileIdx: Number.isInteger(stream.fileIdx) ? stream.fileIdx : null, source: 'torrentio' });
    if (rows.length >= 300) break;
  }
  return rows;
}

// ---- Séries: temporadas e episódios (TMDB) ----
async function fetchTmdbTv({ tmdbId, season } = {}) {
  if (!/^\d+$/.test(String(tmdbId || ''))) throw new Error('Série inválida.');
  const { tmdbApiKey } = await readIntegrations();
  if (!tmdbApiKey) throw new Error('Adiciona a API key do TMDB em Integrações.');
  const { baseUrl } = await tmdbImageSettings(tmdbApiKey);
  const show = await memo(`tv|${tmdbId}`, () => tmdbRequest(`/tv/${tmdbId}?language=pt-PT`, tmdbApiKey), 6 * 60 * 60 * 1000);
  const seasons = (show.seasons || []).filter((entry) => entry.season_number >= 0 && entry.episode_count > 0).map((entry) => ({ number: entry.season_number, name: entry.season_number === 0 ? 'Especiais' : `Temporada ${entry.season_number}`, episodeCount: entry.episode_count, airDate: entry.air_date || '' }));
  const first = seasons.find((entry) => entry.number > 0) || seasons[0];
  const wanted = Number.isInteger(Number(season)) && seasons.some((entry) => entry.number === Number(season)) ? Number(season) : first?.number ?? 1;
  const detail = await memo(`tvs|${tmdbId}|${wanted}`, () => tmdbRequest(`/tv/${tmdbId}/season/${wanted}?language=pt-PT`, tmdbApiKey), 6 * 60 * 60 * 1000);
  const episodes = (detail.episodes || []).map((entry) => ({ number: entry.episode_number, name: entry.name || `Episódio ${entry.episode_number}`, overview: entry.overview || '', runtime: Number(entry.runtime) || 0, airDate: entry.air_date || '', still: tmdbImage(entry.still_path, 'w300', baseUrl) }));
  return { title: show.name || '', seasons, season: wanted, episodes };
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
  const magnet = releaseMagnet(release);
  if (magnet) return magnet;
  const link = releaseLink(release);
  if (!link) throw new Error('Este resultado não disponibiliza um link magnet nem um ficheiro torrent.');
  let current;
  try { current = new URL(link); } catch { throw new Error('O link de transferência deste resultado não é válido.'); }
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
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' ${DEV_URL} ws://127.0.0.1:5173 http://127.0.0.1:*`,
    "media-src 'self' blob: https: http://127.0.0.1:*",
    "frame-src https://www.youtube-nocookie.com https://*.redtube.com https://*.pornhub.com https://*.eporner.com https://open.spotify.com https://embed.music.apple.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  // Os CDNs de miniaturas recusam pedidos sem Referer do próprio site (hotlink protection)
  const thumbReferers = [['rdtcdn.com', 'https://www.redtube.com/'], ['phncdn.com', 'https://www.pornhub.com/'], ['eporner.com', 'https://www.eporner.com/']];
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.rdtcdn.com/*', '*://*.phncdn.com/*', '*://*.eporner.com/*'] }, (details, callback) => {
    let host = '';
    try { host = new URL(details.url).hostname.toLowerCase(); } catch { host = ''; }
    const entry = details.resourceType === 'image' ? thumbReferers.find(([domain]) => host === domain || host.endsWith(`.${domain}`)) : null;
    callback({ requestHeaders: entry ? { ...details.requestHeaders, Referer: entry[1] } : details.requestHeaders });
  });
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
  ipcMain.handle('torrentio:releases', resultHandler(fetchTorrentioReleases));
  ipcMain.handle('tmdb:tv', resultHandler(fetchTmdbTv));
  ipcMain.handle('prowlarr:add-release', resultHandler(addReleaseToRealDebrid));
  ipcMain.handle('tmdb:catalog', resultHandler(fetchTmdbCatalog));
  ipcMain.handle('tmdb:trailer', resultHandler(fetchTmdbTrailer));
  ipcMain.handle('discovery:fetch', resultHandler(fetchDiscovery));
  ipcMain.handle('feed:shelf', resultHandler(feedShelf));
  ipcMain.handle('feed:search', resultHandler(feedSearch));
  ipcMain.handle('feed:shelves', resultHandler(feedShelves));
  ipcMain.handle('feed:category', resultHandler(feedCategory));
  ipcMain.handle('adult:videos', resultHandler(fetchAdultVideos));
  ipcMain.handle('tv:countries', resultHandler(fetchLiveCountries));
  ipcMain.handle('tv:channels', resultHandler(fetchLiveChannels));
  ipcMain.handle('tv:health', resultHandler(fetchLiveHealth));
  ipcMain.handle('tv:logo', resultHandler(fetchChannelLogo));
  ipcMain.handle('music:free', resultHandler(fetchFreeMusic));
  ipcMain.handle('books:sources', resultHandler(fetchBookSources));
  ipcMain.handle('app:open-link', resultHandler(openAllowedLink));
  ipcMain.handle('spotify:test', resultHandler(testSpotify));
  ipcMain.handle('spotify-player:token', (event) => (spotifyPlayerWindow && event.sender === spotifyPlayerWindow.webContents ? spotifyUserToken() : Promise.reject(new Error('Pedido recusado.'))));
  ipcMain.on('spotify-player:event', (event, payload) => { if (spotifyPlayerWindow && event.sender === spotifyPlayerWindow.webContents) handleSpotifyPlayerEvent(payload); });
  ipcMain.handle('spotify:connect-status', resultHandler(spotifyConnectStatus));
  ipcMain.handle('spotify:connect-login', resultHandler(spotifyConnectLogin));
  ipcMain.handle('spotify:connect-logout', resultHandler(spotifyConnectLogout));
  ipcMain.handle('spotify:connect-state', resultHandler(spotifyConnectState));
  ipcMain.handle('spotify:connect-command', resultHandler(spotifyConnectCommand));
  ipcMain.handle('spotify:album-tracks', resultHandler(spotifyAlbumTracks));
  ipcMain.handle('player:external', resultHandler(openExternalPlayer));
  ipcMain.handle('player:prepare-audio', resultHandler(prepareAudioStream));
  ipcMain.handle('player:prepare-hls', resultHandler(prepareLiveHls));
  ipcMain.handle('player:stream-info', (_event, id) => getAudioStreamInfo(id));
  ipcMain.handle('player:stop-audio', (_event, id) => stopAudioStream(id));
  ipcMain.handle('window:fullscreen', (_event, enabled) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.setFullScreen(Boolean(enabled));
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('tmdb:test', resultHandler(testTmdb));
  ipcMain.handle('opensubtitles:test', resultHandler(testOpenSubtitles));
  ipcMain.handle('opensubtitles:search', resultHandler(searchOpenSubtitles));
  ipcMain.handle('opensubtitles:download', resultHandler(downloadOpenSubtitle));
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
  mainWindow.on('closed', () => { mainWindow = null; closeSpotifyPlayer(); });
}

app.setAppUserModelId('com.streamnexus.desktop');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.whenReady().then(() => {
  configureContentSecurityPolicy();
  registerIpc();
  createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { stopAllAudioStreams().catch(() => {}); closeSpotifyPlayer(); });
