import { useEffect, useMemo, useState } from 'react';
import { Icon } from './ui.jsx';

const formatTime = (seconds) => { const total = Math.round(Number(seconds) || 0); return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : ''; };

// Faixas completas gratuitas: tocam no mini leitor global, que continua ativo ao navegar.
export function FreeMusicPanel({ state, onOpen, onPlay, activeUrl }) {
  const queue = useMemo(() => (state.data || []).flatMap((group) => group.tracks.map((track) => ({ ...track, source: group.source }))), [state.data]);
  const play = (track) => { const index = queue.findIndex((entry) => entry.url === track.url); if (index >= 0) onPlay(queue, index); };
  return <section className="easy-sources free-music">
    <span className="eyebrow">OUVIR GRÁTIS · FAIXAS COMPLETAS</span>
    {state.status === 'loading' && <p className="rd-empty-text"><span className="spinner"></span> A procurar este álbum no Internet Archive e no Audius…</p>}
    {state.status === 'error' && <p className="rd-empty-text">Não foi possível consultar as fontes agora.</p>}
    {state.status === 'ready' && queue.length === 0 && <p className="rd-empty-text">Não existe uma versão gratuita deste álbum nestas fontes. Os álbuns comerciais raramente existem aqui; usa “Ouvir agora” (30 s), o Spotify (se estiver ligado) ou a pesquisa abaixo.</p>}
    {state.status === 'ready' && queue.length > 0 && <>
      <div className="easy-list">{state.data.map((group) => <div className="free-group" key={`${group.source}-${group.title}`}>
        <div className="free-group-head"><span><strong>{group.title}</strong><small>{group.source}{group.creator ? ` · ${group.creator}` : ''}</small></span>{group.pageUrl && <button className="text-link" onClick={() => onOpen(group.pageUrl)}>Abrir página</button>}</div>
        <ol>{group.tracks.map((track) => <li key={track.url}><button className={activeUrl === track.url ? 'active' : ''} onClick={() => play({ ...track, source: group.source })}><Icon name="play" size={12}/><span>{track.title}</span><em>{formatTime(track.duration)}</em></button></li>)}</ol>
      </div>)}</div>
    </>}
  </section>;
}

// Ligação à conta Spotify (Premium): o Spotify só dá faixas completas a apps com DRM,
// por isso a app comanda o Spotify aberto no PC/telemóvel através do mini leitor.
export function SpotifyConnectBox({ album, onListen, onNotify }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    window.streamnexus?.spotifyConnectStatus?.().then((value) => { if (active) setStatus(value); }).catch(() => { if (active) setStatus(null); });
    return () => { active = false; };
  }, [album?.id]);
  if (!window.streamnexus?.isDesktop || !status) return null;
  const connect = async () => {
    setBusy(true);
    try { setStatus({ ...status, ...(await window.streamnexus.spotifyConnectLogin()) }); onNotify?.('Spotify ligado.', 'success'); }
    catch (error) { onNotify?.(error?.message || 'Não foi possível ligar o Spotify.', 'error'); }
    finally { setBusy(false); }
  };
  const disconnect = async () => { await window.streamnexus.spotifyConnectLogout().catch(() => {}); setStatus({ ...status, connected: false, name: '' }); };
  const listen = async () => {
    setBusy(true);
    try { await onListen(); } finally { setBusy(false); }
  };
  return <section className="easy-sources spotify-connect">
    <span className="eyebrow">SPOTIFY PREMIUM · COMANDO REMOTO</span>
    {!status.configured && <p className="rd-empty-text">Para ouvir álbuns completos com a tua conta Premium, indica o Client ID do Spotify nas Integrações e regista o endereço de retorno <code>{status.redirectUri}</code> na tua app Spotify.</p>}
    {status.configured && !status.connected && <>
      <p className="rd-empty-text">{status.inApp ? 'Liga a tua conta Premium e o Spotify toca dentro do StreamNexus, sem abrir mais nada.' : 'Esta versão do Electron não tem DRM, por isso o StreamNexus só consegue comandar o Spotify aberto no teu PC ou telemóvel.'} Regista <code>{status.redirectUri}</code> como Redirect URI na tua app Spotify (developer.spotify.com).</p>
      <div className="detail-actions"><button className="button button-primary" disabled={busy} onClick={connect}>{busy ? <span className="spinner"></span> : <Icon name="link" size={16}/>}Ligar conta Spotify</button></div>
    </>}
    {status.configured && status.connected && <>
      <p className="rd-empty-text">Ligado{status.name ? ` como ${status.name}` : ''}. {status.needsReconnect ? 'Para tocar dentro da app é preciso voltar a ligar a conta (novas permissões).' : status.inApp ? 'O som sai diretamente do StreamNexus; controlas tudo pelo mini leitor.' : 'O som sai do Spotify aberto num dos teus dispositivos; aqui controlas tudo pelo mini leitor.'}</p>
      <div className="detail-actions">{status.needsReconnect ? <button className="button button-primary" disabled={busy} onClick={connect}>{busy ? <span className="spinner"></span> : <Icon name="link" size={16}/>}Voltar a ligar o Spotify</button> : <button className="button button-primary" disabled={busy} onClick={listen}>{busy ? <span className="spinner"></span> : <Icon name="play" size={16}/>}{status.inApp ? 'Ouvir álbum completo aqui' : 'Ouvir álbum completo no Spotify'}</button>}<button className="button button-quiet" onClick={disconnect}>Desligar</button></div>
    </>}
  </section>;
}
