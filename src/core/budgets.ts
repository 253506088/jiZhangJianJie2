import { LedgerError, localDate, type Budget, type BudgetPeriod, type LedgerState } from './model';
import { addCents } from './money';
import {
  budgetAppliesToDate,
  budgetPeriod,
  budgetScopeKey,
  budgetWindow,
  periodRange,
  type BudgetDateRange,
} from './budget-periods';

export interface EffectiveBudgetAllocation {
  limitCents: number | null;
  mode: 'none' | 'overall' | 'categories';
  contributingBudgetIds: string[];
  ignoredBudgetIds: string[];
  /** null means all expense categories, otherwise the selected non-overlapping category scopes. */
  categoryIds: string[] | null;
  coveredLeafIds: string[] | null;
}

/** Caller supplies one effective interval. General limits win; parents cover children and duplicate categories use maxima. */
export function effectiveBudgetAllocation(
  state: LedgerState,
  budgets: Budget[],
): EffectiveBudgetAllocation {
  if (!budgets.length)
    return {
      limitCents: null,
      mode: 'none',
      contributingBudgetIds: [],
      ignoredBudgetIds: [],
      categoryIds: [],
      coveredLeafIds: [],
    };
  const first = budgets[0];
  if (
    budgets.some(
      (budget) => budget.bookId !== first.bookId || budgetPeriod(budget) !== budgetPeriod(first),
    )
  )
    throw new LedgerError('只能汇总同账本同周期的预算');
  const fixedScopes = new Set(budgets.filter((budget) => !budget.recurring).map(budgetScopeKey));
  if (fixedScopes.size > 1) throw new LedgerError('请先筛选同一个固定周期范围的预算');
  const overall = budgets.filter((budget) => budget.categoryId === null);
  if (overall.length) {
    const limitCents = overall.reduce(
      (maximum, budget) => Math.max(maximum, budget.amountCents),
      0,
    );
    const contributing = overall
      .filter((budget) => budget.amountCents === limitCents)
      .map((budget) => budget.id);
    const contributingSet = new Set(contributing);
    return {
      limitCents,
      mode: 'overall',
      contributingBudgetIds: contributing,
      ignoredBudgetIds: budgets
        .filter((budget) => !contributingSet.has(budget.id))
        .map((budget) => budget.id),
      categoryIds: null,
      coveredLeafIds: null,
    };
  }
  const categories = new Map(state.categories.map((category) => [category.id, category]));
  const byCategory = new Map<string, Budget>();
  for (const budget of budgets) {
    const category = categories.get(budget.categoryId!);
    if (!category || category.bookId !== budget.bookId || category.direction !== 'expense')
      throw new LedgerError('预算分类关系无效');
    const previous = byCategory.get(category.id);
    if (!previous || budget.amountCents > previous.amountCents) byCategory.set(category.id, budget);
  }
  const selected = [...byCategory.values()].filter((budget) => {
    const parentId = categories.get(budget.categoryId!)!.parentId;
    return parentId === null || !byCategory.has(parentId);
  });
  const categoryIds = selected.map((budget) => budget.categoryId!);
  const selectedScopes = new Set(categoryIds);
  const coveredLeafIds = state.categories
    .filter(
      (category) =>
        category.parentId !== null &&
        (selectedScopes.has(category.id) || selectedScopes.has(category.parentId)),
    )
    .map((category) => category.id);
  const contributing = new Set(selected.map((budget) => budget.id));
  return {
    limitCents: selected.reduce((sum, budget) => addCents(sum, budget.amountCents), 0),
    mode: 'categories',
    contributingBudgetIds: [...contributing],
    ignoredBudgetIds: budgets
      .filter((budget) => !contributing.has(budget.id))
      .map((budget) => budget.id),
    categoryIds,
    coveredLeafIds,
  };
}

export function effectiveBudgetLimit(state: LedgerState, budgets: Budget[]): number | null {
  return effectiveBudgetAllocation(state, budgets).limitCents;
}

function periodSpending(
  state: LedgerState,
  bookId: string,
  range: BudgetDateRange,
  coveredLeafIds: string[] | null,
) {
  const covered = coveredLeafIds === null ? null : new Set(coveredLeafIds);
  let incomeCents = 0;
  let expenseCents = 0;
  let coveredSpentCents = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  for (const transaction of state.transactions) {
    if (
      transaction.bookId !== bookId ||
      transaction.date < range.fromDate ||
      transaction.date > range.toDate
    )
      continue;
    if (transaction.direction === 'income') {
      incomeCents = addCents(incomeCents, transaction.amountCents);
      incomeCount++;
    }
    if (transaction.direction === 'expense') {
      expenseCents = addCents(expenseCents, transaction.amountCents);
      expenseCount++;
      if (
        covered === null ||
        (transaction.categoryId !== null && covered.has(transaction.categoryId))
      )
        coveredSpentCents = addCents(coveredSpentCents, transaction.amountCents);
    }
  }
  return { incomeCents, expenseCents, coveredSpentCents, incomeCount, expenseCount };
}

export interface PeriodBudgetProgress {
  period: BudgetPeriod;
  range: BudgetDateRange;
  limitCents: number | null;
  remainingCents: number | null;
  /** Original home cards show zero when no budget is configured; hasBudget retains that distinction. */
  displayRemainingCents: number;
  spentCents: number;
  periodExpenseCents: number;
  coveredSpentCents: number;
  incomeCents: number;
  incomeCount: number;
  expenseCount: number;
  hasBudget: boolean;
  ratio: number | null;
  budgets: Budget[];
  effective: EffectiveBudgetAllocation;
}

export function periodBudgetProgress(
  state: LedgerState,
  bookId: string,
  date: string,
  period: BudgetPeriod,
  weekStartsOn: 0 | 1 = state.settings.weekStartsOn ?? 1,
): PeriodBudgetProgress {
  if (!state.books.some((book) => book.id === bookId)) throw new LedgerError('账本不存在');
  const range = periodRange(date, period, weekStartsOn);
  const budgets = state.budgets.filter(
    (budget) =>
      budget.bookId === bookId &&
      budgetPeriod(budget) === period &&
      budgetAppliesToDate(budget, date, weekStartsOn),
  );
  const effective = effectiveBudgetAllocation(state, budgets);
  const spending = periodSpending(state, bookId, range, effective.coveredLeafIds);
  const remainingCents =
    effective.limitCents === null ? null : addCents(effective.limitCents, -spending.coveredSpentCents);
  return {
    period,
    range,
    ...spending,
    spentCents: spending.coveredSpentCents,
    periodExpenseCents: spending.expenseCents,
    limitCents: effective.limitCents,
    remainingCents,
    displayRemainingCents: remainingCents ?? 0,
    hasBudget: effective.limitCents !== null,
    ratio: effective.limitCents === null ? null : spending.coveredSpentCents / effective.limitCents,
    budgets,
    effective,
  };
}

/** Individual category budget progress deducts only its own subtree; legacy fixed month behaviour is retained. */
export function budgetProgressForRecord(state: LedgerState, budgetId: string, date = localDate()) {
  const budget = state.budgets.find((item) => item.id === budgetId);
  if (!budget) throw new LedgerError('预算不存在', 'NOT_FOUND');
  const range = budgetWindow(budget, date, state.settings.weekStartsOn ?? 1);
  let coveredLeafIds: string[] | null = null;
  if (budget.categoryId !== null) {
    const category = state.categories.find((item) => item.id === budget.categoryId);
    if (!category) throw new LedgerError('预算分类不存在');
    coveredLeafIds =
      category.parentId === null
        ? state.categories.filter((item) => item.parentId === category.id).map((item) => item.id)
        : [category.id];
  }
  const spending = periodSpending(state, budget.bookId, range, coveredLeafIds);
  return {
    budget,
    period: budgetPeriod(budget),
    range,
    recurring: budget.recurring === true,
    spentCents: spending.coveredSpentCents,
    remainingCents: addCents(budget.amountCents, -spending.coveredSpentCents),
    ratio: spending.coveredSpentCents / budget.amountCents,
  };
}
