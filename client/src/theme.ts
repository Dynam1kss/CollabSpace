import type { Theme } from 'shared';
import { usePrefsStore } from './prefs';

// кольори, які малює konva — вона css-змінних не бачить, тому своя таблиця.
// тримати в парі зі змінними в App.css (--accent, --canvas-bg)
export interface CanvasColors {
  accent: string;
  accentFill: string;
  // лінії сітки — rgb без альфи, альфу додає Grid за рівнем
  gridRgb: string;
  gridAlpha: number;
  // тло png/pdf: у світлій — біле, як і було, у темній — те, що на екрані
  exportBg: string;
  label: string;
  placeholder: string;
}

export const CANVAS_COLORS: Record<Theme, CanvasColors> = {
  light: {
    accent: '#4262ff',
    accentFill: 'rgba(66, 98, 255, 0.08)',
    gridRgb: '0, 0, 0',
    gridAlpha: 0.09,
    exportBg: '#ffffff',
    label: '#4b5563',
    placeholder: '#d1d5db',
  },
  dark: {
    accent: '#6f88ff',
    accentFill: 'rgba(111, 136, 255, 0.14)',
    gridRgb: '255, 255, 255',
    // біле на темному видно сильніше за чорне на світлому — трохи слабше
    gridAlpha: 0.07,
    exportBg: '#1a1e25',
    label: '#aab2c0',
    placeholder: '#3a414e',
  },
};

// темне «чорнило» за замовчуванням: текст, лінії, контури фігур
export const DEFAULT_INK = '#1f2937';
const LIGHT_INK = '#e4e7ec';

// вміст дошки спільний, у базі колір не міняємо. але дефолтне темне чорнило
// прямо на темному полотні не видно — тож лише при малюванні підміняємо його
// світлим. лише там, де воно лежить на полотні: текст стікера на жовтому лишаємо
export function inkFor(color: string, theme: Theme) {
  return theme === 'dark' && color.toLowerCase() === DEFAULT_INK ? LIGHT_INK : color;
}

export function useTheme() {
  return usePrefsStore((s) => s.theme);
}

export function useCanvasColors() {
  return CANVAS_COLORS[useTheme()];
}
