(() => {
  'use strict';

  const STORAGE_KEY = 'cronometro_vida_ministerio_state_v3';
  const HISTORY_KEY = 'cronometro_vida_ministerio_history_v3';
  const PRESENTATION_KEY = 'cronometro_vida_ministerio_presentation_v3';
  const CHANNEL_NAME = 'cronometro_vida_ministerio_channel';
  const STATE_VERSION = 3;
  const COUNSEL_LIMIT_MS = 90_000;
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
      part('neutro', 'Cântico e comentários iniciais', 1),
      part('neutro', 'Oração inicial', 1),
      part('tesouros', '1. Discurso', 10),
      part('tesouros', '2. Joias espirituais', 10, { countComments: true }),
      part('tesouros', '3. Leitura da Bíblia', 4, { hasCounsel: true }),
      part('ministerio', '4. Iniciando conversas', 3, { hasCounsel: true }),
      part('ministerio', '5. Cultivando o interesse', 4, { hasCounsel: true }),
      part('ministerio', '6. Fazendo discípulos', 5, { hasCounsel: true }),
      part('vida', 'Cântico (intervalo)', 3),
      part('vida', '7. Necessidades locais / parte da Vida Cristã', 15),
      part('vida', '8. Estudo bíblico de congregação', 30),
      part('neutro', 'Comentários finais', 2),
      part('neutro', 'Oração final', 1)
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
      counselAlarmFired: false
    };
  }

  function createInitialState() {
    const parts = defaultParts();
    const timers = Object.fromEntries(parts.map((item) => [item.id, timerRecord()]));
    return {
      version: STATE_VERSION,
      meetingId: uid(),
      weekLabel: 'Semana da reunião',
      scheduledStartTime: '19:30',
      allowedMinutes: 105,
      actualStartAt: null,
      currentPartId: parts[0]?.id || null,
      parts,
      timers,
      settings: {
        soundEnabled: true,
        vibrationEnabled: true,
        autoFloatEnabled: false,
        autoNextEnabled: false
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
        runningSince: Number.isFinite(Number(source.runningSince)) ? Number(source.runningSince) : null,
        completed: Boolean(source.completed),
        comments: Math.max(0, Math.floor(Number(source.comments) || 0)),
        alarmStage: Math.max(0, Math.min(3, Math.floor(Number(source.alarmStage) || 0))),
        counselElapsedMs: Math.max(0, Number(source.counselElapsedMs) || 0),
        counselRunningSince: Number.isFinite(Number(source.counselRunningSince)) ? Number(source.counselRunningSince) : null,
        counselAlarmFired: Boolean(source.counselAlarmFired)
      };
    }

    const currentPartId = parts.some((item) => item.id === raw.currentPartId)
      ? raw.currentPartId
      : parts[0]?.id || null;

    return {
      version: STATE_VERSION,
      meetingId: raw.meetingId || uid(),
      weekLabel: String(raw.weekLabel || base.weekLabel),
      scheduledStartTime: /^\d{2}:\d{2}$/.test(raw.scheduledStartTime || '') ? raw.scheduledStartTime : base.scheduledStartTime,
      allowedMinutes: Math.max(1, Math.floor(Number(raw.allowedMinutes) || base.allowedMinutes)),
      actualStartAt: Number.isFinite(Number(raw.actualStartAt)) ? Number(raw.actualStartAt) : null,
      currentPartId,
      parts,
      timers,
      settings: {
        soundEnabled: raw.settings?.soundEnabled !== false,
        vibrationEnabled: raw.settings?.vibrationEnabled !== false,
        autoFloatEnabled: Boolean(raw.settings?.autoFloatEnabled),
        autoNextEnabled: Boolean(raw.settings?.autoNextEnabled)
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
  let realtimeChannel = null;
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

  function forceLocalSave() {
    clearTimeout(saveTimer);
    try {
      state.updatedAt = new Date().toISOString();
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
          <span class="li-check">${timer.completed ? '✓' : ''}</span>
          <div class="li-main">
            <span class="li-name">${esc(item.name)}${item.countComments ? `<span class="li-comment-badge">💬 ${timer.comments}</span>` : ''}</span>
            ${item.details ? `<div class="li-details">${esc(item.details)}${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">🔗 referência</a>` : ''}</div>` : ''}
          </div>
        </div>
        <div class="li-trigger">
          <span class="li-countdown ${getStatusClass(remaining)}" id="cd-${item.id}">${formatCountdown(remaining)}</span>
          <button class="li-playbtn" type="button" data-action="play" title="${running ? 'Pausar' : 'Iniciar'}">${running ? '⏸' : '▶'}</button>
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
    $('partName').textContent = item.name;
    $('partMeta').textContent = `Parte ${index + 1} de ${state.parts.length} · duração prevista: ${item.min} min${item.details ? ` · ${item.details}` : ''}`;
    $('partSpeaker').textContent = item.speaker ? `🗣️ ${item.speaker}` : '';
    $('ringTime').textContent = formatCountdown(remaining);
    $('ringFg').style.strokeDasharray = String(circumference);
    $('ringFg').style.strokeDashoffset = String(circumference * (1 - progress));
    $('ringFg').className.baseVal = `ring-fg ${status}`.trim();
    $('stage').className = `stage ${status}`.trim();
    $('playBtn').textContent = timer.runningSince ? '⏸ Pausar' : (timer.elapsedMs ? '▶ Continuar' : '▶ Iniciar');
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
    $('weekLabel').value = state.weekLabel;
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
    if (play) play.textContent = timer.runningSince ? '⏸' : '▶';

    if (item.hasCounsel) {
      const counselRemaining = COUNSEL_LIMIT_MS - counselElapsedMsFor(item.id, at);
      const counselNode = $(`counsel-time-${item.id}`);
      if (counselNode) {
        counselNode.textContent = formatCountdown(counselRemaining);
        counselNode.className = `lc-time${counselRemaining < 0 ? ' overtime' : ''}`;
      }
    }
  }

  function pausePart(partId) {
    const timer = state.timers[partId];
    if (!timer?.runningSince) return;
    timer.elapsedMs += Math.max(0, nowMs() - timer.runningSince);
    timer.runningSince = null;
  }

  function pauseAllParts(exceptId = null) {
    Object.entries(state.timers).forEach(([id, timer]) => {
      if (id !== exceptId && timer.runningSince) pausePart(id);
    });
  }

  function startCurrentPart() {
    const item = currentPart();
    if (!item) return;
    pauseAllParts(item.id);
    const timer = state.timers[item.id];
    if (timer.runningSince) return;
    timer.runningSince = nowMs();
    timer.completed = false;
    clearTimeout(autoNextTimeout);
    requestWakeLock();
    if (state.settings.autoFloatEnabled) openFloat();
    markChanged({ render: true });
  }

  function pauseCurrentPart() {
    const item = currentPart();
    if (!item) return;
    pausePart(item.id);
    markChanged({ render: true });
    releaseWakeLockIfIdle();
  }

  function toggleCurrentPart() {
    const timer = currentTimer();
    if (!timer) return;
    timer.runningSince ? pauseCurrentPart() : startCurrentPart();
  }

  function resetCurrentPart() {
    const item = currentPart();
    if (!item) return;
    const timer = state.timers[item.id];
    timer.elapsedMs = 0;
    timer.runningSince = null;
    timer.completed = false;
    timer.alarmStage = 0;
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

  function nextPart(auto = false) {
    const index = currentIndex();
    if (index < 0 || index >= state.parts.length - 1) return;
    const timer = currentTimer();
    pauseCurrentPart();
    if (timer) timer.completed = true;
    state.currentPartId = state.parts[index + 1].id;
    markChanged({ render: true });
    if (auto) startCurrentPart();
  }

  function previousPart() {
    const index = currentIndex();
    if (index > 0) jumpToPart(state.parts[index - 1].id);
  }

  function pauseAllCounsels(exceptId = null) {
    const at = nowMs();
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
          autoNextTimeout = setTimeout(() => nextPart(true), 2500);
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

  function scheduledStartDate() {
    const [hours, minutes] = state.scheduledStartTime.split(':').map(Number);
    const date = new Date();
    date.setHours(hours || 0, minutes || 0, 0, 0);
    return date;
  }

  function renderMeetingClock(at = nowMs()) {
    const now = new Date(at);
    const scheduled = scheduledStartDate();
    const effectiveStartMs = state.actualStartAt || scheduled.getTime();
    const end = new Date(effectiveStartMs + state.allowedMinutes * 60_000);
    const elapsed = Math.max(0, at - effectiveStartMs);
    const remaining = state.allowedMinutes * 60_000 - elapsed;

    $('liveClock').textContent = now.toLocaleTimeString('pt-BR');
    $('scheduledStartOut').textContent = formatClock(scheduled);
    $('actualStartOut').textContent = state.actualStartAt ? formatClock(new Date(state.actualStartAt)) : '—';
    $('scheduledEndOut').textContent = formatClock(end);
    $('elapsedOut').textContent = at < effectiveStartMs ? '0min' : formatDuration(elapsed);
    $('remainingOut').textContent = at < effectiveStartMs
      ? formatDuration(state.allowedMinutes * 60_000)
      : remaining >= 0 ? formatDuration(remaining) : `Excedido ${formatDuration(-remaining)}`;
    $('remainingOut').classList.toggle('over', remaining < 0);
    $('clockcard').classList.toggle('overtime', remaining < 0);
  }

  function setActualStartNow() {
    state.actualStartAt = nowMs();
    const now = new Date(state.actualStartAt);
    state.scheduledStartTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    markChanged({ render: true });
    toast('Início real definido como agora.', 'success');
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
    $('floatName').textContent = item.name;
    $('floatSpeaker').textContent = item.speaker ? `🗣️ ${item.speaker}` : '';
    $('floatTime').textContent = formatCountdown(remaining);
    $('floatTime').className = `float-time ${status}`.trim();
    $('floatRingFg').style.strokeDasharray = String(circumference);
    $('floatRingFg').style.strokeDashoffset = String(circumference * (1 - progress));
    $('floatRingFg').className.baseVal = `ring-fg ${status}`.trim();
    $('floatPlay').textContent = currentTimer()?.runningSince ? '⏸ Pausar' : '▶ Continuar';
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

  function parseProgramText(raw) {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const result = [];
    let section = 'neutro';
    let weekLabel = null;
    const used = new Set();

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const normalized = normalizeText(line);

      if (!weekLabel && /\d/.test(line) && /DE\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/.test(normalized) && line.length < 70) {
        weekLabel = line;
      }
      if (normalized.includes('TESOUROS DA PALAVRA')) { section = 'tesouros'; continue; }
      if (normalized.includes('MELHOR NO MINISTERIO')) { section = 'ministerio'; continue; }
      if (normalized.includes('NOSSA VIDA CRISTA')) { section = 'vida'; continue; }

      const match = line.match(/\((\d{1,3})\s*min\)/i);
      if (!match) continue;

      const minutes = Number(match[1]);
      const before = line.slice(0, match.index).trim();
      const after = line.slice(match.index + match[0].length).replace(/^\s*[|–—-]\s*/, '').trim();
      let title = before;

      if (!title) {
        for (let previous = index - 1; previous >= 0; previous -= 1) {
          if (used.has(previous)) continue;
          const candidate = lines[previous];
          const candidateNormalized = normalizeText(candidate);
          if (candidateNormalized.includes('TESOUROS DA PALAVRA') || candidateNormalized.includes('MELHOR NO MINISTERIO') || candidateNormalized.includes('NOSSA VIDA CRISTA')) break;
          if (/\(\d{1,3}\s*min\)/i.test(candidate)) break;
          title = candidate;
          used.add(previous);
          break;
        }
      }

      title ||= 'Parte sem título';
      const normalizedTitle = normalizeText(title);
      result.push(part(section, title, minutes, {
        details: after,
        countComments: normalizedTitle.includes('JOIAS ESPIRITUAIS'),
        hasCounsel: section === 'ministerio' || normalizedTitle.includes('LEITURA DA BIBLIA')
      }));
    }
    return { weekLabel, parts: result };
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
          <textarea data-field="details" placeholder="Detalhes / instruções">${esc(item.details)}</textarea>
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
    if (!confirm('Zerar todos os tempos, comentários e conselhos? A programação e os oradores serão mantidos.')) return;
    pauseAllParts();
    pauseAllCounsels();
    state.meetingId = uid();
    state.actualStartAt = null;
    state.currentPartId = state.parts[0]?.id || null;
    state.timers = Object.fromEntries(state.parts.map((item) => [item.id, timerRecord()]));
    state.cloud.meetingId = null;
    state.cloud.shareCode = null;
    state.cloud.lastSyncedAt = null;
    closeFloat();
    markChanged({ render: true });
    toast('Reunião zerada e pronta para novo uso.', 'success');
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
        orador: item.speaker,
        previstoSegundos: Math.round(planned / 1000),
        usadoSegundos: Math.round(used / 1000),
        diferencaSegundos: Math.round((used - planned) / 1000),
        comentarios: timer.comments,
        conselhoSegundos: Math.round(counselElapsedMsFor(item.id, at) / 1000),
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
    return new Date().toISOString().slice(0, 10);
  }

  function exportJSON() {
    const payload = {
      exportedAt: new Date().toISOString(),
      weekLabel: state.weekLabel,
      allowedMinutes: state.allowedMinutes,
      actualStartAt: state.actualStartAt,
      totalPlannedSeconds: Math.round(totalPlannedMs() / 1000),
      totalUsedSeconds: Math.round(totalElapsedMs() / 1000),
      rows: reportRows(),
      state
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
      if (item.countComments || item.hasCounsel) {
        doc.setFontSize(7.8);
        doc.setTextColor(100, 95, 80);
        const notes = [
          item.countComments ? `${row.comentarios} comentário(s)` : '',
          item.hasCounsel ? `conselho ${formatCountdown(row.conselhoSegundos * 1000)}` : ''
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
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 30)));
  }

  function archiveMeeting() {
    const history = readHistory();
    const snapshot = clone(state);
    Object.entries(snapshot.timers).forEach(([id, timer]) => {
      timer.elapsedMs = elapsedMsFor(id);
      timer.runningSince = null;
      timer.counselElapsedMs = counselElapsedMsFor(id);
      timer.counselRunningSince = null;
    });
    history.unshift({
      id: uid(),
      archivedAt: new Date().toISOString(),
      weekLabel: state.weekLabel,
      totalPlannedMs: totalPlannedMs(),
      totalUsedMs: totalElapsedMs(),
      snapshot
    });
    writeHistory(history);
    renderHistory();
    toast('Reunião arquivada no histórico local.', 'success');
    saveCloudNow();
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
      item.querySelector('[data-action="restore"]').addEventListener('click', () => {
        if (!confirm('Substituir a reunião atual por esta versão arquivada?')) return;
        state = normalizeState(entry.snapshot);
        forceLocalSave();
        renderAll();
        toast('Reunião restaurada.', 'success');
      });
      item.querySelector('[data-action="delete"]').addEventListener('click', () => {
        writeHistory(readHistory().filter((historyItem) => historyItem.id !== entry.id));
        renderHistory();
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
        speaker: item.speaker,
        plannedMs: plannedMs(item),
        elapsedMs: elapsedMsFor(item.id, at),
        runningSince: state.timers[item.id].runningSince
      } : null,
      next: state.parts[index + 1] ? {
        name: state.parts[index + 1].name,
        speaker: state.parts[index + 1].speaker
      } : null
    };
  }

  function broadcastPresentation() {
    const payload = getPresentationPayload();
    try { localStorage.setItem(PRESENTATION_KEY, JSON.stringify(payload)); } catch {}
    try { broadcastChannel?.postMessage(payload); } catch {}
    if (realtimeChannel) {
      realtimeChannel.send({ type: 'broadcast', event: 'state', payload }).catch?.(() => {});
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

    const { data } = await supabaseClient.auth.getSession();
    cloudUser = data.session?.user || null;
    renderCloudAuth();
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      cloudUser = session?.user || null;
      renderCloudAuth();
      if (cloudUser && state.cloud.meetingId) connectRealtime();
    });
    if (cloudUser && state.cloud.meetingId) {
      await loadCloudMeeting();
      connectRealtime();
    }
  }

  function renderCloudAuth() {
    $('cloudSignedOut').hidden = Boolean(cloudUser);
    $('cloudSignedIn').hidden = !cloudUser;
    $('cloudUserEmail').textContent = cloudUser?.email || '';
    $('createCloudMeetingBtn').textContent = state.cloud.meetingId ? 'Recriar reunião online' : 'Criar reunião online';
    updatePresentationLink();
  }

  async function sendMagicLink() {
    const email = $('authEmail').value.trim();
    if (!email) return setCloudStatus('Informe um e-mail válido.', 'error');
    setCloudStatus('Enviando link…');
    const redirectTo = new URL('./index.html', document.baseURI).href;
    const { error } = await supabaseClient.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) return setCloudStatus(error.message, 'error');
    setCloudStatus('Link enviado. Abra seu e-mail para entrar.', 'success');
  }

  async function logoutCloud() {
    await supabaseClient.auth.signOut();
    setCloudStatus('Sessão encerrada.');
  }

  async function createCloudMeeting() {
    if (!cloudUser) return setCloudStatus('Entre com seu e-mail primeiro.', 'error');
    const shareCode = randomShareCode();
    setCloudStatus('Criando reunião online…');
    const cloudState = clone(state);
    const { data, error } = await supabaseClient
      .from('meeting_states')
      .insert({ owner_id: cloudUser.id, share_code: shareCode, title: state.weekLabel, state: cloudState })
      .select('id, share_code')
      .single();
    if (error) return setCloudStatus(error.message, 'error');
    state.cloud.meetingId = data.id;
    state.cloud.shareCode = data.share_code;
    state.cloud.lastSyncedAt = new Date().toISOString();
    forceLocalSave();
    renderCloudAuth();
    connectRealtime();
    broadcastPresentation();
    setCloudStatus('Reunião online criada e sincronizada.', 'success');
  }

  async function loadCloudMeeting() {
    if (!cloudUser || !state.cloud.meetingId) return;
    const { data, error } = await supabaseClient
      .from('meeting_states')
      .select('state, share_code, updated_at')
      .eq('id', state.cloud.meetingId)
      .single();
    if (error) {
      setCloudStatus(`Não foi possível carregar a reunião online: ${error.message}`, 'error');
      return;
    }
    if (data?.state && new Date(data.updated_at).getTime() > new Date(state.updatedAt).getTime()) {
      const localCloud = { ...state.cloud, shareCode: data.share_code };
      state = normalizeState(data.state);
      state.cloud = localCloud;
      forceLocalSave();
      renderAll();
      setCloudStatus('Versão mais recente carregada da nuvem.', 'success');
    }
  }

  function scheduleCloudSave() {
    if (!supabaseClient || !cloudUser || !state.cloud.meetingId) return;
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(saveCloudNow, CLOUD_SAVE_DELAY_MS);
  }

  async function saveCloudNow() {
    if (!supabaseClient || !cloudUser || !state.cloud.meetingId) return;
    clearTimeout(cloudSaveTimer);
    setCloudStatus('Sincronizando…');
    const cloudState = clone(state);
    const { error } = await supabaseClient
      .from('meeting_states')
      .update({ title: state.weekLabel, state: cloudState })
      .eq('id', state.cloud.meetingId);
    if (error) return setCloudStatus(error.message, 'error');
    state.cloud.lastSyncedAt = new Date().toISOString();
    forceLocalSave();
    broadcastPresentation();
    setCloudStatus(`Sincronizado às ${new Date().toLocaleTimeString('pt-BR')}.`, 'success');
  }

  function connectRealtime() {
    if (!supabaseClient || !state.cloud.shareCode) return;
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = supabaseClient.channel(`presentation:${state.cloud.shareCode}`);
    realtimeChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') broadcastPresentation();
    });
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

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
    }
  }

  function setupEvents() {
    $('playBtn').addEventListener('click', toggleCurrentPart);
    $('resetBtn').addEventListener('click', resetCurrentPart);
    $('nextBtn').addEventListener('click', () => nextPart(false));
    $('prevBtn').addEventListener('click', previousPart);
    $('reopenFloatBtn').addEventListener('click', openFloat);
    $('floatClose').addEventListener('click', closeFloat);
    $('floatModal').addEventListener('click', (event) => { if (event.target === $('floatModal')) closeFloat(); });
    $('floatPlay').addEventListener('click', toggleCurrentPart);
    $('floatReset').addEventListener('click', resetCurrentPart);

    $('resetTotalBtn').addEventListener('click', resetMeeting);
    $('importToggle').addEventListener('click', () => showPanel('importer', !$('importer').classList.contains('show')));
    $('cancelImport').addEventListener('click', () => showPanel('importer', false));
    $('genBtn').addEventListener('click', () => {
      const raw = $('pasteBox').value;
      if (!raw.trim()) {
        $('importStatus').textContent = 'Cole o texto da apostila antes de gerar.';
        $('importStatus').className = 'import-status error';
        return;
      }
      const parsed = parseProgramText(raw);
      if (!parsed.parts.length) {
        $('importStatus').textContent = 'Não encontrei partes com “(X min)”. Confira o texto colado.';
        $('importStatus').className = 'import-status error';
        return;
      }
      pauseAllParts();
      pauseAllCounsels();
      state.parts = parsed.parts;
      state.timers = Object.fromEntries(state.parts.map((item) => [item.id, timerRecord()]));
      state.currentPartId = state.parts[0].id;
      if (parsed.weekLabel) state.weekLabel = parsed.weekLabel;
      $('pasteBox').value = '';
      showPanel('importer', false);
      markChanged({ render: true });
      toast(`${parsed.parts.length} partes importadas. Revise os títulos no editor.`, 'success');
    });

    $('settingsToggle').addEventListener('click', () => showPanel('settingsPanel', !$('settingsPanel').classList.contains('show')));
    $('closeSettingsBtn').addEventListener('click', () => showPanel('settingsPanel', false));
    ['soundEnabled', 'vibrationEnabled', 'autoFloatEnabled', 'autoNextEnabled'].forEach((id) => {
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
    $('archiveBtn').addEventListener('click', archiveMeeting);
    $('historyBtn').addEventListener('click', () => { renderHistory(); showPanel('historyPanel', true); });
    $('closeHistoryBtn').addEventListener('click', () => showPanel('historyPanel', false));

    $('weekLabel').addEventListener('input', () => { state.weekLabel = $('weekLabel').value; markChanged(); });
    $('startTimeInput').addEventListener('change', () => { state.scheduledStartTime = $('startTimeInput').value; markChanged({ render: true }); });
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
    window.addEventListener('beforeunload', forceLocalSave);
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
