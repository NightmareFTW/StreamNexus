import { useEffect, useState } from 'react';
import { pkey } from './profiles.js';
import { Icon, PosterCard } from './ui.jsx';

// ---- Estante pessoal de leitura (guardada localmente) ----
export const READING_KEY = 'streamnexus.reading';
export const READING_STATUS = { want: 'Quero ler', reading: 'A ler', read: 'Lido' };
const DAY_MS = 86400000;
export const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function loadReading() {
  try {
    const value = JSON.parse(localStorage.getItem(pkey(READING_KEY)));
    return { shelf: value?.shelf && typeof value.shelf === 'object' ? value.shelf : {}, goal: Number(value?.goal) || 0, days: Array.isArray(value?.days) ? value.days : [] };
  } catch { return { shelf: {}, goal: 0, days: [] }; }
}

export function readingStreaks(days) {
  const set = new Set(days);
  const noon = (offset = 0) => { const date = new Date(); date.setHours(12, 0, 0, 0); return new Date(date.getTime() - offset * DAY_MS); };
  let current = 0;
  let offset = set.has(dayKey(noon())) ? 0 : 1;
  while (set.has(dayKey(noon(offset)))) { current += 1; offset += 1; }
  let best = 0; let run = 0; let previous = null;
  [...set].sort().forEach((key) => {
    const time = new Date(`${key}T12:00:00`).getTime();
    run = previous !== null && Math.round((time - previous) / DAY_MS) === 1 ? run + 1 : 1;
    best = Math.max(best, run); previous = time;
  });
  return { current, best, last7: Array.from({ length: 7 }, (_, index) => set.has(dayKey(noon(6 - index)))) };
}

export function ReadingDashboard({ reading, saved, onOpen, onSave, onGoal }) {
  const [goalDraft, setGoalDraft] = useState('');
  const [editingGoal, setEditingGoal] = useState(false);
  const entries = Object.values(reading.shelf);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 6 ? 'Boa madrugada' : hour < 13 ? 'Bom dia' : hour < 20 ? 'Boa tarde' : 'Boa noite';
  const currentlyReading = entries.filter((entry) => entry.status === 'reading').sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const wantToRead = entries.filter((entry) => entry.status === 'want').sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const recent = [...entries].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 12);
  const streak = readingStreaks(reading.days);
  const readThisYear = entries.filter((entry) => entry.status === 'read' && entry.finishedAt && new Date(entry.finishedAt).getFullYear() === now.getFullYear()).length;
  const monthPrefix = dayKey(now).slice(0, 7);
  const daysThisMonth = reading.days.filter((day) => day.startsWith(monthPrefix)).length;
  const challengeTarget = 5;
  const genreCounts = entries.reduce((map, entry) => map.set(entry.book.genre, (map.get(entry.book.genre) || 0) + 1), new Map());
  const topGenres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const submitGoal = (event) => {
    event.preventDefault();
    const value = Math.max(0, Math.min(999, Math.round(Number(goalDraft) || 0)));
    onGoal(value); setEditingGoal(false); setGoalDraft('');
  };
  return <section className="reading-dashboard">
    <div className="rd-head"><span className="eyebrow">A MINHA ESTANTE</span><h1>{greeting}</h1></div>
    <div className="rd-widgets">
      <article className="rd-card">
        <h3><Icon name="spark" size={16}/> Sequência de leitura</h3>
        <div className="rd-streak"><strong>{streak.current}</strong><span>{streak.current === 1 ? 'dia seguido' : 'dias seguidos'}</span></div>
        <small className="rd-muted">Melhor: {streak.best} {streak.best === 1 ? 'dia' : 'dias'}</small>
        <div className="rd-dots" aria-label="Últimos 7 dias">{streak.last7.map((active, index) => <i key={index} className={active ? 'is-active' : ''}></i>)}</div>
        <small className="rd-muted">Últimos 7 dias</small>
      </article>
      <article className="rd-card rd-wide">
        <h3><Icon name="book" size={16}/> A ler agora</h3>
        {currentlyReading.length === 0 ? <p className="rd-empty-text">Marca um livro como “A ler” para acompanhares o progresso aqui.</p> : <div className="rd-reading-list">{currentlyReading.slice(0, 3).map((entry) => <button key={entry.book.id} className="rd-reading-item" onClick={() => onOpen(entry.book)}>
          <img src={entry.book.poster} alt="" loading="lazy"/>
          <span><strong>{entry.book.title}</strong><small>{entry.book.creator}</small><span className="rd-progress"><i style={{ width: `${entry.progress || 0}%` }}></i></span></span><em>{entry.progress || 0}%</em>
        </button>)}</div>}
      </article>
      <article className="rd-card">
        <h3><Icon name="check" size={16}/> Meta de leitura {now.getFullYear()}</h3>
        {reading.goal && !editingGoal ? <>
          <div className="rd-goal"><strong>{readThisYear}</strong><span>/ {reading.goal} livros</span></div>
          <span className="rd-progress"><i style={{ width: `${Math.min(100, readThisYear / reading.goal * 100)}%` }}></i></span>
          <button className="text-link" onClick={() => { setGoalDraft(String(reading.goal)); setEditingGoal(true); }}>Alterar meta</button>
        </> : <form className="rd-goal-form" onSubmit={submitGoal}><p className="rd-empty-text">Quantos livros queres ler este ano?</p><div><input type="number" min="1" max="999" className="text-input" value={goalDraft} onChange={(event) => setGoalDraft(event.target.value)} aria-label="Meta de livros por ano" placeholder="12"/><button className="button button-primary" type="submit">Definir</button></div></form>}
      </article>
      <article className="rd-card">
        <h3><Icon name="spark" size={16}/> DNA de leitura</h3>
        {entries.length < 3 ? <p className="rd-empty-text">Adiciona pelo menos 3 livros à estante para veres os teus géneros favoritos.</p> : <div className="rd-dna">{topGenres.map(([name, count]) => <div key={name}><span>{name}</span><span className="rd-progress"><i style={{ width: `${count / entries.length * 100}%` }}></i></span><em>{count}</em></div>)}</div>}
      </article>
      <article className="rd-card">
        <h3><Icon name="check" size={16}/> Desafio do mês</h3>
        <strong className="rd-challenge-title">Hábito de leitura</strong>
        <small className="rd-muted">Lê em {challengeTarget} dias diferentes este mês</small>
        <span className="rd-progress"><i style={{ width: `${Math.min(100, daysThisMonth / challengeTarget * 100)}%` }}></i></span>
        <small className="rd-muted">{Math.min(daysThisMonth, challengeTarget)} / {challengeTarget}</small>
      </article>
    </div>
    {[['Adicionados recentemente', recent], ['Quero ler', wantToRead]].map(([title, list]) => (title === 'Quero ler' && list.length === 0) ? null : <section className="content-section rd-section" key={title}>
      <div className="section-heading"><div><h2>{title} <span className="rd-count">{list.length}</span></h2></div></div>
      {list.length === 0 ? <div className="rd-empty"><Icon name="book" size={20}/><span>A tua estante está vazia. Abre um livro em “Descobrir” e marca-o como “Quero ler” ou “A ler”.</span></div>
        : <div className="poster-row">{list.map((entry, index) => <PosterCard key={entry.book.id} item={entry.book} index={index} rank={null} saved={saved.includes(entry.book.id)} onOpen={() => onOpen(entry.book)} onSave={() => onSave(entry.book.id)}/>)}</div>}
    </section>)}
  </section>;
}

export function BooksNav({ view, onView, counts }) {
  const groups = [
    { title: 'A MINHA ESTANTE', items: [['dashboard', 'Painel', 'compass'], ['discover', 'Descobrir', 'search'], ['shelf', 'Estante', 'book', counts.shelf]] },
    { title: 'EXPLORAR', items: [['authors', 'Autores', 'user', counts.authors]] },
    { title: 'LEITURA', items: [['stats', 'Estatísticas', 'chart'], ['history', 'Histórico', 'history'], ['achievements', 'Conquistas', 'trophy']] },
  ];
  return <nav className="books-nav" aria-label="Livros">
    {groups.map((group) => <div className="books-nav-group" key={group.title}>
      <span className="eyebrow">{group.title}</span>
      {group.items.map(([key, label, icon, count]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => onView(key)}><Icon name={icon} size={16}/><span>{label}</span>{count > 0 && <em>{count}</em>}</button>)}
    </div>)}
  </nav>;
}

const formatDate = (timestamp) => new Date(timestamp).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });

export function BooksCollectionView({ view, reading, saved, onOpen, onSave }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const entries = Object.values(reading.shelf);
  const now = new Date();
  const streak = readingStreaks(reading.days);
  const readEntries = entries.filter((entry) => entry.status === 'read');
  const readThisYear = readEntries.filter((entry) => entry.finishedAt && new Date(entry.finishedAt).getFullYear() === now.getFullYear());
  const grid = (list) => <div className="rd-grid">{list.map((entry, index) => <PosterCard key={entry.book.id} item={entry.book} index={index % 12} rank={null} saved={saved.includes(entry.book.id)} onOpen={() => onOpen(entry.book)} onSave={() => onSave(entry.book.id)}/>)}</div>;
  const empty = (text) => <div className="rd-empty"><Icon name="book" size={20}/><span>{text}</span></div>;

  if (view === 'shelf') {
    const filters = [['all', 'Todos', entries.length], ...Object.entries(READING_STATUS).map(([key, label]) => [key, label, entries.filter((entry) => entry.status === key).length])];
    const list = entries.filter((entry) => statusFilter === 'all' || entry.status === statusFilter).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return <section className="content-section rd-section">
      <div className="section-heading"><div><span className="eyebrow">A MINHA ESTANTE</span><h2>Estante</h2></div><div className="mode-tabs">{filters.map(([key, label, count]) => <button key={key} className={statusFilter === key ? 'active' : ''} onClick={() => setStatusFilter(key)}>{label} <small>{count}</small></button>)}</div></div>
      {list.length === 0 ? empty('Ainda não tens livros aqui. Abre um livro em “Descobrir” e marca-o como “Quero ler”, “A ler” ou “Lido”.') : grid(list)}
    </section>;
  }

  if (view === 'authors') {
    const groups = new Map();
    entries.forEach((entry) => { const name = entry.book.creator?.split(',')[0]?.trim() || 'Autor desconhecido'; if (!groups.has(name)) groups.set(name, []); groups.get(name).push(entry); });
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'pt-PT'));
    return <section className="content-section rd-section">
      <div className="section-heading"><div><span className="eyebrow">NA TUA ESTANTE</span><h2>Autores <span className="rd-count">{sorted.length}</span></h2></div></div>
      {sorted.length === 0 ? empty('Os autores dos livros que guardares aparecem aqui.') : sorted.map(([name, list]) => <div className="rd-author" key={name}><h3>{name} <span className="rd-count">{list.length}</span></h3>{grid(list)}</div>)}
    </section>;
  }

  if (view === 'stats') {
    const months = Array.from({ length: 12 }, (_, month) => readThisYear.filter((entry) => new Date(entry.finishedAt).getMonth() === month).length);
    const maxMonth = Math.max(1, ...months);
    const genreCounts = entries.reduce((map, entry) => map.set(entry.book.genre, (map.get(entry.book.genre) || 0) + 1), new Map());
    const genres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const tiles = [
      ['Livros na estante', entries.length], ['A ler', entries.filter((entry) => entry.status === 'reading').length], ['Quero ler', entries.filter((entry) => entry.status === 'want').length],
      ['Lidos', readEntries.length], [`Lidos em ${now.getFullYear()}`, readThisYear.length], ['Dias de leitura', reading.days.length], ['Sequência atual', streak.current], ['Melhor sequência', streak.best],
    ];
    return <section className="content-section rd-section">
      <div className="section-heading"><div><span className="eyebrow">OS TEUS NÚMEROS</span><h2>Estatísticas</h2></div></div>
      <div className="rd-tiles">{tiles.map(([label, value]) => <div className="rd-tile" key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      <div className="rd-split">
        <article className="rd-card"><h3><Icon name="chart" size={16}/> Livros lidos por mês · {now.getFullYear()}</h3>
          <div className="rd-bars">{months.map((count, index) => <div key={index}><i style={{ height: `${Math.max(count / maxMonth * 100, count ? 8 : 2)}%` }} title={`${count}`}></i><span>{['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'][index]}</span></div>)}</div>
        </article>
        <article className="rd-card"><h3><Icon name="spark" size={16}/> Géneros</h3>
          {genres.length === 0 ? <p className="rd-empty-text">Sem dados ainda.</p> : <div className="rd-dna">{genres.map(([name, count]) => <div key={name}><span>{name}</span><span className="rd-progress"><i style={{ width: `${count / entries.length * 100}%` }}></i></span><em>{count}</em></div>)}</div>}
        </article>
      </div>
    </section>;
  }

  if (view === 'history') {
    const events = entries.flatMap((entry) => [
      { ts: entry.addedAt || 0, text: `Adicionaste “${entry.book.title}” à estante`, book: entry.book },
      ...(entry.finishedAt ? [{ ts: entry.finishedAt, text: `Terminaste “${entry.book.title}”`, book: entry.book, done: true }] : []),
    ]).filter((event) => event.ts).sort((a, b) => b.ts - a.ts).slice(0, 80);
    return <section className="content-section rd-section">
      <div className="section-heading"><div><span className="eyebrow">ATIVIDADE</span><h2>Histórico</h2></div></div>
      {events.length === 0 ? empty('O teu histórico de leitura aparece aqui.') : <ol className="rd-timeline">{events.map((event, index) => <li key={index} className={event.done ? 'is-done' : ''}><button onClick={() => onOpen(event.book)}><img src={event.book.poster} alt="" loading="lazy"/><span><strong>{event.text}</strong><small>{formatDate(event.ts)}</small></span></button></li>)}</ol>}
    </section>;
  }

  const genresCount = new Set(entries.map((entry) => entry.book.genre)).size;
  const badges = [
    ['Primeira página', 'Termina o teu primeiro livro', readEntries.length, 1], ['Leitor assíduo', 'Termina 5 livros', readEntries.length, 5],
    ['Devorador de livros', 'Termina 10 livros', readEntries.length, 10], ['Em ritmo', 'Lê 3 dias seguidos', streak.best, 3],
    ['Uma semana de leitura', 'Lê 7 dias seguidos', streak.best, 7], ['Meta cumprida', 'Atinge a tua meta anual', reading.goal ? readThisYear.length : 0, reading.goal || 1],
    ['Explorador', 'Junta livros de 5 géneros diferentes', genresCount, 5], ['Colecionador', 'Junta 10 livros à estante', entries.length, 10],
  ];
  return <section className="content-section rd-section">
    <div className="section-heading"><div><span className="eyebrow">OBJETIVOS</span><h2>Conquistas <span className="rd-count">{badges.filter(([, , value, target]) => value >= target).length}/{badges.length}</span></h2></div></div>
    <div className="rd-badges">{badges.map(([title, text, value, target]) => { const done = value >= target; return <article key={title} className={`rd-badge ${done ? 'is-unlocked' : ''}`}><span><Icon name="trophy" size={22}/></span><strong>{title}</strong><small>{text}</small><span className="rd-progress"><i style={{ width: `${Math.min(100, value / target * 100)}%` }}></i></span><em>{Math.min(value, target)} / {target}</em></article>; })}</div>
  </section>;
}

export function BookSourcesPanel({ state, onOpen }) {
  const data = state.data;
  const library = ['public', 'borrowable'].includes(data?.openLibrary?.access) ? data.openLibrary : null;
  const gutenberg = data?.gutenberg;
  const archive = data?.archive;
  const librivox = data?.librivox;
  const nothing = state.status === 'ready' && !gutenberg && !archive && !librivox && !library;
  return <section className="easy-sources">
    <span className="eyebrow">LER OU OBTER</span>
    {state.status === 'loading' && <p className="rd-empty-text"><span className="spinner"></span> A procurar fontes legais…</p>}
    {state.status === 'error' && <p className="rd-empty-text">Não foi possível consultar as fontes agora.</p>}
    {state.status === 'ready' && <div className="easy-list">
      {gutenberg && <div className="easy-row"><span><strong>Project Gutenberg</strong><small>Domínio público · gratuito · {gutenberg.title}</small></span>
        <div>{gutenberg.epub && <button className="button button-primary button-sm" onClick={() => onOpen(gutenberg.epub)}>EPUB</button>}{gutenberg.mobi && <button className="button button-quiet button-sm" onClick={() => onOpen(gutenberg.mobi)}>Kindle</button>}{gutenberg.html && <button className="button button-quiet button-sm" onClick={() => onOpen(gutenberg.html)}>Ler online</button>}</div></div>}
      {archive && <div className="easy-row"><span><strong>Internet Archive</strong><small>Acesso livre · {archive.title}</small></span>
        <div><button className="button button-primary button-sm" onClick={() => onOpen(archive.url)}>Ler / descarregar</button></div></div>}
      {library && <div className="easy-row"><span><strong>Open Library</strong><small>{library.access === 'public' ? 'Leitura e descarga gratuitas' : 'Empréstimo gratuito (precisa de conta Internet Archive)'}</small></span>
        <div>{library.archiveUrl && <button className="button button-primary button-sm" onClick={() => onOpen(library.archiveUrl)}>{library.access === 'public' ? 'Ler / descarregar' : 'Pedir emprestado'}</button>}<button className="button button-quiet button-sm" onClick={() => onOpen(library.url)}>Ver ficha</button></div></div>}
      {librivox && <div className="easy-row"><span><strong>LibriVox · audiolivro</strong><small>Voluntários · domínio público{librivox.time ? ` · ${librivox.time}` : ''}</small></span>
        <div><button className="button button-primary button-sm" onClick={() => onOpen(librivox.url)}>Ouvir / descarregar</button></div></div>}
      {nothing && <p className="rd-empty-text">Não há versão digital gratuita e legal deste livro. Podes tentar a pesquisa nos indexadores abaixo.</p>}
    </div>}
  </section>;
}

// Pedido ao teu Shelfarr: a app só envia o pedido e mostra o estado; o Shelfarr trata do resto com as fontes que configuraste.
export function ShelfarrPanel({ book, configured, onNotify }) {
  const [state, setState] = useState({ status: 'idle', requests: [], busy: '' });
  const author = (book.creator || '').split(',')[0];
  const load = () => window.streamnexus?.shelfarrRequests?.({ title: book.title, author })
    .then((requests) => setState((current) => ({ ...current, status: 'ready', requests: [...requests, ...current.requests.filter((old) => !requests.some((item) => item.id === old.id))] })))
    .catch(() => setState((current) => ({ ...current, status: 'error' })));
  useEffect(() => {
    if (!configured || !window.streamnexus?.isDesktop) return undefined;
    setState({ status: 'loading', requests: [], busy: '' });
    load();
    return undefined;
  }, [book.id, configured]);
  if (!configured || !window.streamnexus?.isDesktop) return null;
  const request = async (bookType) => {
    setState((current) => ({ ...current, busy: bookType }));
    try {
      const result = await window.streamnexus.shelfarrRequestBook({ title: book.title, author, year: book.year, bookType });
      onNotify?.(`Pedido enviado ao Shelfarr: ${result.title}.`);
      setState((current) => ({ ...current, busy: '', requests: [...result.requests, ...current.requests] }));
      load();
    } catch (error) {
      setState((current) => ({ ...current, busy: '' }));
      onNotify?.(error?.message || 'Não foi possível pedir ao Shelfarr.', 'error');
    }
  };
  const has = (type) => state.requests.some((item) => item.bookType === type && item.status !== 'failed' && item.status !== 'not_found');
  return <section className="easy-sources">
    <span className="eyebrow">PEDIR AO SHELFARR</span>
    <div className="easy-list">
      <div className="easy-row"><span><strong>O teu Shelfarr</strong><small>Envia o pedido e acompanha o estado aqui.</small></span>
        <div>
          <button className="button button-primary button-sm" disabled={Boolean(state.busy) || has('ebook')} onClick={() => request('ebook')}>{state.busy === 'ebook' ? 'A enviar…' : 'Pedir ebook'}</button>
          <button className="button button-quiet button-sm" disabled={Boolean(state.busy) || has('audiobook')} onClick={() => request('audiobook')}>{state.busy === 'audiobook' ? 'A enviar…' : 'Pedir audiolivro'}</button>
        </div></div>
      {state.requests.map((item) => <div key={item.id} className="easy-row"><span><strong>{item.bookType === 'audiobook' ? 'Audiolivro' : 'Ebook'}</strong><small>{item.statusLabel}{item.attention ? ' · precisa de atenção no Shelfarr' : ''}</small></span></div>)}
      {state.status === 'error' && <p className="rd-empty-text">Não foi possível consultar o estado no Shelfarr.</p>}
    </div>
  </section>;
}
