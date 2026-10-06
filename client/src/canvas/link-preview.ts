import { linkKind } from 'shared';
import type { LinkObject } from 'shared';
import { fetchLinkPreview } from '../api/boards';
import { useBoardStore } from './board-store';
import { linkPatchWithSize } from './link-layout';

// прев'ю сторінки тягне той, хто створює картку, і кладе результат В ОБʼЄКТ.
// Решта кімнати бачить уже готове: ніхто, крім автора, на чужий хост не ходить,
// і навіть автор ходить не сам — за нього це робить сервер
export async function loadLinkPreview(boardId: string, objectId: string) {
  const object = useBoardStore.getState().getById(objectId);
  if (!object || object.type !== 'link') return;
  // у відео своя мініатюра з адреси, прев'ю йому ні до чого
  if (linkKind(object) === 'youtube') return;

  // слід спроби ставимо в обох випадках: без нього невдала спроба
  // повторювалась би на кожне відкриття дошки, і так по колу
  const stamp = () => new Date().toISOString();
  try {
    const preview = await fetchLinkPreview(boardId, object.url);
    // поки летіла відповідь, картку могли видалити або змінити їй адресу
    const fresh = useBoardStore.getState().getById(objectId) as LinkObject | undefined;
    if (!fresh || fresh.type !== 'link' || fresh.url !== object.url) return;

    useBoardStore.getState().update(
      objectId,
      linkPatchWithSize(fresh, {
        previewTitle: preview.title,
        previewDescription: preview.description,
        previewSiteName: preview.siteName,
        previewImage: preview.image,
        previewAspect: preview.imageAspect,
        previewFetchedAt: stamp(),
        previewFailed: undefined,
      }),
    );
  } catch {
    // не вийшло — картка лишається такою, як є: домен і підпис
    const fresh = useBoardStore.getState().getById(objectId) as LinkObject | undefined;
    if (!fresh || fresh.type !== 'link' || fresh.url !== object.url) return;
    useBoardStore.getState().update(objectId, { previewFetchedAt: stamp(), previewFailed: true });
  }
}
