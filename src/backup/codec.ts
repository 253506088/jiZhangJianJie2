import { type LedgerState, SCHEMA_VERSION, validateState } from '../core';

export const BACKUP_FORMAT = 'jizhang-jianjie2-backup' as const;
export const BACKUP_VERSION = 1 as const;
export const BACKUP_FILE_EXTENSION = '.jzbackup';
export const MAX_BACKUP_FILE_BYTES = 96 * 1024 * 1024;
export const MAX_BACKUP_STATE_BYTES = 64 * 1024 * 1024;
export const PBKDF2_ITERATIONS = 600_000;
const MAX_DECRYPTED_BYTES = MAX_BACKUP_STATE_BYTES + 4096;
const MIN_KDF_ITERATIONS = 100_000;
const MAX_KDF_ITERATIONS = 2_000_000;
const MAX_PASSWORD_LENGTH = 1024;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

export type BackupErrorCode =
  | 'INVALID_FORMAT'
  | 'UNSUPPORTED_VERSION'
  | 'FILE_TOO_LARGE'
  | 'INVALID_PARAMETERS'
  | 'PASSWORD_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'DECRYPTION_FAILED'
  | 'CHECKSUM_MISMATCH'
  | 'INVALID_LEDGER'
  | 'CRYPTO_UNAVAILABLE';

export class BackupError extends Error {
  constructor(
    message: string,
    readonly code: BackupErrorCode,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

type Encryption = 'none' | 'aes-256-gcm';
interface Header {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  encryption: Encryption;
}
interface Integrity {
  algorithm: 'SHA-256';
  digest: string;
}
interface Payload {
  data: LedgerState;
  integrity: Integrity;
}
interface PlainEnvelope extends Header, Payload {
  encryption: 'none';
}
interface KeyDerivation {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  salt: string;
}
interface CipherParameters {
  name: 'AES-GCM';
  keyBits: 256;
  iv: string;
  tagBits: 128;
}
interface EncryptedEnvelope extends Header {
  encryption: 'aes-256-gcm';
  kdf: KeyDerivation;
  cipher: CipherParameters;
  ciphertext: string;
}
type Envelope = PlainEnvelope | EncryptedEnvelope;
type Bytes = Uint8Array<ArrayBuffer>;

export interface BackupInspection {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  encryption: Encryption;
  encrypted: boolean;
  passwordRequired: boolean;
  sizeBytes: number;
  /** Inspection alone does not authenticate metadata or check ledger integrity. */
  integrity: 'not-verified';
}

export interface BackupSummary {
  books: number;
  accounts: number;
  primaryCategories: number;
  secondaryCategories: number;
  categoryAliases: number;
  transactions: number;
  imports: number;
  budgets: number;
  templates: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Null if that total cannot be represented as a safe JS integer. Use exactTotals then. */
  incomeCents: number | null;
  expenseCents: number | null;
  transferCents: number | null;
  totalsSafe: boolean;
  exactTotals: { incomeCents: string; expenseCents: string; transferCents: string };
}

export interface BackupMetadata extends Omit<BackupInspection, 'integrity'> {
  integrity: 'verified';
  schemaVersion: typeof SCHEMA_VERSION;
  summary: BackupSummary;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function invalid(message = '文件不是受支持的简洁记账完整备份'): never {
  throw new BackupError(message, 'INVALID_FORMAT');
}

function requireObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
}

function exactKeys(object: Record<string, unknown>, names: string[]) {
  const actual = Object.keys(object);
  if (actual.length !== names.length || actual.some((name) => !names.includes(name))) invalid();
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/** Stable JSON representation for SHA-256 and GCM additional authenticated data. */
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) invalid('备份中的数据层级过深');
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('备份中存在无效数字');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`;
  if (typeof value !== 'object') invalid('备份中存在不支持的数据类型');
  const entries = Object.keys(value)
    .sort()
    .flatMap((key) => {
      const item = (value as Record<string, unknown>)[key];
      // Optional model fields use ordinary JSON omission semantics.
      return item === undefined ? [] : [`${JSON.stringify(key)}:${canonical(item, depth + 1)}`];
    });
  return `{${entries.join(',')}}`;
}

function subtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle)
    throw new BackupError('当前环境无法进行备份加密或完整性校验', 'CRYPTO_UNAVAILABLE');
  return globalThis.crypto.subtle;
}

async function sha256(text: string): Promise<string> {
  const digest = await subtleCrypto().digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameDigest(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let differences = 0;
  for (let i = 0; i < left.length; i++) differences |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return differences === 0;
}

function checkIntegrity(value: unknown): asserts value is Integrity {
  requireObject(value);
  exactKeys(value, ['algorithm', 'digest']);
  if (
    value.algorithm !== 'SHA-256' ||
    typeof value.digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.digest)
  )
    invalid('备份完整性信息格式不正确');
}

function base64Encoded(bytes: Bytes): string {
  // Chunk lengths are multiples of three: only the final chunk may contain padding.
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 24_576) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))));
  }
  return chunks.join('');
}

function base64Length(value: unknown, maximum: number, exact?: number): number {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    value.length > Math.ceil(maximum / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    invalid('备份中的编码数据格式不正确');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const size = (value.length / 4) * 3 - padding;
  if (size > maximum || (exact !== undefined && size !== exact))
    invalid('备份中的编码数据长度不正确');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const last = alphabet.indexOf(value[value.length - padding - 1]);
  if ((padding === 2 && (last & 15) !== 0) || (padding === 1 && (last & 3) !== 0))
    invalid('备份中的编码数据不规范');
  return size;
}

function base64Decoded(value: string, maximum: number, exact?: number): Bytes {
  const result = new Uint8Array(base64Length(value, maximum, exact));
  let position = 0;
  try {
    for (let offset = 0; offset < value.length; offset += 32_768) {
      const chunk = atob(value.slice(offset, offset + 32_768));
      for (let i = 0; i < chunk.length; i++) result[position++] = chunk.charCodeAt(i);
    }
  } catch {
    invalid('备份中的编码数据无法读取');
  }
  return result;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    invalid('文件不是有效的 JSON 备份');
  }
}

function headerOf(envelope: Header): Header {
  return {
    format: envelope.format,
    version: envelope.version,
    createdAt: envelope.createdAt,
    encryption: envelope.encryption,
  };
}

function parseEnvelope(text: string): { envelope: Envelope; sizeBytes: number } {
  if (typeof text !== 'string') invalid();
  if (text.length > MAX_BACKUP_FILE_BYTES)
    throw new BackupError('备份文件超过 96 MiB 上限', 'FILE_TOO_LARGE');
  const sizeBytes = encoder.encode(text).byteLength;
  if (sizeBytes > MAX_BACKUP_FILE_BYTES)
    throw new BackupError('备份文件超过 96 MiB 上限', 'FILE_TOO_LARGE');
  const value = parseJson(text);
  requireObject(value);
  if (value.format !== BACKUP_FORMAT) invalid();
  if (value.version !== BACKUP_VERSION)
    throw new BackupError('备份版本不受支持，请使用匹配版本的应用', 'UNSUPPORTED_VERSION');
  if (!validTimestamp(value.createdAt)) invalid('备份导出时间格式不正确');
  if (value.encryption === 'none') {
    exactKeys(value, ['format', 'version', 'createdAt', 'encryption', 'data', 'integrity']);
    requireObject(value.data);
    checkIntegrity(value.integrity);
  } else if (value.encryption === 'aes-256-gcm') {
    exactKeys(value, [
      'format',
      'version',
      'createdAt',
      'encryption',
      'kdf',
      'cipher',
      'ciphertext',
    ]);
    requireObject(value.kdf);
    requireObject(value.cipher);
    exactKeys(value.kdf, ['name', 'hash', 'iterations', 'salt']);
    exactKeys(value.cipher, ['name', 'keyBits', 'iv', 'tagBits']);
    if (
      value.kdf.name !== 'PBKDF2' ||
      value.kdf.hash !== 'SHA-256' ||
      !Number.isSafeInteger(value.kdf.iterations) ||
      (value.kdf.iterations as number) < MIN_KDF_ITERATIONS ||
      (value.kdf.iterations as number) > MAX_KDF_ITERATIONS
    )
      throw new BackupError('备份的密钥派生参数不受支持', 'INVALID_PARAMETERS');
    if (
      value.cipher.name !== 'AES-GCM' ||
      value.cipher.keyBits !== 256 ||
      value.cipher.tagBits !== 128
    )
      throw new BackupError('备份的加密参数不受支持', 'INVALID_PARAMETERS');
    base64Length(value.kdf.salt, SALT_BYTES, SALT_BYTES);
    base64Length(value.cipher.iv, IV_BYTES, IV_BYTES);
    if (base64Length(value.ciphertext, MAX_DECRYPTED_BYTES + GCM_TAG_BYTES) < GCM_TAG_BYTES)
      invalid('加密备份内容不完整');
  } else invalid('备份加密类型不受支持');
  return { envelope: value as unknown as Envelope, sizeBytes };
}

function inspectionOf(envelope: Header, sizeBytes: number): BackupInspection {
  return {
    ...headerOf(envelope),
    encrypted: envelope.encryption !== 'none',
    passwordRequired: envelope.encryption !== 'none',
    sizeBytes,
    integrity: 'not-verified',
  };
}

/** Unauthenticated metadata only. No ledger values are returned, even for a plaintext file. */
export function inspectBackup(text: string): BackupInspection {
  const { envelope, sizeBytes } = parseEnvelope(text);
  return inspectionOf(envelope, sizeBytes);
}

function validatePassword(password: unknown, creating: boolean): asserts password is string {
  if (password === undefined || password === '')
    throw new BackupError('该备份需要密码', 'PASSWORD_REQUIRED');
  if (
    typeof password !== 'string' ||
    password.length > MAX_PASSWORD_LENGTH ||
    (creating && password.length < 8)
  )
    throw new BackupError('备份密码需要 8 至 1024 个字符', 'INVALID_PASSWORD');
}

async function deriveKey(
  password: string,
  kdf: KeyDerivation,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const material = await subtleCrypto().importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtleCrypto().deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: kdf.iterations,
      salt: base64Decoded(kdf.salt, SALT_BYTES, SALT_BYTES),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

function additionalData(envelope: Pick<EncryptedEnvelope, keyof Header | 'kdf' | 'cipher'>): Bytes {
  return encoder.encode(
    canonical({ ...headerOf(envelope), kdf: envelope.kdf, cipher: envelope.cipher }),
  );
}

function checkModel(value: unknown): asserts value is LedgerState {
  try {
    validateState(value);
  } catch {
    throw new BackupError('备份中的账本结构或关联关系无效，未恢复任何数据', 'INVALID_LEDGER');
  }
}

function checkStateSize(state: LedgerState): void {
  if (encoder.encode(canonical(state)).byteLength > MAX_BACKUP_STATE_BYTES)
    throw new BackupError('账本内容超过 64 MiB 备份上限', 'FILE_TOO_LARGE');
}

function finalText(envelope: Envelope): string {
  const text = JSON.stringify(envelope);
  if (encoder.encode(text).byteLength > MAX_BACKUP_FILE_BYTES)
    throw new BackupError('备份文件超过 96 MiB 上限', 'FILE_TOO_LARGE');
  return text;
}

export interface EncodeBackupOptions {
  /** Omit for plaintext. An empty supplied password is rejected, never downgraded to plaintext. */
  password?: string;
  createdAt?: string;
}

/** Takes an immutable snapshot before awaiting crypto. It does not write files or log data. */
export async function encodeBackup(
  state: LedgerState,
  options: EncodeBackupOptions = {},
): Promise<string> {
  checkModel(state);
  let snapshot: LedgerState;
  try {
    snapshot = structuredClone(state);
  } catch {
    throw new BackupError('账本包含无法备份的数据', 'INVALID_LEDGER');
  }
  checkModel(snapshot);
  checkStateSize(snapshot);
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (!validTimestamp(createdAt)) throw new BackupError('备份导出时间不正确', 'INVALID_PARAMETERS');
  const encrypted = options.password !== undefined;
  if (encrypted) validatePassword(options.password, true);
  const header: Header = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    encryption: encrypted ? 'aes-256-gcm' : 'none',
  };
  const integrity: Integrity = {
    algorithm: 'SHA-256',
    digest: await sha256(canonical({ ...header, data: snapshot })),
  };
  if (!encrypted) return finalText({ ...header, encryption: 'none', data: snapshot, integrity });

  const kdf: KeyDerivation = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: base64Encoded(crypto.getRandomValues(new Uint8Array(SALT_BYTES))),
  };
  const cipher: CipherParameters = {
    name: 'AES-GCM',
    keyBits: 256,
    iv: base64Encoded(crypto.getRandomValues(new Uint8Array(IV_BYTES))),
    tagBits: 128,
  };
  const aad = { ...header, encryption: 'aes-256-gcm' as const, kdf, cipher };
  const plaintext = encoder.encode(JSON.stringify({ data: snapshot, integrity }));
  if (plaintext.byteLength > MAX_DECRYPTED_BYTES)
    throw new BackupError('账本内容超过加密备份上限', 'FILE_TOO_LARGE');
  const key = await deriveKey(options.password!, kdf, 'encrypt');
  const ciphertext = await subtleCrypto().encrypt(
    {
      name: 'AES-GCM',
      iv: base64Decoded(cipher.iv, IV_BYTES, IV_BYTES),
      tagLength: 128,
      additionalData: additionalData(aad),
    },
    key,
    plaintext,
  );
  return finalText({ ...aad, ciphertext: base64Encoded(new Uint8Array(ciphertext)) });
}

/** Summary for an on-device confirmation screen only. This function never logs the result. */
export function summarizeBackupState(state: LedgerState): BackupSummary {
  checkModel(state);
  let income = 0n;
  let expense = 0n;
  let transfer = 0n;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  for (const transaction of state.transactions) {
    if (firstDate === null || transaction.date < firstDate) firstDate = transaction.date;
    if (lastDate === null || transaction.date > lastDate) lastDate = transaction.date;
    if (transaction.direction === 'income') income += BigInt(transaction.amountCents);
    else if (transaction.direction === 'expense') expense += BigInt(transaction.amountCents);
    else transfer += BigInt(transaction.amountCents);
  }
  const safeValue = (value: bigint) =>
    value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  const incomeCents = safeValue(income);
  const expenseCents = safeValue(expense);
  const transferCents = safeValue(transfer);
  return {
    books: state.books.length,
    accounts: state.accounts.length,
    primaryCategories: state.categories.filter((category) => category.parentId === null).length,
    secondaryCategories: state.categories.filter((category) => category.parentId !== null).length,
    categoryAliases: state.categoryAliases.length,
    transactions: state.transactions.length,
    imports: state.imports.length,
    budgets: state.budgets.length,
    templates: state.templates.length,
    firstDate,
    lastDate,
    incomeCents,
    expenseCents,
    transferCents,
    totalsSafe: incomeCents !== null && expenseCents !== null && transferCents !== null,
    exactTotals: {
      incomeCents: income.toString(),
      expenseCents: expense.toString(),
      transferCents: transfer.toString(),
    },
  };
}

export async function decodeBackup(
  text: string,
  options: { password?: string } = {},
): Promise<{ state: LedgerState; metadata: BackupMetadata }> {
  const { envelope, sizeBytes } = parseEnvelope(text);
  let payload: Payload;
  if (envelope.encryption === 'none') payload = envelope;
  else {
    validatePassword(options.password, false);
    const key = await deriveKey(options.password, envelope.kdf, 'decrypt');
    let decrypted: ArrayBuffer;
    try {
      decrypted = await subtleCrypto().decrypt(
        {
          name: 'AES-GCM',
          iv: base64Decoded(envelope.cipher.iv, IV_BYTES, IV_BYTES),
          tagLength: 128,
          additionalData: additionalData(envelope),
        },
        key,
        base64Decoded(envelope.ciphertext, MAX_DECRYPTED_BYTES + GCM_TAG_BYTES),
      );
    } catch {
      throw new BackupError('无法解密备份：密码不正确或文件已损坏', 'DECRYPTION_FAILED');
    }
    if (decrypted.byteLength > MAX_DECRYPTED_BYTES)
      throw new BackupError('解密内容超过支持上限', 'FILE_TOO_LARGE');
    let inner: unknown;
    try {
      inner = parseJson(decoder.decode(decrypted));
    } catch {
      throw new BackupError('解密内容不是有效的账本备份', 'INVALID_FORMAT');
    }
    requireObject(inner);
    exactKeys(inner, ['data', 'integrity']);
    requireObject(inner.data);
    checkIntegrity(inner.integrity);
    payload = inner as unknown as Payload;
  }
  checkIntegrity(payload.integrity);
  checkModel(payload.data);
  checkStateSize(payload.data);
  const expected = await sha256(canonical({ ...headerOf(envelope), data: payload.data }));
  if (!sameDigest(expected, payload.integrity.digest))
    throw new BackupError('备份完整性校验失败，文件可能已被修改或损坏', 'CHECKSUM_MISMATCH');
  return {
    state: payload.data,
    metadata: {
      ...inspectionOf(envelope, sizeBytes),
      integrity: 'verified',
      schemaVersion: SCHEMA_VERSION,
      summary: summarizeBackupState(payload.data),
    },
  };
}
