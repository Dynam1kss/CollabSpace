import { useEffect, useState } from 'react';
import { isDismissedRecently, isIosSafari, pickInstallBanner } from './install-rules';

// у lib.dom цього типу нема — лише хроміум його шле
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'install-banner-dismissed-at';

// подію ловимо ще при завантаженні модуля: хром шле її одразу після load,
// і сторінка входу може змонтуватись пізніше
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  // без цього хром покаже свою міні-плашку поверх нашої
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  notify();
});

function readDismissedAt() {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // приватний режим — ну покажемо ще раз
  }
}

function isStandalone() {
  // navigator.standalone — лише сафарі, display-mode там не спрацьовує
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function InstallBanner() {
  const [hasPromptEvent, setHasPromptEvent] = useState(deferredPrompt !== null);
  const [dismissed, setDismissed] = useState(() => isDismissedRecently(readDismissedAt(), Date.now()));

  useEffect(() => {
    const sync = () => setHasPromptEvent(deferredPrompt !== null);
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const kind = pickInstallBanner({
    standalone: isStandalone(),
    dismissed,
    hasPromptEvent,
    iosSafari: isIosSafari(navigator.userAgent, navigator.maxTouchPoints),
  });
  if (!kind) return null;

  function dismiss() {
    rememberDismissed();
    setDismissed(true);
  }

  async function install() {
    const event = deferredPrompt;
    if (!event) return;
    // prompt() одноразовий — повторно той самий евент кине помилку
    deferredPrompt = null;
    notify();
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'dismissed') dismiss();
  }

  return (
    <aside className="install-banner" role="status">
      {kind === 'prompt' ? (
        <>
          <span className="install-banner-text">
            Встановіть CollabSpace як застосунок — на весь екран і з іконкою
          </span>
          <button type="button" className="button-primary" onClick={() => void install()}>
            Встановити
          </button>
        </>
      ) : (
        <span className="install-banner-text">
          Щоб встановити застосунок: натисніть «Поділитися», потім «На екран Домівки»
        </span>
      )}
      <button type="button" className="install-banner-close" aria-label="Закрити" onClick={dismiss}>
        ×
      </button>
    </aside>
  );
}
