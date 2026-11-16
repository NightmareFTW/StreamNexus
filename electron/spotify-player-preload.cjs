// Ponte mínima entre a janela oculta do Spotify (SDK Web Playback) e o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spotifyBridge', {
  getToken: () => ipcRenderer.invoke('spotify-player:token'),
  report: (payload) => ipcRenderer.send('spotify-player:event', payload),
  onCommand: (handler) => ipcRenderer.on('spotify-player:command', (_event, command) => handler(command)),
});
