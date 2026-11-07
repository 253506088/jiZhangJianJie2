import 'fake-indexeddb/auto';
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import * as migrations from './migrations';
import { legacyV1Fixture } from './testing/v1-fixture';
import { createEmptyState, validateState } from './model';
import { updateSettings } from './commands';
import { IndexedDbStorage } from '../storage/indexed-db';
import { LedgerRepository, sha256, unpack } from '../storage/repository';
import { StorageIntegrityError } from '../storage/types';
import { BACKUP_FORMAT, decodeBackup, encodeBackup } from '../backup/codec';

const NOW = '2026-11-08T02:00:00.000Z';
const PASSWORD = 'fictional-legacy-backup-password';
const encoder = new TextEncoder();

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

async function oldBackup(data: unknown, encrypted = false): Promise<string> {
  const header = {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: NOW,
    encryption: encrypted ? 'aes-256-gcm' : 'none',
  };
  const integrity = { algorithm: 'SHA-256', digest: await sha256(canonical({ ...header, data })) };
  if (!encrypted) return JSON.stringify({ ...header, data, integrity });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kdf = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: 600000,
    salt: Buffer.from(salt).toString('base64'),
  };
  const cipher = {
    name: 'AES-GCM',
    keyBits: 256,
    iv: Buffer.from(iv).toString('base64'),
    tagBits: 128,
  };
  const metadata = { ...header, kdf, cipher };
  const material = await crypto.subtle.importKey('raw', encoder.encode(PASSWORD), 'PBKDF2', false, [
    'deriveKey',
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128, additionalData: encoder.encode(canonical(metadata)) },
    key,
    encoder.encode(JSON.stringify({ data, integrity })),
  );
  return JSON.stringify({ ...metadata, ciphertext: Buffer.from(ciphertext).toString('base64') });
}

describe('schema v1 → v2的无损迁移', () => {
  it('保留所有旧ID、数组、金额、时间、来源行与重复流水，不把旧记录伪造为自己', () => {
    const legacy = legacyV1Fixture();
    const before = structuredClone(legacy);
    const next = migrations.migrateState(legacy);
    expect(next.schemaVersion).toBe(2);
    for (const field of [
      'books',
      'accounts',
      'categories',
      'categoryAliases',
      'imports',
      'budgets',
    ] as const)
      expect(next[field]).toEqual(legacy[field]);
    expect(
      next.transactions.map(({ memberId, loanType, personId, ...original }) => original),
    ).toEqual(legacy.transactions);
    expect(next.templates.map(({ memberId, ...original }) => original)).toEqual(legacy.templates);
    for (const transaction of next.transactions) {
      const member = next.members.find((item) => item.id === transaction.memberId)!;
      expect(member).toMatchObject({
        kind: 'unspecified',
        name: '未指定',
        bookId: transaction.bookId,
      });
      expect(transaction.loanType).toBeNull();
      expect(transaction.personId).toBeNull();
    }
    for (const template of next.templates)
      expect(next.members.find((item) => item.id === template.memberId)?.kind).toBe('unspecified');
    expect(next.members.filter((item) => item.kind === 'self')).toHaveLength(2);
    expect(next.settings).toEqual({
      ...legacy.settings,
      homeLayout: 'classic',
      accentColor: 'coral',
    });
    expect(legacy).toEqual(before);
    expect(next.transactions[0].id).not.toBe(next.transactions[1].id);
    expect(() => validateState(next)).not.toThrow();
  });

  it('迁移可重复得到相同身份，v2读取不重新生成成员或改布局', () => {
    const legacy = legacyV1Fixture();
    const first = migrations.migrateState(legacy);
    expect(migrations.migrateState(legacy)).toEqual(first);
    expect(migrations.migrateState(first)).toEqual(first);
    const empty = createEmptyState();
    expect(empty.settings).toMatchObject({ homeLayout: 'overview', accentColor: 'blue' });
    expect(empty.members).toHaveLength(1);
    expect(empty.members[0]).toMatchObject({ name: '自己', kind: 'self' });
    expect(migrations.migrateState(empty)).toEqual(empty);
  });

  it('旧数据必须先通过v1规则，错误外键/来源和未来版本不能靠迁移修复', () => {
    const broken = legacyV1Fixture();
    broken.transactions[0].accountId = 'missing';
    const before = structuredClone(broken);
    expect(() => migrations.migrateState(broken)).toThrow();
    expect(broken).toEqual(before);
    expect(() => migrations.migrateState({ ...legacyV1Fixture(), schemaVersion: 3 })).toThrow();
    const next = migrations.migrateState(legacyV1Fixture());
    next.transactions[0].memberId = null;
    expect(() => migrations.migrateState(next)).toThrow();
  });
});

describe('旧数据库摘要先校验，迁移在内存进行', () => {
  it('load不重写原始v1快照，下一次提交才写v2并保留旧保存点', async () => {
    const data = JSON.stringify(legacyV1Fixture());
    const snapshot = { revision: 1, savedAt: NOW, data, sha256: await sha256(data) };
    const storage = new IndexedDbStorage(`migration-${crypto.randomUUID()}`);
    await storage.write(snapshot, 0);
    const repository = new LedgerRepository(storage);
    try {
      const loaded = await repository.load();
      expect(loaded.state.schemaVersion).toBe(2);
      expect(loaded.revision).toBe(1);
      expect(await storage.read()).toEqual(snapshot);
      await repository.mutate((state) => updateSettings(state, { accentColor: 'green' }));
      expect(JSON.parse((await storage.read())!.data).schemaVersion).toBe(2);
      expect((await storage.history())[0]).toEqual(snapshot);
      const points = await repository.recoveryPoints();
      expect(points[0].state.schemaVersion).toBe(2);
      expect(points[0].state.settings.accentColor).toBe('coral');
    } finally {
      await repository.close();
    }
  });

  it('原始摘要不匹配时不调用迁移，也不覆盖损坏数据', async () => {
    const data = JSON.stringify(legacyV1Fixture());
    const snapshot = { revision: 1, savedAt: NOW, data, sha256: '0'.repeat(64) };
    const migration = vi.spyOn(migrations, 'migrateState');
    try {
      await expect(unpack(snapshot)).rejects.toBeInstanceOf(StorageIntegrityError);
      expect(migration).not.toHaveBeenCalled();
    } finally {
      migration.mockRestore();
    }
  });
});

describe('原格式备份先认证原payload，再迁移', () => {
  it('兼容真实v1协议的明文备份，恢复到v2后再导出保持一致', async () => {
    const legacy = legacyV1Fixture();
    const decoded = await decodeBackup(await oldBackup(legacy));
    expect(decoded.state).toEqual(migrations.migrateState(legacy));
    expect(decoded.metadata).toMatchObject({
      schemaVersion: 2,
      sourceSchemaVersion: 1,
      migrated: true,
      integrity: 'verified',
    });
    const roundTrip = await decodeBackup(await encodeBackup(decoded.state, { createdAt: NOW }));
    expect(roundTrip.state).toEqual(decoded.state);
    expect(roundTrip.metadata).toMatchObject({
      schemaVersion: 2,
      sourceSchemaVersion: 2,
      migrated: false,
    });
  });

  it('兼容v1加密备份，不需要改变旧密码或重算其原始摘要', async () => {
    const legacy = legacyV1Fixture();
    const text = await oldBackup(legacy, true);
    const result = await decodeBackup(text, { password: PASSWORD });
    expect(result.state).toEqual(migrations.migrateState(legacy));
    expect(result.metadata).toMatchObject({
      sourceSchemaVersion: 1,
      migrated: true,
      encrypted: true,
    });
    await expect(decodeBackup(text, { password: 'not-the-password' })).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });
  });

  it('摘要篡改优先拒绝；即使摘要有效，损坏的v1关系也不能迁移', async () => {
    const text = await oldBackup(legacyV1Fixture());
    const tampered = JSON.parse(text);
    tampered.data.transactions[0].accountId = 'tampered';
    await expect(decodeBackup(JSON.stringify(tampered))).rejects.toMatchObject({
      code: 'CHECKSUM_MISMATCH',
    });
    const broken = legacyV1Fixture();
    broken.transactions[0].accountId = 'missing';
    await expect(decodeBackup(await oldBackup(broken))).rejects.toMatchObject({
      code: 'INVALID_LEDGER',
    });
  });
});
