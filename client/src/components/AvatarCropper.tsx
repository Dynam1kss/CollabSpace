import { useEffect, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { useTranslation } from 'react-i18next';

// аватар завжди квадрат цього розміру: більшого кружечок ніде не показує,
// а 5-мегабайтне фото з телефона на сервері нікому не потрібне
export const AVATAR_SIZE = 512;

interface Props {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

// jpeg лишаємо jpeg (менший), решту — png: у png/webp/gif може бути прозорість.
// gif після кадрування — лише перший кадр, анімація через canvas не проходить
function outputType(file: File) {
  return file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
}

async function renderCrop(src: string, area: Area, type: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('нема 2d-контексту');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error('toBlob віддав null');
  return blob;
}

export function AvatarCropper({ file, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // data url, а не objectURL: той треба відкликати, а подвійний ефект strict
  // mode відкликав би його раніше, ніж картинка встигне завантажитись
  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => setSrc(reader.result as string);
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  async function confirm() {
    if (!src || !area) return;
    setBusy(true);
    setFailed(false);
    try {
      onConfirm(await renderCrop(src, area, outputType(file)));
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="crop-backdrop" role="dialog" aria-modal="true" aria-label={t('settings.cropTitle')}>
      <div className="crop-dialog">
        <h2>{t('settings.cropTitle')}</h2>
        <div className="crop-area">
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              maxZoom={4}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          )}
        </div>
        <label className="crop-zoom">
          {t('settings.cropZoom')}
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        {failed && <p className="form-error">{t('settings.photoFailed')}</p>}
        <div className="crop-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => void confirm()}
            disabled={busy || !area}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
