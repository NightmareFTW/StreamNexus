import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import { musicStore } from './musicStore.js';

const clock = (seconds) => { const total = Math.max(0, Math.round(Number(seconds) || 0)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };
const Glyph = ({ d, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={d}/></svg>;
const PREV = 'M6 5h2v14H6zM20 5v14L9.5 12z';
const NEXT = 'M16 5h2v14h-2zM4 5l10.5 7L4 19z';
const readMinimized = () => { try { return window.localStorage.getItem('streamnexus.mini.minimized') === '1'; } catch { return false; } };

// Mini leitor global: fica montado enquanto se navega. Dois modos:
//  - 'tracks': faixas completas gratuitas tocadas aqui (elemento <audio>)
//  - 'spotify': comando remoto do Spotify (Premium) aberto noutro dispositivo
export function MiniPlayer({ mini, suspended, hidden = false, onIndex, onClose, onError, onRemote, onProgress }) {
  const audioRef = useRef(null);
  const [minimized, setMinimized] = useState(readMinimized);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [remote, setRemote] = useState(null);
  const [remoteError, setRemoteError] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const historyRef = useRef([]);
  const lastPlayerError = useRef('');
  const callbacks = useRef({});
  callbacks.current = { onRemote, onError, onProgress };
  const startAtRef = useRef({ url: mini.tracks?.[mini.index]?.url, at: mini.startAt || 0 });
  const isSpotify = mini.mode === 'spotify';
  const track = isSpotify ? null : mini.tracks[mini.index];

  const toggleMinimized = () => setMinimized((value) => { const next = !value; try { window.localStorage.setItem('streamnexus.mini.minimized', next ? '1' : '0'); } catch { /* sem armazenamento */ } return next; });

  // guarda a faixa e a posição de 5 em 5 segundos (para retomar mais tarde)
  useEffect(() => {
    if (isSpotify) return undefined;
    const timer = window.setInterval(() => callbacks.current.onProgress?.(mini.index, audioRef.current?.currentTime || 0), 5000);
    return () => { callbacks.current.onProgress?.(mini.index, audioRef.current?.currentTime || 0); window.clearInterval(timer); };
  }, [isSpotify, mini.index]);

  // --- modo faixas ---
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume, track?.url]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isSpotify) return;
    if (suspended) audio.pause();
  }, [suspended, isSpotify]);
  const step = useCallback((delta) => {
    const next = mini.index + delta;
    if (next >= 0 && next < mini.tracks.length) onIndex(next);
  }, [mini, onIndex]);
  const goTo = useCallback((index) => { historyRef.current.push(mini.index); onIndex(index); }, [mini.index, onIndex]);
  const advance = useCallback((automatic) => {
    const total = mini.tracks.length;
    if (automatic && repeat === 'one') { const audio = audioRef.current; if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); } return; }
    if (shuffle && total > 1) { let pick = mini.index; while (pick === mini.index) pick = Math.floor(Math.random() * total); goTo(pick); return; }
    if (mini.index + 1 < total) { goTo(mini.index + 1); return; }
    if (repeat !== 'off' && total > 0) { goTo(0); return; }
    setPlaying(false);
  }, [mini, repeat, shuffle, goTo]);

  // --- modo Spotify: sondagem do estado + progresso interpolado ---
  const refreshRemote = useCallback(async () => {
    try {
      const state = await window.streamnexus.spotifyConnectState();
      setRemote(state);
      setRemoteError('');
      callbacks.current.onRemote?.(state);
      if (state?.playerError && state.playerError !== lastPlayerError.current) { lastPlayerError.current = state.playerError; callbacks.current.onError?.(`Spotify: ${state.playerError}`); }
    } catch (error) { setRemoteError(error?.message || 'Não foi possível ler o estado do Spotify.'); }
  }, []);
  useEffect(() => {
    if (!isSpotify) return undefined;
    refreshRemote();
    const poll = window.setInterval(refreshRemote, suspended ? 15000 : 3000);
    return () => window.clearInterval(poll);
  }, [isSpotify, suspended, refreshRemote]);
  useEffect(() => {
    if (!isSpotify || !remote?.playing) return undefined;
    const tick = window.setInterval(() => setRemote((current) => (current?.playing ? { ...current, progress: Math.min(current.duration, current.progress + 1000) } : current)), 1000);
    return () => window.clearInterval(tick);
  }, [isSpotify, remote?.playing]);
  const command = async (payload) => {
    try { await window.streamnexus.spotifyConnectCommand(payload); window.setTimeout(refreshRemote, 700); } catch (error) { onError?.(error?.message || 'O Spotify não respondeu.'); }
  };

  const title = isSpotify ? (remote?.active ? remote.title : mini.title) : track?.title || mini.title;
  const subtitle = isSpotify ? (remote?.active ? `${remote.artist}${remote.device ? ` · ${remote.device}` : ''}` : (remoteError ? remoteError : 'A ligar ao Spotify…')) : `${mini.title}${track?.source ? ` · ${track.source}` : ''}`;
  const cover = isSpotify ? (remote?.cover || mini.cover) : mini.cover;
  const isPlaying = isSpotify ? Boolean(remote?.playing) : playing;
  const position = isSpotify ? (remote?.progress || 0) / 1000 : time;
  const total = isSpotify ? (remote?.duration || 0) / 1000 : (duration || track?.duration || 0);
  const togglePlay = () => {
    if (isSpotify) { command({ action: isPlaying ? 'pause' : 'resume' }); return; }
    const audio = audioRef.current;
    if (audio) (audio.paused ? audio.play().catch(() => {}) : audio.pause());
  };
  const seek = (seconds) => {
    if (isSpotify) { setRemote((current) => (current ? { ...current, progress: seconds * 1000 } : current)); command({ action: 'seek', positionMs: seconds * 1000 }); return; }
    if (audioRef.current) audioRef.current.currentTime = seconds;
  };
  const changeVolume = (value) => {
    setVolume(value);
    if (isSpotify) command({ action: 'volume', volume: value * 100 });
  };
  const canPrev = isSpotify ? true : mini.index > 0 || historyRef.current.length > 0;
  const canNext = isSpotify ? true : shuffle || repeat !== 'off' || mini.index + 1 < mini.tracks.length;
  const prev = () => {
    if (isSpotify) { command({ action: 'previous' }); return; }
    if (audioRef.current?.currentTime > 4) { seek(0); return; }
    const back = historyRef.current.pop();
    if (back !== undefined) onIndex(back); else step(-1);
  };
  const next = () => (isSpotify ? command({ action: 'next' }) : advance(false));
  const shuffleOn = isSpotify ? Boolean(remote?.shuffle) : shuffle;
  const repeatMode = isSpotify ? (remote?.repeat || 'off') : repeat;
  const toggleShuffle = () => {
    if (isSpotify) { setRemote((current) => (current ? { ...current, shuffle: !current.shuffle } : current)); command({ action: 'shuffle', value: !remote?.shuffle }); return; }
    setShuffle((value) => !value);
  };
  const cycleRepeat = () => {
    if (isSpotify) { const nextMode = repeatMode === 'off' ? 'context' : repeatMode === 'context' ? 'track' : 'off'; setRemote((current) => (current ? { ...current, repeat: nextMode } : current)); command({ action: 'repeat', value: nextMode }); return; }
    setRepeat((value) => (value === 'off' ? 'all' : value === 'all' ? 'one' : 'off'));
  };
  const repeatLabel = repeatMode === 'off' ? 'Repetir: desligado' : repeatMode === 'track' || repeatMode === 'one' ? 'Repetir a faixa' : 'Repetir o álbum';

  // Publica o estado (para o widget do Início) e mantém os controlos sempre atualizados
  useEffect(() => {
    musicStore.set({ mode: isSpotify ? 'spotify' : 'tracks', title, subtitle, cover, playing: isPlaying, position, duration: total, volume, shuffle: shuffleOn, repeat: repeatMode, canPrev, canNext, albumTitle: mini.title, queue: isSpotify ? null : mini.tracks.map((entry) => ({ title: entry.title, duration: entry.duration })), index: isSpotify ? -1 : mini.index });
  }, [title, subtitle, cover, isPlaying, position, total, volume, shuffleOn, repeatMode, canPrev, canNext, mini.index, mini.title]);
  useEffect(() => {
    musicStore.setControls({ toggle: togglePlay, prev, next, seek, setVolume: changeVolume, toggleShuffle, cycleRepeat, close: onClose, playIndex: (index) => { if (isSpotify) return; historyRef.current.push(mini.index); onIndex(index); } });
  });
  useEffect(() => () => musicStore.reset(), []);

  return <div className={`mini-player ${minimized ? 'is-min' : ''} ${suspended ? 'is-suspended' : ''} ${hidden ? 'is-hidden' : ''}`} role="region" aria-label="Mini leitor de música">
    {!isSpotify && track && <audio ref={audioRef} key={track.url} src={track.url} autoPlay
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration || 0); if (startAtRef.current.at && track.url === startAtRef.current.url) { event.currentTarget.currentTime = startAtRef.current.at; startAtRef.current.at = 0; } }}
      onEnded={() => advance(true)}
      onError={() => { onError?.(`Não foi possível reproduzir “${track.title}”.`); advance(false); }}/>}
    {minimized ? <>
      <div className="mini-cover" style={cover ? { backgroundImage: `url(${cover})` } : undefined}><Icon name="music" size={16}/></div>
      <div className="mini-info"><strong title={title}>{title}</strong><small>{subtitle}</small></div>
      <button className="mini-btn mini-btn-main" aria-label={isPlaying ? 'Pausar' : 'Tocar'} onClick={togglePlay}><Icon name={isPlaying ? 'pause' : 'play'} size={15}/></button>
      <button className="mini-btn" aria-label="Expandir" title="Expandir" onClick={toggleMinimized}><span className="mini-chev up"><Icon name="chevron" size={15}/></span></button>
      <button className="mini-btn" aria-label="Fechar" title="Fechar" onClick={onClose}><Icon name="close" size={14}/></button>
    </> : <>
      <div className="mini-head">
        <span className="mini-badge">{isSpotify ? 'SPOTIFY' : 'A OUVIR'}</span>
        <span className="mini-head-actions">
          <button className="mini-btn" aria-label="Minimizar" title="Minimizar" onClick={toggleMinimized}><span className="mini-chev down"><Icon name="chevron" size={15}/></span></button>
          <button className="mini-btn" aria-label="Fechar" title="Fechar" onClick={onClose}><Icon name="close" size={14}/></button>
        </span>
      </div>
      <div className="mini-body">
        <div className="mini-cover big" style={cover ? { backgroundImage: `url(${cover})` } : undefined}><Icon name="music" size={22}/></div>
        <div className="mini-info"><strong title={title}>{title}</strong><small title={subtitle}>{subtitle}</small></div>
      </div>
      <div className="mini-seek"><span>{clock(position)}</span><input type="range" min="0" max={Math.max(1, total)} step="1" value={Math.min(position, Math.max(1, total))} aria-label="Posição" onChange={(event) => seek(Number(event.target.value))}/><span>{clock(total)}</span></div>
      <div className="mini-controls">
        <button className={`mini-btn mini-toggle ${shuffleOn ? 'on' : ''}`} aria-label="Aleatório" aria-pressed={shuffleOn} title={shuffleOn ? 'Aleatório: ligado' : 'Aleatório: desligado'} onClick={toggleShuffle}><Icon name="shuffle" size={16}/></button>
        <button className="mini-btn" aria-label="Anterior" disabled={!canPrev} onClick={prev}><Glyph d={PREV}/></button>
        <button className="mini-btn mini-btn-main" aria-label={isPlaying ? 'Pausar' : 'Tocar'} onClick={togglePlay}><Icon name={isPlaying ? 'pause' : 'play'} size={17}/></button>
        <button className="mini-btn" aria-label="Seguinte" disabled={!canNext} onClick={next}><Glyph d={NEXT}/></button>
        <button className={`mini-btn mini-toggle ${repeatMode !== 'off' ? 'on' : ''}`} aria-label="Repetir" title={repeatLabel} onClick={cycleRepeat}><Icon name={repeatMode === 'track' || repeatMode === 'one' ? 'repeatOne' : 'repeat'} size={16}/></button>
        <label className="mini-volume"><Icon name="volume" size={15}/><input type="range" min="0" max="1" step="0.05" value={volume} aria-label="Volume" onChange={(event) => changeVolume(Number(event.target.value))}/></label>
      </div>
    </>}
  </div>;
}
