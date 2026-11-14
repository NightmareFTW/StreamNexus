import { useMemo, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

const formatTime = (seconds) => { const total = Math.round(Number(seconds) || 0); return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : ''; };

export function FreeMusicPanel({ state, onOpen }) {
  const audioRef = useRef(null);
  const [current, setCurrent] = useState(null);
  const queue = useMemo(() => (state.data || []).flatMap((group) => group.tracks.map((track) => ({ ...track, source: group.source }))), [state.data]);
  const play = (track) => {
    setCurrent(track);
    window.requestAnimationFrame(() => audioRef.current?.play().catch(() => {}));
  };
  const playNext = () => {
    const index = queue.findIndex((track) => track.url === current?.url);
    if (index >= 0 && index + 1 < queue.length) play(queue[index + 1]);
  };
  return <section className="easy-sources free-music">
    <span className="eyebrow">OUVIR GRÁTIS · FAIXAS COMPLETAS</span>
    {state.status === 'loading' && <p className="rd-empty-text"><span className="spinner"></span> A procurar no Internet Archive e no Audius…</p>}
    {state.status === 'error' && <p className="rd-empty-text">Não foi possível consultar as fontes agora.</p>}
    {state.status === 'ready' && queue.length === 0 && <p className="rd-empty-text">Sem versão gratuita completa deste álbum. Os álbuns comerciais raramente existem nestas fontes; usa “Ouvir agora” (30 s) ou a pesquisa abaixo.</p>}
    {state.status === 'ready' && queue.length > 0 && <>
      <div className="free-player"><span>{current ? <><strong>{current.title}</strong><small>{current.source}</small></> : <small>Escolhe uma faixa para ouvir</small>}</span>
        <audio ref={audioRef} controls src={current?.url} onEnded={playNext}/></div>
      <div className="easy-list">{state.data.map((group) => <div className="free-group" key={`${group.source}-${group.title}`}>
        <div className="free-group-head"><span><strong>{group.title}</strong><small>{group.source}{group.creator ? ` · ${group.creator}` : ''}</small></span>{group.pageUrl && <button className="text-link" onClick={() => onOpen(group.pageUrl)}>Abrir página</button>}</div>
        <ol>{group.tracks.map((track) => <li key={track.url}><button className={current?.url === track.url ? 'active' : ''} onClick={() => play({ ...track, source: group.source })}><Icon name="play" size={12}/><span>{track.title}</span><em>{formatTime(track.duration)}</em></button></li>)}</ol>
      </div>)}</div>
    </>}
  </section>;
}
