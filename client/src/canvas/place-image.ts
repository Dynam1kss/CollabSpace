import { ApiError, uploadBoardImage } from '../api/boards';
import { useBoardStore } from './board-store';
import type { Point } from './coordinates';
import { useEditorStore } from './editor-store';
import { createImage, fitImageSize } from './object-defaults';
import { nextZIndex } from './selection-actions';

// те саме, що limit у express.raw на сервері — перевіряємо до відправки,
// щоб не ганяти 20мб заради 413
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// вибраний файл → розмір з картинки → на сервер → обʼєкт у центрі видимої
// області, виділений і з інструментом «вибір» (порядок як у finishDraw).
// кидає Error з текстом для користувача
export async function placeImageFromFile(boardId: string, file: File, center: Point, createdBy: string) {
  if (file.size > MAX_FILE_BYTES) throw new Error('Файл завеликий — до 5 МБ');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Не вдалося прочитати зображення');
  }
  const size = fitImageSize(bitmap.width, bitmap.height);
  bitmap.close();

  let url: string;
  try {
    ({ url } = await uploadBoardImage(boardId, file));
  } catch (err) {
    // ApiError уже несе текст для користувача (415/413 з сервера), решта — мережа
    if (err instanceof ApiError) throw err;
    throw new Error('Немає звʼязку з сервером', { cause: err });
  }

  const object = createImage({ x: center.x - size.width / 2, y: center.y - size.height / 2 }, size, url, {
    createdBy,
    zIndex: nextZIndex(),
  });
  useBoardStore.getState().add(object);
  const editor = useEditorStore.getState();
  editor.setActiveTool('select');
  editor.select(object.id);
}
