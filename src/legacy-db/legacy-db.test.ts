import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import fixture from '../../tests/fixtures/legacy-4.8.8-db.json';
import deletionFixture from '../../tests/fixtures/legacy-4.8.8-db-after-delete.json';
import { readLegacyDatabase } from './read';
import { applyLegacyDatabase, prepareLegacyDatabase } from './prepare';
import { createEmptyState, validateState } from '../core/model';
import { accountBalance } from '../core/selectors';
import type { LegacyDatabase, LegacyRow } from './types';
import { validLegacyDbMetadata } from '../core/legacy-db-metadata';
import { decodeBackup, encodeBackup } from '../backup/codec';
import { readWorkbookBytes } from '../imports/workbook';
import { reconcileLegacyWorkbook } from '../reconciliation/model';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs({
    wasmBinary: Uint8Array.from(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm')).buffer,
  });
});
function source(): LegacyDatabase {
  return {
    fileName: 'legacy-synthetic.db',
    digest: fixture.sourceSha256,
    userVersion: fixture.userVersion,
    tables: structuredClone(
      Object.fromEntries(Object.entries(fixture.tables).map(([key, value]) => [key, value.rows])),
    ) as Record<string, LegacyRow[]>,
  };
}
function bytes(mutator?: (db: InstanceType<SqlJsStatic['Database']>) => void) {
  const db = new SQL.Database();
  for (const [table, value] of Object.entries(fixture.tables))
    if (table !== 'sqlite_sequence') db.run(value.sql);
  for (const [table, value] of Object.entries(fixture.tables)) {
    if (table === 'sqlite_sequence') continue;
    for (const row of value.rows)
      db.run(
        `INSERT INTO "${table}" VALUES (${Object.keys(row)
          .map(() => '?')
          .join(',')})`,
        Object.values(row),
      );
  }
  db.run('PRAGMA user_version=16');
  mutator?.(db);
  const result = db.export();
  db.close();
  return result;
}
const context = { now: () => '2026-11-10T08:00:00.000Z' };

describe('legacy .db migration', () => {
  it('imports a normally deleted legacy ledger without reviving the deleted record', () => {
    const data = source();
    expect(deletionFixture.baseSha256).toBe(fixture.sourceSha256);
    data.digest = deletionFixture.sourceSha256;
    data.tables = { ...data.tables, ...structuredClone(deletionFixture.tables) } as Record<
      string,
      LegacyRow[]
    >;
    const plan = prepareLegacyDatabase(data, context);
    expect(plan.state.transactions).toHaveLength(11);
    expect(plan.totals.expense).toEqual({ count: 3, cents: 2321 });
    expect(
      plan.state.transactions.some((t) => t.direction === 'expense' && t.source?.row === 3),
    ).toBe(false);
    expect(plan.state.imports[0].legacyDb?.tables.delete_item).toEqual([
      { id: 1, time_span: '1794085377452' },
    ]);
    const bank = plan.state.accounts.find((a) => a.name === '储蓄卡')!;
    expect(bank.openingBalanceCents).toBe(0);
    expect(accountBalance(plan.state, bank.id)).toBe(19129);
    const originalWorkbook = readFileSync(
      new URL('../../tests/fixtures/legacy-4.8.8-annual-12.xls', import.meta.url),
    );
    const workbook = {
      ...readWorkbookBytes(Uint8Array.from(originalWorkbook).buffer, 'original-annual.xls'),
      digest: createHash('sha256').update(originalWorkbook).digest('hex'),
    };
    const comparison = reconcileLegacyWorkbook(plan.state, workbook, {
      bookId: plan.state.books[0].id,
      year: 2026,
    });
    expect(comparison).toMatchObject({
      passed: false,
      legacyCount: 12,
      currentCount: 11,
      matchedCount: 11,
    });
    expect(comparison.differences.map((d) => d.kind)).toEqual(['missing']);
  });
  it('matches all 12 database records against the unmodified original annual Excel export', () => {
    const databaseBytes = bytes();
    const database = readLegacyDatabase(
      SQL,
      databaseBytes,
      'synthetic-original-schema.db',
      createHash('sha256').update(databaseBytes).digest('hex'),
    );
    const state = prepareLegacyDatabase(database, context).state;
    const originalWorkbook = readFileSync(
      new URL('../../tests/fixtures/legacy-4.8.8-annual-12.xls', import.meta.url),
    );
    const digest = createHash('sha256').update(originalWorkbook).digest('hex');
    expect(digest).toBe('4c0db1de5bfa727d1281718fc1c06c518680d83c0b3db2147d77cceb38460f19');
    const workbook = {
      ...readWorkbookBytes(Uint8Array.from(originalWorkbook).buffer, 'legacy-4.8.8-annual-12.xls'),
      digest,
    };
    expect(workbook.sheets.map((sheet) => sheet.rows[1][1])).toEqual(
      Array(4).fill('2026-01-01 - 2027-01-01'),
    );
    const before = structuredClone(state);
    const result = reconcileLegacyWorkbook(state, workbook, {
      bookId: state.books[0].id,
      year: 2026,
    });
    expect(result).toMatchObject({
      passed: true,
      legacyCount: 12,
      currentCount: 12,
      matchedCount: 12,
      differences: [],
      blockers: [],
    });
    expect(result.counts).toEqual({
      expense: { legacy: 4, current: 4, matched: 4 },
      income: { legacy: 2, current: 2, matched: 2 },
      transfer: { legacy: 1, current: 1, matched: 1 },
      loan: { legacy: 5, current: 5, matched: 5 },
    });
    expect(state).toEqual(before);
  });
  it('reads a SQLite database rebuilt from the exact synthetic original export schema', () => {
    const result = readLegacyDatabase(SQL, bytes(), 'synthetic.db', fixture.sourceSha256);
    expect(result.userVersion).toBe(16);
    expect(result.tables.expenses).toEqual(source().tables.expenses);
    expect(result.tables.borrow).toHaveLength(5);
  });
  it('imports all four detail tables once, preserving full category paths, members and budgets', () => {
    const plan = prepareLegacyDatabase(source(), context);
    expect(plan.state.transactions).toHaveLength(12);
    expect(plan.totals).toEqual({
      expense: { count: 4, cents: 2421 },
      income: { count: 2, cents: 20000 },
      transfer: { count: 1, cents: 550 },
      loan: { count: 5, cents: 10300 },
    });
    expect(plan.state.budgets.map((b) => [b.period, b.amountCents])).toEqual([
      ['month', 300000],
      ['week', 70000],
      ['day', 5000],
    ]);
    expect(plan.state.categories.filter((c) => c.name === 'FixtureBreakfast')).toHaveLength(1);
    expect(plan.state.categories.some((c) => c.name === '常用')).toBe(false);
    expect(
      plan.state.transactions.filter((t) => t.direction === 'loan').map((t) => t.loanType),
    ).toEqual(['borrow', 'lend', 'repay', 'collect', 'borrow']);
    expect(plan.state.imports[0].legacyDb?.tables).toEqual(source().tables);
    expect(() => validateState(plan.state)).not.toThrow();
  });
  it('reconciles each stored account balance and derives opening balances rather than double counting', () => {
    const data = source();
    data.tables.account_type[0].money = '240.29';
    const state = prepareLegacyDatabase(data, context).state;
    const bank = state.accounts.find((a) => a.name === '储蓄卡')!;
    const cash = state.accounts.find((a) => a.name === '现金')!;
    expect(bank.openingBalanceCents).toBe(5000);
    expect(accountBalance(state, bank.id)).toBe(24029);
    expect(accountBalance(state, cash.id)).toBe(4050);
  });
  it('adds a separate book and preserves existing settings, records and source metadata across serialization', () => {
    const current = createEmptyState();
    current.settings.accentColor = 'pink';
    const before = structuredClone(current);
    const plan = prepareLegacyDatabase(source(), context);
    const result = applyLegacyDatabase(current, plan, '从旧版迁入');
    expect(current).toEqual(before);
    expect(result.books).toHaveLength(2);
    expect(result.settings.accentColor).toBe('pink');
    expect(result.settings.selectedBookId).toBe(plan.state.books[0].id);
    expect(() => validateState(JSON.parse(JSON.stringify(result)))).not.toThrow();
    expect(result.imports[0].legacyDb?.tables.expenses[0].time_span).toBe(
      source().tables.expenses[0].time_span,
    );
  });
  it('rejects repeated file imports even if imported entries were later removed', () => {
    const plan = prepareLegacyDatabase(source(), context);
    const result = applyLegacyDatabase(createEmptyState(), plan, '旧版');
    result.transactions = [];
    expect(() => applyLegacyDatabase(result, plan, '另一本')).toThrow('已经导入');
  });
  it('retains separate records with identical visible content', () => {
    const data = source();
    const row = { ...data.tables.expenses[0], id: 99 };
    data.tables.expenses.push(row);
    data.tables.time_sequence.push({ ...data.tables.time_sequence[0], id: 99 });
    const result = prepareLegacyDatabase(data, context);
    expect(result.totals.expense).toEqual({ count: 5, cents: 3421 });
    expect(result.state.transactions.filter((t) => t.amountCents === 1000)).toHaveLength(3);
  });
  it('keeps identically named child categories separate under different parents', () => {
    const data = source();
    data.tables.expenses_right.push({
      id: 99,
      key: '交通',
      value: 'FixtureBreakfast',
      usually_key: null,
      updateTime: 0,
    });
    const state = prepareLegacyDatabase(data, context).state;
    const leaves = state.categories.filter((c) => c.name === 'FixtureBreakfast');
    expect(leaves).toHaveLength(2);
    expect(leaves[0].parentId).not.toBe(leaves[1].parentId);
  });
  it('rejects unknown SQLite versions and non-SQLite payloads', () => {
    expect(() =>
      readLegacyDatabase(
        SQL,
        bytes((db) => db.run('PRAGMA user_version=99')),
        'x.db',
        fixture.sourceSha256,
      ),
    ).toThrow('尚未验证');
    expect(() =>
      readLegacyDatabase(SQL, new TextEncoder().encode('not sqlite'), 'x.db', fixture.sourceSha256),
    ).toThrow('不是可识别');
  });
  it('rejects missing or extended schemas instead of silently ignoring tables', () => {
    expect(() =>
      readLegacyDatabase(
        SQL,
        bytes((db) => db.run('DROP TABLE budget')),
        'x.db',
        fixture.sourceSha256,
      ),
    ).toThrow('表不完整');
    expect(() =>
      readLegacyDatabase(
        SQL,
        bytes((db) => db.run('CREATE TABLE extra(amount)')),
        'x.db',
        fixture.sourceSha256,
      ),
    ).toThrow('未验证');
    expect(() =>
      readLegacyDatabase(
        SQL,
        bytes((db) => db.run('CREATE VIEW secret AS SELECT 1')),
        'x.db',
        fixture.sourceSha256,
      ),
    ).toThrow('未验证');
  });
  it('rejects unknown loan directions without echoing private values', () => {
    const data = source();
    data.tables.borrow[0].type_detail = 'PRIVATE_UNKNOWN';
    expect(() => prepareLegacyDatabase(data, context)).toThrow('borrow 表第 1 条记录');
    try {
      prepareLegacyDatabase(data, context);
    } catch (error) {
      expect(String(error)).not.toContain('PRIVATE_UNKNOWN');
    }
  });
  it('rejects invalid money and inconsistent ledger indexes atomically', () => {
    const data = source();
    data.tables.expenses[0].money = '1.234';
    expect(() => prepareLegacyDatabase(data, context)).toThrow('金额');
    const mismatch = source();
    mismatch.tables.time_sequence.pop();
    expect(() => prepareLegacyDatabase(mismatch, context)).toThrow('没有索引');
  });
  it('refuses unverified nonempty automatic-charge financial data', () => {
    const data = source();
    data.tables.auto_charge.push({ ...data.tables.borrow[0] });
    expect(() => prepareLegacyDatabase(data, context)).toThrow('自动记账');
  });
  it('retains non-executable template and reminder data with explicit warnings', () => {
    const data = source();
    data.tables.template.push({
      id: 1,
      name: 'Fake',
      uri: null,
      account_type: 'expenses',
      info: '{"fixture":true}',
      update_time: '0',
      use_time: '0',
    });
    const plan = prepareLegacyDatabase(data, context);
    expect(plan.warnings.some((w) => w.includes('1 个记账模板'))).toBe(true);
    expect(plan.state.imports[0].legacyDb?.tables.template).toEqual(data.tables.template);
  });
  it('detects invalid archived source metadata and rejects conflicting book names', () => {
    expect(
      validLegacyDbMetadata({
        format: 'jianjie-4.8.8',
        userVersion: 16,
        tables: { expenses: [{ id: Infinity }] },
      }),
    ).toBe(false);
    expect(() =>
      applyLegacyDatabase(createEmptyState(), prepareLegacyDatabase(source(), context), '生活账本'),
    ).toThrow('名称已存在');
  });
  it('keeps all original metadata through a complete backup and restore', async () => {
    const state = prepareLegacyDatabase(source(), context).state;
    const restored = await decodeBackup(await encodeBackup(state));
    expect(restored.state).toEqual(state);
  });
  it('refuses ambiguous common-shortcut financial categories instead of inventing a parent', () => {
    const data = source();
    data.tables.expenses[0].type_main = '常用';
    expect(() => prepareLegacyDatabase(data, context)).toThrow('无法证实真实分类');
  });
  it('rejects account/member disagreement between the transaction index and details', () => {
    const data = source();
    data.tables.expenses[0].account_detail = '储蓄卡';
    expect(() => prepareLegacyDatabase(data, context)).toThrow('索引与四类明细不一致');
    const altered = source();
    altered.tables.time_sequence[0].member = 'Another fictional member';
    expect(() => prepareLegacyDatabase(altered, context)).toThrow('索引与四类明细不一致');
  });
  it('retains a total budget when a category has the same display name', () => {
    const data = source();
    data.tables.expenses_left.push({ id: 99, left: '总体预算', icon_type: 0, updateTime: 0 });
    const state = prepareLegacyDatabase(data, context).state;
    expect(
      state.budgets
        .filter((b) => b.amountCents === 300000 || b.amountCents === 70000)
        .every((b) => b.categoryId === null),
    ).toBe(true);
  });
  it('requires complete source metadata tables and columns', () => {
    expect(
      validLegacyDbMetadata({ format: 'jianjie-4.8.8', userVersion: 16, tables: { expenses: [] } }),
    ).toBe(false);
    const data = source();
    delete data.tables.expenses[0].money;
    expect(
      validLegacyDbMetadata({ format: 'jianjie-4.8.8', userVersion: 16, tables: data.tables }),
    ).toBe(false);
  });
  it('rejects a preview whose source digest is no longer bound to its import batch', () => {
    const plan = prepareLegacyDatabase(source(), context);
    plan.digest = 'a'.repeat(64);
    expect(() => applyLegacyDatabase(createEmptyState(), plan, '旧版')).toThrow('来源身份不一致');
  });
});
