import type { TransactionDirection } from '../core/model';

export type CellValue = string | number | boolean | null;
export interface WorkbookSheet {
  name: string;
  rows: CellValue[][];
}
export interface WorkbookData {
  fileName: string;
  digest: string;
  size: number;
  date1904: boolean;
  sheets: WorkbookSheet[];
}

export const columnLabels = {
  date: '日期',
  time: '时间（可选）',
  direction: '收支类型',
  amount: '金额',
  expense: '支出金额（独立列）',
  income: '收入金额（独立列）',
  primary: '一级分类',
  secondary: '二级分类',
  path: '完整分类路径',
  account: '账户',
  toAccount: '转入账户',
  book: '账本',
  note: '备注',
} as const;
export type ColumnField = keyof typeof columnLabels;
export type ColumnMap = Record<ColumnField, number | null>;
export interface SheetMapping {
  name: string;
  enabled: boolean;
  /** One-based header row, including leading blank/title rows. */
  headerRow: number;
  columns: ColumnMap;
  defaultDirection: TransactionDirection | 'signed' | null;
  dateOrder: 'ymd' | 'dmy' | 'mdy';
  defaultAccount: string;
  defaultPrimary: string;
  defaultSecondary: string;
  pathSeparator: string;
  expenseLabels: string;
  incomeLabels: string;
  transferLabels: string;
}

export interface ImportRow {
  sheet: string;
  row: number;
  direction: TransactionDirection;
  amountCents: number;
  date: string;
  time?: string;
  rawDate: string | number;
  primary: string;
  secondary: string;
  account: string;
  toAccount: string | null;
  book: string | null;
  note: string;
  warnings: string[];
}
export interface RowIssue {
  sheet: string;
  row: number;
  code: string;
  message: string;
}
export interface ImportPlan {
  workbook: Pick<WorkbookData, 'fileName' | 'digest' | 'size'>;
  rows: ImportRow[];
  errors: RowIssue[];
  skipped: RowIssue[];
  blankRows: number;
  enabledSheets: number;
  totals: { income: number; expense: number; transfer: number };
}
export interface ImportOptions {
  targetBookId: string;
  useBookColumn: boolean;
  /** Invalid rows are never silently omitted; the UI requires explicit consent. */
  allowRejectedRows: boolean;
  fromDate?: string;
  toDate?: string;
}

export function emptyColumns(): ColumnMap {
  return Object.fromEntries(Object.keys(columnLabels).map((key) => [key, null])) as ColumnMap;
}
