import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createEmptyState, validateState, type CommandContext } from '../core/model';
import { removeTransaction, renameCategory, upsertTransaction } from '../core/commands';
import { categoryTotals } from '../core/selectors';
import { autoMapping } from './mapping';
import { prepareImport } from './plan';
import { applyImport } from './apply';
import { excelDate, excelMoney } from './values';
import { readWorkbookBytes } from './workbook';
import type { CellValue, WorkbookData } from './types';

const header = ['日期', '收支类型', '金额', '一级分类', '二级分类', '账户', '备注'];
const row = (
  date = '2018-01-02',
  amount: CellValue = 10,
  primary = '餐饮',
  secondary = '早餐',
): CellValue[] => [date, '支出', amount, primary, secondary, '现金', '虚构样本'];
const context = (): CommandContext => {
  let count = 0;
  return { idFactory: () => `test-${++count}`, now: () => '2026-11-08T01:00:00.000Z' };
};
function workbook(rows: CellValue[][], digest = 'a'.repeat(64)): WorkbookData {
  return {
    fileName: '虚构导出.xls',
    size: 1000,
    digest,
    date1904: false,
    sheets: [{ name: '账目', rows }],
  };
}
function plan(data: WorkbookData) {
  return prepareImport(data, data.sheets.map(autoMapping));
}

describe('Excel日期、金额与映射', () => {
  it('负值不会被静默当成正消费，只有明确的符号映射可转换方向', () => {
    const data = workbook([header, row('2018-01-02', -10)]);
    const mapping = autoMapping(data.sheets[0]);
    expect(prepareImport(data, [mapping]).errors).toHaveLength(1);
    mapping.defaultDirection = 'signed';
    expect(prepareImport(data, [mapping]).errors).toHaveLength(1);
    mapping.columns.direction = null;
    expect(prepareImport(data, [mapping]).rows[0]).toMatchObject({
      direction: 'expense',
      amountCents: 1000,
    });
  });
  it('保留小数金额的分值和人民币显示格式，拒绝真实多余精度', () => {
    expect(excelMoney('￥1,234.50')).toBe(123450);
    expect(excelMoney(0.1 + 0.2)).toBe(30);
    expect(excelMoney('(10.20)')).toBe(-1020);
    expect(() => excelMoney('12.345')).toThrow();
    expect(() => excelMoney(12.345)).toThrow();
  });
  it('解析文字、Excel1900/1904日期及时间，不接受虚构闰日或歧义日期', () => {
    expect(excelDate('2018/1/2 09:05:06', false, 'ymd')).toEqual({
      date: '2018-01-02',
      time: '09:05:06',
    });
    expect(excelDate(25569.5, false, 'ymd')).toEqual({ date: '1970-01-01', time: '12:00:00' });
    expect(excelDate(0, true, 'ymd')).toEqual({ date: '1904-01-01' });
    expect(excelDate('03/04/2018', false, 'dmy').date).toBe('2018-04-03');
    expect(() => excelDate('03/04/2018', false, 'ymd')).toThrow();
    expect(() => excelDate(60, false, 'ymd')).toThrow();
    expect(() => excelDate('2026-02-30', false, 'ymd')).toThrow();
  });
  it('找到标题行之后的真实表头，并明确区分合计行、空白行与错误行', () => {
    const data = workbook([
      ['虚构账本导出'],
      [],
      header,
      row(),
      ['合计', null, 10],
      [],
      row('错误日期'),
    ]);
    const mapping = autoMapping(data.sheets[0]);
    expect(mapping.headerRow).toBe(3);
    const result = prepareImport(data, [mapping]);
    expect(result.rows).toHaveLength(1);
    expect(result.errors[0].row).toBe(7);
    expect(result.skipped[0].row).toBe(5);
    expect(result.blankRows).toBe(1);
  });
  it('自定义数字收支值由用户映射，不擅自猜测0/1', () => {
    const value = row();
    value[1] = 0;
    const data = workbook([header, value]);
    const mapping = autoMapping(data.sheets[0]);
    expect(prepareImport(data, [mapping]).errors).toHaveLength(1);
    mapping.expenseLabels += ',0';
    expect(prepareImport(data, [mapping]).rows[0].direction).toBe('expense');
  });
  it('独立收入/支出金额列和单列完整分类路径均可导入', () => {
    const data = workbook([
      ['日期', '支出', '收入', '分类', '账户'],
      ['2018-01-02', 10, 0, '餐饮/早餐', '现金'],
    ]);
    const result = plan(data);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      primary: '餐饮',
      secondary: '早餐',
      amountCents: 1000,
      direction: 'expense',
    });
  });
});

describe('真实二进制工作簿读取（全部为生成的虚构数据）', () => {
  for (const bookType of ['xlsx', 'biff8'] as const)
    it(`${bookType}读取保留中文、相同记录、前导空行和备注换行`, () => {
      const sheet = XLSX.utils.aoa_to_sheet([['测试标题'], [], header, row(), row()]);
      sheet.G4 = { t: 's', v: '第一行\n第二行' };
      const source = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(source, sheet, '账目');
      const bytes = XLSX.write(source, { type: 'array', bookType }) as ArrayBuffer;
      const loaded = readWorkbookBytes(bytes, bookType === 'biff8' ? 'sample.xls' : 'sample.xlsx');
      const result = plan({ ...loaded, digest: 'b'.repeat(64) });
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].row).toBe(4);
      expect(result.rows[0].note).toBe('第一行\n第二行');
      expect(result.rows[0].secondary).toBe('早餐');
    });
  it('拒绝被截断的xlsx压缩目录', () => {
    const source = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([header, row()]), '账目');
    const bytes = XLSX.write(source, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(() => readWorkbookBytes(bytes.slice(0, bytes.byteLength - 25), 'bad.xlsx')).toThrow();
  });
});

describe('导入初始化与用户BUG回归', () => {
  it('两笔历史早餐20元初始化完整分类，继续记10元后同类三笔30元', () => {
    const ctx = context();
    const empty = createEmptyState(ctx);
    const data = workbook([header, row(), row('2018-01-03')]);
    const imported = applyImport(
      empty,
      plan(data),
      { targetBookId: empty.books[0].id, useBookColumn: false, allowRejectedRows: false },
      ctx,
    );
    expect(empty.transactions).toHaveLength(0);
    expect(imported.state.categories).toHaveLength(2);
    const previous = imported.state.transactions[0];
    const next = upsertTransaction(
      imported.state,
      {
        bookId: previous.bookId,
        direction: 'expense',
        accountId: previous.accountId,
        categoryId: previous.categoryId,
        amountCents: 1000,
        date: '2026-11-08',
      },
      ctx,
    );
    const totals = categoryTotals(next, { bookId: previous.bookId, direction: 'expense' });
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ amountCents: 3000, count: 3 });
  });
  it('内容相同的两条真实形态流水保留，但同文件重复导入不新增', () => {
    const ctx = context();
    const state = createEmptyState(ctx);
    const p = plan(workbook([header, row(), row()]));
    const first = applyImport(
      state,
      p,
      { targetBookId: state.books[0].id, useBookColumn: false, allowRejectedRows: false },
      ctx,
    );
    expect(first.added).toBe(2);
    expect(first.state.transactions[0].id).not.toBe(first.state.transactions[1].id);
    const repeat = applyImport(
      first.state,
      p,
      { targetBookId: state.books[0].id, useBookColumn: false, allowRejectedRows: false },
      ctx,
    );
    expect(repeat.added).toBe(0);
    expect(repeat.duplicateRows).toBe(2);
    const deleted = removeTransaction(first.state, first.state.transactions[0].id);
    expect(
      applyImport(
        deleted,
        p,
        { targetBookId: state.books[0].id, useBookColumn: false, allowRejectedRows: false },
        ctx,
      ).added,
    ).toBe(0);
  });
  it('同文件可以分日期补导，改名别名继续复用，异父同名分类独立', () => {
    const ctx = context();
    const state = createEmptyState(ctx);
    const p = plan(
      workbook([
        header,
        row('2018-01-02', 10, '餐饮', '其他'),
        row('2018-01-03', 10, '餐饮', '其他'),
        row('2018-01-03', 5, '交通', '其他'),
      ]),
    );
    const options = {
      targetBookId: state.books[0].id,
      useBookColumn: false,
      allowRejectedRows: false,
    };
    const first = applyImport(state, p, { ...options, toDate: '2018-01-02' }, ctx);
    const renamed = renameCategory(
      first.state,
      first.state.transactions[0].categoryId!,
      '其他餐饮',
    );
    const second = applyImport(renamed, p, options, ctx);
    expect(second.added).toBe(2);
    expect(second.duplicateRows).toBe(1);
    expect(second.overlapCandidates).toBe(0);
    expect(second.state.transactions[0].categoryId).toBe(second.state.transactions[1].categoryId);
    expect(second.state.transactions[2].categoryId).not.toBe(
      second.state.transactions[0].categoryId,
    );
    expect(() => validateState(second.state)).not.toThrow();
  });
  it('不同文件的内容相同记录只告知候选，不自动删除', () => {
    const ctx = context();
    const state = createEmptyState(ctx);
    const options = {
      targetBookId: state.books[0].id,
      useBookColumn: false,
      allowRejectedRows: false,
    };
    const first = applyImport(state, plan(workbook([header, row()])), options, ctx);
    const second = applyImport(
      first.state,
      plan(workbook([header, row()], 'b'.repeat(64))),
      options,
      ctx,
    );
    expect(second.added).toBe(1);
    expect(second.overlapCandidates).toBe(1);
    expect(second.state.transactions).toHaveLength(2);
  });
  it('无效行默认阻止导入，只有明确允许后才跳过并保留计数', () => {
    const ctx = context();
    const state = createEmptyState(ctx);
    const p = plan(workbook([header, row(), row('bad')]));
    const options = {
      targetBookId: state.books[0].id,
      useBookColumn: false,
      allowRejectedRows: false,
    };
    expect(() => applyImport(state, p, options, ctx)).toThrow();
    expect(state.transactions).toEqual([]);
    const accepted = applyImport(state, p, { ...options, allowRejectedRows: true }, ctx);
    expect(accepted.state.imports[0]).toMatchObject({
      totalRows: 2,
      importedRows: 1,
      rejectedRows: 1,
    });
  });
  it('按账本列初始化相同分类时不会跨账本合并', () => {
    const ctx = context();
    const state = createEmptyState(ctx);
    const a = row();
    a.push('家庭');
    const b = row();
    b.push('旅行');
    const p = plan(workbook([[...header, '账本'], a, b]));
    const result = applyImport(
      state,
      p,
      { targetBookId: state.books[0].id, useBookColumn: true, allowRejectedRows: false },
      ctx,
    );
    expect(result.createdBooks).toBe(2);
    expect(result.batchIds).toHaveLength(2);
    expect(result.state.transactions[0].categoryId).not.toBe(
      result.state.transactions[1].categoryId,
    );
  });
});
