import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandFlow, Icon, PosterCard, PreviewContext, ScrollRow, WatchContext } from './ui.jsx';
import { AdultPlayer } from './AdultPlayer.jsx';
import { ProfileAvatar, ProfileGate } from './Profiles.jsx';
import { InviteSettings, WelcomeScreen, welcomeDone } from './Invite.jsx';
import { AudiobooksView, BooksModeSwitch } from './Audiobooks.jsx';
import { EpisodePicker, HistoryPage } from './Watch.jsx';
import { HomePage } from './Home.jsx';
import { UpdateBanner, UpdateSettings } from './Update.jsx';
import { startAutoCheck } from './updateStore.js';
import { kidsAllowed } from './kids.js';
import { loadProfiles, pkey, setActiveProfile } from './profiles.js';
import { epLabel, loadWatch, markWatched, removeTitle, resumePointFor, saveWatch, watchInfo, withProgress } from './watch.js';
import { LiveTvPage, TvModeTabs } from './LiveTv.jsx';
import { FreeMusicPanel, SpotifyConnectBox } from './Music.jsx';
import { MiniPlayer } from './MiniPlayer.jsx';
import { FeedShelves, SearchFeed, setFeedFilter } from './Feed.jsx';
import { BookSourcesPanel, ShelfarrPanel, BooksCollectionView, BooksNav, READING_KEY, READING_STATUS, ReadingDashboard, dayKey, loadReading } from './Books.jsx';
import { ADULT_CATEGORIES, AdultModeTabs, AdultVideosPage } from './AdultVideos.jsx';

const RD_API = 'https://api.real-debrid.com/rest/1.0';
const RD_OAUTH = 'https://api.real-debrid.com/oauth/v2';
const RD_OPEN_SOURCE_CLIENT_ID = 'X245A4XAIBGVM';
const RD_SESSION_KEY = 'streamnexus.rd.session.v1';
const SEARCH_CATEGORIES = {
  movies: { label: 'Filmes', manager: 'Radarr', type: 'movie', category: '2000', icon: 'film' },
  series: { label: 'Séries', manager: 'Sonarr', type: 'tvsearch', category: '5000', icon: 'tv' },
  music: { label: 'Música', manager: 'Lidarr', type: 'music', category: '3000', icon: 'music' },
  books: { label: 'Livros', manager: 'Readarr', type: 'book', category: '7000', icon: 'book' },
  adult: { label: 'Adulto', manager: 'Whisparr', type: 'search', category: '6000', icon: 'adult' },
};
const PAGE_SEARCH_CATEGORY = { tv: 'series' };

function normalizeSearchText(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchesTorrentTitle(torrent, title) {
  const filename = normalizeSearchText(`${torrent.filename || ''} ${torrent.original_filename || ''}`);
  const candidates = [title.title, title.original, ...(title.aliases || [])].map(normalizeSearchText).filter(Boolean);
  return candidates.some((candidate) => {
    if (filename.includes(candidate)) return true;
    const tokens = candidate.split(' ').filter((token) => token.length > 2 && !['the', 'and', 'of', 'parte'].includes(token));
    return tokens.length >= 2 && tokens.every((token) => filename.includes(token));
  });
}

const isVideoTitle = (title) => !['Álbum', 'Livro'].includes(title?.type);
const titleCategory = (title) => (title?.adult ? 'adult' : title?.type === 'Álbum' ? 'music' : title?.type === 'Livro' ? 'books' : title?.type === 'Série' ? 'series' : 'movies');
const DISCOVERY_PAGES = ['tv', 'music', 'books', 'adult'];
const DISCOVERY_LABELS = { tv: 'programas de TV', music: 'álbuns', books: 'livros', adult: 'títulos' };

const VIDEO_FILE_PATTERN = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|mpe?g)$/i;

// O Real-Debrid devolve um link por ficheiro selecionado, pela mesma ordem de `files`.
function getPlayableEntries(details) {
  const links = details?.links || [];
  const selected = (details?.files || []).filter((file) => file.selected === 1);
  const all = links.map((_, linkIndex) => {
    const file = selected.length === links.length ? selected[linkIndex] : null;
    const path = file?.path || '';
    return { linkIndex, name: path ? path.replace(/^\//, '') : `Ficheiro ${linkIndex + 1}`, bytes: Number(file?.bytes) || 0 };
  });
  const videos = all.filter((entry) => VIDEO_FILE_PATTERN.test(entry.name));
  return videos.length ? videos : all;
}

// Filmes: escolhe o maior vídeo. Séries ou desconhecido com vários vídeos: pede ao utilizador.
// Procura o episódio certo entre os ficheiros de um torrent (S01E02, 1x02, "season 1 episode 2")
function episodePatterns(season, episode) {
  const s = Number(season);
  const e = Number(episode);
  return [new RegExp(`s0*${s}[ ._-]*e0*${e}(?!\\d)`, 'i'), new RegExp(`(?<!\\d)${s}x0*${e}(?!\\d)`, 'i'), new RegExp(`season[ ._-]*0*${s}[^\\n]{0,24}?(?:episode|ep)[ ._-]*0*${e}(?!\\d)`, 'i')];
}
const entryMatchesEpisode = (name, season, episode) => episodePatterns(season, episode).some((pattern) => pattern.test(String(name || '')));
// Um torrent já na biblioteca pode servir se for esse episódio ou um pack da temporada/série
function torrentMayHaveEpisode(torrent, season, episode) {
  const name = String(torrent?.filename || '');
  if (entryMatchesEpisode(name, season, episode)) return true;
  if (/s\d{1,2}[ ._-]*e\d{1,3}/i.test(name)) return false;
  return new RegExp(`(?:s0*${Number(season)}(?!\\d)|season[ ._-]*0*${Number(season)}(?!\\d)|complete|temporada|\\bseries\\b)`, 'i').test(name);
}
const formatClock = (seconds) => { const total = Math.max(0, Math.round(Number(seconds) || 0)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const sec = total % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };

function pickPlayableEntry(details, titleHint, episode = null) {
  const entries = getPlayableEntries(details);
  if (episode) {
    const found = entries.filter((entry) => entryMatchesEpisode(entry.name, episode.season, episode.episode)).sort((a, b) => b.bytes - a.bytes)[0];
    if (found) return { entry: found };
  }
  if (entries.length <= 1) return { entry: entries[0] || null };
  if (titleHint?.type === 'Filme') return { entry: [...entries].sort((a, b) => b.bytes - a.bytes)[0] };
  return { choose: [...entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) };
}

// Escolha automática do melhor lançamento: qualidade, fonte, seeders e tamanho razoável.
// O Real-Debrid recusa (infringing_file) lançamentos pelo NOME; estas etiquetas são as mais reportadas (desde 2026).
const RD_FLAGGED = /WEB[ ._-]?DL|WEB[ ._-]?x264|WEB[ ._-]?H264|WEB[ ._-]?Rip|BD[ ._-]?Rip|HD[ ._-]?Rip|DVD[ ._-]?Rip|HDTV[ ._-]x264|HDTV[ ._-]XviD|BluRay[ ._-]x264|\d+p[ ._-]BluRay[ ._-]DTS|\[(rartv|rarbg|eztv)\]|\bYTS\b/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BAD_RELEASE = /\b(cam|hdcam|camrip|ts|hdts|telesync|tc|telecine|hdtc|scr|screener|dvdscr|workprint|r5|pre[ -]?dvd|hq[ -]?pre)\b/i;
const normalizeName = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function scoreRelease(release, title, episode = null) {
  const raw = `${release.title || ''} ${release.fileName || ''}`.trim();
  const name = ` ${normalizeName(raw)} `;
  let score = 0;
  if (BAD_RELEASE.test(raw.replace(/[._]/g, ' '))) score -= 1000;
  if (/2160p|\b4k\b|\buhd\b/.test(name)) score += 6;
  else if (/1080p/.test(name)) score += 40;
  else if (/720p/.test(name)) score += 26;
  else if (/480p|dvdrip|xvid/.test(name)) score += 4;
  if (/bluray|blu ray|remux/.test(name)) score += 12; else if (/web dl|webdl|webrip|brrip/.test(name)) score += 4;
  if (RD_FLAGGED.test(raw)) score -= 60;
  if (title.type === 'Série') {
    if (episode) {
      // Episódio pedido: o próprio episódio ganha; episódios soltos de outro número perdem; packs da temporada servem
      const season = Number(episode.season);
      const number = Number(episode.episode);
      const anyEpisode = /\bs\d{1,2}\s?e\d{1,3}\b/.test(name);
      if (new RegExp(`\\bs0*${season}\\s?e0*${number}\\b`).test(name)) score += 30;
      else if (anyEpisode) score -= 60;
      else if (new RegExp(`\\b(s0*${season}|season ${season})\\b`).test(name)) score += 12;
      else if (/complete|temporada|\bseries\b/.test(name)) score += 6;
    } else {
      // Séries: preferir packs de temporada/série completa; entre episódios soltos, o primeiro
      if (/\bs\d{1,2}\b(?!e\d)|complete|temporada|season/.test(name) && !/\bs\d{1,2}e\d{1,3}\b/.test(name)) score += 15;
      else if (/\bs0?1e0?1\b/.test(name)) score += 8;
      else if (/\bs\d{1,2}e\d{1,3}\b/.test(name)) score -= 6;
    }
  }
  if (/x264|h 264|\bavc\b/.test(name)) score += 8; else if (/x265|h 265|hevc/.test(name)) score += 3;
  if (/10bit|\bhdr\b|dolby vision|\bdv\b/.test(name)) score -= 6;
  if (/multi|dual|\bpt\b|portugu|legendado/.test(name)) score += 4;
  score += Math.min(40, Math.log10((Number(release.seeders) || 0) + 1) * 12);
  const gb = (Number(release.size) || 0) / 1024 ** 3;
  if (gb > 6) score -= Math.min(45, (gb - 6) * 3);
  if (gb > 0 && gb < 0.7) score -= 15;
  // o lançamento tem de ser do título certo (e do ano certo)
  const wanted = normalizeName(title.original || title.title).split(' ').filter((word) => word.length > 1);
  const matched = wanted.filter((word) => name.includes(` ${word} `)).length;
  if (wanted.length && matched / wanted.length < 0.6) score -= 200;
  const year = Number(title.year) || 0;
  if (year && title.type === 'Filme') {
    const years = [...name.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((entry) => Number(entry[1]));
    if (years.includes(year)) score += 6; else if (years.length) score -= 15;
  }
  return score;
}

const friendlyRdError = (message, tried = 0) => {
  const text = String(message || '');
  if (/infringing_file/i.test(text)) return `O Real-Debrid recusou ${tried > 1 ? `as ${tried} versões que tentei` : 'este ficheiro'} (erro de infração). Desde 2026 filtra pelo nome do lançamento (WEB-DL, WEBRip, BDRip, HDRip…) e, depois de vários pedidos seguidos, pode recusar tudo durante alguns minutos. Espera um pouco e tenta de novo, ou escolhe à mão uma versão BluRay/Remux na lista do filme.`;
  if (/hoster[ _]not[ _]free|not[ _]premium|premium[ _]only|free[ _]users|account[ _]locked|permission[ _]denied/i.test(text)) return 'O Real-Debrid recusou o pedido: a conta ligada nesta app não tem Premium ativo (ou está bloqueada). Confirma em real-debrid.com se o Premium está ativo. Cada pessoa precisa da sua própria conta paga.';
  if (/hoster[ _](temporarily[ _])?unavailable|hoster[ _]limit|hoster[ _]maintenance|unsupported[ _]hoster|service[ _]unavailable|file[ _]unavailable/i.test(text)) return 'O Real-Debrid não conseguiu obter este ficheiro agora (“hoster indisponível”): o servidor de onde vem está em baixo, em manutenção ou o ficheiro já não existe. Escolhe outra versão na lista ou tenta daqui a pouco. Se acontecer com tudo, confirma que a tua conta tem Premium ativo.';
  if (/ip[ _]address[ _]not[ _]allowed|ip[ _]not[ _]allowed/i.test(text)) return 'O Real-Debrid bloqueou o teu endereço IP (VPN ou várias ligações ao mesmo tempo). Desliga a VPN e tenta de novo.';
  if (/traffic[ _]exhausted|fair[ _]usage/i.test(text)) return 'O Real-Debrid indica que o limite de tráfego da conta foi atingido. Tenta mais tarde.';
  if (/too[ _]many[ _]active/i.test(text)) return 'A conta Real-Debrid tem demasiadas transferências ativas. Remove algumas no site do Real-Debrid e tenta de novo.';
  return message;
};
const RD_STATUS_TEXT = { magnet_conversion: 'A obter os metadados do torrent', waiting_files_selection: 'A escolher o ficheiro de vídeo', queued: 'Na fila do Real-Debrid', downloading: 'A transferir no Real-Debrid', compressing: 'A comprimir', uploading: 'A preparar o ficheiro', downloaded: 'Pronto' };

const titles = [
  { id: 'dune2', title: 'Dune: Parte Dois', original: 'Dune: Part Two', type: 'Filme', year: 2024, rating: '8.6', genre: 'Ficção científica', runtime: '2h 46m', poster: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg', description: 'Paul Atreides une-se a Chani e aos Fremen numa jornada de vingança e destino, entre as areias de Arrakis.', tag: 'EM DESTAQUE', accent: '#c28d5d' },
  { id: 'oppenheimer', title: 'Oppenheimer', original: 'Oppenheimer', type: 'Filme', year: 2023, rating: '8.3', genre: 'Drama', runtime: '3h 00m', poster: 'https://image.tmdb.org/t/p/w500/ptpr0kGAckfQkJeJIt8st5dglvd.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/ptpr0kGAckfQkJeJIt8st5dglvd.jpg', description: 'A história do físico J. Robert Oppenheimer e do papel que desempenhou na criação da bomba atómica.', tag: 'MAIS VISTO', accent: '#c77a46' },
  { id: 'interstellar', title: 'Interstellar', original: 'Interstellar', type: 'Filme', year: 2014, rating: '8.7', genre: 'Ficção científica', runtime: '2h 49m', poster: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/rAiYTfKGqDCRIIqo664sY9XZIvQ.jpg', description: 'Uma equipa de exploradores atravessa um buraco de minhoca para descobrir se a humanidade tem futuro entre as estrelas.', accent: '#8a929c' },
  { id: 'batman', title: 'The Batman', original: 'The Batman', type: 'Filme', year: 2022, rating: '7.8', genre: 'Ação', runtime: '2h 56m', poster: 'https://image.tmdb.org/t/p/w500/74xTEgt7R36Fpooo50r9T25onhq.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/b0PlSFdDwbyK0cf5RxwDpaOJQvQ.jpg', description: 'Quando um assassino deixa pistas enigmáticas, Batman mergulha no submundo de Gotham para revelar a verdade.', accent: '#9d454d' },
  { id: 'puss', title: 'O Gato das Botas: O Último Desejo', original: 'Puss in Boots: The Last Wish', type: 'Filme', year: 2022, rating: '7.9', genre: 'Animação', runtime: '1h 42m', poster: 'https://image.tmdb.org/t/p/w500/kuf6dutpsT0vSVehic3EZIqkOBt.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/a2tys4sD7xzVaogPntGsT1ypVoT.jpg', description: 'O Gato descobre que já gastou oito das suas nove vidas e parte numa aventura para recuperar o que perdeu.', accent: '#b28854' },
  { id: 'poor-things', title: 'Pobres Criaturas', original: 'Poor Things', type: 'Filme', year: 2023, rating: '7.8', genre: 'Fantasia', runtime: '2h 21m', poster: 'https://image.tmdb.org/t/p/w500/kCGlIMHnOm8JPXq3rXM6c5wMxcT.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/s9o7LZV65k6FZT2a5bXnBvUNQjE.jpg', description: 'Uma jovem mulher, renascida com a curiosidade intacta, parte à descoberta de um mundo que ainda não conhece.', accent: '#bd8092' },
  { id: 'last-of-us', title: 'The Last of Us', original: 'The Last of Us', type: 'Série', year: 2023, rating: '8.7', genre: 'Drama', runtime: '1 temporada', poster: 'https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/2WfjB6FUDZ6x74gaj0bNwJ2b5FJ.jpg', description: 'Vinte anos após o colapso da civilização, Joel é contratado para tirar Ellie de uma zona de quarentena.', accent: '#759065' },
  { id: 'severance', title: 'Ruptura', original: 'Severance', type: 'Série', year: 2022, rating: '8.7', genre: 'Mistério', runtime: '2 temporadas', poster: 'https://image.tmdb.org/t/p/w500/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/2A7lA8XP5s9l4m3bhYCyKJYhV0v.jpg', description: 'Um trabalhador aceita separar cirurgicamente as memórias do trabalho das memórias da vida pessoal.', accent: '#8498ad' },
  { id: 'spiderverse', title: 'Através do Aranhaverso', original: 'Spider-Man: Across the Spider-Verse', type: 'Filme', year: 2023, rating: '8.6', genre: 'Animação', runtime: '2h 20m', poster: 'https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg', description: 'Miles Morales atravessa o multiverso e encontra uma equipa de heróis-aranha pronta para o proteger.', accent: '#b44c7c' },
  { id: 'arrival', title: 'O Primeiro Encontro', original: 'Arrival', type: 'Filme', year: 2016, rating: '7.9', genre: 'Ficção científica', runtime: '1h 56m', poster: 'https://image.tmdb.org/t/p/w500/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/yIZ1xendyqKvY3FGeeUYUd5X9Mm.jpg', description: 'Uma linguista é chamada para tentar comunicar com misteriosas naves que surgiram por todo o planeta.', accent: '#627c89' },
  { id: 'whiplash', title: 'Whiplash', original: 'Whiplash', type: 'Filme', year: 2014, rating: '8.5', genre: 'Drama', runtime: '1h 47m', poster: 'https://image.tmdb.org/t/p/w500/7fn624j5lj3xTme2SgiLCeuedmO.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/6bbZ6XyvgfjhQwbplnUh1LSj1ky.jpg', description: 'Um jovem baterista entra no conservatório mais competitivo do país e enfrenta um professor implacável.', accent: '#ba6445' },
  { id: 'dark-knight', title: 'O Cavaleiro das Trevas', original: 'The Dark Knight', aliases: ['The Dark Knight'], type: 'Filme', year: 2008, rating: '9.0', genre: 'Ação', runtime: '2h 32m', poster: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/nMKdUUepR0i5Zn0y1T4CsSB5jor.jpg', description: 'Batman enfrenta o caos provocado pelo Joker e descobre até onde Gotham está disposta a ir.', accent: '#68727c' },
  { id: 'inception', title: 'A Origem', original: 'Inception', aliases: ['Inception'], type: 'Filme', year: 2010, rating: '8.4', genre: 'Ficção científica', runtime: '2h 28m', poster: 'https://image.tmdb.org/t/p/w500/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/s3TBrRGB1iav7gFOCNx3H31MoES.jpg', description: 'Um ladrão especializado em sonhos recebe a missão mais difícil da sua carreira: plantar uma ideia.', accent: '#727d88' },
  { id: 'parasite', title: 'Parasitas', original: 'Parasite', aliases: ['Gisaengchung'], type: 'Filme', year: 2019, rating: '8.5', genre: 'Drama', runtime: '2h 12m', poster: 'https://image.tmdb.org/t/p/w500/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/TU9NIjwzjoKPwQHoHshkFcQUCG.jpg', description: 'Duas famílias de mundos opostos aproximam-se num jogo de ambição, humor e tensão.', accent: '#8f9a80' },
  { id: 'barbie', title: 'Barbie', original: 'Barbie', type: 'Filme', year: 2023, rating: '7.0', genre: 'Comédia', runtime: '1h 54m', poster: 'https://image.tmdb.org/t/p/w500/iuFNMS8U5cb6xfzi51Dbkovj7vM.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/ctMserH8g2SeOAnCw5gFjdQF8mo.jpg', description: 'Barbie e Ken deixam o mundo cor-de-rosa para descobrir tudo o que a vida real tem para oferecer.', accent: '#d776a7' },
  { id: 'top-gun', title: 'Top Gun: Maverick', original: 'Top Gun: Maverick', aliases: ['Top Gun Maverick'], type: 'Filme', year: 2022, rating: '8.2', genre: 'Ação', runtime: '2h 10m', poster: 'https://image.tmdb.org/t/p/w500/62HCnUTziyWcpDaBO2i1DX17ljH.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/odJ4hx6g6vBt4lBWKFD1tI8WS4x.jpg', description: 'Maverick regressa para treinar uma nova geração de pilotos para uma missão sem margem para erro.', accent: '#77869a' },
  { id: 'everything-everywhere', title: 'Tudo em Todo o Lado ao Mesmo Tempo', original: 'Everything Everywhere All at Once', aliases: ['Everything Everywhere All at Once'], type: 'Filme', year: 2022, rating: '7.7', genre: 'Ficção científica', runtime: '2h 19m', poster: 'https://image.tmdb.org/t/p/w500/w3LxiVYdWWRvEVdn5RYq6jIqkb1.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/5dE2de7xY2j8u0j1e7Z9uVQfJkW.jpg', description: 'Uma imigrante é lançada numa aventura que atravessa universos e liga todas as versões da sua vida.', accent: '#916f9f' },
  { id: 'matrix', title: 'Matrix', original: 'The Matrix', aliases: ['The Matrix'], type: 'Filme', year: 1999, rating: '8.2', genre: 'Ficção científica', runtime: '2h 16m', poster: 'https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/fNG7i7RqMErkcqhohV2a6cV1Ehy.jpg', description: 'Neo descobre que a realidade que conhece esconde um mundo construído por máquinas.', accent: '#689075' },
  { id: 'mad-max', title: 'Mad Max: Estrada da Fúria', original: 'Mad Max: Fury Road', aliases: ['Mad Max Fury Road'], type: 'Filme', year: 2015, rating: '8.1', genre: 'Ação', runtime: '2h 00m', poster: 'https://image.tmdb.org/t/p/w500/8tZYtuWezp8JbcsvHYO0O46tFbo.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/phszHPFVhPHhMZgo0fWTKBDQsJA.jpg', description: 'Num deserto sem lei, Max junta-se a Furiosa numa fuga explosiva pela liberdade.', accent: '#b27649' },
  { id: 'coco', title: 'Coco', original: 'Coco', type: 'Filme', year: 2017, rating: '8.4', genre: 'Animação', runtime: '1h 45m', poster: 'https://image.tmdb.org/t/p/w500/gGEsBPAijhVUFoiNpgZXqRVWJt2.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/smKp7QvP1kVf3nK0q6YpV0XJQJf.jpg', description: 'Miguel atravessa a Terra dos Mortos para desvendar a história da sua família e seguir a música.', accent: '#d18b4b' },
  { id: 'ratatouille', title: 'Ratatui', original: 'Ratatouille', type: 'Filme', year: 2007, rating: '8.1', genre: 'Animação', runtime: '1h 51m', poster: 'https://image.tmdb.org/t/p/w500/t3vaWRPSf6WjDSamIkKDs1iQWna.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/xgDj56UWyeWQcxQ44f5A3RTWuSs.jpg', description: 'Um rato com um paladar extraordinário encontra uma oportunidade improvável numa cozinha parisiense.', accent: '#a95848' },
  { id: 'walle', title: 'WALL·E', original: 'WALL·E', type: 'Filme', year: 2008, rating: '8.4', genre: 'Animação', runtime: '1h 38m', poster: 'https://image.tmdb.org/t/p/w500/hbhFnRzzg6ZDmm8YAmxBnQpQIPh.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/2Zw9XKxvE8j11yYpAbvBf9R8r7K.jpg', description: 'Um pequeno robot de limpeza encontra uma nova missão entre as estrelas e muda o futuro da humanidade.', accent: '#8190a0' },
  { id: 'inside-out', title: 'Divertida-Mente', original: 'Inside Out', aliases: ['Inside Out'], type: 'Filme', year: 2015, rating: '8.0', genre: 'Animação', runtime: '1h 35m', poster: 'https://image.tmdb.org/t/p/w500/2H1TmgdfNtsKlU9jKdeNyYL5y8T.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/2u1QbX1hQ8jJqVY9RkzUq2YVQjA.jpg', description: 'Alegria, Tristeza e as outras emoções ajudam Riley a adaptar-se a uma nova cidade.', accent: '#7f8fd1' },
  { id: 'soul', title: 'Soul', original: 'Soul', type: 'Filme', year: 2020, rating: '8.1', genre: 'Animação', runtime: '1h 40m', poster: 'https://image.tmdb.org/t/p/w500/hm58Jw4Lw8OIeECIq5qyPYhAeRJ.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/8tABCBpzu3mZbzMB3sRzMEHEvJi.jpg', description: 'Um músico de jazz faz uma viagem inesperada para perceber o que torna a vida especial.', accent: '#729caa' },
  { id: 'dune1', title: 'Dune: Parte Um', original: 'Dune', aliases: ['Dune 2021'], type: 'Filme', year: 2021, rating: '8.0', genre: 'Ficção científica', runtime: '2h 35m', poster: 'https://image.tmdb.org/t/p/w500/d5NXSklXo0qyIYkgV94XAgMIckC.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/jYEW5xZkZk2WTrdbMGAPFuBqbDc.jpg', description: 'Paul Atreides chega a Arrakis, o planeta mais perigoso e valioso do universo.', accent: '#bd9667' },
  { id: 'joker', title: 'Joker', original: 'Joker', type: 'Filme', year: 2019, rating: '8.2', genre: 'Drama', runtime: '2h 02m', poster: 'https://image.tmdb.org/t/p/w500/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/hO7KbdvGOtDdeg0W4Y5nKEHeDDh.jpg', description: 'Uma cidade indiferente e uma vida em queda transformam Arthur Fleck numa figura impossível de ignorar.', accent: '#a56865' },
  { id: 'queens-gambit', title: 'O Gambito da Rainha', original: "The Queen's Gambit", aliases: ['The Queens Gambit'], type: 'Série', year: 2020, rating: '8.5', genre: 'Drama', runtime: '1 temporada', poster: 'https://image.tmdb.org/t/p/w500/zU0htwkhNvBQdVSIKB9s6hgVeFK.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/34OGjFEbHj0E3lE2w0iTUVq0O4o.jpg', description: 'Uma jovem prodígio do xadrez enfrenta a competição, a fama e os seus próprios limites.', accent: '#a48256' },
  { id: 'arcane', title: 'Arcane', original: 'Arcane', type: 'Série', year: 2021, rating: '9.0', genre: 'Animação', runtime: '2 temporadas', poster: 'https://image.tmdb.org/t/p/w500/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/abf8tHznhSvl9BAElD2cQeRr7do.jpg', description: 'Duas irmãs ficam em lados opostos de um conflito entre a cidade de Piltover e o submundo de Zaun.', accent: '#9c70c1' },
  { id: 'breaking-bad', title: 'Breaking Bad', original: 'Breaking Bad', type: 'Série', year: 2008, rating: '9.5', genre: 'Drama', runtime: '5 temporadas', poster: 'https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/eSzpy96DwBujGFj0xMbXBcGcfxX.jpg', description: 'Um professor de química toma uma decisão extrema que muda para sempre a sua família e o seu futuro.', accent: '#9aa66a' },
  { id: 'squid-game', title: 'Squid Game', original: 'Squid Game', type: 'Série', year: 2021, rating: '7.8', genre: 'Drama', runtime: '2 temporadas', poster: 'https://image.tmdb.org/t/p/w500/dDlEmu3EZ0Pgg93K2SVNLCjCSvE.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/1Rr5SrvHxMXHu5RjKpaMba8VTzi.jpg', description: 'Centenas de pessoas em dificuldades aceitam competir em jogos infantis com consequências inesperadas.', accent: '#db718b' },
  { id: 'game-of-thrones', title: 'A Guerra dos Tronos', original: 'Game of Thrones', aliases: ['Game of Thrones'], type: 'Série', year: 2011, rating: '9.2', genre: 'Fantasia', runtime: '8 temporadas', poster: 'https://image.tmdb.org/t/p/w500/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/suopoADq0k8YZr4dQXcU6pToj6s.jpg', description: 'Famílias rivais disputam o poder num continente onde o inverno e uma antiga ameaça se aproximam.', accent: '#a58563' },
  { id: 'dark-series', title: 'Dark', original: 'Dark', type: 'Série', year: 2017, rating: '8.4', genre: 'Mistério', runtime: '3 temporadas', poster: 'https://image.tmdb.org/t/p/w500/apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/5LoHuHWA4H8jElFlZDvsmU2n63b.jpg', description: 'O desaparecimento de uma criança revela segredos que atravessam gerações numa pequena cidade alemã.', accent: '#687b8b' },
  { id: 'succession', title: 'Succession', original: 'Succession', type: 'Série', year: 2018, rating: '8.3', genre: 'Drama', runtime: '4 temporadas', poster: 'https://image.tmdb.org/t/p/w500/7HW47XbkNQ5fiwQFYGWdw9gs144.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/7z9zQm7m7F6xPZtF2J8QzVYwVxG.jpg', description: 'Uma família poderosa disputa o controlo de um império mediático e o lugar do patriarca.', accent: '#8b8b91' },
  { id: 'the-bear', title: 'O Urso', original: 'The Bear', aliases: ['The Bear'], type: 'Série', year: 2022, rating: '8.2', genre: 'Drama', runtime: '4 temporadas', poster: 'https://image.tmdb.org/t/p/w500/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/7pEVq4q5bF3PZV1J7Q5QK5X4Fh3.jpg', description: 'Um chef regressa a Chicago para salvar o restaurante da família e aprender a trabalhar em equipa.', accent: '#cb7a4a' },
  { id: 'stranger-things', title: 'Stranger Things', original: 'Stranger Things', type: 'Série', year: 2016, rating: '8.6', genre: 'Ficção científica', runtime: '4 temporadas', poster: 'https://image.tmdb.org/t/p/w500/uOOtwVbSr4QDjAGIifLDwpb2Pdl.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/56v2KjBlU4XaOv9rVYEQypROD7P.jpg', description: 'Um grupo de amigos enfrenta experiências secretas e forças estranhas numa cidade dos anos 80.', accent: '#9c4444' },
  { id: 'the-last-dance', title: 'The Last Dance', original: 'The Last Dance', type: 'Série', year: 2020, rating: '8.8', genre: 'Documentário', runtime: '1 temporada', poster: 'https://image.tmdb.org/t/p/w500/4Uj8a3B6ksB9H9xU2gvl6UQVVV2.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/6LWy0jvMpmjoS9fojNgHIKoWL05.jpg', description: 'Uma série documental acompanha a última época de Michael Jordan com os Chicago Bulls.', accent: '#b04a4b' },
  { id: 'knives-out', title: 'Knives Out: Todos São Suspeitos', original: 'Knives Out', aliases: ['Knives Out'], type: 'Filme', year: 2019, rating: '7.9', genre: 'Mistério', runtime: '2h 10m', poster: 'https://image.tmdb.org/t/p/w500/pThyQovXQrw2m0s9x82twj48Jq4.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/3NTEMlG5mQdI6JL3eC5wc5VOO5N.jpg', description: 'Um detetive investiga uma morte numa família cheia de segredos e suspeitos.', accent: '#c18d59' },
  { id: 'la-la-land', title: 'La La Land: Melodia de Amor', original: 'La La Land', aliases: ['La La Land'], type: 'Filme', year: 2016, rating: '7.9', genre: 'Drama', runtime: '2h 08m', poster: 'https://image.tmdb.org/t/p/w500/uDO8zWDhfWwoFdKS4fDM8O5D5.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/nadTlnTE6DdgmYsN4iWc2a2wiaI.jpg', description: 'Uma atriz e um músico tentam encontrar o seu lugar numa Los Angeles cheia de possibilidades.', accent: '#b98968' },
];

const nav = [
  { id: 'home', label: 'Início', icon: 'compass' },
  { id: 'films', label: 'Filmes', icon: 'film' },
  { id: 'series', label: 'Séries', icon: 'tv' },
  { id: 'tv', label: 'TV', icon: 'tv' },
  { id: 'music', label: 'Música', icon: 'music' },
  { id: 'books', label: 'Livros', icon: 'book' },
  { id: 'adult', label: 'Adultos', icon: 'adult' },
  { id: 'indexers', label: 'Pesquisar', icon: 'search' },
];

const DISCOVERY_COLLECTIONS = {
  tv: [
    { title: 'Episódios recentes', subtitle: 'Novos episódios e temporadas', query: 'S01 1080p', icon: 'tv', accent: 'red' },
    { title: 'Séries populares', subtitle: 'As séries mais procuradas', query: 'popular TV series', icon: 'spark', accent: 'gold' },
    { title: 'Animação', subtitle: 'Animação para todos os públicos', query: 'animated series', icon: 'spark', accent: 'violet' },
    { title: 'Documentários', subtitle: 'Histórias reais em episódios', query: 'documentary series', icon: 'film', accent: 'blue' },
    { title: 'Reality e competição', subtitle: 'Programas e concursos', query: 'reality TV show', icon: 'tv', accent: 'pink' },
    { title: 'Minisséries', subtitle: 'Histórias completas numa temporada', query: 'miniseries 1080p', icon: 'book', accent: 'green' },
  ],
  music: [
    { title: 'Álbuns populares', subtitle: 'Os sons que estão a rodar', query: 'popular album', icon: 'music', accent: 'red' },
    { title: 'Bandas sonoras', subtitle: 'Música para cada história', query: 'soundtrack', icon: 'spark', accent: 'gold' },
    { title: 'Rock e metal', subtitle: 'Guitarras no máximo', query: 'rock album', icon: 'music', accent: 'blue' },
    { title: 'Pop', subtitle: 'Novos singles e álbuns', query: 'pop album', icon: 'spark', accent: 'pink' },
    { title: 'Eletrónica', subtitle: 'Ritmos para continuar', query: 'electronic album', icon: 'music', accent: 'violet' },
    { title: 'Jazz e clássica', subtitle: 'Escuta sem pressa', query: 'jazz classical album', icon: 'music', accent: 'green' },
  ],
  books: [
    { title: 'Mais procurados', subtitle: 'Leituras em destaque', query: 'bestseller book', icon: 'book', accent: 'gold' },
    { title: 'Fantasia', subtitle: 'Mundos para descobrir', query: 'fantasy novel', icon: 'spark', accent: 'violet' },
    { title: 'Ficção científica', subtitle: 'Outros mundos, outras ideias', query: 'science fiction novel', icon: 'spark', accent: 'blue' },
    { title: 'Mistério e crime', subtitle: 'Histórias cheias de pistas', query: 'mystery crime novel', icon: 'book', accent: 'red' },
    { title: 'Romance', subtitle: 'Histórias de encontros', query: 'romance novel', icon: 'book', accent: 'pink' },
    { title: 'Banda desenhada', subtitle: 'Comics, manga e novelas gráficas', query: 'comic manga', icon: 'book', accent: 'green' },
  ],
  adult: [
    { title: 'Filmes recentes', subtitle: 'Novidades dos indexadores', query: '1080p', icon: 'film', accent: 'red' },
    { title: 'Alta definição', subtitle: 'Qualidade 1080p', query: '1080p x264', icon: 'film', accent: 'blue' },
    { title: '4K UHD', subtitle: 'Imagem de alta resolução', query: '2160p 4K', icon: 'film', accent: 'gold' },
    { title: 'Séries', subtitle: 'Episódios e temporadas', query: 'S01 1080p', icon: 'tv', accent: 'violet' },
    { title: 'VR', subtitle: 'Realidade virtual', query: 'VR 180', icon: 'spark', accent: 'green' },
    { title: 'Animação', subtitle: 'Animação adulta', query: 'adult animation', icon: 'spark', accent: 'pink' },
  ],
};

const FEED_SHELF_IDS = {
  films: { 'Filmes populares': 'tmdb:movie:list:trending', 'Populares no StreamNexus': 'tmdb:movie:list:popular', 'Estreias recentes': 'tmdb:movie:list:now_playing', 'Mais bem avaliados': 'tmdb:movie:list:top_rated' },
  series: { 'Séries populares': 'tmdb:tv:list:trending', 'Séries populares no StreamNexus': 'tmdb:tv:list:popular', 'Séries a acompanhar': 'tmdb:tv:list:on_the_air', 'Mais bem avaliadas': 'tmdb:tv:list:top_rated' },
};
const FEED_KINDS = { films: 'films', series: 'series', tv: 'tv', music: 'music', books: 'books', adult: 'adult' };
const STATIC_GENRES = {
  films: ['Ação', 'Aventura', 'Animação', 'Comédia', 'Crime', 'Documentário', 'Drama', 'Família', 'Fantasia', 'História', 'Terror', 'Música', 'Mistério', 'Romance', 'Ficção científica', 'Thriller', 'Guerra', 'Western'],
  series: ['Ação e aventura', 'Animação', 'Comédia', 'Crime', 'Documentário', 'Drama', 'Família', 'Infantil', 'Mistério', 'Reality', 'Ficção científica', 'Novela', 'Talk show', 'Guerra', 'Western'],
  tv: ['Reality', 'Talk show', 'Documentário', 'Infantil', 'Novela', 'Notícias', 'Comédia', 'Drama'],
  music: ['Pop', 'Rock e metal', 'Hip-hop', 'Eletrónica', 'Bandas sonoras', 'Jazz e clássica', 'Reggae', 'Country', 'Blues', 'Música latina', 'K-pop', 'R&B e soul', 'Indie', 'Funk', 'Samba e bossa nova', 'MPB', 'Clássica', 'Ópera', 'Gospel', 'Chill e lo-fi', 'Disco', 'House', 'Techno'],
  books: ['Fantasia', 'Ficção científica', 'Mistério', 'Romance', 'Terror', 'Biografia', 'Banda desenhada', 'Thriller e suspense', 'Ficção histórica', 'Clássicos', 'Jovem adulto', 'Infantil', 'História', 'Ciência', 'Filosofia', 'Psicologia', 'Desenvolvimento pessoal', 'Negócios', 'Culinária', 'Viagens', 'Arte', 'Poesia', 'Humor', 'Distopia', 'Aventura', 'Guerra', 'Memórias', 'Religião', 'Política', 'Economia', 'Tecnologia', 'Natureza', 'Desporto', 'Mitologia', 'Crime real', 'Contos', 'Teatro'],
};

function makeDistinctShelves(shelves, excludedIds = [], limit = 40) {
  const seen = new Set(excludedIds);
  return shelves.map((shelf) => {
    const items = [];
    for (const item of shelf.items || []) {
      if (!item?.id || seen.has(item.id) || !item.poster) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length >= limit) break;
    }
    return { ...shelf, items };
  }).filter((shelf) => shelf.items.length > 0);
}

function formatPlaybackTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function readSession() {
  if (window.streamnexus?.isDesktop) return null;
  try { return JSON.parse(sessionStorage.getItem(RD_SESSION_KEY) || 'null'); } catch { return null; }
}

async function saveSession(session) {
  if (window.streamnexus?.isDesktop) {
    await window.streamnexus.saveSession(session);
    return;
  }
  if (session) sessionStorage.setItem(RD_SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(RD_SESSION_KEY);
}

async function oauthRequest(path, { method = 'GET', body } = {}) {
  if (window.streamnexus?.isDesktop) return window.streamnexus.oauthRequest({ path, method, body });
  const response = await fetch(`${RD_OAUTH}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
    body: body ? new URLSearchParams(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || `Real-Debrid respondeu com erro ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function rdRequest(path, { token, method = 'GET', body, headers = {} } = {}) {
  if (window.streamnexus?.isDesktop) return window.streamnexus.rdRequest({ path, token, method, body });
  const response = await fetch(`${RD_API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...headers },
    body: body ? new URLSearchParams(body) : undefined,
  });
  if (response.status === 204 || response.status === 202) return null;
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(data?.error || data?.message || `Real-Debrid respondeu com erro ${response.status}.`);
  return data;
}

function formatDate(dateString) {
  if (!dateString) return '-';
  return new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(dateString));
}

// Ao mudar de faixa de áudio (ou qualidade) o fluxo recomeça a meio do filme: o relógio do vídeo volta a 0, mas a legenda
// está em tempo absoluto. Desloca os tempos da legenda para coincidirem com o novo fluxo.
function shiftVtt(vtt, offsetSeconds) {
  if (!offsetSeconds) return vtt;
  const parse = (text) => { const parts = text.split(':').map(Number); const [h, m, sec] = parts.length === 3 ? parts : [0, parts[0], parts[1]]; return h * 3600 + m * 60 + sec; };
  const format = (total) => { const t = Math.max(0, total); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const sec = t - h * 3600 - m * 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`; };
  return vtt.split(/\n{2,}/).map((block) => {
    const match = block.match(/((?:\d+:)?\d{2}:\d{2}\.\d{3}) --> ((?:\d+:)?\d{2}:\d{2}\.\d{3})/);
    if (!match) return block;
    const end = parse(match[2]) - offsetSeconds;
    if (end <= 0) return null;
    return block.replace(match[0], `${format(parse(match[1]) - offsetSeconds)} --> ${format(end)}`);
  }).filter((block) => block !== null).join('\n\n');
}

const fmtClock = (seconds) => { const total = Math.max(0, Math.round(Number(seconds) || 0)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const sec = total % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };

// Início da primeira fala de uma legenda WebVTT, em segundos.
function vttFirstStart(vtt) {
  const match = String(vtt || '').match(/((?:\d+:)?\d{2}:\d{2})\.(\d{3}) -->/);
  if (!match) return 0;
  const parts = match[1].split(':').map(Number);
  const [h, m, sec] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return h * 3600 + m * 60 + sec + Number(match[2]) / 1000;
}

function getError(error) {
  if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) return 'Não foi possível ligar à API. Verifica a ligação à internet.';
  return error?.message || 'Ocorreu um erro inesperado.';
}

function AppShell({ profile, profiles, onSwitchProfile, onManageProfiles }) {
  const kids = Boolean(profile.kids);
  useEffect(() => { startAutoCheck(); }, []);
  setFeedFilter(kids ? kidsAllowed : null);
  const applyKids = (items) => (kids ? (items || []).filter(kidsAllowed) : items);
  const [activePage, setActivePage] = useState('home');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('Todos');
  const [modal, setModal] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const collectionRequestRef = useRef('');
  const lastBrowsePageRef = useRef(activePage);
  const browseVisitRef = useRef(0);
  const releaseRequestRef = useRef(0);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState('success');
  const [session, setSession] = useState(readSession);
  const [rdUser, setRdUser] = useState(null);
  const [rdItems, setRdItems] = useState([]);
  const [rdSearch, setRdSearch] = useState(null);
  const [releaseSearch, setReleaseSearch] = useState(null);
  const [releaseBusyId, setReleaseBusyId] = useState('');
  const [integrationSettings, setIntegrationSettings] = useState({ prowlarrUrl: '', prowlarrApiKey: '', shelfarrUrl: '', shelfarrToken: '', audiobookshelfUrl: '', audiobookshelfToken: '', tmdbApiKey: '', spotifyClientId: '', spotifyClientSecret: '', openSubtitlesApiKey: '', openSubtitlesUsername: '', openSubtitlesPassword: '' });
  const [integrationForm, setIntegrationForm] = useState({ prowlarrUrl: '', prowlarrApiKey: '', shelfarrUrl: '', shelfarrToken: '', audiobookshelfUrl: '', audiobookshelfToken: '', tmdbApiKey: '', spotifyClientId: '', spotifyClientSecret: '', openSubtitlesApiKey: '', openSubtitlesUsername: '', openSubtitlesPassword: '' });
  const [integrationTestState, setIntegrationTestState] = useState({ text: '', kind: 'info', section: '' });
  const setIntegrationTest = useCallback((text, kind = 'info', section = '') => setIntegrationTestState({ text, kind, section }), []);
  const setSectionTest = (section) => (text, kind = 'info') => setIntegrationTest(text, kind, section);
  const sectionTestLine = (section) => (integrationTestState.section === section && integrationTestState.text ? <div className="integration-test-line"><span className={`is-${integrationTestState.kind}`}>{integrationTestState.text}</span></div> : null);
  const [catalogTitles, setCatalogTitles] = useState(() => (profile.kids ? titles.filter(kidsAllowed) : titles));
  const [catalogRows, setCatalogRows] = useState(null);
  const [catalogStatus, setCatalogStatus] = useState('sample');
  const [catalogUpdated, setCatalogUpdated] = useState('');
  const [tvMode, setTvMode] = useState('channels');
  const [adultMode, setAdultMode] = useState('videos');
  const [discovery, setDiscovery] = useState({});
  const [heroIndex, setHeroIndex] = useState(0);
  const [subtitleResults, setSubtitleResults] = useState([]);
  const [subtitleStatus, setSubtitleStatus] = useState('idle');
  const [subtitleError, setSubtitleError] = useState('');
  const [subtitleTrackUrl, setSubtitleTrackUrl] = useState('');
  const subtitleVtt = useRef(new Map());
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const [subtitleInfo, setSubtitleInfo] = useState(null);
  const [subtitleLine, setSubtitleLine] = useState('');
  const nudgeSubtitle = (seconds) => setSubtitleDelay((value) => Math.round((value + seconds) * 10) / 10);
  // "A primeira fala é agora": põe a primeira fala da legenda no instante em que o vídeo está.
  const alignSubtitleHere = () => {
    const raw = subtitleVtt.current.get(subtitleTrackUrl);
    const video = playerVideoRef.current;
    if (!raw || !video) return;
    const absolute = (playing?.offset || 0) + (video.currentTime || 0);
    setSubtitleDelay(Math.round((absolute - vttFirstStart(raw)) * 10) / 10);
  };
  const [subtitleShownUrl, setSubtitleShownUrl] = useState('');
  const [downloadedSubs, setDownloadedSubs] = useState([]);
  const [activeSubId, setActiveSubId] = useState('');
  const [subtitleLabel, setSubtitleLabel] = useState('');
  const [subtitleLanguage, setSubtitleLanguage] = useState('pt-PT');
  const [embeddedSubtitleTracks, setEmbeddedSubtitleTracks] = useState([]);
  const [activeEmbeddedTrack, setActiveEmbeddedTrack] = useState(null);
  const [trailer, setTrailer] = useState({ status: 'idle', key: '', name: '' });
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const trailerRequestRef = useRef(0);
  const playerVideoRef = useRef(null);
  const audioStreamIdRef = useRef('');
  const playerControlsTimerRef = useRef(null);
  const [playerControlsVisible, setPlayerControlsVisible] = useState(true);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerCurrentTime, setPlayerCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerSeekEnd, setPlayerSeekEnd] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(1);
  const [playerMuted, setPlayerMuted] = useState(false);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [playerPlaybackError, setPlayerPlaybackError] = useState('');
  const [adultEnabled, setAdultEnabled] = useState(() => {
    if (profile.kids) return false;
    try { return localStorage.getItem(pkey('streamnexus.settings.adult')) === 'true'; } catch { return false; }
  });
  const [searchCategory, setSearchCategory] = useState('movies');
  const [indexerQuery, setIndexerQuery] = useState('');
  const [rdBusy, setRdBusy] = useState(false);
  const [rdError, setRdError] = useState('');
  const [deviceAuth, setDeviceAuth] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState('');
  const [magnet, setMagnet] = useState('');
  const [magnetBusy, setMagnetBusy] = useState(false);
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem(pkey('streamnexus.watchlist')) || '[]'); } catch { return []; }
  });
  const [playing, setPlaying] = useState(null);
  const [prefs, setPrefs] = useState(() => { try { return { autoNext: true, notifyPremieres: true, ...JSON.parse(localStorage.getItem(pkey('streamnexus.prefs')) || '{}') }; } catch { return { autoNext: true, notifyPremieres: true }; } });
  const changePrefs = (patch) => setPrefs((current) => { const next = { ...current, ...patch }; try { localStorage.setItem(pkey('streamnexus.prefs'), JSON.stringify(next)); } catch { /* só nesta sessão */ } return next; });
  const [nextCountdown, setNextCountdown] = useState(null);
  const [watch, setWatch] = useState(loadWatch);
  const updateWatch = (change) => setWatch((current) => { const next = change(current); saveWatch(next); return next; });
  const watchLookup = (item) => watchInfo(watch, item);
  const previewResolver = useMemo(() => (window.streamnexus?.isDesktop ? async (item) => {
    const media = await window.streamnexus.resolveAdultMedia({ embedUrl: item.embedUrl });
    const small = [...media.qualities].sort((a, b) => a.height - b.height).find((entry) => entry.height >= 240) || media.qualities[media.qualities.length - 1];
    return small ? { url: small.url, duration: media.duration } : null;
  } : null), []);
  const toggleEpisodeWatched = (title, season, episode, watched, name) => updateWatch((current) => markWatched(current, title, { season, episode, name }, watched));
  const toggleMovieWatched = (title, watched) => updateWatch((current) => markWatched(current, title, null, watched));
  const forgetTitle = (id) => updateWatch((current) => removeTitle(current, id));
  const [visibleCount, setVisibleCount] = useState(24);

  const notify = useCallback((message, kind = 'success') => {
    setNotice(message);
    setNoticeKind(kind);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setNotice(''), 3600);
  }, []);

  const refreshSession = useCallback(async (current) => {
    if (!current?.refresh_token || !current?.client_id || !current?.client_secret) return current;
    const now = Date.now();
    if (current.expires_at && current.expires_at - now > 60_000) return current;
    const data = await oauthRequest('/token', { method: 'POST', body: { client_id: current.client_id, client_secret: current.client_secret, code: current.refresh_token, grant_type: 'http://oauth.net/grant_type/device/1.0' } });
    if (!data.access_token) throw new Error('A sessão Real-Debrid expirou. Volta a ligar a conta.');
    const next = { ...current, ...data, expires_at: Date.now() + (data.expires_in || 0) * 1000 };
    await saveSession(next);
    setSession(next);
    return next;
  }, []);

  const callRd = useCallback(async (path, options = {}) => {
    const active = await refreshSession(session);
    if (!active?.access_token) throw new Error('Liga primeiro a tua conta Real-Debrid.');
    return rdRequest(path, { ...options, token: active.access_token });
  }, [refreshSession, session]);

  const loadRdAccount = useCallback(async () => {
    if (!session?.access_token) return;
    setRdBusy(true);
    setRdError('');
    try {
      const [user, torrents] = await Promise.all([callRd('/user'), callRd('/torrents?limit=5000')]);
      setRdUser(user);
      setRdItems(Array.isArray(torrents) ? torrents : []);
    } catch (error) {
      setRdError(getError(error));
      if (/token|sessão/i.test(error.message)) { await saveSession(null); setSession(null); setRdUser(null); }
    } finally { setRdBusy(false); }
  }, [callRd, session]);

  useEffect(() => { loadRdAccount(); }, [loadRdAccount]);

  useEffect(() => {
    if (!window.streamnexus?.isDesktop) return undefined;
    let active = true;
    window.streamnexus.loadSession()
      .then((stored) => { if (active && stored) setSession(stored); })
      .catch((error) => { if (active) setRdError(getError(error)); });
    return () => { active = false; };
  }, []);

  const refreshCatalog = async () => {
    if (!integrationSettings.tmdbApiKey) { setCatalogStatus('sample'); return; }
    setCatalogStatus('loading');
    try {
      if (!window.streamnexus?.isDesktop) throw new Error('A atualização do catálogo está disponível na app desktop.');
      const data = await window.streamnexus.fetchCatalog();
      setCatalogTitles(applyKids(data.titles?.length ? data.titles : titles));
      setCatalogRows(data.rows ? Object.fromEntries(Object.entries(data.rows).map(([key, list]) => [key, applyKids(list)])) : null);
      setHeroIndex(0);
      setCatalogUpdated(new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()));
      setCatalogStatus('ready');
    } catch (error) {
      setCatalogStatus('error');
      notify(getError(error), 'error');
    }
  };

  useEffect(() => {
    if (!integrationSettings.tmdbApiKey) { setCatalogStatus('sample'); return; }
    refreshCatalog();
  }, [integrationSettings.tmdbApiKey]);

  const loadDiscovery = useCallback(async (kind) => {
    if (!window.streamnexus?.isDesktop) {
      setDiscovery((current) => ({ ...current, [kind]: { status: 'error', rows: [], message: 'Esta secção está disponível na app desktop.' } }));
      return;
    }
    setDiscovery((current) => ({ ...current, [kind]: { status: 'loading', rows: current[kind]?.rows || [] } }));
    try {
      const rows = await window.streamnexus.fetchDiscovery(kind);
      setDiscovery((current) => ({ ...current, [kind]: { status: 'ready', rows } }));
    } catch (error) {
      setDiscovery((current) => ({ ...current, [kind]: { status: 'error', rows: [], message: getError(error) } }));
    }
  }, []);

  useEffect(() => {
    if (!DISCOVERY_PAGES.includes(activePage)) return;
    const current = discovery[activePage];
    if (current && current.status !== 'error') return;
    if (activePage === 'tv' && tvMode !== 'shows') return;
    if ((activePage === 'tv' || activePage === 'adult') && !integrationSettings.tmdbApiKey) return;
    if (activePage === 'adult' && (!adultEnabled || adultMode !== 'cinema')) return;
    loadDiscovery(activePage);
  }, [activePage, tvMode, adultMode, adultEnabled, integrationSettings.tmdbApiKey]);

  const discoveryLookup = useMemo(() => Object.values(discovery).flatMap((entry) => (entry.rows || []).flatMap((row) => row.items)), [discovery]);
  const discoveryPage = DISCOVERY_PAGES.includes(activePage) && (activePage !== 'adult' || adultEnabled);
  const discoveryState = discovery[activePage];
  const catalogIdSet = new Set(catalogTitles.map((item) => item.id));
  const discoveryShelves = discoveryPage ? (discoveryState?.rows || []).map((row) => (activePage === 'adult' ? { ...row, items: row.items.filter((item) => !catalogIdSet.has(item.id)) } : row)) : [];
  const discoveryItems = [...new Map(discoveryShelves.flatMap((row) => applyKids(row.items)).filter((item) => item.poster).map((item) => [item.id, item])).values()];

  const featuredTitles = discoveryPage ? discoveryItems.slice(0, 10) : activePage === 'films'
    ? (catalogRows?.popularMovies?.length ? catalogRows.popularMovies : catalogTitles.filter((item) => item.type === 'Filme'))
    : activePage === 'series'
      ? (catalogRows?.popularSeries?.length ? catalogRows.popularSeries : catalogTitles.filter((item) => item.type === 'Série'))
      : (catalogRows?.trending?.length ? catalogRows.trending : catalogTitles);
  const featuredTitle = featuredTitles[heroIndex % Math.max(featuredTitles.length, 1)] || titles[0];
  useEffect(() => {
    if (!(['home', 'films', 'series', 'tv', 'music', 'books'].includes(activePage) || (activePage === 'adult' && adultEnabled)) || featuredTitles.length < 2 || query || genre !== 'Todos') return undefined;
    const timer = window.setInterval(() => setHeroIndex((index) => (index + 1) % featuredTitles.length), 8500);
    return () => window.clearInterval(timer);
  }, [activePage, featuredTitles.length, query, genre]);

  useEffect(() => { setHeroIndex(0); }, [activePage]);

  useEffect(() => {
    const shift = (playing?.offset || 0) - subtitleDelay;
    const raw = subtitleVtt.current.get(subtitleTrackUrl);
    setSubtitleInfo(null);
    if (!subtitleTrackUrl || !raw || !shift) { setSubtitleShownUrl(subtitleTrackUrl); return undefined; }
    const shifted = URL.createObjectURL(new Blob([shiftVtt(raw, shift)], { type: 'text/vtt;charset=utf-8' }));
    setSubtitleShownUrl(shifted);
    return () => URL.revokeObjectURL(shifted);
  }, [subtitleTrackUrl, playing?.offset, subtitleDelay]);

  // As legendas transferidas são desenhadas pela própria app (por cima do vídeo e dos controlos): a faixa fica "hidden"
  // — carrega as falas e avisa quando muda a fala ativa — e o texto aparece no elemento .subtitle-cue.
  useEffect(() => {
    if (!subtitleShownUrl) { setSubtitleLine(''); return undefined; }
    const video = playerVideoRef.current;
    const ours = () => Array.from(video?.textTracks || []).filter((track) => String(track.label || '').startsWith('OpenSubtitles ·'));
    const clean = (text) => String(text || '').replace(/<[^>]+>/g, '').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
    const sync = () => setSubtitleLine(clean(ours().flatMap((track) => Array.from(track.activeCues || [])).map((cue) => cue.text).join('\n')));
    const listened = new Set();
    const show = () => {
      ours().forEach((track) => {
        if (track.mode !== 'hidden') track.mode = 'hidden';
        if (!listened.has(track)) { listened.add(track); track.addEventListener('cuechange', sync); }
      });
      sync();
    };
    show();
    video?.addEventListener('loadedmetadata', show);
    video?.addEventListener('loadeddata', show);
    video?.addEventListener('timeupdate', sync);
    video?.addEventListener('seeked', sync);
    const timers = [80, 400, 1200, 3000].map((delay) => window.setTimeout(show, delay));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      video?.removeEventListener('loadedmetadata', show); video?.removeEventListener('loadeddata', show);
      video?.removeEventListener('timeupdate', sync); video?.removeEventListener('seeked', sync);
      listened.forEach((track) => track.removeEventListener('cuechange', sync));
      setSubtitleLine('');
    };
  }, [subtitleShownUrl, playing?.url]);

  useEffect(() => {
    const video = playerVideoRef.current;
    const trackList = video?.textTracks;
    if (!trackList) return undefined;
    const updateTracks = () => {
      const originalTracks = Array.from(trackList).filter((track) => ['subtitles', 'captions'].includes(track.kind) && !String(track.label || '').startsWith('OpenSubtitles ·'));
      setEmbeddedSubtitleTracks(originalTracks);
      setActiveEmbeddedTrack(originalTracks.find((track) => track.mode === 'showing') || null);
    };
    trackList.addEventListener?.('addtrack', updateTracks);
    trackList.addEventListener?.('change', updateTracks);
    video.addEventListener('loadedmetadata', updateTracks);
    const timer = window.setTimeout(updateTracks, 350);
    return () => {
      window.clearTimeout(timer);
      trackList.removeEventListener?.('addtrack', updateTracks);
      trackList.removeEventListener?.('change', updateTracks);
      video.removeEventListener('loadedmetadata', updateTracks);
    };
  }, [playing?.url, subtitleTrackUrl]);

  // Diagnóstico das legendas transferidas: lê a faixa do vídeo (modo, falas carregadas e a fala atual).
  useEffect(() => {
    if (!subtitleShownUrl) { setSubtitleInfo(null); return undefined; }
    const read = () => {
      const video = playerVideoRef.current;
      const track = Array.from(video?.textTracks || []).find((item) => String(item.label || '').startsWith('OpenSubtitles ·'));
      if (!track) { setSubtitleInfo({ missing: true }); return; }
      const cues = track.cues ? Array.from(track.cues) : null;
      const active = Array.from(track.activeCues || []).map((cue) => cue.text).join(' / ');
      setSubtitleInfo({ mode: track.mode, cues: cues ? cues.length : null, first: cues?.[0]?.startTime ?? 0, last: cues?.length ? cues[cues.length - 1].endTime : 0, active, now: video?.currentTime || 0 });
    };
    read();
    const timer = window.setInterval(read, 1000);
    return () => window.clearInterval(timer);
  }, [subtitleShownUrl, playing?.url]);

  const isPlayerOpen = modal?.type === 'player';
  useEffect(() => { setNextCountdown(playing?.nextEpisode && prefs.autoNext ? 10 : null); }, [playing?.nextEpisode?.season, playing?.nextEpisode?.episode, prefs.autoNext]);
  useEffect(() => {
    if (nextCountdown === null) return undefined;
    if (nextCountdown <= 0) { setNextCountdown(null); if (playing?.nextEpisode) startPlayback(playing.metadata, { episode: playing.nextEpisode, resumeAt: 0 }); return undefined; }
    const timer = window.setTimeout(() => setNextCountdown((value) => (value === null ? null : value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [nextCountdown]);
  const revealPlayerControls = useCallback(() => {
    setPlayerControlsVisible(true);
    window.clearTimeout(playerControlsTimerRef.current);
    if (isPlayerOpen) {
      playerControlsTimerRef.current = window.setTimeout(() => {
        setPlayerControlsVisible(false);
        setSubtitleMenuOpen(false);
      }, 3500);
    }
  }, [isPlayerOpen]);

  useEffect(() => {
    if (!window.streamnexus?.isDesktop) return undefined;
    setPlayerFullscreen(isPlayerOpen);
    window.streamnexus.setFullscreen(isPlayerOpen).catch(() => {});
    return () => { if (isPlayerOpen) window.streamnexus.setFullscreen(false).catch(() => {}); };
  }, [isPlayerOpen]);

  useEffect(() => {
    if (!isPlayerOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [isPlayerOpen]);

  useEffect(() => {
    if (!isPlayerOpen) {
      window.clearTimeout(playerControlsTimerRef.current);
      setPlayerControlsVisible(true);
      setSubtitleMenuOpen(false);
      return undefined;
    }
    revealPlayerControls();
    return () => window.clearTimeout(playerControlsTimerRef.current);
  }, [isPlayerOpen, revealPlayerControls]);

  useEffect(() => {
    if (isPlayerOpen) return undefined;
    const streamId = audioStreamIdRef.current;
    audioStreamIdRef.current = '';
    if (streamId) window.streamnexus?.stopAudioStream(streamId).catch(() => {});
    return undefined;
  }, [isPlayerOpen]);

  useEffect(() => () => {
    window.clearTimeout(playerControlsTimerRef.current);
    const streamId = audioStreamIdRef.current;
    audioStreamIdRef.current = '';
    if (streamId) window.streamnexus?.stopAudioStream(streamId).catch(() => {});
  }, []);

  useEffect(() => {
    const video = playerVideoRef.current;
    if (!isPlayerOpen || !video) return undefined;
    setPlayerPlaybackError('');
    const updateTime = () => {
      setPlayerCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0);
      setPlayerDuration(Number.isFinite(video.duration) ? video.duration : 0);
      try { setPlayerSeekEnd(video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0); } catch { setPlayerSeekEnd(0); }
    };
    const updatePlayback = () => setPlayerPlaying(!video.paused);
    const updateVolume = () => { setPlayerVolume(video.volume); setPlayerMuted(video.muted); };
    updateTime();
    updatePlayback();
    updateVolume();
    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('durationchange', updateTime);
    video.addEventListener('loadedmetadata', updateTime);
    video.addEventListener('play', updatePlayback);
    video.addEventListener('pause', updatePlayback);
    video.addEventListener('volumechange', updateVolume);
    return () => {
      video.removeEventListener('timeupdate', updateTime);
      video.removeEventListener('durationchange', updateTime);
      video.removeEventListener('loadedmetadata', updateTime);
      video.removeEventListener('play', updatePlayback);
      video.removeEventListener('pause', updatePlayback);
      video.removeEventListener('volumechange', updateVolume);
    };
  }, [isPlayerOpen, playing?.url]);

  useEffect(() => {
    const video = playerVideoRef.current;
    if (!isPlayerOpen || !video || !playing?.hls || !playing.url) return undefined;
    let hls = null;
    let cancelled = false;
    let recovered = false;
    const fail = () => { if (!cancelled) fallbackLiveToPipe().then((switched) => { if (!switched && !cancelled && !tryNextLiveStream()) setPlayerPlaybackError('O leitor integrado não conseguiu abrir este vídeo.'); }); };
    import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) { fail(); return; }
      hls = new Hls({ enableWorker: false, maxBufferLength: 30, liveSyncDurationCount: 3, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 2 });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); return; }
        hls.destroy(); hls = null; fail();
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hls.loadSource(playing.url);
      hls.attachMedia(video);
    }).catch(fail);
    return () => { cancelled = true; if (hls) hls.destroy(); };
  }, [isPlayerOpen, playing?.url, playing?.hls]);

  const handleVideoError = async () => {
    if (playing?.hls) { if (!(await fallbackLiveToPipe()) && !tryNextLiveStream()) setPlayerPlaybackError('O leitor integrado não conseguiu abrir este vídeo.'); return; }
    if (playing?.live && playing.piped && tryNextLiveStream()) return;
    if (playing?.direct && playing.sourceUrl && window.streamnexus?.isDesktop) {
      const stream = await preparePlayerAudio(playing.sourceUrl, { forcePipe: true, audioIndex: playing.audioIndex ?? -1 });
      setPlaying((current) => (current ? { ...current, ...stream, direct: false } : current));
      return;
    }
    if (!playing?.live && playing?.piped && playing.sourceUrl && window.streamnexus?.isDesktop) {
      const position = (playing.offset || 0) + (playerVideoRef.current?.currentTime || 0);
      if (position > 5 && (playing.resumes || 0) < 6) { await resumePlayback(position); return; }
      if (!playing.transcoded) { await retryWithVideoConversion(); return; }
    }
    let reason = 'O leitor integrado não conseguiu abrir este vídeo.';
    try {
      const info = playing?.id ? await window.streamnexus?.getStreamInfo(playing.id) : null;
      if (info?.error) reason = `${reason} ${info.error.split('\n').pop()}`;
      else if (info?.videoCodec === 'hevc' && !info.transcodeVideo) reason = 'O leitor integrado não conseguiu reproduzir este vídeo HEVC (H.265).';
    } catch { /* mantém a mensagem genérica */ }
    setPlayerPlaybackError(reason);
  };

  const retryWithVideoConversion = async () => {
    if (!playing?.sourceUrl) return;
    setPlayerPlaybackError('');
    setPlaying((current) => current ? { ...current, url: '', id: '', converting: true } : current);
    const stream = await preparePlayerAudio(playing.sourceUrl, { transcodeVideo: true, live: Boolean(playing.live), audioIndex: playing.audioIndex ?? -1 });
    setPlaying((current) => current ? { ...current, ...stream, converting: false, transcoded: true, direct: false } : current);
  };

  const resumePlayback = async (position, exact = false, options = {}) => {
    if (!playing?.sourceUrl || playing.resuming) return;
    const startAt = Math.max(0, Math.floor(position) - (exact ? 0 : 3));
    const quality = options.quality ?? playing.quality ?? (playing.transcoded ? '1080' : 'original');
    const audioIndex = options.audioIndex ?? playing.audioIndex ?? 0;
    setPlayerPlaybackError('');
    setPlaying((current) => (current ? { ...current, url: '', id: '', resuming: true } : current));
    const stream = await preparePlayerAudio(playing.sourceUrl, { forcePipe: true, transcodeVideo: quality !== 'original', quality: quality === 'original' ? '' : quality, startAt, audioIndex });
    if (stream.audioWarning) {
      setPlaying((current) => (current ? { ...current, resuming: false } : current));
      setPlayerPlaybackError(`Não foi possível retomar a reprodução. ${stream.audioWarning}`);
      return;
    }
    setPlaying((current) => (current ? { ...current, ...stream, resuming: false, direct: false, offset: startAt, quality, audioIndex, transcoded: quality !== 'original' || Boolean(stream.transcoded), resumes: exact ? current.resumes || 0 : (current.resumes || 0) + 1 } : current));
  };

  const changeAudio = async (audioIndex) => {
    setAudioMenuOpen(false);
    if (!playing?.sourceUrl || (playing.audioIndex ?? 0) === audioIndex) return;
    const position = (playing.offset || 0) + (playerVideoRef.current?.currentTime || 0);
    await resumePlayback(position, true, { audioIndex });
  };

  const changeQuality = async (quality) => {
    setQualityMenuOpen(false);
    setSlowDismissed(true);
    if (!playing?.sourceUrl || (playing.quality || 'original') === quality) return;
    const position = (playing.offset || 0) + (playerVideoRef.current?.currentTime || 0);
    await resumePlayback(position, true, { quality });
  };

  // Episódio seguinte (mesma temporada ou a primeira da seguinte)
  const nextEpisodeAfter = async (title, season, episode) => {
    if (!window.streamnexus?.isDesktop || !title?.tmdbId) return null;
    try {
      const current = await window.streamnexus.fetchTvSeason({ tmdbId: title.tmdbId, season });
      const next = current.episodes.find((entry) => entry.number === episode + 1);
      if (next) return { season, episode: next.number, name: next.name };
      const nextSeason = current.seasons.find((entry) => entry.number > season && entry.number > 0);
      if (!nextSeason) return null;
      const following = await window.streamnexus.fetchTvSeason({ tmdbId: title.tmdbId, season: nextSeason.number });
      const first = following.episodes[0];
      return first ? { season: nextSeason.number, episode: first.number, name: first.name } : null;
    } catch { return null; }
  };

  const finishPlayback = async () => {
    const meta = playing?.metadata;
    if (!meta?.id) return;
    updateWatch((current) => withProgress(current, meta, playing.episode || null, 1, 1, true));
    if (meta.type === 'Série' && playing.episode) {
      const next = await nextEpisodeAfter(meta, playing.episode.season, playing.episode.episode);
      if (next) setPlaying((current) => (current?.metadata?.id === meta.id ? { ...current, nextEpisode: next } : current));
    }
  };

  const handleVideoEnded = () => {
    const position = (playing?.offset || 0) + (playerVideoRef.current?.currentTime || 0);
    if (playing?.piped && !playing.live && playing.totalDuration && !playing.resuming && position < playing.totalDuration - 45 && (playing.resumes || 0) < 6) { resumePlayback(position); return; }
    const total = playing?.totalDuration || playerVideoRef.current?.duration || 0;
    if (!playing?.live && total && position >= total * 0.9) finishPlayback();
  };

  // Guarda a posição do filme/episódio de 8 em 8 segundos (e ao sair), e marca como visto perto do fim
  useEffect(() => {
    if (!isPlayerOpen || !playing?.url || playing.live || !['Filme', 'Série'].includes(playing.metadata?.type) || !playing.metadata?.id) return undefined;
    const save = () => {
      const video = playerVideoRef.current;
      if (!video) return;
      const position = (playing.offset || 0) + (video.currentTime || 0);
      const duration = playing.totalDuration || (Number.isFinite(video.duration) ? video.duration : 0);
      if (!duration || position < 5) return;
      updateWatch((current) => withProgress(current, playing.metadata, playing.episode || null, position, duration));
    };
    const timer = window.setInterval(save, 8000);
    window.addEventListener('beforeunload', save);
    return () => { save(); window.clearInterval(timer); window.removeEventListener('beforeunload', save); };
  }, [isPlayerOpen, playing?.url, playing?.metadata?.id, playing?.episode?.season, playing?.episode?.episode, playing?.offset, playing?.totalDuration]);

  // Retoma de onde ficou: salta para a posição guardada assim que o vídeo está pronto
  useEffect(() => {
    if (!isPlayerOpen || !playing?.url || !playing.resumeAt || playing.live || playing.resuming) return;
    const at = playing.resumeAt;
    setPlaying((current) => (current ? { ...current, resumeAt: 0 } : current));
    if (playing.piped) { resumePlayback(at, true); return; }
    const video = playerVideoRef.current;
    if (!video) return;
    const apply = () => { video.currentTime = at; };
    if (video.readyState >= 1) apply(); else video.addEventListener('loadedmetadata', apply, { once: true });
  }, [isPlayerOpen, playing?.url, playing?.resumeAt]);

  const pipedSeek = Boolean(playing?.piped && !playing.live && playing.totalDuration);
  const [seekDraft, setSeekDraft] = useState(null);
  const [slowConnection, setSlowConnection] = useState(false);
  const [slowDismissed, setSlowDismissed] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);

  useEffect(() => {
    const video = playerVideoRef.current;
    setSlowConnection(false);
    setSlowDismissed(false);
    if (!isPlayerOpen || !video || playing?.live) return undefined;
    const stalls = [];
    const onWaiting = () => {
      if (video.currentTime < 4 || video.seeking) return;
      const now = Date.now();
      stalls.push(now);
      while (stalls.length && now - stalls[0] > 90000) stalls.shift();
      if (stalls.length >= 3) setSlowConnection(true);
    };
    video.addEventListener('waiting', onWaiting);
    return () => video.removeEventListener('waiting', onWaiting);
  }, [isPlayerOpen, playing?.url, playing?.live]);

  const togglePlayerPlayback = () => {
    const video = playerVideoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => setPlayerPlaybackError('Não foi possível iniciar a reprodução.'));
    else video.pause();
    revealPlayerControls();
  };

  const seekPlayer = (seconds) => {
    const video = playerVideoRef.current;
    if (pipedSeek) {
      const base = (playing.offset || 0) + (video?.currentTime || 0);
      resumePlayback(Math.min(Math.max(base + seconds, 0), playing.totalDuration - 5), true);
      revealPlayerControls();
      return;
    }
    if (!video) return;
    const start = video.seekable.length ? video.seekable.start(0) : 0;
    const end = Number.isFinite(video.duration) ? video.duration : video.seekable.length ? video.seekable.end(video.seekable.length - 1) : video.currentTime;
    video.currentTime = Math.min(Math.max(video.currentTime + seconds, start), end);
    revealPlayerControls();
  };

  const setPlayerSeekPosition = (value) => {
    const video = playerVideoRef.current;
    if (!video) return;
    let start = 0;
    let end = Number.isFinite(video.duration) ? video.duration : 0;
    try {
      if (video.seekable.length) {
        start = video.seekable.start(0);
        if (!end) end = video.seekable.end(video.seekable.length - 1);
      }
    } catch { return; }
    if (!end) return;
    video.currentTime = Math.min(Math.max(Number(value), start), end);
    revealPlayerControls();
  };

  const togglePlayerMute = () => {
    const video = playerVideoRef.current;
    if (!video) return;
    const shouldUnmute = video.muted;
    if (shouldUnmute && video.volume === 0) video.volume = 0.5;
    video.muted = !shouldUnmute;
    setPlayerMuted(video.muted);
    revealPlayerControls();
  };

  const togglePlayerFullscreen = () => {
    const next = !playerFullscreen;
    setPlayerFullscreen(next);
    window.streamnexus?.setFullscreen(next).catch(() => {});
    revealPlayerControls();
  };

  useEffect(() => {
    if (!playing?.pending || !playing.torrentId) return undefined;
    let cancelled = false;
    let timer;
    let polls = 0;
    let downloadingSince = 0;
    const nextDelay = () => (polls < 12 ? 2000 : 7000);
    // Passa para o próximo melhor lançamento (apaga o atual do Real-Debrid); devolve false se não houver mais
    const switchToNext = async () => {
      const candidates = playing.candidates || [];
      let index = (playing.candidateIndex || 0) + 1;
      if (!candidates.length || index >= candidates.length) return false;
      callRd(`/torrents/delete/${encodeURIComponent(playing.torrentId)}`, { method: 'DELETE' }).catch(() => {});
      const active = await refreshSession(session);
      while (index < candidates.length) {
        const release = candidates[index];
        try {
          const added = await window.streamnexus.addReleaseToRealDebrid({ releaseId: release.id, token: active.access_token });
          if (cancelled) return true;
          setPlaying((current) => (current?.torrentId === playing.torrentId ? { ...current, torrentId: added.id, candidateIndex: index, startedAt: Date.now(), fileName: release.title, releaseTitle: release.title, progress: 0, transferStatus: 'magnet_conversion', error: '', switched: (current.switched || 0) + 1 } : current));
          return true;
        } catch { index += 1; if (index < candidates.length && !cancelled) await sleep(3000); }
      }
      return false;
    };
    const poll = async () => {
      try {
        polls += 1;
        const details = await callRd(`/torrents/info/${encodeURIComponent(playing.torrentId)}`);
        if (cancelled) return;
        // Escolha automática do ficheiro: só o maior vídeo nos filmes (o Real-Debrid transfere menos e fica pronto mais depressa)
        if (details.status === 'waiting_files_selection') {
          const videos = (details.files || []).filter((file) => VIDEO_FILE_PATTERN.test(file.path || ''));
          const files = playing.metadata?.type === 'Filme' && videos.length ? String([...videos].sort((a, b) => (b.bytes || 0) - (a.bytes || 0))[0].id) : videos.length ? videos.map((file) => file.id).join(',') : 'all';
          await callRd(`/torrents/selectFiles/${encodeURIComponent(playing.torrentId)}`, { method: 'POST', body: { files } });
          if (!cancelled) timer = window.setTimeout(poll, 1200);
          return;
        }
        if (details.links?.length) {
          const wantedFile = String(playing.candidates?.[playing.candidateIndex || 0]?.fileName || '').toLowerCase();
          const exact = !playing.episode && wantedFile ? getPlayableEntries(details).find((entry) => entry.name.split('/').pop().toLowerCase() === wantedFile) : null;
          const picked = exact ? { entry: exact } : pickPlayableEntry(details, playing.metadata, playing.episode);
          if (picked.choose) {
            setPlaying(null);
            setModal({ type: 'files', torrent: { id: playing.torrentId, filename: details.filename }, titleHint: playing.metadata, entries: picked.choose, ctx: { episode: playing.episode, resumeAt: playing.resumeAt } });
            return;
          }
          const chosenLink = details.links[picked.entry?.linkIndex ?? 0];
          let unrestricted;
          try { unrestricted = await callRd('/unrestrict/link', { method: 'POST', body: { link: chosenLink } }); }
          catch (error) { if (cancelled) return; if (await switchToNext()) return; throw error; }
          if (cancelled) return;
          const sourceUrl = unrestricted.download || chosenLink;
          const playbackStream = await preparePlayerAudio(sourceUrl);
          if (cancelled) {
            if (playbackStream.id) window.streamnexus?.stopAudioStream(playbackStream.id).catch(() => {});
            return;
          }
          setPlaying((current) => current?.torrentId === playing.torrentId ? { ...current, ...playbackStream, pending: false, progress: 100 } : current);
          loadRdAccount();
          return;
        }
        if (['dead', 'error', 'virus', 'magnet_error'].includes(details.status)) {
          if (await switchToNext()) return;
          setPlaying((current) => current?.torrentId === playing.torrentId ? { ...current, pending: false, error: 'O Real-Debrid não conseguiu preparar este ficheiro.' } : current);
          return;
        }
        // Torrent que não arranca (sem cache e quase sem progresso): troca para o próximo melhor lançamento
        if (['downloading', 'queued'].includes(details.status)) { if (!downloadingSince) downloadingSince = Date.now(); } else downloadingSince = 0;
        const notCached = downloadingSince && Date.now() - downloadingSince > 9000 && Number(details.progress || 0) < 5;
        const noMetadata = ['magnet_conversion', 'compressing', 'uploading'].includes(details.status) && playing.startedAt && Date.now() - playing.startedAt > 40000;
        if (playing.candidates && playing.startedAt && (notCached || noMetadata) && await switchToNext()) return;
        setPlaying((current) => current?.torrentId === playing.torrentId ? { ...current, progress: Number(details.progress || 0), transferStatus: details.status } : current);
        timer = window.setTimeout(poll, nextDelay());
      } catch (error) {
        if (cancelled) return;
        const message = friendlyRdError(getError(error), (playing.candidates?.length || 0) || (playing.candidateIndex || 0) + 1);
        const final = /infringing|bloquead|blocked|not_available|file_unavailable|permission_denied|hoster|premium|ip[ _]address|traffic|fair[ _]usage|too[ _]many/i.test(`${getError(error)} ${message}`);
        setPlaying((current) => current?.torrentId === playing.torrentId ? { ...current, error: message, ...(final ? { pending: false } : {}) } : current);
        if (!final) timer = window.setTimeout(poll, 12000);
      }
    };
    poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [playing?.pending, playing?.torrentId, callRd, loadRdAccount]);

  useEffect(() => {
    if (window.streamnexus?.isDesktop) {
      window.streamnexus.loadIntegrations()
        .then((settings) => { setIntegrationSettings(settings); setIntegrationForm(settings); })
        .catch((error) => setIntegrationTest(getError(error), 'error'));
      return;
    }
    try {
      const settings = JSON.parse(sessionStorage.getItem('streamnexus.integrations') || '{"prowlarrUrl":"","prowlarrApiKey":""}');
      setIntegrationSettings(settings); setIntegrationForm(settings);
    } catch { /* mantém a configuração vazia */ }
  }, []);

  useEffect(() => {
    const onShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (activePage !== 'indexers') setActivePage('indexers');
        window.setTimeout(() => document.querySelector('#indexer-query')?.focus(), 0);
      }
      if (event.key === 'Escape') {
        if (modal?.type === 'player') { setPlaying(null); setSubtitleTrackUrl(''); setActiveSubId(''); }
        setModal(null);
        setProfileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [activePage, modal]);

  // Atalhos do leitor, ao estilo Netflix: espaço/K, setas, M, F, C. Sem lista de dependências para usar sempre o estado atual.
  useEffect(() => {
    if (!isPlayerOpen) return undefined;
    const onPlayerKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '')) return;
      const key = event.key.toLowerCase();
      if (key === ' ' || key === 'k') togglePlayerPlayback();
      else if (key === 'arrowleft' || key === 'j') seekPlayer(-10);
      else if (key === 'arrowright' || key === 'l') seekPlayer(10);
      else if (key === 'm') togglePlayerMute();
      else if (key === 'f') togglePlayerFullscreen();
      else if (key === 'c') { setSubtitleMenuOpen((open) => !open); revealPlayerControls(); }
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onPlayerKey);
    return () => window.removeEventListener('keydown', onPlayerKey);
  });

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutsideClick);
    return () => window.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (!deviceAuth) return undefined;
    let stopped = false;
    let timer;
    const start = Date.now();
    const poll = async () => {
      if (stopped) return;
      try {
        const credentials = await oauthRequest(`/device/credentials?client_id=${encodeURIComponent(RD_OPEN_SOURCE_CLIENT_ID)}&code=${encodeURIComponent(deviceAuth.device_code)}`);
        if (credentials.client_id && credentials.client_secret) {
          setDeviceStatus('A concluir ligação segura…');
          const tokenData = await oauthRequest('/token', { method: 'POST', body: { client_id: credentials.client_id, client_secret: credentials.client_secret, code: deviceAuth.device_code, grant_type: 'http://oauth.net/grant_type/device/1.0' } });
          if (!tokenData.access_token) throw new Error('Não foi possível finalizar a ligação.');
          const next = { ...tokenData, ...credentials, expires_at: Date.now() + (tokenData.expires_in || 0) * 1000 };
          await saveSession(next);
          setSession(next);
          setDeviceAuth(null);
          setDeviceStatus('');
          setModal(null);
          notify('Real-Debrid ligado com sucesso.');
          return;
        }
        if (Date.now() - start > deviceAuth.expires_in * 1000) {
          setDeviceStatus('Este código expirou. Gera um novo código para tentar novamente.');
          setDeviceAuth(null);
          return;
        }
      } catch (error) {
        if (error?.status && error.status !== 400 && error.status !== 403) setDeviceStatus(getError(error));
        else if (!error?.status && error?.message && !error.message.includes('fetch')) setDeviceStatus(getError(error));
      }
      timer = window.setTimeout(poll, Math.max(5, deviceAuth.interval || 5) * 1000);
    };
    timer = window.setTimeout(poll, Math.max(5, deviceAuth.interval || 5) * 1000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [deviceAuth, notify]);

  const connectRealDebrid = async () => {
    setRdError('');
    setRdBusy(true);
    setDeviceStatus('A preparar autorização segura…');
    const authWindow = window.streamnexus?.isDesktop ? null : window.open('about:blank', '_blank');
    try {
      const data = await oauthRequest(`/device/code?client_id=${RD_OPEN_SOURCE_CLIENT_ID}&new_credentials=yes`);
      if (!data.device_code) throw new Error(data.error_description || data.error || 'Não foi possível iniciar a autorização.');
      setDeviceAuth(data);
      setDeviceStatus('À espera de autorização na tua conta…');
      if (window.streamnexus?.isDesktop) {
        await window.streamnexus.openAuthWindow(data.verification_url || 'https://real-debrid.com/device');
      } else if (authWindow) {
        authWindow.opener = null;
        authWindow.location.replace(data.verification_url || 'https://real-debrid.com/device');
      }
    } catch (error) {
      if (authWindow && !authWindow.closed) authWindow.close();
      setDeviceStatus(getError(error));
    }
    finally { setRdBusy(false); }
  };

  const disconnectRealDebrid = async () => {
    await saveSession(null);
    setSession(null);
    setRdUser(null);
    setRdItems([]);
    setRdSearch(null);
    setRdError('');
    setModal(null);
    notify('Sessão Real-Debrid terminada neste dispositivo.');
  };

  const addMagnet = async (event) => {
    event.preventDefault();
    const value = magnet.trim();
    if (!value.startsWith('magnet:?')) { setRdError('Cola um endereço magnet válido.'); return; }
    setMagnetBusy(true);
    setRdError('');
    try {
      await callRd('/torrents/addMagnet', { method: 'POST', body: { magnet: value } });
      setMagnet('');
      await loadRdAccount();
      setModal({ type: 'downloads' });
      notify('Magnet enviado para a tua conta Real-Debrid.');
    } catch (error) { setRdError(getError(error)); }
    finally { setMagnetBusy(false); }
  };

  const selectTorrentFiles = async (id) => {
    try {
      const details = await callRd(`/torrents/info/${encodeURIComponent(id)}`);
      if (!details.files?.length) { notify('Os ficheiros ainda estão a ser preparados. Tenta novamente dentro de instantes.', 'info'); return; }
      await callRd(`/torrents/selectFiles/${encodeURIComponent(id)}`, { method: 'POST', body: { files: 'all' } });
      await loadRdAccount();
      notify('Ficheiros selecionados. O Real-Debrid está a preparar o conteúdo.');
    } catch (error) { setRdError(getError(error)); }
  };

  const findSubtitles = async (title, fileName = '', episode = null) => {
    setSubtitleResults([]);
    setSubtitleError('');
    setSubtitleStatus('loading');
    try {
      if (!window.streamnexus?.isDesktop) throw new Error('As legendas OpenSubtitles estão disponíveis na app desktop.');
      const results = await window.streamnexus.searchSubtitles({
        tmdbId: title?.tmdbId,
        tmdbType: title?.tmdbType,
        query: fileName || title?.original || title?.title || '',
        titleQuery: title?.original || title?.title || '',
        fileName,
        season: episode?.season,
        episode: episode?.episode,
      });
      setSubtitleResults(results);
      setSubtitleStatus(results.length ? 'found' : 'empty');
    } catch (error) {
      setSubtitleError(getError(error));
      setSubtitleStatus('error');
    }
  };

  // Nova reprodução: esquece a legenda, a lista e a pesquisa do título anterior.
  const subtitleSearchKey = useRef('');
  const resetSubtitles = () => {
    subtitleSearchKey.current = '';
    setSubtitleTrackUrl('');
    setSubtitleLabel('');
    setActiveSubId('');
    setSubtitleResults([]);
    setSubtitleError('');
    setSubtitleStatus('idle');
    setDownloadedSubs([]);
    subtitleVtt.current.clear();
    setSubtitleDelay(0);
    setSubtitleInfo(null);
  };

  // Procura as legendas assim que há vídeo, também no "Ver agora" e nos episódios.
  useEffect(() => {
    if (!playing?.url || playing.live || !playing.metadata?.id) return;
    const key = `${playing.metadata.id}|${playing.episode?.season ?? ''}x${playing.episode?.episode ?? ''}`;
    if (subtitleSearchKey.current === key) return;
    subtitleSearchKey.current = key;
    findSubtitles(playing.metadata, playing.fileName, playing.episode);
  }, [playing?.url, playing?.metadata?.id, playing?.episode?.season, playing?.episode?.episode]);

  const activateSubtitle = (entry) => {
    setSubtitleTrackUrl(entry.url);
    setSubtitleLabel(`OpenSubtitles · ${entry.label}`);
    setSubtitleLanguage(entry.language || 'pt-PT');
    setActiveSubId(entry.fileId);
    setActiveEmbeddedTrack(null);
    setEmbeddedSubtitleTracks((tracks) => tracks.map((track) => { track.mode = 'disabled'; return track; }));
    setSubtitleStatus('selected');
  };

  const disableSubtitles = () => {
    Array.from(playerVideoRef.current?.textTracks || []).forEach((track) => { track.mode = 'disabled'; });
    setSubtitleTrackUrl('');
    setActiveSubId('');
    setActiveEmbeddedTrack(null);
    setSubtitleLabel('');
    setSubtitleStatus(subtitleResults.length ? 'found' : 'idle');
  };

  const chooseSubtitle = async (subtitle) => {
    const forFile = playing?.fileName || '';
    setSubtitleError('');
    const cached = downloadedSubs.find((entry) => entry.fileId === subtitle.fileId && entry.forFile === forFile);
    if (cached) { activateSubtitle(cached); return; }
    setSubtitleStatus('downloading');
    try {
      const result = await window.streamnexus.downloadSubtitle({ fileId: subtitle.fileId, fileName: subtitle.fileName, url: subtitle.url });
      let vtt = String(result.text || '').replace(/^﻿/, '').replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').trim();
      if (!vtt.startsWith('WEBVTT')) vtt = `WEBVTT\n\n${vtt}`;
      const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' }));
      subtitleVtt.current.set(url, vtt);
      const wordsOf = (words) => new RegExp(`(?<![\\p{L}])(${words})(?![\\p{L}])`, 'giu');
      const brazilian = (vtt.match(wordsOf('você|vocês|pra|né|cara|tá|gente|legal|beleza|cadê')) || []).length;
      const european = (vtt.match(wordsOf('tu|estás|pá|miúdo|miúda|fixe|rapariga|autocarro|ecrã|telemóvel|gajo|bué')) || []).length;
      const looksBrazilian = brazilian >= 8 && brazilian > european * 3;
      const entry = { fileId: subtitle.fileId, label: looksBrazilian ? 'Português do Brasil (detetado)' : subtitle.label || subtitle.language || 'Legenda', language: subtitle.language || 'pt-PT', fileName: subtitle.fileName || '', release: subtitle.release || '', url, forFile };
      setDownloadedSubs((list) => [...list, entry]);
      activateSubtitle(entry);
    } catch (error) {
      setSubtitleError(getError(error));
      setSubtitleStatus('error');
    }
  };

  const preparePlayerAudio = async (sourceUrl, options = {}) => {
    if (!window.streamnexus?.isDesktop || !sourceUrl) return { url: sourceUrl, sourceUrl };
    const previousId = audioStreamIdRef.current;
    audioStreamIdRef.current = '';
    if (previousId) await window.streamnexus.stopAudioStream(previousId).catch(() => {});
    try {
      const stream = await window.streamnexus.prepareAudioStream(sourceUrl, options);
      audioStreamIdRef.current = stream.id;
      return { ...stream, sourceUrl, piped: !stream.direct };
    } catch (error) {
      if (options.live) throw error;
      return { url: sourceUrl, sourceUrl, audioWarning: getError(error) };
    }
  };

  const openTorrentStream = async (torrent, titleHint = null, chosenLinkIndex = null, ctx = {}) => {
    try {
      let details = await callRd(`/torrents/info/${encodeURIComponent(torrent.id)}`);
      if (details.status === 'waiting_files_selection') {
        await callRd(`/torrents/selectFiles/${encodeURIComponent(torrent.id)}`, { method: 'POST', body: { files: 'all' } });
        details = await callRd(`/torrents/info/${encodeURIComponent(torrent.id)}`);
      }
      let fileName = torrent.filename || details.filename || 'O teu conteúdo';
      const title = titleHint || { title: fileName, original: fileName };
      let streamUrl = '';
      if (details.links?.length) {
        let linkIndex = chosenLinkIndex;
        if (linkIndex == null) {
          const picked = pickPlayableEntry(details, titleHint, ctx.episode);
          if (picked.choose) { setModal({ type: 'files', torrent, titleHint, entries: picked.choose, ctx }); return; }
          linkIndex = picked.entry?.linkIndex ?? 0;
        }
        const chosenLink = details.links[linkIndex] || details.links[0];
        const entryName = getPlayableEntries(details).find((entry) => entry.linkIndex === linkIndex)?.name;
        if (entryName && !/^Ficheiro \d+$/.test(entryName)) fileName = entryName.split('/').pop();
        const data = await callRd('/unrestrict/link', { method: 'POST', body: { link: chosenLink } });
        streamUrl = data.download || chosenLink;
      }
      const playbackStream = streamUrl ? await preparePlayerAudio(streamUrl) : { url: '', sourceUrl: '' };
      setEmbeddedSubtitleTracks([]);
      setActiveEmbeddedTrack(null);
      setPlayerPlaybackError('');
      resetSubtitles();
      setTrailerPlaying(false);
      setPlaying({ title: ctx.episode ? `${title.title} · ${epLabel(ctx.episode.season, ctx.episode.episode)}` : title.title || fileName, ...playbackStream, pending: !streamUrl, progress: Number(details.progress || 0), transferStatus: details.status, torrentId: torrent.id, metadata: title, fileName, episode: ctx.episode || null, resumeAt: ctx.resumeAt || 0 });
      setModal({ type: 'player' });
      if (!streamUrl) notify('A reprodução abriu. Vai começar assim que o Real-Debrid disponibilizar um link de vídeo.', 'info');
    } catch (error) { setRdError(getError(error)); notify(getError(error), 'error'); }
  };

  const selectEmbeddedSubtitle = (track) => {
    const video = playerVideoRef.current;
    if (!video?.textTracks) return;
    Array.from(video.textTracks).forEach((item) => { item.mode = item === track ? 'showing' : 'disabled'; });
    setSubtitleTrackUrl('');
    setActiveEmbeddedTrack(track);
    setSubtitleLabel(track.label || track.language || 'Legendas originais do ficheiro');
    setSubtitleStatus('original');
  };

  const [adultCategory, setAdultCategory] = useState('Todos');
  const [adultOrientation, setAdultOrientation] = useState(() => { try { return localStorage.getItem(pkey('streamnexus.adult.orientation')) || 'straight'; } catch { return 'straight'; } });
  const changeAdultOrientation = (value) => {
    setAdultOrientation(value);
    try { localStorage.setItem(pkey('streamnexus.adult.orientation'), value); } catch { /* preferência só nesta sessão */ }
  };
  const [adultVideos, setAdultVideos] = useState({ status: 'idle', rows: [], message: '' });
  const adultRequestRef = useRef(0);

  const loadAdultVideos = useCallback(async (label, orientation) => {
    if (!window.streamnexus?.isDesktop) {
      setAdultVideos({ status: 'error', rows: [], message: 'Esta secção está disponível na app desktop.' });
      return;
    }
    const requestId = ++adultRequestRef.current;
    setAdultVideos((current) => ({ ...current, status: 'loading', message: '' }));
    try {
      const term = ADULT_CATEGORIES.find((entry) => entry.label === label)?.term || '';
      const rows = await window.streamnexus.fetchAdultVideos(term, orientation);
      if (requestId === adultRequestRef.current) setAdultVideos({ status: 'ready', rows, message: '' });
    } catch (error) {
      if (requestId === adultRequestRef.current) setAdultVideos({ status: 'error', rows: [], message: getError(error) });
    }
  }, []);

  useEffect(() => {
    if (activePage === 'adult' && adultEnabled && adultMode === 'videos') loadAdultVideos('Todos', adultOrientation);
  }, [activePage, adultEnabled, adultMode, adultOrientation, loadAdultVideos]);

  const [tvCountry, setTvCountry] = useState(() => { try { return localStorage.getItem(pkey('streamnexus.tv.country')) || 'PT'; } catch { return 'PT'; } });
  const [liveCountries, setLiveCountries] = useState([]);
  const [liveChannels, setLiveChannels] = useState({ status: 'idle', items: [], categories: [], message: '' });
  const liveRequestRef = useRef(0);
  const [liveHealth, setLiveHealth] = useState({ results: {}, running: false, done: 0, total: 0 });
  const [showOffline, setShowOffline] = useState(false);

  useEffect(() => {
    if (activePage !== 'tv' || tvMode !== 'channels' || liveChannels.status !== 'ready' || !window.streamnexus?.isDesktop) return undefined;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const data = await window.streamnexus.fetchLiveHealth(tvCountry);
        if (cancelled) return;
        setLiveHealth(data);
        if (data.running) timer = window.setTimeout(poll, 3000);
      } catch { /* sem verificação de emissões */ }
    };
    setLiveHealth({ results: {}, running: true, done: 0, total: 0 });
    poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activePage, tvMode, tvCountry, liveChannels.status]);

  const loadLiveChannels = useCallback(async (country) => {
    if (!window.streamnexus?.isDesktop) {
      setLiveChannels({ status: 'error', items: [], categories: [], message: 'Os canais ao vivo estão disponíveis na app desktop.' });
      return;
    }
    const requestId = ++liveRequestRef.current;
    setLiveChannels((current) => ({ ...current, status: 'loading', message: '' }));
    try {
      const [data, countries] = await Promise.all([window.streamnexus.fetchLiveChannels(country), window.streamnexus.fetchLiveCountries()]);
      if (requestId !== liveRequestRef.current) return;
      setLiveCountries(countries);
      setLiveChannels({ status: 'ready', items: data.items, categories: data.categories, message: '' });
    } catch (error) {
      if (requestId === liveRequestRef.current) setLiveChannels({ status: 'error', items: [], categories: [], message: getError(error) });
    }
  }, []);

  useEffect(() => {
    if (activePage === 'tv' && tvMode === 'channels') loadLiveChannels(tvCountry);
  }, [activePage, tvMode, tvCountry, loadLiveChannels]);

  const changeTvCountry = (code) => {
    setTvCountry(code);
    try { localStorage.setItem(pkey('streamnexus.tv.country'), code); } catch { /* preferência só nesta sessão */ }
  };

  const prepareLivePlayback = async (sourceUrl, preferHls = true) => {
    const previousId = audioStreamIdRef.current;
    audioStreamIdRef.current = '';
    if (previousId) await window.streamnexus.stopAudioStream(previousId).catch(() => {});
    if (preferHls && /\.m3u8(\?|$)/i.test(sourceUrl)) {
      try {
        const hlsStream = await window.streamnexus.prepareLiveHls(sourceUrl);
        audioStreamIdRef.current = hlsStream.id;
        return { ...hlsStream, sourceUrl, hls: true, piped: false };
      } catch { /* usa o conversor como alternativa */ }
    }
    const stream = await window.streamnexus.prepareAudioStream(sourceUrl, { live: true });
    audioStreamIdRef.current = stream.id;
    return { ...stream, sourceUrl, hls: false, piped: true };
  };

  const fallbackLiveToPipe = async () => {
    if (!playing?.live || playing.piped) return false;
    try {
      const stream = await prepareLivePlayback(playing.sourceUrl, false);
      setPlayerPlaybackError('');
      setPlaying((current) => (current ? { ...current, ...stream } : current));
      return true;
    } catch { return false; }
  };

  const tryNextLiveStream = () => {
    if (!playing?.live) return false;
    const { channel, index } = playing.live;
    if (index + 1 >= (channel.streams?.length || 0)) return false;
    playLiveChannel(channel, index + 1);
    return true;
  };

  const playLiveChannel = async (channel, streamIndex = 0) => {
    const stream = channel.streams?.[streamIndex];
    if (!stream) { notify('Este canal não tem emissões disponíveis.', 'error'); return; }
    try {
      const playbackStream = await prepareLivePlayback(stream.url);
      setEmbeddedSubtitleTracks([]);
      setActiveEmbeddedTrack(null);
      setPlayerPlaybackError('');
      setSubtitleLabel('');
      setSubtitleTrackUrl('');
      setActiveSubId('');
      setTrailerPlaying(false);
      setPlaying({ title: channel.title, ...playbackStream, pending: false, progress: 100, metadata: channel, fileName: '', live: { channel, index: streamIndex } });
      setModal({ type: 'player' });
    } catch (error) { notify(getError(error), 'error'); }
  };

  const [booksView, setBooksView] = useState('dashboard');
  const [bookSources, setBookSources] = useState({ id: '', status: 'idle', data: null });
  const [musicSources, setMusicSources] = useState({ id: '', status: 'idle', data: null });
  const [mini, setMini] = useState(null);
  const [spotifyNow, setSpotifyNow] = useState('');
  const [lastMusic, setLastMusic] = useState(() => { try { return JSON.parse(localStorage.getItem(pkey('streamnexus.music.last')) || 'null'); } catch { return null; } });
  const saveLastMusic = (entry) => { setLastMusic(entry); try { localStorage.setItem(pkey('streamnexus.music.last'), JSON.stringify(entry)); } catch { /* só nesta sessão */ } };
  const [taste, setTaste] = useState(() => { try { return JSON.parse(localStorage.getItem(pkey('streamnexus.taste')) || '{}') || {}; } catch { return {}; } });
  const changeTaste = (next) => { setTaste(next); try { localStorage.setItem(pkey('streamnexus.taste'), JSON.stringify(next)); } catch { /* só nesta sessão */ } };
  const [musicHistory, setMusicHistory] = useState(() => { try { const list = JSON.parse(localStorage.getItem(pkey('streamnexus.music.history')) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } });
  const recordMusic = (album) => setMusicHistory((current) => {
    const entry = { id: album.id, title: album.title, creator: album.creator || '', poster: album.poster || '', genre: album.genre || '', at: Date.now() };
    const next = [entry, ...current.filter((item) => item.id !== album.id)].slice(0, 40);
    try { localStorage.setItem(pkey('streamnexus.music.history'), JSON.stringify(next)); } catch { /* só nesta sessão */ }
    return next;
  });
  const playTracks = (queue, index, album) => { recordMusic(album); setMini({ mode: 'tracks', key: `${album.id}-${Date.now()}`, tracks: queue, index, title: album.title, cover: album.poster, startAt: 0, albumMeta: { id: album.id, title: album.title, creator: album.creator || '', poster: album.poster || '', genre: album.genre || '' } }); };
  const listenOnSpotify = async (album, options = {}) => {
    try {
      await window.streamnexus.spotifyConnectCommand({ action: 'play', uri: options.albumUri || album.spotifyUri || '', trackUri: options.trackUri || '', shuffle: options.shuffle, repeat: options.repeat, artist: (album.creator || '').split(',')[0], album: String(album.title || '').replace(/\s*[(\[].*$/, '') });
      recordMusic(album);
      saveLastMusic({ mode: 'spotify', album: { id: album.id, title: album.title, creator: album.creator || '', poster: album.poster || '', genre: album.genre || '' }, uri: options.albumUri || album.spotifyUri || '', trackUri: options.trackUri || '', at: Date.now() });
      setMini({ mode: 'spotify', key: `${album.id}-${Date.now()}`, title: album.title, cover: album.poster });
    } catch (error) { notify(getError(error), 'error'); }
  };
  const rememberMusic = (index, position) => {
    if (mini?.abs) {
      if (!(position > 0)) return; // ainda não arrancou: não apagar o progresso guardado no servidor
      const now = Date.now();
      const listened = Math.max(0, Math.round((now - mini.abs.lastSync) / 1000));
      mini.abs.lastSync = now;
      window.streamnexus?.absSync?.({ sessionId: mini.abs.sessionId, currentTime: (mini.abs.offsets[index] || 0) + position, timeListened: Math.min(listened, 30), duration: mini.abs.duration }).catch(() => {});
      return;
    }
    if (!mini || mini.mode !== 'tracks' || !mini.albumMeta || !mini.tracks?.length) return;
    saveLastMusic({ mode: 'tracks', album: mini.albumMeta, tracks: mini.tracks.map(({ title, url, duration, source }) => ({ title, url, duration, source })), index, position: Math.floor(position), at: Date.now() });
  };
  const resumeMusic = () => {
    if (!lastMusic) return;
    if (lastMusic.mode === 'tracks') { recordMusic(lastMusic.album); setMini({ mode: 'tracks', key: `${lastMusic.album.id}-${Date.now()}`, tracks: lastMusic.tracks, index: lastMusic.index, title: lastMusic.album.title, cover: lastMusic.album.poster, albumMeta: lastMusic.album, startAt: lastMusic.position || 0 }); }
    else listenOnSpotify(lastMusic.album, { albumUri: lastMusic.uri, trackUri: lastMusic.trackUri });
  };
  const [booksMode, setBooksMode] = useState(() => { try { return localStorage.getItem(pkey('streamnexus.books.mode')) === 'audio' ? 'audio' : 'ebooks'; } catch { return 'ebooks'; } });
  const changeBooksMode = (mode) => { setBooksMode(mode); try { localStorage.setItem(pkey('streamnexus.books.mode'), mode); } catch { /* só nesta sessão */ } };
  const [absLoading, setAbsLoading] = useState('');
  const playAudiobook = async (item) => {
    setAbsLoading(item.id);
    try {
      const book = await window.streamnexus.absPlay({ itemId: item.id });
      setMini({ mode: 'tracks', key: `abs-${item.id}-${Date.now()}`, tracks: book.tracks.map(({ title, url, duration }) => ({ title, url, duration })), index: book.index, title: book.title, cover: book.poster, startAt: book.startAt, abs: { sessionId: book.sessionId, itemId: book.itemId, duration: book.duration, offsets: book.tracks.map((track) => track.startOffset), lastSync: Date.now() } });
    } catch (error) { notify(getError(error), 'error'); }
    finally { setAbsLoading(''); }
  };
  const openIntegrations = () => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); };
  const showDiscover = activePage !== 'books' || (booksMode === 'ebooks' && booksView === 'discover');
  const [reading, setReading] = useState(loadReading);
  const persistReading = (next) => {
    setReading(next);
    try { localStorage.setItem(pkey(READING_KEY), JSON.stringify(next)); } catch { /* a estante fica só nesta sessão */ }
  };
  const updateBook = (book, patch) => {
    const entry = { addedAt: Date.now(), progress: 0, ...reading.shelf[book.id], ...patch, book };
    const today = dayKey();
    const days = entry.status !== 'want' && !reading.days.includes(today) ? [...reading.days, today] : reading.days;
    persistReading({ ...reading, days, shelf: { ...reading.shelf, [book.id]: entry } });
  };
  const setBookStatus = (book, status) => {
    const previous = reading.shelf[book.id];
    if (status === 'want') updateBook(book, { status, progress: 0, finishedAt: undefined });
    else if (status === 'reading') updateBook(book, { status, progress: previous?.status === 'read' ? 0 : previous?.progress || 0, finishedAt: undefined });
    else updateBook(book, { status, progress: 100, finishedAt: Date.now() });
  };
  const setBookProgress = (book, progress) => {
    if (progress >= 100) setBookStatus(book, 'read');
    else updateBook(book, { status: 'reading', progress, finishedAt: undefined });
  };
  const removeBookFromShelf = (id) => {
    const shelf = { ...reading.shelf }; delete shelf[id];
    persistReading({ ...reading, shelf });
    notify('Livro removido da estante.');
  };
  const setReadingGoal = (goal) => persistReading({ ...reading, goal });

  const [savedItems, setSavedItems] = useState(() => { try { return JSON.parse(localStorage.getItem(pkey('streamnexus.watchlist.items'))) || {}; } catch { return {}; } });
  const toggleSaved = (id, item) => {
    const adding = !saved.includes(id);
    const next = adding ? [...saved, id] : saved.filter((entry) => entry !== id);
    setSaved(next);
    localStorage.setItem(pkey('streamnexus.watchlist'), JSON.stringify(next));
    if (item) {
      setSavedItems((current) => {
        const copy = { ...current };
        if (adding) copy[id] = item; else delete copy[id];
        try { localStorage.setItem(pkey('streamnexus.watchlist.items'), JSON.stringify(copy)); } catch { /* cópia só nesta sessão */ }
        return copy;
      });
    }
    notify(saved.includes(id) ? 'Removido da tua lista.' : 'Adicionado à tua lista.');
  };

  const searchResults = useMemo(() => {
    let result = activePage === 'watchlist' ? [...new Map([...catalogTitles, ...discoveryLookup, ...Object.values(savedItems)].map((item) => [item.id, item])).values()] : catalogTitles;
    if (activePage === 'films') result = result.filter((item) => item.type === 'Filme');
    if (activePage === 'series') result = result.filter((item) => item.type === 'Série');
    if (activePage === 'watchlist') result = result.filter((item) => saved.includes(item.id));
    if (query.trim()) {
      const search = normalizeSearchText(query);
      result = result.filter((item) => normalizeSearchText(`${item.title} ${item.original} ${(item.aliases || []).join(' ')} ${item.genre} ${item.type}`).includes(search));
    }
    if (genre !== 'Todos') result = result.filter((item) => item.genre === genre || item.genres?.includes(genre));
    return result;
  }, [activePage, catalogTitles, discoveryLookup, savedItems, genre, query, saved]);

  useEffect(() => { setVisibleCount(24); }, [activePage, genre, query]);

  useEffect(() => {
    if (!adultEnabled && searchCategory === 'adult') {
      setSearchCategory('movies');
      setReleaseSearch(null);
    }
  }, [adultEnabled, searchCategory]);

  const toggleAdultSearch = (enabled) => {
    setAdultEnabled(enabled);
    try { localStorage.setItem(pkey('streamnexus.settings.adult'), String(enabled)); } catch { /* preference remains for this session */ }
    if (!enabled && searchCategory === 'adult') {
      setSearchCategory('movies');
      setReleaseSearch(null);
    }
    if (!enabled && activePage === 'adult') { setActivePage('home'); setQuery(''); }
  };

  const selectedTitle = catalogTitles.find((item) => item.id === modal?.id) || discoveryLookup.find((item) => item.id === modal?.id) || Object.values(reading.shelf).map((entry) => entry.book).find((item) => item.id === modal?.id) || savedItems[modal?.id] || (modal?.item && modal.item.id === modal.id ? modal.item : undefined);
  useEffect(() => {
    if (modal?.type !== 'details' || selectedTitle?.type !== 'Livro' || !window.streamnexus?.isDesktop) return undefined;
    const book = selectedTitle;
    setBookSources({ id: book.id, status: 'loading', data: null });
    let cancelled = false;
    window.streamnexus.fetchBookSources({ key: book.workKey || book.id.replace(/^book-/, ''), title: book.title, author: (book.creator || '').split(',')[0] })
      .then((data) => { if (!cancelled) setBookSources({ id: book.id, status: 'ready', data }); })
      .catch(() => { if (!cancelled) setBookSources({ id: book.id, status: 'error', data: null }); });
    return () => { cancelled = true; };
  }, [modal?.type, modal?.id]);
  useEffect(() => {
    if (modal?.type !== 'details' || selectedTitle?.type !== 'Álbum' || !window.streamnexus?.isDesktop) return undefined;
    const album = selectedTitle;
    setMusicSources({ id: album.id, status: 'loading', data: null });
    let cancelled = false;
    window.streamnexus.fetchFreeMusic({ artist: (album.creator || '').split(',')[0], album: String(album.title || '').replace(/\s*[(\[].*$/, '') })
      .then((data) => { if (!cancelled) setMusicSources({ id: album.id, status: 'ready', data }); })
      .catch(() => { if (!cancelled) setMusicSources({ id: album.id, status: 'error', data: null }); });
    return () => { cancelled = true; };
  }, [modal?.type, modal?.id]);

  const pageTitle = ({ history: 'Vistos e a continuar', home: 'Início', films: 'Filmes', series: 'Séries', tv: 'TV', music: 'Música', books: 'Livros', adult: 'Adultos', indexers: 'Pesquisar', watchlist: 'A minha lista', downloads: 'Real-Debrid' })[activePage] || 'Descobrir';
  const browseCategoryKey = PAGE_SEARCH_CATEGORY[activePage] || activePage;
  const genreTitles = discoveryPage ? discoveryItems : activePage === 'films' ? catalogTitles.filter((item) => item.type === 'Filme') : catalogTitles.filter((item) => item.type === 'Série');
  const browseGenres = [...new Set([...(STATIC_GENRES[activePage] || []), ...genreTitles.flatMap((item) => item.genres?.length ? item.genres : [item.genre]).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt-PT'));
  const readyTorrents = rdItems.filter((item) => item.status === 'downloaded');
  useEffect(() => { if (activePage === 'home' && session?.access_token && !rdUser) loadRdAccount(); }, [activePage, session?.access_token]);
  const browsingShelves = discoveryPage
    ? makeDistinctShelves(discoveryShelves.map((row) => ({ ...row, page: activePage })), [featuredTitle.id])
    : activePage === 'films'
    ? makeDistinctShelves([
      { eyebrow: 'EM ALTA', title: 'Filmes populares', items: catalogRows?.trending?.filter((item) => item.type === 'Filme')?.length ? catalogRows.trending.filter((item) => item.type === 'Filme') : catalogRows?.popularMovies?.length ? catalogRows.popularMovies : catalogTitles.filter((item) => item.type === 'Filme'), page: 'films' },
        { eyebrow: 'TENDÊNCIAS', title: 'Populares no StreamNexus', items: catalogRows?.popularMovies?.length ? catalogRows.popularMovies : catalogTitles.filter((item) => item.type === 'Filme').slice().reverse(), page: 'films' },
      { eyebrow: 'NO CINEMA E EM CASA', title: 'Estreias recentes', items: catalogRows?.nowPlaying?.length ? catalogRows.nowPlaying : catalogTitles.filter((item) => item.type === 'Filme'), page: 'films' },
      { eyebrow: 'ESCOLHIDOS PARA TI', title: 'Mais bem avaliados', items: catalogRows?.topMovies?.length ? catalogRows.topMovies : [...catalogTitles].filter((item) => item.type === 'Filme').sort((a, b) => Number(b.rating) - Number(a.rating)), page: 'films', ranked: true },
    ], [featuredTitle.id])
    : activePage === 'series'
      ? makeDistinctShelves([
        { eyebrow: 'EM ALTA', title: 'Séries populares', items: catalogRows?.trending?.filter((item) => item.type === 'Série')?.length ? catalogRows.trending.filter((item) => item.type === 'Série') : catalogRows?.popularSeries?.length ? catalogRows.popularSeries : catalogTitles.filter((item) => item.type === 'Série'), page: 'series' },
        { eyebrow: 'TENDÊNCIAS', title: 'Séries populares no StreamNexus', items: catalogRows?.popularSeries?.length ? catalogRows.popularSeries : catalogTitles.filter((item) => item.type === 'Série').slice().reverse(), page: 'series' },
        { eyebrow: 'NOVOS EPISÓDIOS', title: 'Séries a acompanhar', items: catalogRows?.airingSeries?.length ? catalogRows.airingSeries : catalogTitles.filter((item) => item.type === 'Série'), page: 'series' },
        { eyebrow: 'ESCOLHIDOS PARA TI', title: 'Mais bem avaliadas', items: catalogRows?.topSeries?.length ? catalogRows.topSeries : [...catalogTitles].filter((item) => item.type === 'Série').sort((a, b) => Number(b.rating) - Number(a.rating)), page: 'series', ranked: true },
      ], [featuredTitle.id])
      : makeDistinctShelves([
        { eyebrow: 'A TENDÊNCIA DA SEMANA', title: 'Em alta agora', items: catalogRows?.trending?.length ? catalogRows.trending : [...catalogTitles].sort((a, b) => Number(b.rating) - Number(a.rating)), page: 'films' },
        { eyebrow: 'FILMES MAIS VISTOS', title: 'Populares no StreamNexus', items: catalogRows?.popularMovies?.length ? catalogRows.popularMovies : catalogTitles.filter((item) => item.type === 'Filme').slice().reverse(), page: 'films' },
        { eyebrow: 'ESTREIAS RECENTES', title: 'Filmes para descobrir', items: catalogRows?.nowPlaying?.length ? catalogRows.nowPlaying : catalogTitles.filter((item) => item.type === 'Filme'), page: 'films' },
        { eyebrow: 'SÉRIES MAIS VISTAS', title: 'Séries populares', items: catalogRows?.popularSeries?.length ? catalogRows.popularSeries : catalogTitles.filter((item) => item.type === 'Série').slice().reverse(), page: 'series' },
        { eyebrow: 'NOVOS EPISÓDIOS', title: 'Séries em destaque', items: catalogRows?.airingSeries?.length ? catalogRows.airingSeries : catalogTitles.filter((item) => item.type === 'Série'), page: 'series' },
        { eyebrow: 'MAIS BEM AVALIADOS', title: 'Favoritos do público', items: [...(catalogRows?.topMovies || []), ...(catalogRows?.topSeries || [])].length ? [...(catalogRows?.topMovies || []), ...(catalogRows?.topSeries || [])] : [...catalogTitles].sort((a, b) => Number(b.rating) - Number(a.rating)), page: 'films', ranked: true },
      ], [featuredTitle.id]);

  const feedKind = FEED_KINDS[activePage] || '';
  const hasTmdbKey = Boolean(integrationSettings.tmdbApiKey);
  const searchKind = !query.trim() || !window.streamnexus?.isDesktop ? '' : ({
    home: hasTmdbKey ? 'home' : '', films: hasTmdbKey ? 'films' : '', series: hasTmdbKey ? 'series' : '',
    tv: tvMode === 'shows' && hasTmdbKey ? 'tv' : '', music: 'music', books: 'books',
    adult: adultEnabled ? (adultMode === 'videos' ? 'adultvideos' : hasTmdbKey ? 'adult' : '') : '',
  })[activePage] || '';
  const searchPlaceholder = ({ home: 'Pesquisar filmes e séries', films: 'Pesquisar filmes', series: 'Pesquisar séries', tv: tvMode === 'channels' ? 'Pesquisar canais' : 'Pesquisar programas', music: 'Pesquisar álbuns e artistas', books: 'Pesquisar livros e autores', adult: adultMode === 'videos' ? 'Pesquisar vídeos' : 'Pesquisar cinema para adultos', watchlist: 'Pesquisar na minha lista' })[activePage] || 'Pesquisar títulos';
  const pagedShelves = browsingShelves.map((shelf) => { const feedId = FEED_SHELF_IDS[activePage]?.[shelf.title]; return feedId ? { ...shelf, feedId, cursor: 2, hasMore: true } : shelf; });
  const visibleBrowsingShelves = genre === 'Todos' ? browsingShelves : makeDistinctShelves(
    browsingShelves.map((shelf) => ({ ...shelf, items: shelf.items.filter((item) => item.genre === genre || item.genres?.includes(genre)) })),
  []);

  const searchTitleInLibrary = async (title) => {
    if (!session?.access_token) {
      setRdSearch({ titleId: title.id, status: 'disconnected', matches: [] });
      return;
    }
    setRdSearch({ titleId: title.id, status: 'loading', matches: [] });
    try {
      const torrents = await callRd('/torrents?limit=5000');
      const library = Array.isArray(torrents) ? torrents : [];
      setRdItems(library);
      const matches = library.filter((torrent) => matchesTorrentTitle(torrent, title)).sort((a, b) => Number(b.status === 'downloaded') - Number(a.status === 'downloaded'));
      setRdSearch({ titleId: title.id, status: matches.length ? 'found' : 'empty', matches });
    } catch (error) {
      setRdSearch({ titleId: title.id, status: 'error', matches: [], message: getError(error) });
    }
  };

  const searchReleaseSources = async (queryText, categoryKey, titleId = null, collectionTitle = '') => {
    const category = SEARCH_CATEGORIES[categoryKey] || SEARCH_CATEGORIES.movies;
    const queryValue = String(queryText || '').trim();
    if (!queryValue) return;
    const requestId = ++releaseRequestRef.current;
    if (!integrationSettings.prowlarrUrl || !integrationSettings.prowlarrApiKey) {
      setReleaseSearch({ titleId, categoryKey, collectionTitle, query: queryValue, status: 'error', items: [], message: 'Configura o endereço e a API key do Prowlarr nas definições para pesquisar.' });
      return;
    }
    setReleaseSearch({ titleId, categoryKey, collectionTitle, query: queryValue, status: 'loading', items: [] });
    try {
      let items;
      if (window.streamnexus?.isDesktop) {
        items = await window.streamnexus.searchReleases({ query: queryValue, type: category.type, categories: [category.category] });
      } else {
        const url = new URL(`${integrationSettings.prowlarrUrl.replace(/\/+$/, '')}/api/v1/search`);
        url.searchParams.set('query', queryValue); url.searchParams.set('type', category.type); url.searchParams.append('categories', category.category);
        const response = await fetch(url, { headers: { 'X-Api-Key': integrationSettings.prowlarrApiKey } });
        if (!response.ok) throw new Error(`Prowlarr respondeu com erro ${response.status}.`);
        items = (await response.json()).map((release) => ({ ...release, id: release.guid || release.downloadUrl || release.title, canGrab: Boolean(release.magnetUrl || release.downloadUrl), hasMagnet: Boolean(release.magnetUrl) }));
      }
      if (requestId !== releaseRequestRef.current) return;
      setReleaseSearch({ titleId, categoryKey, collectionTitle, query: queryValue, status: items.length ? 'found' : 'empty', items });
    } catch (error) {
      if (requestId !== releaseRequestRef.current) return;
      setReleaseSearch({ titleId, categoryKey, collectionTitle, query: queryValue, status: 'error', items: [], message: getError(error) });
    }
  };

  const saveIntegrationSettings = async (event) => {
    event.preventDefault();
    setIntegrationTest('A guardar configuração…');
    try {
      const next = {
        ...integrationForm,
        prowlarrUrl: integrationForm.prowlarrUrl.trim().replace(/\/+$/, ''),
        prowlarrApiKey: integrationForm.prowlarrApiKey.trim(),
        shelfarrUrl: (integrationForm.shelfarrUrl || '').trim().replace(/\/+$/, ''),
        shelfarrToken: (integrationForm.shelfarrToken || '').trim(),
        audiobookshelfUrl: (integrationForm.audiobookshelfUrl || '').trim().replace(/\/+$/, ''),
        audiobookshelfToken: (integrationForm.audiobookshelfToken || '').trim(),
        tmdbApiKey: integrationForm.tmdbApiKey.trim(),
        spotifyClientId: (integrationForm.spotifyClientId || '').trim(),
        spotifyClientSecret: (integrationForm.spotifyClientSecret || '').trim(),
        openSubtitlesApiKey: integrationForm.openSubtitlesApiKey.trim(),
        openSubtitlesUsername: integrationForm.openSubtitlesUsername.trim(),
      };
      if (window.streamnexus?.isDesktop) await window.streamnexus.saveIntegrations(next);
      else sessionStorage.setItem('streamnexus.integrations', JSON.stringify(next));
      setIntegrationSettings(next);
      setIntegrationForm(next);
      setIntegrationTest('Configuração guardada.', 'success');
      notify('Integrações guardadas.');
    } catch (error) { setIntegrationTest(getError(error), 'error'); }
  };

  const testProwlarr = async () => {
    setSectionTest('prowlarr')('A testar ligação…');
    try {
      const base = integrationForm.prowlarrUrl.trim().replace(/\/+$/, '');
      if (!base || !integrationForm.prowlarrApiKey.trim()) throw new Error('Preenche o endereço e a API key.');
      if (window.streamnexus?.isDesktop) {
        await window.streamnexus.testProwlarr({ prowlarrUrl: base, prowlarrApiKey: integrationForm.prowlarrApiKey.trim() });
      } else {
        const response = await fetch(`${base}/api/v1/system/status`, { headers: { 'X-Api-Key': integrationForm.prowlarrApiKey.trim() } });
        if (!response.ok) throw new Error(`Prowlarr respondeu com erro ${response.status}.`);
      }
      setSectionTest('prowlarr')('Ligação concluída. Prowlarr está acessível.', 'success');
    } catch (error) { setSectionTest('prowlarr')(getError(error), 'error'); }
  };

  const testShelfarr = async () => {
    setSectionTest('shelfarr')('A testar Shelfarr…');
    try {
      if (!window.streamnexus?.isDesktop) throw new Error('O teste do Shelfarr só funciona na app desktop.');
      await window.streamnexus.testShelfarr({ shelfarrUrl: (integrationForm.shelfarrUrl || '').trim(), shelfarrToken: (integrationForm.shelfarrToken || '').trim() });
      setSectionTest('shelfarr')('Ligação concluída. O Shelfarr aceitou o token.', 'success');
    } catch (error) { setSectionTest('shelfarr')(getError(error), 'error'); }
  };

  const testAudiobookshelf = async () => {
    setSectionTest('audiobookshelf')('A testar Audiobookshelf…');
    try {
      if (!window.streamnexus?.isDesktop) throw new Error('O teste do Audiobookshelf só funciona na app desktop.');
      const result = await window.streamnexus.testAudiobookshelf({ audiobookshelfUrl: (integrationForm.audiobookshelfUrl || '').trim(), audiobookshelfToken: (integrationForm.audiobookshelfToken || '').trim() });
      setSectionTest('audiobookshelf')(result.libraries ? `Ligação concluída. ${result.libraries} biblioteca(s) de audiolivros: ${result.names.join(', ')}.` : 'Ligação concluída, mas não há bibliotecas de livros no servidor.', result.libraries ? 'success' : 'error');
    } catch (error) { setSectionTest('audiobookshelf')(getError(error), 'error'); }
  };

  const testTmdb = async () => {
    setSectionTest('tmdb')('A testar TMDB…');
    try {
      if (!integrationForm.tmdbApiKey.trim()) throw new Error('Preenche a API key do TMDB.');
      if (!window.streamnexus?.isDesktop) throw new Error('Testa esta ligação na app desktop.');
      await window.streamnexus.testTmdb({ tmdbApiKey: integrationForm.tmdbApiKey.trim() });
      setSectionTest('tmdb')('TMDB ligado. O catálogo será atualizado ao guardar.', 'success');
    } catch (error) { setSectionTest('tmdb')(getError(error), 'error'); }
  };

  const testSpotify = async () => {
    setSectionTest('spotify')('A testar Spotify…');
    try {
      const credentials = { spotifyClientId: (integrationForm.spotifyClientId || '').trim(), spotifyClientSecret: (integrationForm.spotifyClientSecret || '').trim() };
      if (!credentials.spotifyClientId || !credentials.spotifyClientSecret) throw new Error('Preenche o Client ID e o Client Secret do Spotify.');
      if (!window.streamnexus?.isDesktop) throw new Error('Testa esta ligação na app desktop.');
      await window.streamnexus.testSpotify(credentials);
      setSectionTest('spotify')('Spotify ligado. A aba Música passa a usar o catálogo do Spotify.', 'success');
    } catch (error) { setSectionTest('spotify')(getError(error), 'error'); }
  };

  const testOpenSubtitles = async () => {
    setSectionTest('opensubtitles')('A testar OpenSubtitles…');
    try {
      const credentials = {
        openSubtitlesApiKey: integrationForm.openSubtitlesApiKey.trim(),
        openSubtitlesUsername: integrationForm.openSubtitlesUsername.trim(),
        openSubtitlesPassword: integrationForm.openSubtitlesPassword,
      };
      if (Object.values(credentials).some((value) => !value)) throw new Error('Preenche a API key, o utilizador e a palavra-passe do OpenSubtitles.');
      if (!window.streamnexus?.isDesktop) throw new Error('Testa esta ligação na app desktop.');
      await window.streamnexus.testOpenSubtitles(credentials);
      setSectionTest('opensubtitles')('OpenSubtitles ligado. As legendas PT-PT aparecem primeiro no leitor.', 'success');
    } catch (error) { setSectionTest('opensubtitles')(getError(error), 'error'); }
  };

  const grabRelease = async (release) => {
    if (!session?.access_token) { setModal({ type: 'connect' }); return; }
    setReleaseBusyId(release.id);
    try {
      const active = await refreshSession(session);
      if (window.streamnexus?.isDesktop) {
        await window.streamnexus.addReleaseToRealDebrid({ releaseId: release.id, token: active.access_token });
      } else if (release.magnetUrl?.startsWith('magnet:?')) {
        await callRd('/torrents/addMagnet', { method: 'POST', body: { magnet: release.magnetUrl } });
      } else {
        throw new Error('Para adicionar links de indexadores diretamente, abre a app desktop StreamNexus.');
      }
      notify('Lançamento enviado para a tua conta Real-Debrid.');
      if (modal?.type === 'details') await searchTitleInLibrary([...catalogTitles, ...discoveryLookup].find((item) => item.id === modal.id));
      else await loadRdAccount();
    } catch (error) { notify(getError(error), 'error'); }
    finally { setReleaseBusyId(''); }
  };

  const openDetails = (title) => {
    setModal({ type: 'details', id: title.id, item: title });
    setTrailer({ status: 'loading', key: '', name: '' });
    setTrailerPlaying(false);
    const requestId = ++trailerRequestRef.current;
    if (!window.streamnexus?.isDesktop || !integrationSettings.tmdbApiKey || !isVideoTitle(title)) {
      setTrailer({ status: 'unavailable', key: '', name: '' });
    } else {
      window.streamnexus.fetchTrailer({ id: title.tmdbId, type: title.tmdbType || (title.type === 'Série' ? 'tv' : 'movie'), title: title.original || title.title, year: title.year })
        .then((result) => {
          if (requestId === trailerRequestRef.current) setTrailer(result?.key ? { status: 'ready', key: result.key, name: result.name || 'Trailer' } : { status: 'empty', key: '', name: '' });
        })
        .catch(() => { if (requestId === trailerRequestRef.current) setTrailer({ status: 'error', key: '', name: '' }); });
    }
    searchTitleInLibrary(title);
    searchReleaseSources(title.searchQuery || title.original || title.title, titleCategory(title), title.id);
  };
  const autoPlayRef = useRef(0);
  // "Ver agora": se já está na biblioteca, abre; senão escolhe sozinho o melhor lançamento, envia-o para o
  // Real-Debrid e abre o leitor, que começa assim que o ficheiro estiver pronto (logo, se estiver em cache).
  const autoPlayBest = async (title, ctx = {}) => {
    const runId = ++autoPlayRef.current;
    const mine = (current) => current && current.runId === runId;
    setEmbeddedSubtitleTracks([]);
    setActiveEmbeddedTrack(null);
    setPlayerPlaybackError('');
    resetSubtitles();
    setTrailerPlaying(false);
    setPlaying({ title: ctx.episode ? `${title.title} · ${epLabel(ctx.episode.season, ctx.episode.episode)}` : title.title, url: '', pending: true, phase: 'searching', progress: 0, metadata: title, fileName: title.title, torrentId: '', runId, episode: ctx.episode || null, resumeAt: ctx.resumeAt || 0 });
    setModal({ type: 'player' });
    let triedCount = 0;
    try {
      const category = SEARCH_CATEGORIES[titleCategory(title)] || SEARCH_CATEGORIES.movies;
      const prowlarrReady = Boolean(integrationSettings.prowlarrUrl && integrationSettings.prowlarrApiKey);
      const epTag = ctx.episode ? ` S${String(ctx.episode.season).padStart(2, '0')}E${String(ctx.episode.episode).padStart(2, '0')}` : '';
      const reuse = !ctx.episode && releaseSearch?.titleId === title.id && releaseSearch.status === 'found' ? releaseSearch.items : null;
      const [fromTorrentio, fromProwlarr] = await Promise.all([
        title.tmdbId ? window.streamnexus.searchTorrentio({ tmdbId: title.tmdbId, tmdbType: title.tmdbType || (title.type === 'Série' ? 'tv' : 'movie'), season: ctx.episode?.season || 1, episode: ctx.episode?.episode || 1 }).catch(() => []) : [],
        reuse || (prowlarrReady ? window.streamnexus.searchReleases({ query: `${title.searchQuery || title.original || title.title}${epTag}`, type: category.type, categories: [category.category] }).catch(() => []) : []),
      ]);
      const items = [...fromTorrentio, ...fromProwlarr];
      const ranked = items.filter((release) => release.canGrab).map((release) => ({ release, score: scoreRelease(release, title, ctx.episode) })).sort((a, b) => b.score - a.score);
      const good = ranked.filter((entry) => entry.score > -150);
      const candidates = (good.length ? good : ranked).slice(0, 8).map((entry) => entry.release);
      triedCount = candidates.length;
      if (!candidates.length) throw new Error('Não encontrei nenhum lançamento utilizável para este título. Confirma o TMDB e o Prowlarr nas Integrações.');
      setPlaying((current) => (mine(current) ? { ...current, phase: 'adding', releaseTitle: candidates[0].title } : current));
      const active = await refreshSession(session);
      let added = null;
      let index = 0;
      let lastError = null;
      for (; index < candidates.length && !added; index += 1) {
        try { added = await window.streamnexus.addReleaseToRealDebrid({ releaseId: candidates[index].id, token: active.access_token }); }
        catch (error) {
          lastError = error;
          if (index + 1 < candidates.length) {
            setPlaying((current) => (mine(current) ? { ...current, phase: 'adding', releaseTitle: candidates[index + 1].title, attempt: index + 2, attemptTotal: candidates.length } : current));
            await sleep(3000);
            if (autoPlayRef.current !== runId) return;
          }
        }
      }
      if (!added) throw lastError || new Error('O Real-Debrid recusou todas as versões.');
      index -= 1;
      setPlaying((current) => (mine(current) ? { ...current, phase: 'preparing', torrentId: added.id, candidates, candidateIndex: index, startedAt: Date.now(), fileName: candidates[index].title, releaseTitle: candidates[index].title, transferStatus: 'magnet_conversion' } : current));
    } catch (error) {
      setPlaying((current) => (mine(current) ? { ...current, pending: false, error: friendlyRdError(getError(error), triedCount) } : current));
    }
  };

  // Rótulo do botão principal: continuar de onde ficou
  const playLabelFor = (title) => {
    const info = watchInfo(watch, title);
    if (title.type === 'Série') {
      const point = resumePointFor(watch[title.id]);
      if (!point) return 'Ver agora';
      return point.watched ? `Seguinte a ${epLabel(point.season, point.episode)}` : `Continuar ${epLabel(point.season, point.episode)}${point.position > 30 ? ` · ${formatClock(point.position)}` : ''}`;
    }
    if (info?.inProgress) return `Continuar · ${formatClock(watch[title.id].position)}`;
    return info?.watched ? 'Ver outra vez' : 'Ver agora';
  };

  const startPlayback = async (title, ctx = {}) => {
    if (!session?.access_token) { setModal({ type: 'connect' }); return; }
    let context = ctx;
    if (title.type === 'Série' && !ctx.episode) {
      const point = resumePointFor(watch[title.id]);
      if (point && !point.watched) context = { episode: { season: point.season, episode: point.episode }, resumeAt: point.position };
      else if (point) {
        const next = await nextEpisodeAfter(title, point.season, point.episode);
        context = { episode: next || { season: point.season, episode: point.episode }, resumeAt: 0 };
      } else context = { episode: { season: 1, episode: 1 }, resumeAt: 0 };
    } else if (title.type === 'Filme' && ctx.resumeAt === undefined) {
      const record = watch[title.id];
      context = { resumeAt: record && !record.watched && record.position > 60 ? record.position : 0 };
    }
    if (title.type === 'Série' && context.episode) {
      const match = rdSearch?.titleId === title.id ? rdSearch.matches?.find((torrent) => torrentMayHaveEpisode(torrent, context.episode.season, context.episode.episode)) : null;
      if (match) { openTorrentStream(match, title, null, context); return; }
    } else if (rdSearch?.titleId === title.id && rdSearch.matches?.length) { openTorrentStream(rdSearch.matches[0], title, null, context); return; }
    if (window.streamnexus?.isDesktop && isVideoTitle(title) && ((integrationSettings.prowlarrUrl && integrationSettings.prowlarrApiKey) || (integrationSettings.tmdbApiKey && title.tmdbId))) { autoPlayBest(title, context); return; }
    setMagnet('');
    setModal({ type: 'magnet', title });
  };

  return (
    <WatchContext.Provider value={watchLookup}>
    <PreviewContext.Provider value={previewResolver}>
    <div className={`app-shell ${mini ? 'has-mini' : ''}`}>
      <aside className="sidebar">
        <a className="brand" href="#top" onClick={(event) => { event.preventDefault(); setActivePage('home'); }} aria-label="StreamNexus, início">
          <span className="brand-mark"><span></span><span></span></span>
          <span className="brand-word">stream<BrandFlow/><span>nexus</span><small>O teu próximo favorito</small></span>
        </a>

        <form className="sidebar-search" role="search" onSubmit={(event) => event.preventDefault()}>
          <Icon name="search" size={15}/>
          <input type="search" aria-label="Pesquisar neste separador" placeholder={searchPlaceholder} value={query} onChange={(event) => { setQuery(event.target.value); if (!['home', 'films', 'series', 'tv', 'music', 'books', 'adult', 'watchlist'].includes(activePage)) setActivePage('home'); setProfileMenuOpen(false); }}/>
        </form>
        <div className="side-section">
          <nav className="side-nav" aria-label="Navegação principal">
            {nav.filter((item) => (!kids || !['adult', 'tv', 'indexers'].includes(item.id)) && (item.id !== 'adult' || adultEnabled)).map((item) => <button key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => { setActivePage(item.id); setQuery(''); setGenre('Todos'); setProfileMenuOpen(false); if (item.id === 'indexers') { setSearchCategory('movies'); setReleaseSearch(null); } }}><Icon name={item.icon} size={18}/><span>{item.label}</span></button>)}
          </nav>
        </div>
        <div className="profile-menu-wrap header-profile" ref={profileMenuRef}>
          <button className={`profile-trigger ${profileMenuOpen ? 'is-open' : ''}`} aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}>
            <ProfileAvatar profile={profile} size={28}/>
            <span className="profile-trigger-name">{profile.name}</span><Icon name="chevron" size={14}/>
          </button>
          {profileMenuOpen && <div className="profile-menu" role="menu">
            <div className="profile-menu-identity"><ProfileAvatar profile={profile} size={36}/><span><strong>{profile.name}</strong><small>{session?.access_token ? (rdUser?.type === 'premium' ? `Real-Debrid Premium${rdUser?.username ? ` · ${rdUser.username}` : ''}` : 'Real-Debrid ligado') : 'Conta local'}</small></span></div>
            <button role="menuitem" onClick={() => { setProfileMenuOpen(false); onSwitchProfile(); }}><Icon name="user" size={16}/>Mudar de perfil</button>
            {!kids && <button role="menuitem" onClick={() => { setProfileMenuOpen(false); onManageProfiles(); }}><Icon name="settings" size={16}/>Gerir perfis</button>}
            <button role="menuitem" onClick={() => { setProfileMenuOpen(false); setModal({ type: 'prefs' }); }}><Icon name="settings" size={16}/>Preferências do perfil</button>
            <div className="profile-menu-divider"></div>
            <button role="menuitem" onClick={() => { setActivePage('history'); setQuery(''); setProfileMenuOpen(false); }}><Icon name="history" size={16}/>Vistos e a continuar</button>
            <button role="menuitem" onClick={() => { setActivePage('watchlist'); setProfileMenuOpen(false); }}><Icon name="bookmark" size={16}/>A minha lista{saved.length > 0 && <small>{saved.length}</small>}</button>
            <button role="menuitem" onClick={() => { setActivePage('downloads'); setProfileMenuOpen(false); loadRdAccount(); }}><Icon name="cloud" size={16}/>Real-Debrid{session?.access_token && <small>{readyTorrents.length} prontos</small>}</button>
            <div className="profile-menu-divider"></div>
            {!kids && <button role="menuitem" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setProfileMenuOpen(false); setModal({ type: 'integrations' }); }}><Icon name="settings" size={16}/>Definições e integrações</button>}
          </div>}
        </div>
      </aside>

      <main className="main-content" id="top">
        {activePage === 'history' ? (
          <HistoryPage watch={watch} profileName={profile.name} onOpen={(entry) => openDetails(entry)} onForget={forgetTitle}/>
        ) : activePage === 'indexers' ? (
          <section className="indexer-page page-in">
            <div className="page-heading"><div><span className="eyebrow"><span className="pulse-dot"></span> PROWLARR · REAL-DEBRID</span><h1>Pesquisar lançamentos</h1><p>Pesquisa nos indexadores configurados no Prowlarr e envia a tua escolha para a nuvem Real-Debrid.</p></div><button className="button button-quiet" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}><Icon name="settings" size={15}/>Configurar Prowlarr</button></div>
            <form className="indexer-search-form" onSubmit={(event) => { event.preventDefault(); searchReleaseSources(indexerQuery, searchCategory); }}>
              <label className="input-label" htmlFor="indexer-query">O que procuras?</label>
              <div className="indexer-search-controls"><input id="indexer-query" value={indexerQuery} onChange={(event) => { setIndexerQuery(event.target.value); setReleaseSearch(null); }} placeholder="Título, artista, álbum, autor…"/><select value={searchCategory} onChange={(event) => { setSearchCategory(event.target.value); setReleaseSearch(null); }} aria-label="Tipo de conteúdo">{Object.entries(SEARCH_CATEGORIES).filter(([key]) => key !== 'adult' || adultEnabled).map(([key, item]) => <option key={key} value={key}>{item.label} · {item.manager}</option>)}</select><button className="button button-primary" disabled={!integrationSettings.prowlarrUrl || !integrationSettings.prowlarrApiKey || !indexerQuery.trim()}><Icon name="search" size={16}/>Pesquisar</button></div>
              <p className="indexer-search-hint">A pesquisa envia ao Prowlarr o tipo e a categoria Torznab de {SEARCH_CATEGORIES[searchCategory].manager}. Os resultados são enviados ao Real-Debrid.</p>
            </form>
            {!integrationSettings.prowlarrUrl || !integrationSettings.prowlarrApiKey ? <div className="empty-list indexer-empty"><span><Icon name="link" size={22}/></span><strong>Configura o Prowlarr para começar</strong><p>Adiciona o endereço local e a API key do teu Prowlarr. A app pesquisa os indexadores que já configuraste lá.</p><button className="button button-primary" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}>Configurar integração</button></div> : <ReleaseSearchResults search={releaseSearch} categoryKey={searchCategory} connected={Boolean(session?.access_token)} busyId={releaseBusyId} onAdd={grabRelease}/>}
            <div className="indexer-manager-note"><strong>Como funciona</strong><span>Os nomes Radarr, Sonarr, Lidarr, Readarr e Whisparr identificam aqui as categorias de filmes, séries, música, livros e Adulto. O Prowlarr pesquisa apenas indexadores configurados para cada categoria; não precisas de instalar os outros gestores. A escolha é enviada ao Real-Debrid.</span><button className="text-link" onClick={() => setModal({ type: 'integrations' })}>Gerir ligação <Icon name="chevron" size={14}/></button></div>
          </section>
        ) : activePage === 'downloads' ? (
          <section className="downloads-page page-in">
            <div className="page-heading"><div><span className="eyebrow"><span className="pulse-dot"></span> A TUA NUVEM PESSOAL</span><h1>Real-Debrid</h1><p>Os teus torrents e downloads, prontos a ver.</p></div><div className="heading-actions"><button className="button button-quiet" onClick={loadRdAccount} disabled={rdBusy}><Icon name="refresh" size={16}/>{rdBusy ? 'A sincronizar…' : 'Sincronizar'}</button><button className="button button-primary" onClick={() => { setMagnet(''); setModal({ type: 'magnet' }); }} disabled={!session?.access_token}><Icon name="plus" size={17}/>Adicionar magnet</button></div></div>
            {!session?.access_token ? <div className="empty-cloud"><span className="empty-cloud-icon"><Icon name="cloud" size={26}/></span><h2>A tua biblioteca começa aqui</h2><p>Liga a tua conta Real-Debrid para ver e reproduzir os teus conteúdos neste espaço.</p><button className="button button-primary" onClick={() => setModal({ type: 'connect' })}>Ligar Real-Debrid <Icon name="chevron" size={16}/></button></div> : <>
              <div className="rd-account-strip"><div className="rd-account-avatar">{rdUser?.username?.slice(0, 1)?.toUpperCase() || 'R'}</div><div><strong>{rdUser?.username || 'A carregar conta…'}</strong><span>{rdUser?.type === 'premium' ? 'Conta Premium' : 'Conta Real-Debrid'}{rdUser?.expiration ? ` · válida até ${formatDate(rdUser.expiration)}` : ''}</span></div><span className="account-connected"><i></i> Ligado</span></div>
              {rdError && <div className="inline-error"><Icon name="alert" size={16}/>{rdError}</div>}
              <div className="library-stats"><div className="stat-card"><span>Itens na nuvem</span><strong>{rdItems.length.toString().padStart(2, '0')}</strong><small>na tua conta</small></div><div className="stat-card"><span>Prontos a ver</span><strong>{readyTorrents.length.toString().padStart(2, '0')}</strong><small>sem espera</small></div><div className="stat-card"><span>Estado da conta</span><strong className="status-active">Ativa</strong><small>sincronizada agora</small></div></div>
              <div className="section-heading downloads-heading"><div><span className="eyebrow">A TUA COLEÇÃO</span><h2>Conteúdos recentes</h2></div><span className="count-pill">{rdItems.length} {rdItems.length === 1 ? 'item' : 'itens'}</span></div>
              {rdItems.length ? <div className="torrent-list">{rdItems.map((torrent) => <TorrentRow key={torrent.id} torrent={torrent} onPlay={() => openTorrentStream(torrent)} onSelect={() => selectTorrentFiles(torrent.id)} onDelete={async () => { try { await callRd(`/torrents/delete/${encodeURIComponent(torrent.id)}`, { method: 'DELETE' }); await loadRdAccount(); notify('Item removido da tua conta.'); } catch (error) { setRdError(getError(error)); } }} />)}</div> : <div className="empty-list"><span><Icon name="film" size={22}/></span><strong>Ainda não há conteúdo aqui</strong><p>Adiciona um magnet para o enviares para a tua conta Real-Debrid.</p><button className="text-link" onClick={() => setModal({ type: 'magnet' })}>Adicionar o primeiro magnet <Icon name="chevron" size={14}/></button></div>}
            </>}
          </section>
        ) : searchKind ? (
          <div className="home-page page-in catalog-browse-page search-page"><SearchFeed kind={searchKind} query={query} orientation={searchKind === 'adultvideos' ? adultOrientation : ''} renderCard={(item, index) => <PosterCard key={item.id} item={item} index={index} saved={saved.includes(item.id)} hideSave={searchKind === 'adultvideos'} onOpen={() => (searchKind === 'adultvideos' ? setModal({ type: 'adultplay', item }) : openDetails(item))} onSave={() => toggleSaved(item.id, item)}/>}/></div>
        ) : activePage === 'tv' && tvMode === 'channels' ? (
          <LiveTvPage externalFilter={query} mode={tvMode} onMode={setTvMode} countries={liveCountries} country={tvCountry} onCountry={changeTvCountry} state={liveChannels} health={liveHealth} showOffline={showOffline} onShowOffline={setShowOffline} onPlay={playLiveChannel} onRetry={() => loadLiveChannels(tvCountry)}/>
        ) : activePage === 'adult' && adultEnabled && adultMode === 'videos' && !query ? (
          <AdultVideosPage mode={adultMode} onMode={setAdultMode} orientation={adultOrientation} onOrientation={changeAdultOrientation} state={adultVideos} category={adultCategory} onCategory={setAdultCategory} onPlay={(item) => setModal({ type: 'adultplay', item })} onRetry={() => loadAdultVideos('Todos', adultOrientation)}/>
        ) : activePage === 'home' && !query ? (
          <HomePage absConfigured={Boolean(integrationSettings.audiobookshelfUrl && integrationSettings.audiobookshelfToken)} onPlayAudiobook={playAudiobook} absLoading={absLoading} profile={profile} profiles={profiles} kids={kids} prefs={prefs} rdStatus={{ connected: Boolean(session?.access_token), user: rdUser, count: rdItems.length, ready: readyTorrents.length }} onConnectRd={() => setModal({ type: 'connect' })} lastMusic={lastMusic} onResumeMusic={resumeMusic} watch={watch} saved={saved} savedItems={savedItems} reading={reading} trending={(catalogRows?.trending?.length ? catalogRows.trending : catalogTitles).filter((item) => item.poster && !item.adult)} taste={taste} onTaste={changeTaste} musicHistory={musicHistory} onOpen={(item) => openDetails(item)} onResume={(entry) => startPlayback(entry)} onPlayEpisode={(title, context) => startPlayback(title, context)} onToggleSave={toggleSaved} onNavigate={(page) => { setActivePage(page); setQuery(''); setGenre('Todos'); }}/>
        ) : (['home', 'films', 'series', 'tv', 'music', 'books'].includes(activePage) || (activePage === 'adult' && adultEnabled)) && !query ? (
          <div className={`home-page page-in ${activePage !== 'home' ? 'catalog-browse-page' : ''} ${activePage === 'books' ? 'books-page' : ''}`}>
            {activePage === 'books' && <BooksModeSwitch mode={booksMode} onMode={changeBooksMode}/>}
            {activePage === 'books' && booksMode === 'audio' && <AudiobooksView configured={Boolean(integrationSettings.audiobookshelfUrl && integrationSettings.audiobookshelfToken)} onPlay={playAudiobook} onConfigure={openIntegrations} playingId={absLoading}/>}
            {activePage === 'books' && booksMode === 'ebooks' && <BooksNav view={booksView} onView={setBooksView} counts={{ shelf: Object.keys(reading.shelf).length, authors: new Set(Object.values(reading.shelf).map((entry) => entry.book.creator?.split(',')[0]?.trim() || '—')).size }}/>}
            {activePage === 'tv' && <TvModeTabs mode={tvMode} onMode={setTvMode}/>}
            {activePage === 'adult' && <AdultModeTabs mode={adultMode} onMode={setAdultMode}/>}
            {genre === 'Todos' && activePage !== 'books' && (!discoveryPage || discoveryItems.length > 0) && <section className={`hero ${isVideoTitle(featuredTitle) ? '' : 'hero-art'}`} style={{ backgroundImage: `linear-gradient(90deg, rgba(8,9,14,.97) 0%, rgba(8,9,14,.89) 29%, rgba(8,9,14,.45) 58%, rgba(8,9,14,.08) 100%), linear-gradient(0deg, rgba(9,10,15,1) 0%, rgba(9,10,15,0) 35%), url(${featuredTitle.backdrop})` }}>
              <div className="hero-grain"></div><div className="hero-content"><div className="hero-kicker"><span className="live-mark"></span> {activePage === 'films' ? 'FILMES PARA DESCOBRIR' : activePage === 'series' ? 'SÉRIES EM DESTAQUE' : activePage === 'tv' ? 'PROGRAMAS EM DESTAQUE' : activePage === 'music' ? 'ÁLBUNS EM DESTAQUE' : activePage === 'books' ? 'LIVROS EM DESTAQUE' : activePage === 'adult' ? 'EM DESTAQUE' : catalogStatus === 'ready' ? 'EM ALTA ESTA SEMANA' : 'A TUA PRÓXIMA DESCOBERTA'}{activePage === 'home' && ` ${featuredTitle.type.toUpperCase()}`}</div><div className="hero-title-wrap"><span className="hero-title-small">{featuredTitle.creator || featuredTitle.original}</span><h1>{featuredTitle.title}</h1></div><p className="hero-copy">{featuredTitle.description}</p><div className="hero-meta">{featuredTitle.rating && <><span className="rating-star">★</span><strong>{featuredTitle.rating}</strong><i></i></>}<span>{featuredTitle.year || 'Recente'}</span><i></i><span>{featuredTitle.genre}</span><span className="quality-tag">{featuredTitle.type.toUpperCase()}</span></div><div className="hero-actions"><button className="button button-primary hero-play" onClick={() => openDetails(featuredTitle)}>{isVideoTitle(featuredTitle) ? <Icon name="play" size={17}/> : <Icon name="spark" size={17}/>}{isVideoTitle(featuredTitle) ? 'Ver agora' : 'Ver detalhes'}</button>{isVideoTitle(featuredTitle) && <button className="button button-glass" onClick={() => openDetails(featuredTitle)}>Mais informações <Icon name="chevron" size={15}/></button>}<button className={`hero-save ${saved.includes(featuredTitle.id) ? 'is-saved' : ''}`} aria-label="Adicionar à minha lista" onClick={() => toggleSaved(featuredTitle.id)}><Icon name={saved.includes(featuredTitle.id) ? 'check' : 'plus'} size={18}/></button></div></div>
              <div className="hero-pagination"><button aria-label="Anterior" className="hero-arrow" onClick={() => setHeroIndex((index) => (index - 1 + featuredTitles.length) % featuredTitles.length)}><Icon name="chevron" size={17}/></button><div><span className="current-slide">{String((heroIndex % featuredTitles.length) + 1).padStart(2, '0')}</span><span className="slide-track"><i style={{ width: `${((heroIndex % featuredTitles.length) + 1) / featuredTitles.length * 100}%` }}></i></span><span>{String(featuredTitles.length).padStart(2, '0')}</span></div><button aria-label="Seguinte" className="hero-arrow" onClick={() => setHeroIndex((index) => (index + 1) % featuredTitles.length)}><Icon name="chevron" size={17}/></button></div>
              <div className="hero-side-label"><span>{catalogStatus === 'ready' ? 'TENDÊNCIAS' : 'DESTAQUES'}</span><i></i><span>{featuredTitle.year || '2026'}</span></div>
            </section>}

            {activePage === 'books' && booksMode === 'ebooks' && booksView === 'dashboard' && <ReadingDashboard reading={reading} saved={saved} onOpen={openDetails} onSave={toggleSaved} onGoal={setReadingGoal}/>}
            {activePage === 'books' && booksMode === 'ebooks' && booksView === 'discover' && <div className="section-heading rd-discover"><div><span className="eyebrow">NOVAS LEITURAS</span><h2>Descobrir livros</h2></div></div>}
            {activePage === 'books' && booksMode === 'ebooks' && !['dashboard', 'discover'].includes(booksView) && <BooksCollectionView view={booksView} reading={reading} saved={saved} onOpen={openDetails} onSave={toggleSaved}/>}
            {activePage !== 'home' && showDiscover && <ScrollRow className="genre-chips" aria-label="Filtrar por género"><button className={genre === 'Todos' ? 'active' : ''} onClick={() => setGenre('Todos')}>Todos</button>{browseGenres.map((category) => <button key={category} className={genre === category ? 'active' : ''} onClick={() => setGenre(category)}>{category}</button>)}</ScrollRow>}

            {discoveryPage && showDiscover && discoveryItems.length === 0 && <div className="empty-list catalog-empty"><span>{discoveryState?.status === 'loading' || (!discoveryState && (!['tv', 'adult'].includes(activePage) || integrationSettings.tmdbApiKey)) ? <span className="spinner"></span> : <Icon name={discoveryState?.status === 'error' ? 'alert' : 'link'} size={22}/>}</span>
              {(activePage === 'tv' || activePage === 'adult') && !integrationSettings.tmdbApiKey ? <><strong>Liga o TMDB para ver este catálogo</strong><p>Adiciona a API key do TMDB nas definições para carregar os títulos em destaque.</p><button className="text-link" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}>Configurar TMDB <Icon name="chevron" size={14}/></button></>
                : discoveryState?.status === 'error' ? <><strong>Não foi possível carregar {DISCOVERY_LABELS[activePage]}</strong><p className="is-error-text">{discoveryState.message}</p><button className="text-link" onClick={() => loadDiscovery(activePage)}>Tentar novamente <Icon name="refresh" size={14}/></button></>
                  : <><strong>A carregar {DISCOVERY_LABELS[activePage]}…</strong><p>A reunir os títulos em destaque.</p></>}
            </div>}
            {showDiscover && feedKind && <FeedShelves key={feedKind} kind={feedKind} shelves={pagedShelves} genre={genre} activePage={activePage} renderCard={(item, index, rank) => <PosterCard key={item.id} item={item} index={index} rank={rank} saved={saved.includes(item.id)} onOpen={() => openDetails(item)} onSave={() => toggleSaved(item.id, item)}/>} onViewAll={(page) => { setActivePage(page); setQuery(''); }}/>}
            {!feedKind && genre !== 'Todos' && showDiscover && visibleBrowsingShelves.length === 0 && <div className="empty-list catalog-empty"><span><Icon name="search" size={22}/></span><strong>Sem títulos nesta categoria</strong><p>Experimenta outro género ou volta a ver tudo.</p></div>}
            {(showDiscover && !feedKind ? visibleBrowsingShelves : []).map((shelf, shelfIndex) => <section className={`content-section discovery-rail ${shelfIndex === 0 ? 'discover-section' : ''}`} key={shelf.title}>
              <div className="section-heading"><div><span className="eyebrow">{shelf.eyebrow}</span><h2>{shelf.title}</h2></div><div className="section-controls">{shelf.page !== activePage && <button className="view-all" onClick={() => { setActivePage(shelf.page); setQuery(''); }}>{shelf.page === 'series' ? 'Todas as séries' : 'Explorar catálogo'} <Icon name="chevron" size={14}/></button>}<div className="arrow-pair"><button aria-label="Anterior" onClick={(event) => event.currentTarget.closest('.content-section').querySelector('.poster-row').scrollBy({ left: -500, behavior: 'smooth' })}><Icon name="chevron" size={16}/></button><button aria-label="Seguinte" onClick={(event) => event.currentTarget.closest('.content-section').querySelector('.poster-row').scrollBy({ left: 500, behavior: 'smooth' })}><Icon name="chevron" size={16}/></button></div></div></div>
              <div className={`poster-row ${shelf.ranked ? 'ranked-row' : ''}`}>{shelf.items.map((item, index) => <PosterCard key={item.id} item={item} index={index} rank={shelf.ranked ? index + 1 : null} saved={saved.includes(item.id)} onOpen={() => openDetails(item)} onSave={() => toggleSaved(item.id)}/>)}</div>
            </section>)}

            {activePage === 'home' && <section className="wide-promo"><div className="promo-orbit one"></div><div className="promo-orbit two"></div><div className="promo-copy"><span className="eyebrow"><span className="pulse-dot"></span> UMA SÓ CASA PARA TUDO O QUE VÊS</span><h2>A tua coleção.<br/><span>Sem fronteiras.</span></h2><p>Liga o Real-Debrid para trazer a tua biblioteca e os teus links para aqui.</p><button className="button button-light" onClick={() => setModal({ type: 'connect' })}>{session?.access_token ? 'Gerir integração' : 'Ligar Real-Debrid'} <Icon name="chevron" size={15}/></button></div><div className="promo-art"><span className="promo-disc disc-one"></span><span className="promo-disc disc-two"></span><span className="promo-card-art"><Icon name="play" size={24}/></span></div></section>}
          </div>
        ) : ['tv', 'music', 'books', 'adult'].includes(activePage) ? (
          <section className="media-browse-page page-in">
            <div className="media-browse-heading"><div><span className="eyebrow">A TUA PRÓXIMA DESCOBERTA</span><h1>{pageTitle}</h1><p>{activePage === 'tv' ? 'Episódios, programas e minisséries encontrados nos teus indexadores.' : activePage === 'music' ? 'Álbuns, bandas sonoras e sons para todos os momentos.' : activePage === 'books' ? 'Encontra a próxima história para ler.' : 'Explora conteúdos adultos através das categorias configuradas no Prowlarr.'}</p></div><span className="media-browse-emblem"><Icon name={SEARCH_CATEGORIES[browseCategoryKey].icon} size={25}/></span></div>
            {activePage === 'adult' && !adultEnabled ? <div className="browse-gate"><span className="browse-gate-icon"><Icon name="adult" size={25}/></span><div><strong>Pesquisa desativada</strong><p>Ativa a categoria Adultos nas definições quando quiseres usá-la.</p></div><button className="button button-primary" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}>Abrir definições <Icon name="settings" size={14}/></button></div> : <>
              <div className="collection-grid">{DISCOVERY_COLLECTIONS[activePage].map((collection) => <button key={collection.title} className={`collection-card accent-${collection.accent} ${releaseSearch?.collectionTitle === collection.title ? 'selected' : ''}`} onClick={() => searchReleaseSources(collection.query, browseCategoryKey, null, collection.title)}><span className="collection-icon"><Icon name={collection.icon} size={20}/></span><span className="collection-card-copy"><strong>{collection.title}</strong><small>{collection.subtitle}</small></span><Icon name="chevron" size={17}/></button>)}</div>
              {!integrationSettings.prowlarrUrl || !integrationSettings.prowlarrApiKey ? <div className="browse-setup-note"><Icon name="link" size={17}/><span>Configura o Prowlarr para carregar resultados nestas coleções.</span><button className="text-link" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}>Configurar <Icon name="chevron" size={13}/></button></div> : <section className="release-panel collection-results-panel"><div className="release-panel-heading"><div><span className="eyebrow"><span className="pulse-dot"></span> {SEARCH_CATEGORIES[browseCategoryKey].manager.toUpperCase()} · PROWLARR</span><strong>{releaseSearch?.categoryKey === browseCategoryKey && releaseSearch.collectionTitle ? releaseSearch.collectionTitle : 'A carregar uma coleção'}</strong></div></div><ReleaseSearchResults search={releaseSearch?.categoryKey === browseCategoryKey && !releaseSearch.titleId && releaseSearch.collectionTitle ? releaseSearch : null} categoryKey={browseCategoryKey} connected={Boolean(session?.access_token)} busyId={releaseBusyId} onAdd={grabRelease}/></section>}
            </>}
          </section>
        ) : (
          <section className="catalog-page page-in">
            <div className="page-heading"><div><span className="eyebrow">O UNIVERSO É TEU</span><h1>{query ? 'Resultados da pesquisa' : pageTitle}</h1><p>{query ? `O que encontrámos para “${query}”.` : activePage === 'watchlist' ? 'Os títulos que guardaste para ver mais tarde.' : 'Escolhe a próxima história para a tua noite.'}</p></div>{['films', 'series'].includes(activePage) && <div className="catalog-filter"><label htmlFor="genre-select">Género</label><select id="genre-select" value={genre} onChange={(event) => setGenre(event.target.value)}><option>Todos</option>{browseGenres.map((category) => <option key={category}>{category}</option>)}</select></div>}</div>
            <div className="catalog-summary"><span>{searchResults.length} {searchResults.length === 1 ? 'título' : 'títulos'}</span><div className="active-filter"><span></span>Para descobrir</div></div>
            {searchResults.length ? <><div className="catalog-grid">{searchResults.slice(0, visibleCount).map((item, index) => <PosterCard key={item.id} item={item} index={index} saved={saved.includes(item.id)} onOpen={() => openDetails(item)} onSave={() => toggleSaved(item.id)}/>)}</div>{visibleCount < searchResults.length && <div className="load-more-wrap"><button className="button button-quiet load-more" onClick={() => setVisibleCount((count) => Math.min(count + 24, searchResults.length))}>Carregar mais títulos <span>{Math.min(24, searchResults.length - visibleCount)} de {searchResults.length - visibleCount}</span></button></div>}</> : <div className="empty-list catalog-empty"><span><Icon name={activePage === 'watchlist' ? 'bookmark' : 'search'} size={22}/></span><strong>{activePage === 'watchlist' ? 'A tua lista ainda está vazia' : 'Não encontrámos esse título'}</strong><p>{activePage === 'watchlist' ? 'Guarda qualquer filme ou série com o botão +.' : 'Experimenta outro título ou género.'}</p>{activePage === 'watchlist' && <button className="text-link" onClick={() => setActivePage('home')}>Explorar catálogo <Icon name="chevron" size={14}/></button>}</div>}
          </section>
        )}
        <footer className="footer"><span>© 2026 StreamNexus</span><span>Este produto usa a API do TMDB e não é endossado nem certificado pelo TMDB.</span><button onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}>Integrações <Icon name="settings" size={13}/></button></footer>
      </main>

      <div className={`catalog-status status-bar ${catalogStatus === 'error' ? 'is-error' : ''}`}><span>{catalogStatus === 'loading' ? 'A atualizar tendências e estreias…' : catalogStatus === 'ready' ? `Catálogo atualizado em ${catalogUpdated}.` : catalogStatus === 'error' ? 'Falha ao atualizar. A mostrar o último catálogo disponível.' : 'Catálogo de demonstração. Liga o TMDB para ver títulos e tendências atualizados.'}</span><button className="text-link" onClick={() => integrationSettings.tmdbApiKey ? refreshCatalog() : setModal({ type: 'integrations' })} disabled={catalogStatus === 'loading'}>{integrationSettings.tmdbApiKey ? 'Atualizar' : 'Configurar TMDB'} <Icon name="chevron" size={14}/></button></div>

      {mini && <MiniPlayer key={mini.key} mini={mini} onProgress={rememberMusic} suspended={isPlayerOpen} hidden={activePage === 'home' && !query} onIndex={(index) => setMini((current) => (current ? { ...current, index } : current))} onClose={() => { if (mini.mode === 'spotify') window.streamnexus?.spotifyConnectCommand?.({ action: 'pause' }).catch(() => {}); setMini(null); }} onError={(message) => notify(message, 'error')} onRemote={(state) => setSpotifyNow(state?.uri || '')}/>}
      <UpdateBanner onNotify={notify}/>
      {notice && !isPlayerOpen && <div className={`toast is-${noticeKind}`} role={noticeKind === 'error' ? 'alert' : 'status'}><span className="toast-check"><Icon name={noticeKind === 'error' ? 'alert' : 'check'} size={14}/></span>{notice}</div>}

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { if (modal?.type === 'player') { setPlaying(null); setSubtitleTrackUrl(''); setActiveSubId(''); } setModal(null); setDeviceAuth(null); setDeviceStatus(''); } }}>
        {modal.type === 'details' && selectedTitle && <div className="detail-modal modal-card">
          <div className="detail-backdrop" style={{ backgroundImage: `linear-gradient(0deg,#101117 0%,rgba(16,17,23,.93) 13%,rgba(16,17,23,0) 100%),linear-gradient(90deg,rgba(16,17,23,.45),transparent),url(${selectedTitle.backdrop})` }}></div>
          <button className="modal-close" aria-label="Fechar" onClick={() => setModal(null)}><Icon name="close"/></button>
          <div className="detail-content">
            <span className="eyebrow"><span className="pulse-dot"></span>{selectedTitle.type.toUpperCase()} · {selectedTitle.year}</span>
            <h2>{selectedTitle.title}</h2>
            <div className="detail-meta">{selectedTitle.rating && <><span className="rating-star">★</span><b>{selectedTitle.rating}</b><i></i></>}<span>{selectedTitle.runtime}</span><i></i><span>{selectedTitle.genre}</span></div>
            <p>{selectedTitle.description}</p>
            <div className="detail-actions">{selectedTitle.type === 'Álbum' && selectedTitle.embedUrl && <button className="button button-primary" onClick={() => setModal({ type: 'embed', item: selectedTitle })}><Icon name="play" size={16}/>Ouvir agora</button>}{isVideoTitle(selectedTitle) && <button className="button button-primary" onClick={() => startPlayback(selectedTitle)}><Icon name="play" size={16}/>{playLabelFor(selectedTitle)}</button>}{selectedTitle.type === 'Filme' && <button className={`button button-glass ${watch[selectedTitle.id]?.watched ? 'is-active' : ''}`} aria-pressed={Boolean(watch[selectedTitle.id]?.watched)} onClick={() => toggleMovieWatched(selectedTitle, !watch[selectedTitle.id]?.watched)}><Icon name="check" size={16}/>{watch[selectedTitle.id]?.watched ? 'Visto' : 'Marcar como visto'}</button>}<button className="button button-glass" onClick={() => toggleSaved(selectedTitle.id)}><Icon name={saved.includes(selectedTitle.id) ? 'check' : 'plus'} size={16}/>{saved.includes(selectedTitle.id) ? 'Na tua lista' : 'A minha lista'}</button>{trailer.status === 'loading' && <button className="button button-glass" disabled><span className="spinner"></span>A procurar trailer…</button>}{trailer.status === 'ready' && <button className="button button-glass" onClick={() => setTrailerPlaying((current) => !current)}><Icon name={trailerPlaying ? 'close' : 'play'} size={16}/>{trailerPlaying ? 'Fechar trailer' : 'Ver trailer'}</button>}</div>
            {selectedTitle.type === 'Livro' && (() => { const entry = reading.shelf[selectedTitle.id]; return <div className="reading-controls">
              <span className="eyebrow">A MINHA ESTANTE</span>
              <div className="reading-status">{Object.entries(READING_STATUS).map(([key, label]) => <button key={key} className={`button button-glass ${entry?.status === key ? 'is-active' : ''}`} onClick={() => setBookStatus(selectedTitle, key)}>{label}</button>)}</div>
              {entry?.status === 'reading' && <label className="reading-slider"><span>Progresso</span><input type="range" min="0" max="100" step="5" value={entry.progress || 0} onChange={(event) => setBookProgress(selectedTitle, Number(event.target.value))}/><b>{entry.progress || 0}%</b></label>}
              {entry && <button className="text-link" onClick={() => removeBookFromShelf(selectedTitle.id)}>Remover da estante</button>}
            </div>; })()}
            {trailer.status === 'ready' && trailerPlaying && <div className="trailer-frame"><iframe title={`Trailer: ${selectedTitle.title}`} src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?autoplay=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div>}
            <div className="detail-divider"></div>
            <div className="detail-facts"><span><small>TÍTULO ORIGINAL</small><strong>{selectedTitle.original}</strong></span><span><small>GÉNERO</small><strong>{(selectedTitle.genres || [selectedTitle.genre]).join(', ')}</strong></span>{selectedTitle.creator ? <span><small>{selectedTitle.type === 'Álbum' ? 'ARTISTA' : 'AUTOR'}</small><strong>{selectedTitle.creator}</strong></span> : <span><small>AVALIAÇÃO</small><strong>★ {selectedTitle.rating} / 10</strong></span>}</div>
            {selectedTitle.type === 'Série' && selectedTitle.tmdbId && <EpisodePicker title={selectedTitle} entry={watch[selectedTitle.id]} onPlay={(season, episode, options) => startPlayback(selectedTitle, { episode: { season, episode }, resumeAt: options?.resumeAt || 0 })} onToggleWatched={(season, episode, watched, name) => toggleEpisodeWatched(selectedTitle, season, episode, watched, name)}/>}
            {selectedTitle.type === 'Livro' && <ShelfarrPanel book={selectedTitle} configured={Boolean(integrationSettings.shelfarrUrl && integrationSettings.shelfarrToken)} onNotify={notify}/>}
            {selectedTitle.type === 'Livro' && <BookSourcesPanel state={bookSources.id === selectedTitle.id ? bookSources : { status: 'loading', data: null }} onOpen={(url) => window.streamnexus?.openLink?.(url)?.catch((error) => notify(getError(error), 'error'))}/>}
            {selectedTitle.type === 'Álbum' && <SpotifyConnectBox album={selectedTitle} onNotify={notify} activeUri={mini?.mode === 'spotify' ? spotifyNow : ''} onListen={(options) => listenOnSpotify(selectedTitle, options)}/>}
            {selectedTitle.type === 'Álbum' && <FreeMusicPanel state={musicSources.id === selectedTitle.id ? musicSources : { status: 'loading', data: null }} activeUrl={mini?.mode === 'tracks' ? mini.tracks[mini.index]?.url : ''} onPlay={(queue, index) => playTracks(queue, index, selectedTitle)} onOpen={(url) => window.streamnexus?.openLink?.(url)?.catch((error) => notify(getError(error), 'error'))}/>}
            <ReleaseSearchPanel title={selectedTitle} search={releaseSearch} connected={Boolean(session?.access_token)} busyId={releaseBusyId} configured={Boolean(integrationSettings.prowlarrUrl && integrationSettings.prowlarrApiKey)} onRefresh={() => searchReleaseSources(selectedTitle.searchQuery || selectedTitle.original || selectedTitle.title, titleCategory(selectedTitle), selectedTitle.id)} onConfigure={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }} onAdd={grabRelease}/>
            <RdTitleMatches title={selectedTitle} search={rdSearch} connected={Boolean(session?.access_token)} onRefresh={() => searchTitleInLibrary(selectedTitle)} onConnect={() => setModal({ type: 'connect' })} onAdd={() => startPlayback(selectedTitle)} onOpen={(torrent) => openTorrentStream(torrent, selectedTitle)}/>
          </div>
        </div>}

        {modal.type === 'adultplay' && modal.item && <AdultPlayer item={modal.item} onClose={() => setModal(null)} onNotify={notify} onFallback={() => setModal({ type: 'embed', item: modal.item })}/>}
        {modal.type === 'embed' && modal.item && <div className="embed-modal modal-card">
          <button className="modal-close" aria-label="Fechar" onClick={() => setModal(null)}><Icon name="close"/></button>
          <span className="eyebrow">{modal.item.source?.toUpperCase()} · LEITOR INCORPORADO</span>
          <h2>{modal.item.title}</h2>
          <div className="embed-frame" style={modal.item.embedHeight ? { aspectRatio: 'auto', height: modal.item.embedHeight } : undefined}><iframe title={modal.item.title} src={modal.item.embedUrl} allow="autoplay *; fullscreen *; encrypted-media *" allowFullScreen referrerPolicy="no-referrer" sandbox={modal.item.embedHeight ? 'allow-scripts allow-same-origin allow-presentation allow-forms' : 'allow-scripts allow-same-origin allow-presentation'}/></div>
          <small className="embed-note">{modal.item.embedHeight ? <>Pré-visualização de cerca de 30 s por faixa. Para ouvir completo, abre no {modal.item.source}. {modal.item.linkUrl && <button className="text-link" onClick={() => window.streamnexus?.openLink?.(modal.item.linkUrl)?.catch((error) => notify(getError(error), 'error'))}>Abrir no {modal.item.source}</button>}</> : <>Vídeo reproduzido a partir de {modal.item.source}. A StreamNexus não aloja nem descarrega este conteúdo.</>}</small>
        </div>}

        {modal.type === 'prefs' && <div className="connect-modal modal-card prefs-modal">
          <button className="modal-close" aria-label="Fechar" onClick={() => setModal(null)}><Icon name="close"/></button>
          <span className="eyebrow">PREFERÊNCIAS · {profile.name.toUpperCase()}</span>
          <h2>Preferências do perfil</h2>
          <div className="prefs-list">
            <label className="prefs-row"><input type="checkbox" checked={prefs.autoNext} onChange={(event) => changePrefs({ autoNext: event.target.checked })}/><span><strong>Reproduzir o episódio seguinte automaticamente</strong><small>Quando um episódio acaba, o próximo começa ao fim de 10 segundos (podes cancelar).</small></span></label>
            <label className="prefs-row"><input type="checkbox" checked={prefs.notifyPremieres} onChange={(event) => changePrefs({ notifyPremieres: event.target.checked })}/><span><strong>Avisar quando estreia um episódio</strong><small>Mostra uma notificação do Windows, ao abrir a app, quando sai um episódio de uma série que acompanhas.</small></span></label>
          </div>
          <small className="prefs-note">{profile.kids ? 'Este é um perfil infantil: só mostra conteúdo para os mais novos.' : 'Para criar um perfil infantil, usa “Gerir perfis”.'}</small>
        </div>}
        {modal.type === 'integrations' && <div className="integration-modal modal-card">
          <button className="modal-close" aria-label="Fechar" onClick={() => setModal(null)}><Icon name="close"/></button>
          <div className="modal-emblem magnet-emblem"><Icon name="settings" size={23}/></div><span className="eyebrow">CATÁLOGO, PESQUISA E LEGENDAS</span><h2>Integrações</h2>
          <UpdateSettings onNotify={notify}/>
          <InviteSettings onNotify={notify}/>
          <p className="connect-lead">Liga o Prowlarr para pesquisar fontes, o TMDB para atualizar tendências e estreias, e o OpenSubtitles para procurar legendas. A preferência de legendas é português de Portugal.</p>
          <form onSubmit={saveIntegrationSettings} className="integration-form">
            <div className="integration-group-title">Prowlarr</div>
            <label className="input-label" htmlFor="prowlarr-url">Endereço do Prowlarr</label><input id="prowlarr-url" className="text-input" type="url" placeholder="http://localhost:9696" value={integrationForm.prowlarrUrl} onChange={(event) => setIntegrationForm((current) => ({ ...current, prowlarrUrl: event.target.value }))}/>
            <label className="input-label" htmlFor="prowlarr-key">API key do Prowlarr</label><input id="prowlarr-key" className="text-input" type="password" autoComplete="off" placeholder="Settings > General > Security" value={integrationForm.prowlarrApiKey} onChange={(event) => setIntegrationForm((current) => ({ ...current, prowlarrApiKey: event.target.value }))}/>
            <button type="button" className="button button-quiet integration-test-button" onClick={testProwlarr}>Testar Prowlarr</button>
            {sectionTestLine('prowlarr')}

            <div className="integration-group-title">Shelfarr (livros)</div>
            <small className="integration-help">Liga o teu Shelfarr para pedir livros e audiolivros a partir da aba Livros. As fontes são as que configuraste no Shelfarr. Gera o token em Perfil &gt; API tokens (permissões de pesquisa e pedidos).</small>
            <label className="input-label" htmlFor="shelfarr-url">Endereço do Shelfarr</label><input id="shelfarr-url" className="text-input" type="url" placeholder="http://localhost:5056" value={integrationForm.shelfarrUrl || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, shelfarrUrl: event.target.value }))}/>
            <label className="input-label" htmlFor="shelfarr-token">Token do Shelfarr</label><input id="shelfarr-token" className="text-input" type="password" autoComplete="off" placeholder="shf_…" value={integrationForm.shelfarrToken || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, shelfarrToken: event.target.value }))}/>
            <button type="button" className="button button-quiet integration-test-button" onClick={testShelfarr}>Testar Shelfarr</button>
            {sectionTestLine('shelfarr')}

            <div className="integration-group-title">Audiobookshelf (audiolivros)</div>
            <small className="integration-help">O Audiobookshelf mostra e toca os audiolivros que estão nas pastas do teu servidor; não usa indexadores. O token copia-se na interface dele: Configuração &gt; Utilizadores &gt; a tua conta.</small>
            <label className="input-label" htmlFor="abs-url">Endereço do Audiobookshelf</label><input id="abs-url" className="text-input" type="url" placeholder="http://100.x.y.z:13378" value={integrationForm.audiobookshelfUrl || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, audiobookshelfUrl: event.target.value }))}/>
            <label className="input-label" htmlFor="abs-token">Token do Audiobookshelf</label><input id="abs-token" className="text-input" type="password" autoComplete="off" placeholder="Token / API key" value={integrationForm.audiobookshelfToken || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, audiobookshelfToken: event.target.value }))}/>
            <button type="button" className="button button-quiet integration-test-button" onClick={testAudiobookshelf}>Testar Audiobookshelf</button>
            {sectionTestLine('audiobookshelf')}

            <div className="integration-group-title">TMDB</div>
            <small className="integration-help">Cria uma API key nas definições da conta TMDB. Esta ligação atualiza os títulos, imagens e tendências.</small>
            <label className="input-label" htmlFor="tmdb-key">API key do TMDB</label><input id="tmdb-key" className="text-input" type="password" autoComplete="off" placeholder="API Read Access Token" value={integrationForm.tmdbApiKey || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, tmdbApiKey: event.target.value }))}/>
            <button type="button" className="button button-quiet integration-test-button" onClick={testTmdb}>Testar TMDB</button>
            {sectionTestLine('tmdb')}

            <div className="integration-group-title">Spotify (opcional)</div>
            <small className="integration-help">Cria uma app em developer.spotify.com e cola aqui o Client ID e o Client Secret. Melhora a aba Música; sem isto é usado o iTunes. Para ouvir com a tua conta Premium (comando remoto), adiciona também http://127.0.0.1:8898/callback como Redirect URI da app e liga a conta no ecrã de um álbum.</small>
            <label className="input-label" htmlFor="spotify-id">Client ID</label><input id="spotify-id" className="text-input" autoComplete="off" placeholder="Client ID do Spotify" value={integrationForm.spotifyClientId || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, spotifyClientId: event.target.value }))}/>
            <label className="input-label" htmlFor="spotify-secret">Client Secret</label><input id="spotify-secret" className="text-input" type="password" autoComplete="off" placeholder="Client Secret do Spotify" value={integrationForm.spotifyClientSecret || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, spotifyClientSecret: event.target.value }))}/>
            <button type="button" className="button button-quiet integration-test-button" onClick={testSpotify}>Testar Spotify</button>
            {sectionTestLine('spotify')}

            <div className="integration-group-title">OpenSubtitles</div>
            <small className="integration-help">A API key e as credenciais da conta OpenSubtitles são necessárias para pesquisar e descarregar legendas.</small>
            <label className="input-label" htmlFor="opensubtitles-key">API key</label><input id="opensubtitles-key" className="text-input" type="password" autoComplete="off" placeholder="API key do OpenSubtitles" value={integrationForm.openSubtitlesApiKey || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, openSubtitlesApiKey: event.target.value }))}/>
            <label className="input-label" htmlFor="opensubtitles-user">Nome de utilizador</label><input id="opensubtitles-user" className="text-input" autoComplete="username" placeholder="Utilizador da conta" value={integrationForm.openSubtitlesUsername || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, openSubtitlesUsername: event.target.value }))}/>
            <label className="input-label" htmlFor="opensubtitles-password">Palavra-passe</label><input id="opensubtitles-password" className="text-input" type="password" autoComplete="new-password" placeholder="Palavra-passe da conta" value={integrationForm.openSubtitlesPassword || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, openSubtitlesPassword: event.target.value }))}/>
            <button type="button" className="button button-quiet integration-test-button" onClick={testOpenSubtitles}>Testar OpenSubtitles</button>
            {sectionTestLine('opensubtitles')}

            {!integrationTestState.section && <div className="integration-test-line">{integrationTestState.text && <span className={`is-${integrationTestState.kind}`}>{integrationTestState.text}</span>}</div>}
            <div className="integration-actions"><span className="integration-help">As chaves são cifradas na app desktop.</span><button className="button button-primary"><Icon name="check" size={15}/>Guardar</button></div>
          </form>
          <div className="adult-setting"><span><strong>Pesquisa de conteúdo adulto</strong><small>Ativa a categoria Adulto (Whisparr) no menu e nas pesquisas.</small></span><input type="checkbox" checked={adultEnabled} onChange={(event) => toggleAdultSearch(event.target.checked)} aria-label="Ativar pesquisa de conteúdo adulto"/></div>
          <div className="readarr-note"><strong>Readarr</strong><span>O projeto foi descontinuado oficialmente em 2025. A pesquisa de livros continua disponível pela categoria Books no Prowlarr.</span></div>
          <p className="privacy-note"><Icon name="alert" size={14}/>{window.streamnexus?.isDesktop ? 'Todas as chaves e credenciais são guardadas cifradas com a proteção de credenciais do Windows.' : 'Nesta pré-visualização, as chaves ficam apenas nesta sessão do separador.'}</p>
          <section className="credits-panel"><strong>Créditos</strong><div><span className="tmdb-wordmark">TMDB</span><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p></div></section>
        </div>}

        {modal.type === 'connect' && <div className="connect-modal modal-card"><button className="modal-close" aria-label="Fechar" onClick={() => { setModal(null); setDeviceAuth(null); setDeviceStatus(''); }}><Icon name="close"/></button><div className="modal-emblem"><Icon name="cloud" size={26}/><span className="emblem-orbit"></span></div><span className="eyebrow">INTEGRAÇÃO OFICIAL</span><h2>{session?.access_token ? 'A tua conta está ligada' : 'A tua nuvem, aqui'}</h2><p className="connect-lead">Liga o Real-Debrid para sincronizar os teus torrents e reproduzir os conteúdos da tua conta.</p>
          {session?.access_token ? <div className="connected-panel"><div className="connected-user"><span className="connected-avatar">{rdUser?.username?.slice(0, 1)?.toUpperCase() || 'R'}</span><span><strong>{rdUser?.username || 'Conta Real-Debrid'}</strong><small>{rdUser?.type === 'premium' ? 'Conta Premium' : 'Ligação ativa'}{rdUser?.expiration ? ` · até ${formatDate(rdUser.expiration)}` : ''}</small></span><span className="connected-dot"><Icon name="check" size={13}/></span></div><div className="connected-actions"><button className="button button-primary" onClick={() => { setModal(null); setActivePage('downloads'); loadRdAccount(); }}>Abrir biblioteca <Icon name="chevron" size={15}/></button><button className="button button-danger-quiet" onClick={disconnectRealDebrid}>Desligar conta</button></div></div> : <div className="connect-steps"><div className="connect-step"><span>1</span><div><strong>Autoriza a ligação</strong><small>Vamos abrir o Real-Debrid numa janela segura da app.</small></div></div><div className="connect-step"><span>2</span><div><strong>Confirma o código</strong><small>Introduz o código apresentado na tua conta.</small></div></div><div className="connect-step"><span>3</span><div><strong>Pronto a ver</strong><small>A biblioteca fica disponível no StreamNexus.</small></div></div></div>}
          {deviceAuth && <div className="device-code-panel"><span className="eyebrow">CÓDIGO DE AUTORIZAÇÃO</span><strong>{deviceAuth.user_code}</strong><small>Introduz este código na janela Real-Debrid aberta pela app.</small></div>}
          {deviceStatus && <div className={`device-status ${deviceStatus.includes('expirou') || deviceStatus.includes('Não foi') || deviceStatus.includes('não foi') ? 'is-error' : ''}`}><span className="spinner"></span>{deviceStatus}</div>}
          {rdError && <div className="inline-error"><Icon name="alert" size={16}/>{rdError}</div>}
          {!session?.access_token && !deviceAuth && <button className="button button-primary connect-cta" onClick={connectRealDebrid} disabled={rdBusy}><Icon name="link" size={16}/>{rdBusy ? 'A iniciar ligação…' : 'Ligar ao Real-Debrid'}<Icon name="external" size={14}/></button>}
          {!session?.access_token && <p className="privacy-note"><Icon name="alert" size={14}/>{window.streamnexus?.isDesktop ? 'A sessão é guardada com a proteção de credenciais do Windows. Nunca pedimos o teu token privado.' : 'A sessão fica apenas neste separador. Nunca pedimos o teu token privado.'}</p>}
        </div>}

        {modal.type === 'magnet' && <div className="magnet-modal modal-card"><button className="modal-close" aria-label="Fechar" onClick={() => { setModal(null); setRdError(''); }}><Icon name="close"/></button><div className="modal-emblem magnet-emblem"><Icon name="link" size={24}/></div><span className="eyebrow">REAL-DEBRID · ADICIONAR CONTEÚDO</span><h2>{modal.title ? `Ver ${modal.title.title}` : 'Adicionar um magnet'}</h2><p className="connect-lead">Cola um magnet da tua coleção. O ficheiro é enviado diretamente para a tua conta Real-Debrid.</p><form onSubmit={addMagnet}><label className="input-label" htmlFor="magnet-input">Link magnet</label><textarea id="magnet-input" className="magnet-input" placeholder="magnet:?xt=urn:btih:…" rows="3" value={magnet} onChange={(event) => setMagnet(event.target.value)} autoFocus/><div className="magnet-hint"><span><Icon name="cloud" size={14}/>A ligação é feita diretamente à API Real-Debrid.</span><span>Não guardamos o link.</span></div>{rdError && <div className="inline-error"><Icon name="alert" size={16}/>{rdError}</div>}<button className="button button-primary connect-cta" disabled={magnetBusy || !session?.access_token || !magnet.trim()}><Icon name="plus" size={16}/>{magnetBusy ? 'A enviar para a nuvem…' : 'Adicionar à biblioteca'}<Icon name="chevron" size={15}/></button></form></div>}

        {modal.type === 'downloads' && <div className="modal-card small-confirm"><div className="modal-emblem magnet-emblem"><Icon name="cloud" size={24}/></div><span className="eyebrow">REAL-DEBRID</span><h2>Magnet enviado</h2><p>O conteúdo foi enviado para a tua conta. A transferência pode demorar alguns instantes a ficar pronta.</p><div className="small-confirm-actions"><button className="button button-quiet" onClick={() => setModal(null)}>Fechar</button><button className="button button-primary" onClick={() => { setModal(null); setActivePage('downloads'); loadRdAccount(); }}>Ver biblioteca <Icon name="chevron" size={14}/></button></div></div>}

        {modal.type === 'files' && <div className="modal-card files-modal"><button className="modal-close" aria-label="Fechar" onClick={() => setModal(null)}><Icon name="close"/></button><span className="eyebrow">REAL-DEBRID · VÁRIOS FICHEIROS</span><h2>Escolhe o que reproduzir</h2><p className="connect-lead">Este torrent tem {modal.entries.length} vídeos. Seleciona o episódio ou ficheiro que queres ver.</p><div className="files-list">{modal.entries.map((entry) => <button key={entry.linkIndex} className="files-option" onClick={() => openTorrentStream(modal.torrent, modal.titleHint, entry.linkIndex, modal.ctx || {})}><span><Icon name="play" size={14}/><strong title={entry.name}>{entry.name}</strong></span><small>{formatBytes(entry.bytes)}</small></button>)}</div></div>}

        {modal.type === 'player' && <div className={`player-modal modal-card ${playerControlsVisible ? '' : 'controls-hidden'} ${playing?.url ? '' : 'is-preparing'}`} onMouseMove={revealPlayerControls} onTouchStart={revealPlayerControls}>
          <div className="player-frame">
            {playing?.url && <video ref={playerVideoRef} autoPlay playsInline preload="auto" src={playing.hls ? undefined : playing.url} onClick={togglePlayerPlayback} onError={handleVideoError} onEnded={handleVideoEnded}>{subtitleShownUrl && <track key={subtitleShownUrl} kind="subtitles" srcLang={subtitleLanguage} label={subtitleLabel} src={subtitleShownUrl} default/>}</video>}
            {playerPlaybackError && <div className="player-playback-error"><strong>{playerPlaybackError}</strong><span>{playing?.live ? 'Esta emissão pode estar offline ou bloqueada.' : 'Confirma a ligação ou tenta abrir o ficheiro original.'}</span>{playing?.live && playing.live.channel.streams.length > 1 && <button className="button button-primary button-sm" onClick={() => playLiveChannel(playing.live.channel, (playing.live.index + 1) % playing.live.channel.streams.length)}><Icon name="refresh" size={13}/>Tentar outra emissão</button>}{window.streamnexus?.isDesktop && playing?.sourceUrl && !playing.transcoded && <button className="button button-primary button-sm" onClick={retryWithVideoConversion}><Icon name="refresh" size={13}/>Converter vídeo e reproduzir</button>}{playing?.sourceUrl && !playing?.live && <button className="button button-quiet button-sm" onClick={async () => { try { await window.streamnexus.openExternalPlayer(playing.sourceUrl); } catch (error) { setPlayerPlaybackError(getError(error)); } }}><Icon name="external" size={13}/>Abrir com VLC</button>}</div>}
            {playing?.nextEpisode && <div className="next-episode-card"><span className="eyebrow">A SEGUIR</span><strong>{epLabel(playing.nextEpisode.season, playing.nextEpisode.episode)}{playing.nextEpisode.name ? ` · ${playing.nextEpisode.name}` : ''}</strong>{nextCountdown !== null && <small className="next-episode-count">A reproduzir automaticamente em {Math.max(0, nextCountdown)} s</small>}<div><button className="button button-primary button-sm" onClick={() => startPlayback(playing.metadata, { episode: playing.nextEpisode, resumeAt: 0 })}><Icon name="play" size={14}/>Reproduzir</button><button className="button button-quiet button-sm" onClick={() => setPlaying((current) => (current ? { ...current, nextEpisode: null } : current))}>Agora não</button></div></div>}
            {slowConnection && !slowDismissed && !playerPlaybackError && playing?.url && !playing.live && playing.quality !== '720' && <div className="player-slow-banner"><strong>A ligação parece lenta</strong><span>O vídeo está a fazer pausas para carregar. Converter para uma qualidade menor reduz o débito necessário.</span><div>{playing.quality !== '1080' && <button className="button button-primary button-sm" onClick={() => changeQuality('1080')}>Converter para 1080p</button>}<button className="button button-primary button-sm" onClick={() => changeQuality('720')}>720p</button><button className="button button-quiet button-sm" onClick={() => setSlowDismissed(true)}>Agora não</button></div></div>}
            {!playing?.url && <div className="player-empty">{playing?.error ? <span className="player-error-icon"><Icon name="alert" size={26}/></span> : <span className="spinner"></span>}<strong>{playing?.error ? 'Não foi possível preparar o vídeo' : playing?.resuming ? 'A retomar a reprodução…' : playing?.converting ? 'A converter o vídeo para H.264…' : playing?.phase === 'searching' ? 'A procurar a melhor versão…' : playing?.phase === 'adding' ? `A enviar para o Real-Debrid${playing.attempt > 1 ? ` (versão ${playing.attempt} de ${playing.attemptTotal})` : ''}…` : 'A preparar reprodução…'}</strong><span>{playing?.error || (playing?.pending ? `${RD_STATUS_TEXT[playing.transferStatus] || 'A aguardar o Real-Debrid'}${playing.progress ? ` · ${Math.round(playing.progress)}%` : ''}` : 'A preparar o ficheiro de vídeo')}</span>{!playing?.error && playing?.releaseTitle && <small className="player-release">{playing.releaseTitle}{playing.switched ? ` · versão ${(playing.candidateIndex || 0) + 1}` : ''}</small>}{playing?.pending && <div className="player-progress"><i style={{ width: `${playing.progress || 3}%` }}/></div>}{playing?.error && <button className="button button-quiet button-sm" onClick={() => { setModal(null); setPlaying(null); }}>Fechar</button>}</div>}
          </div>
          {subtitleLine && <div className="subtitle-cue" aria-hidden="true">{subtitleLine.split('\n').map((line, index) => <span key={index}>{line}</span>)}</div>}
          <div className={`player-overlay ${playerControlsVisible ? '' : 'is-hidden'}`} onClick={(event) => { if (event.target === event.currentTarget) togglePlayerPlayback(); }}>
            <div className="player-topbar">
              <div className="player-title"><span className="eyebrow">{playing?.live ? `AO VIVO · ${(playing.live.channel.creator || '').toUpperCase()}` : 'A REPRODUZIR A PARTIR DA TUA NUVEM'}</span><strong>{playing?.title}</strong>{playing?.audioWarning && <small className="audio-hint">O áudio pode não ser compatível. {playing.audioWarning} Também podes abrir com VLC.</small>}</div>
              <div className="player-top-actions"><span className="quality-tag">{playing?.live ? 'AO VIVO' : 'REAL-DEBRID'}</span>{playing?.sourceUrl && !playing?.live && <button className="player-icon-button" aria-label="Abrir com VLC" title="Abrir com VLC" onClick={async () => { try { await window.streamnexus.openExternalPlayer(playing.sourceUrl); } catch (error) { setPlayerPlaybackError(getError(error)); } }}><Icon name="external" size={19}/></button>}<button className="player-icon-button" aria-label="Fechar filme" title="Fechar" onClick={() => { setModal(null); setPlaying(null); setSubtitleTrackUrl(''); setEmbeddedSubtitleTracks([]); }}><Icon name="close" size={21}/></button></div>
            </div>

            {subtitleMenuOpen && <section className="subtitle-panel">
              <div className="subtitle-panel-head"><div><span className="eyebrow">LEGENDAS</span><strong>{activeEmbeddedTrack ? `${activeEmbeddedTrack.label || activeEmbeddedTrack.language || 'Legendas'} · Original do ficheiro` : subtitleLabel || 'Português de Portugal'}</strong></div><button className="button button-quiet button-sm" onClick={() => findSubtitles(playing?.metadata, playing?.fileName, playing?.episode)} disabled={subtitleStatus === 'loading' || subtitleStatus === 'downloading'}><Icon name="refresh" size={13}/>{subtitleStatus === 'loading' ? 'A procurar…' : 'Procurar'}</button></div>
              {embeddedSubtitleTracks.length > 0 && <div className="embedded-subtitles"><span>Legendas originais do ficheiro</span><div><button className={!activeEmbeddedTrack && !subtitleTrackUrl ? 'active' : ''} onClick={disableSubtitles}>Desligadas</button>{embeddedSubtitleTracks.map((track, index) => <button key={`${track.language}-${track.label}-${index}`} className={activeEmbeddedTrack === track ? 'active' : ''} onClick={() => selectEmbeddedSubtitle(track)}>{track.label || track.language || `Faixa ${index + 1}`} <small>Original</small></button>)}</div></div>}
              {embeddedSubtitleTracks.length === 0 && /\b(subs?|subtitles?|legendas?)\b/i.test(playing?.fileName || '') && <p className="subtitle-message">O leitor web não expôs as legendas embutidas neste ficheiro. Podes selecioná-las ao abrir com VLC.</p>}
              {subtitleStatus === 'loading' && <p className="subtitle-message"><span className="spinner"></span>A procurar legendas em PT-PT e PT-BR…</p>}
              {subtitleStatus === 'downloading' && <p className="subtitle-message"><span className="spinner"></span>A descarregar a legenda…</p>}
              {subtitleStatus === 'error' && <p className="subtitle-message is-error">{subtitleError}<button className="text-link" onClick={() => { setIntegrationForm(integrationSettings); setIntegrationTest(''); setModal({ type: 'integrations' }); }}>Configurar OpenSubtitles</button></p>}
              {subtitleStatus === 'empty' && <p className="subtitle-message">Não foram encontradas legendas em português para este título.</p>}
              {subtitleStatus === 'selected' && <p className="subtitle-message is-ready"><Icon name="check" size={14}/>Legenda transferida e ativa no vídeo.</p>}
              {subtitleStatus === 'selected' && <div className="subtitle-diag">
                <small>{!subtitleInfo ? 'A ler a legenda…' : subtitleInfo.missing ? 'O leitor não criou a faixa das legendas.' : subtitleInfo.cues === null ? `Faixa criada (modo: ${subtitleInfo.mode}), o ficheiro ainda não foi lido.` : subtitleInfo.cues === 0 ? `A legenda foi lida, mas não tem falas (modo: ${subtitleInfo.mode}).` : `${subtitleInfo.cues} falas · de ${fmtClock(subtitleInfo.first)} a ${fmtClock(subtitleInfo.last)} · vídeo a ${fmtClock(subtitleInfo.now)} de ${fmtClock((playing?.totalDuration || playerVideoRef.current?.duration || 0))} · ${subtitleInfo.active ? `fala agora: “${String(subtitleInfo.active).slice(0, 60)}”` : 'sem fala neste momento'}`}</small>
                <span className="subtitle-delay">
                  <button className="button button-quiet button-sm" onClick={() => nudgeSubtitle(-5)}>−5 s</button>
                  <button className="button button-quiet button-sm" onClick={() => nudgeSubtitle(-0.5)}>−0,5 s</button>
                  <em>{subtitleDelay > 0 ? '+' : ''}{String(subtitleDelay).replace('.', ',')} s</em>
                  <button className="button button-quiet button-sm" onClick={() => nudgeSubtitle(0.5)}>+0,5 s</button>
                  <button className="button button-quiet button-sm" onClick={() => nudgeSubtitle(5)}>+5 s</button>
                </span>
                <span className="subtitle-align"><button className="button button-quiet button-sm" onClick={alignSubtitleHere}>A 1.ª fala é agora</button><small>Põe o vídeo no momento em que a primeira fala se ouve e carrega aqui.</small></span>
              </div>}
              {subtitleStatus === 'original' && <p className="subtitle-message is-ready"><Icon name="check" size={14}/>A usar as legendas originais incorporadas neste ficheiro.</p>}
              {playing?.pending && <p className="subtitle-message">As legendas ficam disponíveis assim que o Real-Debrid entregar o vídeo.</p>}
              {downloadedSubs.some((entry) => entry.forFile === (playing?.fileName || '')) && <div className="embedded-subtitles"><span>Legendas transferidas</span><div><button className={!subtitleTrackUrl && !activeEmbeddedTrack ? 'active' : ''} onClick={disableSubtitles}>Desligadas</button>{downloadedSubs.filter((entry) => entry.forFile === (playing?.fileName || '')).map((entry) => <button key={entry.fileId} className={activeSubId === entry.fileId ? 'active' : ''} onClick={() => activateSubtitle(entry)}>{entry.label} <small>{entry.language === 'pt-PT' ? 'PT-PT' : 'PT-BR'}{entry.release ? ` · ${entry.release.slice(0, 26)}` : ''}</small></button>)}</div></div>}
              {subtitleResults.length > 0 && <div className="subtitle-results">{subtitleResults.map((subtitle) => <button key={`${subtitle.fileId}-${subtitle.fileName}`} className={`subtitle-option ${subtitle.language === 'pt-PT' ? 'preferred' : ''} ${activeSubId === subtitle.fileId ? 'is-active' : ''}`} onClick={() => chooseSubtitle(subtitle)}><span><strong>{subtitle.label}</strong><small>{subtitle.match >= 3 ? 'Versão parecida com o ficheiro · ' : ''}{subtitle.fileName}{subtitle.release && subtitle.release !== subtitle.fileName ? ` · ${subtitle.release}` : ''}{subtitle.source ? ` · ${subtitle.source}` : ''}</small></span><span>{activeSubId === subtitle.fileId ? <><Icon name="check" size={13}/> Ativa</> : downloadedSubs.some((entry) => entry.fileId === subtitle.fileId && entry.forFile === (playing?.fileName || '')) ? 'Transferida' : <>{subtitle.language === 'pt-PT' ? 'PT-PT · Preferida' : 'PT-BR'} <Icon name="download" size={13}/></>}</span></button>)}</div>}
            </section>}

            <div className="player-bottom">
              <input className="player-seek" aria-label="Posição do filme" type="range" min="0" max={(pipedSeek ? playing.totalDuration : 0) || playerDuration || playerSeekEnd || 1} step="0.1" value={pipedSeek ? (seekDraft ?? (playing.offset || 0) + playerCurrentTime) : playerDuration || playerSeekEnd ? Math.min(playerCurrentTime, playerDuration || playerSeekEnd) : 0} disabled={!pipedSeek && !playerDuration && !playerSeekEnd} onChange={(event) => (pipedSeek ? setSeekDraft(Number(event.target.value)) : setPlayerSeekPosition(event.target.value))} onPointerUp={() => { if (pipedSeek && seekDraft !== null) { resumePlayback(seekDraft, true); setSeekDraft(null); } }} onKeyUp={() => { if (pipedSeek && seekDraft !== null) { resumePlayback(seekDraft, true); setSeekDraft(null); } }}/>
              <div className="player-control-row">
                <div className="player-control-group"><button className="player-icon-button" aria-label={playerPlaying ? 'Pausar' : 'Reproduzir'} onClick={togglePlayerPlayback}><Icon name={playerPlaying ? 'pause' : 'play'} size={21}/></button><button className="player-icon-button" aria-label="Recuar 10 segundos" onClick={() => seekPlayer(-10)}><Icon name="skipBack" size={20}/></button><button className="player-icon-button" aria-label="Avançar 10 segundos" onClick={() => seekPlayer(10)}><Icon name="skipForward" size={20}/></button><span className="player-time">{formatPlaybackTime(pipedSeek ? (seekDraft ?? (playing.offset || 0) + playerCurrentTime) : playerCurrentTime)} <i>/</i> {pipedSeek ? formatPlaybackTime(playing.totalDuration) : playerDuration ? formatPlaybackTime(playerDuration) : 'AO VIVO'}</span></div>
                <div className="player-control-group player-control-end"><button className="player-icon-button" aria-label={playerMuted ? 'Ativar som' : 'Silenciar'} onClick={togglePlayerMute}><Icon name={playerMuted || playerVolume === 0 ? 'volumeOff' : 'volume'} size={20}/></button><input className="player-volume" aria-label="Volume" type="range" min="0" max="1" step="0.05" value={playerMuted ? 0 : playerVolume} onChange={(event) => { const value = Number(event.target.value); const video = playerVideoRef.current; if (video) { video.volume = value; video.muted = value === 0; } setPlayerVolume(value); setPlayerMuted(value === 0); }}/>{!playing?.live && playing?.sourceUrl && playing?.audioTracks?.length > 1 && <span className="quality-wrap"><button className={`player-icon-button ${audioMenuOpen ? 'active' : ''}`} aria-label="Idioma do áudio" title="Idioma do áudio" onClick={() => { setAudioMenuOpen((open) => !open); setQualityMenuOpen(false); setSubtitleMenuOpen(false); revealPlayerControls(); }}><Icon name="volume" size={20}/></button>{audioMenuOpen && <div className="quality-menu audio-menu"><small>ÁUDIO</small>{playing.audioTracks.map((track) => <button key={track.index} className={(playing.audioIndex ?? 0) === track.index ? 'active' : ''} onClick={() => changeAudio(track.index)}><b>{track.label}</b>{track.title && track.title.toLowerCase() !== track.label.toLowerCase() ? ` · ${track.title}` : ''}<em>{[track.codec.toUpperCase(), track.channels].filter(Boolean).join(' ')}</em></button>)}</div>}</span>}{!playing?.live && playing?.sourceUrl && <span className="quality-wrap"><button className={`player-icon-button ${qualityMenuOpen ? 'active' : ''}`} aria-label="Qualidade" title="Qualidade" onClick={() => { setQualityMenuOpen((open) => !open); setAudioMenuOpen(false); setSubtitleMenuOpen(false); revealPlayerControls(); }}><Icon name="settings" size={20}/></button>{qualityMenuOpen && <div className="quality-menu"><small>QUALIDADE</small>{[['original', 'Original'], ['1080', '1080p'], ['720', '720p']].map(([key, label]) => <button key={key} className={(playing.quality || 'original') === key ? 'active' : ''} onClick={() => changeQuality(key)}>{label}</button>)}</div>}</span>}<button className={`player-icon-button captions-button ${subtitleMenuOpen ? 'active' : ''}`} aria-label="Legendas" aria-expanded={subtitleMenuOpen} title="Legendas" onClick={() => { setSubtitleMenuOpen((open) => !open); revealPlayerControls(); }}><Icon name="captions" size={22}/></button><button className="player-icon-button" aria-label={playerFullscreen ? 'Sair de ecrã inteiro' : 'Ecrã inteiro'} title={playerFullscreen ? 'Sair de ecrã inteiro' : 'Ecrã inteiro'} onClick={togglePlayerFullscreen}><Icon name="fullscreen" size={20}/></button></div>
              </div>
            </div>
          </div>
        </div>}
      </div>}
    </div>
    </PreviewContext.Provider>
    </WatchContext.Provider>
  );
}

function formatBytes(bytes = 0) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return 'Tamanho desconhecido';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** order)).toFixed(order > 1 ? 1 : 0)} ${units[order]}`;
}

function ReleaseSearchResults({ search, categoryKey, connected, busyId, onAdd }) {
  const [page, setPage] = useState(1);
  const category = SEARCH_CATEGORIES[categoryKey] || SEARCH_CATEGORIES.movies;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil((search?.items?.length || 0) / pageSize));
  const firstItem = (page - 1) * pageSize;
  const visibleItems = (search?.items || []).slice(firstItem, firstItem + pageSize);
  useEffect(() => { setPage(1); }, [search?.titleId, search?.categoryKey, search?.status, search?.items?.length]);
  if (!search || search.categoryKey !== categoryKey) return <div className="release-results-state"><Icon name="search" size={17}/><p>Pesquisa lançamentos de {category.label.toLowerCase()} nos indexadores.</p></div>;
  if (search.status === 'loading') return <div className="release-results-state"><span className="spinner"></span><p>A consultar os indexadores…</p></div>;
  if (search.status === 'error') return <div className="release-results-state is-error"><Icon name="alert" size={17}/><p>{search.message}</p></div>;
  if (search.status === 'empty') return <div className="release-results-state"><Icon name="search" size={17}/><p>Sem resultados. Verifica se tens indexadores configurados para a categoria {category.label.toLowerCase()} no Prowlarr.</p></div>;
  return <div className="release-results">
    <div className="release-results-heading"><strong>{search.collectionTitle ? `${search.collectionTitle}: ` : ''}{search.items.length} {search.items.length === 1 ? 'lançamento encontrado' : 'lançamentos encontrados'}</strong><span>{category.manager} · Prowlarr{search.query ? ` · ${search.query}` : ''}</span></div>
    <div className="release-results-list">{visibleItems.map((release) => <article className="release-card" key={release.id}><div className="release-info"><strong title={release.title}>{release.title}</strong><span>{release.indexer} <i>·</i> {formatBytes(release.size)} <i>·</i> {release.seeders == null ? 'Seeders n/d' : `${release.seeders} seeders`}</span></div><span className={`release-source ${release.hasMagnet ? 'has-magnet' : ''}`}>{release.hasMagnet ? 'MAGNET' : 'TORRENT'}</span><button className="button button-primary button-sm" disabled={!release.canGrab || busyId === release.id} onClick={() => onAdd(release)}><Icon name={busyId === release.id ? 'refresh' : 'cloud'} size={14}/>{busyId === release.id ? 'A enviar…' : connected ? 'Adicionar ao RD' : 'Ligar RD'}</button></article>)}</div>
    {totalPages > 1 && <div className="release-pagination"><span>{firstItem + 1}-{Math.min(firstItem + pageSize, search.items.length)} de {search.items.length}</span><div><button className="button button-quiet" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button><small>{page} / {totalPages}</small><button className="button button-quiet" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Seguinte</button></div></div>}
  </div>;
}

function ReleaseSearchPanel({ title, search, connected, busyId, configured, onRefresh, onConfigure, onAdd }) {
  const categoryKey = titleCategory(title);
  const current = search?.titleId === title.id ? search : null;
  return <section className="release-panel">
    <div className="release-panel-heading"><div><span className="eyebrow"><span className="pulse-dot"></span> PESQUISA NOS INDEXADORES</span><strong>{SEARCH_CATEGORIES[categoryKey].manager} · enviar ao Real-Debrid</strong></div><div>{configured && <button className="rd-search-refresh" onClick={onRefresh} disabled={current?.status === 'loading'} aria-label="Pesquisar novamente"><Icon name="refresh" size={15}/></button>}<button className="rd-search-refresh" onClick={onConfigure} aria-label="Configurar Prowlarr"><Icon name="settings" size={15}/></button></div></div>
    {!configured ? <div className="release-results-state"><p>Configura o Prowlarr para procurar lançamentos e magnets para este título.</p><button className="text-link" onClick={onConfigure}>Configurar fontes <Icon name="chevron" size={14}/></button></div> : !current || current.status === 'loading' ? <div className="release-results-state"><span className="spinner"></span><p>A pesquisar “{title.searchQuery || title.original || title.title}” no Prowlarr…</p></div> : <ReleaseSearchResults search={current} categoryKey={categoryKey} connected={connected} busyId={busyId} onAdd={onAdd}/>}
  </section>;
}

function RdTitleMatches({ title, search, connected, onRefresh, onConnect, onAdd, onOpen }) {
  const current = search?.titleId === title.id ? search : null;
  const matches = current?.matches || [];
  const loading = current?.status === 'loading';
  const getStatus = (status) => status === 'downloaded' ? 'Pronto a ver' : status === 'waiting_files_selection' ? 'Selecionar ficheiros' : status === 'downloading' ? 'A transferir' : status === 'queued' ? 'Na fila' : status === 'dead' || status === 'error' ? 'Indisponível' : 'A preparar';
  return <section className="rd-title-search">
    <div className="rd-title-search-head"><div><span className="eyebrow"><span className="pulse-dot"></span> NA TUA CONTA REAL-DEBRID</span><strong>Procurar na tua biblioteca</strong></div>{connected && <button className="rd-search-refresh" onClick={onRefresh} disabled={loading} aria-label="Pesquisar novamente"><Icon name="refresh" size={15}/></button>}</div>
    {!connected ? <div className="rd-search-message"><p>Liga o Real-Debrid para procurar este título entre os magnets da tua conta.</p><button className="text-link" onClick={onConnect}>Ligar conta <Icon name="chevron" size={14}/></button></div>
      : loading || !current ? <div className="rd-search-message"><span className="spinner"></span><p>A procurar nos teus torrents guardados…</p></div>
        : current.status === 'error' ? <div className="rd-search-message is-error"><Icon name="alert" size={15}/><p>{current.message}</p><button className="text-link" onClick={onRefresh}>Tentar novamente</button></div>
          : current.status === 'empty' ? <div className="rd-search-message"><p>Não encontrámos este título nos teus torrents Real-Debrid.</p><small>A API não pesquisa magnets globais por nome. Podes adicionar um magnet teu à biblioteca.</small><button className="button button-quiet button-sm" onClick={onAdd}><Icon name="plus" size={14}/>Adicionar magnet</button></div>
            : <div className="rd-match-list">{matches.slice(0, 5).map((torrent) => <div className="rd-match-item" key={torrent.id}><span className={`rd-match-status ${torrent.status === 'downloaded' ? 'ready' : ''}`}><i></i>{getStatus(torrent.status)}</span><strong title={torrent.filename || torrent.original_filename}>{torrent.filename || torrent.original_filename || title.title}</strong><button className={`button ${torrent.status === 'downloaded' ? 'button-primary' : 'button-quiet'} button-sm`} onClick={() => onOpen(torrent)}>{torrent.status === 'downloaded' ? <><Icon name="play" size={13}/>Reproduzir</> : 'Abrir'}</button></div>)}{matches.length > 5 && <small className="rd-more-matches">Mais {matches.length - 5} correspondências na tua biblioteca.</small>}</div>}
  </section>;
}

function TorrentRow({ torrent, onPlay, onSelect, onDelete }) {
  const status = torrent.status === 'downloaded' ? 'Pronto a ver' : torrent.status === 'waiting_files_selection' ? 'Escolher ficheiros' : torrent.status === 'magnet_conversion' ? 'A preparar' : torrent.status === 'downloading' ? 'A transferir' : torrent.status === 'queued' ? 'Na fila' : torrent.status === 'dead' || torrent.status === 'error' ? 'Indisponível' : 'A processar';
  const isReady = torrent.status === 'downloaded';
  const needsSelection = torrent.status === 'waiting_files_selection';
  const isDownloading = ['magnet_conversion', 'downloading', 'queued'].includes(torrent.status);
  const progress = isReady ? 100 : Number(torrent.progress || 0);
  const title = torrent.filename || torrent.original_filename || 'Magnet sem nome';
  const size = Number(torrent.bytes) ? `${(Number(torrent.bytes) / (1024 ** 3)).toFixed(1)} GB` : '-';
  return <div className="torrent-row"><div className={`torrent-cover ${isReady ? 'is-ready' : ''}`}><Icon name={isReady || isDownloading ? 'play' : 'film'} size={18}/></div><div className="torrent-main"><strong title={title}>{title}</strong><span>{size}<i>·</i> Adicionado {formatDate(torrent.added)}</span></div><div className="torrent-progress"><div className="torrent-progress-label"><span className={isReady ? 'ready-status' : ''}><i></i>{status}</span><small>{progress}%</small></div><div className="progress-track"><span style={{ width: `${progress}%` }}></span></div></div><div className="torrent-actions">{isReady ? <button className="button button-primary button-sm" onClick={onPlay}><Icon name="play" size={14}/>Reproduzir</button> : needsSelection ? <button className="button button-quiet button-sm" onClick={onSelect}>Selecionar ficheiros</button> : isDownloading ? <button className="button button-quiet button-sm" onClick={onPlay}><Icon name="play" size={14}/>Abrir</button> : <button className="button button-quiet button-sm" onClick={onSelect}><Icon name="refresh" size={14}/>Ver estado</button>}<button className="torrent-delete" aria-label={`Remover ${title}`} onClick={onDelete}><Icon name="trash" size={15}/></button></div></div>;
}

// Raiz: escolhe o perfil (ecrã "Quem está a ver?") e remonta a app ao trocar, para carregar os dados desse perfil.
export default function App() {
  const [profiles, setProfiles] = useState(loadProfiles);
  const [activeId, setActiveId] = useState(() => { const list = loadProfiles(); return list.length > 1 ? null : list[0].id; });
  const [previousId, setPreviousId] = useState('');
  const [managing, setManaging] = useState(false);
  // Primeiro arranque na app desktop, sem nada configurado: pede o código de convite.
  const [welcome, setWelcome] = useState(() => (window.streamnexus?.isDesktop && !welcomeDone() ? 'checking' : 'no'));
  useEffect(() => {
    if (welcome !== 'checking') return;
    window.streamnexus.loadIntegrations()
      .then((settings) => setWelcome(settings.tmdbApiKey || settings.prowlarrUrl ? 'no' : 'show'), () => setWelcome('no'));
  }, [welcome]);
  if (welcome === 'checking') return null;
  if (welcome === 'show') return <WelcomeScreen onDone={() => setWelcome('no')}/>;
  if (!activeId) {
    return <ProfileGate key={managing ? 'manage' : 'choose'} profiles={profiles} onProfiles={setProfiles} startManaging={managing} canCancel={Boolean(previousId && profiles.some((profile) => profile.id === previousId))} onCancel={() => { setManaging(false); setActiveId(previousId); }} onChoose={(id) => { setManaging(false); setActiveProfile(id); setActiveId(id); }}/>;
  }
  setActiveProfile(activeId);
  const profile = profiles.find((entry) => entry.id === activeId) || profiles[0];
  return <AppShell key={profile.id} profile={profile} profiles={profiles} onSwitchProfile={() => { setPreviousId(profile.id); setManaging(false); setActiveId(null); }} onManageProfiles={() => { setPreviousId(profile.id); setManaging(true); setActiveId(null); }}/>;
}
