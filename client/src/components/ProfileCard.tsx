import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { colorForUser, initialsOf } from '../canvas/presence-colors';
import { contextRows } from './profile-card';
import { closeProfileCard, useProfileCardStore } from './profile-card-store';

const CARD_WIDTH = 320;
const AVATAR_SIZE = 88;
// щоб картка не прилипала до краю вікна
const EDGE = 12;
const GAP = 10;

// картка живе в порталі на body: відкривають її і з панелей із власним
// z-index, і з полотна, а з overflow: hidden предка вона б обрізалась
export function ProfileCardHost() {
  const open = useProfileCardStore((s) => s.open);
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // esc закриває, як і будь-яку іншу шторку в застосунку
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeProfileCard();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // позицію рахуємо після рендера: висота картки залежить від того, скільки в
  // ній рядків і чи є підпис, наперед її не знати. useLayoutEffect — інакше
  // картка встигає блимнути в лівому верхньому куті
  useLayoutEffect(() => {
    const node = cardRef.current;
    if (!open || !node) {
      setPos(null);
      return;
    }
    const { height } = node.getBoundingClientRect();
    const left = Math.min(Math.max(EDGE, open.at.x - CARD_WIDTH / 2), window.innerWidth - CARD_WIDTH - EDGE);
    // під точкою кліку, а не влізає — над нею
    const below = open.at.y + GAP;
    const top = below + height + EDGE < window.innerHeight ? below : Math.max(EDGE, open.at.y - height - GAP);
    setPos({ left, top });
  }, [open]);

  if (!open) return null;
  const { person, context } = open;
  const rows = contextRows(person, context);

  return createPortal(
    <div className="profile-card-backdrop" onPointerDown={closeProfileCard}>
      <div
        ref={cardRef}
        className="profile-card"
        role="dialog"
        aria-label={person.displayName}
        style={{ width: CARD_WIDTH, ...(pos ?? { left: -9999, top: -9999 }) }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="icon-button profile-card-close"
          title={t('common.close')}
          aria-label={t('common.close')}
          onClick={closeProfileCard}
        >
          ×
        </button>
        {/* звичайний img: анімований gif браузер гортає сам. Ручне
        перемикання кадрів (gif-frames/gif-ticker) потрібне лише на полотні,
        бо konva малює з картинки тільки перший кадр */}
        {person.avatarUrl ? (
          <img
            className="profile-card-avatar"
            src={person.avatarUrl}
            alt=""
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
          />
        ) : (
          <span
            className="profile-card-avatar profile-card-initials"
            style={{ background: colorForUser(person.userId) }}
            aria-hidden
          >
            {initialsOf(person.displayName)}
          </span>
        )}
        <h2 className="profile-card-name">{person.displayName}</h2>
        <span className="profile-card-role">{t(`roles.${context.role}`)}</span>
        {/* без підпису рядок не лишаємо зовсім — порожнє місце виглядало б
        як щось, що не завантажилось */}
        {person.bio && <p className="profile-card-bio">{person.bio}</p>}
        {rows.length > 0 && (
          <dl className="profile-card-rows">
            {rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>,
    document.body,
  );
}
