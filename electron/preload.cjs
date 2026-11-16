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
  searchTorrentio: (value) => invokeRequest('torrentio:releases', value),
  testProwlarr: (value) => invokeRequest('prowlarr:test', value),
  addReleaseToRealDebrid: (value) => invokeRequest('prowlarr:add-release', value),
  fetchCatalog: () => invokeRequest('tmdb:catalog'),
  fetchDiscovery: (kind) => invokeRequest('discovery:fetch', { kind }),
  testSpotify: (value) => invokeRequest('spotify:test', value),
  spotifyConnectStatus: () => invokeRequest('spotify:connect-status'),
  spotifyConnectLogin: () => invokeRequest('spotify:connect-login'),
  spotifyConnectLogout: () => invokeRequest('spotify:connect-logout'),
  spotifyConnectState: () => invokeRequest('spotify:connect-state'),
  spotifyConnectCommand: (value) => invokeRequest('spotify:connect-command', value),
  spotifyAlbumTracks: (value) => invokeRequest('spotify:album-tracks', value),
  fetchLiveCountries: () => invokeRequest('tv:countries'),
  fetchLiveChannels: (country) => invokeRequest('tv:channels', { country }),
  fetchAdultVideos: (term, orientation) => invokeRequest('adult:videos', { term, orientation }),
  fetchChannelLogo: (value) => invokeRequest('tv:logo', value),
  fetchFreeMusic: (value) => invokeRequest('music:free', value),
  fetchLiveHealth: (country) => invokeRequest('tv:health', { country }),
  fetchBookSources: (value) => invokeRequest('books:sources', value),
  openLink: (url) => invokeRequest('app:open-link', { url }),
  prepareLiveHls: (url) => invokeRequest('player:prepare-hls', { url }),
  feedShelf: (value) => invokeRequest('feed:shelf', value),
  feedSearch: (value) => invokeRequest('feed:search', value),
  feedShelves: (value) => invokeRequest('feed:shelves', value),
  feedCategory: (value) => invokeRequest('feed:category', value),
  fetchTrailer: (value) => invokeRequest('tmdb:trailer', value),
  openExternalPlayer: (url) => invokeRequest('player:external', url),
  prepareAudioStream: (url, options = {}) => invokeRequest('player:prepare-audio', { url, transcodeVideo: Boolean(options.transcodeVideo), live: Boolean(options.live), forcePipe: Boolean(options.forcePipe), startAt: Number(options.startAt) || 0, quality: String(options.quality || ''), audioIndex: Number.isInteger(options.audioIndex) ? options.audioIndex : -1 }),
  getStreamInfo: (id) => ipcRenderer.invoke('player:stream-info', id),
  stopAudioStream: (id) => ipcRenderer.invoke('player:stop-audio', id),
  setFullscreen: (enabled) => ipcRenderer.invoke('window:fullscreen', Boolean(enabled)),
  testTmdb: (value) => invokeRequest('tmdb:test', value),
  testOpenSubtitles: (value) => invokeRequest('opensubtitles:test', value),
  searchSubtitles: (value) => invokeRequest('opensubtitles:search', value),
  downloadSubtitle: (value) => invokeRequest('opensubtitles:download', value),
}));
