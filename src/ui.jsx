import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Dá aos cartões o estado de visto do perfil atual (função item -> info | null)
export const WatchContext = createContext(null);
// Resolve a pré-visualização de um vídeo (item -> { url, duration }); só existe nos vídeos +18
export const PreviewContext = createContext(null);

// Separador do logótipo STREAM››NEXUS: dois chevrons (fluxo), centrados na altura das maiúsculas
export function BrandFlow() {
  return <svg className="brand-flow" viewBox="0 0 96 100" aria-hidden="true"><path d="M8 12 42 50 8 88" fill="none" stroke="currentColor" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round"/><path d="M50 12 84 50 50 88" fill="none" stroke="#fff" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export const POSTER_KIND = { 'Álbum': 'music', 'Livro': 'book', 'Canal': 'channel', 'Vídeo': 'clip' };

export function Icon({ name, size = 18, stroke = 1.8 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    shuffle: <><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/></>,
    repeat: <><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></>,
    repeatOne: <><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2.5 5.1-5.1 2.5 2.5-5.1z"/></>,
    film: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4"/></>,
    tv: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m8 2 4 3 4-3M8 22h8"/></>,
    music: <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20"/></>,
    adult: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h2m6 0h2m-8 5a3 3 0 0 0 6 0"/><path d="M8 2v2m8-2v2"/></>,
    bookmark: <><path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-3.8L6 21z"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 17v3h14v-3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.3a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.3a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2v-.3a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.3a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    play: <path d="m8 5 12 7-12 7z" fill="currentColor" stroke="none"/>,
    pause: <><path d="M8 5v14M16 5v14" strokeWidth="3"/></>,
    skipBack: <><path d="M5 5v14" strokeWidth="2.5"/><path d="m19 6-10 6 10 6z" fill="currentColor" stroke="none"/></>,
    skipForward: <><path d="M19 5v14" strokeWidth="2.5"/><path d="m5 6 10 6-10 6z" fill="currentColor" stroke="none"/></>,
    volume: <><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"/></>,
    volumeOff: <><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6m0-6-5 6"/></>,
    captions: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4m-4 4h3m4-4h3m-3 4h4"/></>,
    fullscreen: <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    external: <><path d="M14 3h7v7M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/></>,
    cloud: <><path d="M20 16.2A4 4 0 0 0 18 8.5a6 6 0 0 0-11.7 1.4A4 4 0 0 0 7 18h11"/><path d="m12 12-3 3h2v4h2v-4h2z"/></>,
    alert: <><path d="M10.3 4.3 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9v4m0 4h.01"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/></>,
    chart: <><path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
    trophy: <><path d="M8 21h8m-4-4v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></>,
  };
  return <svg {...common}>{paths[name] || paths.spark}</svg>;
}

/* Fila horizontal sem barra visível: roda do rato, arrastar, auto-scroll nas pontas e esbatido */
export function ScrollRow({ className = '', children, ...props }) {
  const ref = useRef(null);
  const drag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const pointerX = useRef(null);
  const frame = useRef(0);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const left = element.scrollLeft > 4;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 4;
    setEdges((previous) => (previous.left === left && previous.right === right ? previous : { left, right }));
  }, []);

  const edgeScroll = useCallback(() => {
    frame.current = 0;
    const element = ref.current;
    if (!element || pointerX.current === null || drag.current.active) return;
    const rect = element.getBoundingClientRect();
    const zone = Math.min(120, rect.width * 0.2);
    const position = pointerX.current - rect.left;
    let speed = 0;
    if (position < zone) speed = -(1 - Math.max(position, 0) / zone) * 14;
    else if (position > rect.width - zone) speed = (1 - Math.max(rect.width - position, 0) / zone) * 14;
    if (!speed) return;
    const max = element.scrollWidth - element.clientWidth;
    const next = Math.max(0, Math.min(max, element.scrollLeft + speed));
    if (next === element.scrollLeft) return;
    element.scrollLeft = next;
    frame.current = requestAnimationFrame(edgeScroll);
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    update();
    const onWheel = (event) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const max = element.scrollWidth - element.clientWidth;
      if (max <= 0) return;
      event.preventDefault();
      element.scrollLeft = Math.max(0, Math.min(max, element.scrollLeft + event.deltaY));
    };
    const onMove = (event) => {
      if (!drag.current.active) return;
      const distance = event.clientX - drag.current.startX;
      if (!drag.current.moved && Math.abs(distance) > 5) { drag.current.moved = true; element.classList.add('is-dragging'); }
      if (drag.current.moved) element.scrollLeft = drag.current.startLeft - distance;
    };
    const onUp = () => { drag.current.active = false; element.classList.remove('is-dragging'); };
    element.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', update);
    return () => {
      element.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('resize', update);
      cancelAnimationFrame(frame.current);
    };
  }, [update]);

  useEffect(update);

  return <div
    ref={ref}
    className={`scroll-row ${className} ${edges.left ? 'fade-left' : ''} ${edges.right ? 'fade-right' : ''}`}
    onScroll={update}
    onMouseDown={(event) => {
      if (event.button !== 0 || !ref.current) return;
      drag.current = { active: true, moved: false, startX: event.clientX, startLeft: ref.current.scrollLeft };
    }}
    onMouseMove={(event) => {
      pointerX.current = event.clientX;
      if (!frame.current && !drag.current.active) frame.current = requestAnimationFrame(edgeScroll);
    }}
    onMouseLeave={() => { pointerX.current = null; cancelAnimationFrame(frame.current); frame.current = 0; }}
    onClickCapture={(event) => { if (drag.current.moved) { event.preventDefault(); event.stopPropagation(); drag.current.moved = false; } }}
    {...props}
  >{children}</div>;
}

export function PosterCard({ item, index, saved, onOpen, onSave, rank, hideSave = false, onMissingLogo }) {
  const sources = item.posters?.length ? item.posters : [item.poster];
  const [imageIndex, setImageIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const previewResolver = useContext(PreviewContext);
  const canPreview = Boolean(previewResolver && item.type === 'Vídeo' && item.embedUrl);
  const [preview, setPreview] = useState(null);
  const hoverTimer = useRef(0);
  const hoverToken = useRef(0);
  const startHover = () => {
    if (!canPreview) return;
    window.clearTimeout(hoverTimer.current);
    const token = ++hoverToken.current;
    hoverTimer.current = window.setTimeout(async () => {
      try { const info = await previewResolver(item); if (token === hoverToken.current && info?.url) setPreview(info); } catch { /* sem pré-visualização */ }
    }, 700);
  };
  const endHover = () => { hoverToken.current += 1; window.clearTimeout(hoverTimer.current); setPreview(null); };
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const imageFailed = imageIndex >= sources.length || !sources[imageIndex];
  const watchLookup = useContext(WatchContext);
  const watchState = watchLookup && (item.type === 'Filme' || item.type === 'Série') ? watchLookup(item) : null;
  useEffect(() => { if (imageFailed && onMissingLogo) onMissingLogo(item); }, [imageFailed]);
  return <article className={`poster-card ${rank ? 'ranked-poster-card' : ''} ${item.offline ? 'is-offline' : ''} poster-${POSTER_KIND[item.type] || 'video'}`} style={{ '--card-delay': `${index * 45}ms`, '--poster-accent': item.accent || '#705d8b' }} onMouseEnter={startHover} onMouseLeave={endHover}>
    {rank && <span className="poster-rank">{rank}</span>}
    <button className="poster-image" onClick={onOpen} aria-label={`Ver detalhes de ${item.title}`}>
      {imageFailed ? <span className="poster-fallback"><i>{String(item.type).toUpperCase()}</i><strong>{item.title}</strong><small>{item.year}</small></span> : <img key={`${sources[imageIndex]}|${attempt}`} src={sources[imageIndex]} referrerPolicy="no-referrer" alt={`Poster de ${item.title}`} loading="lazy" onError={(event) => { event.currentTarget.classList.add('img-error'); if (attempt < 2) window.setTimeout(() => setAttempt((value) => value + 1), 900 * (attempt + 1)); else { setImageIndex((current) => current + 1); setAttempt(0); } }}/>}
      {preview && <video className="poster-preview" src={preview.url} muted loop playsInline autoPlay preload="auto" onLoadedMetadata={(event) => { const video = event.currentTarget; const start = video.duration > 40 ? video.duration * 0.3 : 0; video.dataset.start = String(start); if (start) video.currentTime = start; }} onTimeUpdate={(event) => { const video = event.currentTarget; const start = Number(video.dataset.start) || 0; if (video.currentTime - start > 6) video.currentTime = start; }} onError={() => setPreview(null)}/>}
      <span className="poster-shade"></span><span className="poster-hover-play"><Icon name="play" size={17}/></span><span className="poster-type">{item.type}</span>
      {watchState?.kind === 'movie' && watchState.watched && <span className="poster-watched" title="Visto"><Icon name="check" size={12}/>Visto</span>}
      {watchState?.kind === 'series' && watchState.last && <span className="poster-watched poster-episode-chip" title="Último episódio">T{watchState.last.season}·E{watchState.last.episode}</span>}
      {watchState?.inProgress && watchState.percent > 0 && <i className="poster-progress"><b style={{ width: `${Math.round(watchState.percent * 100)}%` }}></b></i>}
    </button>
    {!hideSave && <button className={`poster-save ${saved ? 'saved' : ''}`} aria-label={saved ? 'Remover da lista' : 'Adicionar à lista'} onClick={onSave}><Icon name={saved ? 'check' : 'plus'} size={15}/></button>}
    <button className="poster-title" onClick={onOpen}>{item.title}</button><div className="poster-sub"><span>{item.creator ? item.creator : <>{item.year} <i>·</i> {item.genre}</>}</span>{item.rating && <span className="poster-rating">★ {item.rating}</span>}</div>
  </article>;
}
