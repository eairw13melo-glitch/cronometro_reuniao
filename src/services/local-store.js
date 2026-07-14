import { HISTORY_KEY, STORAGE_KEY } from '../core/constants.js';
import { cloneState, normalizeState } from '../core/state.js';

export function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : null;
  } catch (error) {
    console.warn('Não foi possível restaurar o estado local.', error);
    return null;
  }
}

export function saveLocalState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.warn('Não foi possível salvar o estado local.', error);
    return false;
  }
}

export function archiveLocalState(state) {
  try {
    const history = loadLocalHistory();
    const snapshot = cloneState(state);
    snapshot.archivedAt = new Date().toISOString();
    history.unshift(snapshot);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 30)));
    return true;
  } catch (error) {
    console.warn('Não foi possível arquivar a reunião localmente.', error);
    return false;
  }
}

export function loadLocalHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeState) : [];
  } catch (error) {
    console.warn('Não foi possível carregar o histórico local.', error);
    return [];
  }
}

export function clearLocalState() {
  localStorage.removeItem(STORAGE_KEY);
}
