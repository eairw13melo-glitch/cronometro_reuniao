import { COUNSEL_SECONDS, STATE_VERSION } from './constants.js';
import { createDefaultParts, createPart } from './default-program.js';

function createId(prefix = 'meeting') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createShareCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  const values = new Uint32Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values);
  for (let index = 0; index < 8; index += 1) {
    const random = values[index] || Math.floor(Math.random() * alphabet.length);
    result += alphabet[random % alphabet.length];
  }
  return result;
}

export function createRuntimeForParts(parts) {
  return {
    current: 0,
    doneFlags: parts.map(() => false),
    elapsedSeconds: parts.map(() => 0),
    commentCounts: parts.map(() => 0),
    alerts: parts.map(() => ({ 60: false, 30: false, 0: false })),
    timer: { running: false, startedAt: null },
    counsel: parts.map(() => ({ usedSeconds: 0, running: false, startedAt: null, alerted: false })),
  };
}

export function createDefaultState() {
  const parts = createDefaultParts();
  return {
    version: STATE_VERSION,
    localId: createId(),
    meetingId: null,
    shareCode: createShareCode(),
    shareEnabled: false,
    status: 'draft',
    weekLabel: '13–19 de julho · Jeremias 16-17',
    settings: {
      startTime: '19:30',
      allowedMinutes: 105,
      meetingStartIso: null,
      meetingStartAlerted: false,
      soundEnabled: true,
      vibrationEnabled: true,
      autoWakeLock: true,
    },
    parts,
    runtime: createRuntimeForParts(parts),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizePart(part, index) {
  return createPart(
    ['neutro', 'tesouros', 'ministerio', 'vida'].includes(part?.section) ? part.section : 'neutro',
    String(part?.name || `Parte ${index + 1}`),
    Math.max(0, Number(part?.min) || 0),
    {
      id: part?.id || undefined,
      speaker: String(part?.speaker || ''),
      details: String(part?.details || ''),
      link: String(part?.link || ''),
      countComments: Boolean(part?.countComments),
      hasCounsel: Boolean(part?.hasCounsel),
    },
  );
}

function alignArray(source, length, fallbackFactory) {
  return Array.from({ length }, (_, index) => {
    const value = source?.[index];
    return value === undefined ? fallbackFactory(index) : value;
  });
}

export function normalizeState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== 'object') return base;

  const parts = Array.isArray(raw.parts) && raw.parts.length
    ? raw.parts.map(normalizePart)
    : base.parts;
  const runtime = raw.runtime || {};
  const current = Math.min(Math.max(0, Number(runtime.current) || 0), parts.length - 1);

  return {
    ...base,
    ...raw,
    version: STATE_VERSION,
    localId: raw.localId || base.localId,
    shareCode: raw.shareCode || base.shareCode,
    weekLabel: String(raw.weekLabel || base.weekLabel),
    settings: {
      ...base.settings,
      ...(raw.settings || {}),
      allowedMinutes: Math.max(1, Number(raw.settings?.allowedMinutes) || base.settings.allowedMinutes),
    },
    parts,
    runtime: {
      current,
      doneFlags: alignArray(runtime.doneFlags, parts.length, () => false).map(Boolean),
      elapsedSeconds: alignArray(runtime.elapsedSeconds, parts.length, () => 0).map((value) => Math.max(0, Number(value) || 0)),
      commentCounts: alignArray(runtime.commentCounts, parts.length, () => 0).map((value) => Math.max(0, Number(value) || 0)),
      alerts: alignArray(runtime.alerts, parts.length, () => ({ 60: false, 30: false, 0: false })).map((value) => ({
        60: Boolean(value?.[60] ?? value?.['60']),
        30: Boolean(value?.[30] ?? value?.['30']),
        0: Boolean(value?.[0] ?? value?.['0']),
      })),
      timer: {
        running: Boolean(runtime.timer?.running),
        startedAt: Number(runtime.timer?.startedAt) || null,
      },
      counsel: alignArray(runtime.counsel, parts.length, () => ({ usedSeconds: 0, running: false, startedAt: null, alerted: false })).map((entry) => ({
        usedSeconds: Math.max(0, Number(entry?.usedSeconds) || 0),
        running: Boolean(entry?.running),
        startedAt: Number(entry?.startedAt) || null,
        alerted: Boolean(entry?.alerted),
      })),
    },
    createdAt: raw.createdAt || base.createdAt,
    updatedAt: raw.updatedAt || base.updatedAt,
  };
}

export function replaceParts(state, newParts) {
  if (!Array.isArray(newParts) || newParts.length === 0) {
    throw new Error('A programação precisa ter pelo menos uma parte.');
  }
  state.parts = newParts.map(normalizePart);
  state.runtime = createRuntimeForParts(state.parts);
  touchState(state);
  return state;
}

export function resetRuntime(state) {
  state.runtime = createRuntimeForParts(state.parts);
  state.status = 'draft';
  state.settings.meetingStartAlerted = false;
  touchState(state);
  return state;
}

export function touchState(state) {
  state.updatedAt = new Date().toISOString();
  return state;
}

export function cloneState(state) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(state)
    : JSON.parse(JSON.stringify(state));
}

export function counselRemaining(state, index, now = Date.now()) {
  const entry = state.runtime.counsel[index];
  if (!entry) return COUNSEL_SECONDS;
  const active = entry.running && entry.startedAt ? Math.max(0, (now - entry.startedAt) / 1000) : 0;
  return COUNSEL_SECONDS - entry.usedSeconds - active;
}
