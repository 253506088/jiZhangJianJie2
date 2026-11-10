/** Optional local appearance data; kept in complete backups without changing ledger amounts. */
export interface HomeBackground {
  dataUrl: string;
  fit: 'cover' | 'contain';
}

export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;
export const BACKGROUND_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export function backgroundMime(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  const text = String.fromCharCode(...bytes.subarray(0, 12));
  if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) return 'image/gif';
  if (text.startsWith('RIFF') && text.slice(8) === 'WEBP') return 'image/webp';
  return null;
}

export function validHomeBackground(value: unknown): value is HomeBackground {
  if (!value || typeof value !== 'object') return false;
  const { dataUrl, fit } = value as Partial<HomeBackground>;
  if (fit !== 'cover' && fit !== 'contain') return false;
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_BACKGROUND_BYTES / 3) * 4 + 40)
    return false;
  const separator = dataUrl.indexOf(',');
  if (separator < 0) return false;
  const mime = dataUrl.slice(5, separator - 7);
  if (!BACKGROUND_MIME_TYPES.some((item) => dataUrl.startsWith(`data:${item};base64,`)))
    return false;
  const base64 = dataUrl.slice(separator + 1);
  if (!base64.length || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return false;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  if ((base64.length / 4) * 3 - padding > MAX_BACKGROUND_BYTES) return false;
  try {
    const prefix = Uint8Array.from(atob(base64.slice(0, 24)), (char) => char.charCodeAt(0));
    return backgroundMime(prefix) === mime;
  } catch {
    return false;
  }
}
