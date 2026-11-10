import {
  categoryPathKey,
  normalizeName,
  validateState,
  type LedgerState,
  type TransactionDirection,
} from '../core';
import { EXCEL_HEADERS, EXCEL_SHEETS } from '../exports/model';
import { autoMapping } from '../imports/mapping';
import { prepareImport } from '../imports/plan';
import { isBlank } from '../imports/values';
import type { ColumnField, ImportPlan, WorkbookData } from '../imports/types';

const directions = ['expense', 'income', 'transfer', 'loan'] as const;
export interface ReconciliationOptions {
  bookId: string;
  year: number;
}
export interface ComparedRecord {
  /** Local report position, not a ledger identifier. */
  position: number;
  sheet?: string;
  row?: number;
  direction: TransactionDirection;
  date: string;
  time: string;
  amountCents: number;
  category: string;
  account: string;
  toAccount: string;
  member: string;
  person: string;
  loanType: string;
  transferType: string;
  note: string;
}
export interface Difference {
  kind: 'missing' | 'extra' | 'amount' | 'ambiguous';
  legacy: ComparedRecord[];
  current: ComparedRecord[];
}
export interface ReconciliationResult {
  year: number;
  passed: boolean;
  blockers: string[];
  legacyCount: number;
  currentCount: number;
  matchedCount: number;
  outsideYearCount: number;
  invalidRows: { sheet: string; row: number; code: string }[];
  warningRows: number;
  counts: Record<TransactionDirection, { legacy: number; current: number; matched: number }>;
  totals: Record<TransactionDirection, { legacyCents: string; currentCents: string }>;
  differences: Difference[];
}

/** The strict legacy surface avoids silent guesses from a changed header or omitted sheet. */
export function prepareLegacyReconciliation(workbook: WorkbookData): ImportPlan {
  if (workbook.sheets.length !== EXCEL_SHEETS.length)
    throw new Error('请使用包含支出、收入、转账、借贷四张表的旧版原始 Excel。');
  for (const name of EXCEL_SHEETS) {
    const sheet = workbook.sheets.find((item) => item.name === name);
    const header = sheet?.rows[2] ?? [];
    const expected = EXCEL_HEADERS[name];
    if (
      !sheet ||
      sheet.rows[0]?.[0] !== name ||
      sheet.rows[1]?.[0] !== '时间' ||
      expected.some((value, index) => header[index] !== value) ||
      header.slice(expected.length).some((value) => value !== null && value !== '')
    )
      throw new Error('旧版表头无法完整识别，请选择未修改的 4.8.8 导出文件。不会猜测字段。');
  }
  // The verified header is always row 3. Never let data cells become a guessed header.
  const mappings = workbook.sheets.map((sheet) =>
    autoMapping({ ...sheet, rows: sheet.rows.slice(0, 3) }),
  );
  const plan = prepareImport(workbook, mappings);
  // General imports may skip captions with explicit user review. An original legacy export
  // has no nonempty caption/header rows in its data area, so reconciliation must block them.
  for (const issue of plan.skipped)
    plan.errors.push({
      ...issue,
      code: `UNEXPECTED_${issue.code}`,
      message: '原始数据区包含无法作为流水核对的非空行。',
    });
  const sources = new Map(
    workbook.sheets.map((sheet, index) => [sheet.name, { sheet, mapping: mappings[index] }]),
  );
  for (const row of plan.rows) {
    const { sheet, mapping } = sources.get(row.sheet)!;
    const raw = sheet.rows[row.row - 1];
    const required: ColumnField[] = ['amount', 'date', 'account'];
    if (row.direction === 'loan') required.push('loanType', 'person');
    else required.push('member');
    if (row.direction === 'expense') required.push('primary', 'secondary');
    if (row.direction === 'income') required.push('secondary');
    if (row.direction === 'transfer') required.push('toAccount');
    const missingRequired = required.some((field) => {
      const column = mapping.columns[field];
      return column === null || isBlank(raw[column]);
    });
    // The observed old format always supplies minute precision, including midnight.
    // A date-only value cannot prove that the new ledger retained the original time.
    if (missingRequired || !row.time) {
      row.warnings.push('原始匹配字段或分钟时刻缺失');
      plan.errors.push({
        sheet: row.sheet,
        row: row.row,
        code: 'MISSING_MATCH_FIELDS',
        message: '原始流水缺少必要的匹配字段或分钟时刻，不能确认逐笔一致。',
      });
    }
  }
  return plan;
}

function annualCoverage(workbook: WorkbookData, year: number) {
  return workbook.sheets.every((sheet) => {
    const range = String(sheet.rows[1]?.[1] ?? '').trim();
    // Original monthly exports show next-period start. Accept both explicit yearly conventions.
    const match = range.match(/^(\d{4})-(\d{2})-(\d{2})\s+-\s+(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const from = `${match[1]}-${match[2]}-${match[3]}`;
    const to = `${match[4]}-${match[5]}-${match[6]}`;
    return from === `${year}-01-01` && (to === `${year}-12-31` || to === `${year + 1}-01-01`);
  });
}

function headerTotalMatches(workbook: WorkbookData, name: '支出' | '收入', expected: bigint) {
  const raw = workbook.sheets.find((sheet) => sheet.name === name)!.rows[0]?.[1];
  const match = String(raw ?? '')
    .trim()
    .match(/^(\d{1,18})(?:\.(\d{1,2}))?$/);
  if (!match) return false;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0')) === expected;
}

function mapPush<T>(map: Map<string, T[]>, key: string, value: T) {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

/** Read-only multiset comparison. Amount is deliberately excluded from the pairing key. */
export function reconcileLegacyWorkbook(
  state: LedgerState,
  workbook: WorkbookData,
  options: ReconciliationOptions,
): ReconciliationResult {
  validateState(state);
  if (!Number.isInteger(options.year) || options.year < 1900 || options.year > 9998)
    throw new Error('对账年份需为 1900 至 9998 的四位年份。');
  if (!state.books.some((book) => book.id === options.bookId)) throw new Error('请选择有效账本。');
  const plan = prepareLegacyReconciliation(workbook);
  const { bookId, year } = options;
  const prefix = `${year}-`;
  const rows = plan.rows.filter((row) => row.date.startsWith(prefix));
  const transactions = state.transactions.filter(
    (item) => item.bookId === bookId && item.date.startsWith(prefix),
  );
  const categories = new Map(state.categories.map((item) => [item.id, item]));
  const categoryKeys = new Map<string, string>();
  for (const category of state.categories.filter(
    (item) => item.bookId === bookId && item.parentId,
  )) {
    categoryKeys.set(
      categoryPathKey(
        bookId,
        category.direction,
        categories.get(category.parentId!)!.name,
        category.name,
      ),
      category.id,
    );
  }
  for (const alias of state.categoryAliases.filter((item) => item.bookId === bookId))
    categoryKeys.set(
      categoryPathKey(bookId, alias.direction, alias.primaryName, alias.secondaryName),
      alias.categoryId,
    );
  const memberKeys = new Map(
    state.members.filter((item) => item.bookId === bookId).map((item) => [item.name, item.id]),
  );
  for (const alias of state.memberAliases.filter((item) => item.bookId === bookId))
    memberKeys.set(alias.name, alias.memberId);
  const personKeys = new Map(
    state.loanPeople.filter((item) => item.bookId === bookId).map((item) => [item.name, item.id]),
  );
  for (const alias of state.loanPersonAliases.filter((item) => item.bookId === bookId))
    personKeys.set(alias.name, alias.personId);
  const accounts = new Map(state.accounts.map((item) => [item.id, item.name]));
  const members = new Map(state.members.map((item) => [item.id, item.name]));
  const people = new Map(state.loanPeople.map((item) => [item.id, item.name]));
  const groups = new Map<string, { legacy: ComparedRecord[]; current: ComparedRecord[] }>();
  const groupKey = (record: ComparedRecord, category: string, member: string, person: string) =>
    JSON.stringify([
      record.direction,
      record.date,
      record.time,
      category,
      normalizeName(record.account),
      normalizeName(record.toAccount),
      member,
      person,
      record.loanType,
      record.transferType,
      record.note,
    ]);
  function insert(key: string, side: 'legacy' | 'current', record: ComparedRecord) {
    let group = groups.get(key);
    if (!group) {
      group = { legacy: [], current: [] };
      groups.set(key, group);
    }
    group[side].push(record);
  }
  // The original export records minutes. Seconds stored by a DB migration are compared at that precision.
  const minute = (value?: string) => value?.slice(0, 5) ?? '';
  for (const [index, row] of rows.entries()) {
    const path =
      row.direction === 'expense' || row.direction === 'income'
        ? categoryPathKey(bookId, row.direction, row.primary, row.secondary)
        : '';
    const record: ComparedRecord = {
      position: index + 1,
      sheet: row.sheet,
      row: row.row,
      direction: row.direction,
      date: row.date,
      time: minute(row.time),
      amountCents: row.amountCents,
      category: path ? `${row.primary} / ${row.secondary}` : '',
      account: row.account,
      toAccount: row.toAccount ?? '',
      member: row.member ?? '',
      person: row.person ?? '',
      loanType: row.loanType ?? '',
      transferType: row.transferType ?? '',
      note: row.note,
    };
    insert(
      groupKey(
        record,
        categoryKeys.get(path) ?? `path:${path}`,
        memberKeys.get(record.member) ?? `name:${record.member}`,
        personKeys.get(record.person) ?? `name:${record.person}`,
      ),
      'legacy',
      record,
    );
  }
  for (const [index, transaction] of transactions.entries()) {
    const category = categories.get(transaction.categoryId ?? '');
    const record: ComparedRecord = {
      position: index + 1,
      direction: transaction.direction,
      date: transaction.date,
      time: minute(transaction.time),
      amountCents: transaction.amountCents,
      category: category ? `${categories.get(category.parentId!)!.name} / ${category.name}` : '',
      account: accounts.get(transaction.accountId)!,
      toAccount: accounts.get(transaction.toAccountId ?? '') ?? '',
      member: members.get(transaction.memberId ?? '') ?? '',
      person: people.get(transaction.personId ?? '') ?? '',
      loanType: transaction.loanType ?? '',
      transferType: transaction.transferType ?? '',
      note: transaction.note,
    };
    insert(
      groupKey(
        record,
        transaction.categoryId ?? 'path:',
        transaction.memberId ?? 'name:',
        transaction.personId ?? 'name:',
      ),
      'current',
      record,
    );
  }
  const counts = Object.fromEntries(
    directions.map((type) => [type, { legacy: 0, current: 0, matched: 0 }]),
  ) as ReconciliationResult['counts'];
  const exactTotals = Object.fromEntries(
    directions.map((type) => [type, { legacy: 0n, current: 0n }]),
  ) as Record<TransactionDirection, { legacy: bigint; current: bigint }>;
  const differences: Difference[] = [];
  let matchedCount = 0;
  for (const group of groups.values()) {
    const legacyAmounts = new Map<string, ComparedRecord[]>();
    const currentAmounts = new Map<string, ComparedRecord[]>();
    for (const side of ['legacy', 'current'] as const) {
      for (const record of group[side]) {
        counts[record.direction][side]++;
        exactTotals[record.direction][side] += BigInt(record.amountCents);
        mapPush(
          side === 'legacy' ? legacyAmounts : currentAmounts,
          String(record.amountCents),
          record,
        );
      }
    }
    const legacy: ComparedRecord[] = [],
      current: ComparedRecord[] = [];
    for (const amount of new Set([...legacyAmounts.keys(), ...currentAmounts.keys()])) {
      const old = legacyAmounts.get(amount) ?? [],
        now = currentAmounts.get(amount) ?? [];
      const matched = Math.min(old.length, now.length);
      matchedCount += matched;
      if (matched) counts[old[0].direction].matched += matched;
      for (let index = matched; index < old.length; index++) legacy.push(old[index]);
      for (let index = matched; index < now.length; index++) current.push(now[index]);
    }
    if (legacy.length === 1 && current.length === 1)
      differences.push({ kind: 'amount', legacy, current });
    else if (legacy.length && current.length)
      differences.push({ kind: 'ambiguous', legacy, current });
    else {
      for (const record of legacy)
        differences.push({ kind: 'missing', legacy: [record], current: [] });
      for (const record of current)
        differences.push({ kind: 'extra', legacy: [], current: [record] });
    }
  }
  const outsideYearCount = plan.rows.length - rows.length;
  const warningRows = plan.rows.filter((row) => row.warnings.length).length;
  const blockers: string[] = [];
  if (!annualCoverage(workbook, year))
    blockers.push(
      '文件中四张表的导出范围未完整覆盖所选全年，请在旧版选择全年导出。当前仅显示可读行的比较结果。',
    );
  if (outsideYearCount)
    blockers.push(`文件含 ${outsideYearCount} 笔其他年份记录，未计入本年比较。`);
  if (plan.errors.length)
    blockers.push(`有 ${plan.errors.length} 行无法完整解析或验证，不能确认完整性。`);
  if (warningRows)
    blockers.push(`有 ${warningRows} 行缺少账户、分类、成员等匹配字段，不能确认逐笔一致。`);
  for (const [name, direction] of [
    ['支出', 'expense'],
    ['收入', 'income'],
  ] as const) {
    const allRowsTotal = plan.rows
      .filter((row) => row.direction === direction)
      .reduce((sum, row) => sum + BigInt(row.amountCents), 0n);
    if (!headerTotalMatches(workbook, name, allRowsTotal))
      blockers.push(`${name}表顶部合计与可读明细不一致或无法识别，请确认原始导出完整性。`);
  }
  return {
    year,
    passed: !blockers.length && !differences.length,
    blockers,
    legacyCount: rows.length,
    currentCount: transactions.length,
    matchedCount,
    outsideYearCount,
    invalidRows: plan.errors.map(({ sheet, row, code }) => ({ sheet, row, code })),
    warningRows,
    counts,
    totals: Object.fromEntries(
      directions.map((type) => [
        type,
        {
          legacyCents: exactTotals[type].legacy.toString(),
          currentCents: exactTotals[type].current.toString(),
        },
      ]),
    ) as ReconciliationResult['totals'],
    differences,
  };
}

/** Export is redacted by default. No names, dates, notes, IDs, file names or monetary fields. */
export function reconciliationReport(result: ReconciliationResult, includeDetails = false): string {
  const base = {
    format: 'jizhang-annual-reconciliation',
    version: 1,
    year: result.year,
    passed: result.passed,
    blockers: result.blockers,
    legacyCount: result.legacyCount,
    currentCount: result.currentCount,
    matchedCount: result.matchedCount,
    outsideYearCount: result.outsideYearCount,
    invalidRows: result.invalidRows,
    warningRows: result.warningRows,
    counts: result.counts,
    differences: result.differences.map((difference, index) => ({
      number: index + 1,
      kind: difference.kind,
      legacy: difference.legacy.map(({ sheet, row }) => ({ sheet, row })),
      current: difference.current.map(({ position }) => ({ position })),
    })),
  };
  return JSON.stringify(
    includeDetails
      ? {
          ...base,
          includesPrivateDetails: true,
          totals: result.totals,
          differences: result.differences,
        }
      : base,
    null,
    2,
  );
}
