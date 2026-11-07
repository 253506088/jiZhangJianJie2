import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type LedgerState,
  MAX_AMOUNT_CENTS,
  createBook,
  createCategoryPath,
  createEmptyState,
  renameCategory,
  setBudget,
  updateSettings,
  upsertAccount,
  upsertTemplate,
  upsertTransaction,
  validateState,
  withLedgerDraft,
} from '../core';
import {
  BACKUP_FORMAT,
  BackupError,
  MAX_BACKUP_FILE_BYTES,
  PBKDF2_ITERATIONS,
  decodeBackup,
  encodeBackup,
  inspectBackup,
  summarizeBackupState,
} from './index';

const NOW = '2026-11-08T05:00:00.000Z';
const PASSWORD = 'fictional-password-for-tests';

function fixture(): LedgerState {
  let sequence = 0;
  const context = { idFactory: () => `backup-fictional-${++sequence}`, now: () => NOW };
  let state = createEmptyState(context);
  const bookId = state.books[0].id;
  const cashId = state.accounts[0].id;
  const category = createCategoryPath(
    state,
    { bookId, direction: 'expense', primaryName: '演示餐饮', secondaryName: '早餐' },
    context,
  );
  state = category.state;
  const bank = upsertAccount(
    state,
    { bookId, name: '演示银行卡', kind: 'bank', openingBalanceCents: 500000 },
    context,
  );
  state = bank.state;
  const input = {
    bookId,
    accountId: cashId,
    categoryId: category.categoryId,
    direction: 'expense' as const,
    amountCents: 1010,
    date: '2018-06-08',
    time: '09:15:30',
    note: '专供备份测试用的虚构备注\n第二行，早餐☕',
  };
  state = upsertTransaction(state, input, context);
  state = upsertTransaction(state, input, context);
  state = withLedgerDraft(state, (draft) => {
    draft.transactions.forEach((transaction, index) => {
      transaction.source = {
        batchId: 'fictional-batch',
        sheet: '演示工作表',
        row: index + 2,
        rawDate: '2018/06/08 09:15:30',
      };
    });
    draft.imports.push({
      id: 'fictional-batch',
      bookId,
      digest: 'c'.repeat(64),
      fileName: 'fictional-export.xls',
      importedAt: NOW,
      totalRows: 2,
      importedRows: 2,
      skippedRows: 0,
      rejectedRows: 0,
      transactionIds: draft.transactions.map((transaction) => transaction.id),
    });
  });
  state = upsertTransaction(
    state,
    {
      bookId,
      accountId: bank.accountId,
      toAccountId: cashId,
      direction: 'transfer',
      amountCents: 20000,
      date: '2026-11-08',
      note: '虚构取现',
    },
    context,
  );
  state = renameCategory(state, category.categoryId, '早点');
  state = setBudget(
    state,
    { bookId, month: '2026-11', categoryId: category.categoryId, amountCents: 50000 },
    context,
  );
  state = upsertTemplate(
    state,
    {
      bookId,
      name: '虚构早点模板',
      direction: 'expense',
      categoryId: category.categoryId,
      accountId: cashId,
      amountCents: 1010,
      note: '仅供自动测试',
    },
    context,
  );
  state = createBook(state, '演示备用账本', context).state;
  return updateSettings(state, { theme: 'dark' });
}

// Independent implementation of the documented sorted-JSON hash for a damaged but checksummed fixture.
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

async function rehashPlain(envelope: Record<string, unknown>): Promise<string> {
  const { integrity: _integrity, ...body } = envelope;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sortedJson(body)));
  envelope.integrity = {
    algorithm: 'SHA-256',
    digest: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
  return JSON.stringify(envelope);
}

let state: LedgerState;
let plainText: string;
let encryptedText: string;
beforeAll(async () => {
  state = fixture();
  plainText = await encodeBackup(state, { createdAt: NOW });
  encryptedText = await encodeBackup(state, { password: PASSWORD, createdAt: NOW });
});

describe('完整明文备份', () => {
  it('往返保存全部分类关系、别名、批次、预算、模板、设置和时间', async () => {
    const decoded = await decodeBackup(plainText);
    expect(decoded.state).toEqual(state);
    expect(() => validateState(decoded.state)).not.toThrow();
    expect(decoded.metadata).toMatchObject({
      format: BACKUP_FORMAT,
      version: 1,
      schemaVersion: 1,
      encrypted: false,
      integrity: 'verified',
      createdAt: NOW,
    });
    expect(decoded.metadata.summary).toMatchObject({
      books: 2,
      accounts: 3,
      categoryAliases: 1,
      transactions: 3,
      imports: 1,
      budgets: 1,
      templates: 1,
      expenseCents: 2020,
      transferCents: 20000,
    });
    expect(decoded.state.transactions[0].time).toBe('09:15:30');
    expect(decoded.state.transactions[0].source?.rawDate).toBe('2018/06/08 09:15:30');
  });
  it('金额日期备注完全相同的独立记录均保留，反复解码不叠加', async () => {
    const first = await decodeBackup(plainText);
    const again = await decodeBackup(plainText);
    expect(first.state.transactions).toHaveLength(3);
    expect(again.state.transactions).toEqual(first.state.transactions);
    expect(first.state.transactions[0].id).not.toBe(first.state.transactions[1].id);
    expect(first.state.transactions[0].amountCents).toBe(1010);
    expect(first.state.transactions[1].amountCents).toBe(1010);
  });
  it('格式探测只返回安全元数据，不能被当作已经验证的账本', () => {
    const inspected = inspectBackup(plainText);
    expect(inspected).toMatchObject({
      encrypted: false,
      passwordRequired: false,
      integrity: 'not-verified',
      version: 1,
    });
    expect(inspected.sizeBytes).toBe(new TextEncoder().encode(plainText).byteLength);
    expect(inspected).not.toHaveProperty('data');
    expect(inspected).not.toHaveProperty('state');
    expect(inspected).not.toHaveProperty('summary');
    expect(JSON.stringify(inspected)).not.toContain('演示餐饮');
  });
  it('不接受被改动的内容、摘要或导出时间', async () => {
    const changedNote = JSON.parse(plainText);
    changedNote.data.transactions[0].note = '篡改后的虚构备注';
    await expect(decodeBackup(JSON.stringify(changedNote))).rejects.toMatchObject({
      code: 'CHECKSUM_MISMATCH',
    });
    const changedDigest = JSON.parse(plainText);
    changedDigest.integrity.digest = '0'.repeat(64);
    await expect(decodeBackup(JSON.stringify(changedDigest))).rejects.toMatchObject({
      code: 'CHECKSUM_MISMATCH',
    });
    const changedTime = JSON.parse(plainText);
    changedTime.createdAt = '2026-11-09T05:00:00.000Z';
    await expect(decodeBackup(JSON.stringify(changedTime))).rejects.toMatchObject({
      code: 'CHECKSUM_MISMATCH',
    });
  });
  it('摘要正确也不能导入错误模型、外键和未来账本版本', async () => {
    const invalidModel = JSON.parse(plainText);
    invalidModel.data.transactions[0].categoryId = 'missing-fictional-category';
    await expect(decodeBackup(await rehashPlain(invalidModel))).rejects.toMatchObject({
      code: 'INVALID_LEDGER',
    });
    const futureModel = JSON.parse(plainText);
    futureModel.data.schemaVersion = 99;
    await expect(decodeBackup(await rehashPlain(futureModel))).rejects.toMatchObject({
      code: 'INVALID_LEDGER',
    });
    const unsupported = JSON.parse(plainText);
    unsupported.version = 2;
    expect(() => inspectBackup(JSON.stringify(unsupported))).toThrow(BackupError);
    await expect(decodeBackup(JSON.stringify(unsupported))).rejects.toMatchObject({
      code: 'UNSUPPORTED_VERSION',
    });
  });
  it('不接受随意JSON、伪造格式、算法、额外顶层字段或无效时间', async () => {
    for (const text of [
      '',
      '{}',
      '[]',
      'null',
      '{',
      JSON.stringify({ ...JSON.parse(plainText), format: 'another-app' }),
      JSON.stringify({ ...JSON.parse(plainText), unexpected: true }),
      JSON.stringify({ ...JSON.parse(plainText), createdAt: '2026-02-30T00:00:00.000Z' }),
    ])
      await expect(decodeBackup(text)).rejects.toBeInstanceOf(BackupError);
    const wrongAlgorithm = JSON.parse(plainText);
    wrongAlgorithm.integrity.algorithm = 'MD5';
    await expect(decodeBackup(JSON.stringify(wrongAlgorithm))).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    });
  });
  it('可接受缩进变化和UTF-8 BOM，而不是把可读格式变化当作数据改变', async () => {
    const formatted = '\ufeff' + JSON.stringify(JSON.parse(plainText), null, 2);
    expect((await decodeBackup(formatted)).state).toEqual(state);
  });
  it('编码前固定快照，调用期间原状态变化不会污染已开始的备份', async () => {
    const changing = structuredClone(state);
    const expected = structuredClone(changing);
    const writing = encodeBackup(changing, { createdAt: NOW });
    changing.transactions[0].note = '备份开始后的虚构变更';
    expect((await decodeBackup(await writing)).state).toEqual(expected);
  });
  it('编码端拒绝无效模型，且不修改调用者对象', async () => {
    const invalid = structuredClone(state);
    invalid.accounts[0].bookId = 'missing-book';
    const before = structuredClone(invalid);
    await expect(encodeBackup(invalid)).rejects.toMatchObject({ code: 'INVALID_LEDGER' });
    expect(invalid).toEqual(before);
  });
});

describe('密码加密备份', () => {
  it('使用所需算法、600000次PBKDF2和随机参数，密文不含密码和账目', async () => {
    const envelope = JSON.parse(encryptedText);
    expect(envelope.kdf).toMatchObject({
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
    });
    expect(envelope.cipher).toMatchObject({ name: 'AES-GCM', keyBits: 256, tagBits: 128 });
    expect(atob(envelope.kdf.salt).length).toBe(16);
    expect(atob(envelope.cipher.iv).length).toBe(12);
    expect(encryptedText).not.toContain(PASSWORD);
    expect(encryptedText).not.toContain('专供备份测试用的虚构备注');
    expect(encryptedText).not.toContain('演示餐饮');
    const second = JSON.parse(await encodeBackup(state, { password: PASSWORD, createdAt: NOW }));
    expect(second.kdf.salt).not.toBe(envelope.kdf.salt);
    expect(second.cipher.iv).not.toBe(envelope.cipher.iv);
    expect(second.ciphertext).not.toBe(envelope.ciphertext);
  });
  it('正确密码完整恢复，但探测不泄漏账本摘要', async () => {
    const inspected = inspectBackup(encryptedText);
    expect(inspected).toMatchObject({
      encrypted: true,
      passwordRequired: true,
      integrity: 'not-verified',
    });
    expect(inspected).not.toHaveProperty('summary');
    const decoded = await decodeBackup(encryptedText, { password: PASSWORD });
    expect(decoded.state).toEqual(state);
    expect(decoded.metadata.integrity).toBe('verified');
    expect(decoded.metadata.summary.expenseCents).toBe(2020);
  });
  it('缺少密码、错误密码或被改动密文不会返回账本', async () => {
    await expect(decodeBackup(encryptedText)).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    await expect(
      decodeBackup(encryptedText, { password: 'incorrect-fictional-password' }),
    ).rejects.toMatchObject({ code: 'DECRYPTION_FAILED' });
    const damaged = JSON.parse(encryptedText);
    damaged.ciphertext = (damaged.ciphertext[0] === 'A' ? 'B' : 'A') + damaged.ciphertext.slice(1);
    await expect(
      decodeBackup(JSON.stringify(damaged), { password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'DECRYPTION_FAILED' });
  });
  it('外层时间和KDF参数受GCM认证保护，不能悄悄修改', async () => {
    const changedTime = JSON.parse(encryptedText);
    changedTime.createdAt = '2026-11-09T05:00:00.000Z';
    await expect(
      decodeBackup(JSON.stringify(changedTime), { password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'DECRYPTION_FAILED' });
    const changedIterations = JSON.parse(encryptedText);
    changedIterations.kdf.iterations = PBKDF2_ITERATIONS + 1;
    await expect(
      decodeBackup(JSON.stringify(changedIterations), { password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'DECRYPTION_FAILED' });
  });
  it('超大工作因子在派生密钥之前拒绝，编码参数也必须有效', async () => {
    const excessive = JSON.parse(encryptedText);
    excessive.kdf.iterations = 9_999_999_999;
    const derive = vi.spyOn(crypto.subtle, 'deriveKey');
    try {
      await expect(
        decodeBackup(JSON.stringify(excessive), { password: PASSWORD }),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMETERS' });
      expect(derive).not.toHaveBeenCalled();
    } finally {
      derive.mockRestore();
    }
    const badIv = JSON.parse(encryptedText);
    badIv.cipher.iv = 'AAAA';
    await expect(decodeBackup(JSON.stringify(badIv), { password: PASSWORD })).rejects.toMatchObject(
      { code: 'INVALID_FORMAT' },
    );
    const badEncoding = JSON.parse(encryptedText);
    badEncoding.ciphertext = '!!!!';
    await expect(
      decodeBackup(JSON.stringify(badEncoding), { password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'INVALID_FORMAT' });
  });
  it('不会因空密码降级为明文，也不会输出密码到错误消息', async () => {
    await expect(encodeBackup(state, { password: '' })).rejects.toMatchObject({
      code: 'PASSWORD_REQUIRED',
    });
    await expect(encodeBackup(state, { password: 'short' })).rejects.toMatchObject({
      code: 'INVALID_PASSWORD',
    });
    await expect(encodeBackup(state, { password: 'x'.repeat(1025) })).rejects.toMatchObject({
      code: 'INVALID_PASSWORD',
    });
    try {
      await decodeBackup(encryptedText, { password: 'bad-password-sensitive-token' });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BackupError);
      expect(String(error)).not.toContain('bad-password-sensitive-token');
    }
  });
});

describe('大小边界和摘要', () => {
  it('有效账本的合计超出JS安全整数时保留精确字符串，不生成失真数字', () => {
    let sequence = 0;
    const context = { idFactory: () => `large-fictional-${++sequence}`, now: () => NOW };
    let large = createEmptyState(context);
    const bookId = large.books[0].id;
    const category = createCategoryPath(
      large,
      { bookId, direction: 'expense', primaryName: '虚构大额边界', secondaryName: '仅自动测试' },
      context,
    );
    large = category.state;
    large.transactions = Array.from({ length: 91_000 }, (_, index) => ({
      id: `boundary-${index}`,
      bookId,
      accountId: large.accounts[0].id,
      categoryId: category.categoryId,
      direction: 'expense',
      toAccountId: null,
      amountCents: MAX_AMOUNT_CENTS,
      date: '2026-11-08',
      note: '',
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const summary = summarizeBackupState(large);
    expect(summary.totalsSafe).toBe(false);
    expect(summary.expenseCents).toBeNull();
    expect(summary.exactTotals.expenseCents).toBe((BigInt(MAX_AMOUNT_CENTS) * 91_000n).toString());
    expect(summary.incomeCents).toBe(0);
  });
  it('超大文件在JSON解析与加密之前被拒绝', () => {
    const tooLarge = ' '.repeat(MAX_BACKUP_FILE_BYTES + 1);
    expect(() => inspectBackup(tooLarge)).toThrow(BackupError);
    try {
      inspectBackup(tooLarge);
    } catch (error) {
      expect(error).toMatchObject({ code: 'FILE_TOO_LARGE' });
    }
  });
  it('空账本也能导出恢复，摘要没有虚构流水', async () => {
    const empty = createEmptyState();
    const decoded = await decodeBackup(await encodeBackup(empty));
    expect(decoded.state).toEqual(empty);
    expect(summarizeBackupState(empty)).toMatchObject({
      books: 1,
      accounts: 1,
      transactions: 0,
      firstDate: null,
      lastDate: null,
      incomeCents: 0,
      expenseCents: 0,
    });
  });
});
