import { create } from 'zustand';
import type { FileUsageMessage } from 'shared';

// Скільки місця під файли зайнято — ЄДИНЕ число на весь інтерфейс. Приходить
// від сервера: спершу відповіддю на GET при відкритті дошки, далі кадром
// FILE_USAGE щоразу, коли хтось у кімнаті зарезервував чи відпустив місце.
// Саме це число вирішує відмову на сервері, тож підказка не може розійтися з
// тим, що станеться при завантаженні
export const useFileUsage = create<{ usage: FileUsageMessage | null }>(() => ({ usage: null }));

export function setFileUsage(usage: FileUsageMessage | null) {
  useFileUsage.setState({ usage });
}
