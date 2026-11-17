import { useEffect, useState } from 'react';
import { Icon } from './ui.jsx';

const hours = (seconds) => {
  const total = Math.round(Number(seconds) / 60);
  if (!total) return '';
  return total >= 60 ? `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min` : `${total} min`;
};

function AbsCard({ item, busy, onPlay }) {
  return <button className="abs-card" onClick={() => onPlay(item)} disabled={busy}>
    <span className="abs-cover"><img src={item.poster} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}/><i><Icon name="play" size={20}/></i></span>
    <strong title={item.title}>{item.title}</strong>
    <small>{[item.author, hours(item.duration)].filter(Boolean).join(' · ')}</small>
  </button>;
}

// Alternador eBooks / Audiolivros da aba Livros
export function BooksModeSwitch({ mode, onMode }) {
  return <div className="books-mode"><div className="mode-tabs" role="tablist" aria-label="Tipo de livro">
    {[['ebooks', 'eBooks'], ['audio', 'Audiolivros']].map(([key, label]) => <button key={key} role="tab" aria-selected={mode === key} className={mode === key ? 'active' : ''} onClick={() => onMode(key)}>{label}</button>)}
  </div></div>;
}

// Biblioteca de audiolivros do Audiobookshelf
export function AudiobooksView({ configured, onPlay, onConfigure, playingId = '' }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ status: 'idle', items: [], message: '' });
  const [shelf, setShelf] = useState([]);

  useEffect(() => {
    if (!configured) return undefined;
    let active = true;
    window.streamnexus.absContinue().then((data) => { if (active) setShelf(data.items); }).catch(() => {});
    return () => { active = false; };
  }, [configured]);

  useEffect(() => {
    if (!configured) return undefined;
    let active = true;
    setState((current) => ({ ...current, status: 'loading' }));
    const timer = window.setTimeout(() => {
      window.streamnexus.absItems({ query }).then((data) => { if (active) setState({ status: data.items.length ? 'ready' : 'empty', items: data.items, message: '' }); })
        .catch((error) => { if (active) setState({ status: 'error', items: [], message: String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }); });
    }, query ? 350 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [configured, query]);

  if (!configured) {
    return <section className="content-section abs-setup">
      <div className="section-heading"><div><span className="eyebrow">AUDIOLIVROS</span><h2>Liga o teu Audiobookshelf</h2></div></div>
      <p className="rd-empty-text">O Audiobookshelf guarda os audiolivros que tens no teu servidor. Indica o endereço e o token nas definições para os ouvires aqui.</p>
      <button className="button button-primary" onClick={onConfigure}>Abrir definições</button>
    </section>;
  }
  return <section className="content-section abs-view">
    <div className="section-heading"><div><span className="eyebrow">A TUA BIBLIOTECA</span><h2>Audiolivros</h2></div>
      <input className="text-input abs-search" type="search" placeholder="Pesquisar nos teus audiolivros" value={query} onChange={(event) => setQuery(event.target.value)}/></div>
    {!query && shelf.length > 0 && <div className="abs-shelf"><span className="eyebrow">CONTINUAR A OUVIR</span><div className="abs-row">{shelf.map((item) => <AbsCard key={item.id} item={item} busy={playingId === item.id} onPlay={onPlay}/>)}</div></div>}
    {state.status === 'loading' && state.items.length === 0 && <p className="rd-empty-text"><span className="spinner"></span> A carregar a biblioteca…</p>}
    {state.status === 'error' && <p className="is-error-text">{state.message}</p>}
    {state.status === 'empty' && <p className="rd-empty-text">{query ? 'Nenhum audiolivro encontrado.' : 'A biblioteca ainda não tem audiolivros. Se acabaste de os adicionar, faz uma pesquisa de ficheiros no Audiobookshelf.'}</p>}
    {state.items.length > 0 && <div className="abs-grid">{state.items.map((item) => <AbsCard key={item.id} item={item} busy={playingId === item.id} onPlay={onPlay}/>)}</div>}
  </section>;
}

// Secção da página inicial: continuar a ouvir
export function ContinueListening({ onPlay, playingId = '' }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let active = true;
    window.streamnexus.absContinue().then((data) => { if (active) setItems(data.items); }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!items.length) return null;
  return <section className="content-section abs-view">
    <div className="section-heading"><div><span className="eyebrow">AUDIOBOOKSHELF</span><h2>Continuar a ouvir</h2></div></div>
    <div className="abs-row">{items.map((item) => <AbsCard key={item.id} item={item} busy={playingId === item.id} onPlay={onPlay}/>)}</div>
  </section>;
}
