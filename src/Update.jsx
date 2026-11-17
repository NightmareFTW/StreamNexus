import { useSyncExternalStore } from 'react';
import { Icon } from './ui.jsx';
import { autoCheckEnabled, setAutoCheck, updateStore, useUpdateState } from './updateStore.js';

const megabytes = (bytes) => `${(Number(bytes || 0) / 1048576).toFixed(0)} MB`;
const percentOf = (progress) => (progress?.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0);

// Faixa no topo quando há uma versão nova
export function UpdateBanner({ onNotify }) {
  const state = useUpdateState();
  if (state.dismissed || !['available', 'downloading', 'verifying', 'installing', 'ready'].includes(state.status) || !state.info) return null;
  const busy = ['downloading', 'verifying', 'installing'].includes(state.status);
  const open = () => window.streamnexus?.openLink?.(state.info.releaseUrl)?.catch((error) => onNotify?.(error?.message, 'error'));
  return <div className="update-banner" role="status">
    <span className="update-banner-icon"><Icon name="download" size={18}/></span>
    <span className="update-banner-text"><strong>Nova versão {state.info.latest} disponível</strong><small>{busy ? (state.status === 'verifying' ? 'A verificar o ficheiro…' : state.status === 'installing' ? 'A instalar… a app vai reiniciar.' : `A transferir ${percentOf(state.progress)}% · ${megabytes(state.progress?.received)} de ${megabytes(state.progress?.total)}`) : state.status === 'ready' ? 'Transferida e verificada.' : `Estás na ${state.info.current}.${state.info.packaged ? '' : ' (versão a partir do código-fonte)'}`}</small>{busy && <span className="update-bar"><i style={{ width: `${percentOf(state.progress)}%` }}></i></span>}</span>
    {!busy && state.info.packaged && state.info.asset && <button className="button button-primary button-sm" onClick={() => updateStore.install()}>Atualizar agora</button>}
    {!busy && !state.info.packaged && <button className="button button-primary button-sm" onClick={open}>Ver versão</button>}
    {!busy && <button className="button button-quiet button-sm" onClick={() => updateStore.dismiss()}>Mais tarde</button>}
  </div>;
}

// Secção "Atualizações" das definições
export function UpdateSettings({ onNotify }) {
  const state = useUpdateState();
  useSyncExternalStore(updateStore.subscribe, autoCheckEnabled);
  const info = state.info;
  const busy = ['checking', 'downloading', 'verifying', 'installing'].includes(state.status);
  const open = () => window.streamnexus?.openLink?.(info.releaseUrl)?.catch((error) => onNotify?.(error?.message, 'error'));
  return <div className="update-settings">
    <div className="integration-group-title">Atualizações</div>
    <div className="update-row">
      <span className="update-status">
        {state.status === 'checking' && <><span className="spinner"></span> A procurar…</>}
        {state.status === 'none' && <><Icon name="check" size={15}/> Tens a versão mais recente{info?.current ? ` (${info.current})` : ''}.</>}
        {state.status === 'available' && <><Icon name="download" size={15}/> Nova versão <b>{info.latest}</b> disponível (tens a {info.current}).</>}
        {['downloading', 'verifying', 'installing'].includes(state.status) && <><span className="spinner"></span> {state.status === 'verifying' ? 'A verificar o ficheiro…' : state.status === 'installing' ? 'A instalar; a app vai reiniciar…' : `A transferir ${percentOf(state.progress)}%`}</>}
        {state.status === 'error' && <span className="is-error-text">{state.message}</span>}
        {(state.status === 'idle' || state.status === 'ready') && <>{info?.current ? `Versão instalada: ${info.current}` : 'Procura novas versões do StreamNexus no GitHub.'}</>}
      </span>
      <span className="update-actions">
        <button type="button" className="button button-quiet button-sm" disabled={busy} onClick={() => updateStore.check()}>Procurar atualizações</button>
        {state.status === 'available' && info.packaged && info.asset && <button type="button" className="button button-primary button-sm" onClick={() => updateStore.install()}>Atualizar agora</button>}
        {state.status === 'available' && !info.packaged && <button type="button" className="button button-primary button-sm" onClick={open}>Abrir a versão</button>}
      </span>
    </div>
    {['downloading', 'verifying'].includes(state.status) && <span className="update-bar"><i style={{ width: `${percentOf(state.progress)}%` }}></i></span>}
    {state.status === 'available' && !info.packaged && <small className="integration-help">Estás a executar a app a partir do código-fonte; a atualização automática só existe na versão instalada. Para atualizar, descarrega o instalador na página da versão.</small>}
    {state.status === 'available' && info.notes && <details className="update-notes"><summary>O que há de novo</summary><pre>{info.notes}</pre></details>}
    <label className="update-auto"><input type="checkbox" checked={autoCheckEnabled()} onChange={(event) => setAutoCheck(event.target.checked)}/><span>Procurar atualizações ao iniciar a app</span></label>
  </div>;
}
