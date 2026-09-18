// колір людини — не випадковий і не від сервера, а порахований з userId.
// Тому та сама людина має той самий колір у всіх, на всіх пристроях і після
// перезаходу, хоч clientId у неї щоразу новий
const PALETTE = ['#e8590c', '#c2255c', '#7048e8', '#1c7ed6', '#0ca678', '#2f9e44', '#e67700', '#9c36b5'];

// djb2: дрібна стабільна хеш-функція, аби не тягнути залежність
function hash(text: string) {
  let value = 5381;
  for (let i = 0; i < text.length; i++) {
    value = (value * 33) ^ text.charCodeAt(i);
  }
  return Math.abs(value);
}

export function colorForUser(userId: string) {
  return PALETTE[hash(userId) % PALETTE.length];
}

// ініціали для кружечка: «Іван Олійник» → «ІО», «ivan» → «IV»
export function initialsOf(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
