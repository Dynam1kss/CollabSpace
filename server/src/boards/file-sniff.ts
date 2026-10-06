// тип файла визначаємо за його ПЕРШИМИ БАЙТАМИ, а не за тим, що сказав
// клієнт: заголовок Content-Type підставляє хто завгодно, і саме на ньому
// будуються всі трюки на кшталт «картинка», яка насправді html зі скриптом

const ascii = (buf: Buffer, from: number, length: number) =>
  buf.subarray(from, from + length).toString('latin1');

function looksLikeText(buf: Buffer) {
  // немає нульових байтів і майже все друковане — вважаємо текстом
  const sample = buf.subarray(0, 512);
  if (sample.includes(0)) return false;
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte !== 127)) printable++;
  }
  return sample.length > 0 && printable / sample.length > 0.9;
}

export function sniffMime(buf: Buffer): string {
  if (buf.length >= 8 && ascii(buf, 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && ascii(buf, 0, 6).startsWith('GIF8')) return 'image/gif';
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return 'image/webp';
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WAVE') return 'audio/wav';
  if (buf.length >= 5 && ascii(buf, 0, 5) === '%PDF-') return 'application/pdf';
  if (buf.length >= 12 && ascii(buf, 4, 4) === 'ftyp') {
    const brand = ascii(buf, 8, 4);
    return brand.startsWith('qt') ? 'video/quicktime' : 'video/mp4';
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return 'video/webm';
  }
  if (buf.length >= 4 && ascii(buf, 0, 4) === 'OggS') return 'audio/ogg';
  if (buf.length >= 3 && (ascii(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) {
    return 'audio/mpeg';
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5)) {
    return 'application/zip';
  }
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return 'application/gzip';
  if (buf.length >= 6 && ascii(buf, 0, 6) === '7z\xbc\xaf\x27\x1c') return 'application/x-7z-compressed';

  if (looksLikeText(buf)) {
    const head = buf.subarray(0, 1024).toString('utf8').trimStart().toLowerCase();
    // і svg, і html уміють виконувати скрипти в нашому походженні — обидва
    // мусять бути пізнані, щоб серверна віддача примусила їх завантаженням
    if (head.startsWith('<?xml') && head.includes('<svg')) return 'image/svg+xml';
    if (head.startsWith('<svg')) return 'image/svg+xml';
    if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<script')) {
      return 'text/html';
    }
    return 'text/plain';
  }
  return 'application/octet-stream';
}
