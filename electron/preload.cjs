const { contextBridge, ipcRenderer } = require('electron');

async function invokeRequest(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result?.ok) {
    const error = new Error(result?.message || 'O pedido não foi concluído.');
    error.status = result?.status || 0;
    throw error;
  }
  return result.data;
}

contextBridge.exposeInMainWorld('streamnexus', Object.freeze({
  isDesktop: true,
  rdRequest: (request) => invokeRequest('rd:request', request),
  oauthRequest: (request) => invokeRequest('rd:oauth', request),
  openAuthWindow: (url) => ipcRenderer.invoke('oauth:open-window', url),
  loadSession: () => ipcRenderer.invoke('session:read'),
  saveSession: (value) => ipcRenderer.invoke('session:write', value),
  loadIntegrations: () => ipcRenderer.invoke('integrations:read'),
  saveIntegrations: (value) => ipcRenderer.invoke('integrations:write', value),
  searchReleases: (value) => invokeRequest('prowlarr:search', value),
  testProwlarr: (value) => invokeRequest('prowlarr:test', value),
  addReleaseToRealDebrid: (value) => invokeRequest('prowlarr:add-release', value),
}));
