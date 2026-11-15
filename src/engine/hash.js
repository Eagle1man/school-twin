// Стабильная сериализация и sha256 — id прогона.
// Одинаковые входные данные обязаны давать одинаковый id, иначе сравнение
// прогонов и научная воспроизводимость превращаются в обещание.

export const ENGINE_VERSION = '0.1.0';

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

async function nodeSha256(text) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const buf = new TextEncoder().encode(text);
    const digest = await subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return nodeSha256(text);
}

export async function runIdOf(payload) {
  return sha256Hex(canonicalize(payload));
}
