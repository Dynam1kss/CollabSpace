import { useEffect, useState } from 'react';
import type { InstallBannerKind } from './install-rules';
import { detectInstallPath, pickInstallBanner } from './install-rules';

// у lib.dom цього типу нема — лише хроміум його шле
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// подію ловимо ще при завантаженні модуля: хром шле її одразу після load,
// і сторінка входу може змонтуватись пізніше
let deferredPrompt: BeforeInstallPromptEvent | null = null;
// щойно встановили з цієї ж вкладки — display-mode тут ще browser, тож
// пам'ятаємо окремо
let installedHere = false;
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
  installedHere = true;
  notify();
});

const STANDALONE_QUERY = '(display-mode: standalone)';

function isStandalone() {
  // navigator.standalone — лише сафарі, display-mode там не спрацьовує
  return (
    installedHere ||
    window.matchMedia(STANDALONE_QUERY).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const TEXT: Record<Exclude<InstallBannerKind, 'prompt'>, string> = {
  'browser-menu': 'Відкрийте меню браузера і оберіть «Встановити застосунок» або «Додати на головний екран»',
  ios: 'Щоб встановити застосунок: натисніть «Поділитися», потім «На екран Домівки»',
  generic:
    'CollabSpace можна встановити як застосунок — пошукайте в меню браузера «Встановити» чи «Додати на головний екран»',
};

// без «закрити» навмисно: це єдине місце, де людина дізнається, що застосунок
// можна поставити. зникає лише тоді, коли вже встановлено
export function InstallBanner() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const sync = () => rerender((n) => n + 1);
    listeners.add(sync);
    const mq = window.matchMedia(STANDALONE_QUERY);
    mq.addEventListener('change', sync);
    // подія могла прийти між першим рендером і підпискою
    sync();
    return () => {
      listeners.delete(sync);
      mq.removeEventListener('change', sync);
    };
  }, []);

  const kind = pickInstallBanner({
    standalone: isStandalone(),
    hasPromptEvent: deferredPrompt !== null,
    path: detectInstallPath(navigator.userAgent, navigator.maxTouchPoints),
  });
  if (!kind) return null;

  async function install() {
    const event = deferredPrompt;
    if (!event) return;
    // prompt() одноразовий — після нього плашка вертається до підказки з меню
    deferredPrompt = null;
    notify();
    await event.prompt();
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
        <span className="install-banner-text">{TEXT[kind]}</span>
      )}
    </aside>
  );
}
