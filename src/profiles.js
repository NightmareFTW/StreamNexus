// Perfis locais (mesma conta Real-Debrid, dados separados por pessoa).
// O perfil "default" usa as chaves antigas sem sufixo, por isso quem já tinha dados não perde nada.
export const DEFAULT_PROFILE_ID = 'default';
const PROFILES_KEY = 'streamnexus.profiles';
export const PROFILE_COLORS = ['#e50914', '#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#eb5757', '#00b8d9', '#f2c94c'];
// Chaves que pertencem a cada perfil (a lista serve para apagar os dados ao remover um perfil)
export const PROFILE_DATA_KEYS = ['streamnexus.watchlist', 'streamnexus.watchlist.items', 'streamnexus.settings.adult', 'streamnexus.adult.orientation', 'streamnexus.tv.country', 'streamnexus.reading', 'streamnexus.watch'];

let activeProfileId = DEFAULT_PROFILE_ID;
export const setActiveProfile = (id) => { activeProfileId = id || DEFAULT_PROFILE_ID; };
export const getActiveProfileId = () => activeProfileId;
export const pkey = (key) => (activeProfileId === DEFAULT_PROFILE_ID ? key : `${key}@${activeProfileId}`);

export function loadProfiles() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); } catch { list = []; }
  list = Array.isArray(list) ? list.filter((profile) => profile?.id && profile?.name) : [];
  if (!list.some((profile) => profile.id === DEFAULT_PROFILE_ID)) list.unshift({ id: DEFAULT_PROFILE_ID, name: 'Principal', color: PROFILE_COLORS[0] });
  return list;
}

export function saveProfiles(list) {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(list)); } catch { /* sem armazenamento */ }
}

export const newProfileId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function deleteProfileData(id) {
  PROFILE_DATA_KEYS.forEach((key) => {
    try { localStorage.removeItem(id === DEFAULT_PROFILE_ID ? key : `${key}@${id}`); } catch { /* ignora */ }
  });
}
