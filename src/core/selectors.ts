import {
  type Account,
  type Category,
  type Direction,
  type LedgerState,
  type Transaction,
  type LoanType,
  type LoanPerson,
  type Member,
  LedgerError,
} from './model';
import { addCents } from './money';
import { budgetProgressForRecord } from './budgets';

export interface TransactionFilter {
  bookId?: string;
  month?: string;
  fromDate?: string;
  toDate?: string;
  accountId?: string;
  categoryId?: string;
  direction?: Transaction['direction'];
  memberId?: string;
  personId?: string;
  loanType?: LoanType;
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

export function activeMembers(state: LedgerState, bookId: string): Member[] {
  return state.members
    .filter((item) => item.bookId === bookId && !item.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'));
}

export function activeLoanPeople(state: LedgerState, bookId: string): LoanPerson[] {
  return state.loanPeople
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
  const memberNames = needle ? new Map(state.members.map((item) => [item.id, item.name])) : null;
  const personNames = needle ? new Map(state.loanPeople.map((item) => [item.id, item.name])) : null;
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
      if (filter.memberId && transaction.memberId !== filter.memberId) return false;
      if (filter.personId && transaction.personId !== filter.personId) return false;
      if (filter.loanType && transaction.loanType !== filter.loanType) return false;
      if (categoryIds && (!transaction.categoryId || !categoryIds.has(transaction.categoryId)))
        return false;
      if (
        needle &&
        ![
          transaction.note,
          categoryNames!.get(transaction.categoryId ?? '') ?? '',
          accountNames!.get(transaction.accountId) ?? '',
          accountNames!.get(transaction.toAccountId ?? '') ?? '',
          memberNames!.get(transaction.memberId ?? '') ?? '',
          personNames!.get(transaction.personId ?? '') ?? '',
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
  let loanCount = 0;
  let loanInCents = 0;
  let loanOutCents = 0;
  for (const transaction of transactions) {
    if (transaction.direction === 'income') {
      incomeCents = addCents(incomeCents, transaction.amountCents);
      incomeCount++;
    } else if (transaction.direction === 'expense') {
      expenseCents = addCents(expenseCents, transaction.amountCents);
      expenseCount++;
    } else if (transaction.direction === 'transfer') {
      transferCents = addCents(transferCents, transaction.amountCents);
      transferCount++;
    } else {
      const delta = accountDelta(transaction);
      if (delta > 0) loanInCents = addCents(loanInCents, delta);
      else loanOutCents = addCents(loanOutCents, -delta);
      loanCount++;
    }
  }
  return {
    incomeCents,
    expenseCents,
    transferCents,
    incomeCount,
    expenseCount,
    transferCount,
    loanCount,
    loanInCents,
    loanOutCents,
    balanceCents: addCents(incomeCents, -expenseCents),
  };
}

/** Cash movement; loan flows remain distinct from ordinary income and expense. */
function accountDelta(transaction: Transaction): number {
  if (transaction.direction === 'income') return transaction.amountCents;
  if (transaction.direction === 'expense' || transaction.direction === 'transfer')
    return -transaction.amountCents;
  if (transaction.loanType === 'borrow' || transaction.loanType === 'collect')
    return transaction.amountCents;
  if (transaction.loanType === 'lend' || transaction.loanType === 'repay')
    return -transaction.amountCents;
  throw new LedgerError('借贷流水类型无效', 'INVALID_STATE');
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
    if (transaction.accountId === accountId) balance = addCents(balance, accountDelta(transaction));
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
    balance = addCents(balance, accountDelta(transaction));
  }
  return balance;
}

export interface LoanTotals {
  borrowedCents: number;
  lentCents: number;
  repaidCents: number;
  collectedCents: number;
  receivableCents: number;
  payableCents: number;
  netCents: number;
  cashInCents: number;
  cashOutCents: number;
  count: number;
}

export interface LoanPersonTotal extends LoanTotals {
  personId: string;
  bookId: string;
  name: string;
  archived: boolean;
  person: LoanPerson;
}

function emptyLoanTotals(): LoanTotals {
  return {
    borrowedCents: 0,
    lentCents: 0,
    repaidCents: 0,
    collectedCents: 0,
    receivableCents: 0,
    payableCents: 0,
    netCents: 0,
    cashInCents: 0,
    cashOutCents: 0,
    count: 0,
  };
}

function accumulateLoan(total: LoanTotals, transaction: Transaction) {
  if (transaction.direction !== 'loan') return;
  if (transaction.loanType === 'borrow')
    total.borrowedCents = addCents(total.borrowedCents, transaction.amountCents);
  else if (transaction.loanType === 'lend')
    total.lentCents = addCents(total.lentCents, transaction.amountCents);
  else if (transaction.loanType === 'repay')
    total.repaidCents = addCents(total.repaidCents, transaction.amountCents);
  else if (transaction.loanType === 'collect')
    total.collectedCents = addCents(total.collectedCents, transaction.amountCents);
  else throw new LedgerError('借贷流水类型无效', 'INVALID_STATE');
  total.count++;
}

function finishLoans<T extends LoanTotals>(totals: T): T {
  totals.receivableCents = addCents(totals.lentCents, -totals.collectedCents);
  totals.payableCents = addCents(totals.borrowedCents, -totals.repaidCents);
  totals.netCents = addCents(totals.receivableCents, -totals.payableCents);
  totals.cashInCents = addCents(totals.borrowedCents, totals.collectedCents);
  totals.cashOutCents = addCents(totals.lentCents, totals.repaidCents);
  return totals;
}

/** Signed balances are not clamped: partial-period imports may omit earlier obligations. */
export function loanTotals(state: LedgerState, filter: TransactionFilter = {}): LoanTotals {
  const total = emptyLoanTotals();
  for (const transaction of filterTransactions(state, { ...filter, direction: 'loan' }))
    accumulateLoan(total, transaction);
  return finishLoans(total);
}

export function loanPeopleTotals(
  state: LedgerState,
  filter: TransactionFilter = {},
): LoanPersonTotal[] {
  const totals = new Map(
    state.loanPeople
      .filter(
        (person) =>
          (!filter.bookId || person.bookId === filter.bookId) &&
          (!filter.personId || person.id === filter.personId),
      )
      .map((person) => [
        person.id,
        {
          ...emptyLoanTotals(),
          personId: person.id,
          bookId: person.bookId,
          name: person.name,
          archived: person.archived,
          person,
        } as LoanPersonTotal,
      ]),
  );
  for (const transaction of filterTransactions(state, { ...filter, direction: 'loan' })) {
    const total = totals.get(transaction.personId ?? '');
    if (!total) throw new LedgerError('借贷联系人不存在', 'INVALID_STATE');
    accumulateLoan(total, transaction);
  }
  return [...totals.values()]
    .map(finishLoans)
    .sort(
      (a, b) => a.person.sortOrder - b.person.sortOrder || a.name.localeCompare(b.name, 'zh-CN'),
    );
}

export function budgetProgress(state: LedgerState, budgetId: string, date?: string) {
  return budgetProgressForRecord(state, budgetId, date);
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
