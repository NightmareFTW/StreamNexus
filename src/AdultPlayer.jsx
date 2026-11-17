import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

const clock = (seconds) => { const total = Math.max(0, Math.round(Number(seconds) || 0)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
const PREF_KEY = 'streamnexus.adult.quality';
const readPreferred = () => { try { return Number(localStorage.getItem(PREF_KEY)) || 720; } catch { return 720; } };

// Leitor próprio dos vídeos +18: MP4 direto de cada fonte, com escolha de qualidade.
// Se não for possível obter as qualidades, cai para o leitor incorporado do site.
export function AdultPlayer({ item, onClose, onFallback, onNotify }) {
  const videoRef = useRef(null);
  const boxRef = useRef(null);
  const resumeRef = useRef(null);
  const userPaused = useRef(false);
  const hideTimer = useRef(0);
  const [media, setMedia] = useState({ status: 'loading', qualities: [], message: '' });
  const [height, setHeight] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controls, setControls] = useState(true);
  const [buffering, setBuffering] = useState(true);

  useEffect(() => {
    let active = true;
    window.streamnexus.resolveAdultMedia({ embedUrl: item.embedUrl })
      .then((result) => {
        if (!active) return;
        const preferred = readPreferred();
        const best = result.qualities.find((entry) => entry.height <= preferred) || result.qualities[result.qualities.length - 1];
        setMedia({ status: 'ready', qualities: result.qualities, message: '' });
        setHeight(best.height);
      })
      .catch((error) => { if (active) setMedia({ status: 'error', qualities: [], message: error?.message || 'Não foi possível obter o vídeo.' }); });
    return () => { active = false; };
  }, [item.embedUrl]);

  const current = media.qualities.find((entry) => entry.height === height);

  const revealControls = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControls(false), 2800);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === boxRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = () => { const video = videoRef.current; if (!video) return; if (video.paused) { userPaused.current = false; video.play().catch(() => {}); } else { userPaused.current = true; video.pause(); } };
  const seekBy = (delta) => { const video = videoRef.current; if (video) video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta)); };
  const toggleFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else boxRef.current?.requestFullscreen?.().catch(() => {}); };
  const changeQuality = (value) => {
    setMenuOpen(false);
    if (value === height) return;
    const video = videoRef.current;
    resumeRef.current = { time: video?.currentTime || 0, play: video ? !video.paused : true };
    setBuffering(true);
    try { localStorage.setItem(PREF_KEY, String(value)); } catch { /* preferência só nesta sessão */ }
    setHeight(value);
  };

  useEffect(() => {
    const onKey = (event) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (event.key === ' ' || event.key === 'k') { event.preventDefault(); toggle(); revealControls(); }
      else if (event.key === 'ArrowRight') { seekBy(10); revealControls(); }
      else if (event.key === 'ArrowLeft') { seekBy(-10); revealControls(); }
      else if (event.key === 'f') toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealControls]);

  // Erro de reprodução: tenta uma qualidade inferior e, no fim, o leitor incorporado
  const handleError = () => {
    const lower = media.qualities.find((entry) => entry.height < height);
    if (lower) { onNotify?.(`${height}p não carregou; a tentar ${lower.height}p.`, 'info'); resumeRef.current = { time: videoRef.current?.currentTime || 0, play: true }; setHeight(lower.height); return; }
    onFallback();
  };

  return <div className="adult-player modal-card">
    <button className="modal-close" aria-label="Fechar" onClick={onClose}><Icon name="close"/></button>
    <span className="eyebrow">{String(item.source || '').toUpperCase()} · +18</span>
    <h2>{item.title}</h2>
    <div ref={boxRef} className={`adult-stage ${controls || !playing || menuOpen ? 'show-controls' : ''}`} onMouseMove={revealControls} onMouseLeave={() => playing && setControls(false)}>
      {media.status === 'loading' && <div className="adult-stage-msg"><span className="spinner"></span><strong>A obter as qualidades…</strong></div>}
      {media.status === 'error' && <div className="adult-stage-msg"><Icon name="alert" size={22}/><strong>Não foi possível abrir no leitor próprio</strong><span>{media.message}</span><button className="button button-primary button-sm" onClick={onFallback}>Abrir no leitor do site</button></div>}
      {current && <video ref={videoRef} key={current.url} src={current.url} autoPlay playsInline referrerPolicy="no-referrer" poster={item.poster}
        onClick={toggle} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={handleError}
        onWaiting={() => setBuffering(true)} onPlaying={() => setBuffering(false)} onCanPlay={(event) => { setBuffering(false); const video = event.currentTarget; if (video.paused && !userPaused.current && !(resumeRef.current && !resumeRef.current.play)) video.play().catch(() => {}); }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => { const video = event.currentTarget; setDuration(video.duration || 0); video.volume = volume; video.muted = muted; const resume = resumeRef.current; resumeRef.current = null; if (resume) { video.currentTime = resume.time; if (!resume.play) { userPaused.current = true; video.pause(); } } }}/>}
      {current && buffering && media.status === 'ready' && <div className="adult-buffering"><span className="spinner"></span></div>}
      {media.status === 'ready' && <div className="adult-controls">
        <input className="adult-seek" type="range" min="0" max={Math.max(1, duration)} step="0.5" value={Math.min(time, duration || 0)} aria-label="Posição" onChange={(event) => { if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); }}/>
        <div className="adult-controls-row">
          <button className="adult-btn" aria-label={playing ? 'Pausar' : 'Reproduzir'} onClick={toggle}><Icon name={playing ? 'pause' : 'play'} size={20}/></button>
          <span className="adult-time">{clock(time)} <i>/</i> {clock(duration)}</span>
          <span className="adult-spacer"></span>
          <button className="adult-btn" aria-label={muted || volume === 0 ? 'Ativar som' : 'Silenciar'} onClick={() => { const next = !muted; setMuted(next); if (videoRef.current) videoRef.current.muted = next; }}><Icon name={muted || volume === 0 ? 'volumeOff' : 'volume'} size={19}/></button>
          <input className="adult-volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label="Volume" onChange={(event) => { const value = Number(event.target.value); setVolume(value); setMuted(value === 0); if (videoRef.current) { videoRef.current.volume = value; videoRef.current.muted = value === 0; } }}/>
          <span className="adult-quality-wrap">
            <button className={`adult-btn adult-quality-btn ${menuOpen ? 'active' : ''}`} aria-label="Qualidade" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Icon name="settings" size={18}/><b>{height ? `${height}p` : ''}</b></button>
            {menuOpen && <div className="adult-quality-menu" role="menu"><small>QUALIDADE</small>{media.qualities.map((entry) => <button key={entry.height} role="menuitemradio" aria-checked={entry.height === height} className={entry.height === height ? 'active' : ''} onClick={() => changeQuality(entry.height)}>{entry.label}{entry.height >= 1080 ? <em>Full HD</em> : entry.height >= 720 ? <em>HD</em> : null}</button>)}</div>}
          </span>
          <button className="adult-btn" aria-label={fullscreen ? 'Sair do ecrã inteiro' : 'Ecrã inteiro'} onClick={toggleFullscreen}><Icon name="fullscreen" size={19}/></button>
        </div>
      </div>}
    </div>
    <small className="embed-note">Vídeo reproduzido a partir de {item.source}. A StreamNexus não aloja nem descarrega este conteúdo. Espaço: pausa · ← →: ±10 s · F: ecrã inteiro.</small>
  </div>;
}
