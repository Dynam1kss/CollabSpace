import { useEffect, useRef } from 'react';
import { isVideoId } from 'shared';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from './editor-store';

// відео дивимось у звичайному iframe поверх полотна, не в konva: намалювати
// програвач на canvas не можна. nocookie-домен — щоб youtube не ставив своїх
// кук, поки людина просто дивиться вставлене відео
export function VideoOverlay() {
  const { t } = useTranslation();
  const videoId = useEditorStore((s) => s.playingVideoId);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!videoId) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        useEditorStore.getState().stopVideo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [videoId]);

  // id сюди приходить із linkVideoId, але підставляємо його в адресу — тож
  // перевіряємо ще раз, уже перед самим iframe
  if (!videoId || !isVideoId(videoId)) return null;

  const close = () => useEditorStore.getState().stopVideo();

  return (
    <div className="video-overlay" onPointerDown={close}>
      <div className="video-frame" onPointerDown={(e) => e.stopPropagation()}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
          title="YouTube"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          // allow-popups-to-escape-sandbox обовʼязковий: без нього вікно,
          // відкрите з кадру (логотип youtube, назва відео), успадковує
          // пісочницю, дістає «порожнє» походження, і watch-сторінка з
          // X-Frame-Options: SAMEORIGIN його відхиляє — ERR_BLOCKED_BY_RESPONSE.
          // Сам кадр при цьому лишається в пісочниці
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
        <button ref={closeRef} type="button" className="video-close" aria-label={t('link.close')} onClick={close}>
          ×
        </button>
      </div>
    </div>
  );
}
