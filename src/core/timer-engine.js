import { touchState } from './state.js';

export function effectivePartElapsed(state, index, now = Date.now()) {
  const base = Math.max(0, Number(state.runtime.elapsedSeconds[index]) || 0);
  const isCurrent = index === state.runtime.current;
  const timer = state.runtime.timer;
  if (!isCurrent || !timer.running || !timer.startedAt) return base;
  return base + Math.max(0, (now - timer.startedAt) / 1000);
}

export function partRemaining(state, index, now = Date.now()) {
  const planned = Math.max(0, Number(state.parts[index]?.min) || 0) * 60;
  return planned - effectivePartElapsed(state, index, now);
}

export function pausePartTimer(state, now = Date.now()) {
  const timer = state.runtime.timer;
  if (!timer.running) return state;
  const index = state.runtime.current;
  const delta = timer.startedAt ? Math.max(0, (now - timer.startedAt) / 1000) : 0;
  state.runtime.elapsedSeconds[index] = Math.max(0, Number(state.runtime.elapsedSeconds[index]) || 0) + delta;
  timer.running = false;
  timer.startedAt = null;
  touchState(state);
  return state;
}

export function startPartTimer(state, now = Date.now()) {
  if (state.runtime.timer.running || !state.parts.length) return state;
  state.runtime.timer.running = true;
  state.runtime.timer.startedAt = now;
  state.status = 'active';
  touchState(state);
  return state;
}

export function togglePartTimer(state, now = Date.now()) {
  return state.runtime.timer.running ? pausePartTimer(state, now) : startPartTimer(state, now);
}

export function switchPart(state, targetIndex, now = Date.now()) {
  pausePartTimer(state, now);
  state.runtime.current = Math.min(Math.max(0, Number(targetIndex) || 0), state.parts.length - 1);
  touchState(state);
  return state;
}

export function resetPartTimer(state, index = state.runtime.current, now = Date.now()) {
  if (index === state.runtime.current) pausePartTimer(state, now);
  state.runtime.elapsedSeconds[index] = 0;
  state.runtime.doneFlags[index] = false;
  state.runtime.alerts[index] = { 60: false, 30: false, 0: false };
  touchState(state);
  return state;
}

export function completeAndAdvance(state, now = Date.now()) {
  const current = state.runtime.current;
  pausePartTimer(state, now);
  state.runtime.doneFlags[current] = true;
  if (current < state.parts.length - 1) state.runtime.current = current + 1;
  touchState(state);
  return state;
}

export function effectiveCounselUsed(state, index, now = Date.now()) {
  const entry = state.runtime.counsel[index];
  if (!entry) return 0;
  const active = entry.running && entry.startedAt ? Math.max(0, (now - entry.startedAt) / 1000) : 0;
  return Math.max(0, Number(entry.usedSeconds) || 0) + active;
}

export function pauseCounsel(state, index, now = Date.now()) {
  const entry = state.runtime.counsel[index];
  if (!entry?.running) return state;
  const delta = entry.startedAt ? Math.max(0, (now - entry.startedAt) / 1000) : 0;
  entry.usedSeconds += delta;
  entry.running = false;
  entry.startedAt = null;
  touchState(state);
  return state;
}

export function pauseAllCounsels(state, exceptIndex = -1, now = Date.now()) {
  state.runtime.counsel.forEach((entry, index) => {
    if (index !== exceptIndex && entry.running) pauseCounsel(state, index, now);
  });
  return state;
}

export function toggleCounsel(state, index, now = Date.now()) {
  const entry = state.runtime.counsel[index];
  if (!entry) return state;
  if (entry.running) return pauseCounsel(state, index, now);
  pauseAllCounsels(state, index, now);
  entry.running = true;
  entry.startedAt = now;
  touchState(state);
  return state;
}

export function resetCounsel(state, index, now = Date.now()) {
  pauseCounsel(state, index, now);
  const entry = state.runtime.counsel[index];
  if (!entry) return state;
  entry.usedSeconds = 0;
  entry.alerted = false;
  touchState(state);
  return state;
}
