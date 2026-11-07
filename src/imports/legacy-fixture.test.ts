import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readWorkbookBytes } from './workbook';
import { autoMapping } from './mapping';
import { prepareImport } from './plan';
import { applyImport } from './apply';
import { createEmptyState } from '../core/model';
import { accountBalance, loanTotals, transactionTotals } from '../core/selectors';

const path = new URL('../../tests/fixtures/legacy-4.8.8-two-expenses.xls', import.meta.url);
const bytes = readFileSync(path);
const digest = createHash('sha256').update(bytes).digest('hex');

describe('未修改原App导出的完全虚构文件', () => {
  it('固定输入身份和OLE/BIFF容器保持原样', () => {
    expect(bytes.length).toBe(13824);
    expect(digest).toBe('7d523af1fdfc2d5a0ce09db52f9a57a9a3aae883a7c78bbe7c06b2d442d3ed7b');
    expect(bytes.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
  });
  it('读取四张原工作表和第3行的实际表头，成员仍在原始行中', () => {
    const workbook = readWorkbookBytes(Uint8Array.from(bytes).buffer, 'legacy.xls');
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['支出', '收入', '转账', '借贷']);
    expect(workbook.sheets[0].rows[2]).toEqual([
      '金额',
      '支出大类',
      '支出小类',
      '账户',
      '时间',
      '成员',
      '备注',
    ]);
    expect(workbook.sheets[0].rows[3]).toEqual([
      '10.00',
      'FixtureFood',
      'FixtureBreakfast',
      '现金',
      '2026-11-07 19:28',
      '自己',
      '',
    ]);
    expect(workbook.sheets[1].rows[2]).toContain('收入类别');
    expect(workbook.sheets[2].rows[2]).toContain('转账类型');
    expect(workbook.sheets[3].rows[2]).toContain('借贷人');
  });
  it('现有解析器准确读取两笔支出的金额、路径和分钟，不把元信息当流水', () => {
    const workbook = { ...readWorkbookBytes(Uint8Array.from(bytes).buffer, 'legacy.xls'), digest };
    const mappings = workbook.sheets.map(autoMapping);
    expect(mappings.map((mapping) => mapping.headerRow)).toEqual([3, 3, 3, 3]);
    const plan = prepareImport(workbook, mappings);
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(2);
    expect(plan.totals.expense).toBe(2000);
    expect(plan.rows[0]).toMatchObject({
      primary: 'FixtureFood',
      secondary: 'FixtureBreakfast',
      amountCents: 1000,
      date: '2026-11-07',
      time: '19:28',
    });
    expect(plan.rows[0].member).toBe('自己');
  });
  it('原版71元借入文件初始化成员与债权人，现金51元且不计普通收入', () => {
    const file = readFileSync(
      new URL('../../tests/fixtures/legacy-4.8.8-borrow71.xls', import.meta.url),
    );
    const fileHash = createHash('sha256').update(file).digest('hex');
    expect(fileHash).toBe('18bf7fe8803187e5274dc6af2a6aa2175b9f9a856e1fb2555dea0bf898c8f64e');
    const workbook = {
      ...readWorkbookBytes(Uint8Array.from(file).buffer, 'borrow71.xls'),
      digest: fileHash,
    };
    const plan = prepareImport(workbook, workbook.sheets.map(autoMapping));
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(3);
    expect(plan.rows[2]).toMatchObject({
      direction: 'loan',
      loanType: 'borrow',
      person: 'FixtureLender',
      member: null,
      amountCents: 7100,
    });
    const initial = createEmptyState();
    const result = applyImport(initial, plan, {
      targetBookId: initial.books[0].id,
      useBookColumn: false,
      allowRejectedRows: false,
    });
    expect(accountBalance(result.state, initial.accounts[0].id)).toBe(5100);
    expect(transactionTotals(result.state.transactions)).toMatchObject({
      incomeCents: 0,
      expenseCents: 2000,
    });
    expect(result.state.loanPeople[0].name).toBe('FixtureLender');
    const ordinary = result.state.transactions.filter((item) => item.direction !== 'loan');
    expect(
      ordinary.every(
        (item) =>
          result.state.members.find((member) => member.id === item.memberId)?.kind === 'self',
      ),
    ).toBe(true);
    expect(loanTotals(result.state, { bookId: initial.books[0].id })).toMatchObject({
      borrowedCents: 7100,
      payableCents: 7100,
      netCents: -7100,
      cashInCents: 7100,
      count: 1,
    });
  });
});
