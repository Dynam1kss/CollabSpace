import type { ReactNode } from 'react';

// іконки — інлайн svg, щоб не тягнути бібліотеку заради десятка картинок.
// size — для місць, де 20px замало: у панелі голосу кнопки стоять щільним
// рядком, і мікрофон там читався як крапка
function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function SelectIcon() {
  return (
    <Svg>
      <path d="M4 3l12 7-5 1.5L8.5 17 4 3z" />
    </Svg>
  );
}

export function StickyIcon() {
  return (
    <Svg>
      <path d="M3.5 3.5h13v8l-5 5h-8v-13z" />
      <path d="M11.5 16.5v-5h5" />
    </Svg>
  );
}

export function TextIcon() {
  return (
    <Svg>
      <path d="M4 5h12M10 5v11M7.5 16h5" />
    </Svg>
  );
}

export function RectIcon() {
  return (
    <Svg>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1" />
    </Svg>
  );
}

export function EllipseIcon() {
  return (
    <Svg>
      <ellipse cx="10" cy="10" rx="6.5" ry="5.5" />
    </Svg>
  );
}

export function ConnectorIcon() {
  return (
    <Svg>
      <path d="M4 16L16 4M10 4h6v6" />
    </Svg>
  );
}

export function ImageIcon() {
  return (
    <Svg>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1" />
      <circle cx="7.5" cy="8.5" r="1.3" />
      <path d="M3.5 14l4-3.5 3 2.5 3-3.5 3 3" />
    </Svg>
  );
}

export function StrokeWidthIcon() {
  return (
    <Svg>
      <path d="M3 5.5h14" strokeWidth="1" />
      <path d="M3 10h14" strokeWidth="2" />
      <path d="M3 15h14" strokeWidth="3.2" />
    </Svg>
  );
}

export function BringFrontIcon() {
  return (
    <Svg>
      <path d="M3 8v9h9v-3M3 8h3" />
      <rect x="8" y="3" width="9" height="9" rx="1" fill="currentColor" fillOpacity="0.25" />
    </Svg>
  );
}

export function SendBackIcon() {
  return (
    <Svg>
      <rect x="3" y="8" width="9" height="9" rx="1" fill="currentColor" fillOpacity="0.25" />
      <path d="M8 6V3h9v9h-3" />
    </Svg>
  );
}

export function BackIcon() {
  return (
    <Svg>
      <path d="M12.5 4L6.5 10l6 6" />
    </Svg>
  );
}

// проти годинникової — скасувати, за годинниковою — повторити
export function UndoIcon() {
  return (
    <Svg>
      <path d="M7 7H4V4" />
      <path d="M4.5 7.5a6 6 0 1 1 1 6.5" />
    </Svg>
  );
}

export function RedoIcon() {
  return (
    <Svg>
      <path d="M13 7h3V4" />
      <path d="M15.5 7.5a6 6 0 1 0-1 6.5" />
    </Svg>
  );
}

export function ChatIcon() {
  return (
    <Svg>
      <path d="M3 5.5h14v9h-7l-4 3v-3H3v-9z" />
    </Svg>
  );
}

export function MicIcon({ size }: { size?: number } = {}) {
  return (
    <Svg size={size}>
      <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" />
      <path d="M4.5 9a5.5 5.5 0 0 0 11 0M10 14.5v3" />
    </Svg>
  );
}

export function MicOffIcon({ size }: { size?: number } = {}) {
  return (
    <Svg size={size}>
      <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" />
      <path d="M4.5 9a5.5 5.5 0 0 0 11 0M10 14.5v3" />
      <path d="M3 3l14 14" />
    </Svg>
  );
}

export function HeadphonesIcon({ size }: { size?: number } = {}) {
  return (
    <Svg size={size}>
      <path d="M4 12V9.5a6 6 0 0 1 12 0V12" />
      <rect x="2.5" y="11.5" width="3.5" height="5" rx="1.5" />
      <rect x="14" y="11.5" width="3.5" height="5" rx="1.5" />
    </Svg>
  );
}

export function HeadphonesOffIcon({ size }: { size?: number } = {}) {
  return (
    <Svg size={size}>
      <path d="M4 12V9.5a6 6 0 0 1 12 0V12" />
      <rect x="2.5" y="11.5" width="3.5" height="5" rx="1.5" />
      <rect x="14" y="11.5" width="3.5" height="5" rx="1.5" />
      <path d="M3 3l14 14" />
    </Svg>
  );
}

// крісло збоку — спинка, сидіння, ніжки. «сюди можна ставити стільці»
export function ChairIcon() {
  return (
    <Svg>
      <path d="M6 3.5h8v7H6z" />
      <path d="M4.5 10.5h11M6 13h8M6 13v3.5M14 13v3.5" />
    </Svg>
  );
}

export function TrashIcon() {
  return (
    <Svg>
      <path d="M4 6h12M8 6V4h4v2M6 6l1 10.5h6L14 6" />
    </Svg>
  );
}

export function FitIcon() {
  return (
    <Svg>
      <path d="M3 7V3h4M17 7V3h-4M3 13v4h4M17 13v4h-4" />
    </Svg>
  );
}

export function PeopleIcon() {
  return (
    <Svg>
      <circle cx="8" cy="6.5" r="2.8" />
      <path d="M2.5 16.5c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8" />
      <path d="M13.5 4.2a2.8 2.8 0 0 1 0 5.4M15 11.9c1.7.5 2.9 1.8 2.9 4" />
    </Svg>
  );
}

export function MoreIcon() {
  return (
    <Svg>
      <circle cx="10" cy="4.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="10" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function EmptyBoardsIcon() {
  return (
    <Svg size={56}>
      <rect x="2.5" y="4.5" width="10" height="7.5" rx="1.5" />
      <rect x="8.5" y="9" width="9" height="7" rx="1.5" />
    </Svg>
  );
}

// дві однакові рамки зі зсувом — те саме, що робить ctrl+d
export function DuplicateIcon() {
  return (
    <Svg>
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
      <path d="M7 16.5h8a1.5 1.5 0 0 0 1.5-1.5V7" />
    </Svg>
  );
}

export function SearchIcon() {
  return (
    <Svg>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.3 12.3L17 17" />
    </Svg>
  );
}

// «показати всім мій вид» — екран зі стрілкою назовні
export function ShowViewIcon() {
  return (
    <Svg>
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h5M17 9v5.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5V10" />
      <path d="M12 3h5v5M17 3l-6 6" />
    </Svg>
  );
}

// замок закритий і відкритий: дужка та сама, у відкритого зсунута вбік
export function LockIcon() {
  return (
    <Svg>
      <rect x="4" y="9" width="12" height="8" rx="1.5" />
      <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" />
    </Svg>
  );
}

export function UnlockIcon() {
  return (
    <Svg>
      <rect x="4" y="9" width="12" height="8" rx="1.5" />
      <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0" />
    </Svg>
  );
}

// приціл — «знайти на полотні» з картки канбану
export function LocateIcon() {
  return (
    <Svg size={14}>
      <circle cx="10" cy="10" r="5.5" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" />
    </Svg>
  );
}

// стрілка вниз у лоток — «зберегти файлом»
export function ExportIcon() {
  return (
    <Svg>
      <path d="M10 3v9M6 8.5l4 4 4-4" />
      <path d="M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13" />
    </Svg>
  );
}

// годинник зі стрілкою назад — історія версій
export function HistoryIcon() {
  return (
    <Svg>
      <path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6" />
      <path d="M3.5 3.5v3h3" />
      <path d="M10 6.5V10l2.5 1.5" />
    </Svg>
  );
}

// вирівнювання тексту: три смужки різної довжини — як це малюють усюди,
// тому підпис до них можна не читати
export function AlignLeftIcon() {
  return (
    <Svg>
      <path d="M3.5 5h13M3.5 9h8M3.5 13h11M3.5 17h6" />
    </Svg>
  );
}

export function AlignCenterIcon() {
  return (
    <Svg>
      <path d="M3.5 5h13M6 9h8M4.5 13h11M7 17h6" />
    </Svg>
  );
}

export function AlignRightIcon() {
  return (
    <Svg>
      <path d="M3.5 5h13M8.5 9h8M5.5 13h11M10.5 17h6" />
    </Svg>
  );
}

// пряма — просто відрізок навскіс, щоб не плутався зі стрілкою-зʼєднувачем
export function LineIcon() {
  return (
    <Svg>
      <path d="M4 16L16 4" />
    </Svg>
  );
}

export function FileIcon() {
  return (
    <Svg>
      <path d="M11 2H6a1 1 0 00-1 1v14a1 1 0 001 1h8a1 1 0 001-1V6z" />
      <path d="M11 2v4h4" />
    </Svg>
  );
}

export function LinkIcon() {
  return (
    <Svg>
      <path d="M8.5 11.5l3-3" />
      <path d="M7 13l-1 1a2.8 2.8 0 01-4-4l2-2a2.8 2.8 0 014 0" />
      <path d="M13 7l1-1a2.8 2.8 0 014 4l-2 2a2.8 2.8 0 01-4 0" />
    </Svg>
  );
}

// кнопка «відкрити» в контекстній панелі
export function ExternalIcon() {
  return (
    <Svg>
      <path d="M11 4h5v5" />
      <path d="M16 4l-7 7" />
      <path d="M14 12v4H4V6h4" />
    </Svg>
  );
}

// пряма й крива — перемикач вигляду лінії
export function StraightIcon() {
  return (
    <Svg>
      <path d="M4 16L16 4" />
    </Svg>
  );
}

export function CurveIcon() {
  return (
    <Svg>
      <path d="M4 16C4 9 11 4 16 4" />
    </Svg>
  );
}

export function RefreshIcon() {
  return (
    <Svg>
      <path d="M16 10a6 6 0 11-1.8-4.2" />
      <path d="M16 3v3h-3" />
    </Svg>
  );
}

export function PlayIcon() {
  return (
    <Svg>
      <path d="M6 4l10 6-10 6V4z" />
    </Svg>
  );
}

// штрих лінії: суцільна / штрихова / крапкова
export function DashSolidIcon() {
  return (
    <Svg>
      <path d="M3 10h14" />
    </Svg>
  );
}

export function DashDashedIcon() {
  return (
    <Svg>
      <path d="M3 10h4M8 10h4M16 10h1" />
    </Svg>
  );
}

export function DashDottedIcon() {
  return (
    <Svg>
      <path d="M3.5 10h.6M7 10h.6M10.5 10h.6M14 10h.6M17 10h.4" />
    </Svg>
  );
}

// вістря на початку / в кінці прямої
export function ArrowStartIcon() {
  return (
    <Svg>
      <path d="M4 10h12M4 10l4-3M4 10l4 3" />
    </Svg>
  );
}

export function ArrowEndIcon() {
  return (
    <Svg>
      <path d="M4 10h12M16 10l-4-3M16 10l-4 3" />
    </Svg>
  );
}
