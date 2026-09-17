import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useEditorStore } from './editor-store';
import type { ToolId } from './editor-store';
import { ConnectorIcon, EllipseIcon, RectIcon, SelectIcon, StickyIcon, TextIcon } from './icons';

const TOOLS: { id: ToolId; label: string; hotkey: string; icon: ReactNode }[] = [
  { id: 'select', label: 'Вибір', hotkey: 'V', icon: <SelectIcon /> },
  { id: 'sticky', label: 'Стікер', hotkey: 'S', icon: <StickyIcon /> },
  { id: 'text', label: 'Текст', hotkey: 'T', icon: <TextIcon /> },
  { id: 'rect', label: 'Прямокутник', hotkey: 'R', icon: <RectIcon /> },
  { id: 'ellipse', label: 'Еліпс', hotkey: 'E', icon: <EllipseIcon /> },
  { id: 'connector', label: 'Зʼєднувач', hotkey: 'C', icon: <ConnectorIcon /> },
];

const HOTKEY_MAP: Record<string, ToolId> = Object.fromEntries(TOOLS.map((t) => [t.hotkey, t.id]));

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function Toolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Space') return; // пробіл лишається за тимчасовим паном (useCanvasViewport)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tool = HOTKEY_MAP[e.key.toUpperCase()];
      if (tool) {
        e.preventDefault();
        setActiveTool(tool);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTool]);

  return (
    <aside className="board-island tool-island">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={tool.id === activeTool ? 'tool-button active' : 'tool-button'}
          title={`${tool.label} (${tool.hotkey})`}
          aria-label={tool.label}
          onClick={() => setActiveTool(tool.id)}
        >
          {tool.icon}
        </button>
      ))}
    </aside>
  );
}
