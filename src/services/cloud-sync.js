import { normalizeState } from '../core/state.js';
import { supabase, supabaseConfigured } from './supabase-client.js';

function meetingRow(state, userId) {
  return {
    id: state.meetingId || undefined,
    owner_id: userId,
    week_label: state.weekLabel,
    scheduled_start: state.settings.meetingStartIso,
    allowed_minutes: state.settings.allowedMinutes,
    status: state.status,
    share_code: state.shareCode,
    share_enabled: state.shareEnabled,
    current_part_index: state.runtime.current,
    updated_at: state.updatedAt,
  };
}

export async function saveMeetingOnline(state, user) {
  if (!supabaseConfigured || !supabase || !user || !navigator.onLine) return { skipped: true };

  let meetingId = state.meetingId;
  if (!meetingId) {
    const { data, error } = await supabase
      .from('meetings')
      .insert(meetingRow(state, user.id))
      .select('id, share_code')
      .single();
    if (error) throw error;
    meetingId = data.id;
    state.meetingId = data.id;
    state.shareCode = data.share_code || state.shareCode;
  } else {
    const { error } = await supabase
      .from('meetings')
      .update(meetingRow(state, user.id))
      .eq('id', meetingId);
    if (error) throw error;
  }

  const partRows = state.parts.map((part, position) => ({
    meeting_id: meetingId,
    client_id: part.id,
    position,
    section: part.section,
    name: part.name,
    speaker: part.speaker,
    planned_seconds: Math.round(part.min * 60),
    details: part.details,
    reference_url: part.link || null,
    count_comments: part.countComments,
    has_counsel: part.hasCounsel,
  }));

  const { error: deleteError } = await supabase.from('meeting_parts').delete().eq('meeting_id', meetingId);
  if (deleteError) throw deleteError;
  if (partRows.length) {
    const { error: partsError } = await supabase.from('meeting_parts').insert(partRows);
    if (partsError) throw partsError;
  }

  const snapshot = { ...state, meetingId };
  const { error: stateError } = await supabase.from('meeting_states').upsert({
    meeting_id: meetingId,
    snapshot,
    updated_at: state.updatedAt,
  }, { onConflict: 'meeting_id' });
  if (stateError) throw stateError;

  return { meetingId };
}

export async function listOnlineMeetings(user, limit = 30) {
  if (!supabase || !user) return [];
  const { data, error } = await supabase
    .from('meetings')
    .select('id, week_label, scheduled_start, allowed_minutes, status, share_code, share_enabled, updated_at, meeting_states(snapshot)')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function loadOnlineMeeting(meetingId) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase
    .from('meeting_states')
    .select('snapshot')
    .eq('meeting_id', meetingId)
    .single();
  if (error) throw error;
  return normalizeState(data.snapshot);
}

export async function markMeetingCompleted(state, user) {
  if (!supabase || !user || !state.meetingId) return;
  state.status = 'completed';
  await saveMeetingOnline(state, user);
}

export async function findSharedMeeting(code) {
  if (!supabase) throw new Error('Supabase não configurado.');
  const normalizedCode = String(code || '').trim().toUpperCase();
  const { data, error } = await supabase.rpc('get_shared_meeting', { p_code: normalizedCode });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.snapshot) throw new Error('Reunião compartilhada não encontrada.');
  return { meeting: { id: row.meeting_id, week_label: row.week_label, share_code: normalizedCode }, state: normalizeState(row.snapshot) };
}

const realtimeChannels = new Map();
const realtimeReady = new Map();

function getBroadcastChannel(code) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode || !supabase) return null;
  if (!realtimeChannels.has(normalizedCode)) {
    realtimeChannels.set(normalizedCode, supabase.channel(`meeting:${normalizedCode}`));
  }
  return realtimeChannels.get(normalizedCode);
}

export async function broadcastSharedState(state) {
  if (!supabase || !navigator.onLine || !state.shareEnabled || !state.shareCode) return false;
  const code = String(state.shareCode).trim().toUpperCase();
  const channel = getBroadcastChannel(code);
  if (!channel) return false;
  if (channel.state !== 'joined') {
    if (!realtimeReady.has(code)) {
      realtimeReady.set(code, new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          realtimeReady.delete(code);
          reject(new Error('Tempo esgotado ao conectar ao canal.'));
        }, 5000);
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timeout);
            resolve();
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timeout);
            realtimeReady.delete(code);
            reject(new Error('Falha no canal em tempo real.'));
          }
        });
      }));
    }
    await realtimeReady.get(code);
  }
  const response = await channel.send({ type: 'broadcast', event: 'state', payload: { state } });
  return response === 'ok';
}

export function subscribeSharedState(code, onState) {
  const channel = getBroadcastChannel(code);
  if (!channel) return () => {};
  channel.on('broadcast', { event: 'state' }, ({ payload }) => {
    if (payload?.state) onState(normalizeState(payload.state));
  }).subscribe();
  return () => {
    const normalizedCode = String(code || '').trim().toUpperCase();
    realtimeChannels.delete(normalizedCode);
    realtimeReady.delete(normalizedCode);
    supabase.removeChannel(channel);
  };
}
