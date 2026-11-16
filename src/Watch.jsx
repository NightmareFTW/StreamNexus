import { useEffect, useMemo, useState } from 'react';
import { Icon, PosterCard } from './ui.jsx';
import { epKey, epLabel, watchInfo } from './watch.js';

const clock = (seconds) => { const total = Math.max(0, Math.round(Number(seconds) || 0)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };

// Temporadas e episódios de uma série (TMDB), com estado de visto e posição guardada
export function EpisodePicker({ title, entry, onPlay, onToggleWatched, onLoaded }) {
  const resume = entry?.last ? { ...entry.last, record: entry.episodes?.[epKey(entry.last.season, entry.last.episode)] } : null;
  const [season, setSeason] = useState(resume?.season || null);
  const [data, setData] = useState({ status: 'loading', seasons: [], episodes: [], message: '' });

  useEffect(() => {
    if (!window.streamnexus?.isDesktop || !title?.tmdbId) { setData({ status: 'error', seasons: [], episodes: [], message: 'Os episódios estão disponíveis na app desktop com a chave TMDB.' }); return undefined; }
    let active = true;
    setData((current) => ({ ...current, status: 'loading' }));
    window.streamnexus.fetchTvSeason({ tmdbId: title.tmdbId, season })
      .then((result) => { if (!active) return; setData({ status: 'ready', seasons: result.seasons, episodes: result.episodes, message: '' }); if (season == null) setSeason(result.season); onLoaded?.(result); })
      .catch((error) => { if (active) setData({ status: 'error', seasons: [], episodes: [], message: error?.message || 'Não foi possível carregar os episódios.' }); });
    return () => { active = false; };
  }, [title?.tmdbId, season]);

  const watchedInSeason = data.episodes.filter((episode) => entry?.episodes?.[epKey(season, episode.number)]?.watched).length;
  const nextUnwatched = data.episodes.find((episode) => !entry?.episodes?.[epKey(season, episode.number)]?.watched);
  const followingAfterLast = resume && resume.season === season ? data.episodes.find((episode) => episode.number > resume.episode) : null;

  return <section className="episodes-panel">
    <div className="episodes-head">
      <div><span className="eyebrow">TEMPORADAS E EPISÓDIOS</span>{data.status === 'ready' && <small>{watchedInSeason} de {data.episodes.length} vistos nesta temporada</small>}</div>
      <div className="episodes-controls">
        {data.seasons.length > 0 && <select value={season ?? ''} aria-label="Temporada" onChange={(event) => setSeason(Number(event.target.value))}>{data.seasons.map((entryItem) => <option key={entryItem.number} value={entryItem.number}>{entryItem.name} ({entryItem.episodeCount})</option>)}</select>}
        {resume && (resume.record?.watched && resume.season === season && followingAfterLast
          ? <button className="button button-primary button-sm" onClick={() => onPlay(season, followingAfterLast.number, {})}><Icon name="play" size={14}/>Seguinte {epLabel(season, followingAfterLast.number)}</button>
          : <button className="button button-primary button-sm" onClick={() => onPlay(resume.season, resume.episode, { resumeAt: resume.record?.watched ? 0 : resume.record?.position || 0 })}><Icon name="play" size={14}/>{resume.record?.watched ? `Rever ${epLabel(resume.season, resume.episode)}` : `Continuar ${epLabel(resume.season, resume.episode)}${resume.record?.position > 30 ? ` · ${clock(resume.record.position)}` : ''}`}</button>)}
        {!resume && nextUnwatched && <button className="button button-primary button-sm" onClick={() => onPlay(season, nextUnwatched.number, {})}><Icon name="play" size={14}/>Começar {epLabel(season, nextUnwatched.number)}</button>}
      </div>
    </div>
    {data.status === 'loading' && data.episodes.length === 0 && <p className="rd-empty-text"><span className="spinner"></span> A carregar os episódios…</p>}
    {data.status === 'error' && <p className="rd-empty-text">{data.message}</p>}
    {data.episodes.length > 0 && <ol className="episode-list">{data.episodes.map((episode) => {
      const record = entry?.episodes?.[epKey(season, episode.number)];
      const percent = record?.duration ? Math.min(100, Math.round(((record.position || 0) / record.duration) * 100)) : 0;
      const isLast = resume && resume.season === season && resume.episode === episode.number;
      return <li key={episode.number} className={`episode-item ${record?.watched ? 'is-watched' : ''} ${isLast ? 'is-last' : ''}`}>
        <button className="episode-row" onClick={() => onPlay(season, episode.number, { resumeAt: record?.watched ? 0 : record?.position || 0 })} aria-label={`Ver episódio ${episode.number}: ${episode.name}`}>
          <span className="episode-thumb" style={episode.still ? { backgroundImage: `url(${episode.still})` } : undefined}><span className="episode-play"><Icon name="play" size={16}/></span>{percent > 0 && !record?.watched && <i className="episode-progress"><b style={{ width: `${percent}%` }}></b></i>}</span>
          <span className="episode-info">
            <strong><em>{episode.number}</em>{episode.name}</strong>
            <small>{[episode.runtime ? `${episode.runtime} min` : '', episode.airDate ? new Date(episode.airDate).toLocaleDateString('pt-PT') : '', record?.watched ? 'Visto' : percent > 0 ? `Parado em ${clock(record.position)}` : ''].filter(Boolean).join(' · ')}</small>
            {episode.overview && <p>{episode.overview}</p>}
          </span>
        </button>
        <button className={`episode-watch ${record?.watched ? 'on' : ''}`} title={record?.watched ? 'Marcar como não visto' : 'Marcar como visto'} aria-label={record?.watched ? 'Marcar como não visto' : 'Marcar como visto'} aria-pressed={Boolean(record?.watched)} onClick={() => onToggleWatched(season, episode.number, !record?.watched, episode.name)}><Icon name="check" size={16}/></button>
      </li>;
    })}</ol>}
  </section>;
}

// Página "Vistos e a continuar" do perfil atual
export function HistoryPage({ watch, profileName, onOpen, onForget }) {
  const [tab, setTab] = useState('continue');
  const entries = useMemo(() => Object.values(watch).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [watch]);
  const lists = useMemo(() => {
    const info = (entry) => watchInfo(watch, entry);
    return {
      continue: entries.filter((entry) => { const i = info(entry); return i && (i.inProgress || (i.kind === 'series' && i.started)); }),
      movies: entries.filter((entry) => entry.type === 'Filme' && entry.watched),
      series: entries.filter((entry) => entry.type === 'Série' && Object.values(entry.episodes || {}).some((episode) => episode.watched)),
    };
  }, [entries, watch]);
  const tabs = [['continue', 'A continuar'], ['movies', 'Filmes vistos'], ['series', 'Séries']];
  const list = lists[tab];
  return <section className="home-page page-in catalog-browse-page history-page">
    <div className="page-heading"><div><span className="eyebrow">O TEU HISTÓRICO</span><h1>Vistos e a continuar</h1><p>Perfil de {profileName}. Filmes e episódios que já viste, e onde ficaste parado.</p></div></div>
    <div className="mode-tabs" role="tablist" aria-label="Histórico">{tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}<small>{lists[key].length}</small></button>)}</div>
    {list.length === 0 && <div className="empty-list catalog-empty"><span><Icon name="history" size={22}/></span><strong>{tab === 'continue' ? 'Nada para continuar' : tab === 'movies' ? 'Ainda não viste nenhum filme' : 'Ainda não viste nenhuma série'}</strong><p>O que vires aqui aparece automaticamente, com a posição onde paraste.</p></div>}
    <div className="catalog-grid">{list.map((entry, index) => {
      const i = watchInfo(watch, entry);
      return <div className="history-card" key={entry.id}>
        <PosterCard item={entry} index={index} saved={false} hideSave onOpen={() => onOpen(entry)}/>
        <div className="history-meta">
          <span>{i?.kind === 'series' ? (entry.last ? `${epLabel(entry.last.season, entry.last.episode)}${i.inProgress ? ` · ${Math.round(i.percent * 100)}%` : ''}` : '') : i?.watched ? 'Visto' : `${Math.round((i?.percent || 0) * 100)}% visto`}</span>
          <button className="text-link" onClick={() => onForget(entry.id)}>Esquecer</button>
        </div>
      </div>;
    })}</div>
  </section>;
}
