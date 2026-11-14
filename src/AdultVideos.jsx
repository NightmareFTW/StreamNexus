import { Icon, PosterCard, ScrollRow } from './ui.jsx';

export const ADULT_CATEGORIES = [
  { label: 'Amador', term: 'amateur' }, { label: 'Caseiro', term: 'homemade' }, { label: 'Asiático', term: 'asian' }, { label: 'Latino', term: 'latina' },
  { label: 'Ébano', term: 'ebony' }, { label: 'Lésbicas', term: 'lesbian' }, { label: 'MILF', term: 'milf' }, { label: 'Madura', term: 'mature' },
  { label: 'Anal', term: 'anal' }, { label: 'Oral', term: 'blowjob' }, { label: 'Trio', term: 'threesome' }, { label: 'Massagem', term: 'massage' },
  { label: 'POV', term: 'pov' }, { label: 'Fetiche', term: 'fetish' }, { label: 'Cosplay', term: 'cosplay' }, { label: 'Hentai', term: 'hentai' },
  { label: 'Compilações', term: 'compilation' }, { label: 'Ar livre', term: 'outdoor' }, { label: 'Realidade virtual', term: 'vr' },
];

export function AdultModeTabs({ mode, onMode }) {
  return <div className="mode-tabs" role="tablist" aria-label="Tipo de conteúdo adulto">
    {[['videos', 'Vídeos (+18)'], ['cinema', 'Cinema para adultos']].map(([key, label]) => <button key={key} role="tab" aria-selected={mode === key} className={mode === key ? 'active' : ''} onClick={() => onMode(key)}>{label}</button>)}
  </div>;
}

export const ADULT_ORIENTATIONS = [['straight', 'Hétero'], ['gay', 'Gay'], ['trans', 'Trans']];

export function AdultVideosPage({ mode, onMode, orientation, onOrientation, state, category, onCategory, onPlay, onRetry }) {
  return <section className="live-tv adult-videos page-in">
    <div className="live-head">
      <div><span className="eyebrow"><span className="pulse-dot"></span> +18 · CONTEÚDO PARA ADULTOS</span><h1>Vídeos</h1><p>Catálogo das APIs públicas do RedTube, Pornhub e Eporner. Os vídeos reproduzem-se no leitor incorporado de cada site.</p></div>
      <div className="live-controls live-controls-col"><AdultModeTabs mode={mode} onMode={onMode}/><div className="mode-tabs" role="tablist" aria-label="Orientação">{ADULT_ORIENTATIONS.map(([key, label]) => <button key={key} role="tab" aria-selected={orientation === key} className={orientation === key ? 'active' : ''} onClick={() => onOrientation(key)}>{label}</button>)}</div></div>
    </div>

    <ScrollRow className="genre-chips" aria-label="Categorias">
      <button className={category === 'Todos' ? 'active' : ''} onClick={() => onCategory('Todos')}>Todos</button>
      {ADULT_CATEGORIES.map((entry) => <button key={entry.label} className={category === entry.label ? 'active' : ''} onClick={() => onCategory(entry.label)}>{entry.label}</button>)}
    </ScrollRow>

    {state.status === 'loading' && state.rows.length === 0 && <div className="empty-list catalog-empty"><span><span className="spinner"></span></span><strong>A carregar vídeos…</strong><p>A consultar as fontes.</p></div>}
    {state.status === 'error' && <div className="empty-list catalog-empty"><span><Icon name="alert" size={22}/></span><strong>Não foi possível carregar os vídeos</strong><p className="is-error-text">{state.message}</p><button className="text-link" onClick={onRetry}>Tentar novamente <Icon name="refresh" size={14}/></button></div>}

    {state.rows.map((row) => row.items.length > 0 && <section className="content-section discovery-rail" key={row.title}>
      <div className="section-heading"><div><span className="eyebrow">{row.eyebrow}</span><h2>{category === 'Todos' ? row.title : `${category} · ${row.title}`}</h2></div></div>
      <div className="poster-row">{row.items.map((item, index) => <PosterCard key={item.id} item={item} index={index % 12} saved={false} hideSave onOpen={() => onPlay(item)}/>)}</div>
    </section>)}
  </section>;
}
