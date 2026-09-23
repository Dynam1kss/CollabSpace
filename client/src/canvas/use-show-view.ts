import { useEffect, useRef } from 'react';
import type { Viewport } from './coordinates';
import { centerOnPoint } from './coordinates';
import { setShowViewHandler } from './presence-channel';
import { TRAVEL_MS, travelTo } from './viewport-travel';

// хтось натиснув «показати всім мій вид» — доводимо свою камеру до його.
// Саме доводимо, а не підставляємо: людина цього не просила, і миттєвий
// стрибок вона прочитала б як збій
export function useShowView(
  viewport: Viewport,
  canvasSize: { width: number; height: number },
  setViewport: (next: Viewport) => void,
) {
  // їхати треба з того місця, де камера зараз, а не з того, яке було на
  // момент підписки — обробник ставиться один раз на дошку
  const current = useRef(viewport);
  useEffect(() => {
    current.current = viewport;
  }, [viewport]);

  // свій розмір екрана — теж у ref, а не в deps: інакше кожна зміна розміру
  // перепідписувала б обробник і рвала доїзд, що саме йде
  const size = useRef(canvasSize);
  useEffect(() => {
    size.current = canvasSize;
  }, [canvasSize]);

  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setShowViewHandler((view) => {
      // двоє натиснули підряд — їде остання, інакше два доїзди тягнуть
      // камеру в різні боки
      cancelRef.current?.();

      // чужу точку ставимо в центр СВОГО вікна — звідси й незалежність від
      // того, з якого екрана її надіслали
      const { width, height } = size.current;
      if (width === 0 || height === 0) return;
      const target = centerOnPoint({ x: view.centerX, y: view.centerY }, view.scale, width, height);

      const stop = travelTo(current.current, target, setViewport);
      // власний рух перериває доїзд: сперечатися з рукою людини камера не має
      const abort = () => {
        stop();
        window.removeEventListener('pointerdown', abort);
        window.removeEventListener('wheel', abort);
        window.clearTimeout(timer);
        cancelRef.current = null;
      };
      const timer = window.setTimeout(abort, TRAVEL_MS + 50);
      window.addEventListener('pointerdown', abort);
      window.addEventListener('wheel', abort, { passive: true });
      cancelRef.current = abort;
    });

    return () => {
      setShowViewHandler(null);
      cancelRef.current?.();
    };
  }, [setViewport]);
}
