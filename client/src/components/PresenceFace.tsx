import { useState } from 'react';
import { initialsOf } from '../canvas/presence-colors';

interface Props {
  name: string;
  url: string | null | undefined;
}

// вміст кольорового кружечка присутності: букви завжди, фото — поверх них.
// поки фото вантажиться (чи не завантажилось), видно букви на кольорі людини
export function PresenceFace({ name, url }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <>
      {initialsOf(name)}
      {url && failedUrl !== url && (
        <img
          className="presence-photo"
          src={url}
          alt=""
          draggable={false}
          onError={() => setFailedUrl(url)}
        />
      )}
    </>
  );
}
