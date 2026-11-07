import {
  type Account,
  type Category,
  type Direction,
  type LedgerState,
  type Transaction,
  LedgerError,
} from './model';
import { addCents } from './money';

export interface TransactionFilter {
  bookId?: string;
  month?: string;
  fromDate?: string;
  toDate?: string;
  accountId?: string;
  categoryId?: string;
  direction?: Transaction['direction'];
  search?: string;
}

export function categoryPath(state: LedgerState, categoryId: string) {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) throw new LedgerError('分类不存在', 'NOT_FOUND');
  const parent =
    category.parentId === null
      ? null
      : (state.categories.find((item) => item.id === category.parentId) ?? null);
  if (category.parentId !== null && !parent) throw new LedgerError('父分类不存在', 'NOT_FOUND');
  return {
    category,
    parent,
    primaryName: parent?.name ?? category.name,
    secondaryName: parent ? category.name : null,
    label: parent ? `${parent.name} / ${category.name}` : category.name,
  };
}

export function activeCategories(
  state: LedgerState,
  bookId: string,
  direction: Direction,
  parentId: string | null = null,
): Category[] {
  return state.categories
    .filter(
      (item) =>
        item.bookId === bookId &&
        item.direction === direction &&
        item.parentId === parentId &&
        !item.archived,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'));
}

export function activeAccounts(state: LedgerState, bookId: string): Account[] {
  return state.accounts
    .filter((item) => item.bookId === bookId && !item.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'));
}

export function filterTransactions(
  state: LedgerState,
  filter: TransactionFilter = {},
): Transaction[] {
  const needle = filter.search?.trim().toLocaleLowerCase();
  const categoryIds = filter.categoryId
    ? new Set([
        filter.categoryId,
        ...state.categories
          .filter((item) => item.parentId === filter.categoryId)
          .map((item) => item.id),
      ])
    : null;
  const categoryMap = new Map(state.categories.map((category) => [category.id, category]));
  const categoryNames = needle
    ? new Map(
        state.categories.map((category) => [
          category.id,
          category.parentId
            ? `${categoryMap.get(category.parentId)?.name ?? ''} / ${category.name}`
            : category.name,
        ]),
      )
    : null;
  const accountNames = needle
    ? new Map(state.accounts.map((account) => [account.id, account.name]))
    : null;
  return state.transactions
    .filter((transaction) => {
      if (filter.bookId && transaction.bookId !== filter.bookId) return false;
      if (filter.month && !transaction.date.startsWith(`${filter.month}-`)) return false;
      if (filter.fromDate && transaction.date < filter.fromDate) return false;
      if (filter.toDate && transaction.date > filter.toDate) return false;
      if (
        filter.accountId &&
        transaction.accountId !== filter.accountId &&
        transaction.toAccountId !== filter.accountId
      )
        return false;
      if (filter.direction && transaction.direction !== filter.direction) return false;
      if (categoryIds && (!transaction.categoryId || !categoryIds.has(transaction.categoryId)))
        return false;
      if (
        needle &&
        ![
          transaction.note,
          categoryNames!.get(transaction.categoryId ?? '') ?? '',
          accountNames!.get(transaction.accountId) ?? '',
          accountNames!.get(transaction.toAccountId ?? '') ?? '',
        ]
          .join('\n')
          .toLocaleLowerCase()
          .includes(needle)
      )
        return false;
      return true;
    })
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.time?.padEnd(8, ':00') ?? '').localeCompare(a.time?.padEnd(8, ':00') ?? '') ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

export function transactionTotals(transactions: Transaction[]) {
  let incomeCents = 0;
  let expenseCents = 0;
  let transferCents = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  let transferCount = 0;
  for (const transaction of transactions) {
    if (transaction.direction === 'income') {
      incomeCents = addCents(incomeCents, transaction.amountCents);
      incomeCount++;
    } else if (transaction.direction === 'expense') {
      expenseCents = addCents(expenseCents, transaction.amountCents);
      expenseCount++;
    } else {
      transferCents = addCents(transferCents, transaction.amountCents);
      transferCount++;
    }
  }
  return {
    incomeCents,
    expenseCents,
    transferCents,
    incomeCount,
    expenseCount,
    transferCount,
    balanceCents: addCents(incomeCents, -expenseCents),
  };
}

export function accountBalance(
  state: LedgerState,
  accountId: string,
  throughDate?: string,
): number {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) throw new LedgerError('账户不存在', 'NOT_FOUND');
  let balance = account.openingBalanceCents;
  for (const transaction of state.transactions) {
    if (throughDate && transaction.date > throughDate) continue;
    if (transaction.accountId === accountId)
      balance = addCents(
        balance,
        transaction.amountCents * (transaction.direction === 'income' ? 1 : -1),
      );
    if (transaction.direction === 'transfer' && transaction.toAccountId === accountId)
      balance = addCents(balance, transaction.amountCents);
  }
  return balance;
}

export interface CategoryTotal {
  categoryId: string;
  primaryName: string;
  secondaryName: string | null;
  label: string;
  amountCents: number;
  count: number;
}

export function categoryTotals(
  state: LedgerState,
  filter: TransactionFilter & { direction: Direction },
  level: 'primary' | 'secondary' = 'secondary',
): CategoryTotal[] {
  const totals = new Map<string, CategoryTotal>();
  const categoryMap = new Map(state.categories.map((category) => [category.id, category]));
  for (const transaction of filterTransactions(state, filter)) {
    if (!transaction.categoryId) continue;
    const category = categoryMap.get(transaction.categoryId);
    const parent = category?.parentId ? categoryMap.get(category.parentId) : undefined;
    if (!category || !parent) throw new LedgerError('流水分类关系无效', 'INVALID_STATE');
    const id = level === 'primary' ? parent.id : category.id;
    const previous = totals.get(id) ?? {
      categoryId: id,
      primaryName: parent.name,
      secondaryName: level === 'primary' ? null : category.name,
      label: level === 'primary' ? parent.name : `${parent.name} / ${category.name}`,
      amountCents: 0,
      count: 0,
    };
    previous.amountCents = addCents(previous.amountCents, transaction.amountCents);
    previous.count++;
    totals.set(id, previous);
  }
  return [...totals.values()].sort(
    (a, b) => b.amountCents - a.amountCents || a.label.localeCompare(b.label, 'zh-CN'),
  );
}

export function bookBalance(state: LedgerState, bookId: string, throughDate?: string): number {
  let balance = state.accounts
    .filter((account) => account.bookId === bookId)
    .reduce((sum, account) => addCents(sum, account.openingBalanceCents), 0);
  for (const transaction of state.transactions) {
    if (
      transaction.bookId !== bookId ||
      transaction.direction === 'transfer' ||
      (throughDate && transaction.date > throughDate)
    )
      continue;
    balance = addCents(
      balance,
      transaction.amountCents * (transaction.direction === 'income' ? 1 : -1),
    );
  }
  return balance;
}

export function budgetProgress(state: LedgerState, budgetId: string) {
  const budget = state.budgets.find((item) => item.id === budgetId);
  if (!budget) throw new LedgerError('预算不存在', 'NOT_FOUND');
  const spentCents = transactionTotals(
    filterTransactions(state, {
      bookId: budget.bookId,
      month: budget.month,
      direction: 'expense',
      ...(budget.categoryId ? { categoryId: budget.categoryId } : {}),
    }),
  ).expenseCents;
  return {
    budget,
    spentCents,
    remainingCents: addCents(budget.amountCents, -spentCents),
    ratio: spentCents / budget.amountCents,
  };
}

export function previewCategoryMerge(state: LedgerState, sourceId: string, targetId: string) {
  const source = state.categories.find((item) => item.id === sourceId);
  const target = state.categories.find((item) => item.id === targetId);
  if (!source || !target) throw new LedgerError('要合并的分类不存在', 'NOT_FOUND');
  if (
    source.id === target.id ||
    source.bookId !== target.bookId ||
    source.direction !== target.direction ||
    (source.parentId === null) !== (target.parentId === null)
  )
    throw new LedgerError('只能合并同账本、同收支类型、同层级的不同分类', 'INVALID_MERGE');
  const sourceLeaves =
    source.parentId === null
      ? state.categories.filter((item) => item.parentId === source.id)
      : [source];
  const leafIds = new Set(sourceLeaves.map((item) => item.id));
  const transactions = state.transactions.filter(
    (item) => item.categoryId !== null && leafIds.has(item.categoryId),
  );
  const totals = transactionTotals(transactions);
  return {
    sourceId,
    targetId,
    sourceLabel: categoryPath(state, sourceId).label,
    targetLabel: categoryPath(state, targetId).label,
    affectedTransactions: transactions.length,
    amountCents: addCents(totals.incomeCents, totals.expenseCents),
    affectedTemplates: state.templates.filter((item) => leafIds.has(item.categoryId)).length,
    affectedBudgets: state.budgets.filter(
      (item) =>
        item.categoryId === source.id || (item.categoryId !== null && leafIds.has(item.categoryId)),
    ).length,
    sourceLeafIds: [...leafIds],
    mergingChildPairs:
      source.parentId === null
        ? sourceLeaves.flatMap((child) => {
            const matching = state.categories.find(
              (item) => item.parentId === target.id && item.name === child.name,
            );
            return matching
              ? [{ sourceId: child.id, targetId: matching.id, name: child.name }]
              : [];
          })
        : [],
  };
}
