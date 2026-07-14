export function formatDuration(seconds) {
  const rounded = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(rounded / 60).toString().padStart(2, '0');
  const secs = (rounded % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
}

export function formatCountdown(remainingSeconds) {
  const value = Math.round(Number(remainingSeconds) || 0);
  if (value >= 0) return formatDuration(value);
  return `+${formatDuration(Math.abs(value))}`;
}

export function formatHoursMinutes(seconds, { showSign = true } = {}) {
  const value = Math.round(Number(seconds) || 0);
  const totalMinutes = Math.round(Math.abs(value) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const sign = showSign && value < 0 ? '-' : '';
  return `${sign}${hours > 0 ? `${hours}h${minutes.toString().padStart(2, '0')}min` : `${minutes}min`}`;
}

export function formatClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function dateSlug(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function truncate(text, length) {
  const value = String(text ?? '');
  return value.length > length ? `${value.slice(0, Math.max(0, length - 1))}…` : value;
}
