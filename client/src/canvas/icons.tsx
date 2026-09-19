import type { ReactNode } from 'react';

// іконки — інлайн svg, щоб не тягнути бібліотеку заради десятка картинок
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
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

export function ChatIcon() {
  return (
    <Svg>
      <path d="M3 5.5h14v9h-7l-4 3v-3H3v-9z" />
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
