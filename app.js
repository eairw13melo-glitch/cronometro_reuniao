(() => {
  'use strict';

  const STORAGE_KEY = 'cronometro_vida_ministerio_state_v4';
  const HISTORY_KEY = 'cronometro_vida_ministerio_history_v4';
  const PRESENTATION_KEY = 'cronometro_vida_ministerio_presentation_v4';
  const CHANNEL_NAME = 'cronometro_vida_ministerio_channel_v4';
  const STATE_VERSION = 5;
  const BACKUP_KIND = 'cronometro-vida-ministerio-backup';
  const BACKUP_VERSION = 1;
  const HISTORY_LIMIT = 30;
  const COUNSEL_LIMIT_MS = 90_000;
  const TIME_TOLERANCE_MS = 5_000;
  const JEWELS_OPEN_QUESTION = 'Que joias espirituais você encontrou na leitura da Bíblia desta semana?';
  const SAVE_DELAY_MS = 220;
  const CLOUD_SAVE_DELAY_MS = 1200;

  const SECTION_LABELS = {
    neutro: 'Abertura / Encerramento',
    tesouros: 'Tesouros da Palavra de Deus',
    ministerio: 'Faça seu Melhor no Ministério',
    vida: 'Nossa Vida Cristã'
  };

  const $ = (id) => document.getElementById(id);
  const nowMs = () => Date.now();
  const localDateValue = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  function validDateValue(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function timestampOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  }

  function loadExternalScript(src, globalCheck) {
    if (globalCheck?.()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-dynamic-src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.dynamicSrc = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
      document.head.appendChild(script);
    });
  }
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const esc = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function safeUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value, window.location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function displayDetails(item) {
    if (!item) return '';
    const first = String(item.details || '').trim();
    if (!item.countComments) return first;
    const lines = [];
    if (first) lines.push(`1º ${first}`);
    lines.push(`2º ${JEWELS_OPEN_QUESTION}`);
    return lines.join('\n');
  }

  function evaluationEmoji(value) {
    return value === 'good' ? '👍🏾' : value === 'bad' ? '👎🏿' : '';
  }

  function evaluationLabel(value) {
    return value === 'good'
      ? 'Dentro da margem de 5 segundos'
      : value === 'bad'
        ? 'Fora da margem de 5 segundos'
        : 'Não avaliado';
  }

  function part(section, name, min, extra = {}) {
    return {
      id: uid(),
      section,
      name,
      min,
      speaker: '',
      details: '',
      link: '',
      countComments: false,
      hasCounsel: false,
      ...extra
    };
  }

  function defaultParts() {
    return [
      part('neutro', 'Cântico 44 e oração | Comentários iniciais', 1),
      part('tesouros', '1. Discurso', 10),
      part('tesouros', '2. Joias espirituais', 10, {
        details: 'Jer. 20:12 — O que esse versículo nos incentiva a fazer? (w13 15/3 10 § 11)',
        countComments: true
      }),
      part('tesouros', '3. Leitura da Bíblia', 4, { hasCounsel: true }),
      part('ministerio', '4. Iniciando conversas', 3, { hasCounsel: true }),
      part('ministerio', '5. Cultivando o interesse', 4, { hasCounsel: true }),
      part('ministerio', '6. Fazendo discípulos', 5, { hasCounsel: true }),
      part('vida', 'Cântico (intervalo)', 3),
      part('vida', '7. Necessidades locais / parte da Vida Cristã', 15),
      part('vida', '8. Estudo bíblico de congregação', 30),
      part('neutro', 'Comentários finais | Cântico 31 e oração', 3)
    ];
  }

  function timerRecord() {
    return {
      elapsedMs: 0,
      runningSince: null,
      completed: false,
      comments: 0,
      alarmStage: 0,
      counselElapsedMs: 0,
      counselRunningSince: null,
      counselAlarmFired: false,
      evaluation: null,
      evaluatedAt: null
    };
  }

  function createInitialState() {
    const parts = defaultParts();
    const timers = Object.fromEntries(parts.map((item) => [item.id, timerRecord()]));
    return {
      version: STATE_VERSION,
      meetingId: uid(),
      weekLabel: 'Semana da reunião · Jeremias 20',
      scheduledDate: localDateValue(),
      scheduledStartTime: '19:30',
      allowedMinutes: 105,
      actualStartAt: null,
      finishedAt: null,
      autoStartKey: null,
      currentPartId: parts[0]?.id || null,
      parts,
      timers,
      settings: {
        soundEnabled: true,
        vibrationEnabled: true,
        autoFloatEnabled: false,
        autoNextEnabled: false,
        showSpeakerOnPresentation: true
      },
      cloud: {
        meetingId: null,
        shareCode: null,
        lastSyncedAt: null
      },
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeState(raw) {
    const base = createInitialState();
    if (!raw || typeof raw !== 'object') return base;

    const parts = Array.isArray(raw.parts) && raw.parts.length
      ? raw.parts.map((item) => ({
          id: item.id || uid(),
          section: SECTION_LABELS[item.section] ? item.section : 'neutro',
          name: String(item.name || 'Parte sem título'),
          min: Math.max(0, Number(item.min) || 0),
          speaker: String(item.speaker || ''),
          details: String(item.details || ''),
          link: safeUrl(item.link || ''),
          countComments: Boolean(item.countComments),
          hasCounsel: Boolean(item.hasCounsel)
        }))
      : base.parts;

    const timers = {};
    for (const item of parts) {
      const source = raw.timers?.[item.id] || {};
      timers[item.id] = {
        elapsedMs: Math.max(0, Number(source.elapsedMs) || 0),
        runningSince: timestampOrNull(source.runningSince),
        completed: Boolean(source.completed),
        comments: Math.max(0, Math.floor(Number(source.comments) || 0)),
        alarmStage: Math.max(0, Math.min(3, Math.floor(Number(source.alarmStage) || 0))),
        counselElapsedMs: Math.max(0, Number(source.counselElapsedMs) || 0),
        counselRunningSince: timestampOrNull(source.counselRunningSince),
        counselAlarmFired: Boolean(source.counselAlarmFired),
        evaluation: ['good', 'bad'].includes(source.evaluation) ? source.evaluation : null,
        evaluatedAt: timestampOrNull(source.evaluatedAt)
      };
    }

    const currentPartId = parts.some((item) => item.id === raw.currentPartId)
      ? raw.currentPartId
      : parts[0]?.id || null;

    return {
      version: STATE_VERSION,
      meetingId: raw.meetingId || uid(),
      weekLabel: String(raw.weekLabel || base.weekLabel),
      scheduledDate: validDateValue(raw.scheduledDate)
        ? raw.scheduledDate
        : timestampOrNull(raw.actualStartAt) ? localDateValue(new Date(timestampOrNull(raw.actualStartAt))) : base.scheduledDate,
      scheduledStartTime: /^\d{2}:\d{2}$/.test(raw.scheduledStartTime || '') ? raw.scheduledStartTime : base.scheduledStartTime,
      allowedMinutes: Math.max(1, Math.floor(Number(raw.allowedMinutes) || base.allowedMinutes)),
      actualStartAt: timestampOrNull(raw.actualStartAt),
      finishedAt: timestampOrNull(raw.finishedAt),
      autoStartKey: typeof raw.autoStartKey === 'string' ? raw.autoStartKey : null,
      currentPartId,
      parts,
      timers,
      settings: {
        soundEnabled: raw.settings?.soundEnabled !== false,
        vibrationEnabled: raw.settings?.vibrationEnabled !== false,
        autoFloatEnabled: Boolean(raw.settings?.autoFloatEnabled),
        autoNextEnabled: Boolean(raw.settings?.autoNextEnabled),
        showSpeakerOnPresentation: raw.settings?.showSpeakerOnPresentation !== false
      },
      cloud: {
        meetingId: raw.cloud?.meetingId || null,
        shareCode: raw.cloud?.shareCode || null,
        lastSyncedAt: raw.cloud?.lastSyncedAt || null
      },
      updatedAt: raw.updatedAt || new Date().toISOString()
    };
  }

  function loadState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch {
      return createInitialState();
    }
  }

  let state = loadState();
  let editDraft = null;
  let floatOpen = false;
  let saveTimer = null;
  let cloudSaveTimer = null;
  let wakeLockSentinel = null;
  let audioContext = null;
  let broadcastChannel = null;
  let supabaseClient = null;
  let cloudUser = null;
  let presentationRealtimeChannel = null;
  let meetingRealtimeChannel = null;
  let presentationRealtimeReady = false;
  let applyingCloudState = false;
  let autoNextTimeout = null;
  let toastTimeout = null;
  let lastLightRenderSecond = -1;

  function ensureTimers() {
    const validIds = new Set(state.parts.map((item) => item.id));
    for (const item of state.parts) {
      if (!state.timers[item.id]) state.timers[item.id] = timerRecord();
    }
    for (const id of Object.keys(state.timers)) {
      if (!validIds.has(id)) delete state.timers[id];
    }
  }

  function currentIndex() {
    return state.parts.findIndex((item) => item.id === state.currentPartId);
  }

  function currentPart() {
    return state.parts[currentIndex()] || null;
  }

  function currentTimer() {
    const item = currentPart();
    return item ? state.timers[item.id] : null;
  }

  function elapsedMsFor(partId, at = nowMs()) {
    const timer = state.timers[partId];
    if (!timer) return 0;
    return timer.elapsedMs + (timer.runningSince ? Math.max(0, at - timer.runningSince) : 0);
  }

  function counselElapsedMsFor(partId, at = nowMs()) {
    const timer = state.timers[partId];
    if (!timer) return 0;
    return timer.counselElapsedMs + (timer.counselRunningSince ? Math.max(0, at - timer.counselRunningSince) : 0);
  }

  function isPartRunning(partId) {
    return Boolean(state.timers[partId]?.runningSince);
  }

  function isAnyRunning() {
    return Object.values(state.timers).some((timer) => timer.runningSince || timer.counselRunningSince);
  }

  function plannedMs(item) {
    return Math.max(0, Number(item?.min || 0) * 60_000);
  }

  function remainingMsFor(item, at = nowMs()) {
    return plannedMs(item) - elapsedMsFor(item.id, at);
  }

  function formatCountdown(ms) {
    const over = ms < 0;
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${over ? '+' : ''}${minutes}:${seconds}`;
  }

  function formatDuration(ms, signed = false) {
    const negative = ms < 0;
    const totalSeconds = Math.round(Math.abs(ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const prefix = signed ? (negative ? '-' : '+') : '';
    if (hours) return `${prefix}${hours}h${String(minutes).padStart(2, '0')}min`;
    if (minutes) return `${prefix}${minutes}min${seconds ? `${String(seconds).padStart(2, '0')}s` : ''}`;
    return `${prefix}${seconds}s`;
  }

  function formatClock(date) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function totalPlannedMs() {
    return state.parts.reduce((sum, item) => sum + plannedMs(item), 0);
  }

  function totalElapsedMs(at = nowMs()) {
    return state.parts.reduce((sum, item) => sum + elapsedMsFor(item.id, at), 0);
  }

  function markChanged({ cloud = true, render = false } = {}) {
    state.updatedAt = new Date().toISOString();
    $('saveStatus').textContent = 'Salvando…';
    $('saveStatus').className = 'save-status pending';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        $('saveStatus').textContent = 'Salvo neste dispositivo';
        $('saveStatus').className = 'save-status';
        broadcastPresentation();
        if (cloud) scheduleCloudSave();
      } catch (error) {
        console.error(error);
        $('saveStatus').textContent = 'Falha ao salvar localmente';
        $('saveStatus').className = 'save-status error';
      }
    }, SAVE_DELAY_MS);
    if (render) renderAll();
  }

  function forceLocalSave({ touch = true } = {}) {
    clearTimeout(saveTimer);
    try {
      if (touch) state.updatedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(PRESENTATION_KEY, JSON.stringify(getPresentationPayload()));
    } catch (error) {
      console.error(error);
    }
  }

  function toast(message, type = '') {
    const node = $('toast');
    node.textContent = message;
    node.className = `toast ${type}`.trim();
    node.hidden = false;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { node.hidden = true; }, 3200);
  }

  function showPanel(id, show = true) {
    const node = $(id);
    if (!node) return;
    node.classList.toggle('show', show);
    if (show) node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function getStatusClass(remainingMs) {
    if (remainingMs <= 0) return 'overtime';
    if (remainingMs <= 60_000) return 'warning';
    return '';
  }

  function renderTotals() {
    $('totalTime').textContent = formatDuration(totalPlannedMs());
  }

  function renderStrip() {
    const strip = $('strip');
    strip.textContent = '';
    state.parts.forEach((item) => {
      const segment = document.createElement('button');
      segment.type = 'button';
      segment.className = `seg seg-${item.section}${item.id === state.currentPartId ? ' active' : ''}${state.timers[item.id]?.completed ? ' done' : ''}`;
      segment.style.flex = String(item.min > 0 ? item.min : .3);
      segment.title = `${item.name} (${item.min} min)`;
      segment.setAttribute('aria-label', segment.title);
      segment.addEventListener('click', () => jumpToPart(item.id));
      strip.appendChild(segment);
    });
  }

  function renderList() {
    const list = $('plist');
    list.textContent = '';
    let lastSection = null;
    const at = nowMs();

    state.parts.forEach((item) => {
      if (['tesouros', 'ministerio', 'vida'].includes(item.section) && item.section !== lastSection) {
        const header = document.createElement('li');
        header.className = `sec-header sec-header-${item.section}`;
        header.textContent = SECTION_LABELS[item.section];
        list.appendChild(header);
      }
      lastSection = item.section;

      const timer = state.timers[item.id];
      const remaining = remainingMsFor(item, at);
      const running = Boolean(timer.runningSince);
      const link = safeUrl(item.link);
      const li = document.createElement('li');
      li.className = `li-item li-${item.section}${item.id === state.currentPartId ? ' li-active' : ''}${timer.completed ? ' li-done' : ''}`;
      li.dataset.partId = item.id;
      li.innerHTML = `
        <div class="li-left">
          <span class="li-check" title="${esc(evaluationLabel(timer.evaluation))}">${evaluationEmoji(timer.evaluation) || (timer.completed ? '✓' : '')}</span>
          <div class="li-main">
            <span class="li-name">${esc(item.name)}${item.countComments ? `<span class="li-comment-badge">💬 ${timer.comments}</span>` : ''}</span>
            ${displayDetails(item) ? `<div class="li-details">${esc(displayDetails(item))}${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">🔗 referência</a>` : ''}</div>` : ''}
          </div>
        </div>
        <div class="li-trigger">
          <span class="li-countdown ${getStatusClass(remaining)}" id="cd-${item.id}">${formatCountdown(remaining)}</span>
          <button class="li-playbtn" type="button" data-action="play" title="${running ? 'Parar e avaliar' : 'Iniciar'}">${running ? '■' : '▶'}</button>
        </div>
        <div class="li-speaker">
          <span>🗣️ Orador</span>
          <input type="text" data-action="speaker" placeholder="Nome de quem vai apresentar" value="${esc(item.speaker)}">
        </div>
        ${item.hasCounsel ? `
          <div class="li-counsel">
            <span>⏱ Conselho (referência 1:30)</span>
            <span class="lc-time ${counselElapsedMsFor(item.id, at) > COUNSEL_LIMIT_MS ? 'overtime' : ''}" id="counsel-time-${item.id}">${formatCountdown(COUNSEL_LIMIT_MS - counselElapsedMsFor(item.id, at))}</span>
            <button class="lc-btn" type="button" data-action="counsel-play">${timer.counselRunningSince ? '⏸' : '▶'}</button>
            <button class="lc-btn lc-reset" type="button" data-action="counsel-reset">↺</button>
          </div>` : ''}
      `;

      li.addEventListener('click', (event) => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'speaker') return;
        if (action === 'play') {
          event.stopPropagation();
          if (state.currentPartId !== item.id) jumpToPart(item.id, false);
          toggleCurrentPart();
          return;
        }
        if (action === 'counsel-play') {
          event.stopPropagation();
          toggleCounsel(item.id);
          return;
        }
        if (action === 'counsel-reset') {
          event.stopPropagation();
          resetCounsel(item.id);
          return;
        }
        if (event.target.closest('a')) return;
        jumpToPart(item.id);
      });

      const speakerInput = li.querySelector('[data-action="speaker"]');
      speakerInput.addEventListener('click', (event) => event.stopPropagation());
      speakerInput.addEventListener('input', () => {
        item.speaker = speakerInput.value;
        if (item.id === state.currentPartId) renderStage();
        markChanged();
      });
      list.appendChild(li);
    });
  }

  function renderStage(at = nowMs()) {
    const item = currentPart();
    if (!item) {
      $('sectionTag').textContent = '—';
      $('partName').textContent = 'Nenhuma parte cadastrada';
      $('partMeta').textContent = '';
      $('partSpeaker').textContent = '';
      $('ringTime').textContent = '00:00';
      $('playBtn').disabled = true;
      $('prevBtn').disabled = true;
      $('nextBtn').disabled = true;
      return;
    }

    const index = currentIndex();
    const timer = state.timers[item.id];
    const remaining = remainingMsFor(item, at);
    const total = Math.max(1, plannedMs(item));
    const progress = Math.max(0, Math.min(1, remaining / total));
    const circumference = 2 * Math.PI * 80;
    const status = getStatusClass(remaining);

    $('sectionTag').textContent = SECTION_LABELS[item.section];
    $('sectionTag').className = `section-tag tag-${item.section}`;
    const resultEmoji = evaluationEmoji(timer.evaluation);
    $('partName').textContent = `${item.name}${resultEmoji ? ` ${resultEmoji}` : ''}`;
    const details = displayDetails(item);
    $('partMeta').textContent = `Parte ${index + 1} de ${state.parts.length} · duração prevista: ${item.min} min${details ? `\n${details}` : ''}`;
    $('partSpeaker').textContent = item.speaker ? `🗣️ ${item.speaker}` : '';
    $('ringTime').textContent = formatCountdown(remaining);
    $('ringFg').style.strokeDasharray = String(circumference);
    $('ringFg').style.strokeDashoffset = String(circumference * (1 - progress));
    $('ringFg').className.baseVal = `ring-fg ${status}`.trim();
    $('stage').className = `stage ${status}`.trim();
    $('playBtn').textContent = timer.runningSince ? '■ Parar' : (timer.elapsedMs ? '▶ Continuar' : '▶ Iniciar');
    $('playBtn').disabled = false;
    $('prevBtn').disabled = index <= 0;
    $('nextBtn').disabled = index >= state.parts.length - 1;
    syncFloat(at);
  }

  function renderComments() {
    const wrap = $('commentsWrap');
    wrap.textContent = '';
    state.parts.filter((item) => item.countComments).forEach((item) => {
      const timer = state.timers[item.id];
      const active = item.id === state.currentPartId && Boolean(timer.runningSince);
      const card = document.createElement('section');
      card.className = `comments-card${active ? '' : ' inactive'}`;
      card.innerHTML = `
        <div class="cc-title">
          <div class="lbl">Contador de comentários</div>
          <div class="name">${esc(item.name)}</div>
          ${active ? '' : '<div class="cc-hint">Inicie o cronômetro desta parte para habilitar</div>'}
        </div>
        <div class="cc-count">${timer.comments}</div>
        <div class="cc-btns">
          <button class="cc-add" type="button" ${active ? '' : 'disabled'}>+1 Comentário</button>
          <button class="cc-sub" type="button" ${active ? '' : 'disabled'}>−1</button>
          <button class="cc-reset" type="button" ${active ? '' : 'disabled'}>↺ Reiniciar</button>
        </div>`;
      card.querySelector('.cc-add').addEventListener('click', () => {
        timer.comments += 1;
        markChanged({ render: true });
      });
      card.querySelector('.cc-sub').addEventListener('click', () => {
        timer.comments = Math.max(0, timer.comments - 1);
        markChanged({ render: true });
      });
      card.querySelector('.cc-reset').addEventListener('click', () => {
        timer.comments = 0;
        markChanged({ render: true });
      });
      wrap.appendChild(card);
    });
  }

  function renderSettings() {
    $('soundEnabled').checked = state.settings.soundEnabled;
    $('vibrationEnabled').checked = state.settings.vibrationEnabled;
    $('autoFloatEnabled').checked = state.settings.autoFloatEnabled;
    $('autoNextEnabled').checked = state.settings.autoNextEnabled;
    $('showSpeakerOnPresentation').checked = state.settings.showSpeakerOnPresentation;
    $('weekLabel').value = state.weekLabel;
    $('meetingDateInput').value = state.scheduledDate;
    $('startTimeInput').value = state.scheduledStartTime;
    $('durH').value = Math.floor(state.allowedMinutes / 60);
    $('durM').value = state.allowedMinutes % 60;
  }

  function renderAll() {
    ensureTimers();
    renderSettings();
    renderTotals();
    renderStrip();
    renderList();
    renderStage();
    renderComments();
    renderMeetingClock();
    updatePresentationLink();
  }

  function updateLightDisplays(at = nowMs()) {
    const item = currentPart();
    if (!item) return;
    const remaining = remainingMsFor(item, at);
    const status = getStatusClass(remaining);
    const timer = currentTimer();

    renderStage(at);
    const cd = $(`cd-${item.id}`);
    if (cd) {
      cd.textContent = formatCountdown(remaining);
      cd.className = `li-countdown ${status}`.trim();
    }
    const play = document.querySelector(`[data-part-id="${CSS.escape(item.id)}"] [data-action="play"]`);
    if (play) play.textContent = timer.runningSince ? '■' : '▶';

    if (item.hasCounsel) {
      const counselRemaining = COUNSEL_LIMIT_MS - counselElapsedMsFor(item.id, at);
      const counselNode = $(`counsel-time-${item.id}`);
      if (counselNode) {
        counselNode.textContent = formatCountdown(counselRemaining);
        counselNode.className = `lc-time${counselRemaining < 0 ? ' overtime' : ''}`;
      }
    }
  }

  function pausePart(partId, at = nowMs()) {
    const timer = state.timers[partId];
    if (!timer?.runningSince) return;
    timer.elapsedMs += Math.max(0, at - timer.runningSince);
    timer.runningSince = null;
  }

  function pauseAllParts(exceptId = null, at = nowMs()) {
    Object.entries(state.timers).forEach(([id, timer]) => {
      if (id !== exceptId && timer.runningSince) pausePart(id, at);
    });
  }

  function evaluatePart(partId, at = nowMs()) {
    const item = state.parts.find((candidate) => candidate.id === partId);
    const timer = state.timers[partId];
    if (!item || !timer || plannedMs(item) <= 0 || elapsedMsFor(partId, at) <= 0) {
      if (timer) {
        timer.evaluation = null;
        timer.evaluatedAt = null;
      }
      return null;
    }
    const difference = elapsedMsFor(partId, at) - plannedMs(item);
    timer.evaluation = Math.abs(difference) <= TIME_TOLERANCE_MS ? 'good' : 'bad';
    timer.evaluatedAt = at;
    return timer.evaluation;
  }

  function showEvaluation(result) {
    if (!result) return;
    const emoji = evaluationEmoji(result);
    toast(`${emoji} ${evaluationLabel(result)}.`, result === 'good' ? 'success' : 'error');
  }

  function startCurrentPart(at = nowMs()) {
    const item = currentPart();
    if (!item) return;
    if (!state.actualStartAt) {
      state.actualStartAt = at;
      state.autoStartKey = scheduleKey();
    }
    state.finishedAt = null;
    pauseAllParts(item.id, at);
    const timer = state.timers[item.id];
    if (timer.runningSince) return;
    timer.runningSince = at;
    timer.completed = false;
    timer.evaluation = null;
    timer.evaluatedAt = null;
    clearTimeout(autoNextTimeout);
    requestWakeLock();
    if (state.settings.autoFloatEnabled) openFloat();
    markChanged({ render: true });
  }

  function stopCurrentPart() {
    const item = currentPart();
    if (!item) return;
    const at = nowMs();
    pausePart(item.id, at);
    const timer = state.timers[item.id];
    timer.completed = true;
    const result = evaluatePart(item.id, at);
    markChanged({ render: true });
    showEvaluation(result);
    releaseWakeLockIfIdle();
  }

  function toggleCurrentPart() {
    const timer = currentTimer();
    if (!timer) return;
    timer.runningSince ? stopCurrentPart() : startCurrentPart();
  }

  function resetCurrentPart() {
    const item = currentPart();
    if (!item) return;
    const timer = state.timers[item.id];
    timer.elapsedMs = 0;
    timer.runningSince = null;
    timer.completed = false;
    timer.alarmStage = 0;
    timer.evaluation = null;
    timer.evaluatedAt = null;
    clearTimeout(autoNextTimeout);
    markChanged({ render: true });
    releaseWakeLockIfIdle();
  }

  function jumpToPart(partId, render = true) {
    if (!state.parts.some((item) => item.id === partId)) return;
    pauseAllParts();
    state.currentPartId = partId;
    clearTimeout(autoNextTimeout);
    markChanged({ render });
    if (!render) renderAll();
    releaseWakeLockIfIdle();
  }

  function nextPart() {
    const index = currentIndex();
    if (index < 0 || index >= state.parts.length - 1) return;
    const currentItem = currentPart();
    const at = nowMs();
    if (!state.actualStartAt) {
      state.actualStartAt = at;
      state.autoStartKey = scheduleKey();
    }
    state.finishedAt = null;
    pausePart(currentItem.id, at);
    const currentPartTimer = state.timers[currentItem.id];
    currentPartTimer.completed = true;
    const result = evaluatePart(currentItem.id, at);

    state.currentPartId = state.parts[index + 1].id;
    const nextTimer = currentTimer();
    pauseAllParts(state.currentPartId, at);
    nextTimer.runningSince = at;
    nextTimer.completed = false;
    nextTimer.evaluation = null;
    nextTimer.evaluatedAt = null;
    nextTimer.alarmStage = 0;
    clearTimeout(autoNextTimeout);
    requestWakeLock();
    if (state.settings.autoFloatEnabled) openFloat();
    markChanged({ render: true });
    showEvaluation(result);
  }

  function previousPart() {
    const index = currentIndex();
    if (index > 0) jumpToPart(state.parts[index - 1].id);
  }

  function pauseAllCounsels(exceptId = null, at = nowMs()) {
    Object.entries(state.timers).forEach(([id, timer]) => {
      if (id !== exceptId && timer.counselRunningSince) {
        timer.counselElapsedMs += Math.max(0, at - timer.counselRunningSince);
        timer.counselRunningSince = null;
      }
    });
  }

  function toggleCounsel(partId) {
    const timer = state.timers[partId];
    if (!timer) return;
    state.finishedAt = null;
    if (timer.counselRunningSince) {
      timer.counselElapsedMs += Math.max(0, nowMs() - timer.counselRunningSince);
      timer.counselRunningSince = null;
    } else {
      pauseAllCounsels(partId);
      timer.counselRunningSince = nowMs();
      timer.counselAlarmFired = false;
      requestWakeLock();
    }
    markChanged({ render: true });
    releaseWakeLockIfIdle();
  }

  function resetCounsel(partId) {
    const timer = state.timers[partId];
    if (!timer) return;
    timer.counselElapsedMs = 0;
    timer.counselRunningSince = null;
    timer.counselAlarmFired = false;
    markChanged({ render: true });
    releaseWakeLockIfIdle();
  }

  function beep(kind = 'normal') {
    if (!state.settings.soundEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const pattern = kind === 'final'
        ? [{ t: 0, f: 880, d: .18 }, { t: .25, f: 880, d: .18 }, { t: .5, f: 1040, d: .3 }]
        : kind === 'warning'
          ? [{ t: 0, f: 660, d: .14 }]
          : [{ t: 0, f: 780, d: .18 }];
      pattern.forEach(({ t, f, d }) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = f;
        gain.gain.value = .12;
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(audioContext.currentTime + t);
        oscillator.stop(audioContext.currentTime + t + d);
      });
    } catch (error) {
      console.warn('Não foi possível tocar o alerta.', error);
    }
  }

  function vibrate(pattern) {
    if (state.settings.vibrationEnabled && navigator.vibrate) navigator.vibrate(pattern);
  }

  function processAlerts(at = nowMs()) {
    const item = currentPart();
    if (!item) return;
    const timer = state.timers[item.id];
    if (timer.runningSince) {
      const remaining = remainingMsFor(item, at);
      if (remaining <= 60_000 && remaining > 30_000 && timer.alarmStage < 1) {
        timer.alarmStage = 1;
        beep('warning');
        vibrate(80);
        markChanged();
      }
      if (remaining <= 30_000 && remaining > 0 && timer.alarmStage < 2) {
        timer.alarmStage = 2;
        beep('warning');
        vibrate([100, 80, 100]);
        markChanged();
      }
      if (remaining <= 0 && timer.alarmStage < 3) {
        timer.alarmStage = 3;
        beep('final');
        vibrate([180, 100, 180, 100, 300]);
        markChanged();
        if (state.settings.autoNextEnabled && currentIndex() < state.parts.length - 1) {
          clearTimeout(autoNextTimeout);
          autoNextTimeout = setTimeout(nextPart, 2500);
        }
      }
    }

    state.parts.forEach((partItem) => {
      const partTimer = state.timers[partItem.id];
      if (partTimer.counselRunningSince && counselElapsedMsFor(partItem.id, at) >= COUNSEL_LIMIT_MS && !partTimer.counselAlarmFired) {
        partTimer.counselAlarmFired = true;
        beep('final');
        vibrate([150, 80, 150]);
        markChanged();
      }
    });
  }

  function scheduleKey() {
    return `${state.scheduledDate}T${state.scheduledStartTime}`;
  }

  function scheduledStartDateTime() {
    const [year, month, day] = state.scheduledDate.split('-').map(Number);
    const [hours, minutes] = state.scheduledStartTime.split(':').map(Number);
    return new Date(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0, 0, 0);
  }

  function formatDateTime(date) {
    const today = localDateValue();
    if (localDateValue(date) === today) return formatClock(date);
    return `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${formatClock(date)}`;
  }

  function processAutomaticMeetingStart(at = nowMs()) {
    if (state.actualStartAt || state.finishedAt) return;
    const now = new Date(at);
    const scheduled = scheduledStartDateTime();
    const key = scheduleKey();
    if (localDateValue(now) !== state.scheduledDate || at < scheduled.getTime() || state.autoStartKey === key) return;
    state.actualStartAt = at;
    state.autoStartKey = key;
    const card = $('clockcard');
    card.classList.add('ring-alert');
    setTimeout(() => card.classList.remove('ring-alert'), 3200);
    beep('final');
    vibrate([150, 80, 150]);
    markChanged({ render: true });
    toast('Início real registrado automaticamente.', 'success');
  }

  function renderMeetingClock(at = nowMs()) {
    const now = new Date(at);
    const scheduled = scheduledStartDateTime();
    const scheduledEnd = new Date(scheduled.getTime() + state.allowedMinutes * 60_000);
    const effectiveNow = state.finishedAt || at;
    const elapsed = state.actualStartAt ? Math.max(0, effectiveNow - state.actualStartAt) : 0;
    const remaining = state.allowedMinutes * 60_000 - elapsed;

    $('liveClock').textContent = now.toLocaleTimeString('pt-BR');
    $('scheduledStartOut').textContent = formatDateTime(scheduled);
    $('actualStartOut').textContent = state.actualStartAt ? formatDateTime(new Date(state.actualStartAt)) : '—';
    $('scheduledEndOut').textContent = formatDateTime(scheduledEnd);
    $('elapsedOut').textContent = state.actualStartAt ? formatDuration(elapsed) : '0min';
    $('remainingOut').textContent = state.actualStartAt
      ? remaining >= 0 ? formatDuration(remaining) : `Excedido ${formatDuration(-remaining)}`
      : formatDuration(state.allowedMinutes * 60_000);
    $('remainingOut').classList.toggle('over', Boolean(state.actualStartAt) && remaining < 0);
    $('clockcard').classList.toggle('overtime', Boolean(state.actualStartAt) && remaining < 0);
    $('clockcard').classList.toggle('finished', Boolean(state.finishedAt));
  }

  function setActualStartNow() {
    state.actualStartAt = nowMs();
    state.finishedAt = null;
    state.autoStartKey = scheduleKey();
    markChanged({ render: true });
    toast('Início real registrado agora.', 'success');
  }

  function openFloat() {
    floatOpen = true;
    $('floatModal').hidden = false;
    syncFloat();
    $('floatClose').focus();
  }

  function closeFloat() {
    floatOpen = false;
    $('floatModal').hidden = true;
  }

  function syncFloat(at = nowMs()) {
    if (!floatOpen) return;
    const item = currentPart();
    if (!item) return;
    const remaining = remainingMsFor(item, at);
    const total = Math.max(1, plannedMs(item));
    const progress = Math.max(0, Math.min(1, remaining / total));
    const circumference = 2 * Math.PI * 98;
    const status = getStatusClass(remaining);
    $('floatWeek').textContent = state.weekLabel;
    $('floatSection').textContent = SECTION_LABELS[item.section];
    const floatResult = evaluationEmoji(state.timers[item.id]?.evaluation);
    $('floatName').textContent = `${item.name}${floatResult ? ` ${floatResult}` : ''}`;
    $('floatSpeaker').textContent = item.speaker ? `🗣️ ${item.speaker}` : '';
    $('floatTime').textContent = formatCountdown(remaining);
    $('floatTime').className = `float-time ${status}`.trim();
    $('floatRingFg').style.strokeDasharray = String(circumference);
    $('floatRingFg').style.strokeDashoffset = String(circumference * (1 - progress));
    $('floatRingFg').className.baseVal = `ring-fg ${status}`.trim();
    $('floatPlay').textContent = currentTimer()?.runningSince ? '■ Parar' : '▶ Continuar';
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return false;
    if (wakeLockSentinel && !wakeLockSentinel.released) return true;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
        updateWakeLockButton();
      });
      updateWakeLockButton();
      return true;
    } catch (error) {
      console.warn('Wake Lock indisponível.', error);
      toast('O navegador não permitiu manter a tela ligada.', 'error');
      return false;
    }
  }

  async function releaseWakeLock() {
    try {
      await wakeLockSentinel?.release();
    } catch {}
    wakeLockSentinel = null;
    updateWakeLockButton();
  }

  function releaseWakeLockIfIdle() {
    if (!isAnyRunning()) releaseWakeLock();
  }

  function updateWakeLockButton() {
    const active = Boolean(wakeLockSentinel && !wakeLockSentinel.released);
    $('wakeLockBtn').textContent = active ? '☀ Tela ligada: ativa' : '☀ Manter tela ligada';
  }

  function normalizeText(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  }

  function parseProgramPlainText(raw) {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const entries = [];
    const usedSongIndexes = new Set();
    const lineSections = [];
    let section = 'neutro';
    let weekLabel = null;

    const isSectionHeading = (normalized) =>
      normalized.includes('TESOUROS DA PALAVRA') ||
      normalized.includes('MELHOR NO MINISTERIO') ||
      normalized.includes('NOSSA VIDA CRISTA');

    const songNumber = (line) => {
      const match = line.match(/C[ÂA]NTICO\s+(\d+)/i);
      return match ? match[1] : null;
    };

    const songWithPrayer = (line) => {
      const number = songNumber(line);
      return number ? `Cântico ${number} e oração` : '';
    };

    for (let index = 0; index < lines.length; index += 1) {
      const normalized = normalizeText(lines[index]);
      if (normalized.includes('TESOUROS DA PALAVRA')) section = 'tesouros';
      else if (normalized.includes('MELHOR NO MINISTERIO')) section = 'ministerio';
      else if (normalized.includes('NOSSA VIDA CRISTA')) section = 'vida';
      lineSections[index] = section;
    }

    const findSong = (from, to, direction = 1) => {
      for (let index = from; direction > 0 ? index <= to : index >= to; index += direction) {
        if (index < 0 || index >= lines.length) continue;
        if (songNumber(lines[index])) return index;
      }
      return -1;
    };

    const findQuestionAfter = (from) => {
      for (let index = from + 1; index < Math.min(lines.length, from + 20); index += 1) {
        const candidate = lines[index];
        const normalized = normalizeText(candidate);
        if (isSectionHeading(normalized) || /\(\d{1,3}\s*min\)/i.test(candidate)) break;
        if (normalized === 'SUA RESPOSTA' || normalized.includes('QUE JOIAS ESPIRITUAIS VOCE ENCONTROU')) continue;
        if (candidate.includes('?')) return candidate;
      }
      return '';
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const normalized = normalizeText(line);

      if (!weekLabel && /\d/.test(line) && /DE\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/.test(normalized) && line.length < 70) {
        weekLabel = line;
      }
      if (isSectionHeading(normalized)) continue;

      const match = line.match(/\((\d{1,3})\s*min\)/i);
      if (!match) continue;

      let minutes = Number(match[1]);
      const before = line.slice(0, match.index).trim();
      const after = line.slice(match.index + match[0].length).replace(/^\s*[|–—-]\s*/, '').trim();
      let title = before;

      if (!title) {
        for (let previous = index - 1; previous >= Math.max(0, index - 6); previous -= 1) {
          const candidate = lines[previous];
          const candidateNormalized = normalizeText(candidate);
          if (isSectionHeading(candidateNormalized) || /\(\d{1,3}\s*min\)/i.test(candidate)) break;
          if (candidateNormalized === 'SUA RESPOSTA' || songNumber(candidate)) continue;
          title = candidate;
          break;
        }
      }

      title ||= 'Parte sem título';
      const normalizedTitle = normalizeText(title);
      const itemSection = lineSections[index] || 'neutro';
      let details = after;
      let finalSection = itemSection;

      if (normalizedTitle.includes('COMENTARIOS INICIAIS')) {
        const songIndex = findSong(index - 1, Math.max(0, index - 8), -1);
        if (songIndex >= 0) usedSongIndexes.add(songIndex);
        title = `${songIndex >= 0 ? songWithPrayer(lines[songIndex]) : 'Cântico e oração'} | Comentários iniciais`;
        minutes = 1;
        finalSection = 'neutro';
      }

      if (normalizedTitle.includes('COMENTARIOS FINAIS')) {
        const songIndex = findSong(index + 1, Math.min(lines.length - 1, index + 8), 1);
        if (songIndex >= 0) usedSongIndexes.add(songIndex);
        title = `Comentários finais | ${songIndex >= 0 ? songWithPrayer(lines[songIndex]) : 'Cântico e oração'}`;
        minutes = 3;
        finalSection = 'neutro';
      }

      const titleNormalizedAfterComposition = normalizeText(title);
      const isJewels = titleNormalizedAfterComposition.includes('JOIAS ESPIRITUAIS');
      if (isJewels) {
        details = findQuestionAfter(index) || after;
      }

      entries.push({
        sourceIndex: index,
        item: part(finalSection, title, minutes, {
          details,
          countComments: isJewels,
          hasCounsel: finalSection === 'ministerio' || titleNormalizedAfterComposition.includes('LEITURA DA BIBLIA')
        })
      });
    }

    lines.forEach((line, index) => {
      if (usedSongIndexes.has(index)) return;
      const number = songNumber(line);
      if (!number || lineSections[index] !== 'vida') return;
      const alreadyIncluded = entries.some((entry) => Math.abs(entry.sourceIndex - index) <= 1 && normalizeText(entry.item.name).includes(`CANTICO ${number}`));
      if (!alreadyIncluded) entries.push({ sourceIndex: index, item: part('vida', `Cântico ${number} (intervalo)`, 3) });
    });

    entries.sort((a, b) => a.sourceIndex - b.sourceIndex);
    return { weekLabel, parts: entries.map((entry) => entry.item) };
  }


  function cleanImportedText(value = '') {
    return String(value)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, ' ')
      .trim();
  }

  function importedAbsoluteUrl(value = '') {
    if (!value) return '';
    try {
      const url = new URL(value, 'https://wol.jw.org');
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function looksLikeProgramHtml(raw) {
    return /<article\b|<div\b[^>]*class=["'][^"']*bodyTxt|<h[1-6]\b/i.test(raw);
  }

  function extractMinutesFromImportedText(value = '') {
    const match = String(value).match(/\((\d{1,3})\s*min\)/i);
    return match ? Number(match[1]) : null;
  }

  function importedSectionFromHeading(value = '') {
    const normalized = normalizeText(value);
    if (normalized.includes('TESOUROS DA PALAVRA')) return 'tesouros';
    if (normalized.includes('MELHOR NO MINISTERIO')) return 'ministerio';
    if (normalized.includes('NOSSA VIDA CRISTA')) return 'vida';
    return null;
  }

  function collectImportedBlockNodes(heading) {
    const nodes = [];
    let cursor = heading.nextElementSibling;
    while (cursor) {
      if (cursor.matches?.('h2,h3') || cursor.querySelector?.('h2,h3')) break;
      nodes.push(cursor);
      cursor = cursor.nextElementSibling;
    }
    return nodes;
  }

  function collectImportedParagraphs(nodes) {
    const result = [];
    const seen = new Set();
    nodes.forEach((node) => {
      const candidates = [];
      if (node.matches?.('p')) candidates.push(node);
      node.querySelectorAll?.('p').forEach((paragraph) => candidates.push(paragraph));
      candidates.forEach((paragraph) => {
        if (seen.has(paragraph)) return;
        seen.add(paragraph);
        const text = cleanImportedText(paragraph.textContent);
        const normalized = normalizeText(text);
        if (!text || normalized === 'SUA RESPOSTA' || /^\(\d{1,3}\s*MIN\)$/i.test(normalized)) return;
        result.push({ element: paragraph, text });
      });
    });
    return result;
  }

  function importedFirstLink(heading, blockNodes, preferredElement = null) {
    const preferred = preferredElement?.querySelector?.('a[href]');
    if (preferred) return importedAbsoluteUrl(preferred.getAttribute('href'));
    const headingLink = heading.querySelector?.('a[href]');
    if (headingLink) return importedAbsoluteUrl(headingLink.getAttribute('href'));
    for (const node of blockNodes) {
      const link = node.querySelector?.('a[href]');
      if (link) return importedAbsoluteUrl(link.getAttribute('href'));
    }
    return '';
  }

  function parseProgramHtml(raw) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const article = doc.querySelector('article#article, article');
    const root = article?.querySelector('.bodyTxt') || article;
    if (!root) return { weekLabel: null, parts: [], mode: 'html' };

    const header = article.querySelector('header');
    const hiddenTitle = doc.querySelector('#contentTitle')?.value || '';
    const week = cleanImportedText(header?.querySelector('h1')?.textContent || hiddenTitle);
    const bibleReading = cleanImportedText(header?.querySelector('h2')?.textContent || '');
    const weekLabel = [week, bibleReading].filter(Boolean).join(' · ');

    const entries = [];
    const headings = Array.from(root.querySelectorAll('h2,h3'));
    let section = 'neutro';

    headings.forEach((heading, headingIndex) => {
      const headingText = cleanImportedText(heading.textContent);
      if (!headingText) return;

      if (heading.tagName === 'H2') {
        section = importedSectionFromHeading(headingText) || section;
        return;
      }
      if (heading.tagName !== 'H3') return;

      const blockNodes = collectImportedBlockNodes(heading);
      const paragraphs = collectImportedParagraphs(blockNodes);
      const combinedText = [headingText, ...blockNodes.map((node) => cleanImportedText(node.textContent))].join(' ');
      const normalizedHeading = normalizeText(headingText);
      const songMatch = headingText.match(/C[âa]ntico\s+(\d+)/i);
      let minutes = extractMinutesFromImportedText(combinedText);
      let title = headingText.replace(/\s*\(\d{1,3}\s*min\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
      let finalSection = section;
      let details = '';
      let preferredLinkElement = null;

      if (normalizedHeading.includes('COMENTARIOS INICIAIS')) {
        minutes = 1;
        finalSection = 'neutro';
        title = title || `${songMatch ? `Cântico ${songMatch[1]} e oração` : 'Cântico e oração'} | Comentários iniciais`;
      } else if (normalizedHeading.includes('COMENTARIOS FINAIS')) {
        minutes = 3;
        finalSection = 'neutro';
        title = title || 'Comentários finais | Cântico e oração';
      } else if (songMatch && minutes === null) {
        if (section === 'vida') {
          entries.push({
            sourceIndex: headingIndex,
            item: part('vida', `Cântico ${songMatch[1]} (intervalo)`, 3, {
              link: importedFirstLink(heading, blockNodes)
            })
          });
        }
        return;
      } else if (minutes === null) {
        return;
      }

      const normalizedTitle = normalizeText(title);
      const isJewels = normalizedTitle.includes('JOIAS ESPIRITUAIS');
      const isReading = normalizedTitle.includes('LEITURA DA BIBLIA');

      if (isJewels) {
        const firstQuestion = paragraphs.find((entry) => {
          const normalized = normalizeText(entry.text);
          return entry.text.includes('?') && !normalized.includes('QUE JOIAS ESPIRITUAIS VOCE ENCONTROU');
        });
        details = firstQuestion?.text || paragraphs[0]?.text || '';
        preferredLinkElement = firstQuestion?.element || null;
      } else {
        const detailParts = [];
        paragraphs.forEach((entry) => {
          let text = entry.text.replace(/^\(\d{1,3}\s*min\)\s*/i, '').trim();
          if (!text || normalizeText(text) === normalizeText(title)) return;
          if (!detailParts.includes(text)) detailParts.push(text);
        });

        const imageDescriptions = [];
        blockNodes.forEach((node) => {
          node.querySelectorAll?.('img[alt]').forEach((image) => {
            const alt = cleanImportedText(image.getAttribute('alt'));
            if (alt && !imageDescriptions.includes(alt)) imageDescriptions.push(alt);
          });
        });
        if (imageDescriptions.length && detailParts.length < 3) {
          detailParts.push(`Imagem: ${imageDescriptions[0]}`);
        }
        details = detailParts.join(' • ');
      }

      const link = importedFirstLink(heading, blockNodes, preferredLinkElement);
      entries.push({
        sourceIndex: headingIndex,
        item: part(finalSection, title, minutes, {
          details,
          link,
          countComments: isJewels,
          hasCounsel: finalSection === 'ministerio' || isReading
        })
      });
    });

    entries.sort((a, b) => a.sourceIndex - b.sourceIndex);
    return { weekLabel, parts: entries.map((entry) => entry.item), mode: 'html' };
  }

  function parseProgramInput(raw) {
    if (looksLikeProgramHtml(raw)) {
      const htmlResult = parseProgramHtml(raw);
      if (htmlResult.parts.length) return htmlResult;
    }
    return { ...parseProgramPlainText(raw), mode: 'texto' };
  }

  function openEditor() {
    editDraft = clone(state.parts);
    $('editor').classList.add('show');
    renderEditor();
    $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeEditor() {
    editDraft = null;
    $('editor').classList.remove('show');
  }

  function renderEditor() {
    const box = $('erows');
    box.textContent = '';
    (editDraft || []).forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'erow';
      row.dataset.index = String(index);
      row.innerHTML = `
        <div class="erow-top">
          <button class="mv" type="button" data-action="up" ${index === 0 ? 'disabled' : ''}>▲</button>
          <button class="mv" type="button" data-action="down" ${index === editDraft.length - 1 ? 'disabled' : ''}>▼</button>
          <select data-field="section">
            <option value="neutro" ${item.section === 'neutro' ? 'selected' : ''}>Abertura/Encerr.</option>
            <option value="tesouros" ${item.section === 'tesouros' ? 'selected' : ''}>Tesouros</option>
            <option value="ministerio" ${item.section === 'ministerio' ? 'selected' : ''}>Ministério</option>
            <option value="vida" ${item.section === 'vida' ? 'selected' : ''}>Vida Cristã</option>
          </select>
          <input class="ename" type="text" data-field="name" value="${esc(item.name)}" placeholder="Nome da parte">
          <input type="number" min="0" data-field="min" value="${item.min}" aria-label="Minutos">
          <label class="clabel"><input type="checkbox" data-field="countComments" ${item.countComments ? 'checked' : ''}> 💬 comentários</label>
          <label class="clabel"><input type="checkbox" data-field="hasCounsel" ${item.hasCounsel ? 'checked' : ''}> ⏱ conselho</label>
          <button class="rm" type="button" data-action="remove" title="Remover">✕</button>
        </div>
        <div class="erow-bottom">
          <input type="text" data-field="speaker" value="${esc(item.speaker)}" placeholder="Nome do orador">
          <textarea data-field="details" placeholder="Detalhes / primeira pergunta de Joias Espirituais">${esc(item.details)}</textarea>
          <input type="url" data-field="link" value="${esc(item.link)}" placeholder="Link de referência">
        </div>`;

      row.querySelectorAll('[data-field]').forEach((input) => {
        const field = input.dataset.field;
        const eventName = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
        input.addEventListener(eventName, () => {
          if (input.type === 'checkbox') item[field] = input.checked;
          else if (field === 'min') item[field] = Math.max(0, Number(input.value) || 0);
          else item[field] = input.value;
        });
      });
      row.querySelector('[data-action="remove"]').addEventListener('click', () => {
        editDraft.splice(index, 1);
        renderEditor();
      });
      row.querySelector('[data-action="up"]').addEventListener('click', () => {
        [editDraft[index - 1], editDraft[index]] = [editDraft[index], editDraft[index - 1]];
        renderEditor();
      });
      row.querySelector('[data-action="down"]').addEventListener('click', () => {
        [editDraft[index + 1], editDraft[index]] = [editDraft[index], editDraft[index + 1]];
        renderEditor();
      });
      box.appendChild(row);
    });
  }

  function saveEditor() {
    if (!editDraft?.length) {
      toast('A programação precisa ter pelo menos uma parte.', 'error');
      return;
    }
    editDraft = editDraft.map((item) => ({
      ...item,
      id: item.id || uid(),
      name: String(item.name || '').trim() || 'Parte sem título',
      min: Math.max(0, Number(item.min) || 0),
      link: safeUrl(item.link)
    }));
    pauseAllParts();
    pauseAllCounsels();
    state.parts = editDraft;
    ensureTimers();
    if (!state.parts.some((item) => item.id === state.currentPartId)) state.currentPartId = state.parts[0].id;
    closeEditor();
    markChanged({ render: true });
    toast('Programação atualizada.', 'success');
  }

  function resetMeeting() {
    if (!confirm('Zerar todos os tempos, comentários e conselhos? A programação, os oradores e o vínculo com a nuvem serão mantidos.')) return;
    const at = nowMs();
    pauseAllParts(null, at);
    pauseAllCounsels(null, at);
    state.meetingId = uid();
    state.actualStartAt = null;
    state.finishedAt = null;
    state.currentPartId = state.parts[0]?.id || null;
    state.timers = Object.fromEntries(state.parts.map((item) => [item.id, timerRecord()]));
    const scheduled = scheduledStartDateTime().getTime();
    state.autoStartKey = localDateValue(new Date(at)) === state.scheduledDate && at >= scheduled ? scheduleKey() : null;
    closeFloat();
    markChanged({ render: true });
    releaseWakeLockIfIdle();
    toast('Reunião zerada. O vínculo online e o histórico foram preservados.', 'success');
  }

  function reportRows(at = nowMs()) {
    return state.parts.map((item, index) => {
      const used = elapsedMsFor(item.id, at);
      const planned = plannedMs(item);
      const timer = state.timers[item.id];
      return {
        ordem: index + 1,
        secao: SECTION_LABELS[item.section],
        parte: item.name,
        detalhes: displayDetails(item),
        orador: item.speaker,
        previstoSegundos: Math.round(planned / 1000),
        usadoSegundos: Math.round(used / 1000),
        diferencaSegundos: Math.round((used - planned) / 1000),
        comentarios: timer.comments,
        conselhoSegundos: Math.round(counselElapsedMsFor(item.id, at) / 1000),
        resultadoTempo: evaluationLabel(timer.evaluation),
        concluida: timer.completed
      };
    });
  }

  function downloadBlob(filename, content, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function fileDate() {
    return localDateValue();
  }

  function createFrozenStateSnapshot(at = nowMs()) {
    const snapshot = clone(state);
    Object.entries(snapshot.timers || {}).forEach(([id, timer]) => {
      timer.elapsedMs = elapsedMsFor(id, at);
      timer.runningSince = null;
      timer.counselElapsedMs = counselElapsedMsFor(id, at);
      timer.counselRunningSince = null;
    });
    snapshot.updatedAt = new Date(at).toISOString();
    return snapshot;
  }

  function cloudStatePayload() {
    return clone(state);
  }

  function backupFilename() {
    const label = state.weekLabel
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .toLowerCase();
    return `backup-cronometro-${label || 'reuniao'}-${fileDate()}.json`;
  }

  function downloadCompleteBackup() {
    const at = nowMs();
    const backup = {
      kind: BACKUP_KIND,
      backupVersion: BACKUP_VERSION,
      appStateVersion: STATE_VERSION,
      exportedAt: new Date(at).toISOString(),
      state: createFrozenStateSnapshot(at),
      history: readHistory()
    };
    downloadBlob(backupFilename(), JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
    toast(`Backup baixado com ${backup.history.length} reunião(ões) no histórico.`, 'success');
  }

  function parseBackupPayload(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('O arquivo não contém um objeto JSON válido.');
    let rawState = null;
    let history = null;
    let format = '';

    if (parsed.kind === BACKUP_KIND) {
      if (Number(parsed.backupVersion) > BACKUP_VERSION) throw new Error('Este backup foi criado por uma versão mais nova do aplicativo.');
      rawState = parsed.state;
      history = parsed.history;
      format = 'backup completo';
    } else if (parsed.state && typeof parsed.state === 'object') {
      rawState = parsed.state;
      history = parsed.history;
      format = 'JSON exportado';
    } else if (Array.isArray(parsed.parts) && parsed.timers && typeof parsed.timers === 'object') {
      rawState = parsed;
      format = 'estado legado';
    }

    if (!rawState || !Array.isArray(rawState.parts) || !rawState.parts.length || !rawState.timers || typeof rawState.timers !== 'object') {
      throw new Error('O arquivo não possui uma reunião válida para restaurar.');
    }

    const normalizedHistory = Array.isArray(history)
      ? history.filter((entry) => entry && typeof entry === 'object' && entry.snapshot && Array.isArray(entry.snapshot.parts)).slice(0, HISTORY_LIMIT)
      : null;
    return { state: normalizeState(rawState), history: normalizedHistory, format };
  }

  async function restoreBackupFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new Error('O arquivo excede o limite de 10 MB.');
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('O arquivo não é um JSON válido.');
    }
    const restored = parseBackupPayload(parsed);
    const historyCount = restored.history?.length ?? readHistory().length;
    const confirmation = [
      `Formato reconhecido: ${restored.format}.`,
      `Reunião: ${restored.state.weekLabel}.`,
      `Partes: ${restored.state.parts.length}.`,
      `Histórico após a restauração: ${historyCount} reunião(ões).`,
      '',
      'Substituir a reunião atual por estes dados?'
    ].join('\n');
    if (!confirm(confirmation)) return false;

    const currentCloud = clone(state.cloud);
    state = restored.state;
    if (cloudUser && currentCloud.meetingId) state.cloud = currentCloud;
    else state.cloud = { meetingId: null, shareCode: null, lastSyncedAt: null };
    if (restored.history) writeHistory(restored.history);
    forceLocalSave();
    renderAll();
    renderHistory();
    releaseWakeLockIfIdle();
    if (cloudUser) {
      await Promise.all([
        state.cloud.meetingId ? saveCloudNow({ silent: true }) : Promise.resolve(false),
        syncLocalHistoryToCloud({ silent: true })
      ]);
    }
    toast('Backup restaurado com sucesso.', 'success');
    return true;
  }

  function exportJSON() {
    const at = nowMs();
    const payload = {
      exportedAt: new Date(at).toISOString(),
      weekLabel: state.weekLabel,
      allowedMinutes: state.allowedMinutes,
      actualStartAt: state.actualStartAt,
      totalPlannedSeconds: Math.round(totalPlannedMs() / 1000),
      totalUsedSeconds: Math.round(totalElapsedMs(at) / 1000),
      rows: reportRows(at),
      state: createFrozenStateSnapshot(at)
    };
    downloadBlob(`reuniao-${fileDate()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  }

  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function exportCSV() {
    const rows = reportRows();
    const headers = Object.keys(rows[0] || {});
    const csv = [headers.map(csvCell).join(';'), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(';'))].join('\n');
    downloadBlob(`reuniao-${fileDate()}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
  }

  async function exportPDF() {
    if (!window.jspdf?.jsPDF) {
      try {
        await loadExternalScript('https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js', () => Boolean(window.jspdf?.jsPDF));
      } catch {
        toast('Não foi possível carregar o gerador de PDF. Verifique a internet.', 'error');
        return;
      }
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const rows = reportRows();
    let y = 18;
    const addHeader = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text('Relatório da Reunião — Vida e Ministério Cristão', 14, y);
      y += 8;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Semana: ${state.weekLabel}`, 14, y); y += 5;
      doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, y); y += 7;
    };
    const tableHeader = () => {
      doc.setFillColor(34, 49, 74);
      doc.rect(14, y - 4.5, 182, 7, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text('PARTE', 16, y);
      doc.text('ORADOR', 98, y);
      doc.text('PREV.', 139, y);
      doc.text('USADO', 157, y);
      doc.text('DIF.', 178, y);
      doc.setTextColor(30, 30, 30);
      doc.setFont('helvetica', 'normal');
      y += 7;
    };
    addHeader();
    tableHeader();
    let lastSection = null;
    rows.forEach((row, index) => {
      const item = state.parts[index];
      if (y > 276) { doc.addPage(); y = 18; tableHeader(); }
      if (item.section !== lastSection) {
        doc.setFillColor(232, 224, 207);
        doc.rect(14, y - 4.5, 182, 6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.text(SECTION_LABELS[item.section].toUpperCase(), 16, y);
        y += 7;
        doc.setFont('helvetica', 'normal');
      }
      lastSection = item.section;
      doc.setFontSize(8.8);
      doc.text(doc.splitTextToSize(item.name, 77)[0], 16, y);
      doc.text(doc.splitTextToSize(item.speaker || '—', 36)[0], 98, y);
      doc.text(formatCountdown(plannedMs(item)), 139, y);
      doc.text(formatCountdown(row.usadoSegundos * 1000), 157, y);
      const diff = row.diferencaSegundos * 1000;
      doc.text(`${diff > 0 ? '+' : diff < 0 ? '-' : ''}${formatCountdown(Math.abs(diff))}`, 178, y);
      y += 5.5;
      if (item.countComments || item.hasCounsel || state.timers[item.id].evaluation) {
        doc.setFontSize(7.8);
        doc.setTextColor(100, 95, 80);
        const notes = [
          item.countComments ? `${row.comentarios} comentário(s)` : '',
          item.hasCounsel ? `conselho ${formatCountdown(row.conselhoSegundos * 1000)}` : '',
          state.timers[item.id].evaluation ? `tempo: ${evaluationLabel(state.timers[item.id].evaluation).toLowerCase()}` : ''
        ].filter(Boolean).join(' · ');
        doc.text(notes, 16, y);
        doc.setTextColor(30, 30, 30);
        y += 4.5;
      }
    });
    y += 3;
    if (y > 270) { doc.addPage(); y = 18; }
    doc.line(14, y, 196, y); y += 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(`Total previsto: ${formatDuration(totalPlannedMs())}`, 14, y); y += 6;
    doc.text(`Total registrado: ${formatDuration(totalElapsedMs())}`, 14, y); y += 6;
    const budgetDifference = state.allowedMinutes * 60_000 - totalElapsedMs();
    doc.setFont('helvetica', 'normal');
    doc.text(budgetDifference >= 0 ? `Folga no tempo disponível: ${formatDuration(budgetDifference)}` : `Tempo disponível excedido: ${formatDuration(-budgetDifference)}`, 14, y);
    doc.save(`relatorio-reuniao-${fileDate()}.pdf`);
  }

  function readHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeHistory(history) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  }

  async function archiveMeeting() {
    const at = nowMs();
    pauseAllParts(null, at);
    pauseAllCounsels(null, at);
    state.finishedAt = at;
    state.parts.forEach((item) => {
      const timer = state.timers[item.id];
      if (elapsedMsFor(item.id, at) > 0) {
        timer.completed = true;
        evaluatePart(item.id, at);
      }
    });

    const history = readHistory();
    const snapshot = createFrozenStateSnapshot(at);
    const historyEntry = {
      id: uid(),
      archivedAt: new Date(at).toISOString(),
      weekLabel: state.weekLabel,
      totalPlannedMs: totalPlannedMs(),
      totalUsedMs: totalElapsedMs(at),
      snapshot
    };
    history.unshift(historyEntry);
    writeHistory(history);
    forceLocalSave();
    renderAll();
    renderHistory();
    releaseWakeLockIfIdle();
    const [stateSynced, historySynced] = await Promise.all([
      saveCloudNow({ silent: true }),
      saveHistoryEntryToCloud(historyEntry)
    ]);
    toast(stateSynced && historySynced ? 'Reunião finalizada, arquivada e sincronizada.' : 'Reunião finalizada e arquivada neste dispositivo.', 'success');
  }

  function renderHistory() {
    const list = $('historyList');
    const history = readHistory();
    list.textContent = '';
    if (!history.length) {
      list.innerHTML = '<div class="history-empty">Nenhuma reunião arquivada.</div>';
      return;
    }
    history.forEach((entry) => {
      const item = document.createElement('article');
      const diff = entry.totalUsedMs - entry.totalPlannedMs;
      item.className = 'history-item';
      item.innerHTML = `
        <div>
          <h3>${esc(entry.weekLabel)}</h3>
          <p>${new Date(entry.archivedAt).toLocaleString('pt-BR')} · previsto ${formatDuration(entry.totalPlannedMs)} · usado ${formatDuration(entry.totalUsedMs)} · ${diff > 0 ? `+${formatDuration(diff)}` : `${formatDuration(-diff)} de folga`}</p>
        </div>
        <div class="history-item-actions">
          <button class="btn-paper" type="button" data-action="restore">Restaurar</button>
          <button class="btn-paper" type="button" data-action="delete">Excluir</button>
        </div>`;
      item.querySelector('[data-action="restore"]').addEventListener('click', async () => {
        if (!confirm('Substituir a reunião atual por esta versão arquivada?')) return;
        const currentCloud = clone(state.cloud);
        state = normalizeState(entry.snapshot);
        if (cloudUser && currentCloud.meetingId) state.cloud = currentCloud;
        forceLocalSave();
        renderAll();
        if (cloudUser && state.cloud.meetingId) await saveCloudNow({ silent: true });
        toast('Reunião restaurada.', 'success');
      });
      item.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm('Excluir esta reunião do histórico?')) return;
        writeHistory(readHistory().filter((historyItem) => historyItem.id !== entry.id));
        renderHistory();
        await deleteHistoryEntryFromCloud(entry.id);
      });
      list.appendChild(item);
    });
  }

  function getPresentationPayload(at = nowMs()) {
    const item = currentPart();
    const index = currentIndex();
    return {
      version: 1,
      updatedAt: new Date(at).toISOString(),
      weekLabel: state.weekLabel,
      shareCode: state.cloud.shareCode,
      current: item ? {
        id: item.id,
        section: SECTION_LABELS[item.section],
        sectionKey: item.section,
        name: item.name,
        speaker: state.settings.showSpeakerOnPresentation ? item.speaker : '',
        plannedMs: plannedMs(item),
        elapsedMs: elapsedMsFor(item.id, at),
        runningSince: state.timers[item.id].runningSince,
        evaluation: state.timers[item.id].evaluation
      } : null,
      next: state.parts[index + 1] ? {
        name: state.parts[index + 1].name,
        speaker: state.settings.showSpeakerOnPresentation ? state.parts[index + 1].speaker : ''
      } : null
    };
  }

  function broadcastPresentation() {
    const payload = getPresentationPayload();
    try { localStorage.setItem(PRESENTATION_KEY, JSON.stringify(payload)); } catch {}
    try { broadcastChannel?.postMessage(payload); } catch {}
    if (presentationRealtimeChannel && presentationRealtimeReady) {
      Promise.resolve(presentationRealtimeChannel.send({
        type: 'broadcast',
        event: 'state',
        payload
      })).catch(() => {});
    }
  }

  function updatePresentationLink() {
    const url = new URL('./presentation.html', document.baseURI);
    if (state.cloud.shareCode) url.searchParams.set('code', state.cloud.shareCode);
    $('presentationLink').href = url.href;
    $('shareCode').value = state.cloud.shareCode || '';
  }

  function randomShareCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    bytes.forEach((byte) => { result += chars[byte % chars.length]; });
    return result;
  }

  function cloudConfigured() {
    const config = window.CRONOMETRO_CONFIG || {};
    return Boolean(config.supabaseUrl && config.supabasePublishableKey);
  }

  function setCloudStatus(message, type = '') {
    $('cloudStatus').textContent = message;
    $('cloudStatus').className = `cloud-status ${type}`.trim();
  }

  function historyEntryToCloudRow(entry) {
    return {
      owner_id: cloudUser.id,
      local_id: String(entry.id),
      archived_at: entry.archivedAt,
      title: entry.weekLabel,
      total_planned_ms: Math.max(0, Math.round(Number(entry.totalPlannedMs) || 0)),
      total_used_ms: Math.max(0, Math.round(Number(entry.totalUsedMs) || 0)),
      snapshot: entry.snapshot
    };
  }

  async function saveHistoryEntryToCloud(entry, { silent = false } = {}) {
    if (!supabaseClient || !cloudUser || !entry?.snapshot) return false;
    const { error } = await supabaseClient
      .from('meeting_archives')
      .upsert(historyEntryToCloudRow(entry), { onConflict: 'owner_id,local_id' });
    if (error) {
      if (!silent) setCloudStatus(`Histórico não sincronizado: ${error.message}`, 'error');
      return false;
    }
    return true;
  }

  async function syncLocalHistoryToCloud({ silent = false } = {}) {
    if (!supabaseClient || !cloudUser) return false;
    const history = readHistory().filter((entry) => entry?.id && entry?.snapshot);
    if (!history.length) return true;
    const { error } = await supabaseClient
      .from('meeting_archives')
      .upsert(history.map(historyEntryToCloudRow), { onConflict: 'owner_id,local_id' });
    if (error) {
      if (!silent) setCloudStatus(`Histórico não sincronizado: ${error.message}`, 'error');
      return false;
    }
    return true;
  }

  async function loadCloudHistory({ silent = false } = {}) {
    if (!supabaseClient || !cloudUser) return false;
    const { data, error } = await supabaseClient
      .from('meeting_archives')
      .select('id, local_id, archived_at, title, total_planned_ms, total_used_ms, snapshot')
      .eq('owner_id', cloudUser.id)
      .order('archived_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) {
      if (!silent) setCloudStatus(`Não foi possível carregar o histórico online: ${error.message}`, 'error');
      return false;
    }

    const merged = new Map(readHistory().map((entry) => [String(entry.id), entry]));
    (data || []).forEach((row) => {
      if (!row?.local_id || !row?.snapshot || !Array.isArray(row.snapshot.parts)) return;
      merged.set(String(row.local_id), {
        id: String(row.local_id),
        cloudId: row.id,
        archivedAt: row.archived_at,
        weekLabel: row.title || 'Reunião arquivada',
        totalPlannedMs: Math.max(0, Number(row.total_planned_ms) || 0),
        totalUsedMs: Math.max(0, Number(row.total_used_ms) || 0),
        snapshot: row.snapshot
      });
    });
    const history = [...merged.values()]
      .sort((a, b) => Date.parse(b.archivedAt || '') - Date.parse(a.archivedAt || ''))
      .slice(0, HISTORY_LIMIT);
    writeHistory(history);
    renderHistory();
    return true;
  }

  async function deleteHistoryEntryFromCloud(localId, { silent = false } = {}) {
    if (!supabaseClient || !cloudUser || !localId) return false;
    const { error } = await supabaseClient
      .from('meeting_archives')
      .delete()
      .eq('owner_id', cloudUser.id)
      .eq('local_id', String(localId));
    if (error) {
      if (!silent) setCloudStatus(`Não foi possível excluir o histórico online: ${error.message}`, 'error');
      return false;
    }
    return true;
  }

  async function initCloud() {
    $('cloudUnavailable').hidden = cloudConfigured();
    $('cloudAvailable').hidden = !cloudConfigured();
    if (!cloudConfigured()) return;

    try {
      await loadExternalScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', () => Boolean(window.supabase?.createClient));
    } catch {
      $('cloudUnavailable').hidden = false;
      $('cloudAvailable').hidden = true;
      $('cloudUnavailable').textContent = 'Não foi possível carregar a biblioteca do Supabase.';
      return;
    }

    const config = window.CRONOMETRO_CONFIG;
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) setCloudStatus(`Falha ao recuperar a sessão: ${error.message}`, 'error');
    await handleCloudSession(data?.session || null, { initial: true });

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        handleCloudSession(session).catch((sessionError) => {
          console.error(sessionError);
          setCloudStatus('Não foi possível atualizar a sessão do Supabase.', 'error');
        });
      }, 0);
    });
  }

  async function handleCloudSession(session, { initial = false } = {}) {
    cloudUser = session?.user || null;
    renderCloudAuth();

    if (!cloudUser) {
      disconnectRealtime();
      if (!initial) setCloudStatus('Sessão encerrada.');
      return;
    }

    if (state.cloud.meetingId) {
      await loadCloudMeeting({ force: false, silent: initial });
      if (!state.cloud.meetingId) await loadLatestCloudMeeting({ silent: initial });
    } else {
      await loadLatestCloudMeeting({ silent: initial });
    }
    await syncLocalHistoryToCloud({ silent: initial });
    await loadCloudHistory({ silent: initial });
    connectRealtime();
  }

  function renderCloudAuth() {
    $('cloudSignedOut').hidden = Boolean(cloudUser);
    $('cloudSignedIn').hidden = !cloudUser;
    $('cloudUserEmail').textContent = cloudUser?.email || '';
    $('createCloudMeetingBtn').textContent = state.cloud.meetingId ? 'Criar nova reunião online' : 'Criar reunião online';
    updatePresentationLink();
  }

  async function sendMagicLink() {
    const email = $('authEmail').value.trim();
    if (!email) return setCloudStatus('Informe um e-mail válido.', 'error');
    setCloudStatus('Enviando link…');
    const redirectTo = new URL('./index.html', document.baseURI).href;
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo }
    });
    if (error) return setCloudStatus(error.message, 'error');
    setCloudStatus('Link enviado. Abra seu e-mail para entrar.', 'success');
  }

  async function logoutCloud() {
    disconnectRealtime();
    const { error } = await supabaseClient.auth.signOut();
    if (error) return setCloudStatus(error.message, 'error');
    setCloudStatus('Sessão encerrada.');
  }

  async function createCloudMeeting() {
    if (!cloudUser) return setCloudStatus('Entre com seu e-mail primeiro.', 'error');
    setCloudStatus('Criando reunião online…');

    let result = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const shareCode = randomShareCode();
      const publicState = getPresentationPayload();
      publicState.shareCode = shareCode;
      const response = await supabaseClient
        .from('meeting_states')
        .insert({
          owner_id: cloudUser.id,
          share_code: shareCode,
          title: state.weekLabel,
          state: cloudStatePayload(),
          public_state: publicState
        })
        .select('id, share_code, updated_at')
        .single();
      if (!response.error) {
        result = response.data;
        break;
      }
      if (response.error.code !== '23505') {
        return setCloudStatus(response.error.message, 'error');
      }
    }

    if (!result) return setCloudStatus('Não foi possível gerar um código exclusivo. Tente novamente.', 'error');

    state.cloud.meetingId = result.id;
    state.cloud.shareCode = result.share_code;
    state.cloud.lastSyncedAt = result.updated_at || new Date().toISOString();
    forceLocalSave({ touch: false });
    renderCloudAuth();
    connectRealtime();
    const saved = await saveCloudNow({ silent: true });
    if (!saved) return;
    broadcastPresentation();
    setCloudStatus('Reunião online criada e sincronizada.', 'success');
  }

  async function loadLatestCloudMeeting({ silent = false } = {}) {
    if (!cloudUser) return false;
    const { data, error } = await supabaseClient
      .from('meeting_states')
      .select('id, share_code, state, updated_at')
      .eq('owner_id', cloudUser.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (!silent) setCloudStatus(`Não foi possível procurar reuniões online: ${error.message}`, 'error');
      return false;
    }
    if (!data) {
      if (!silent) setCloudStatus('Nenhuma reunião online encontrada. Crie a primeira.', 'success');
      return false;
    }

    applyCloudMeetingRecord(data, { force: true });
    if (!silent) setCloudStatus('Reunião online mais recente carregada.', 'success');
    return true;
  }

  function applyCloudMeetingRecord(data, { force = false } = {}) {
    if (!data?.state) return false;
    const remoteUpdatedAt = Date.parse(data.updated_at || '') || 0;
    const localSyncedAt = Date.parse(state.cloud.lastSyncedAt || '') || 0;
    if (!force && remoteUpdatedAt <= localSyncedAt) {
      state.cloud.meetingId = data.id || state.cloud.meetingId;
      state.cloud.shareCode = data.share_code || state.cloud.shareCode;
      renderCloudAuth();
      return false;
    }

    applyingCloudState = true;
    try {
      const cloudMetadata = {
        meetingId: data.id || state.cloud.meetingId,
        shareCode: data.share_code || state.cloud.shareCode,
        lastSyncedAt: data.updated_at || new Date().toISOString()
      };
      state = normalizeState(data.state);
      state.cloud = cloudMetadata;
      forceLocalSave({ touch: false });
      renderAll();
      renderHistory();
      renderCloudAuth();
      return true;
    } finally {
      applyingCloudState = false;
    }
  }

  async function loadCloudMeeting({ force = false, silent = false } = {}) {
    if (!cloudUser || !state.cloud.meetingId) return false;
    const { data, error } = await supabaseClient
      .from('meeting_states')
      .select('id, state, share_code, updated_at')
      .eq('id', state.cloud.meetingId)
      .maybeSingle();
    if (error) {
      if (!silent) setCloudStatus(`Não foi possível carregar a reunião online: ${error.message}`, 'error');
      return false;
    }
    if (!data) {
      state.cloud.meetingId = null;
      state.cloud.shareCode = null;
      state.cloud.lastSyncedAt = null;
      forceLocalSave({ touch: false });
      renderCloudAuth();
      if (!silent) setCloudStatus('A reunião online não existe mais.', 'error');
      return false;
    }

    const changed = applyCloudMeetingRecord(data, { force });
    if (changed && !silent) setCloudStatus('Versão mais recente carregada da nuvem.', 'success');
    return changed;
  }

  function scheduleCloudSave() {
    if (!supabaseClient || !cloudUser || !state.cloud.meetingId || applyingCloudState) return;
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => saveCloudNow(), CLOUD_SAVE_DELAY_MS);
  }

  async function saveCloudNow({ silent = false } = {}) {
    if (!supabaseClient || !cloudUser || !state.cloud.meetingId || applyingCloudState) return false;
    clearTimeout(cloudSaveTimer);
    if (!silent) setCloudStatus('Sincronizando…');

    const publicState = getPresentationPayload();
    publicState.shareCode = state.cloud.shareCode;
    const { data, error } = await supabaseClient
      .from('meeting_states')
      .update({
        title: state.weekLabel,
        state: cloudStatePayload(),
        public_state: publicState
      })
      .eq('id', state.cloud.meetingId)
      .select('updated_at')
      .single();

    if (error) {
      setCloudStatus(error.message, 'error');
      return false;
    }
    state.cloud.lastSyncedAt = data?.updated_at || new Date().toISOString();
    forceLocalSave({ touch: false });
    broadcastPresentation();
    if (!silent) setCloudStatus(`Sincronizado às ${new Date().toLocaleTimeString('pt-BR')}.`, 'success');
    return true;
  }

  function disconnectRealtime() {
    presentationRealtimeReady = false;
    if (presentationRealtimeChannel && supabaseClient) {
      supabaseClient.removeChannel(presentationRealtimeChannel).catch?.(() => {});
    }
    if (meetingRealtimeChannel && supabaseClient) {
      supabaseClient.removeChannel(meetingRealtimeChannel).catch?.(() => {});
    }
    presentationRealtimeChannel = null;
    meetingRealtimeChannel = null;
  }

  function connectRealtime() {
    if (!supabaseClient || !cloudUser || !state.cloud.shareCode || !state.cloud.meetingId) return;
    disconnectRealtime();

    presentationRealtimeChannel = supabaseClient.channel(`presentation:${state.cloud.shareCode}`, {
      config: { broadcast: { self: false, ack: true } }
    });
    presentationRealtimeChannel.subscribe((status) => {
      presentationRealtimeReady = status === 'SUBSCRIBED';
      if (presentationRealtimeReady) broadcastPresentation();
    });

    meetingRealtimeChannel = supabaseClient
      .channel(`meeting-state:${state.cloud.meetingId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'meeting_states',
        filter: `id=eq.${state.cloud.meetingId}`
      }, (payload) => {
        const remoteUpdatedAt = Date.parse(payload.new?.updated_at || '') || 0;
        const localSyncedAt = Date.parse(state.cloud.lastSyncedAt || '') || 0;
        if (remoteUpdatedAt <= localSyncedAt) return;
        loadCloudMeeting({ force: true, silent: true }).catch(console.error);
      })
      .subscribe();
  }

  async function copyPresentationLink() {
    const url = new URL('./presentation.html', document.baseURI);
    if (state.cloud.shareCode) url.searchParams.set('code', state.cloud.shareCode);
    try {
      await navigator.clipboard.writeText(url.href);
      toast('Link da apresentação copiado.', 'success');
    } catch {
      prompt('Copie o link:', url.href);
    }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      registration.update().catch(() => {});
    } catch (error) {
      console.warn('Não foi possível ativar o modo offline.', error);
    }
  }

  function setupEvents() {
    $('playBtn').addEventListener('click', toggleCurrentPart);
    $('resetBtn').addEventListener('click', resetCurrentPart);
    $('nextBtn').addEventListener('click', nextPart);
    $('prevBtn').addEventListener('click', previousPart);
    $('reopenFloatBtn').addEventListener('click', openFloat);
    $('floatClose').addEventListener('click', closeFloat);
    $('floatModal').addEventListener('click', (event) => { if (event.target === $('floatModal')) closeFloat(); });
    $('floatPlay').addEventListener('click', toggleCurrentPart);
    $('floatReset').addEventListener('click', resetCurrentPart);

    $('resetTotalBtn').addEventListener('click', resetMeeting);
    $('importToggle').addEventListener('click', () => showPanel('importer', !$('importer').classList.contains('show')));
    $('cancelImport').addEventListener('click', () => showPanel('importer', false));
    $('programFile').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        $('programFileName').textContent = 'Nenhum arquivo selecionado';
        return;
      }
      $('programFileName').textContent = file.name;
      try {
        $('pasteBox').value = await file.text();
        const mode = looksLikeProgramHtml($('pasteBox').value) ? 'HTML completo detectado' : 'texto simples detectado';
        $('importStatus').textContent = `${mode}. Clique em “Gerar programação”.`;
        $('importStatus').className = 'import-status success';
      } catch (error) {
        console.error(error);
        $('importStatus').textContent = 'Não foi possível ler o arquivo selecionado.';
        $('importStatus').className = 'import-status error';
      }
    });
    $('genBtn').addEventListener('click', () => {
      const raw = $('pasteBox').value;
      if (!raw.trim()) {
        $('importStatus').textContent = 'Cole o texto da apostila antes de gerar.';
        $('importStatus').className = 'import-status error';
        return;
      }
      const parsed = parseProgramInput(raw);
      if (!parsed.parts.length) {
        $('importStatus').textContent = 'Não encontrei uma programação válida. Cole o HTML completo ou um texto que contenha os tempos “(X min)”.';
        $('importStatus').className = 'import-status error';
        return;
      }
      $('importStatus').textContent = parsed.mode === 'html'
        ? 'HTML reconhecido: perguntas, referências e detalhes extraídos.'
        : 'Texto simples reconhecido.';
      $('importStatus').className = 'import-status success';
      pauseAllParts();
      pauseAllCounsels();
      state.parts = parsed.parts;
      state.timers = Object.fromEntries(state.parts.map((item) => [item.id, timerRecord()]));
      state.currentPartId = state.parts[0].id;
      if (parsed.weekLabel) state.weekLabel = parsed.weekLabel;
      $('pasteBox').value = '';
      $('programFile').value = '';
      $('programFileName').textContent = 'Nenhum arquivo selecionado';
      showPanel('importer', false);
      markChanged({ render: true });
      toast(`${parsed.parts.length} partes importadas pelo modo ${parsed.mode === 'html' ? 'HTML completo' : 'texto simples'}.`, 'success');
    });

    $('settingsToggle').addEventListener('click', () => showPanel('settingsPanel', !$('settingsPanel').classList.contains('show')));
    $('closeSettingsBtn').addEventListener('click', () => showPanel('settingsPanel', false));
    ['soundEnabled', 'vibrationEnabled', 'autoFloatEnabled', 'autoNextEnabled', 'showSpeakerOnPresentation'].forEach((id) => {
      $(id).addEventListener('change', () => {
        state.settings[id] = $(id).checked;
        markChanged();
      });
    });
    $('testSoundBtn').addEventListener('click', () => { beep('final'); vibrate([120, 80, 120]); });

    $('wakeLockBtn').addEventListener('click', async () => {
      if (wakeLockSentinel && !wakeLockSentinel.released) await releaseWakeLock();
      else await requestWakeLock();
    });

    $('cloudToggle').addEventListener('click', () => showPanel('cloudPanel', !$('cloudPanel').classList.contains('show')));
    $('closeCloudBtn').addEventListener('click', () => showPanel('cloudPanel', false));
    $('sendMagicLinkBtn').addEventListener('click', sendMagicLink);
    $('logoutBtn').addEventListener('click', logoutCloud);
    $('createCloudMeetingBtn').addEventListener('click', createCloudMeeting);
    $('saveCloudBtn').addEventListener('click', saveCloudNow);
    $('copyShareLinkBtn').addEventListener('click', copyPresentationLink);

    $('editToggle').addEventListener('click', () => $('editor').classList.contains('show') ? closeEditor() : openEditor());
    $('addRow').addEventListener('click', () => {
      editDraft ||= clone(state.parts);
      editDraft.push(part('neutro', 'Nova parte', 5));
      renderEditor();
    });
    $('cancelEdit').addEventListener('click', closeEditor);
    $('saveEdit').addEventListener('click', saveEditor);

    $('pdfBtn').addEventListener('click', exportPDF);
    $('csvBtn').addEventListener('click', exportCSV);
    $('jsonBtn').addEventListener('click', exportJSON);
    $('backupDownloadBtn').addEventListener('click', downloadCompleteBackup);
    $('backupFile').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      try {
        await restoreBackupFile(file);
      } catch (error) {
        console.error(error);
        toast(error.message || 'Não foi possível restaurar o backup.', 'error');
      } finally {
        event.target.value = '';
      }
    });
    $('archiveBtn').addEventListener('click', archiveMeeting);
    $('historyBtn').addEventListener('click', () => { renderHistory(); showPanel('historyPanel', true); });
    $('closeHistoryBtn').addEventListener('click', () => showPanel('historyPanel', false));

    $('weekLabel').addEventListener('input', () => { state.weekLabel = $('weekLabel').value; markChanged(); });
    $('meetingDateInput').addEventListener('change', () => {
      if (!validDateValue($('meetingDateInput').value)) return;
      state.scheduledDate = $('meetingDateInput').value;
      if (!state.actualStartAt) state.autoStartKey = null;
      markChanged({ render: true });
    });
    $('startTimeInput').addEventListener('change', () => {
      state.scheduledStartTime = $('startTimeInput').value;
      if (!state.actualStartAt) state.autoStartKey = null;
      markChanged({ render: true });
    });
    const durationChanged = () => {
      const hours = Math.max(0, Number($('durH').value) || 0);
      const minutes = Math.max(0, Math.min(59, Number($('durM').value) || 0));
      state.allowedMinutes = Math.max(1, Math.floor(hours * 60 + minutes));
      markChanged({ render: true });
    };
    $('durH').addEventListener('input', durationChanged);
    $('durM').addEventListener('input', durationChanged);
    $('startTrigger').addEventListener('click', setActualStartNow);

    document.addEventListener('keydown', (event) => {
      const tag = document.activeElement?.tagName;
      if (event.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) {
        event.preventDefault();
        toggleCurrentPart();
      }
      if (event.key === 'Escape' && floatOpen) closeFloat();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isAnyRunning()) requestWakeLock();
    });
    window.addEventListener('beforeunload', () => { forceLocalSave(); disconnectRealtime(); });
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const remote = normalizeState(JSON.parse(event.newValue));
          if (new Date(remote.updatedAt).getTime() > new Date(state.updatedAt).getTime()) {
            state = remote;
            renderAll();
          }
        } catch {}
      }
    });
  }

  function startRenderLoop() {
    setInterval(() => {
      const at = nowMs();
      processAutomaticMeetingStart(at);
      processAlerts(at);
      updateLightDisplays(at);
      renderMeetingClock(at);
      const second = Math.floor(at / 1000);
      if (second !== lastLightRenderSecond) {
        lastLightRenderSecond = second;
        broadcastPresentation();
      }
      if (isAnyRunning() && second % 5 === 0) forceLocalSave();
    }, 250);
  }

  async function init() {
    ensureTimers();
    setupEvents();
    if ('BroadcastChannel' in window) broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
    processAutomaticMeetingStart(nowMs());
    renderAll();
    registerServiceWorker();
    startRenderLoop();
    await initCloud();
    updateWakeLockButton();
    broadcastPresentation();
  }

  init().catch((error) => {
    console.error(error);
    toast('Ocorreu uma falha ao iniciar o aplicativo. Recarregue a página.', 'error');
  });
})();
