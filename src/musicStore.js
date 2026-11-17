// Estado e controlos do leitor de música, partilhados entre o mini leitor flutuante e o widget do Início.
// O mini leitor continua a ser o único dono do áudio; o widget só lê o estado e chama estes controlos.
import { useSyncExternalStore } from 'react';

const IDLE = { active: false };
let state = IDLE;
let controls = {};
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export const musicStore = {
  get: () => state,
  subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  set(patch) { state = { ...state, ...patch, active: true }; emit(); },
  setControls(next) { controls = next; },
  reset() { state = IDLE; controls = {}; emit(); },
};

export const useMusicState = () => useSyncExternalStore(musicStore.subscribe, musicStore.get);
export const musicControls = () => controls;
