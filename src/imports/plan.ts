import { addCents } from '../core/money';
import { normalizeName, type LoanType, type TransactionDirection } from '../core/model';
import { cellText, excelDate, excelMoney, excelTime, isBlank } from './values';
import type {
  CellValue,
  ColumnField,
  ImportPlan,
  ImportRow,
  SheetMapping,
  WorkbookData,
} from './types';

function labels(value: string) {
  return value
    .split(/[,，;；\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function namedDirection(value: CellValue | undefined, mapping: SheetMapping): TransactionDirection {
  const text = cellText(value).toLowerCase();
  const candidates: TransactionDirection[] = [];
  if (labels(mapping.expenseLabels).includes(text)) candidates.push('expense');
  if (labels(mapping.incomeLabels).includes(text)) candidates.push('income');
  if (labels(mapping.transferLabels).includes(text)) candidates.push('transfer');
  if (labels(mapping.loanLabels).includes(text)) candidates.push('loan');
  if (candidates.length !== 1)
    throw new Error('收支类型无法唯一识别，请确认类型列或自定义对应值。');
  return candidates[0];
}

function boundedName(value: string, label: string) {
  const name = normalizeName(value);
  if (!name || name.length > 120 || name.includes('\0'))
    throw new Error(`${label}不能为空，且不能超过120个字。`);
  return name;
}

function parseLoanType(value: CellValue | undefined): LoanType {
  const type = cellText(value).toLowerCase();
  const known: Record<string, LoanType> = {
    借入: 'borrow',
    借出: 'lend',
    还款: 'repay',
    收款: 'collect',
    borrow: 'borrow',
    lend: 'lend',
    repay: 'repay',
    collect: 'collect',
  };
  if (!known[type]) throw new Error('借贷类型必须是借入、借出、还款或收款。');
  return known[type];
}

function parseRow(
  row: CellValue[],
  mapping: SheetMapping,
  rowNumber: number,
  date1904: boolean,
): ImportRow {
  const cell = (field: ColumnField) =>
    mapping.columns[field] === null ? null : (row[mapping.columns[field]!] ?? null);
  const warnings: string[] = [];
  if (row.includes('#EXCEL_CELL_ERROR'))
    throw new Error('该行包含错误公式或无缓存的公式，请在表格软件重新计算并保存。');
  const parsedDate = excelDate(cell('date'), date1904, mapping.dateOrder);
  const separateAmounts = mapping.columns.expense !== null || mapping.columns.income !== null;
  let direction: TransactionDirection;
  let amountCents: number;
  if (separateAmounts) {
    const expense = isBlank(cell('expense')) ? 0 : excelMoney(cell('expense'), true);
    const income = isBlank(cell('income')) ? 0 : excelMoney(cell('income'), true);
    if (expense < 0 || income < 0)
      throw new Error('独立收支金额列含负值，请确认退款或冲销的表示方式。');
    if (expense > 0 === income > 0) throw new Error('独立收支金额列需要且只能有一个非零值。');
    direction = expense > 0 ? 'expense' : 'income';
    amountCents = expense || income;
    if (!isBlank(cell('direction')) && namedDirection(cell('direction'), mapping) !== direction)
      throw new Error('收支类型与金额列矛盾。');
  } else {
    const amount = excelMoney(cell('amount'));
    if (!isBlank(cell('direction'))) direction = namedDirection(cell('direction'), mapping);
    else if (mapping.defaultDirection === 'signed') direction = amount < 0 ? 'expense' : 'income';
    else if (mapping.defaultDirection) direction = mapping.defaultDirection;
    else throw new Error('缺少收支类型，请选择类型列或明确该表的默认收支。');
    if (direction === 'income' && amount < 0 && mapping.defaultDirection !== 'signed')
      throw new Error('收入记录金额为负，请确认冲销含义，不会自动把它改为正收入。');
    amountCents = Math.abs(amount);
  }
  let primary = cellText(cell('primary'));
  let secondary = cellText(cell('secondary'));
  const hasCategory = direction === 'expense' || direction === 'income';
  if (hasCategory && mapping.columns.path !== null && !isBlank(cell('path'))) {
    if (!mapping.pathSeparator) throw new Error('请填写分类路径分隔符。');
    let pieces = cellText(cell('path'))
      .split(mapping.pathSeparator)
      .map((item) => item.trim());
    if (
      pieces.length === 3 &&
      ['支出', '收入', 'expense', 'income'].includes(pieces[0].toLowerCase())
    ) {
      const prefix = /^(收入|income)$/i.test(pieces[0]) ? 'income' : 'expense';
      if (prefix !== direction) throw new Error('完整分类路径中的收支类型不一致。');
      pieces = pieces.slice(1);
    }
    if (pieces.length > 2) throw new Error('分类路径超过两级，请确认分隔符。');
    if (primary && primary !== pieces[0])
      throw new Error('一级分类和完整路径列不一致，请只选择正确的一组。');
    if (secondary && pieces[1] && secondary !== pieces[1])
      throw new Error('二级分类和完整路径列不一致。');
    primary ||= pieces[0];
    secondary ||= pieces[1] ?? '';
  }
  if (hasCategory) {
    if (!primary) {
      primary = mapping.defaultPrimary;
      if (!(mapping.legacyFormat && direction === 'income' && primary === '收入'))
        warnings.push('使用默认一级分类');
    }
    if (!secondary) {
      secondary = mapping.defaultSecondary;
      warnings.push('使用默认二级分类');
    }
    primary = boundedName(primary, '一级分类');
    secondary = boundedName(secondary, '二级分类');
  } else {
    primary = '';
    secondary = '';
  }
  let account = cellText(cell('account'));
  if (!account) {
    account = mapping.defaultAccount;
    warnings.push('使用默认账户');
  }
  account = boundedName(account, '账户');
  const toAccount =
    direction === 'transfer' ? boundedName(cellText(cell('toAccount')), '转入账户') : null;
  if (toAccount === account) throw new Error('转出和转入账户不能相同。');
  const rawBook = cellText(cell('book'));
  const book = rawBook ? boundedName(rawBook, '账本') : null;
  let member: string | null = null;
  if (direction !== 'loan') {
    const memberValue = cellText(cell('member'));
    if (!memberValue) warnings.push('成员缺失，使用默认标记');
    member = boundedName(memberValue || mapping.defaultMember, '成员');
  }
  const loanType = direction === 'loan' ? parseLoanType(cell('loanType')) : null;
  const person =
    direction === 'loan'
      ? boundedName(cellText(cell('person')) || mapping.defaultPerson, '借贷人')
      : null;
  const transferType =
    direction === 'transfer' && !isBlank(cell('transferType'))
      ? boundedName(cellText(cell('transferType')), '转账类型')
      : undefined;
  const noteValue = cell('note');
  const note = typeof noteValue === 'string' ? noteValue : cellText(noteValue);
  if (note.length > 20_000 || note.includes('\0')) throw new Error('备注过长或包含无效字符。');
  const dateValue = cell('date');
  const rawDate = typeof dateValue === 'number' ? dateValue : cellText(dateValue);
  if (typeof rawDate === 'string' && rawDate.length > 256) throw new Error('原始日期文本过长。');
  const time =
    mapping.columns.time !== null && !isBlank(cell('time'))
      ? excelTime(cell('time'))
      : parsedDate.time;
  return {
    sheet: mapping.name,
    row: rowNumber,
    direction,
    amountCents,
    date: parsedDate.date,
    ...(time ? { time } : {}),
    rawDate,
    primary,
    secondary,
    account,
    toAccount,
    book,
    note,
    member,
    person,
    loanType,
    ...(transferType ? { transferType } : {}),
    warnings,
  };
}

export function prepareImport(workbook: WorkbookData, mappings: SheetMapping[]): ImportPlan {
  const plan: ImportPlan = {
    workbook: { fileName: workbook.fileName, digest: workbook.digest, size: workbook.size },
    rows: [],
    errors: [],
    skipped: [],
    blankRows: 0,
    enabledSheets: 0,
    totals: { income: 0, expense: 0, transfer: 0, loan: 0 },
  };
  for (const mapping of mappings.filter((item) => item.enabled)) {
    const sheet = workbook.sheets.find((item) => item.name === mapping.name);
    if (!sheet) throw new Error('选中的工作表不存在。');
    plan.enabledSheets++;
    if (
      !Number.isSafeInteger(mapping.headerRow) ||
      mapping.headerRow < 1 ||
      mapping.headerRow > sheet.rows.length
    )
      throw new Error('表头行号不正确。');
    const header = sheet.rows[mapping.headerRow - 1] ?? [];
    for (const column of Object.values(mapping.columns))
      if (
        column !== null &&
        (!Number.isSafeInteger(column) || column < 0 || column >= header.length)
      )
        throw new Error('列映射超出工作表范围。');
    if (mapping.columns.date === null) throw new Error(`请为“${mapping.name}”选择日期列。`);
    if (
      mapping.columns.amount === null &&
      mapping.columns.expense === null &&
      mapping.columns.income === null
    )
      throw new Error(`请为“${mapping.name}”选择金额列。`);
    for (let index = mapping.headerRow; index < sheet.rows.length; index++) {
      const row = sheet.rows[index];
      if (row.every(isBlank)) {
        plan.blankRows++;
        continue;
      }
      const rowNumber = index + 1;
      const repeatedHeader =
        header.length > 1 &&
        header.every((cell, column) => cellText(cell) === cellText(row[column]));
      const first = cellText(row.find((cell) => !isBlank(cell)));
      let summary = /^(?:总?合计|总计|小计|累计|total)$/i.test(first);
      if (summary) {
        try {
          excelDate(row[mapping.columns.date!], workbook.date1904, mapping.dateOrder);
          summary = false;
        } catch {
          /* A caption/summary row has no valid transaction date. */
        }
      }
      if (repeatedHeader || summary) {
        plan.skipped.push({
          sheet: sheet.name,
          row: rowNumber,
          code: repeatedHeader ? 'REPEATED_HEADER' : 'SUMMARY_ROW',
          message: repeatedHeader ? '重复表头' : '合计行，不作为流水导入',
        });
        continue;
      }
      try {
        const parsed = parseRow(row, mapping, rowNumber, workbook.date1904);
        plan.rows.push(parsed);
      } catch (error) {
        plan.errors.push({
          sheet: sheet.name,
          row: rowNumber,
          code: 'INVALID_ROW',
          message: error instanceof Error ? error.message : '该行无法解析',
        });
      }
    }
  }
  if (!plan.enabledSheets) throw new Error('请至少选择一张工作表。');
  for (const row of plan.rows)
    plan.totals[row.direction] = addCents(plan.totals[row.direction], row.amountCents);
  return plan;
}
