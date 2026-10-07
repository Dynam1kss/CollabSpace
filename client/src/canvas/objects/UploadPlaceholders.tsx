import { Group, Rect, Text } from 'react-konva';
import { FILE_BASE_WIDTH, FILE_PAD } from '../file-layout';
import { LINK_FONT } from '../link-layout';
import { uploadLabel, useUploadStore } from '../upload-store';
import { DEFAULT_INK, inkFor, useCanvasColors, useTheme } from '../../theme';

// картки, яких ще немає в документі: файл саме зараз іде на сервер. Малюються
// поверх полотна й нікуди не синхронізуються — сусіди побачать картку, коли
// файл уже лежатиме на сервері
const HEIGHT = 74;
const BAR_HEIGHT = 6;

export function UploadPlaceholders() {
  const uploads = useUploadStore((s) => s.uploads);
  const colors = useCanvasColors();
  const theme = useTheme();
  const ink = inkFor(DEFAULT_INK, theme);
  if (uploads.length === 0) return null;

  return (
    <>
      {uploads.map((upload) => (
        <Group key={upload.id} x={upload.x} y={upload.y}>
          <Rect
            width={FILE_BASE_WIDTH}
            height={HEIGHT}
            fill={colors.cardBg}
            cornerRadius={10}
            stroke={upload.error ? '#d93025' : colors.cardBorder}
            strokeWidth={1}
            dash={upload.error ? undefined : [6, 4]}
            strokeScaleEnabled={false}
          />
          <Text
            text={upload.name}
            x={FILE_PAD}
            y={FILE_PAD}
            width={FILE_BASE_WIDTH - FILE_PAD * 2}
            fontSize={13}
            fontStyle="bold"
            fontFamily={LINK_FONT}
            fill={ink}
            wrap="none"
            ellipsis
            listening={false}
          />
          <Text
            text={uploadLabel(upload)}
            x={FILE_PAD}
            y={FILE_PAD + 18}
            width={FILE_BASE_WIDTH - FILE_PAD * 2}
            fontSize={11}
            fontFamily={LINK_FONT}
            fill={upload.error ? '#d93025' : colors.label}
            wrap="none"
            ellipsis
            listening={false}
          />
          {!upload.error && (
            <>
              <Rect
                x={FILE_PAD}
                y={HEIGHT - FILE_PAD - BAR_HEIGHT}
                width={FILE_BASE_WIDTH - FILE_PAD * 2}
                height={BAR_HEIGHT}
                cornerRadius={BAR_HEIGHT / 2}
                fill={colors.placeholder}
                listening={false}
              />
              <Rect
                x={FILE_PAD}
                y={HEIGHT - FILE_PAD - BAR_HEIGHT}
                width={(FILE_BASE_WIDTH - FILE_PAD * 2) * Math.min(1, upload.progress)}
                height={BAR_HEIGHT}
                cornerRadius={BAR_HEIGHT / 2}
                fill={colors.accent}
                listening={false}
              />
              {/* «скасувати» — єдине, що тут можна натиснути */}
              <Group
                x={FILE_BASE_WIDTH - FILE_PAD - 16}
                y={FILE_PAD - 2}
                onClick={() => upload.cancel()}
                onTap={() => upload.cancel()}
              >
                <Rect width={20} height={20} cornerRadius={10} fill={colors.placeholder} />
                <Text
                  text="×"
                  width={20}
                  height={20}
                  align="center"
                  verticalAlign="middle"
                  fontSize={15}
                  fontFamily={LINK_FONT}
                  fill={ink}
                  listening={false}
                />
              </Group>
            </>
          )}
        </Group>
      ))}
    </>
  );
}
