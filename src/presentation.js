import './styles.css';
import { CHANNEL_NAME, SECTION_LABELS } from './core/constants.js';
import { formatCountdown } from './core/format.js';
import { normalizeState } from './core/state.js';
import { partRemaining } from './core/timer-engine.js';
import { findSharedMeeting, subscribeSharedState } from './services/cloud-sync.js';
import { loadLocalState } from './services/local-store.js';
import { supabaseConfigured } from './services/supabase-client.js';
import { releaseWakeLock, requestWakeLock, wakeLockActive } from './services/wake-lock.js';

const $ = (id) => document.getElementById(id);
let state = loadLocalState();
let unsubscribe = () => {};
let source = state ? 'dispositivo' : 'aguardando';
let wakeDesired = false;

function applyState(nextState, nextSource = source) {
  if (!nextState) return;
  state = normalizeState(nextState);
  source = nextSource;
  render();
}

function render() {
  if (!state?.parts?.length) {
    $('presentationStatus').textContent = 'Aguardando dados do cronômetro principal…';
    return;
  }

  const index = state.runtime.current;
  const part = state.parts[index];
  const remaining = partRemaining(state, index);
  $('presentationWeek').textContent = state.weekLabel;
  $('presentationSection').textContent = SECTION_LABELS[part.section] || '';
  $('presentationName').textContent = part.name;
  $('presentationSpeaker').textContent = part.speaker ? `🗣️ ${part.speaker}` : '';
  $('presentationTime').textContent = formatCountdown(remaining);
  const next = state.parts[index + 1];
  $('presentationNext').textContent = next ? `Próxima: ${next.name}${next.speaker ? ` — ${next.speaker}` : ''}` : 'Última parte da programação';
  $('presentationShell').classList.toggle('warning', remaining > 0 && remaining <= 60);
  $('presentationShell').classList.toggle('overtime', remaining <= 0);
  $('presentationStatus').textContent = `Fonte: ${source} · atualização ${new Date(state.updatedAt).toLocaleTimeString('pt-BR')}`;
}

async function connectSharedMeeting() {
  const code = new URLSearchParams(window.location.search).get('code');
  if (!code) return false;
  if (!supabaseConfigured) {
    $('presentationStatus').textContent = 'O código online exige a configuração do Supabase.';
    return false;
  }
  try {
    $('presentationStatus').textContent = 'Conectando à reunião online…';
    const result = await findSharedMeeting(code);
    applyState(result.state, `nuvem · código ${code.toUpperCase()}`);
    unsubscribe();
    unsubscribe = subscribeSharedState(code, (snapshot) => applyState(snapshot, `nuvem · código ${code.toUpperCase()}`));
    return true;
  } catch (error) {
    console.error(error);
    $('presentationStatus').textContent = 'Código inválido, reunião não compartilhada ou conexão indisponível.';
    return false;
  }
}

function bindLocalSync() {
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', (event) => {
      if (event.data?.type === 'state') applyState(event.data.state, 'cronômetro local');
    });
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== `${CHANNEL_NAME}-pulse` || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue);
      if (payload.state) applyState(payload.state, 'cronômetro local');
    } catch {
      // Ignora pulsos incompletos.
    }
  });
}

$('fullscreenBtn').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    console.warn(error);
  }
});

$('wakeBtn').addEventListener('click', async () => {
  wakeDesired = !wakeDesired;
  if (wakeDesired) await requestWakeLock();
  else await releaseWakeLock();
  $('wakeBtn').textContent = wakeLockActive() ? 'Tela ligada ✓' : 'Manter tela ligada';
});

document.addEventListener('visibilitychange', async () => {
  if (wakeDesired && document.visibilityState === 'visible') {
    await requestWakeLock();
    $('wakeBtn').textContent = wakeLockActive() ? 'Tela ligada ✓' : 'Manter tela ligada';
  }
});

window.addEventListener('beforeunload', unsubscribe);

bindLocalSync();
connectSharedMeeting();
render();
setInterval(render, 250);
