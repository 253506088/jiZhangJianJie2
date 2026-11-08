import {
  isValidDate,
  validateState,
  type LedgerState,
  type Transaction,
  type TransactionDirection,
} from '../core';

export type ExcelExportFormat = 'xls' | 'xlsx';
export interface ExcelExportOptions {
  bookId: string;
  format: ExcelExportFormat;
  /** Both endpoints are inclusive calendar dates; omission leaves that side unbounded. */
  fromDate?: string;
  toDate?: string;
}

export const XLS_MAX_DATA_ROWS = 65_533;
export const MAX_EXCEL_OUTPUT_BYTES = 32 * 1024 * 1024;
export const EXCEL_SHEETS = ['支出', '收入', '转账', '借贷'] as const;
export const EXCEL_HEADERS = {
  支出: ['金额', '支出大类', '支出小类', '账户', '时间', '成员', '备注'],
  收入: ['金额', '收入类别', '账户', '时间', '成员', '备注'],
  转账: ['金额', '转账类型', '原账户', '目标账户', '时间', '成员', '备注'],
  借贷: ['金额', '借贷类型', '账户', '借贷人', '时间', '备注'],
} as const;

const sheetForDirection: Record<TransactionDirection, (typeof EXCEL_SHEETS)[number]> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  loan: '借贷',
};
const loanTypeLabels = { borrow: '借入', lend: '借出', repay: '还款', collect: '收款' } as const;

export interface ExcelExportSummary {
  bookId: string;
  bookName: string;
  format: ExcelExportFormat;
  count: number;
  counts: Record<TransactionDirection, number>;
  firstDate: string | null;
  lastDate: string | null;
  rangeLabel: string;
  exactTotals: Record<TransactionDirection, string>;
  flattenedIncomeRows: number;
  dateOnlyRows: number;
  tooManyXlsRows: boolean;
}

export interface PreparedExcelExport {
  sheets: { name: (typeof EXCEL_SHEETS)[number]; rows: string[][] }[];
  summary: ExcelExportSummary;
}

export function centsAsText(cents: bigint | number): string {
  if (typeof cents === 'number' && !Number.isSafeInteger(cents))
    throw new Error('金额不是有效的整数分。');
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function select(state: LedgerState, options: ExcelExportOptions) {
  validateState(state);
  if (options.format !== 'xls' && options.format !== 'xlsx')
    throw new Error('请选择 XLS 或 XLSX 格式。');
  if (
    (options.fromDate && !isValidDate(options.fromDate)) ||
    (options.toDate && !isValidDate(options.toDate)) ||
    (options.fromDate && options.toDate && options.fromDate > options.toDate)
  )
    throw new Error('导出日期范围不正确。');
  const book = state.books.find((item) => item.id === options.bookId);
  if (!book) throw new Error('请选择有效的账本。');
  const transactions = state.transactions
    .filter(
      (item) =>
        item.bookId === book.id &&
        (!options.fromDate || item.date >= options.fromDate) &&
        (!options.toDate || item.date <= options.toDate),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time?.padEnd(8, ':00') ?? '').localeCompare(b.time?.padEnd(8, ':00') ?? '') ||
        a.createdAt.localeCompare(b.createdAt),
    );
  return { book, transactions };
}

function summaryFor(
  state: LedgerState,
  options: ExcelExportOptions,
  bookName: string,
  transactions: Transaction[],
): ExcelExportSummary {
  const counts = { expense: 0, income: 0, transfer: 0, loan: 0 };
  const totals = { expense: 0n, income: 0n, transfer: 0n, loan: 0n };
  const categories = new Map(state.categories.map((item) => [item.id, item]));
  let flattenedIncomeRows = 0;
  let dateOnlyRows = 0;
  for (const transaction of transactions) {
    counts[transaction.direction]++;
    totals[transaction.direction] += BigInt(transaction.amountCents);
    if (!transaction.time) dateOnlyRows++;
    if (transaction.direction === 'income') {
      const category = categories.get(transaction.categoryId!)!;
      if (categories.get(category.parentId!)!.name !== '收入') flattenedIncomeRows++;
    }
  }
  const firstDate = transactions[0]?.date ?? null;
  const lastDate = transactions.at(-1)?.date ?? null;
  const from = options.fromDate ?? firstDate;
  const to = options.toDate ?? lastDate;
  const rangeLabel =
    from && to ? `${from} - ${to}` : from ? `${from} - 不限` : to ? `不限 - ${to}` : '全部历史';
  return {
    bookId: options.bookId,
    bookName,
    format: options.format,
    count: transactions.length,
    counts,
    firstDate,
    lastDate,
    rangeLabel,
    exactTotals: {
      expense: totals.expense.toString(),
      income: totals.income.toString(),
      transfer: totals.transfer.toString(),
      loan: totals.loan.toString(),
    },
    flattenedIncomeRows,
    dateOnlyRows,
    tooManyXlsRows:
      options.format === 'xls' && Object.values(counts).some((count) => count > XLS_MAX_DATA_ROWS),
  };
}

export function summarizeExcelExport(
  state: LedgerState,
  options: ExcelExportOptions,
): ExcelExportSummary {
  const selected = select(state, options);
  return summaryFor(state, options, selected.book.name, selected.transactions);
}

/** Original minute-only text is kept minute-only while its calendar value still matches the record. */
export function exportedDateTime(transaction: Transaction): string {
  if (!transaction.time) return transaction.date;
  const raw = transaction.source?.rawDate;
  if (typeof raw === 'string') {
    const match = raw.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{2}:\d{2})$/);
    if (match) {
      const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      if (
        date === transaction.date &&
        (transaction.time === match[4] || transaction.time === `${match[4]}:00`)
      )
        return `${transaction.date} ${match[4]}`;
    }
  }
  return `${transaction.date} ${transaction.time}`;
}

/** Creates legacy-shaped text cells. It never emits formulas or adds fictional legacy columns. */
export function prepareLegacyExport(
  state: LedgerState,
  options: ExcelExportOptions,
): PreparedExcelExport {
  const selected = select(state, options);
  const summary = summaryFor(state, options, selected.book.name, selected.transactions);
  if (summary.tooManyXlsRows)
    throw new Error(
      'XLS 每张表最多 65,533 条明细（另有3行表头）。请改用 XLSX 或缩小日期范围，不会截断导出。',
    );
  const categories = new Map(state.categories.map((item) => [item.id, item]));
  const accounts = new Map(state.accounts.map((item) => [item.id, item]));
  const members = new Map(state.members.map((item) => [item.id, item]));
  const people = new Map(state.loanPeople.map((item) => [item.id, item]));
  const rows = new Map(EXCEL_SHEETS.map((name) => [name, [] as string[][]]));
  for (const transaction of selected.transactions) {
    const amount = centsAsText(transaction.amountCents);
    const account = accounts.get(transaction.accountId)!.name;
    const time = exportedDateTime(transaction);
    let row: string[];
    if (transaction.direction === 'expense') {
      const child = categories.get(transaction.categoryId!)!;
      const parent = categories.get(child.parentId!)!;
      row = [
        amount,
        parent.name,
        child.name,
        account,
        time,
        members.get(transaction.memberId!)!.name,
        transaction.note,
      ];
    } else if (transaction.direction === 'income') {
      const child = categories.get(transaction.categoryId!)!;
      const parent = categories.get(child.parentId!)!;
      const name = parent.name === '收入' ? child.name : `${parent.name} / ${child.name}`;
      row = [
        amount,
        name,
        account,
        time,
        members.get(transaction.memberId!)!.name,
        transaction.note,
      ];
    } else if (transaction.direction === 'transfer') {
      row = [
        amount,
        transaction.transferType ?? '',
        account,
        accounts.get(transaction.toAccountId!)!.name,
        time,
        members.get(transaction.memberId!)!.name,
        transaction.note,
      ];
    } else {
      row = [
        amount,
        loanTypeLabels[transaction.loanType!],
        account,
        people.get(transaction.personId!)!.name,
        time,
        transaction.note,
      ];
    }
    if (row.some((cell) => cell.length > 32_767))
      throw new Error('某个单元格超过 Excel 的 32,767 字符上限，请使用完整备份保存数据。');
    rows.get(sheetForDirection[transaction.direction])!.push(row);
  }
  return {
    summary,
    sheets: EXCEL_SHEETS.map((name) => ({
      name,
      rows: [
        name === '支出'
          ? [name, centsAsText(BigInt(summary.exactTotals.expense))]
          : name === '收入'
            ? [name, centsAsText(BigInt(summary.exactTotals.income))]
            : [name],
        ['时间', summary.rangeLabel],
        [...EXCEL_HEADERS[name]],
        ...rows.get(name)!,
      ],
    })),
  };
}

export function excelExportFileName(summary: ExcelExportSummary): string {
  const clean = Array.from(summary.bookName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_'))
    .slice(0, 45)
    .join('');
  const range =
    summary.firstDate && summary.lastDate ? `${summary.firstDate}_${summary.lastDate}` : '全部历史';
  return `简洁记账-${clean || '账本'}-${range}.${summary.format}`;
}
