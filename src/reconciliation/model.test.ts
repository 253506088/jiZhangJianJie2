import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createBook,
  createEmptyState,
  removeTransaction,
  renameCategory,
  type LedgerState,
} from '../core';
import { readWorkbookBytes } from '../imports/workbook';
import { applyImport } from '../imports/apply';
import { autoMapping } from '../imports/mapping';
import { prepareImport } from '../imports/plan';
import type { WorkbookData } from '../imports/types';
import {
  prepareLegacyReconciliation,
  reconcileLegacyWorkbook,
  reconciliationReport,
} from './model';

function fixture(annual = true): WorkbookData {
  const file = readFileSync(
    new URL('../../tests/fixtures/legacy-4.8.8-full-types.xls', import.meta.url),
  );
  const digest = createHash('sha256').update(file).digest('hex');
  expect(digest).toBe('b809a5863a215c3f32457fe33f3e4ef0f2ee4ba90a1b0436de81ef97cade1584');
  const data = {
    ...readWorkbookBytes(Uint8Array.from(file).buffer, 'fictional-legacy.xls'),
    digest,
  };
  // Only metadata is synthesized. The on-disk original APK fixture remains unchanged.
  if (annual) for (const sheet of data.sheets) sheet.rows[1][1] = '2026-01-01 - 2027-01-01';
  return data;
}
function imported(data: WorkbookData) {
  const empty = createEmptyState();
  // Seed through the normal user-confirmable importer, independently of strict reconciliation.
  return applyImport(empty, prepareImport(data, data.sheets.map(autoMapping)), {
    targetBookId: empty.books[0].id,
    useBookColumn: false,
    allowRejectedRows: false,
  }).state;
}
const compare = (state: LedgerState, data: WorkbookData, year = 2026) =>
  reconcileLegacyWorkbook(state, data, { bookId: state.books[0].id, year });

describe('旧版全年 Excel 逐笔对账', () => {
  it('真正原包四类八笔逐笔一致，但月度文件不能声称全年通过', () => {
    const data = fixture(false),
      state = imported(data);
    const result = compare(state, data);
    expect(result).toMatchObject({
      passed: false,
      matchedCount: 8,
      legacyCount: 8,
      currentCount: 8,
      differences: [],
    });
    expect(result.blockers).toHaveLength(1);
  });
  it('全年四表按日期和完整身份匹配，含全部四种借贷，且不改动账本', () => {
    const data = fixture(),
      state = imported(data),
      before = structuredClone(state);
    // DB imports can retain seconds while old Excel has minute precision.
    state.transactions[0].time += ':41';
    const result = compare(state, data);
    expect(result).toMatchObject({ passed: true, matchedCount: 8, differences: [], blockers: [] });
    expect(result.counts).toEqual({
      expense: { legacy: 2, current: 2, matched: 2 },
      income: { legacy: 1, current: 1, matched: 1 },
      transfer: { legacy: 1, current: 1, matched: 1 },
      loan: { legacy: 4, current: 4, matched: 4 },
    });
    before.transactions[0].time += ':41';
    expect(state).toEqual(before);
  });
  it('总额相等仍能识别不同记录的错额', () => {
    const data = fixture(),
      state = imported(data);
    const expenses = state.transactions.filter((item) => item.direction === 'expense');
    expenses[0].amountCents += 100;
    expenses[1].amountCents -= 100;
    const result = compare(state, data);
    expect(result.totals.expense.legacyCents).toBe(result.totals.expense.currentCents);
    expect(result.passed).toBe(false);
    expect(result.differences.map((item) => item.kind)).toEqual(['amount', 'amount']);
  });
  it('完全相同的重复笔数不会去重，一笔缺失也不能通过', () => {
    const data = fixture();
    data.sheets[0].rows.push([...data.sheets[0].rows[3]]);
    data.sheets[0].rows[0][1] = '30.00';
    let state = imported(data);
    expect(compare(state, data)).toMatchObject({ passed: true, matchedCount: 9 });
    const duplicate = state.transactions.find(
      (item) => item.source?.sheet === '支出' && item.source.row === 6,
    )!;
    state = removeTransaction(state, duplicate.id);
    const result = compare(state, data);
    expect(result).toMatchObject({
      passed: false,
      matchedCount: 8,
      legacyCount: 9,
      currentCount: 8,
    });
    expect(result.differences[0].kind).toBe('missing');
  });
  it('同一身份多个不同金额候选不随意配对', () => {
    const data = fixture();
    data.sheets[0].rows[4] = [...data.sheets[0].rows[3]];
    data.sheets[0].rows[4][0] = '20.00';
    const state = imported(data);
    for (const item of state.transactions.filter((item) => item.direction === 'expense'))
      item.amountCents = 1500;
    const result = compare(state, data);
    expect(result.passed).toBe(false);
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toMatchObject({ kind: 'ambiguous' });
    expect(result.differences[0].legacy).toHaveLength(2);
    expect(result.differences[0].current).toHaveLength(2);
  });
  it('不同父分类下同名叶子不能合并，改错类别仍失败', () => {
    const data = fixture();
    data.sheets[0].rows[4] = [...data.sheets[0].rows[3]];
    data.sheets[0].rows[4][1] = 'FixtureTransport';
    const state = imported(data);
    const expenses = state.transactions.filter((item) => item.direction === 'expense');
    expenses[1].categoryId = expenses[0].categoryId;
    const result = compare(state, data);
    expect(result.passed).toBe(false);
    expect(result.differences.map((item) => item.kind).sort()).toEqual(['extra', 'missing']);
  });
  it('明确的分类改名历史可继续匹配旧完整路径', () => {
    const data = fixture();
    let state = imported(data);
    state = renameCategory(
      state,
      state.transactions.find((item) => item.direction === 'expense')!.categoryId!,
      'FixtureRenamedBreakfast',
    );
    expect(compare(state, data).passed).toBe(true);
  });
  it('成员、转入账户和借贷子类型参与匹配', () => {
    for (const direction of ['expense', 'transfer', 'loan'] as const) {
      const data = fixture(),
        state = imported(data);
      const item = state.transactions.find((row) => row.direction === direction)!;
      if (direction === 'expense')
        item.memberId = state.members.find((member) => member.name === 'FixtureMember')!.id;
      if (direction === 'transfer') {
        const account = item.accountId;
        item.accountId = item.toAccountId!;
        item.toAccountId = account;
      }
      if (direction === 'loan') item.loanType = 'collect';
      const result = compare(state, data);
      expect(result.passed).toBe(false);
      expect(result.differences.map((row) => row.kind).sort()).toEqual(['extra', 'missing']);
    }
  });
  it('全年边界含元旦和12月31日，其他年记录不混入', () => {
    const data = fixture();
    data.sheets[0].rows[3][4] = '2026-01-01 00:00';
    data.sheets[0].rows[4][4] = '2026-12-31 23:59';
    const state = imported(data);
    expect(compare(state, data).passed).toBe(true);
    const outside = { ...state.transactions[0], id: 'fictional-outside-year', date: '2027-01-01' };
    delete outside.source;
    state.transactions.push(outside);
    expect(compare(state, data)).toMatchObject({ passed: true, currentCount: 8 });
    data.sheets[0].rows.push([
      '3.00',
      'FixtureFood',
      'FixtureBreakfast',
      '现金',
      '2027-01-01 00:00',
      '自己',
      '',
    ]);
    expect(compare(state, data)).toMatchObject({
      passed: false,
      outsideYearCount: 1,
      currentCount: 8,
    });
  });
  it('任何表不覆盖全年、缺失表或被改表头均不能误通过', () => {
    const data = fixture(),
      state = imported(data);
    data.sheets[2].rows[1][1] = '2026-11-01 - 2026-12-01';
    expect(compare(state, data).passed).toBe(false);
    data.sheets.pop();
    expect(() => compare(state, data)).toThrow('四张表');
    const broken = fixture();
    broken.sheets[0].rows[2][0] = '未知列';
    expect(() => compare(state, broken)).toThrow('表头');
  });
  it('解析错误或默认补齐字段不能隐藏成成功结果', () => {
    const data = fixture(),
      state = imported(data);
    data.sheets[0].rows[3][0] = '#EXCEL_CELL_ERROR';
    data.sheets[0].rows[4][5] = '';
    const result = compare(state, data);
    expect(result.passed).toBe(false);
    expect(result.invalidRows).toEqual([
      { sheet: '支出', row: 4, code: 'INVALID_ROW' },
      { sheet: '支出', row: 5, code: 'MISSING_MATCH_FIELDS' },
    ]);
    expect(result.warningRows).toBe(1);
  });
  it.each(['转账', '借贷'] as const)('不把%s表数据区的非空合计行当成已验证的遗漏', (name) => {
    const data = fixture();
    const sheet = data.sheets.find((item) => item.name === name)!;
    sheet.rows[3][0] = '合计';
    sheet.rows[3][4] = '';
    const general = prepareImport(data, data.sheets.map(autoMapping));
    expect(general.errors).toEqual([]);
    expect(general.skipped).toMatchObject([{ sheet: name, row: 4, code: 'SUMMARY_ROW' }]);
    const result = compare(imported(data), data);
    expect(result).toMatchObject({
      passed: false,
      legacyCount: 7,
      currentCount: 7,
      matchedCount: 7,
    });
    expect(result.invalidRows).toEqual([{ sheet: name, row: 4, code: 'UNEXPECTED_SUMMARY_ROW' }]);
  });
  it('严格检查四表的重复表头，但允许真正空白行', () => {
    const data = fixture();
    for (const sheet of data.sheets) sheet.rows.push([], [null, '', '   ']);
    expect(compare(imported(data), data).passed).toBe(true);
    for (const sheet of data.sheets) sheet.rows.push([...sheet.rows[2]]);
    const result = compare(imported(data), data);
    expect(result).toMatchObject({ passed: false, legacyCount: 8, matchedCount: 8 });
    expect(result.invalidRows).toHaveLength(4);
    expect(result.invalidRows.every((row) => row.code === 'UNEXPECTED_REPEATED_HEADER')).toBe(true);
  });
  it('源借贷人缺失不能与导入时默认的未指定联系人一起误报通过', () => {
    const data = fixture();
    data.sheets.find((sheet) => sheet.name === '借贷')!.rows[3][3] = '   ';
    const general = prepareImport(data, data.sheets.map(autoMapping));
    expect(general.errors).toEqual([]);
    const result = compare(imported(data), data);
    expect(result).toMatchObject({
      passed: false,
      legacyCount: 8,
      matchedCount: 8,
      warningRows: 1,
    });
    expect(result.invalidRows).toEqual([{ sheet: '借贷', row: 4, code: 'MISSING_MATCH_FIELDS' }]);
  });
  it.each([
    ['支出', 4],
    ['收入', 3],
    ['转账', 4],
    ['借贷', 4],
  ] as const)('%s的日期缺少分钟不能与日期相同的新账本误报通过', (name, column) => {
    const data = fixture();
    const sheet = data.sheets.find((item) => item.name === name)!;
    sheet.rows[3][column] = String(sheet.rows[3][column]).slice(0, 10);
    const result = compare(imported(data), data);
    expect(result).toMatchObject({
      passed: false,
      legacyCount: 8,
      matchedCount: 8,
      warningRows: 1,
    });
    expect(result.invalidRows).toEqual([{ sheet: name, row: 4, code: 'MISSING_MATCH_FIELDS' }]);
  });
  it.each([
    ['支出', 2],
    ['支出', 3],
    ['支出', 5],
    ['收入', 1],
    ['收入', 2],
    ['收入', 4],
    ['转账', 2],
    ['转账', 5],
    ['借贷', 2],
  ] as const)('%s第%i列缺省补齐也只能预览，不能通过对账', (name, column) => {
    const data = fixture();
    data.sheets.find((sheet) => sheet.name === name)!.rows[3][column] = '';
    const result = compare(imported(data), data);
    expect(result).toMatchObject({
      passed: false,
      legacyCount: 8,
      matchedCount: 8,
      warningRows: 1,
    });
    expect(result.invalidRows).toEqual([{ sheet: name, row: 4, code: 'MISSING_MATCH_FIELDS' }]);
  });
  it('新增的完整性错误报告只含行号和错误代码，不泄露原字段', () => {
    const data = fixture();
    const sheet = data.sheets.find((item) => item.name === '借贷')!;
    sheet.rows[3][3] = '';
    sheet.rows[3][5] = 'FixturePrivateMissingPersonNote';
    const result = compare(imported(data), data);
    const report = reconciliationReport(result);
    expect(report).toContain('MISSING_MATCH_FIELDS');
    for (const value of [
      'FixturePrivateMissingPersonNote',
      '2026-11-',
      'FixtureLender',
      '未指定',
      'amountCents',
    ])
      expect(report).not.toContain(value);
  });
  it('默认报告不含金额、姓名、账户、备注、日期、账本或文件标识', () => {
    const data = fixture(),
      state = imported(data);
    state.transactions[2].amountCents++;
    const result = compare(state, data);
    const redacted = reconciliationReport(result);
    for (const text of [
      'amountCents',
      '10125',
      '2026-11-',
      'FixtureMember',
      'Fixture salary memo',
      '储蓄卡',
      '生活账本',
      'fictional-legacy',
      data.digest,
      state.transactions[0].id,
    ])
      expect(redacted).not.toContain(text);
    const detailed = reconciliationReport(result, true);
    expect(detailed).toContain('includesPrivateDetails');
    expect(detailed).toContain('amountCents');
    expect(detailed).toContain('Fixture salary memo');
  });
  it('空账本与全年空导出可通过，空账本对有记录文件显示缺少', () => {
    const data = fixture(),
      state = createEmptyState();
    expect(compare(state, data)).toMatchObject({ passed: false, currentCount: 0, legacyCount: 8 });
    for (const sheet of data.sheets) sheet.rows = sheet.rows.slice(0, 3);
    data.sheets[0].rows[0][1] = '0.00';
    data.sheets[1].rows[0][1] = '0.00';
    expect(compare(state, data)).toMatchObject({ passed: true, matchedCount: 0 });
  });
  it('无效年份和不存在的账本被拒绝', () => {
    const data = fixture(),
      state = imported(data);
    expect(() => compare(state, data, 2026.5)).toThrow('年份');
    expect(() => reconcileLegacyWorkbook(state, data, { year: 2026, bookId: 'missing' })).toThrow(
      '账本',
    );
  });
  it('同一年不同账本各自对账，同名分类不会让其他账本记录混入', () => {
    const data = fixture(),
      first = imported(data);
    const second = createBook(first, 'FixtureOtherBook');
    const state = applyImport(second.state, prepareLegacyReconciliation(data), {
      targetBookId: second.bookId,
      useBookColumn: false,
      allowRejectedRows: false,
    }).state;
    expect(state.transactions).toHaveLength(16);
    expect(compare(state, data)).toMatchObject({ passed: true, currentCount: 8, matchedCount: 8 });
    expect(
      reconcileLegacyWorkbook(state, data, { year: 2026, bookId: second.bookId }),
    ).toMatchObject({ passed: true, currentCount: 8, matchedCount: 8 });
  });
  it('顶部合计能够发现源文件遗漏明细，不能仅因现存行匹配就通过', () => {
    const data = fixture();
    data.sheets[0].rows.pop();
    const state = imported(data);
    const result = compare(state, data);
    expect(result.differences).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain(
      '支出表顶部合计与可读明细不一致或无法识别，请确认原始导出完整性。',
    );
  });
});
