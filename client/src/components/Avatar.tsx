import { colorForUser } from '../canvas/presence-colors';

interface Props {
  userId: string;
  name: string;
  url: string | null;
  size?: number;
}

// фото, а без нього — перша літера на тому ж кольорі, що й курсор людини на дошці
export function Avatar({ userId, name, url, size = 32 }: Props) {
  const style = { width: size, height: size, fontSize: size * 0.45 };
  if (url) return <img className="avatar" src={url} alt="" style={style} />;
  return (
    <span className="avatar avatar-letter" style={{ ...style, background: colorForUser(userId) }} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
