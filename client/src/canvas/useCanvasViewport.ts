import { useCallback, useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { pinchViewport, zoomViewportAtPoint } from './coordinates';
import type { Viewport } from './coordinates';
import { useEditorStore } from './editor-store';
import { recordPinch } from './pinch-debug';

const BUTTON_ZOOM_STEP = 1.2;

// звичайна миша на ПК — не чіпати, це вже перевірено й підтверджено «ідеально».
// підібрано так, щоб один клац колеса (~100px за подію wheel — типовий крок
// у Chrome/Firefox у пікселевому deltaMode) давав множник ≈1.15.
// exp(-100 * k) = 1.15  =>  k = ln(1.15) / 100
const WHEEL_ZOOM_K = Math.log(1.15) / 100;
const WHEEL_EVENT_MIN_FACTOR = 0.9;
const WHEEL_EVENT_MAX_FACTOR = 1.1;

// щипок трекпадом — окрема, значно чутливіша константа. Трекпад шле дуже
// дрібні deltaY на подію (одиниці-десятки px, а не ~100 як миша), тому та сама
// WHEEL_ZOOM_K на них давала ледь помітний, «повільний» зум. За відгуком з
// реального мака підняв ще раз (з 0.005) — попередній підбір і досі відчувався
// слабким
const WHEEL_PINCH_ZOOM_K = 0.007;
const WHEEL_PINCH_MIN_FACTOR = 0.65;
const WHEEL_PINCH_MAX_FACTOR = 1.65;

// довша пауза між подіями wheel — новий жест, класифікуємо його наново;
// коротша — це продовження того самого жесту, тримаємось початкової
// класифікації (щоб пан і зум не перемикались всередині одного руху пальців).
// 200мс виявилось замало на реальному маку: під час повільного, обережного
// руху пальцями по трекпаду природні паузи між подіями wheel перевищували
// поріг, жест хибно вважався завершеним і перекласифіковувався посередині —
// саме це й виглядало як "перемикання між рухом і зумом". 500мс — з запасом
// покриває повільний рух, лишаючись явно коротшим за паузу після відриву пальців
const WHEEL_GESTURE_GAP_MS = 500;

// дельта, менша за це, — точно не клац миші (нотч навіть при зумі сторінки
// 500% дає 100/5 = 20), а початок повільного руху трекпадом
const MOUSE_CLICK_MIN_DELTA = 20;

// перша подія жесту, схожа на клац миші, чекає стільки на "другу думку":
// трекпад шле події кожні 8–16мс, тож за цей час він себе видасть потоком з
// плаваючою дельтою; миша або мовчить, або повторює ту саму дельту (швидке
// прокручування). 60мс — запас на 2–3 кадри навіть коли головний потік
// підгальмовує на перемальовуванні; для першого нотча миші це затримка
// менша за поріг "миттєво" (~100мс), далі жест уже класифікований
const WHEEL_CLASSIFY_DELAY_MS = 60;

const LINE_HEIGHT_PX = 16;

// сенсор на телефоні шумить ~±0.7px на координату, відстань між пальцями —
// до ±1.4px. поки пальці майже стоять, це давало розворот масштабу мало не
// щокадру, і край екрана трусило на кілька пікселів. тому крок щипка у
// протилежний бік менший за це просто ігноруємо; рух в один бік іде як є
const PINCH_REVERSE_DEADZONE_PX = 3;

// на живому андроїді проскакують і поодинокі викиди в той самий бік, що й
// жест, — розворот їх не ловить. тому відстань між пальцями ще й згладжуємо:
// щокадру вона проходить лише цю частку шляху до сирої. більше — шпильки
// пролазять, менше — масштаб помітно відстає від пальців
const PINCH_SMOOTHING = 0.4;

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

// deltaMode: 0 — пікселі (типово для миші й трекпада в сучасних браузерах),
// 1 — рядки (старий Firefox), 2 — сторінки. Наводимо все до пікселів одразу,
// до будь-яких інших обчислень над deltaX/deltaY
function normalizeWheelDelta(evt: WheelEvent) {
  let deltaX = evt.deltaX;
  let deltaY = evt.deltaY;
  if (evt.deltaMode === 1) {
    deltaX *= LINE_HEIGHT_PX;
    deltaY *= LINE_HEIGHT_PX;
  } else if (evt.deltaMode === 2) {
    deltaX *= window.innerHeight;
    deltaY *= window.innerHeight;
  }
  return { deltaX, deltaY };
}

type WheelGestureType = 'pan' | 'zoom-mouse' | 'zoom-pinch';

// кандидат на клац миші: строго вертикальна й достатньо велика дельта.
// цілість дельти навмисно не перевіряємо — chromium ділить deltaY на зум
// сторінки (110% → 90.909, 150% → 66.667), hi-res миші дають 33.33, і всі
// вони хибно ставали "паном". остаточно вирішує handleWheel, дочекавшись
// WHEEL_CLASSIFY_DELAY_MS
function looksLikeMouseClick(deltaX: number, deltaY: number) {
  return deltaX === 0 && Math.abs(deltaY) >= MOUSE_CLICK_MIN_DELTA;
}

// друга подія одразу за першою: миша повторює рівно ту саму дельту (той самий
// нотч), трекпад — ні (дельта пливе з рухом пальців або має deltaX)
function isSameMouseNotch(first: { deltaX: number; deltaY: number }, deltaX: number, deltaY: number) {
  return deltaX === 0 && Math.abs(Math.abs(deltaY) - Math.abs(first.deltaY)) < 1e-6;
}

function distance(a: Point2, b: Point2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface Point2 {
  x: number;
  y: number;
}

function touchStagePoint(stage: Konva.Stage, touch: Touch): Point2 {
  const rect = stage.container().getBoundingClientRect();
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

// другий палець ліг — це щипок/пан, навіть якщо перший уже тягне обʼєкт.
// поки хоч один вузол у konva в стані dragging, Stage не отримує touchmove
// взагалі, тому драг треба загасити саме тут і зараз. konva не дає публічного
// «скасувати все» — беремо її внутрішній список drag-елементів: ті, що вже
// їдуть, повертаємо на стартову позицію і зупиняємо (stopDrag кине dragend,
// але з початковими координатами), ті, що лише «готові», просто викидаємо —
// інакше рух першого пальця ще стартував би їм драг посеред щипка
function cancelObjectDrags() {
  const elements = Array.from(Konva.DD._dragElements.values());
  for (const { node, dragStatus, startPointerPos, offset } of elements) {
    if (dragStatus !== 'dragging') continue;
    node.setAbsolutePosition({ x: startPointerPos.x - offset.x, y: startPointerPos.y - offset.y });
    node.stopDrag();
  }
  Konva.DD._dragElements.clear();
  return elements.length > 0;
}

// пан і зум полотна — мишею (колесо/середня кнопка/пробіл), тачем (один
// палець тягне, два масштабують) і кнопками панелі. Стан і обробники в
// одному хуку, щоб BoardCanvas лишався суто розміткою
export function useCanvasViewport(initial: Viewport) {
  const [viewport, setViewport] = useState<Viewport>(initial);
  const [spaceHeld, setSpaceHeld] = useState(false);
  // з чого працюють — з тача чи з миші. Окремого детектора не заводимо: тач
  // видає себе тим самим touchstart, з якого вже живуть пан і щипок. Лежить
  // у сторі, бо зони захвату ручок читають його далеко звідси
  const touchInput = useEditorStore((s) => s.touchInput);

  const panRef = useRef<{ active: boolean; lastX: number; lastY: number } | null>(null);
  // target — де пальці зараз (сирі); smoothDistance/midpoint — згладжені;
  // distance — відстань, від якої востаннє реально міняли масштаб (не остання
  // з подій), direction — куди тоді міняли: 1 розводимо, -1 зводимо, 0 ще ніяк.
  // lifted — пальці вже підняли, лишилось лише доїхати до target;
  // fresh — target оновився після останнього кроку (лише для трейсу)
  const pinchRef = useRef<{
    target: { distance: number; midpoint: Point2 };
    fresh: boolean;
    distance: number;
    smoothDistance: number;
    midpoint: Point2;
    direction: number;
    lifted: boolean;
  } | null>(null);
  const pinchRafRef = useRef<number | null>(null);
  const wheelGestureRef = useRef<{ type: WheelGestureType; lastTime: number } | null>(null);
  // перша подія нового жесту, яка схожа на клац миші, але ще не підтверджена —
  // лежить тут до другої події або до таймера
  const pendingWheelRef = useRef<{ deltaX: number; deltaY: number; pointer: Point2; timerId: number } | null>(
    null,
  );

  // дзеркало стану у ref — щоб пакетна обробка wheel нижче завжди бачила
  // свіже значення, а не застигле в замиканні useCallback з порожнім deps
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  // кілька подій за один кадр (wheel трекпада, mousemove, touchmove) складаються
  // в одну pending-версію viewport і йдуть у setViewport одним викликом через rAF —
  // інакше React перемальовує полотно на кожну дрібну подію, десятки разів на
  // секунду, і на швидких рухах полотно смикається
  const pendingViewportRef = useRef<Viewport | null>(null);
  const flushRafIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (flushRafIdRef.current !== null) cancelAnimationFrame(flushRafIdRef.current);
      if (pinchRafRef.current !== null) cancelAnimationFrame(pinchRafRef.current);
      if (pendingWheelRef.current) clearTimeout(pendingWheelRef.current.timerId);
    };
  }, []);

  const flushViewport = useCallback(() => {
    if (flushRafIdRef.current !== null) {
      cancelAnimationFrame(flushRafIdRef.current);
      flushRafIdRef.current = null;
    }
    if (pendingViewportRef.current) {
      // у ref пишемо одразу, не чекаючи ефекту після рендера — подія, що
      // прилетить між цим кадром і комітом react, інакше стартувала б від
      // застарілого viewport і зʼїла б уже накопичений зсув
      viewportRef.current = pendingViewportRef.current;
      setViewport(pendingViewportRef.current);
      pendingViewportRef.current = null;
    }
  }, []);

  const scheduleViewportFlush = useCallback(() => {
    if (flushRafIdRef.current !== null) return;
    flushRafIdRef.current = requestAnimationFrame(flushViewport);
  }, [flushViewport]);

  // нове значення рахуємо від того, що вже накопичено в цьому кадрі (якщо
  // кілька подій прийшли до flush), інакше від свіжого committed стану
  const queueViewport = useCallback(
    (next: (base: Viewport) => Viewport) => {
      pendingViewportRef.current = next(pendingViewportRef.current ?? viewportRef.current);
      scheduleViewportFlush();
    },
    [scheduleViewportFlush],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') setSpaceHeld(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    function handleWindowMouseMove(e: MouseEvent) {
      const pan = panRef.current;
      if (!pan?.active) return;
      const dx = e.clientX - pan.lastX;
      const dy = e.clientY - pan.lastY;
      pan.lastX = e.clientX;
      pan.lastY = e.clientY;
      queueViewport((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
    function handleWindowMouseUp() {
      if (panRef.current) panRef.current.active = false;
    }
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [queueViewport]);

  const handleMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const isMiddle = e.evt.button === 1;
      const isRight = e.evt.button === 2;
      const isSpaceLeft = e.evt.button === 0 && spaceHeld;
      if (isMiddle || isRight || isSpaceLeft) {
        e.evt.preventDefault();
        panRef.current = { active: true, lastX: e.evt.clientX, lastY: e.evt.clientY };
      }
    },
    [spaceHeld],
  );

  // права кнопка панує (як середня) — браузерне контекстне меню на полотні не потрібне
  const handleContextMenu = useCallback((e: KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
  }, []);

  // застосувати одну подію wheel уже відомого типу до pending-viewport
  const applyWheel = useCallback(
    (type: WheelGestureType, deltaX: number, deltaY: number, pointer: Point2) => {
      if (type === 'pan') {
        queueViewport((base) => ({ ...base, x: base.x - deltaX, y: base.y - deltaY }));
        return;
      }

      // масштаб пропорційний величині прокрутки (не фіксованим кроком за подію) —
      // трекпад шле десятки дрібних подій на секунду, і фіксований крок на кожну
      // з них накопичувався б у ривки. Множник однієї події обмежений діапазоном,
      // щоб випадковий сплеск дельти не викидав масштаб; deltaX під час щипка
      // навмисно ігнорується — там це шум трекпада, а не намір панувати.
      // Миша й трекпад мають окремі константи швидкості (мишу не чіпаємо)
      const isPinch = type === 'zoom-pinch';
      const k = isPinch ? WHEEL_PINCH_ZOOM_K : WHEEL_ZOOM_K;
      const minFactor = isPinch ? WHEEL_PINCH_MIN_FACTOR : WHEEL_EVENT_MIN_FACTOR;
      const maxFactor = isPinch ? WHEEL_PINCH_MAX_FACTOR : WHEEL_EVENT_MAX_FACTOR;
      const rawFactor = Math.exp(-deltaY * k);
      const factor = Math.min(maxFactor, Math.max(minFactor, rawFactor));
      queueViewport((base) => zoomViewportAtPoint(base, base.scale * factor, pointer));
    },
    [queueViewport],
  );

  // відкладена перша подія отримала вердикт — застосовуємо її і фіксуємо тип жесту
  const resolvePendingWheel = useCallback(
    (type: WheelGestureType) => {
      const pending = pendingWheelRef.current;
      if (!pending) return;
      clearTimeout(pending.timerId);
      pendingWheelRef.current = null;
      wheelGestureRef.current = { type, lastTime: performance.now() };
      applyWheel(type, pending.deltaX, pending.deltaY, pending.pointer);
    },
    [applyWheel],
  );

  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!stage || !pointer) return;

      const { deltaX, deltaY } = normalizeWheelDelta(e.evt);

      // друга подія слідом за відкладеною першою — вона й вирішує, миша це чи трекпад
      if (pendingWheelRef.current) {
        const first = pendingWheelRef.current;
        resolvePendingWheel(!e.evt.ctrlKey && isSameMouseNotch(first, deltaX, deltaY) ? 'zoom-mouse' : 'pan');
      }

      // за паузу довшу за WHEEL_GESTURE_GAP_MS вважаємо це новим жестом і
      // класифікуємо наново; інакше тримаємось типу, визначеного на самому
      // початку жесту — щоб трекпад не перемикав пан/зум усередині одного
      // безперервного руху пальців (навіть якщо один окремий кадр вийшов
      // прикордонним за дельтою чи ctrlKey ненадовго змигнув)
      const now = performance.now();
      const activeGesture = wheelGestureRef.current;
      if (activeGesture && now - activeGesture.lastTime < WHEEL_GESTURE_GAP_MS) {
        activeGesture.lastTime = now;
        applyWheel(activeGesture.type, deltaX, deltaY, pointer);
        return;
      }

      // ctrlKey — щипок трекпадом (браузер виставляє сам), вирішуємо одразу
      if (e.evt.ctrlKey) {
        wheelGestureRef.current = { type: 'zoom-pinch', lastTime: now };
        applyWheel('zoom-pinch', deltaX, deltaY, pointer);
        return;
      }

      // схоже на клац миші — але по одній події не відрізнити від різкого
      // вертикального свайпу трекпадом. відкладаємо: якщо за
      // WHEEL_CLASSIFY_DELAY_MS ніхто не прийшов — миша (зум)
      if (looksLikeMouseClick(deltaX, deltaY)) {
        const timerId = window.setTimeout(() => resolvePendingWheel('zoom-mouse'), WHEEL_CLASSIFY_DELAY_MS);
        pendingWheelRef.current = { deltaX, deltaY, pointer, timerId };
        return;
      }

      wheelGestureRef.current = { type: 'pan', lastTime: now };
      applyWheel('pan', deltaX, deltaY, pointer);
    },
    [applyWheel, resolvePendingWheel],
  );

  const handleTouchStart = useCallback((e: KonvaEventObject<TouchEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    useEditorStore.getState().setTouchInput();
    const touches = e.evt.touches;

    if (touches.length === 1) {
      panRef.current = { active: true, lastX: touches[0].clientX, lastY: touches[0].clientY };
      pinchRef.current = null;
    } else if (touches.length === 2) {
      panRef.current = null;
      // якийсь із пальців ліг на обʼєкт — його виділення теж відкочуємо,
      // жест по полотну не має лишати по собі виділений обʼєкт
      if (cancelObjectDrags()) useEditorStore.getState().clearSelection();
      const p1 = touchStagePoint(stage, touches[0]);
      const p2 = touchStagePoint(stage, touches[1]);
      const d = distance(p1, p2);
      const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      pinchRef.current = {
        target: { distance: d, midpoint },
        fresh: false,
        distance: d,
        smoothDistance: d,
        midpoint,
        direction: 0,
        lifted: false,
      };
      const v = viewportRef.current;
      recordPinch({
        t: e.evt.timeStamp,
        kind: 'start',
        raw: d,
        smooth: d,
        skipped: false,
        midX: midpoint.x,
        midY: midpoint.y,
        rawMidX: midpoint.x,
        rawMidY: midpoint.y,
        ...v,
      });
    }
  }, []);

  // один крок згладженого щипка до pinch.target. повертає true, коли вже доїхали
  const stepPinch = useCallback(
    (t: number) => {
      const prev = pinchRef.current;
      if (!prev) return true;
      const kind = prev.fresh ? 'move' : 'settle';
      const { target } = prev;
      const newDistance = prev.smoothDistance + PINCH_SMOOTHING * (target.distance - prev.smoothDistance);
      // середню точку не згладжуємо — зсув іде 1:1 за пальцями, як і пан одним.
      // згладжена відставала на 1.5 кадру (75px на швидкому пані), а коли
      // події приходять рідше за кадри (60 Гц дотиків на 90–120 Гц екрані,
      // звично для андроїда), фільтр наздоганяв стрибки цілі нерівними кроками —
      // ривки по 65px. шум координати проти швидкого пану мізерний
      const newMidpoint = target.midpoint;
      const delta = newDistance - prev.distance;
      const direction = Math.sign(delta);
      // після відриву пальців шуму вже нема звідки взятись, а мертва зона
      // лишила б недоїзд до 3px назавжди
      const isNoise =
        !prev.lifted && direction !== prev.direction && Math.abs(delta) < PINCH_REVERSE_DEADZONE_PX;
      pinchRef.current = isNoise
        ? { ...prev, fresh: false, smoothDistance: newDistance, midpoint: newMidpoint }
        : {
            ...prev,
            fresh: false,
            distance: newDistance,
            smoothDistance: newDistance,
            midpoint: newMidpoint,
            direction,
          };
      if (prev.distance > 0) {
        // масштаб і зсув однією зміною стану: відношення відстаней — множник
        // масштабу, зміщення середньої точки — панорамування; масштаб рахуємо
        // відносно ПОПЕРЕДНЬОЇ середньої точки (prev.midpoint), інакше зсув після
        // подвоюється і полотно "стрибає" замість того, щоб клеїтись до пальців
        const factor = isNoise ? 1 : newDistance / prev.distance;
        queueViewport((v) => {
          const next = pinchViewport(v, v.scale * factor, prev.midpoint, newMidpoint);
          recordPinch({
            t,
            kind,
            raw: target.distance,
            smooth: newDistance,
            skipped: isNoise,
            midX: newMidpoint.x,
            midY: newMidpoint.y,
            rawMidX: target.midpoint.x,
            rawMidY: target.midpoint.y,
            ...next,
          });
          return next;
        });
      }
      return Math.abs(target.distance - newDistance) < 0.05;
    },
    [queueViewport],
  );

  // фільтр крокує рівно раз на кадр, а не на подію: touchmove лише міняє
  // target. інакше полотно застигало б, щойно події рідшають чи зупиняються
  // (на швидкому щипку не доїжджало до пальців на 10%), а на телефонах, що
  // шлють 120 подій на секунду, згладження було б іншим, ніж на 60.
  // flush одразу, у цьому ж кадрі — через queueViewport був би ще кадр затримки
  const runPinchLoop = useCallback(() => {
    const frame = () => {
      pinchRafRef.current = null;
      const pinch = pinchRef.current;
      if (!pinch) return;
      const done = stepPinch(performance.now());
      flushViewport();
      if (done && pinch.lifted) pinchRef.current = null;
      if (!done) pinchRafRef.current = requestAnimationFrame(frame);
    };
    if (pinchRafRef.current === null) pinchRafRef.current = requestAnimationFrame(frame);
  }, [stepPinch, flushViewport]);

  const handleTouchMove = useCallback(
    (e: KonvaEventObject<TouchEvent>) => {
      e.evt.preventDefault();
      const stage = e.target.getStage();
      if (!stage) return;
      const touches = e.evt.touches;

      if (touches.length === 1 && panRef.current?.active) {
        const dx = touches[0].clientX - panRef.current.lastX;
        const dy = touches[0].clientY - panRef.current.lastY;
        panRef.current.lastX = touches[0].clientX;
        panRef.current.lastY = touches[0].clientY;
        queueViewport((v) => {
          const next = { ...v, x: v.x + dx, y: v.y + dy };
          const at = touchStagePoint(stage, touches[0]);
          recordPinch({
            t: e.evt.timeStamp,
            kind: 'pan',
            raw: 0,
            smooth: 0,
            skipped: false,
            midX: at.x,
            midY: at.y,
            rawMidX: at.x,
            rawMidY: at.y,
            ...next,
          });
          return next;
        });
      } else if (touches.length === 2 && pinchRef.current) {
        const p1 = touchStagePoint(stage, touches[0]);
        const p2 = touchStagePoint(stage, touches[1]);
        pinchRef.current.target = {
          distance: distance(p1, p2),
          midpoint: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
        };
        pinchRef.current.fresh = true;
        runPinchLoop();
      }
    },
    [queueViewport, runPinchLoop],
  );

  const handleTouchEnd = useCallback(
    (e: KonvaEventObject<TouchEvent>) => {
      const touches = e.evt.touches;
      if (touches.length < 2 && pinchRef.current && !pinchRef.current.lifted) {
        const p = pinchRef.current;
        const v = viewportRef.current;
        recordPinch({
          t: e.evt.timeStamp,
          kind: 'end',
          raw: p.target.distance,
          smooth: p.smoothDistance,
          skipped: false,
          midX: p.midpoint.x,
          midY: p.midpoint.y,
          rawMidX: p.target.midpoint.x,
          rawMidY: p.target.midpoint.y,
          ...v,
        });
        // не обнуляємо одразу — полотно ще доїде до того, де пальці відірвались
        p.lifted = true;
        runPinchLoop();
      }
      if (touches.length === 0) {
        panRef.current = null;
      } else if (touches.length === 1) {
        // після щипка лишився один палець — продовжуємо панорамувати ним
        panRef.current = { active: true, lastX: touches[0].clientX, lastY: touches[0].clientY };
      }
    },
    [runPinchLoop],
  );

  const handleMouseUp = useCallback(() => {
    if (panRef.current) panRef.current.active = false;
  }, []);

  // кнопки панелі зумять відносно центру видимої області, не курсора —
  // курсора для кліку по кнопці просто немає
  const zoomByFactor = useCallback((factor: number, center: Point2) => {
    setViewport((v) => zoomViewportAtPoint(v, v.scale * factor, center));
  }, []);

  const zoomIn = useCallback((center: Point2) => zoomByFactor(BUTTON_ZOOM_STEP, center), [zoomByFactor]);
  const zoomOut = useCallback((center: Point2) => zoomByFactor(1 / BUTTON_ZOOM_STEP, center), [zoomByFactor]);

  const resetView = useCallback((center: Point2) => {
    setViewport({ x: center.x, y: center.y, scale: 1 });
  }, []);

  return {
    viewport,
    spaceHeld,
    touchInput,
    zoomIn,
    zoomOut,
    resetView,
    // прямий доступ до сетера viewport — для "показати все" (вписати обʼєкти),
    // де потрібен довільний масштаб/позиція, не "скинути на 100% і центр",
    // як робить resetView. Нової логіки тут нема, просто віддаємо вже наявний setState
    setViewport,
    stageHandlers: {
      onWheel: handleWheel,
      onMouseDown: handleMouseDown,
      onMouseUp: handleMouseUp,
      onContextMenu: handleContextMenu,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}
