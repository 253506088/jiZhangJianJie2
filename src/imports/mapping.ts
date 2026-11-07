import type { TransactionDirection } from '../core/model';
import {
  emptyColumns,
  type CellValue,
  type ColumnField,
  type SheetMapping,
  type WorkbookSheet,
} from './types';

const aliases: Record<ColumnField, string[]> = {
  date: [
    '日期',
    '时间',
    '记账日期',
    '交易日期',
    '消费日期',
    '发生日期',
    '账单日期',
    'date',
    'datetime',
  ],
  time: ['时刻', '记账时间', '交易时间', 'time'],
  direction: ['收支', '收支类型', '类型', '收支方向', '收入支出', 'direction', 'type'],
  amount: ['金额', '数额', '交易金额', '记账金额', 'amount', 'money'],
  expense: ['支出', '支出金额', '消费金额', 'expense', 'expenses'],
  income: ['收入', '收入金额', 'income'],
  primary: [
    '一级分类',
    '一级类别',
    '大类',
    '主分类',
    '父分类',
    '分类一',
    '类别一',
    '分类1',
    '类别1',
    '支出大类',
    'primarycategory',
  ],
  secondary: [
    '二级分类',
    '二级类别',
    '小类',
    '子分类',
    '分类二',
    '类别二',
    '分类2',
    '类别2',
    '支出小类',
    'secondarycategory',
  ],
  path: ['分类', '类别', '分类路径', '完整分类', '完整分类路径', 'category'],
  account: ['账户', '帐户', '账户名称', '支付账户', '支付方式', 'account'],
  toAccount: ['转入账户', '转入帐户', '目标账户', '收款账户', 'toaccount'],
  book: ['账本', '帐本', '账本名称', '帐本名称', 'book', 'ledger'],
  note: [
    '备注',
    '说明',
    '描述',
    '摘要',
    '附注',
    '备注信息',
    'note',
    'notes',
    'remark',
    'description',
  ],
};

function headerKey(value: CellValue) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_（）()\[\]:：]/g, '')
    .replace(/人民币|rmb|cny|元/g, '');
}

export function inferColumns(row: CellValue[]) {
  const columns = emptyColumns();
  const taken = new Set<number>();
  for (const field of Object.keys(aliases) as ColumnField[]) {
    const index = row.findIndex(
      (value, position) => !taken.has(position) && aliases[field].includes(headerKey(value)),
    );
    if (index >= 0) {
      columns[field] = index;
      taken.add(index);
    }
  }
  return columns;
}

export function autoMapping(sheet: WorkbookSheet): SheetMapping {
  let headerRow = 1;
  let bestScore = -1;
  for (let index = 0; index < Math.min(sheet.rows.length, 60); index++) {
    const columns = inferColumns(sheet.rows[index]);
    const score =
      Object.values(columns).filter((value) => value !== null).length +
      (columns.date !== null ? 3 : 0) +
      (columns.amount !== null || columns.expense !== null || columns.income !== null ? 3 : 0);
    if (score > bestScore) {
      bestScore = score;
      headerRow = index + 1;
    }
  }
  let defaultDirection: TransactionDirection | null = null;
  if (/支出|expense/i.test(sheet.name) && !/收入|income/i.test(sheet.name))
    defaultDirection = 'expense';
  if (/收入|income/i.test(sheet.name) && !/支出|expense/i.test(sheet.name))
    defaultDirection = 'income';
  return {
    name: sheet.name,
    enabled: sheet.rows.some((row) =>
      row.some((value) => value !== null && String(value).trim() !== ''),
    ),
    headerRow,
    columns: inferColumns(sheet.rows[headerRow - 1] ?? []),
    defaultDirection,
    dateOrder: 'ymd',
    defaultAccount: '现金',
    defaultPrimary: '',
    defaultSecondary: '未细分',
    pathSeparator: '/',
    expenseLabels: '支出,支,消费,付款,出账,expense,expenses,payment',
    incomeLabels: '收入,入,收款,入账,income,receipt',
    transferLabels: '转账,转帐,transfer',
  };
}
