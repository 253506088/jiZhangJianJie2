import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createCategoryPath,
  createEmptyState,
  ensureMemberDraft,
  MAX_AMOUNT_CENTS,
  setBudget,
  upsertTransaction,
  validateState,
  withLedgerDraft,
  type LedgerState,
  type Transaction,
} from '../core';
import { readWorkbookBytes } from '../imports/workbook';
import { autoMapping } from '../imports/mapping';
import { prepareImport } from '../imports/plan';
import { applyImport } from '../imports/apply';
import { buildLegacyExcel } from './codec';
import {
  centsAsText,
  EXCEL_HEADERS,
  EXCEL_SHEETS,
  exportedDateTime,
  prepareLegacyExport,
  summarizeExcelExport,
  XLS_MAX_DATA_ROWS,
} from './model';

const NOW = '2026-11-08T02:00:00.000Z';
function context() {
  let id = 0;
  return { idFactory: () => `export-fictional-${++id}`, now: () => NOW };
}
function bytes(buffer: Uint8Array): ArrayBuffer {
  return new Uint8Array(buffer).buffer;
}
function parse(buffer: Uint8Array, fileName: string) {
  return {
    ...readWorkbookBytes(bytes(buffer), fileName),
    digest: createHash('sha256').update(buffer).digest('hex'),
  };
}
function importFile(buffer: Uint8Array, fileName: string) {
  const ctx = context();
  const initial = createEmptyState(ctx);
  const workbook = parse(buffer, fileName);
  const plan = prepareImport(workbook, workbook.sheets.map(autoMapping));
  expect(plan.errors).toEqual([]);
  return applyImport(
    initial,
    plan,
    { targetBookId: initial.books[0].id, useBookColumn: false, allowRejectedRows: false },
    ctx,
  ).state;
}
function sourceFixture() {
  const buffer = readFileSync(
    new URL('../../tests/fixtures/legacy-4.8.8-full-types.xls', import.meta.url),
  );
  return { buffer, state: importFile(buffer, 'legacy-4.8.8-full-types.xls') };
}
function normalized(state: LedgerState) {
  const names = new Map(state.accounts.map((item) => [item.id, item.name]));
  const categories = new Map(state.categories.map((item) => [item.id, item]));
  const members = new Map(state.members.map((item) => [item.id, item.name]));
  const people = new Map(state.loanPeople.map((item) => [item.id, item.name]));
  return state.transactions
    .map((item) => {
      const category = item.categoryId ? categories.get(item.categoryId)! : null;
      const parent = category ? categories.get(category.parentId!)! : null;
      return {
        direction: item.direction,
        amountCents: item.amountCents,
        date: item.date,
        time: item.time?.padEnd(8, ':00') ?? '',
        account: names.get(item.accountId),
        toAccount: item.toAccountId ? names.get(item.toAccountId) : null,
        category: category
          ? item.direction === 'income'
            ? parent!.name === '收入'
              ? category.name
              : `${parent!.name} / ${category.name}`
            : `${parent!.name} / ${category.name}`
          : null,
        member: item.memberId ? members.get(item.memberId) : null,
        person: item.personId ? people.get(item.personId) : null,
        loanType: item.loanType,
        transferType: item.transferType ?? '',
        note: item.note,
      };
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

describe('原版四表形状与当前导入兼容', () => {
  for (const format of ['xls', 'xlsx'] as const) {
    it(`${format}导出真实原包虚构样本对应的四表，重导入保留八笔、成员和借贷类型`, () => {
      const { state } = sourceFixture();
      const before = structuredClone(state);
      const built = buildLegacyExcel(state, {
        bookId: state.books[0].id,
        format,
        fromDate: '2026-11-01',
        toDate: '2026-12-01',
      });
      expect(built.bytes.byteLength).toBeGreaterThan(0);
      const output = parse(built.bytes, built.fileName);
      expect(output.sheets.map((sheet) => sheet.name)).toEqual([...EXCEL_SHEETS]);
      for (const sheet of output.sheets) {
        expect(sheet.rows[0][0]).toBe(sheet.name);
        expect(sheet.rows[1].slice(0, 2)).toEqual(['时间', '2026-11-01 - 2026-12-01']);
        expect(sheet.rows[2]).toEqual([...EXCEL_HEADERS[sheet.name as keyof typeof EXCEL_HEADERS]]);
        expect(autoMapping(sheet)).toMatchObject({ legacyFormat: true, headerRow: 3 });
      }
      expect(output.sheets[0].rows[0].slice(0, 2)).toEqual(['支出', '20.00']);
      expect(output.sheets[1].rows[0].slice(0, 2)).toEqual(['收入', '101.25']);
      expect(output.sheets[0].rows[3].slice(0, 7)).toEqual([
        '10.00',
        'FixtureFood',
        'FixtureBreakfast',
        '现金',
        '2026-11-07 19:28',
        '自己',
        '',
      ]);
      expect(output.sheets[2].rows[3][1]).toBe('');
      expect(output.sheets[3].rows.slice(3).map((row) => row[1])).toEqual([
        '借入',
        '借出',
        '还款',
        '收款',
      ]);
      const imported = importFile(built.bytes, built.fileName);
      expect(imported.transactions).toHaveLength(8);
      expect(normalized(imported)).toEqual(normalized(state));
      expect(built.summary.counts).toEqual({ expense: 2, income: 1, transfer: 1, loan: 4 });
      expect(state).toEqual(before);
    });
  }

  it('日期范围含两端，只导出所选账本；空表仍保留三行信息', () => {
    const { state } = sourceFixture();
    const empty = buildLegacyExcel(state, {
      bookId: state.books[0].id,
      format: 'xlsx',
      fromDate: '2026-11-08',
      toDate: '2026-11-08',
    });
    const data = parse(empty.bytes, empty.fileName);
    expect(data.sheets.every((sheet) => sheet.rows.length === 3)).toBe(true);
    expect(data.sheets[0].rows[0].slice(0, 2)).toEqual(['支出', '0.00']);
    expect(empty.summary.count).toBe(0);
    expect(
      summarizeExcelExport(state, {
        bookId: state.books[0].id,
        format: 'xlsx',
        fromDate: '2026-11-07',
        toDate: '2026-11-07',
      }).count,
    ).toBe(8);
    expect(() =>
      summarizeExcelExport(state, {
        bookId: state.books[0].id,
        format: 'xlsx',
        fromDate: '2026-11-08',
        toDate: '2026-11-07',
      }),
    ).toThrow('日期范围');
  });

  it('原分钟精度不强加秒数，改变后的时间和未知时间不被原rawDate覆盖', () => {
    const { state } = sourceFixture();
    const item = state.transactions.find((transaction) => transaction.direction === 'expense')!;
    expect(item.time).toBe('19:28');
    expect(exportedDateTime(item)).toBe('2026-11-07 19:28');
    expect(exportedDateTime({ ...item, time: '19:28:00' })).toBe('2026-11-07 19:28');
    expect(exportedDateTime({ ...item, time: '19:28:45' })).toBe('2026-11-07 19:28:45');
    expect(exportedDateTime({ ...item, time: '07:08' })).toBe('2026-11-07 07:08');
    expect(exportedDateTime({ ...item, time: undefined })).toBe('2026-11-07');
    expect(exportedDateTime({ ...item, date: '2026-11-08', time: '19:28:00' })).toBe(
      '2026-11-08 19:28:00',
    );
  });

  it('非隐藏父的收入使用可见完整名称，不虚造额外旧字段；完整数据应走备份', () => {
    const ctx = context();
    let state = createEmptyState(ctx);
    const bookId = state.books[0].id;
    const income = createCategoryPath(
      state,
      { bookId, direction: 'income', primaryName: '额外收入', secondaryName: '工资' },
      ctx,
    );
    state = income.state;
    state = upsertTransaction(
      state,
      {
        bookId,
        accountId: state.accounts[0].id,
        categoryId: income.categoryId,
        direction: 'income',
        amountCents: 10000,
        date: '2026-11-08',
        time: '09:10',
        note: '=这是文本，不是公式',
      },
      ctx,
    );
    state = setBudget(
      state,
      { bookId, month: '2026-11', categoryId: null, amountCents: 5000 },
      ctx,
    );
    const built = buildLegacyExcel(state, { bookId, format: 'xlsx' });
    expect(built.summary.flattenedIncomeRows).toBe(1);
    const workbook = XLSX.read(bytes(built.bytes), { type: 'array' });
    expect(workbook.Sheets['收入']['B4'].v).toBe('额外收入 / 工资');
    expect(workbook.Sheets['收入']['F4'].t).toBe('s');
    expect(workbook.Sheets['收入']['F4'].f).toBeUndefined();
    expect(workbook.Sheets['收入']['F4'].v).toBe('=这是文本，不是公式');
    const imported = importFile(built.bytes, built.fileName);
    expect(normalized(imported)).toEqual(normalized(state));
    expect(imported.budgets).toEqual([]);
    expect(imported.transactions[0].id).not.toBe(state.transactions[0].id);
  });

  it('不同日期和备注形态、成员未指定与内容相同的独立流水都保留', () => {
    const ctx = context();
    let state = createEmptyState(ctx);
    const bookId = state.books[0].id;
    const category = createCategoryPath(
      state,
      { bookId, direction: 'expense', primaryName: '虚构餐饮', secondaryName: '早餐' },
      ctx,
    );
    state = category.state;
    let memberId = '';
    state = withLedgerDraft(state, (draft) => {
      memberId = ensureMemberDraft(draft, bookId, '未指定', ctx).id;
    });
    const input = {
      bookId,
      accountId: state.accounts[0].id,
      categoryId: category.categoryId,
      direction: 'expense' as const,
      memberId,
      amountCents: 1010,
      date: '2018-06-08',
      note: '  虚构多行备注\n第二行，☕  ',
    };
    state = upsertTransaction(state, input, ctx);
    state = upsertTransaction(state, input, ctx);
    const built = buildLegacyExcel(state, { bookId, format: 'xls' });
    expect(built.summary.dateOnlyRows).toBe(2);
    const imported = importFile(built.bytes, built.fileName);
    expect(imported.transactions).toHaveLength(2);
    expect(imported.transactions[0].id).not.toBe(imported.transactions[1].id);
    expect(normalized(imported)).toEqual(normalized(state));
    expect(
      imported.members.find((member) => member.id === imported.transactions[0].memberId)?.kind,
    ).toBe('unspecified');
  });
});

function largeState(count: number) {
  const ctx = context();
  let state = createEmptyState(ctx);
  const bookId = state.books[0].id;
  const category = createCategoryPath(
    state,
    { bookId, direction: 'expense', primaryName: '虚构边界', secondaryName: '大量明细' },
    ctx,
  );
  state = category.state;
  const template: Omit<Transaction, 'id'> = {
    bookId,
    accountId: state.accounts[0].id,
    categoryId: category.categoryId,
    direction: 'expense',
    memberId: state.members[0].id,
    loanType: null,
    personId: null,
    toAccountId: null,
    amountCents: MAX_AMOUNT_CENTS,
    date: '2026-11-08',
    note: '仅测试',
    createdAt: NOW,
    updatedAt: NOW,
  };
  state.transactions = Array.from({ length: count }, (_, index) => ({
    id: `large-export-${index}`,
    ...template,
  }));
  validateState(state);
  return state;
}

describe('Excel容量与精确标题合计', () => {
  it('XLS在65533条边界写到第65536行，没有丢最后一条', () => {
    const state = largeState(XLS_MAX_DATA_ROWS);
    const built = buildLegacyExcel(state, { bookId: state.books[0].id, format: 'xls' });
    const workbook = XLSX.read(bytes(built.bytes), { type: 'array' });
    expect(XLSX.utils.decode_range(workbook.Sheets['支出']['!ref']!).e.r).toBe(65535);
    expect(workbook.Sheets['支出']['A65536'].v).toBe('999999999.99');
    expect(workbook.Sheets['支出']['G65536'].v).toBe('仅测试');
    expect(built.summary.count).toBe(XLS_MAX_DATA_ROWS);
  }, 20_000);

  it('XLS超过65533条时明确拒绝而非截断，XLSX仍保留全部合法明细', () => {
    const state = largeState(XLS_MAX_DATA_ROWS + 1);
    const bookId = state.books[0].id;
    expect(() => prepareLegacyExport(state, { bookId, format: 'xls' })).toThrow('65,533');
    expect(summarizeExcelExport(state, { bookId, format: 'xlsx' }).tooManyXlsRows).toBe(false);
    const prepared = prepareLegacyExport(state, { bookId, format: 'xlsx' });
    expect(prepared.sheets[0].rows).toHaveLength(XLS_MAX_DATA_ROWS + 4);
  });

  it('超安全整数的合计仍用BigInt文本，明细笔数不减少', () => {
    const state = largeState(91_000);
    const bookId = state.books[0].id;
    const prepared = prepareLegacyExport(state, { bookId, format: 'xlsx' });
    const total = BigInt(MAX_AMOUNT_CENTS) * 91_000n;
    expect(total).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(prepared.summary.exactTotals.expense).toBe(total.toString());
    expect(prepared.sheets[0].rows[0]).toEqual(['支出', centsAsText(total)]);
    expect(prepared.sheets[0].rows).toHaveLength(91_003);
    expect(prepared.sheets[0].rows[3][0]).toBe('999999999.99');
    expect(prepared.sheets[0].rows[3][0]).not.toContain(',');
  });
});
