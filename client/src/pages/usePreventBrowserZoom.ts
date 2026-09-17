import { useEffect } from 'react';

// глушить зум самої сторінки браузера (ctrl+колесо, щипок, жест сафарі),
// поки відкрита дошка: над Stage це вже робить useCanvasViewport, але панелі
// й шапка — звичайний DOM, і над ними браузер масштабував би сторінку.
// Це про сторінку, а не про зум полотна — тому окремо від useCanvasViewport.
// Слухачі на document: chrome робить wheel/touchmove на document пасивними
// за замовчуванням, звідси явний passive: false
export function usePreventBrowserZoom() {
  useEffect(() => {
    function handleWheel(e: WheelEvent) {
      if (e.ctrlKey) e.preventDefault();
    }
    function handleTouchMove(e: TouchEvent) {
      if (e.touches.length > 1) e.preventDefault();
    }
    function handleGesture(e: Event) {
      e.preventDefault();
    }
    document.addEventListener('wheel', handleWheel, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('gesturestart', handleGesture);
    return () => {
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('gesturestart', handleGesture);
    };
  }, []);
}
