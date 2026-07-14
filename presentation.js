(() => {
  'use strict';

  const PRESENTATION_KEY = 'cronometro_vida_ministerio_presentation_v3';
  const CHANNEL_NAME = 'cronometro_vida_ministerio_channel';
  const $ = (id) => document.getElementById(id);

  function loadExternalScript(src, globalCheck) {
    if (globalCheck?.()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  let payload = null;
  let broadcastChannel = null;
  let supabaseClient = null;
  let realtimeChannel = null;
  let wakeLockSentinel = null;
  let remoteCode = new URLSearchParams(location.search).get('code')?.toUpperCase() || '';

  function formatCountdown(ms) {
    const over = ms < 0;
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${over ? '+' : ''}${minutes}:${seconds}`;
  }

  function currentElapsedMs(at = Date.now()) {
    if (!payload?.current) return 0;
    const base = Number(payload.current.elapsedMs) || 0;
    const runningSince = Number(payload.current.runningSince) || 0;
    return base + (runningSince ? Math.max(0, at - runningSince) : 0);
  }

  function render(at = Date.now()) {
    if (!payload?.current) {
      $('presentationTime').textContent = '00:00';
      return;
    }
    const remaining = Number(payload.current.plannedMs || 0) - currentElapsedMs(at);
    $('presentationWeek').textContent = payload.weekLabel || '';
    $('presentationCode').textContent = payload.shareCode ? `Código: ${payload.shareCode}` : '';
    $('presentationSection').textContent = payload.current.section || '—';
    $('presentationName').textContent = payload.current.name || 'Aguardando a reunião';
    $('presentationSpeaker').textContent = payload.current.speaker ? `🗣️ ${payload.current.speaker}` : '';
    $('presentationTime').textContent = formatCountdown(remaining);
    $('presentationTime').className = `presentation-time${remaining <= 0 ? ' overtime' : remaining <= 60_000 ? ' warning' : ''}`;
    $('presentationNext').textContent = payload.next ? `Próxima: ${payload.next.name}${payload.next.speaker ? ` — ${payload.next.speaker}` : ''}` : 'Última parte da programação';
  }

  function acceptPayload(nextPayload) {
    if (!nextPayload?.current) return;
    payload = nextPayload;
    render();
    $('presentationStatus').textContent = 'Sincronizado.';
  }

  function loadLocal() {
    try {
      const stored = JSON.parse(localStorage.getItem(PRESENTATION_KEY));
      if (stored) acceptPayload(stored);
    } catch {}
  }

  function cloudConfigured() {
    const config = window.CRONOMETRO_CONFIG || {};
    return Boolean(config.supabaseUrl && config.supabasePublishableKey);
  }

  async function connectRemote(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) {
      $('presentationStatus').textContent = 'Informe o código da reunião.';
      return;
    }
    if (!cloudConfigured()) {
      $('presentationStatus').textContent = 'Supabase ainda não está configurado em config.js.';
      return;
    }

    remoteCode = normalized;
    $('codeInput').value = normalized;
    $('presentationStatus').textContent = 'Conectando…';
    try {
      await loadExternalScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', () => Boolean(window.supabase?.createClient));
    } catch {
      $('presentationStatus').textContent = 'Não foi possível carregar a biblioteca do Supabase.';
      return;
    }
    const config = window.CRONOMETRO_CONFIG;
    supabaseClient ||= window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);

    const { data, error } = await supabaseClient.rpc('get_shared_meeting', { p_code: normalized });
    if (error) {
      $('presentationStatus').textContent = error.message;
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.state) {
      $('presentationStatus').textContent = 'Código não encontrado.';
      return;
    }
    const cloudState = row.state;
    const current = cloudState.parts?.find((item) => item.id === cloudState.currentPartId);
    const currentIndex = cloudState.parts?.findIndex((item) => item.id === cloudState.currentPartId) ?? -1;
    const timer = cloudState.timers?.[cloudState.currentPartId];
    if (current && timer) {
      acceptPayload({
        weekLabel: cloudState.weekLabel,
        shareCode: normalized,
        current: {
          id: current.id,
          section: ({ neutro: 'Abertura / Encerramento', tesouros: 'Tesouros da Palavra de Deus', ministerio: 'Faça seu Melhor no Ministério', vida: 'Nossa Vida Cristã' })[current.section],
          name: current.name,
          speaker: current.speaker,
          plannedMs: Number(current.min || 0) * 60_000,
          elapsedMs: Number(timer.elapsedMs || 0),
          runningSince: timer.runningSince
        },
        next: cloudState.parts?.[currentIndex + 1] ? {
          name: cloudState.parts[currentIndex + 1].name,
          speaker: cloudState.parts[currentIndex + 1].speaker
        } : null
      });
    }

    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = supabaseClient
      .channel(`presentation:${normalized}`)
      .on('broadcast', { event: 'state' }, ({ payload: nextPayload }) => acceptPayload(nextPayload));
    realtimeChannel.subscribe((status) => {
      $('presentationStatus').textContent = status === 'SUBSCRIBED' ? 'Conectado à reunião online.' : `Conexão: ${status}`;
    });
    const url = new URL(location.href);
    url.searchParams.set('code', normalized);
    history.replaceState(null, '', url);
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else await document.exitFullscreen?.();
  }

  async function toggleWakeLock() {
    if (!('wakeLock' in navigator)) {
      $('keepAwakeBtn').textContent = 'Wake Lock indisponível';
      return;
    }
    if (wakeLockSentinel && !wakeLockSentinel.released) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
      $('keepAwakeBtn').textContent = '☀ Tela ligada';
      return;
    }
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      $('keepAwakeBtn').textContent = '☀ Tela ligada: ativa';
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
        $('keepAwakeBtn').textContent = '☀ Tela ligada';
      });
    } catch {
      $('keepAwakeBtn').textContent = 'Wake Lock bloqueado';
    }
  }

  function init() {
    loadLocal();
    if ('BroadcastChannel' in window) {
      broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
      broadcastChannel.addEventListener('message', (event) => acceptPayload(event.data));
    }
    window.addEventListener('storage', (event) => {
      if (event.key === PRESENTATION_KEY && event.newValue) {
        try { acceptPayload(JSON.parse(event.newValue)); } catch {}
      }
    });
    $('connectBtn').addEventListener('click', () => connectRemote($('codeInput').value));
    $('codeInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') connectRemote($('codeInput').value); });
    $('fullscreenBtn').addEventListener('click', toggleFullscreen);
    $('keepAwakeBtn').addEventListener('click', toggleWakeLock);
    $('closeConnectBtn').addEventListener('click', () => { $('presentationConnect').hidden = true; });
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && !wakeLockSentinel && 'wakeLock' in navigator) {
        try {
          wakeLockSentinel = await navigator.wakeLock.request('screen');
          $('keepAwakeBtn').textContent = '☀ Tela ligada: ativa';
        } catch {}
      }
    });
    $('codeInput').value = remoteCode;
    if (remoteCode) connectRemote(remoteCode);
    setInterval(() => render(Date.now()), 250);
  }

  init();
})();
