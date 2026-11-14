import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

const SKELETON_KIND = { music: 'music', books: 'book', adultvideos: 'clip' };

function Skeleton({ kind, count = 3 }) {
  return Array.from({ length: count }, (_, index) => <article key={index} className={`poster-card poster-skeleton poster-${SKELETON_KIND[kind] || 'video'}`} aria-hidden="true">
    <div className="poster-image"><span className="poster-shade"></span></div>
    <div className="skeleton-line"></div><div className="skeleton-line short"></div>
  </article>);
}

// Dispara `onVisible` quando o elemento chega perto do ecrã; volta a observar a cada `tick` para encadear carregamentos.
function useVisible(onVisible, enabled, tick) {
  const ref = useRef(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) callback.current(); }, { rootMargin: '1400px 0px' });
    observer.observe(node);
    // reforço: em janelas em segundo plano o IntersectionObserver pode não avisar
    const check = () => { if (node.getBoundingClientRect().top < window.innerHeight + 1400) callback.current(); };
    const timer = window.setTimeout(check, 80);
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => { observer.disconnect(); window.clearTimeout(timer); window.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
  }, [enabled, tick]);
  return ref;
}

function Rail({ shelf, index, kind, orientation, seen, renderCard, activePage, onViewAll }) {
  const signature = shelf.items.map((item) => item.id).join('|');
  const [items, setItems] = useState(shelf.items);
  const [loading, setLoading] = useState(false);
  const rowRef = useRef(null);
  const state = useRef({ cursor: shelf.cursor, hasMore: Boolean(shelf.feedId) && shelf.cursor != null && shelf.hasMore !== false, busy: false, errors: 0 });

  useEffect(() => {
    setItems(shelf.items);
    state.current = { cursor: shelf.cursor, hasMore: Boolean(shelf.feedId) && shelf.cursor != null && shelf.hasMore !== false, busy: false, errors: 0 };
  }, [signature, shelf.feedId]);

  const loadMore = useCallback(async () => {
    const current = state.current;
    if (!shelf.feedId || current.busy || !current.hasMore || !window.streamnexus?.feedShelf) return;
    current.busy = true;
    setLoading(true);
    try {
      let fresh = [];
      for (let attempt = 0; attempt < 3 && !fresh.length && current.hasMore; attempt += 1) {
        const page = await window.streamnexus.feedShelf({ kind, shelfId: shelf.feedId, cursor: current.cursor, orientation });
        current.cursor = page.cursor;
        current.hasMore = Boolean(page.hasMore);
        fresh = (page.items || []).filter((item) => item.id && item.poster && !seen.current.has(item.id));
      }
      fresh.forEach((item) => seen.current.add(item.id));
      current.errors = 0;
      if (fresh.length) setItems((existing) => [...existing, ...fresh]);
    } catch { current.errors += 1; if (current.errors >= 3) current.hasMore = false; } finally { current.busy = false; setLoading(false); }
  }, [kind, orientation, shelf.feedId]);

  const checkEnd = useCallback(() => {
    const row = rowRef.current;
    if (row && row.scrollLeft + row.clientWidth * 2.2 >= row.scrollWidth) loadMore();
  }, [loadMore]);

  // mantém sempre pelo menos ~2 ecrãs de conteúdo à frente
  useEffect(() => { const timer = window.setTimeout(checkEnd, 60); return () => window.clearTimeout(timer); }, [items.length, checkEnd]);

  return <section className={`content-section discovery-rail ${index === 0 ? 'discover-section' : ''}`}>
    <div className="section-heading"><div><span className="eyebrow">{shelf.eyebrow}</span><h2>{shelf.title}</h2></div>
      <div className="section-controls">
        {shelf.page && shelf.page !== activePage && onViewAll && <button className="view-all" onClick={() => onViewAll(shelf.page)}>{shelf.page === 'series' ? 'Todas as séries' : 'Explorar catálogo'} <Icon name="chevron" size={14}/></button>}
        <div className="arrow-pair">
          <button aria-label="Anterior" onClick={() => rowRef.current?.scrollBy({ left: -560, behavior: 'smooth' })}><Icon name="chevron" size={16}/></button>
          <button aria-label="Seguinte" onClick={() => rowRef.current?.scrollBy({ left: 560, behavior: 'smooth' })}><Icon name="chevron" size={16}/></button>
        </div>
      </div>
    </div>
    <div ref={rowRef} className={`poster-row ${shelf.ranked ? 'ranked-row' : ''}`} onScroll={checkEnd}>
      {items.map((item, itemIndex) => renderCard(item, itemIndex, shelf.ranked ? itemIndex + 1 : null))}
      {loading && <Skeleton kind={kind} count={3}/>}
    </div>
  </section>;
}

function CategoryGrid({ kind, category, orientation, renderCard }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState('');
  const [tick, setTick] = useState(0);
  const state = useRef({ cursor: undefined, hasMore: true, busy: false, seen: new Set(), run: 0, total: 0 });

  const loadPage = useCallback(async () => {
    const current = state.current;
    if (current.busy || !current.hasMore || !window.streamnexus?.feedCategory) return;
    current.busy = true;
    const run = current.run;
    setLoadingMore(true);
    try {
      let fresh = [];
      for (let attempt = 0; attempt < 3 && !fresh.length && current.hasMore; attempt += 1) {
        const page = await window.streamnexus.feedCategory({ kind, category, cursor: current.cursor, orientation });
        if (run !== state.current.run) return;
        current.cursor = page.cursor;
        current.hasMore = Boolean(page.hasMore);
        fresh = (page.items || []).filter((item) => item.id && item.poster && !current.seen.has(item.id));
      }
      fresh.forEach((item) => current.seen.add(item.id));
      current.total = (current.total || 0) + fresh.length;
      setStatus(current.total ? 'ready' : 'empty');
      if (fresh.length) setItems((existing) => [...existing, ...fresh]);
    } catch (error) {
      if (run !== state.current.run) return;
      current.errors = (current.errors || 0) + 1;
      if (current.errors >= 3 || !current.total) current.hasMore = false;
      setMessage(error?.message || 'Não foi possível carregar esta categoria.');
      setStatus((existing) => (existing === 'loading' ? 'error' : existing));
    } finally {
      if (run === state.current.run) { current.busy = false; setLoadingMore(false); setTick((value) => value + 1); }
    }
  }, [kind, category, orientation]);

  useEffect(() => {
    state.current = { cursor: undefined, hasMore: true, busy: false, seen: new Set(), run: state.current.run + 1, total: 0 };
    setItems([]); setStatus('loading'); setMessage('');
    loadPage();
  }, [kind, category, orientation]);

  const sentinel = useVisible(loadPage, status === 'ready' && state.current.hasMore, tick);

  return <section className="content-section category-feed">
    <div className="section-heading"><div><span className="eyebrow">CATEGORIA</span><h2>{category}</h2></div></div>
    {status === 'error' && <div className="empty-list catalog-empty"><span><Icon name="alert" size={22}/></span><strong>Não foi possível carregar esta categoria</strong><p className="is-error-text">{message}</p><button className="text-link" onClick={() => { state.current = { ...state.current, cursor: undefined, hasMore: true, busy: false, seen: new Set(), run: state.current.run + 1, total: 0 }; setItems([]); setStatus('loading'); loadPage(); }}>Tentar novamente <Icon name="refresh" size={14}/></button></div>}
    {status === 'empty' && <div className="empty-list catalog-empty"><span><Icon name="search" size={22}/></span><strong>Sem títulos nesta categoria</strong><p>Experimenta outra categoria ou volta a ver tudo.</p></div>}
    <div className={`infinite-grid grid-${SKELETON_KIND[kind] || 'video'}`}>
      {items.map((item, index) => renderCard(item, index % 12, null))}
      {(status === 'loading' || loadingMore) && <Skeleton kind={kind} count={status === 'loading' ? 12 : 6}/>}
    </div>
    <div ref={sentinel} className="feed-sentinel"></div>
  </section>;
}

export function FeedShelves({ kind, shelves, genre, activePage, orientation = '', renderCard, onViewAll }) {
  const seen = useRef(new Set());
  const initialSignature = shelves.map((shelf) => `${shelf.feedId || shelf.title}:${shelf.items.length}`).join('#');
  useMemo(() => { shelves.forEach((shelf) => shelf.items.forEach((item) => seen.current.add(item.id))); return null; }, [initialSignature]);

  const [extra, setExtra] = useState([]);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [tick, setTick] = useState(0);
  const extraState = useRef({ offset: 0, done: false, busy: false, errors: 0 });

  const loadNext = useCallback(async () => {
    const current = extraState.current;
    if (current.busy || current.done || !window.streamnexus?.feedShelves) return;
    current.busy = true;
    setLoadingExtra(true);
    try {
      const result = await window.streamnexus.feedShelves({ kind, offset: current.offset, count: 2, orientation });
      current.offset += result.consumed || 0;
      current.done = Boolean(result.done) || !result.consumed;
      const fresh = (result.shelves || [])
        .map((shelf) => ({ ...shelf, page: activePage, items: (shelf.items || []).filter((item) => item.id && item.poster && !seen.current.has(item.id)) }))
        .filter((shelf) => shelf.items.length >= 4);
      fresh.forEach((shelf) => shelf.items.forEach((item) => seen.current.add(item.id)));
      current.errors = 0;
      if (fresh.length) setExtra((existing) => [...existing, ...fresh]);
    } catch { current.errors += 1; if (current.errors >= 3) current.done = true; } finally { current.busy = false; setLoadingExtra(false); setTick((value) => value + 1); }
  }, [kind, orientation, activePage]);

  const sentinel = useVisible(loadNext, genre === 'Todos' && shelves.length > 0 && !extraState.current.done, tick + shelves.length);

  return <>
    <div hidden={genre !== 'Todos'}>
      {[...shelves, ...extra].map((shelf, index) => <Rail key={`${shelf.feedId || ''}|${shelf.title}`} shelf={shelf} index={index} kind={kind} orientation={orientation} seen={seen} renderCard={renderCard} activePage={activePage} onViewAll={onViewAll}/>)}
      {loadingExtra && <section className="content-section discovery-rail" aria-hidden="true"><div className="section-heading"><div><span className="skeleton-line wide"></span></div></div><div className="poster-row"><Skeleton kind={kind} count={6}/></div></section>}
      <div ref={sentinel} className="feed-sentinel"></div>
    </div>
    {genre !== 'Todos' && <CategoryGrid key={`${kind}|${genre}|${orientation}`} kind={kind} category={genre} orientation={orientation} renderCard={renderCard}/>}
  </>;
}
