import { Capacitor, registerPlugin } from '@capacitor/core';
import { MAX_BACKUP_FILE_BYTES } from './codec';

interface LedgerFilesPlugin {
  saveDocument(options: {
    fileName: string;
    mimeType: string;
    content: string;
    encoding?: 'utf8' | 'base64';
  }): Promise<{ cancelled: boolean }>;
}

const nativeFiles = registerPlugin<LedgerFilesPlugin>('LedgerFiles');
const allowedMimeTypes = new Set([
  'application/json',
  'application/octet-stream',
  'text/csv',
  'text/plain',
]);
const allowedBinaryMimeTypes = new Set([
  'application/octet-stream',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export interface TextFileResult {
  cancelled: boolean;
  /** A browser download is requested; only the native result confirms a written document. */
  delivery: 'download' | 'document';
}

function checkedFileName(fileName: string) {
  if (!fileName.trim() || fileName.length > 180 || /[\\/:*?"<>|\u0000-\u001f]/.test(fileName))
    throw new Error('导出文件名不正确。');
}

function beginDownload(blob: Blob, fileName: string): TextFileResult {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('浏览器未能开始下载，请重试或使用安卓客户端导出。');
  } finally {
    anchor.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { cancelled: false, delivery: 'download' };
}

function toBase64(bytes: Uint8Array): string {
  const pieces: string[] = [];
  // Multiples of 3 keep padding limited to the final segment.
  for (let offset = 0; offset < bytes.length; offset += 24_576)
    pieces.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))));
  return pieces.join('');
}

export async function saveBinaryFile(
  bytes: Uint8Array,
  fileName: string,
  mimeType = 'application/octet-stream',
): Promise<TextFileResult> {
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.byteLength ||
    bytes.byteLength > MAX_BACKUP_FILE_BYTES
  )
    throw new Error('导出文件为空或超过 96 MiB 上限。');
  checkedFileName(fileName);
  if (!allowedBinaryMimeTypes.has(mimeType)) throw new Error('不支持这个二进制导出类型。');
  const snapshot = new Uint8Array(bytes);
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await nativeFiles.saveDocument({
        fileName,
        mimeType,
        content: toBase64(snapshot),
        encoding: 'base64',
      });
      if (typeof result.cancelled !== 'boolean') throw new Error('INVALID_NATIVE_RESULT');
      return { cancelled: result.cancelled, delivery: 'document' };
    } catch {
      throw new Error('文件未保存成功。原账本未更改，请检查可用空间或选择其他保存位置后重试。');
    }
  }
  return beginDownload(new Blob([snapshot], { type: mimeType }), fileName);
}

export function backupFileName(encrypted: boolean, now = new Date()): string {
  const part = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
  return `简洁记账-${encrypted ? '加密' : '完整'}备份-${stamp}.jzbackup`;
}

export async function saveTextFile(
  content: string,
  fileName: string,
  mimeType = 'application/json',
): Promise<TextFileResult> {
  if (!content || new TextEncoder().encode(content).byteLength > MAX_BACKUP_FILE_BYTES)
    throw new Error('导出文件为空或超过 96 MiB 上限。');
  checkedFileName(fileName);
  if (!allowedMimeTypes.has(mimeType)) throw new Error('不支持这个导出文件类型。');

  if (Capacitor.isNativePlatform()) {
    try {
      const result = await nativeFiles.saveDocument({ fileName, mimeType, content });
      if (typeof result.cancelled !== 'boolean') throw new Error('INVALID_NATIVE_RESULT');
      return { cancelled: result.cancelled, delivery: 'document' };
    } catch {
      throw new Error('文件未保存成功。原账本未更改，请检查可用空间或选择其他保存位置后重试。');
    }
  }

  return beginDownload(new Blob([content], { type: `${mimeType};charset=utf-8` }), fileName);
}

export async function readBackupFile(file: File): Promise<string> {
  if (!/\.(json|jzbackup)$/i.test(file.name))
    throw new Error(
      '请选择本 App 导出的 .jzbackup 或 .json 完整备份。旧版 .db 请使用“从旧版 .db 初始化”，Excel 请使用导入功能。',
    );
  if (!file.size || file.size > MAX_BACKUP_FILE_BYTES)
    throw new Error('备份文件需为非空且不超过 96 MiB。');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error('无法以 UTF-8 读取这份备份，请选择原始备份文件。');
  }
}

/** Format a verified exact-cent total without converting a large integer to a JS number. */
export function exactMoney(cents: string): string {
  if (!/^-?\d+$/.test(cents)) throw new Error('金额摘要格式不正确。');
  const sign = cents.startsWith('-') ? '−' : '';
  const digits = cents.replace(/^-/, '').padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${whole}.${digits.slice(-2)}`;
}
