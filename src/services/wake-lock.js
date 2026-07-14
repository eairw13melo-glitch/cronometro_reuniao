let sentinel = null;
let desired = false;

export async function requestWakeLock() {
  desired = true;
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return false;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
    return true;
  } catch (error) {
    console.warn('Wake Lock indisponível.', error);
    return false;
  }
}

export async function releaseWakeLock() {
  desired = false;
  try {
    await sentinel?.release();
  } catch (error) {
    console.warn('Falha ao liberar Wake Lock.', error);
  } finally {
    sentinel = null;
  }
}

export function wakeLockActive() {
  return Boolean(sentinel && !sentinel.released);
}

document.addEventListener('visibilitychange', () => {
  if (desired && document.visibilityState === 'visible' && !wakeLockActive()) requestWakeLock();
});
