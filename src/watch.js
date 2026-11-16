// Progresso de visionamento por perfil: filmes e episódios (posição, duração, visto).
import { pkey } from './profiles.js';

const WATCH_KEY = 'streamnexus.watch';
export const FINISHED_RATIO = 0.92;

export function loadWatch() {
  try { return JSON.parse(localStorage.getItem(pkey(WATCH_KEY)) || '{}') || {}; } catch { return {}; }
}
export function saveWatch(map) {
  try { localStorage.setItem(pkey(WATCH_KEY), JSON.stringify(map)); } catch { /* o histórico fica só nesta sessão */ }
}

export const epKey = (season, episode) => `S${season}E${episode}`;
export const epLabel = (season, episode) => `T${season}·E${episode}`;

// Dados mínimos para voltar a abrir/mostrar o título sem catálogo
export function snapshotTitle(title) {
  return {
    id: title.id, type: title.type, title: title.title, original: title.original || title.title, year: title.year || '',
    poster: title.poster || '', backdrop: title.backdrop || title.poster || '', tmdbId: title.tmdbId, tmdbType: title.tmdbType,
    genre: title.genre || '', genres: title.genres || [], rating: title.rating || '', runtime: title.runtime || '',
    description: String(title.description || '').slice(0, 400), accent: title.accent || '#b30d1b',
  };
}

// Atualiza (de forma pura) a posição de um filme ou episódio
export function withProgress(map, title, episode, position, duration, forceWatched = false) {
  if (!title?.id) return map;
  const now = Date.now();
  const entry = { ...(map[title.id] || {}), ...snapshotTitle(title), updatedAt: now };
  const finished = forceWatched || (duration > 60 && position / duration >= FINISHED_RATIO);
  const record = { position: finished ? 0 : Math.floor(position), duration: Math.floor(duration) || 0, watched: finished || Boolean(episode ? entry.episodes?.[epKey(episode.season, episode.episode)]?.watched : entry.watched), updatedAt: now };
  if (episode) {
    entry.episodes = { ...(entry.episodes || {}), [epKey(episode.season, episode.episode)]: { ...(entry.episodes?.[epKey(episode.season, episode.episode)] || {}), ...record, ...(finished ? { watched: true } : {}), name: episode.name || '' } };
    entry.last = { season: episode.season, episode: episode.episode };
  } else {
    Object.assign(entry, record, finished ? { watched: true } : {});
  }
  return { ...map, [title.id]: entry };
}

export function markWatched(map, title, episode, watched) {
  if (!title?.id) return map;
  const entry = { ...(map[title.id] || {}), ...snapshotTitle(title), updatedAt: Date.now() };
  if (episode) {
    const key = epKey(episode.season, episode.episode);
    entry.episodes = { ...(entry.episodes || {}), [key]: { ...(entry.episodes?.[key] || {}), watched, position: 0, name: episode.name || entry.episodes?.[key]?.name || '', updatedAt: Date.now() } };
    if (watched) entry.last = { season: episode.season, episode: episode.episode };
  } else {
    Object.assign(entry, { watched, position: 0 });
  }
  return { ...map, [title.id]: entry };
}

export function removeTitle(map, id) {
  const { [id]: _removed, ...rest } = map;
  return rest;
}

// Resumo para cartões e listas
export function watchInfo(map, item) {
  const entry = map?.[item?.id];
  if (!entry) return null;
  if (item.type === 'Série' || entry.type === 'Série') {
    const episodes = Object.entries(entry.episodes || {});
    const watchedCount = episodes.filter(([, value]) => value.watched).length;
    const last = entry.last ? entry.episodes?.[epKey(entry.last.season, entry.last.episode)] : null;
    const percent = last?.duration ? Math.min(1, (last.position || 0) / last.duration) : 0;
    return { kind: 'series', started: episodes.length > 0, watchedCount, last: entry.last || null, percent, inProgress: Boolean(last && !last.watched && last.position > 30) };
  }
  const percent = entry.duration ? Math.min(1, (entry.position || 0) / entry.duration) : 0;
  return { kind: 'movie', watched: Boolean(entry.watched), percent, inProgress: !entry.watched && (entry.position || 0) > 60 };
}

// Onde retomar uma série: o último episódio, a meio ou, se terminou, o seguinte (feito pelo chamador)
export function resumePointFor(entry) {
  if (!entry?.last) return null;
  const record = entry.episodes?.[epKey(entry.last.season, entry.last.episode)];
  return { ...entry.last, position: record?.watched ? 0 : record?.position || 0, watched: Boolean(record?.watched) };
}
