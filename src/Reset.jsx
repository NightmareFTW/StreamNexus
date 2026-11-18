import { useState } from 'react';
import { Icon } from './ui.jsx';

const CONFIRM_WORD = 'REPOR';

// Definições: secção "Zona de perigo" com o botão que abre o diálogo de confirmação.
export function ResetSettings({ onOpen }) {
  if (!window.streamnexus?.isDesktop) return null;
  return <div className="reset-settings">
    <div className="integration-group-title">Zona de perigo</div>
    <div className="adult-setting reset-row"><span><strong>Repor esta instalação</strong><small>Apaga as contas, chaves, perfis e histórico guardados neste PC e volta ao estado de instalação nova. Não afeta mais nenhum computador.</small></span>
      <button type="button" className="button button-danger" onClick={onOpen}>Repor…</button></div>
  </div>;
}

// Diálogo de confirmação: obriga a escrever uma palavra e deixa manter perfis e histórico.
export function ResetDialog({ onClose }) {
  const [keepProfiles, setKeepProfiles] = useState(false);
  const [typed, setTyped] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });
  const ready = typed.trim().toUpperCase() === CONFIRM_WORD;
  const run = async () => {
    setState({ status: 'busy', message: '' });
    try {
      const result = await window.streamnexus.resetInstallation({ keepProfiles });
      setState({ status: 'done', message: result?.relaunching ? 'A repor… a app vai reiniciar sozinha.' : 'Reposto. Fecha esta janela e volta a abrir a app.' });
    } catch (error) {
      setState({ status: 'error', message: String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
    }
  };
  return <div className="modal-backdrop reset-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" onMouseDown={(event) => { if (event.target === event.currentTarget && state.status !== 'busy' && state.status !== 'done') onClose(); }}>
    <div className="modal-card reset-dialog">
      <span className="modal-emblem reset-emblem"><Icon name="alert" size={24}/></span>
      <span className="eyebrow">ZONA DE PERIGO</span>
      <h2 id="reset-title">Repor esta instalação?</h2>
      {state.status === 'done' ? <p className="connect-lead">{state.message}</p> : <>
        <p className="connect-lead">Isto só afeta <strong>este PC</strong>. Não pode ser desfeito.</p>
        <div className="reset-lists">
          <div><strong>Vai ser apagado</strong><ul>
            <li>As ligações às contas (Real-Debrid, Spotify) e todas as chaves</li>
            {!keepProfiles && <li>Os perfis, avatares, histórico, listas e estantes</li>}
            {!keepProfiles && <li>Todas as preferências</li>}
          </ul></div>
          <div><strong>Não é apagado</strong><ul>
            <li>As tuas contas nos serviços (Real-Debrid, Spotify…)</li>
            <li>Os dados dos outros computadores</li>
            {keepProfiles && <li>Os perfis, histórico, listas e estantes</li>}
          </ul></div>
        </div>
        <label className="reset-keep"><input type="checkbox" checked={keepProfiles} onChange={(event) => setKeepProfiles(event.target.checked)} disabled={state.status === 'busy'}/> Manter perfis e histórico (apaga só contas e chaves)</label>
        <p className="reset-tip">Para impedir que a app volte a usar as tuas contas, remove também a autorização da app no site do Real-Debrid e do Spotify.</p>
        <label className="input-label" htmlFor="reset-confirm">Escreve <strong>{CONFIRM_WORD}</strong> para confirmar</label>
        <input id="reset-confirm" className="text-input" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} disabled={state.status === 'busy'}/>
        {state.status === 'error' && <p className="is-error-text">{state.message}</p>}
        <div className="reset-actions">
          <button className="button button-quiet" onClick={onClose} disabled={state.status === 'busy'}>Cancelar</button>
          <button className="button button-danger" onClick={run} disabled={!ready || state.status === 'busy'}>{state.status === 'busy' ? 'A repor…' : 'Repor esta instalação'}</button>
        </div>
      </>}
    </div>
  </div>;
}
