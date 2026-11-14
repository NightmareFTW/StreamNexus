const { app, BrowserWindow, ipcMain, safeStorage, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const dns = require('node:dns/promises');
const net = require('node:net');
const http = require('node:http');

let staticFfmpegPath = '';
try { staticFfmpegPath = require('ffmpeg-static') || ''; } catch { /* o binário é opcional na pré-visualização */ }

const RD_API = 'https://api.real-debrid.com/rest/1.0';
const RD_OAUTH = 'https://api.real-debrid.com/oauth/v2';
const TMDB_API = 'https://api.themoviedb.org/3';
const OPENSUBTITLES_API = 'https://api.opensubtitles.com/api/v1';
const SESSION_FILE = 'real-debrid-session.bin';
const INTEGRATIONS_FILE = 'integrations.bin';
const DEV_URL = 'http://127.0.0.1:5173';
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

async function tmdbImageSettings(apiKey) {
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

async function fetchPublicJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'StreamNexus/0.1' } });
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
    return { eyebrow: shelf.eyebrow, title: shelf.title, items: (data.results || []).map((item) => normalizeTmdbItem({ ...item, media_type: 'tv', title: undefined }, baseUrl, sizes)) };
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

async function fetchMusicDiscovery() {
  const { spotifyClientId, spotifyClientSecret } = await readIntegrations();
  if (spotifyClientId && spotifyClientSecret) {
    try {
      const rows = await fetchSpotifyMusic(spotifyClientId, spotifyClientSecret);
      if (rows.some((row) => row.items.length)) return rows;
    } catch { /* usa o iTunes como alternativa */ }
  }
  return Promise.all(MUSIC_SHELVES.map(async (shelf) => {
    const params = new URLSearchParams({ term: shelf.term, media: 'music', entity: 'album', country: 'PT', limit: '30' });
    const data = await fetchPublicJson(`https://itunes.apple.com/search?${params}`);
    const items = (data.results || []).filter((album) => album.collectionId && album.collectionName && album.artworkUrl100).map(normalizeAlbum);
    return { eyebrow: shelf.eyebrow, title: shelf.title, items };
  }));
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
    searchQuery: `${work.title} ${authors[0] || ''}`.trim(), accent: MEDIA_ACCENTS[index % MEDIA_ACCENTS.length],
  };
}

async function fetchBooksDiscovery() {
  return Promise.all(BOOK_SHELVES.map(async (shelf) => {
    const data = await fetchPublicJson(shelf.url);
    const items = (data.works || []).filter((work) => work.title && (work.cover_id || work.cover_i)).map((work, index) => normalizeBook(work, shelf, index));
    return { eyebrow: shelf.eyebrow, title: shelf.title, items };
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
  const rows = await Promise.all(ADULT_SHELVES.map(async (shelf) => {
    const ids = new Set();
    for (const keyword of shelf.keywords) {
      try {
        const found = await tmdbRequest(`/search/keyword?query=${encodeURIComponent(keyword)}`, tmdbApiKey);
        (found.results || []).slice(0, 2).forEach((entry) => ids.add(entry.id));
      } catch { /* ignora palavras-chave sem resultados */ }
    }
    if (!ids.size) return { eyebrow: shelf.eyebrow, title: shelf.title, items: [] };
    const data = await tmdbRequest(`/discover/movie?language=pt-PT&include_adult=true&sort_by=popularity.desc&with_keywords=${[...ids].join('|')}`, tmdbApiKey);
    const items = (data.results || []).filter((item) => item.poster_path).map((item) => ({ ...normalizeTmdbItem({ ...item, media_type: 'movie' }, baseUrl, sizes), adult: true }));
    return { eyebrow: shelf.eyebrow, title: shelf.title, items };
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

async function loadLiveTv() {
  if (liveTvCache && Date.now() - liveTvCache.at < LIVE_TTL) return liveTvCache;
  if (!liveTvPromise) {
    liveTvPromise = (async () => {
      const base = 'https://iptv-org.github.io/api';
      const [channels, streams, logos, countries] = await Promise.all(['channels', 'streams', 'logos', 'countries'].map((name) => fetchPublicJson(`${base}/${name}.json`)));
      const logoByChannel = new Map();
      for (const logo of logos) if (logo.channel && logo.url && logo.in_use !== false && !logoByChannel.has(logo.channel)) logoByChannel.set(logo.channel, logo.url);
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
        const logo = logoByChannel.get(channel.id) || '';
        const item = {
          id: `live-${channel.id}`, type: 'Canal', title: channel.name, original: channel.name, creator: info.name, year: '', rating: '',
          genre: labels[0], genres: [...new Set(labels)], runtime: 'Ao vivo', poster: logo, backdrop: logo, description: `Canal de televisão · ${info.name}`, accent: '#b30d1b',
          streams: usable.map((stream) => ({ url: stream.url, quality: stream.quality || '' })),
        };
        if (!byCountry.has(channel.country)) byCountry.set(channel.country, []);
        byCountry.get(channel.country).push(item);
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

// Lê o codec do vídeo com `ffmpeg -i` (o ffmpeg-static não inclui o ffprobe).
function probeVideoCodec(executable, sourceUrl, inputArgs = []) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(executable, ['-hide_banner', ...inputArgs, '-i', sourceUrl], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 20000);
    child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(0, 20000); });
    child.once('error', () => { clearTimeout(timer); resolve(''); });
    child.once('close', () => { clearTimeout(timer); resolve(output.match(/Video:\s*([a-z0-9_]+)/i)?.[1]?.toLowerCase() || ''); });
  });
}

async function prepareAudioStream(value) {
  const live = Boolean(value?.live);
  const sourceUrl = live ? validateLiveStreamUrl(value?.url) : validateRealDebridStreamUrl(value?.url);
  const liveMeta = live ? liveStreamMeta.get(sourceUrl) || {} : {};
  const inputArgs = [
    ...(liveMeta.userAgent ? ['-user_agent', liveMeta.userAgent] : []),
    ...(liveMeta.referrer ? ['-referer', liveMeta.referrer] : []),
    ...(live ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4'] : []),
  ];
  const executable = await findFfmpegExecutable();
  const id = randomUUID();
  const token = randomUUID();
  const stream = { id, token, sourceUrl, executable, server: null, child: null, started: false, transcodeVideo: Boolean(value?.transcodeVideo), videoCodec: '', error: '' };
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
    const codecReady = stream.transcodeVideo ? Promise.resolve('') : probeVideoCodec(executable, sourceUrl, inputArgs);
    codecReady.then((codec) => { stream.videoCodec = codec; }).catch(() => {}).then(() => {
      if (!response.destroyed) startFfmpeg(request, response);
    });
  });

  function startFfmpeg(_request, response) {
    // HEVC em MP4 só é reconhecido pelo Chromium com a tag hvc1 (o FFmpeg usa hev1 por defeito).
    const videoArgs = stream.transcodeVideo
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', "scale=-2:'min(1080,ih)'"]
      : ['-c:v', 'copy', ...(stream.videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : [])];
    const args = [
      '-hide_banner', '-loglevel', 'error', ...inputArgs, '-i', sourceUrl,
      '-map', '0:v:0?', '-map', '0:a:0?',
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
  return { id, url: `http://127.0.0.1:${port}/${token}` };
}

async function stopAudioStream(id) {
  const stream = audioStreams.get(String(id || ''));
  if (!stream) return false;
  audioStreams.delete(stream.id);
  if (stream.child && !stream.child.killed) stream.child.kill();
  if (stream.server?.listening) await new Promise((resolve) => stream.server.close(resolve));
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
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' ${DEV_URL} ws://127.0.0.1:5173 http://127.0.0.1:*`,
    "media-src 'self' blob: https: http://127.0.0.1:*",
    "frame-src https://www.youtube-nocookie.com",
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
  ipcMain.handle('tmdb:catalog', resultHandler(fetchTmdbCatalog));
  ipcMain.handle('tmdb:trailer', resultHandler(fetchTmdbTrailer));
  ipcMain.handle('discovery:fetch', resultHandler(fetchDiscovery));
  ipcMain.handle('tv:countries', resultHandler(fetchLiveCountries));
  ipcMain.handle('tv:channels', resultHandler(fetchLiveChannels));
  ipcMain.handle('spotify:test', resultHandler(testSpotify));
  ipcMain.handle('player:external', resultHandler(openExternalPlayer));
  ipcMain.handle('player:prepare-audio', resultHandler(prepareAudioStream));
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
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.setAppUserModelId('com.streamnexus.desktop');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(() => {
  configureContentSecurityPolicy();
  registerIpc();
  createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { stopAllAudioStreams().catch(() => {}); });
