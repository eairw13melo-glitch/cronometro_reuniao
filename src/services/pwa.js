let deferredPrompt = null;
const listeners = new Set();

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  listeners.forEach((listener) => listener(true));
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  listeners.forEach((listener) => listener(false));
});

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return null;
  try {
    const baseUrl = import.meta.env.BASE_URL || '/';
    return await navigator.serviceWorker.register(`${baseUrl}service-worker.js`, {
      scope: baseUrl,
    });
  } catch (error) {
    console.warn('Service worker não pôde ser registrado.', error);
    return null;
  }
}

export function onInstallAvailability(listener) {
  listeners.add(listener);
  listener(Boolean(deferredPrompt));
  return () => listeners.delete(listener);
}

export async function installApp() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach((listener) => listener(false));
  return true;
}
