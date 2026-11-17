import { useEffect, useMemo, useState } from 'react';
import { Icon, PosterCard, ScrollRow } from './ui.jsx';
import { musicControls, useMusicState } from './musicStore.js';
import { epKey, epLabel, resumePointFor, watchInfo } from './watch.js';

const GENRE_CHOICES = ['Ação', 'Aventura', 'Animação', 'Comédia', 'Crime', 'Documentário', 'Drama', 'Família', 'Fantasia', 'Ficção científica', 'Mistério', 'Romance', 'Terror', 'Thriller', 'Guerra', 'História', 'Música'];
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const clock = (seconds) => { const total = Math.max(0, Math.round(Number(seconds) || 0)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
const pad = (value) => String(value).padStart(2, '0');
const isoOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dateOf = (iso) => new Date(`${iso}T12:00:00`);
const todayIso = () => isoOf(new Date());
const daysBetween = (fromIso, toIso) => Math.round((dateOf(toIso) - dateOf(fromIso)) / 86400000);
const relativeDay = (iso) => {
  const diff = daysBetween(todayIso(), iso);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  if (diff < 0) return `Há ${-diff} dias`;
  return diff < 7 ? `Em ${diff} dias` : dateOf(iso).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' });
};
const greetingFor = () => { const hour = new Date().getHours(); return hour < 6 ? 'Boa madrugada' : hour < 13 ? 'Bom dia' : hour < 20 ? 'Boa tarde' : 'Boa noite'; };

// Cache simples por sessão (por perfil) para não repetir pedidos ao voltar ao Início
const cache = new Map();
async function cached(key, loader, ttl = 10 * 60 * 1000) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const seriesSnapshotFrom = (show, watch, savedItems) => watch[show.id] || savedItems[show.id] || { id: show.id, tmdbId: show.tmdbId, tmdbType: 'tv', type: 'Série', title: show.name, original: show.name, year: '', poster: show.poster, backdrop: show.backdrop, genre: '', genres: [] };

export function HomePage({ profile, watch, saved, savedItems, reading, trending, taste, onTaste, musicHistory, onOpen, onResume, onPlayEpisode, onToggleSave, onNavigate }) {
  const entries = useMemo(() => Object.values(watch).filter((entry) => !entry.adult).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [watch]);
  const savedList = useMemo(() => Object.values(savedItems).filter((item) => !item.adult), [savedItems]);

  // ---- continuar a ver ----
  const continueItems = useMemo(() => entries.map((entry) => ({ entry, info: watchInfo(watch, entry) })).filter(({ entry, info }) => info && (info.inProgress || (entry.type === 'Série' && info.started))).slice(0, 12), [entries, watch]);

  // ---- séries acompanhadas e calendário ----
  const trackedSeries = useMemo(() => {
    const map = new Map();
    entries.filter((entry) => entry.type === 'Série' && entry.tmdbId && Object.keys(entry.episodes || {}).length).forEach((entry) => map.set(entry.tmdbId, entry));
    savedList.filter((item) => item.type === 'Série' && item.tmdbId).forEach((item) => { if (!map.has(item.tmdbId)) map.set(item.tmdbId, item); });
    return [...map.values()];
  }, [entries, savedList]);
  const trackedKey = trackedSeries.map((item) => item.tmdbId).sort().join(',');
  const [schedule, setSchedule] = useState({ status: 'idle', items: [] });
  useEffect(() => {
    if (!trackedKey || !window.streamnexus?.isDesktop) { setSchedule({ status: 'idle', items: [] }); return undefined; }
    let active = true;
    setSchedule((current) => ({ ...current, status: 'loading' }));
    cached(`schedule|${trackedKey}`, () => window.streamnexus.fetchHomeSchedule({ ids: trackedKey.split(',').map(Number) }), 30 * 60 * 1000)
      .then((items) => { if (active) setSchedule({ status: 'ready', items }); })
      .catch(() => { if (active) setSchedule({ status: 'error', items: [] }); });
    return () => { active = false; };
  }, [trackedKey]);

  // ---- gostos: sementes, géneros e exclusões para as sugestões ----
  const taste_ = taste?.genres || [];
  const profileSignals = useMemo(() => {
    const weights = new Map();
    const bump = (list, amount) => (list || []).filter(Boolean).forEach((name) => weights.set(name, (weights.get(name) || 0) + amount));
    entries.forEach((entry) => bump(entry.genres?.length ? entry.genres : [entry.genre], entry.watched ? 2 : 1));
    savedList.forEach((item) => bump(item.genres?.length ? item.genres : [item.genre], 1));
    taste_.forEach((name) => weights.set(name, (weights.get(name) || 0) + 4));
    const genres = [...weights.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 3);
    const seedPool = [...entries.filter((entry) => entry.tmdbId && (entry.watched || (entry.position || 0) > 300 || Object.keys(entry.episodes || {}).length)), ...savedList.filter((item) => item.tmdbId)];
    const seeds = [...new Map(seedPool.map((entry) => [entry.id, entry])).values()].slice(0, 4).map((entry) => ({ tmdbId: entry.tmdbId, tmdbType: entry.tmdbType || (entry.type === 'Série' ? 'tv' : 'movie'), title: entry.title }));
    const exclude = [...new Set([...Object.keys(watch), ...saved])];
    return { genres, seeds, exclude, basedOn: seeds.length };
  }, [entries, savedList, taste_, watch, saved]);
  const recKey = JSON.stringify([profileSignals.seeds.map((seed) => seed.tmdbId), profileSignals.genres, profile.id]);
  const [recs, setRecs] = useState({ status: 'idle', data: null });
  const [refreshTick, setRefreshTick] = useState(0);
  const [kind, setKind] = useState('all');
  useEffect(() => {
    if (!window.streamnexus?.isDesktop) return undefined;
    let active = true;
    setRecs((current) => ({ ...current, status: 'loading' }));
    cached(`rec|${recKey}|${refreshTick}`, () => window.streamnexus.fetchHomeRecommendations({ seeds: profileSignals.seeds, genres: profileSignals.genres, exclude: profileSignals.exclude }), 20 * 60 * 1000)
      .then((data) => { if (active) setRecs({ status: 'ready', data }); })
      .catch((error) => { if (active) setRecs({ status: 'error', data: null, message: error?.message }); });
    return () => { active = false; };
  }, [recKey, refreshTick]);
  const [tasteOpen, setTasteOpen] = useState(false);
  const filterKind = (items) => (kind === 'all' ? items : items.filter((item) => item.type === (kind === 'movie' ? 'Filme' : 'Série')));

  // ---- leitura ----
  const shelf = useMemo(() => Object.values(reading.shelf), [reading]);
  const readingNow = useMemo(() => shelf.filter((entry) => entry.status === 'reading').sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)), [shelf]);
  const readingQueue = useMemo(() => shelf.filter((entry) => entry.status === 'want').sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)).slice(0, 6), [shelf]);
  const bookGenres = useMemo(() => {
    const weights = new Map();
    shelf.forEach((entry) => { if (entry.book?.genre) weights.set(entry.book.genre, (weights.get(entry.book.genre) || 0) + (entry.status === 'read' ? 3 : entry.status === 'reading' ? 2 : 1)); });
    return [...weights.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 2);
  }, [shelf]);
  const [bookSuggestions, setBookSuggestions] = useState([]);
  useEffect(() => {
    if (!window.streamnexus?.isDesktop) return undefined;
    let active = true;
    const onShelf = new Set(shelf.map((entry) => entry.book?.id));
    (async () => {
      let items = [];
      try {
        if (bookGenres.length) {
          const pages = await Promise.all(bookGenres.map((genre) => cached(`books|${genre}`, () => window.streamnexus.feedCategory({ kind: 'books', category: genre, cursor: 0 }))));
          items = pages.flatMap((page) => page.items || []);
        } else {
          const first = await cached('books|default', () => window.streamnexus.feedShelves({ kind: 'books', offset: 0, count: 1 }));
          items = first.shelves?.[0]?.items || [];
        }
      } catch { items = []; }
      if (active) setBookSuggestions([...new Map(items.filter((item) => item.poster && !onShelf.has(item.id)).map((item) => [item.id, item])).values()].slice(0, 16));
    })();
    return () => { active = false; };
  }, [bookGenres.join('|'), shelf.length]);

  // ---- música: sugestões a partir do histórico do perfil ----
  const [musicSuggestions, setMusicSuggestions] = useState([]);
  const musicKey = (musicHistory || []).slice(0, 6).map((entry) => entry.id).join(',');
  useEffect(() => {
    if (!window.streamnexus?.isDesktop) return undefined;
    let active = true;
    const played = new Set((musicHistory || []).map((entry) => entry.id));
    (async () => {
      let items = [];
      try {
        const artists = [...new Set((musicHistory || []).map((entry) => String(entry.creator || '').split(',')[0].trim()).filter(Boolean))].slice(0, 2);
        if (artists.length) {
          const pages = await Promise.all(artists.map((artist) => cached(`music|${artist}`, () => window.streamnexus.feedSearch({ kind: 'music', query: artist, cursor: 0 }))));
          items = pages.flatMap((page) => page.items || []);
        } else {
          const first = await cached('music|default', () => window.streamnexus.feedShelves({ kind: 'music', offset: 0, count: 1 }));
          items = first.shelves?.[0]?.items || [];
        }
      } catch { items = []; }
      if (active) setMusicSuggestions([...new Map(items.filter((item) => item.poster && !played.has(item.id)).map((item) => [item.id, item])).values()].slice(0, 8));
    })();
    return () => { active = false; };
  }, [musicKey]);

  const stats = {
    movies: entries.filter((entry) => entry.type === 'Filme' && entry.watched).length,
    episodes: entries.reduce((sum, entry) => sum + Object.values(entry.episodes || {}).filter((episode) => episode.watched).length, 0),
    series: entries.filter((entry) => entry.type === 'Série' && Object.keys(entry.episodes || {}).length).length,
    books: readingNow.length,
  };
  const nothingYet = !continueItems.length && !trackedSeries.length && !shelf.length;

  return <div className="home-hub page-in">
    <header className="hub-head">
      <div><span className="eyebrow">O TEU CANTO · {profile.name.toUpperCase()}</span><h1>{greetingFor()}, {profile.name}</h1></div>
      <div className="hub-stats" aria-label="Resumo">
        <button onClick={() => onNavigate('history')}><b>{stats.movies}</b><small>filmes vistos</small></button>
        <button onClick={() => onNavigate('history')}><b>{stats.episodes}</b><small>episódios vistos</small></button>
        <button onClick={() => onNavigate('history')}><b>{stats.series}</b><small>séries em curso</small></button>
        <button onClick={() => onNavigate('books')}><b>{stats.books}</b><small>livros a ler</small></button>
      </div>
    </header>

    <div className="hub-grid">
      <div className="hub-main">
        {nothingYet && <section className="hub-welcome"><Icon name="spark" size={20}/><div><strong>Isto vai ficar com a tua cara</strong><p>À medida que vires filmes e séries, ouvires música e leres livros, o Início passa a mostrar onde ficaste, o que estreia e sugestões feitas para ti. Para começar, escolhe os géneros de que gostas nas sugestões abaixo.</p></div></section>}

        {continueItems.length > 0 && <section className="hub-section">
          <div className="hub-title"><h2>Continuar a ver</h2><button className="text-link" onClick={() => onNavigate('history')}>Ver tudo</button></div>
          <ScrollRow className="hub-continue-row">{continueItems.map(({ entry, info }) => {
            const point = entry.type === 'Série' ? resumePointFor(entry) : null;
            const label = entry.type === 'Série'
              ? (point ? (point.watched ? `Seguinte a ${epLabel(point.season, point.episode)}` : `${epLabel(point.season, point.episode)}${point.position > 30 ? ` · parado em ${clock(point.position)}` : ''}`) : 'Série')
              : `Parado em ${clock(entry.position)}`;
            return <article className="hub-continue-card" key={entry.id}>
              <button className="hub-continue-media" onClick={() => onResume(entry)} style={{ backgroundImage: `url(${entry.backdrop || entry.poster})` }} aria-label={`Retomar ${entry.title}`}>
                <span className="hub-continue-play"><Icon name="play" size={18}/></span>
                {info.percent > 0 && !(entry.type === 'Série' && point?.watched) && <i className="hub-continue-progress"><b style={{ width: `${Math.round(info.percent * 100)}%` }}></b></i>}
                <em>{entry.type}</em>
              </button>
              <button className="hub-continue-info" onClick={() => onOpen(entry)}><strong title={entry.title}>{entry.title}</strong><small>{label}</small></button>
            </article>;
          })}</ScrollRow>
        </section>}

        <ReleaseCalendar schedule={schedule} watch={watch} savedItems={savedItems} onOpen={onOpen} onPlayEpisode={onPlayEpisode} hasTracked={trackedSeries.length > 0}/>

        <section className="hub-section">
          <div className="hub-title">
            <div><h2>Sugestões para ti</h2><small className="hub-sub">{profileSignals.basedOn ? `Com base no que viste e guardaste (${profileSignals.basedOn} ${profileSignals.basedOn === 1 ? 'título' : 'títulos'})${taste_.length ? ' e nos teus gostos' : ''}.` : taste_.length ? 'Com base nos géneros que escolheste.' : 'Ainda sem histórico: mostramos o que está em alta. Escolhe géneros para afinar.'}</small></div>
            <div className="hub-title-actions">
              <div className="hub-chips" role="tablist" aria-label="Tipo">{[['all', 'Tudo'], ['movie', 'Filmes'], ['tv', 'Séries']].map(([key, label]) => <button key={key} role="tab" aria-selected={kind === key} className={kind === key ? 'active' : ''} onClick={() => setKind(key)}>{label}</button>)}</div>
              <button className={`hub-icon-btn ${tasteOpen ? 'active' : ''}`} onClick={() => setTasteOpen((open) => !open)} title="Os teus gostos" aria-label="Os teus gostos"><Icon name="settings" size={16}/></button>
              <button className="hub-icon-btn" onClick={() => setRefreshTick((tick) => tick + 1)} title="Atualizar sugestões" aria-label="Atualizar sugestões"><Icon name="refresh" size={16}/></button>
            </div>
          </div>
          {tasteOpen && <div className="hub-taste"><span>Géneros de que gostas</span><div>{GENRE_CHOICES.map((name) => <button key={name} className={taste_.includes(name) ? 'active' : ''} aria-pressed={taste_.includes(name)} onClick={() => onTaste({ ...taste, genres: taste_.includes(name) ? taste_.filter((entry) => entry !== name) : [...taste_, name] })}>{name}</button>)}</div></div>}
          {recs.status === 'loading' && !recs.data && <p className="rd-empty-text"><span className="spinner"></span> A preparar sugestões…</p>}
          {recs.status === 'error' && <p className="rd-empty-text">Não foi possível obter sugestões agora. {recs.message || ''}</p>}
          {recs.data && <>
            {recs.data.groups.map((group) => { const items = filterKind(group.items); return items.length ? <div className="hub-rail" key={group.seed.id}><h3>Porque viste <em>{group.seed.title}</em></h3><ScrollRow className="poster-row">{items.map((item, index) => <PosterCard key={item.id} item={item} index={index} saved={saved.includes(item.id)} onOpen={() => onOpen(item)} onSave={() => onToggleSave(item.id, item)}/>)}</ScrollRow></div> : null; })}
            {filterKind(recs.data.mixed).length > 0 && <div className="hub-rail"><h3>{recs.data.personalized ? 'Escolhidos para ti' : 'Em alta esta semana'}</h3><ScrollRow className="poster-row">{filterKind(recs.data.mixed).map((item, index) => <PosterCard key={item.id} item={item} index={index} saved={saved.includes(item.id)} onOpen={() => onOpen(item)} onSave={() => onToggleSave(item.id, item)}/>)}</ScrollRow></div>}
          </>}
        </section>

        <section className="hub-section">
          <div className="hub-title"><h2>Leitura</h2><button className="text-link" onClick={() => onNavigate('books')}>Abrir a estante</button></div>
          {readingNow.length > 0 ? <div className="hub-reading-now">{readingNow.slice(0, 3).map((entry) => <button key={entry.book.id} className="hub-book" onClick={() => onOpen(entry.book)}>
            <span className="hub-book-cover" style={entry.book.poster ? { backgroundImage: `url(${entry.book.poster})` } : undefined}><Icon name="book" size={18}/></span>
            <span className="hub-book-info"><strong title={entry.book.title}>{entry.book.title}</strong><small>{entry.book.creator || 'Autor desconhecido'}</small><span className="hub-book-bar"><i style={{ width: `${Math.min(100, entry.progress || 0)}%` }}></i></span><small>{entry.progress || 0}% lido</small></span>
          </button>)}</div> : <p className="hub-empty">Não estás a ler nenhum livro. Marca um como “A ler” na estante e ele aparece aqui.</p>}
          {readingQueue.length > 0 && <div className="hub-queue"><h3>Sequência de leitura</h3><ol>{readingQueue.map((entry, index) => <li key={entry.book.id}><button onClick={() => onOpen(entry.book)}><span className="hub-queue-n">{index + 1}</span><span className="hub-queue-cover" style={entry.book.poster ? { backgroundImage: `url(${entry.book.poster})` } : undefined}></span><span><strong>{entry.book.title}</strong><small>{entry.book.creator}</small></span>{index === 0 && <em>A seguir</em>}</button></li>)}</ol></div>}
          {bookSuggestions.length > 0 && <div className="hub-rail"><h3>{bookGenres.length ? `Sugestões de leitura · ${bookGenres.join(' e ')}` : 'Para começar a ler'}</h3><ScrollRow className="poster-row">{bookSuggestions.map((item, index) => <PosterCard key={item.id} item={item} index={index} saved={false} hideSave onOpen={() => onOpen(item)}/>)}</ScrollRow></div>}
        </section>

        {trending.length > 0 && <section className="hub-section">
          <div className="hub-title"><h2>Em alta esta semana</h2></div>
          <ScrollRow className="poster-row">{trending.slice(0, 20).map((item, index) => <PosterCard key={item.id} item={item} index={index} saved={saved.includes(item.id)} onOpen={() => onOpen(item)} onSave={() => onToggleSave(item.id, item)}/>)}</ScrollRow>
        </section>}
      </div>

      <aside className="hub-aside"><MusicDock suggestions={musicSuggestions} onOpen={onOpen} onNavigate={onNavigate}/></aside>
    </div>
  </div>;
}

// ---------- calendário de estreias ----------
function ReleaseCalendar({ schedule, watch, savedItems, onOpen, onPlayEpisode, hasTracked }) {
  const [cursor, setCursor] = useState(() => { const now = new Date(); return { year: now.getFullYear(), month: now.getMonth() }; });
  const [selected, setSelected] = useState('');
  const today = todayIso();
  const events = useMemo(() => {
    const seen = new Set();
    const list = [];
    schedule.items.forEach((show) => {
      const entry = watch[show.id];
      const push = (episode, past) => {
        if (!episode?.airDate) return;
        const key = `${show.tmdbId}:${episode.season}:${episode.episode}`;
        if (seen.has(key)) return;
        seen.add(key);
        list.push({ key, show, ...episode, date: episode.airDate, past, watched: Boolean(entry?.episodes?.[epKey(episode.season, episode.episode)]?.watched) });
      };
      if (show.last && daysBetween(show.last.airDate, today) >= 0 && daysBetween(show.last.airDate, today) <= 21) push(show.last, true);
      show.upcoming.forEach((episode) => push(episode, false));
    });
    return list.sort((a, b) => a.date.localeCompare(b.date) || a.show.name.localeCompare(b.show.name));
  }, [schedule.items, watch, today]);
  const fresh = events.filter((event) => event.past && !event.watched && daysBetween(event.date, today) <= 14);
  const byDate = useMemo(() => { const map = new Map(); events.forEach((event) => map.set(event.date, [...(map.get(event.date) || []), event])); return map; }, [events]);
  const upcoming = events.filter((event) => !event.past);
  const agenda = selected ? (byDate.get(selected) || []) : upcoming.slice(0, 8);

  const first = new Date(cursor.year, cursor.month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => { const day = index - offset + 1; return day >= 1 && day <= daysInMonth ? isoOf(new Date(cursor.year, cursor.month, day)) : ''; });
  const moveMonth = (delta) => setCursor((current) => { const date = new Date(current.year, current.month + delta, 1); return { year: date.getFullYear(), month: date.getMonth() }; });
  const play = (event) => onPlayEpisode(seriesSnapshotFrom(event.show, watch, savedItems), { episode: { season: event.season, episode: event.episode, name: event.name }, resumeAt: 0 });

  return <section className="hub-section">
    <div className="hub-title"><div><h2>Calendário de estreias</h2><small className="hub-sub">Novos episódios das séries que acompanhas ou guardaste.</small></div></div>
    {schedule.status === 'loading' && events.length === 0 && <p className="rd-empty-text"><span className="spinner"></span> A consultar as datas de estreia…</p>}
    {!hasTracked && <p className="hub-empty">Começa a ver uma série, ou guarda-a na tua lista, e as datas dos novos episódios aparecem aqui.</p>}
    {hasTracked && schedule.status !== 'loading' && events.length === 0 && <p className="hub-empty">Nenhuma das tuas séries tem estreias marcadas nas próximas semanas.</p>}
    {fresh.length > 0 && <div className="hub-fresh"><h3>Novos por ver</h3>{fresh.map((event) => <div className="hub-fresh-row" key={event.key}>
      <button className="hub-fresh-poster" onClick={() => onOpen(seriesSnapshotFrom(event.show, watch, savedItems))} style={event.show.poster ? { backgroundImage: `url(${event.show.poster})` } : undefined} aria-label={`Abrir ${event.show.name}`}></button>
      <span><strong>{event.show.name}</strong><small>{epLabel(event.season, event.episode)}{event.name ? ` · ${event.name}` : ''} · {relativeDay(event.date).toLowerCase()}</small></span>
      <button className="button button-primary button-sm" onClick={() => play(event)}><Icon name="play" size={13}/>Ver agora</button>
    </div>)}</div>}
    {events.length > 0 && <div className="hub-cal">
      <div className="hub-cal-grid">
        <div className="hub-cal-head"><button className="hub-icon-btn" onClick={() => moveMonth(-1)} aria-label="Mês anterior"><span className="mini-chev down" style={{ transform: 'rotate(180deg)' }}><Icon name="chevron" size={15}/></span></button><strong>{new Date(cursor.year, cursor.month, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })}</strong><button className="hub-icon-btn" onClick={() => moveMonth(1)} aria-label="Mês seguinte"><Icon name="chevron" size={15}/></button></div>
        <div className="hub-cal-week">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="hub-cal-days">{cells.map((iso, index) => {
          const dayEvents = iso ? byDate.get(iso) || [] : [];
          return iso ? <button key={iso} className={`hub-cal-day ${iso === today ? 'is-today' : ''} ${dayEvents.length ? 'has-events' : ''} ${selected === iso ? 'is-selected' : ''}`} disabled={!dayEvents.length} onClick={() => setSelected(selected === iso ? '' : iso)} aria-label={`${iso}${dayEvents.length ? `: ${dayEvents.length} estreia(s)` : ''}`}>{Number(iso.slice(8))}{dayEvents.length > 0 && <i>{dayEvents.slice(0, 3).map((event) => <b key={event.key}></b>)}</i>}</button> : <span key={`e${index}`} className="hub-cal-day is-empty"></span>;
        })}</div>
      </div>
      <div className="hub-agenda">
        <h3>{selected ? relativeDay(selected) : 'Próximas estreias'}{selected && <button className="text-link" onClick={() => setSelected('')}>Limpar</button>}</h3>
        {agenda.length === 0 && <p className="hub-empty">Sem estreias neste dia.</p>}
        {agenda.map((event) => <button key={event.key} className={`hub-agenda-row ${event.past ? 'is-past' : ''}`} onClick={() => onOpen(seriesSnapshotFrom(event.show, watch, savedItems))}>
          <span className="hub-agenda-date"><b>{dateOf(event.date).getDate()}</b><small>{dateOf(event.date).toLocaleDateString('pt-PT', { month: 'short' })}</small></span>
          <span className="hub-agenda-poster" style={event.show.poster ? { backgroundImage: `url(${event.show.poster})` } : undefined}></span>
          <span className="hub-agenda-info"><strong>{event.show.name}</strong><small>{epLabel(event.season, event.episode)}{event.name ? ` · ${event.name}` : ''}</small></span>
          <em>{relativeDay(event.date)}</em>
        </button>)}
      </div>
    </div>}
  </section>;
}

// ---------- widget de música (fixo na coluna lateral) ----------
function MusicDock({ suggestions, onOpen, onNavigate }) {
  const music = useMusicState();
  const controls = musicControls();
  const repeatIcon = music.repeat === 'track' || music.repeat === 'one' ? 'repeatOne' : 'repeat';
  const repeatLabel = music.repeat === 'off' ? 'Repetir: desligado' : music.repeat === 'track' || music.repeat === 'one' ? 'Repetir a faixa' : 'Repetir o álbum';
  return <div className="music-dock">
    <div className="music-dock-head"><span className="eyebrow">MÚSICA</span><button className="text-link" onClick={() => onNavigate('music')}>Abrir</button></div>
    {music.active ? <>
      <div className="music-dock-now">
        <span className="music-dock-cover" style={music.cover ? { backgroundImage: `url(${music.cover})` } : undefined}><Icon name="music" size={26}/></span>
        <span className="music-dock-info"><strong title={music.title}>{music.title}</strong><small title={music.subtitle}>{music.subtitle}</small><em>{music.mode === 'spotify' ? 'SPOTIFY' : 'A OUVIR'}</em></span>
      </div>
      <div className="mini-seek"><span>{clock(music.position)}</span><input type="range" min="0" max={Math.max(1, music.duration)} step="1" value={Math.min(music.position, Math.max(1, music.duration))} aria-label="Posição" onChange={(event) => controls.seek?.(Number(event.target.value))}/><span>{clock(music.duration)}</span></div>
      <div className="music-dock-controls">
        <button className={`mini-btn mini-toggle ${music.shuffle ? 'on' : ''}`} aria-label="Aleatório" aria-pressed={music.shuffle} title={music.shuffle ? 'Aleatório: ligado' : 'Aleatório: desligado'} onClick={() => controls.toggleShuffle?.()}><Icon name="shuffle" size={17}/></button>
        <button className="mini-btn" aria-label="Anterior" disabled={!music.canPrev} onClick={() => controls.prev?.()}><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9.5 12z"/></svg></button>
        <button className="mini-btn mini-btn-main big" aria-label={music.playing ? 'Pausar' : 'Tocar'} onClick={() => controls.toggle?.()}><Icon name={music.playing ? 'pause' : 'play'} size={20}/></button>
        <button className="mini-btn" aria-label="Seguinte" disabled={!music.canNext} onClick={() => controls.next?.()}><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5l10.5 7L4 19z"/></svg></button>
        <button className={`mini-btn mini-toggle ${music.repeat !== 'off' ? 'on' : ''}`} aria-label="Repetir" title={repeatLabel} onClick={() => controls.cycleRepeat?.()}><Icon name={repeatIcon} size={17}/></button>
      </div>
      <label className="music-dock-volume"><Icon name={music.volume === 0 ? 'volumeOff' : 'volume'} size={16}/><input type="range" min="0" max="1" step="0.05" value={music.volume} aria-label="Volume" onChange={(event) => controls.setVolume?.(Number(event.target.value))}/><button className="text-link" onClick={() => controls.close?.()}>Parar</button></label>
      {music.queue && music.queue.length > 1 && <div className="music-dock-queue"><small>FILA · {music.albumTitle}</small><ol>{music.queue.map((track, index) => <li key={`${track.title}-${index}`}><button className={index === music.index ? 'active' : ''} onClick={() => controls.playIndex?.(index)}><span>{index === music.index ? <Icon name="volume" size={12}/> : index + 1}</span><b>{track.title}</b>{track.duration ? <em>{clock(track.duration)}</em> : null}</button></li>)}</ol></div>}
    </> : <p className="music-dock-idle"><Icon name="music" size={20}/>Nada a tocar. Escolhe um álbum abaixo e ele fica aqui, sempre à mão.</p>}
    {suggestions.length > 0 && <div className="music-dock-suggest"><small>OUVIR A SEGUIR</small><div>{suggestions.slice(0, music.active ? 4 : 6).map((album) => <button key={album.id} className="music-dock-album" onClick={() => onOpen(album)} title={`${album.title} · ${album.creator || ''}`}><span style={album.poster ? { backgroundImage: `url(${album.poster})` } : undefined}></span><strong>{album.title}</strong><small>{album.creator}</small></button>)}</div></div>}
  </div>;
}
