import {
  createEmptyState,
  isValidDate,
  isValidTime,
  localDate,
  nowIso,
  validateState,
  type CommandContext,
  type LedgerState,
  type LoanType,
  type Transaction,
} from '../core/model';
import { ensureCategoryPathDraft, ensureIncomeCategoryDraft } from '../core/commands';
import { ensureLoanPersonDraft, ensureMemberDraft } from '../core/people';
import { addCents, parseMoneyToCents } from '../core/money';
import { accountBalance } from '../core/selectors';
import type { LegacyDatabase, LegacyDbPlan, LegacyRow, LegacyValue } from './types';

const sourceDirections = {
  expenses: 'expense',
  income: 'income',
  transfer: 'transfer',
  borrow: 'loan',
} as const;
const loans: Record<string, LoanType> = {
  借入: 'borrow',
  借出: 'lend',
  还款: 'repay',
  收款: 'collect',
};
function text(value: LegacyValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('字段格式不正确。');
  return String(value);
}
function name(value: LegacyValue | undefined): string {
  const result = text(value).normalize('NFC').trim();
  if (!result || result.length > 120 || result.includes('\0'))
    throw new Error('名称为空或超过支持长度。');
  return result;
}
function id(row: LegacyRow): number {
  if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id < 1)
    throw new Error('原始记录标识无效。');
  return row.id;
}
function ordered(rows: LegacyRow[]): LegacyRow[] {
  const seen = new Set<number>();
  for (const row of rows) {
    const key = id(row);
    if (seen.has(key)) throw new Error('原始记录标识重复。');
    seen.add(key);
  }
  return [...rows].sort((a, b) => id(a) - id(b));
}
function amount(value: LegacyValue | undefined, signed = false): number {
  return parseMoneyToCents(text(value), { allowZero: signed, allowNegative: signed });
}
function date(value: LegacyValue | undefined) {
  const match = text(value).match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)$/);
  if (!match || !isValidDate(match[1]) || !isValidTime(match[2]))
    throw new Error('原始日期时间无效。');
  return { date: match[1], time: match[2] };
}

/** Convert one verified legacy book into an isolated state; never coalesce rows by content. */
export function prepareLegacyDatabase(
  source: LegacyDatabase,
  context: CommandContext = {},
): LegacyDbPlan {
  if (source.userVersion !== 16 || !/^[a-f0-9]{64}$/.test(source.digest))
    throw new Error('旧版数据库版本或摘要无效。');
  const tables = source.tables;
  if (tables.auto_charge.length)
    throw new Error(
      '数据库含非空自动记账记录，尚未验证其执行语义。已停止整份导入，不会漏导后报告成功。',
    );
  let serial = 0;
  const prefix = `legacy-${source.digest.slice(0, 24)}`;
  const deterministicContext = { ...context, idFactory: () => `${prefix}-${++serial}` };
  const importedAt = nowIso(context);
  const state = createEmptyState(deterministicContext);
  const bookId = state.books[0].id;
  state.books[0].name = '旧版账本';
  state.accounts = [];
  state.members = [];
  const warnings = new Set<string>([
    '数据库没有账本名称、主题和首页背景文件；请为导入账本命名，背景需重新选择。',
    '旧版图标、常用分类快捷入口和内部排序字段保留在迁移附属资料；新版使用自己的图标与分类顺序。',
  ]);
  const accountSnapshots = new Map<string, number>();
  for (const row of ordered(tables.account_type)) {
    const accountName = name(row.value);
    if (state.accounts.some((a) => a.name === accountName))
      throw new Error('旧版账户名称重复，无法无歧义关联流水。');
    const account = {
      id: `${prefix}-account-${id(row)}`,
      bookId,
      name: accountName,
      kind: 'other' as const,
      openingBalanceCents: 0,
      sortOrder: state.accounts.length,
      archived: false,
      createdAt: importedAt,
    };
    state.accounts.push(account);
    accountSnapshots.set(account.id, amount(row.money, true));
  }
  const getAccount = (value: LegacyValue | undefined) => {
    const accountName = name(value);
    let account = state.accounts.find((a) => a.name === accountName);
    if (!account) {
      account = {
        id: deterministicContext.idFactory(),
        bookId,
        name: accountName,
        kind: 'other',
        openingBalanceCents: 0,
        sortOrder: state.accounts.length,
        archived: false,
        createdAt: importedAt,
      };
      state.accounts.push(account);
      warnings.add(
        '部分历史账户已不在旧版账户配置中，已按期初余额 0 重建；这些账户的原余额无法核验。',
      );
    }
    return account.id;
  };
  for (const row of ordered(tables.member))
    ensureMemberDraft(state, bookId, name(row.member), deterministicContext);
  ensureMemberDraft(state, bookId, '自己', deterministicContext);
  for (const row of ordered(tables.borrow_member))
    ensureLoanPersonDraft(state, bookId, name(row.name), deterministicContext);
  for (const row of ordered(tables.expenses_left)) {
    const categoryName = name(row.left);
    if (categoryName === '常用') continue;
    if (
      state.categories.some(
        (c) => c.direction === 'expense' && c.parentId === null && c.name === categoryName,
      )
    )
      throw new Error('旧版一级分类名称重复，无法无歧义关联。');
    state.categories.push({
      id: `${prefix}-expense-main-${id(row)}`,
      bookId,
      direction: 'expense',
      parentId: null,
      name: categoryName,
      sortOrder: state.categories.length,
      archived: false,
      icon: 'category',
    });
  }
  for (const row of ordered(tables.expenses_right)) {
    const primaryName = name(row.key);
    if (primaryName === '常用') {
      if (!text(row.usually_key)) throw new Error('常用分类缺少原始父类，无法确认其身份。');
      continue;
    }
    const secondaryName = name(row.value);
    const parent = state.categories.find(
      (c) => c.parentId === null && c.direction === 'expense' && c.name === primaryName,
    );
    if (!parent) throw new Error('二级分类引用的一级分类不存在，已停止导入。');
    if (state.categories.some((c) => c.parentId === parent.id && c.name === secondaryName))
      throw new Error('同一父类存在重名二级分类，已停止导入。');
    state.categories.push({
      id: `${prefix}-expense-child-${id(row)}`,
      bookId,
      direction: 'expense',
      parentId: parent.id,
      name: secondaryName,
      sortOrder: id(row),
      archived: false,
      icon: 'category',
    });
  }
  for (const row of ordered(tables.income_type))
    ensureIncomeCategoryDraft(state, { bookId, name: name(row.income_type) }, deterministicContext);
  for (const row of tables.expenses_right.filter((row) => text(row.key) === '常用')) {
    const parent = state.categories.find(
      (c) => c.direction === 'expense' && c.parentId === null && c.name === text(row.usually_key),
    );
    if (
      !parent ||
      !state.categories.some((c) => c.parentId === parent.id && c.name === text(row.value))
    )
      warnings.add('部分旧版常用分类快捷入口已失效，仅保留原引用，不会创建重复分类。');
  }
  const batchId = `${prefix}-batch`;
  const sourceRows: { sheet: string; row: number; transactionId: string }[] = [];
  const sequenceCounts = new Map<string, number>();
  const sequenceKey = (
    table: string,
    stamp: string,
    rawDate: string,
    member: string,
    from: string,
    to: string,
  ) => JSON.stringify([table, stamp, rawDate, member, from, to]);
  for (const [table, direction] of Object.entries(sourceDirections)) {
    for (const row of ordered(tables[table])) {
      try {
        const rowId = id(row);
        const rawDate = text(row.date);
        const stamp = text(row.time_span);
        if (!/^\d{1,16}$/.test(stamp)) throw new Error('原始流水时间标识无效。');
        const sequence = sequenceKey(
          table,
          stamp,
          rawDate,
          text(row.member),
          text(direction === 'transfer' ? row.transfer_account_from : row.account_detail),
          direction === 'transfer' ? text(row.transfer_account_to) : '',
        );
        sequenceCounts.set(sequence, (sequenceCounts.get(sequence) ?? 0) + 1);
        const loanType = direction === 'loan' ? loans[text(row.type_detail)] : null;
        if (direction === 'loan' && !loanType) throw new Error('借贷方向未识别。');
        const accountId = getAccount(
          direction === 'transfer' ? row.transfer_account_from : row.account_detail,
        );
        if (direction === 'expense' && text(row.type_main) === '常用')
          throw new Error('流水以常用入口作为父类，无法证实真实分类归属，已停止导入。');
        const category =
          direction === 'expense'
            ? ensureCategoryPathDraft(
                state,
                {
                  bookId,
                  direction,
                  primaryName: name(row.type_main),
                  secondaryName: name(row.type_detail),
                },
                deterministicContext,
              )
            : direction === 'income'
              ? ensureIncomeCategoryDraft(
                  state,
                  { bookId, name: name(row.type_detail) },
                  deterministicContext,
                )
              : null;
        const transaction: Transaction = {
          id: `${prefix}-${table}-${rowId}`,
          bookId,
          direction,
          amountCents: amount(row.money),
          ...date(row.date),
          accountId,
          categoryId: category?.id ?? null,
          toAccountId: direction === 'transfer' ? getAccount(row.transfer_account_to) : null,
          memberId:
            direction === 'loan'
              ? null
              : ensureMemberDraft(state, bookId, name(row.member), deterministicContext).id,
          personId:
            direction === 'loan'
              ? ensureLoanPersonDraft(state, bookId, name(row.member), deterministicContext).id
              : null,
          loanType: loanType ?? null,
          note: text(row.remarks),
          createdAt: importedAt,
          updatedAt: importedAt,
          ...(direction === 'transfer' && text(row.type_detail)
            ? { transferType: text(row.type_detail) }
            : {}),
          source: { batchId, sheet: table, row: rowId, rawDate },
        };
        state.transactions.push(transaction);
        sourceRows.push({ sheet: table, row: rowId, transactionId: transaction.id });
        if (text(row.uri))
          warnings.add('旧版照片/附件仅保留路径，数据库不含图片文件，需保留原文件并手动管理。');
        if (
          direction === 'loan' &&
          ((text(row.remind_model) && text(row.remind_model) !== '无需提醒') || text(row.interest))
        )
          warnings.add(
            '部分借贷提醒或利息设置已保存在迁移附属资料，未自动启用或转换成流水；请在旧版核对。',
          );
      } catch (error) {
        throw new Error(
          `${table} 表第 ${id(row)} 条记录未通过校验：${error instanceof Error ? error.message : '格式错误'}`,
        );
      }
    }
  }
  for (const row of tables.time_sequence) {
    const key = sequenceKey(
      text(row.account_type),
      text(row.time_span_four),
      text(row.date),
      text(row.member),
      text(row.account_detail_1),
      text(row.account_detail_2),
    );
    const remaining = sequenceCounts.get(key) ?? 0;
    if (!remaining) throw new Error('旧版流水索引与四类明细不一致，已停止整份导入。');
    sequenceCounts.set(key, remaining - 1);
  }
  if ([...sequenceCounts.values()].some((n) => n !== 0))
    throw new Error('旧版四类明细存在没有索引的记录，已停止整份导入。');
  for (const account of state.accounts) {
    const snapshot = accountSnapshots.get(account.id);
    if (snapshot === undefined) continue;
    account.openingBalanceCents = addCents(snapshot, -accountBalance(state, account.id));
    if (accountBalance(state, account.id) !== snapshot)
      throw new Error('账户余额核对失败，未导入。');
  }
  for (const row of tables.borrow_member) {
    const person = state.loanPeople.find((p) => p.name === name(row.name))!;
    let net = 0;
    for (const tx of state.transactions.filter((t) => t.personId === person.id))
      net = addCents(
        net,
        ['lend', 'repay'].includes(tx.loanType!) ? tx.amountCents : -tx.amountCents,
      );
    if (net !== amount(row.money, true))
      warnings.add(
        '部分借贷人的旧版余额与明细净额不一致；原余额已保留，但新版借贷统计仅按已导入明细计算，请核对期初借贷。',
      );
  }
  const anchor = localDate();
  for (const row of ordered(tables.budget)) {
    const period = ({ 日预算: 'day', 周预算: 'week', 月预算: 'month' } as const)[
      text(row.expenses) as '日预算'
    ];
    if (!period) throw new Error('旧版预算周期未识别，已停止整份导入。');
    const categoryName = name(row.type);
    const category =
      categoryName === '总体预算'
        ? undefined
        : state.categories.find(
            (c) => c.direction === 'expense' && c.parentId === null && c.name === categoryName,
          );
    if (categoryName !== '总体预算' && !category)
      throw new Error('旧版预算引用未知分类，已停止整份导入。');
    state.budgets.push({
      id: `${prefix}-budget-${id(row)}`,
      bookId,
      categoryId: category?.id ?? null,
      period,
      recurring: true,
      anchorDate: anchor,
      month: anchor.slice(0, 7),
      amountCents: amount(row.total, true),
    });
  }
  if (tables.template.length)
    warnings.add(
      `旧版 ${tables.template.length} 个记账模板已完整保留在迁移附属资料，格式尚未验证，未自动启用。`,
    );
  if (tables.remind.length)
    warnings.add(`旧版 ${tables.remind.length} 条提醒已完整保留在迁移附属资料，未自动启用通知。`);
  state.imports.push({
    id: batchId,
    bookId,
    digest: source.digest,
    fileName: source.fileName,
    importedAt,
    totalRows: state.transactions.length,
    importedRows: state.transactions.length,
    skippedRows: 0,
    rejectedRows: 0,
    transactionIds: state.transactions.map((t) => t.id),
    sourceRows,
    legacyDb: { format: 'jianjie-4.8.8', userVersion: 16, tables: structuredClone(tables) },
  });
  validateState(state);
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 64 * 1024 * 1024)
    throw new Error(
      '转换后的账本连同原版附属资料超过 64 MiB，无法安全保存和完整备份，已停止导入。',
    );
  const totals: LegacyDbPlan['totals'] = {
    expense: { count: 0, cents: 0 },
    income: { count: 0, cents: 0 },
    transfer: { count: 0, cents: 0 },
    loan: { count: 0, cents: 0 },
  };
  for (const tx of state.transactions) {
    totals[tx.direction].count++;
    totals[tx.direction].cents = addCents(totals[tx.direction].cents, tx.amountCents);
  }
  return {
    fileName: source.fileName,
    digest: source.digest,
    state,
    warnings: [...warnings],
    totals,
  };
}

/** Import into a new separate book, keeping every existing book and setting intact. */
export function applyLegacyDatabase(
  current: LedgerState,
  plan: LegacyDbPlan,
  bookName: string,
): LedgerState {
  validateState(current);
  validateState(plan.state);
  if (
    plan.state.books.length !== 1 ||
    plan.state.imports.length !== 1 ||
    !plan.state.imports[0].legacyDb ||
    plan.state.imports[0].digest !== plan.digest ||
    plan.state.imports[0].fileName !== plan.fileName ||
    plan.state.imports[0].bookId !== plan.state.books[0].id
  )
    throw new Error('导入预览与来源身份不一致，请重新选择原文件。');
  const cleanName = name(bookName);
  if (current.imports.some((batch) => batch.digest === plan.digest))
    throw new Error('这份旧版数据库已经导入，未重复添加。');
  if (current.books.some((book) => book.name === cleanName))
    throw new Error('账本名称已存在，请为旧版迁移选择不同名称。');
  const next = structuredClone(current);
  const imported = structuredClone(plan.state);
  imported.books[0].name = cleanName;
  for (const key of [
    'books',
    'accounts',
    'members',
    'memberAliases',
    'loanPeople',
    'loanPersonAliases',
    'categories',
    'categoryAliases',
    'transactions',
    'imports',
    'budgets',
    'templates',
  ] as const) {
    for (const item of imported[key]) (next[key] as unknown[]).push(item);
  }
  next.settings.selectedBookId = imported.books[0].id;
  validateState(next);
  if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 64 * 1024 * 1024)
    throw new Error('导入后的完整账本超过 64 MiB，无法安全保存和完整备份，现有账本未更改。');
  return next;
}
