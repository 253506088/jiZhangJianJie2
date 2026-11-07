import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  calculateAmount,
  categoryTotals,
  createDemoEntries,
  isValidDate,
  monthEntries,
  parseBackup,
  saveEntry,
  serializeBackup,
  totals,
} from './ledger';

describe('金额和流水规则', () => {
  it('以整数分计算小数和连续加减', () => {
    expect(calculateAmount('0.10+0.20')).toBe(30);
    expect(calculateAmount('12.50+7.25-3.10')).toBe(1665);
  });
  it('拒绝无效、零、负值、超范围和不完整表达式', () => {
    for (const value of ['', '0', '2-3', '1+', '0.001', '999999999', '1e3'])
      expect(() => calculateAmount(value)).toThrow();
  });
  it('不按相同金额、日期或备注误删独立流水', () => {
    const [entry] = createDemoEntries('2026-11-08');
    const items = saveEntry([entry], { ...entry, id: 'another' });
    expect(items).toHaveLength(2);
    expect(totals(items).expense).toBe(entry.amountCents * 2);
  });
  it('编辑按身份替换，不新增另一笔', () => {
    const entries = createDemoEntries('2026-11-08');
    const result = saveEntry(entries, { ...entries[0], amountCents: 2000 });
    expect(result).toHaveLength(entries.length);
    expect(result[0].amountCents).toBe(2000);
  });
  it('不同父分类下的“其他”分别汇总，同一分类新旧流水合计', () => {
    const [base] = createDemoEntries('2026-11-08');
    const rows = categoryTotals(
      [
        { ...base, id: 'a', categoryId: 'food-other', amountCents: 2000 },
        { ...base, id: 'b', categoryId: 'food-other', amountCents: 1000 },
        { ...base, id: 'c', categoryId: 'transport-other', amountCents: 500 },
      ],
      'expense',
    );
    expect(rows).toEqual([
      { categoryId: 'food-other', cents: 3000, count: 2 },
      { categoryId: 'transport-other', cents: 500, count: 1 },
    ]);
  });
  it('按年月筛选，账户余额包括期初和全部流水', () => {
    const entries = createDemoEntries('2026-11-08');
    expect(monthEntries(entries, '2025-11')).toHaveLength(0);
    expect(accountBalance(entries, 'bank')).toBe(120000 + 860000 - 180000);
  });
  it('验证实际日期，拒绝日历溢出', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
  });
});

describe('仅演示数据的备份恢复', () => {
  it('完整往返保留记录和精度，重复恢复不会叠加', () => {
    const entries = createDemoEntries('2026-11-08');
    const text = serializeBackup(entries);
    expect(parseBackup(text)).toEqual(entries);
    expect(parseBackup(text)).toHaveLength(entries.length);
  });
  it('拒绝外来格式、重复身份和分类类型不一致', () => {
    const entries = createDemoEntries('2026-11-08');
    expect(() => parseBackup('{}')).toThrow();
    expect(() => parseBackup(serializeBackup([entries[0], entries[0]]))).toThrow();
    expect(() => parseBackup(serializeBackup([{ ...entries[0], direction: 'income' }]))).toThrow();
  });
});
