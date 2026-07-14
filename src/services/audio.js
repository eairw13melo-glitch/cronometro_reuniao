let audioContext = null;

function getContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

export function playAlert(pattern = 'end', enabled = true) {
  if (!enabled) return;
  try {
    const context = getContext();
    if (!context) return;
    const frequencies = pattern === 'warning' ? [660] : pattern === 'start' ? [520, 660] : [880, 880, 880];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startAt = context.currentTime + index * 0.32;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.14, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.23);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.25);
    });
  } catch (error) {
    console.warn('Alerta sonoro indisponível.', error);
  }
}

export function vibrateAlert(pattern = 'end', enabled = true) {
  if (!enabled || !navigator.vibrate) return;
  const vibration = pattern === 'warning' ? [120] : pattern === 'start' ? [100, 80, 100] : [180, 100, 180, 100, 180];
  navigator.vibrate(vibration);
}
