import { localDate, periodRange } from '../core';

export interface OverviewPeriod {
  key: 'day' | 'week' | 'month' | 'year';
  label: string;
  fromDate: string;
  toDate: string;
}

/** Local calendar boundaries; adding calendar days keeps DST from shifting a date. */
export function overviewPeriods(now = new Date(), weekStartsOn: 0 | 1 = 1): OverviewPeriod[] {
  const today = localDate(now);
  return [
    { key: 'day', label: '今天', fromDate: today, toDate: today },
    {
      key: 'week',
      label: '本周',
      ...periodRange(today, 'week', weekStartsOn),
    },
    {
      key: 'month',
      label: '本月',
      ...periodRange(today, 'month', weekStartsOn),
    },
    {
      key: 'year',
      label: '本年',
      fromDate: `${today.slice(0, 4)}-01-01`,
      toDate: `${today.slice(0, 4)}-12-31`,
    },
  ];
}

/** BigInt division has the same toward-zero truncation as the observed positive legacy percentage. */
export function monthlyBalancePercentage(incomeCents: number, expenseCents: number): string {
  if (
    !Number.isSafeInteger(incomeCents) ||
    !Number.isSafeInteger(expenseCents) ||
    incomeCents < 0 ||
    expenseCents < 0
  )
    throw new Error('月收支金额不正确');
  if (incomeCents === 0) return '0';
  return (((BigInt(incomeCents) - BigInt(expenseCents)) * 100n) / BigInt(incomeCents)).toString();
}
