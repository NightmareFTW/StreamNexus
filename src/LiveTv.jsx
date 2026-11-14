import { useEffect, useMemo, useState } from 'react';
import { Icon, PosterCard, ScrollRow } from './ui.jsx';

export function TvModeTabs({ mode, onMode }) {
  return <div className="mode-tabs" role="tablist" aria-label="Tipo de conteúdo de TV">
    {[['channels', 'Canais ao vivo'], ['shows', 'Programas e séries']].map(([key, label]) => <button key={key} role="tab" aria-selected={mode === key} className={mode === key ? 'active' : ''} onClick={() => onMode(key)}>{label}</button>)}
  </div>;
}

export function LiveTvPage({ mode, onMode, countries, country, onCountry, state, onPlay, onRetry }) {
  const [category, setCategory] = useState('Todos');
  const [filter, setFilter] = useState('');
  useEffect(() => { setCategory('Todos'); setFilter(''); }, [country]);

  const items = state.items;
  const term = filter.trim().toLowerCase();
  const visible = useMemo(() => items.filter((item) => (category === 'Todos' || item.genres.includes(category)) && (!term || item.title.toLowerCase().includes(term))), [items, category, term]);
  const sections = useMemo(() => {
    if (category !== 'Todos' || term) return [];
    const groups = new Map();
    items.forEach((item) => { const key = item.genres[0]; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); });
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([label, list]) => ({ label, list }));
  }, [items, category, term]);
  const current = countries.find((entry) => entry.code === country);

  return <section className="live-tv page-in">
    <div className="live-head">
      <div><span className="eyebrow"><span className="pulse-dot"></span> AO VIVO</span><h1>Canais de televisão</h1><p>Emissões públicas de todo o mundo, por país e categoria.</p></div>
      <div className="live-controls">
        <TvModeTabs mode={mode} onMode={onMode}/>
        <label className="live-field"><span>País</span>
          <select value={country} onChange={(event) => onCountry(event.target.value)} aria-label="País dos canais">
            {!current && <option value={country}>{country}</option>}
            {countries.map((entry) => <option key={entry.code} value={entry.code}>{entry.flag} {entry.name} ({entry.count})</option>)}
          </select>
        </label>
        <label className="live-field live-search"><Icon name="search" size={15}/><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Procurar canal" aria-label="Procurar canal"/></label>
      </div>
    </div>

    {state.categories.length > 0 && <ScrollRow className="genre-chips" aria-label="Categorias de canais">
      <button className={category === 'Todos' ? 'active' : ''} onClick={() => setCategory('Todos')}>Todos</button>
      {state.categories.map(({ label, count }) => <button key={label} className={category === label ? 'active' : ''} onClick={() => setCategory(label)}>{label} <small>{count}</small></button>)}
    </ScrollRow>}

    {state.status === 'loading' && items.length === 0 && <div className="empty-list catalog-empty"><span><span className="spinner"></span></span><strong>A carregar canais…</strong><p>Na primeira vez pode demorar alguns segundos.</p></div>}
    {state.status === 'error' && <div className="empty-list catalog-empty"><span><Icon name="alert" size={22}/></span><strong>Não foi possível carregar os canais</strong><p className="is-error-text">{state.message}</p><button className="text-link" onClick={onRetry}>Tentar novamente <Icon name="refresh" size={14}/></button></div>}
    {state.status !== 'error' && state.status !== 'loading' && visible.length === 0 && <div className="empty-list catalog-empty"><span><Icon name="search" size={22}/></span><strong>Sem canais</strong><p>Experimenta outra categoria ou outro país.</p></div>}

    {sections.length > 0
      ? sections.map(({ label, list }) => <section className="content-section" key={label}>
          <div className="section-heading"><div><span className="eyebrow">{list.length} {list.length === 1 ? 'CANAL' : 'CANAIS'}</span><h2>{label}</h2></div>{list.length > 12 && <button className="view-all" onClick={() => setCategory(label)}>Ver todos <Icon name="chevron" size={14}/></button>}</div>
          <div className="channel-grid">{list.slice(0, 12).map((item, index) => <PosterCard key={item.id} item={item} index={index} saved={false} hideSave onOpen={() => onPlay(item)}/>)}</div>
        </section>)
      : visible.length > 0 && <div className="channel-grid">{visible.map((item, index) => <PosterCard key={item.id} item={item} index={index % 12} saved={false} hideSave onOpen={() => onPlay(item)}/>)}</div>}
  </section>;
}
