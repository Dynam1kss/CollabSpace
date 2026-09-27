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
// кидає ApiError з кодом (перекладає errorText) або мережеву помилку як є
export async function placeImageFromFile(boardId: string, file: File, center: Point, createdBy: string) {
  // статус 0 — відмова ще до запиту, код той самий механізм перекладу
  if (file.size > MAX_FILE_BYTES) throw new ApiError(0, 'IMAGE_TOO_LARGE', 'file too large');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ApiError(0, 'IMAGE_UNREADABLE', 'cannot decode image');
  }
  const size = fitImageSize(bitmap.width, bitmap.height);
  bitmap.close();

  // 415/413 з сервера — ApiError з кодом, збій мережі — TypeError від fetch;
  // обидва errorText перекладе сам
  const { url } = await uploadBoardImage(boardId, file);

  const object = createImage({ x: center.x - size.width / 2, y: center.y - size.height / 2 }, size, url, {
    createdBy,
    zIndex: nextZIndex(),
  });
  useBoardStore.getState().add(object);
  const editor = useEditorStore.getState();
  editor.setActiveTool('select');
  editor.select(object.id);
}
