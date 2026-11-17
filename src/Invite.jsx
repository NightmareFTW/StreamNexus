import { useState } from 'react';
import { Icon } from './ui.jsx';

export const WELCOME_KEY = 'streamnexus.welcomeDone';
export const welcomeDone = () => { try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch { return false; } };
export const markWelcomeDone = () => { try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* sem armazenamento */ } };

const errorText = (error) => String(error?.message || error || 'Não foi possível concluir.').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const SUMMARY = [['tmdb', 'Catálogo (TMDB)'], ['prowlarr', 'Pesquisa de fontes (Prowlarr)'], ['shelfarr', 'Pedidos de livros (Shelfarr)'], ['spotify', 'Música (Spotify)']];

// Primeiro arranque: cola o código de convite e fica tudo ligado.
export function WelcomeScreen({ onDone }) {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '', result: null });
  const activate = async (event) => {
    event.preventDefault();
    setState({ status: 'busy', message: '', result: null });
    try {
      const result = await window.streamnexus.importInvite({ code, pin });
      markWelcomeDone();
      setState({ status: 'done', message: '', result });
    } catch (error) { setState({ status: 'error', message: errorText(error), result: null }); }
  };
  const skip = () => { markWelcomeDone(); onDone(); };
  if (state.status === 'done') {
    return <div className="profile-gate"><div className="profile-gate-inner welcome-card">
      <span className="eyebrow">TUDO PRONTO</span>
      <h1>Já está ligado</h1>
      <ul className="welcome-list">{SUMMARY.filter(([key]) => state.result[key]).map(([key, label]) => <li key={key}><Icon name="check" size={15}/>{label}</li>)}</ul>
      <p className="welcome-note">Podes mudar tudo mais tarde em Definições e integrações.</p>
      <div className="profile-gate-actions"><button className="button button-primary" onClick={onDone}>Começar</button></div>
    </div></div>;
  }
  return <div className="profile-gate"><div className="profile-gate-inner welcome-card">
    <span className="eyebrow">BEM-VINDO</span>
    <h1>Vamos ligar a StreamNexus</h1>
    <p className="welcome-note">Quem te enviou a app deve ter-te dado um <strong>código de convite</strong> e um <strong>PIN</strong>. Cola-os aqui e fica tudo configurado, sem mais passos.</p>
    <form onSubmit={activate} className="welcome-form">
      <label className="input-label" htmlFor="invite-code">Código de convite</label>
      <textarea id="invite-code" className="text-input welcome-code" rows={4} placeholder="SN1.…" value={code} onChange={(event) => setCode(event.target.value)} spellCheck={false}/>
      <label className="input-label" htmlFor="invite-pin">PIN</label>
      <input id="invite-pin" className="text-input" type="password" autoComplete="off" placeholder="PIN do convite" value={pin} onChange={(event) => setPin(event.target.value)}/>
      {state.status === 'error' && <p className="is-error-text">{state.message}</p>}
      <div className="profile-gate-actions">
        <button className="button button-primary" disabled={state.status === 'busy' || !code.trim() || !pin}>{state.status === 'busy' ? 'A ligar…' : 'Ativar convite'}</button>
        <button type="button" className="button button-quiet" onClick={skip}>Configurar mais tarde</button>
      </div>
    </form>
    <p className="welcome-note welcome-foot">Se as fontes estão noutro computador, precisas de estar na mesma rede privada (por exemplo Tailscale). Quem te convidou explica-te como.</p>
  </div></div>;
}

// Definições: gera o código de convite para partilhar com a família.
export function InviteSettings({ onNotify }) {
  const [include, setInclude] = useState({ tmdb: true, prowlarr: true, shelfarr: true, shelfarrToken: false, spotify: true });
  const [pin, setPin] = useState('');
  const [state, setState] = useState({ code: '', error: '' });
  if (!window.streamnexus?.isDesktop) return null;
  const toggle = (key) => setInclude((current) => ({ ...current, [key]: !current[key] }));
  const generate = async () => {
    try {
      const result = await window.streamnexus.createInvite({ include, pin });
      setState({ code: result.code, error: '' });
    } catch (error) { setState({ code: '', error: errorText(error) }); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(state.code); onNotify?.('Código copiado.'); } catch { onNotify?.('Não consegui copiar; seleciona o código e copia à mão.', 'error'); }
  };
  return <div className="invite-settings">
    <div className="integration-group-title">Partilhar com a família</div>
    <small className="integration-help">Gera um código que leva as ligações guardadas aqui para outra instalação. O código vai cifrado com um PIN: envia o código e o PIN em mensagens separadas. Nunca inclui a tua conta Real-Debrid nem as credenciais do OpenSubtitles — cada pessoa usa as suas.</small>
    <div className="invite-options">
      <label><input type="checkbox" checked={include.tmdb} onChange={() => toggle('tmdb')}/> Catálogo (chave TMDB)</label>
      <label><input type="checkbox" checked={include.prowlarr} onChange={() => toggle('prowlarr')}/> Prowlarr (endereço e API key)</label>
      <label><input type="checkbox" checked={include.shelfarr} onChange={() => toggle('shelfarr')}/> Shelfarr (endereço)</label>
      <label><input type="checkbox" checked={include.spotify} onChange={() => toggle('spotify')}/> Spotify (Client ID e Secret da app)</label>
      <label><input type="checkbox" checked={include.shelfarrToken} onChange={() => toggle('shelfarrToken')}/> Shelfarr (o meu token — os pedidos ficam em meu nome)</label>
    </div>
    <label className="input-label" htmlFor="invite-make-pin">PIN do convite</label>
    <input id="invite-make-pin" className="text-input" type="password" autoComplete="off" placeholder="Pelo menos 4 caracteres" value={pin} onChange={(event) => setPin(event.target.value)}/>
    <button type="button" className="button button-quiet integration-test-button" onClick={generate}>Gerar código de convite</button>
    {state.error && <p className="is-error-text">{state.error}</p>}
    {state.code && <div className="invite-result"><textarea className="text-input welcome-code" readOnly rows={4} value={state.code} onFocus={(event) => event.target.select()}/><button type="button" className="button button-primary button-sm" onClick={copy}>Copiar código</button></div>}
  </div>;
}
