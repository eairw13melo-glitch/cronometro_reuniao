import './styles.css';
import { ALERT_THRESHOLDS, COUNSEL_SECONDS, CHANNEL_NAME, SECTION_LABELS } from './core/constants.js';
import { createPart } from './core/default-program.js';
import { dateSlug, formatClock, formatCountdown, formatDuration, formatHoursMinutes } from './core/format.js';
import { parseProgramText } from './core/parser.js';
import {
  cloneState,
  counselRemaining,
  createDefaultState,
  createRuntimeForParts,
  normalizeState,
  resetRuntime,
  touchState,
} from './core/state.js';
import {
  completeAndAdvance,
  effectiveCounselUsed,
  effectivePartElapsed,
  partRemaining,
  pauseAllCounsels,
  pausePartTimer,
  resetCounsel,
  resetPartTimer,
  startPartTimer,
  switchPart,
  toggleCounsel,
  togglePartTimer,
} from './core/timer-engine.js';
import { playAlert, vibrateAlert } from './services/audio.js';
import {
  broadcastSharedState,
  listOnlineMeetings,
  loadOnlineMeeting,
  markMeetingCompleted,
  saveMeetingOnline,
} from './services/cloud-sync.js';
import { exportCsv, exportJson, generatePdf } from './services/export.js';
import { archiveLocalState, loadLocalHistory, loadLocalState, saveLocalState } from './services/local-store.js';
import { installApp, onInstallAvailability, registerServiceWorker } from './services/pwa.js';
import {
  currentUser,
  signInWithEmail,
  signOut,
  supabase,
  supabaseConfigured,
} from './services/supabase-client.js';
import { releaseWakeLock, requestWakeLock, wakeLockActive } from './services/wake-lock.js';

const $ = (id) => document.getElementById(id);
const nowMs = () => Date.now();

let state = loadLocalState() || createDefaultState();
let user = null;
let editorDraft = null;
let floatOpen = false;
let saveTimer = null;
let cloudTimer = null;
let toastTimer = null;
let lastBroadcastSecond = -1;
let lastStatus = '';
let cloudState = 'local';
let modalReturnFocus = null;

const broadcastChannel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

function safeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}

function setCloudState(nextState) {
  cloudState = nextState;
  renderSaveStatus();
}

function renderSaveStatus() {
  const parts = ['Salvo neste dispositivo'];
  if (!navigator.onLine) parts.push('offline');
  else if (cloudState === 'saving') parts.push('sincronizando…');
  else if (cloudState === 'synced') parts.push('sincronizado online');
  else if (cloudState === 'error') parts.push('falha na nuvem');
  else if (supabaseConfigured && !user) parts.push('sem login');
  if (wakeLockActive()) parts.push('tela ligada');
  const text = parts.join(' · ');
  if (text !== lastStatus) {
    $('saveStatus').textContent = text;
    lastStatus = text;
  }
}

function postLiveState() {
  const snapshot = cloneState(state);
  broadcastChannel?.postMessage({ type: 'state', state: snapshot });
  if (user && supabaseConfigured && snapshot.shareEnabled) {
    broadcastSharedState(snapshot).catch((error) => console.warn('Broadcast online indisponível.', error));
  }
  try {
    localStorage.setItem(`${CHANNEL_NAME}-pulse`, JSON.stringify({ at: Date.now(), state: snapshot }));
  } catch {
    // O salvamento principal já trata eventuais falhas de armazenamento.
  }
}

function scheduleSave({ cloud = true, broadcast = true } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveLocalState(state);
    if (broadcast) postLiveState();
    renderSaveStatus();
  }, 100);

  if (cloud && user && supabaseConfigured) {
    clearTimeout(cloudTimer);
    setCloudState('saving');
    cloudTimer = setTimeout(async () => {
      try {
        const result = await saveMeetingOnline(state, user);
        if (result.meetingId && !state.meetingId) state.meetingId = result.meetingId;
        saveLocalState(state);
        setCloudState('synced');
      } catch (error) {
        console.error(error);
        setCloudState('error');
      }
    }, 1200);
  }
}

function stateChanged({ fullRender = true, cloud = true } = {}) {
  touchState(state);
  scheduleSave({ cloud });
  if (fullRender) renderAll();
}

function getCurrentPart() {
  return state.parts[state.runtime.current] || null;
}

function getMeetingStart() {
  const value = state.settings.meetingStartIso;
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function setMeetingStartFromInput() {
  const time = $('startTimeInput').value;
  state.settings.startTime = time;
  if (!time) {
    state.settings.meetingStartIso = null;
  } else {
    const [hours, minutes] = time.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    state.settings.meetingStartIso = date.toISOString();
  }
  state.settings.meetingStartAlerted = false;
  stateChanged({ fullRender: false });
  renderMeetingClock();
}

function totalMinutes() {
  return state.parts.reduce((sum, part) => sum + Math.max(0, Number(part.min) || 0), 0);
}

function renderTotals() {
  const total = totalMinutes();
  const hours = Math.floor(total / 60);
  const minutes = Math.round(total % 60);
  $('totalTime').textContent = hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}min` : `${minutes} min`;
}

function renderStrip() {
  const strip = $('strip');
  strip.replaceChildren();
  state.parts.forEach((part, index) => {
    const segment = document.createElement('button');
    segment.type = 'button';
    segment.className = `seg seg-${part.section}${index === state.runtime.current ? ' active' : ''}${state.runtime.doneFlags[index] ? ' done' : ''}`;
    segment.style.flex = part.min > 0 ? String(part.min) : '0.3';
    segment.title = `${part.name} (${part.min} min)`;
    segment.setAttribute('aria-label', segment.title);
    segment.addEventListener('click', () => jumpTo(index));
    strip.appendChild(segment);
  });
}

function appendText(parent, className, text, tag = 'span') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function renderList() {
  const list = $('plist');
  list.replaceChildren();
  let lastSection = null;
  const now = nowMs();

  state.parts.forEach((part, index) => {
    if (['tesouros', 'ministerio', 'vida'].includes(part.section) && part.section !== lastSection) {
      const header = document.createElement('li');
      header.className = `sec-header sec-header-${part.section}`;
      header.textContent = SECTION_LABELS[part.section];
      list.appendChild(header);
    }
    lastSection = part.section;

    const item = document.createElement('li');
    item.className = `li-item li-${part.section}${index === state.runtime.current ? ' li-active' : ''}${state.runtime.doneFlags[index] ? ' li-done' : ''}`;
    item.addEventListener('click', (event) => {
      if (!['INPUT', 'BUTTON', 'A', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) jumpTo(index);
    });

    const left = document.createElement('div');
    left.className = 'li-left';
    appendText(left, 'li-check', state.runtime.doneFlags[index] ? '✓' : '');
    const main = document.createElement('div');
    main.className = 'li-main';
    const name = document.createElement('span');
    name.className = 'li-name';
    name.append(document.createTextNode(part.name));
    if (part.countComments) {
      name.append(document.createTextNode(' '));
      appendText(name, 'li-comment-badge', `💬 ${state.runtime.commentCounts[index] || 0}`);
    }
    main.appendChild(name);

    if (part.details) {
      const details = appendText(main, 'li-details', part.details, 'div');
      const reference = safeUrl(part.link);
      if (reference) {
        const link = document.createElement('a');
        link.href = reference;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = '🔗 referência';
        link.addEventListener('click', (event) => event.stopPropagation());
        details.append(' ', link);
      }
    }
    left.appendChild(main);
    item.appendChild(left);

    const trigger = document.createElement('div');
    trigger.className = 'li-trigger';
    const remaining = partRemaining(state, index, now);
    const countdown = appendText(trigger, `li-countdown${remaining <= 0 ? ' zero overtime' : ''}`, formatCountdown(remaining));
    countdown.id = `cd-${index}`;
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'li-playbtn';
    play.id = `pb-${index}`;
    const activePlaying = index === state.runtime.current && state.runtime.timer.running;
    play.textContent = activePlaying ? '⏸' : '▶';
    play.title = activePlaying ? 'Pausar' : 'Iniciar contagem';
    play.addEventListener('click', (event) => {
      event.stopPropagation();
      if (state.runtime.current !== index) switchPart(state, index);
      toggleMainTimer();
    });
    trigger.appendChild(play);
    item.appendChild(trigger);

    const speaker = document.createElement('div');
    speaker.className = 'li-speaker';
    appendText(speaker, '', '🗣️ Orador');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Nome de quem vai apresentar';
    input.value = part.speaker;
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('input', () => {
      part.speaker = input.value;
      touchState(state);
      scheduleSave();
      renderStage();
    });
    speaker.appendChild(input);
    item.appendChild(speaker);

    if (part.hasCounsel) {
      const counselBox = document.createElement('div');
      counselBox.className = 'li-counsel';
      appendText(counselBox, '', '⏱ Conselho (máx. 1:30)');
      const remainingCounsel = counselRemaining(state, index, now);
      const counselTime = appendText(counselBox, `lc-time${remainingCounsel <= 0 ? ' zero overtime' : ''}`, formatCountdown(remainingCounsel));
      counselTime.id = `counsel-time-${index}`;
      const counselPlay = document.createElement('button');
      counselPlay.type = 'button';
      counselPlay.className = 'lc-btn';
      counselPlay.textContent = state.runtime.counsel[index]?.running ? '⏸' : '▶';
      counselPlay.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleCounsel(state, index);
        stateChanged();
        updateWakeLock();
      });
      const counselReset = document.createElement('button');
      counselReset.type = 'button';
      counselReset.className = 'lc-btn lc-reset';
      counselReset.textContent = '↺';
      counselReset.addEventListener('click', (event) => {
        event.stopPropagation();
        resetCounsel(state, index);
        stateChanged();
        updateWakeLock();
      });
      counselBox.append(counselPlay, counselReset);
      item.appendChild(counselBox);
    }

    list.appendChild(item);
  });
}

function renderStage() {
  const part = getCurrentPart();
  if (!part) {
    $('sectionTag').textContent = '—';
    $('partName').textContent = 'Nenhuma parte cadastrada';
    $('partMeta').textContent = '';
    $('partSpeaker').textContent = '';
    $('ringTime').textContent = '00:00';
    $('playBtn').disabled = true;
    return;
  }

  const remaining = partRemaining(state, state.runtime.current);
  $('sectionTag').textContent = SECTION_LABELS[part.section];
  $('sectionTag').className = `section-tag tag-${part.section}`;
  $('partName').textContent = part.name;
  $('partMeta').textContent = `Parte ${state.runtime.current + 1} de ${state.parts.length} · duração prevista: ${part.min} min${part.details ? ` · ${part.details}` : ''}`;
  $('partSpeaker').textContent = part.speaker ? `🗣️ ${part.speaker}` : '';
  $('ringTime').textContent = formatCountdown(remaining);
  $('ringTime').classList.toggle('overtime', remaining < 0);

  const total = part.min * 60 || 1;
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, Math.max(0, remaining / total));
  $('ringFg').style.strokeDasharray = String(circumference);
  $('ringFg').style.strokeDashoffset = String(circumference * (1 - fraction));
  $('playBtn').disabled = false;
  $('playBtn').textContent = state.runtime.timer.running ? '⏸ Pausar' : '▶ Iniciar';
  $('prevBtn').disabled = state.runtime.current === 0;
  $('nextBtn').disabled = state.runtime.current === state.parts.length - 1;
  const partStarted = state.runtime.timer.running || effectivePartElapsed(state, state.runtime.current) > 0;
  $('stage').classList.toggle('warning', partStarted && remaining > 0 && remaining <= 60);
  $('stage').classList.toggle('overtime', partStarted && remaining <= 0);
  syncFloatModal();
}

function renderComments() {
  const wrapper = $('commentsWrap');
  wrapper.replaceChildren();
  state.parts.forEach((part, index) => {
    if (!part.countComments) return;
    const active = index === state.runtime.current && state.runtime.timer.running;
    const card = document.createElement('div');
    card.className = `comments-card${active ? '' : ' inactive'}`;
    const title = document.createElement('div');
    title.className = 'cc-title';
    appendText(title, 'lbl', 'Contador de comentários', 'div');
    appendText(title, 'name', part.name, 'div');
    if (!active) appendText(title, 'cc-hint', 'Inicie o cronômetro desta parte para habilitar', 'div');
    card.appendChild(title);
    appendText(card, 'cc-count', String(state.runtime.commentCounts[index] || 0), 'div');
    const buttons = document.createElement('div');
    buttons.className = 'cc-btns';
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'cc-add'; add.textContent = '+1 Comentário'; add.disabled = !active;
    add.addEventListener('click', () => {
      state.runtime.commentCounts[index] = (state.runtime.commentCounts[index] || 0) + 1;
      stateChanged();
    });
    const reset = document.createElement('button');
    reset.type = 'button'; reset.textContent = '↺ Reiniciar'; reset.disabled = !active;
    reset.addEventListener('click', () => {
      state.runtime.commentCounts[index] = 0;
      stateChanged();
    });
    buttons.append(add, reset);
    card.appendChild(buttons);
    wrapper.appendChild(card);
  });
}

function renderAll() {
  $('weekLabel').value = state.weekLabel;
  $('startTimeInput').value = state.settings.startTime || '';
  $('durH').value = String(Math.floor(state.settings.allowedMinutes / 60));
  $('durM').value = String(state.settings.allowedMinutes % 60);
  renderTotals();
  renderStrip();
  renderList();
  renderStage();
  renderComments();
  renderMeetingClock();
  renderSaveStatus();
}

function renderDynamic() {
  const now = nowMs();
  const current = state.runtime.current;
  const remaining = partRemaining(state, current, now);
  const stageTime = $('ringTime');
  if (stageTime) {
    stageTime.textContent = formatCountdown(remaining);
    stageTime.classList.toggle('overtime', remaining < 0);
  }
  const listTime = $(`cd-${current}`);
  if (listTime) {
    listTime.textContent = formatCountdown(remaining);
    listTime.classList.toggle('zero', remaining <= 0);
    listTime.classList.toggle('overtime', remaining <= 0);
  }
  const part = getCurrentPart();
  if (part) {
    const total = part.min * 60 || 1;
    const circumference = 2 * Math.PI * 80;
    const fraction = Math.min(1, Math.max(0, remaining / total));
    $('ringFg').style.strokeDashoffset = String(circumference * (1 - fraction));
  }
  const partStarted = state.runtime.timer.running || effectivePartElapsed(state, state.runtime.current) > 0;
  $('stage').classList.toggle('warning', partStarted && remaining > 0 && remaining <= 60);
  $('stage').classList.toggle('overtime', partStarted && remaining <= 0);

  state.parts.forEach((candidate, index) => {
    if (!candidate.hasCounsel) return;
    const counselTime = $(`counsel-time-${index}`);
    if (counselTime) {
      const value = counselRemaining(state, index, now);
      counselTime.textContent = formatCountdown(value);
      counselTime.classList.toggle('zero', value <= 0);
      counselTime.classList.toggle('overtime', value <= 0);
    }
  });

  checkAlerts(now);
  syncFloatModal(now);
  renderMeetingClock(now);

  const second = Math.floor(now / 1000);
  if (second !== lastBroadcastSecond && (state.runtime.timer.running || state.runtime.counsel.some((entry) => entry.running))) {
    lastBroadcastSecond = second;
    postLiveState();
  }
}

function checkAlerts(now) {
  const index = state.runtime.current;
  const remaining = partRemaining(state, index, now);
  const alerts = state.runtime.alerts[index];
  if (!alerts) return;
  let changed = false;
  if (state.runtime.timer.running) {
    const crossed = ALERT_THRESHOLDS.filter((threshold) => remaining <= threshold && !alerts[threshold]);
    if (crossed.length) {
      crossed.forEach((threshold) => { alerts[threshold] = true; });
      changed = true;
      const mostSevere = Math.min(...crossed);
      const pattern = mostSevere === 0 ? 'end' : 'warning';
      playAlert(pattern, state.settings.soundEnabled);
      vibrateAlert(pattern, state.settings.vibrationEnabled);
    }
  }

  state.runtime.counsel.forEach((entry, counselIndex) => {
    if (!entry.running || entry.alerted) return;
    if (COUNSEL_SECONDS - effectiveCounselUsed(state, counselIndex, now) <= 0) {
      entry.alerted = true;
      changed = true;
      playAlert('end', state.settings.soundEnabled);
      vibrateAlert('end', state.settings.vibrationEnabled);
    }
  });

  if (changed) {
    touchState(state);
    scheduleSave();
  }
}

async function updateWakeLock() {
  const anyRunning = state.runtime.timer.running || state.runtime.counsel.some((entry) => entry.running);
  if (state.settings.autoWakeLock && anyRunning) await requestWakeLock();
  else await releaseWakeLock();
  renderSaveStatus();
}

function toggleMainTimer() {
  togglePartTimer(state);
  stateChanged();
  updateWakeLock();
  if (state.runtime.timer.running) openFloatModal();
}

function jumpTo(index) {
  switchPart(state, index);
  stateChanged();
  updateWakeLock();
}

function nextPart() {
  completeAndAdvance(state);
  stateChanged();
  updateWakeLock();
}

function previousPart() {
  if (state.runtime.current <= 0) return;
  switchPart(state, state.runtime.current - 1);
  stateChanged();
  updateWakeLock();
}

function resetCurrentPart() {
  resetPartTimer(state);
  stateChanged();
  updateWakeLock();
}

function openFloatModal() {
  floatOpen = true;
  $('floatModal').classList.add('show');
  syncFloatModal();
  $('floatClose').focus();
}

function closeFloatModal() {
  floatOpen = false;
  $('floatModal').classList.remove('show');
}

function syncFloatModal(now = nowMs()) {
  if (!floatOpen) return;
  const part = getCurrentPart();
  if (!part) return;
  const remaining = partRemaining(state, state.runtime.current, now);
  $('floatWeek').textContent = state.weekLabel;
  $('floatSection').textContent = SECTION_LABELS[part.section];
  $('floatName').textContent = part.name;
  $('floatSpeaker').textContent = part.speaker ? `🗣️ ${part.speaker}` : '';
  $('floatTime').textContent = formatCountdown(remaining);
  $('floatTime').classList.toggle('overtime', remaining < 0);
  const total = part.min * 60 || 1;
  const circumference = 2 * Math.PI * 98;
  const fraction = Math.min(1, Math.max(0, remaining / total));
  $('floatRingFg').style.strokeDasharray = String(circumference);
  $('floatRingFg').style.strokeDashoffset = String(circumference * (1 - fraction));
  $('floatPlay').textContent = state.runtime.timer.running ? '⏸ Pausar' : '▶ Continuar';
}

function renderMeetingClock(nowValue = nowMs()) {
  const now = new Date(nowValue);
  $('liveClock').textContent = now.toLocaleTimeString('pt-BR');
  const start = getMeetingStart();
  if (!start) {
    $('scheduledStartOut').textContent = '—';
    $('scheduledEndOut').textContent = '—';
    $('elapsedOut').textContent = '—';
    $('remainingOut').textContent = '—';
    $('clockcard').classList.remove('overtime');
    return;
  }

  const end = new Date(start.getTime() + state.settings.allowedMinutes * 60000);
  $('scheduledStartOut').textContent = formatClock(start);
  $('scheduledEndOut').textContent = formatClock(end);
  const elapsed = Math.floor((now - start) / 1000);
  if (elapsed < 0) {
    $('elapsedOut').textContent = '0min';
    $('remainingOut').textContent = formatHoursMinutes(state.settings.allowedMinutes * 60);
    $('clockcard').classList.remove('overtime');
  } else {
    const budget = state.settings.allowedMinutes * 60 - elapsed;
    $('elapsedOut').textContent = formatHoursMinutes(elapsed);
    $('remainingOut').textContent = budget >= 0 ? formatHoursMinutes(budget) : `Excedido ${formatHoursMinutes(-budget)}`;
    $('clockcard').classList.toggle('overtime', budget < 0);
    if (!state.settings.meetingStartAlerted) {
      state.settings.meetingStartAlerted = true;
      $('clockcard').classList.add('ring-alert');
      setTimeout(() => $('clockcard').classList.remove('ring-alert'), 3200);
      playAlert('start', state.settings.soundEnabled);
      vibrateAlert('start', state.settings.vibrationEnabled);
      stateChanged({ fullRender: false });
    }
  }
}

function reconcileEditedParts(draftParts) {
  const oldParts = state.parts;
  const oldRuntime = state.runtime;
  const oldById = new Map(oldParts.map((part, index) => [part.id, index]));
  const currentPartId = oldParts[oldRuntime.current]?.id;
  const newRuntime = createRuntimeForParts(draftParts);

  draftParts.forEach((part, newIndex) => {
    const oldIndex = oldById.get(part.id);
    if (oldIndex === undefined) return;
    newRuntime.doneFlags[newIndex] = oldRuntime.doneFlags[oldIndex];
    newRuntime.elapsedSeconds[newIndex] = oldRuntime.elapsedSeconds[oldIndex];
    newRuntime.commentCounts[newIndex] = oldRuntime.commentCounts[oldIndex];
    newRuntime.alerts[newIndex] = oldRuntime.alerts[oldIndex];
    newRuntime.counsel[newIndex] = oldRuntime.counsel[oldIndex];
  });

  const newCurrent = draftParts.findIndex((part) => part.id === currentPartId);
  newRuntime.current = newCurrent >= 0 ? newCurrent : Math.min(oldRuntime.current, draftParts.length - 1);
  newRuntime.timer = { running: false, startedAt: null };
  state.parts = draftParts;
  state.runtime = newRuntime;
}

function openEditor() {
  pausePartTimer(state);
  pauseAllCounsels(state);
  editorDraft = cloneState(state).parts;
  $('editor').classList.add('show');
  renderEditor();
  updateWakeLock();
  stateChanged();
}

function closeEditor() {
  editorDraft = null;
  $('editor').classList.remove('show');
}

function renderEditor() {
  const box = $('erows');
  box.replaceChildren();
  if (!editorDraft) return;

  editorDraft.forEach((part, index) => {
    const row = document.createElement('div');
    row.className = 'erow';
    const top = document.createElement('div');
    top.className = 'erow-top';

    const up = document.createElement('button');
    up.type = 'button'; up.className = 'mv'; up.textContent = '▲'; up.disabled = index === 0;
    up.addEventListener('click', () => {
      [editorDraft[index - 1], editorDraft[index]] = [editorDraft[index], editorDraft[index - 1]];
      renderEditor();
    });
    const down = document.createElement('button');
    down.type = 'button'; down.className = 'mv'; down.textContent = '▼'; down.disabled = index === editorDraft.length - 1;
    down.addEventListener('click', () => {
      [editorDraft[index], editorDraft[index + 1]] = [editorDraft[index + 1], editorDraft[index]];
      renderEditor();
    });

    const section = document.createElement('select');
    [['neutro', 'Abertura/Encerr.'], ['tesouros', 'Tesouros'], ['ministerio', 'Ministério'], ['vida', 'Vida Cristã']].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value; option.textContent = label; option.selected = part.section === value;
      section.appendChild(option);
    });
    section.addEventListener('change', () => { part.section = section.value; });

    const name = document.createElement('input');
    name.type = 'text'; name.className = 'ename'; name.value = part.name;
    name.addEventListener('input', () => { part.name = name.value; });
    const minutes = document.createElement('input');
    minutes.type = 'number'; minutes.min = '0'; minutes.value = String(part.min);
    minutes.addEventListener('input', () => { part.min = Math.max(0, Number(minutes.value) || 0); });

    const commentLabel = document.createElement('label');
    commentLabel.className = 'clabel';
    const comments = document.createElement('input');
    comments.type = 'checkbox'; comments.checked = part.countComments;
    comments.addEventListener('change', () => { part.countComments = comments.checked; });
    commentLabel.append(comments, ' 💬 comentários');

    const counselLabel = document.createElement('label');
    counselLabel.className = 'clabel';
    const counselCheck = document.createElement('input');
    counselCheck.type = 'checkbox'; counselCheck.checked = part.hasCounsel;
    counselCheck.addEventListener('change', () => { part.hasCounsel = counselCheck.checked; });
    counselLabel.append(counselCheck, ' ⏱ conselho 1:30');

    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'rm'; remove.textContent = '✕'; remove.title = 'Remover';
    remove.addEventListener('click', () => {
      if (editorDraft.length === 1) {
        toast('A programação precisa ter pelo menos uma parte.');
        return;
      }
      if (confirm(`Remover “${part.name}”?`)) {
        editorDraft.splice(index, 1);
        renderEditor();
      }
    });
    top.append(up, down, section, name, minutes, commentLabel, counselLabel, remove);

    const bottom = document.createElement('div');
    bottom.className = 'erow-bottom';
    const speaker = document.createElement('input');
    speaker.type = 'text'; speaker.className = 'espeaker'; speaker.placeholder = 'Nome do orador'; speaker.value = part.speaker;
    speaker.addEventListener('input', () => { part.speaker = speaker.value; });
    const details = document.createElement('textarea');
    details.className = 'edetails'; details.placeholder = 'Detalhes / instruções'; details.value = part.details;
    details.addEventListener('input', () => { part.details = details.value; });
    const link = document.createElement('input');
    link.type = 'text'; link.className = 'elink'; link.placeholder = 'Link de referência (opcional)'; link.value = part.link;
    link.addEventListener('input', () => { part.link = link.value; });
    bottom.append(speaker, details, link);
    row.append(top, bottom);
    box.appendChild(row);
  });
}

function saveEditor() {
  if (!editorDraft?.length) {
    toast('A programação precisa ter pelo menos uma parte.');
    return;
  }
  for (const part of editorDraft) {
    part.name = part.name.trim() || 'Sem título';
    part.min = Math.max(0, Number(part.min) || 0);
    const validated = safeUrl(part.link);
    if (part.link && !validated) {
      toast(`Link inválido na parte “${part.name}”. Use http:// ou https://.`);
      return;
    }
    part.link = validated;
  }
  reconcileEditedParts(editorDraft);
  closeEditor();
  stateChanged();
}

function openUtility(title, contentBuilder) {
  modalReturnFocus = document.activeElement;
  $('utilityTitle').textContent = title;
  const content = $('utilityContent');
  content.replaceChildren();
  contentBuilder(content);
  $('utilityModal').classList.add('show');
  $('utilityClose').focus();
}

function closeUtility() {
  $('utilityModal').classList.remove('show');
  modalReturnFocus?.focus?.();
}

function utilityButton(label, handler, className = 'btn-primary') {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className; button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function openExportTools() {
  openUtility('Exportar e compartilhar', (content) => {
    const note = appendText(content, 'utility-note', 'Os arquivos são gerados no próprio dispositivo. O compartilhamento online só é ativado quando o Supabase está configurado e você está conectado.', 'p');
    note.style.marginTop = '0';

    const settings = document.createElement('div');
    settings.append(
      createSwitch('Alertas sonoros', state.settings.soundEnabled, (checked) => { state.settings.soundEnabled = checked; stateChanged({ fullRender: false }); }),
      createSwitch('Vibração', state.settings.vibrationEnabled, (checked) => { state.settings.vibrationEnabled = checked; stateChanged({ fullRender: false }); }),
      createSwitch('Manter tela ligada durante cronômetros', state.settings.autoWakeLock, (checked) => { state.settings.autoWakeLock = checked; stateChanged({ fullRender: false }); updateWakeLock(); }),
    );
    content.appendChild(settings);

    if (supabaseConfigured && user) {
      content.appendChild(createSwitch('Permitir visualização por código', state.shareEnabled, (checked) => {
        state.shareEnabled = checked;
        stateChanged({ fullRender: false });
      }));
      const code = appendText(content, 'sync-code', state.shareCode, 'div');
      code.title = 'Código para o modo apresentação';
    }

    const actions = document.createElement('div');
    actions.className = 'utility-actions';
    actions.append(
      utilityButton('PDF', () => generatePdf(state)),
      utilityButton('CSV', () => exportCsv(state), 'btn-ghost utility-dark'),
      utilityButton('JSON', () => exportJson(state), 'btn-ghost utility-dark'),
      utilityButton('Abrir apresentação', () => openPresentation(), 'btn-ghost utility-dark'),
    );
    content.appendChild(actions);
  });
}

function createSwitch(label, checked, onChange) {
  const row = document.createElement('label');
  row.className = 'switch-row';
  const text = document.createElement('span');
  text.textContent = label;
  const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  row.append(text, input);
  return row;
}

async function openAccount() {
  openUtility('Conta e sincronização', (content) => {
    if (!supabaseConfigured) {
      appendText(content, 'utility-note', 'O aplicativo está funcionando no modo local. Para ativar login, histórico online e sincronização, configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no arquivo .env e na Vercel.', 'p');
      return;
    }

    if (user) {
      appendText(content, 'utility-note', `Conectado como ${user.email}. As alterações são sincronizadas automaticamente.`, 'p');
      const actions = document.createElement('div');
      actions.className = 'utility-actions';
      actions.append(
        utilityButton('Sincronizar agora', async () => {
          try {
            setCloudState('saving');
            await saveMeetingOnline(state, user);
            setCloudState('synced');
            toast('Sincronização concluída.');
          } catch (error) {
            setCloudState('error');
            toast(error.message);
          }
        }),
        utilityButton('Sair da conta', async () => {
          await signOut();
          user = null;
          setCloudState('local');
          closeUtility();
          renderAccountButton();
        }, 'btn-ghost utility-dark'),
      );
      content.appendChild(actions);
      return;
    }

    appendText(content, 'utility-note', 'Informe seu e-mail. O Supabase enviará um link seguro para entrar, sem senha.', 'p');
    const row = document.createElement('div');
    row.className = 'utility-row';
    const email = document.createElement('input');
    email.type = 'email'; email.placeholder = 'seuemail@exemplo.com'; email.autocomplete = 'email';
    const send = utilityButton('Enviar link', async () => {
      if (!email.checkValidity()) {
        email.reportValidity();
        return;
      }
      try {
        send.disabled = true;
        await signInWithEmail(email.value.trim());
        toast('Link de acesso enviado para o e-mail.');
      } catch (error) {
        toast(error.message);
      } finally {
        send.disabled = false;
      }
    });
    row.append(email, send);
    content.appendChild(row);
  });
}

function renderAccountButton() {
  $('accountBtn').textContent = user ? 'Conta conectada' : 'Conta';
}

async function openHistory() {
  openUtility('Histórico de reuniões', (content) => {
    appendText(content, 'utility-note', 'Carregue uma reunião anterior sem apagar o arquivo arquivado. A reunião atual será salva antes da troca.', 'p');
    const list = document.createElement('div');
    list.className = 'history-list';
    appendText(list, 'utility-note', 'Carregando…', 'div');
    content.appendChild(list);

    void (async () => {
      let entries = [];
      try {
        if (user && supabaseConfigured) {
          const online = await listOnlineMeetings(user);
          entries = online.map((entry) => ({
            id: entry.id,
            label: entry.week_label,
            updatedAt: entry.updated_at,
            source: 'online',
            snapshot: (Array.isArray(entry.meeting_states) ? entry.meeting_states[0]?.snapshot : entry.meeting_states?.snapshot) || null,
          }));
        }
      } catch (error) {
        console.error(error);
      }
      if (!entries.length) {
        entries = loadLocalHistory().map((snapshot) => ({
          id: snapshot.localId,
          label: snapshot.weekLabel,
          updatedAt: snapshot.archivedAt || snapshot.updatedAt,
          source: 'local',
          snapshot,
        }));
      }

      list.replaceChildren();
      if (!entries.length) {
        appendText(list, 'utility-note', 'Nenhuma reunião arquivada ainda.', 'div');
        return;
      }
      entries.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const text = document.createElement('div');
        appendText(text, '', entry.label || 'Reunião sem título', 'strong');
        appendText(text, '', `${entry.source === 'online' ? 'Nuvem' : 'Dispositivo'} · ${new Date(entry.updatedAt).toLocaleString('pt-BR')}`, 'small');
        const load = utilityButton('Carregar', async () => {
          try {
            pausePartTimer(state);
            archiveLocalState(state);
            const snapshot = entry.snapshot || await loadOnlineMeeting(entry.id);
            state = normalizeState(snapshot);
            saveLocalState(state);
            closeUtility();
            renderAll();
            toast('Reunião carregada.');
          } catch (error) {
            toast(error.message);
          }
        });
        item.append(text, load);
        list.appendChild(item);
      });
    })();
  });
}

async function openPresentation() {
  if (user && supabaseConfigured) {
    state.shareEnabled = true;
    touchState(state);
    try {
      await saveMeetingOnline(state, user);
      saveLocalState(state);
      const url = new URL('/presentation.html', window.location.origin);
      url.searchParams.set('code', state.shareCode);
      window.open(url.href, '_blank', 'noopener');
      return;
    } catch (error) {
      console.error(error);
      toast('Não foi possível criar o link online. Abrindo apresentação local.');
    }
  }
  postLiveState();
  window.open('/presentation.html', '_blank', 'noopener');
}

async function resetMeeting() {
  const confirmed = confirm('Isso arquivará a reunião atual e zerará cronômetros, comentários e conselhos. A programação e os oradores serão mantidos. Continuar?');
  if (!confirmed) return;
  closeFloatModal();
  pausePartTimer(state);
  pauseAllCounsels(state);
  state.status = 'completed';
  touchState(state);
  archiveLocalState(state);
  try {
    if (user && state.meetingId) await markMeetingCompleted(state, user);
  } catch (error) {
    console.error(error);
  }

  const identity = createDefaultState();
  const preservedParts = cloneState(state).parts;
  state.meetingId = null;
  state.localId = identity.localId;
  state.shareCode = identity.shareCode;
  state.shareEnabled = false;
  state.createdAt = identity.createdAt;
  state.settings.meetingStartIso = null;
  state.settings.meetingStartAlerted = false;
  resetRuntime(state);
  state.parts = preservedParts;
  state.runtime = createRuntimeForParts(state.parts);
  saveLocalState(state);
  stateChanged();
  updateWakeLock();
  toast('Pronto para a próxima reunião.');
}

function generateProgram() {
  const raw = $('pasteBox').value;
  if (!raw.trim()) {
    $('importStatus').textContent = 'Cole o texto da apostila antes de gerar.';
    return;
  }
  const parsed = parseProgramText(raw);
  if (!parsed.parts.length) {
    $('importStatus').textContent = 'Não encontrei partes com “(X min)”. Confira se colou a página inteira.';
    return;
  }
  pausePartTimer(state);
  pauseAllCounsels(state);
  state.parts = parsed.parts;
  state.runtime = createRuntimeForParts(state.parts);
  if (parsed.weekLabel) state.weekLabel = parsed.weekLabel;
  $('pasteBox').value = '';
  $('importStatus').textContent = '';
  $('importer').classList.remove('show');
  stateChanged();
  toast('Programação gerada. Revise nomes, oradores e detalhes.');
}

function bindEvents() {
  $('playBtn').addEventListener('click', toggleMainTimer);
  $('resetBtn').addEventListener('click', resetCurrentPart);
  $('nextBtn').addEventListener('click', nextPart);
  $('prevBtn').addEventListener('click', previousPart);
  $('reopenFloatBtn').addEventListener('click', openFloatModal);
  $('floatClose').addEventListener('click', closeFloatModal);
  $('floatModal').addEventListener('click', (event) => { if (event.target === $('floatModal')) closeFloatModal(); });
  $('floatPlay').addEventListener('click', toggleMainTimer);
  $('floatReset').addEventListener('click', resetCurrentPart);

  $('weekLabel').addEventListener('input', () => {
    state.weekLabel = $('weekLabel').value;
    touchState(state);
    scheduleSave();
    syncFloatModal();
  });
  $('startTimeInput').addEventListener('change', setMeetingStartFromInput);
  $('durH').addEventListener('input', updateAllowedDuration);
  $('durM').addEventListener('input', updateAllowedDuration);
  $('startTrigger').addEventListener('click', () => {
    const date = new Date();
    state.settings.startTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    state.settings.meetingStartIso = date.toISOString();
    state.settings.meetingStartAlerted = true;
    state.status = 'active';
    $('startTrigger').textContent = '✓';
    setTimeout(() => { $('startTrigger').textContent = '▶'; }, 1500);
    stateChanged();
  });

  $('importToggle').addEventListener('click', () => $('importer').classList.toggle('show'));
  $('cancelImport').addEventListener('click', () => {
    $('importer').classList.remove('show');
    $('importStatus').textContent = '';
  });
  $('genBtn').addEventListener('click', generateProgram);
  $('resetTotalBtn').addEventListener('click', resetMeeting);

  $('editToggle').addEventListener('click', () => {
    if ($('editor').classList.contains('show')) closeEditor();
    else openEditor();
  });
  $('addRow').addEventListener('click', () => {
    editorDraft?.push(createPart('neutro', 'Nova parte', 5));
    renderEditor();
  });
  $('cancelEdit').addEventListener('click', closeEditor);
  $('saveEdit').addEventListener('click', saveEditor);

  $('pdfBtn').addEventListener('click', () => generatePdf(state));
  $('exportBtn').addEventListener('click', openExportTools);
  $('historyBtn').addEventListener('click', openHistory);
  $('accountBtn').addEventListener('click', openAccount);
  $('presentationBtn').addEventListener('click', openPresentation);
  $('installBtn').addEventListener('click', installApp);

  $('utilityClose').addEventListener('click', closeUtility);
  $('utilityModal').addEventListener('click', (event) => { if (event.target === $('utilityModal')) closeUtility(); });

  document.addEventListener('keydown', (event) => {
    const activeTag = document.activeElement?.tagName;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag);
    if (event.code === 'Space' && !typing) {
      event.preventDefault();
      toggleMainTimer();
    }
    if (event.key === 'Escape') {
      if ($('utilityModal').classList.contains('show')) closeUtility();
      else if (floatOpen) closeFloatModal();
    }
    if (!typing && event.key.toLowerCase() === 'p') openPresentation();
  });

  window.addEventListener('online', () => {
    renderSaveStatus();
    scheduleSave();
  });
  window.addEventListener('offline', renderSaveStatus);
  window.addEventListener('pagehide', () => {
    saveLocalState(state);
    postLiveState();
  });
}

function updateAllowedDuration() {
  const hours = Math.max(0, Number($('durH').value) || 0);
  const minutes = Math.min(59, Math.max(0, Number($('durM').value) || 0));
  state.settings.allowedMinutes = Math.max(1, hours * 60 + minutes);
  stateChanged({ fullRender: false });
  renderMeetingClock();
}

async function initializeAuth() {
  if (!supabaseConfigured || !supabase) {
    renderAccountButton();
    return;
  }
  user = await currentUser();
  renderAccountButton();
  if (user) scheduleSave();
  supabase.auth.onAuthStateChange((_event, session) => {
    user = session?.user || null;
    renderAccountButton();
    setCloudState(user ? 'saving' : 'local');
    if (user) scheduleSave();
  });
}

function initializePwa() {
  registerServiceWorker();
  onInstallAvailability((available) => { $('installBtn').hidden = !available; });
}

function timerLoop() {
  renderDynamic();
  requestAnimationFrame(() => setTimeout(timerLoop, 200));
}

bindEvents();
renderAll();
initializePwa();
initializeAuth();
updateWakeLock();
timerLoop();
