import type { Budget, BudgetPeriod } from './model';

export interface BudgetDateRange {
  fromDate: string;
  toDate: string;
}

function calendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('预算日期格式不正确');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new RangeError('预算日期不在有效日历内');
  return date;
}

function dateText(value: Date): string {
  const text = value.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new RangeError('预算周期超出支持的年份范围');
  return text;
}

/** Calendar-day ranges independent of DST. Input is a local civil date, not a timestamp. */
export function periodRange(
  date: string,
  period: BudgetPeriod,
  weekStartsOn: 0 | 1 = 1,
): BudgetDateRange {
  if (weekStartsOn !== 0 && weekStartsOn !== 1) throw new RangeError('周起始日只能是周日或周一');
  const start = calendarDate(date);
  const end = new Date(start);
  if (period === 'week') {
    const distance = (start.getUTCDay() - weekStartsOn + 7) % 7;
    start.setUTCDate(start.getUTCDate() - distance);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
  } else if (period === 'month') {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  } else if (period !== 'day') throw new RangeError('预算周期不正确');
  return { fromDate: dateText(start), toDate: dateText(end) };
}

export function budgetPeriod(budget: Budget): BudgetPeriod {
  return budget.period ?? 'month';
}

/** Recurring anchors are creation metadata. A fixed week's anchor is its immutable first day. */
export function budgetWindow(
  budget: Budget,
  date: string,
  weekStartsOn: 0 | 1 = 1,
): BudgetDateRange {
  const period = budgetPeriod(budget);
  if (budget.recurring === true) return periodRange(date, period, weekStartsOn);
  if (period === 'month') return periodRange(`${budget.month}-01`, 'month', weekStartsOn);
  if (!budget.anchorDate) throw new RangeError('固定日/周预算缺少起始日期');
  const start = calendarDate(budget.anchorDate);
  if (period === 'day') return { fromDate: dateText(start), toDate: dateText(start) };
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { fromDate: dateText(start), toDate: dateText(end) };
}

export function budgetAppliesToDate(
  budget: Budget,
  date: string,
  weekStartsOn: 0 | 1 = 1,
): boolean {
  const selected = periodRange(date, budgetPeriod(budget), weekStartsOn);
  const own = budgetWindow(budget, date, weekStartsOn);
  return selected.fromDate === own.fromDate && selected.toDate === own.toDate;
}

/** Category is separate: append it when comparing allocation identity. */
export function budgetScopeKey(budget: Budget): string {
  const period = budgetPeriod(budget);
  return JSON.stringify([
    budget.bookId,
    period,
    budget.recurring === true ? 'recurring' : 'fixed',
    budget.recurring === true ? '*' : period === 'month' ? budget.month : budget.anchorDate,
  ]);
}
