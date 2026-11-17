// Estado partilhado das atualizações (faixa no topo e definições usam o mesmo).
import { useSyncExternalStore } from 'react';

const AUTO_KEY = 'streamnexus.autoUpdate';
export const autoCheckEnabled = () => { try { return localStorage.getItem(AUTO_KEY) !== 'false'; } catch { return true; } };
export const setAutoCheck = (value) => { try { localStorage.setItem(AUTO_KEY, value ? 'true' : 'false'); } catch { /* só nesta sessão */ } emit(); };

let state = { status: 'idle', info: null, progress: null, message: '', dismissed: false };
const listeners = new Set();
function emit() { listeners.forEach((listener) => listener()); }
function set(patch) { state = { ...state, ...patch }; emit(); }

let offProgress = null;
export const updateStore = {
  get: () => state,
  subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  dismiss() { set({ dismissed: true }); },
  async check({ silent = false } = {}) {
    if (!window.streamnexus?.checkForUpdate || ['checking', 'downloading', 'installing'].includes(state.status)) return state;
    set({ status: 'checking', message: '' });
    try {
      const info = await window.streamnexus.checkForUpdate();
      set({ status: info.available ? 'available' : 'none', info, dismissed: false, message: '' });
    } catch (error) {
      set({ status: silent ? 'idle' : 'error', message: error?.message || 'Não foi possível procurar atualizações.' });
    }
    return state;
  },
  async install() {
    if (!window.streamnexus?.installUpdate || !state.info?.available) return;
    set({ status: 'downloading', progress: { received: 0, total: state.info.asset?.size || 0 }, message: '' });
    offProgress?.();
    offProgress = window.streamnexus.onUpdateProgress((progress) => set({ status: progress.phase === 'verify' ? 'verifying' : progress.phase === 'install' ? 'installing' : 'downloading', progress }));
    try {
      const result = await window.streamnexus.installUpdate();
      set({ status: result?.ready ? 'ready' : 'installing' });
    } catch (error) {
      set({ status: 'error', message: error?.message || 'A atualização falhou.' });
    } finally { offProgress?.(); offProgress = null; }
  },
};

let started = false;
// Procura atualizações uma vez por arranque da app (se o utilizador não desligou)
export function startAutoCheck() {
  if (started) return;
  started = true;
  if (autoCheckEnabled()) window.setTimeout(() => updateStore.check({ silent: true }), 4000);
}

export const useUpdateState = () => useSyncExternalStore(updateStore.subscribe, updateStore.get);
