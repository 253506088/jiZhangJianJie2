import { describe, expect, it } from 'vitest';
import {
  budgetPeriod,
  budgetProgress,
  budgetScopeKey,
  budgetWindow,
  createBook,
  createCategoryPath,
  createEmptyState,
  effectiveBudgetAllocation,
  effectiveBudgetLimit,
  ensureLoanPersonDraft,
  mergeCategories,
  periodBudgetProgress,
  periodRange,
  removeBudget,
  setBudget,
  setPeriodBudget,
  setRecurringBudget,
  updateSettings,
  upsertAccount,
  upsertTransaction,
  validateState,
  withLedgerDraft,
  type BudgetPeriod,
  type LedgerState,
} from './index';
import { decodeBackup, encodeBackup } from '../backup/codec';
import { legacyV1Fixture } from './testing/v1-fixture';
import { migrateState } from './migrations';

const DAY = '2026-11-07';
function setup() {
  let id = 0;
  const context = {
    idFactory: () => `budget-fictional-${++id}`,
    now: () => `${DAY}T04:00:00.000Z`,
  };
  let state = createEmptyState(context);
  const bookId = state.books[0].id;
  const accountId = state.accounts[0].id;
  const food = createCategoryPath(
    state,
    { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '早餐' },
    context,
  );
  state = food.state;
  const transport = createCategoryPath(
    state,
    { bookId, direction: 'expense', primaryName: '交通', secondaryName: '地铁' },
    context,
  );
  state = transport.state;
  const foodParent = state.categories.find(
    (category) => category.id === food.categoryId,
  )!.parentId!;
  return {
    state,
    context,
    bookId,
    accountId,
    foodId: food.categoryId,
    transportId: transport.categoryId,
    foodParent,
  };
}

function expense(
  state: LedgerState,
  categoryId: string,
  amountCents: number,
  date: string,
  context: ReturnType<typeof setup>['context'],
) {
  const category = state.categories.find((item) => item.id === categoryId)!;
  return upsertTransaction(
    state,
    {
      bookId: category.bookId,
      accountId: state.accounts.find((item) => item.bookId === category.bookId)!.id,
      direction: 'expense',
      categoryId,
      amountCents,
      date,
      note: '完全虚构的预算测试支出',
    },
    context,
  );
}

function balances(state: LedgerState, bookId: string, date = DAY) {
  return (['day', 'week', 'month'] as BudgetPeriod[]).map(
    (period) => periodBudgetProgress(state, bookId, date, period).displayRemainingCents,
  );
}

describe('独立日周月预算与已观察的原版数字', () => {
  it('月3000不自动均摊日周，依次添加日100和周700得到0/0/2980、80/0/2980、80/680/2980', () => {
    const { state: start, context, bookId, foodId } = setup();
    let state = expense(expense(start, foodId, 1000, DAY, context), foodId, 1000, DAY, context);
    expect(balances(state, bookId)).toEqual([0, 0, 0]);
    expect(periodBudgetProgress(state, bookId, DAY, 'day')).toMatchObject({
      hasBudget: false,
      limitCents: null,
      remainingCents: null,
      spentCents: 0,
      periodExpenseCents: 2000,
    });
    state = setRecurringBudget(
      state,
      { bookId, period: 'month', categoryId: null, amountCents: 300000, anchorDate: DAY },
      context,
    );
    expect(balances(state, bookId)).toEqual([0, 0, 298000]);
    const monthBudget = structuredClone(state.budgets[0]);
    state = setPeriodBudget(
      state,
      { bookId, period: 'day', categoryId: null, amountCents: 10000, anchorDate: DAY },
      context,
    );
    expect(balances(state, bookId)).toEqual([8000, 0, 298000]);
    state = setPeriodBudget(
      state,
      { bookId, period: 'week', categoryId: null, amountCents: 70000, anchorDate: DAY },
      context,
    );
    expect(balances(state, bookId)).toEqual([8000, 68000, 298000]);
    expect(state.budgets.find((budget) => budget.id === monthBudget.id)).toEqual(monthBudget);
    expect(new Set(state.budgets.map((budget) => budget.id)).size).toBe(3);
  });

  it('三个周期分别编辑和删除，其他周期数值与ID不变', () => {
    const { state: start, context, bookId, foodId } = setup();
    let state = expense(start, foodId, 2000, DAY, context);
    for (const [period, amountCents] of [
      ['day', 10000],
      ['week', 70000],
      ['month', 300000],
    ] as [BudgetPeriod, number][])
      state = setPeriodBudget(
        state,
        { bookId, period, categoryId: null, amountCents, anchorDate: DAY },
        context,
      );
    const weekly = state.budgets.find((budget) => budget.period === 'week')!;
    const monthly = structuredClone(state.budgets.find((budget) => budget.period === 'month')!);
    state = setPeriodBudget(
      state,
      { id: weekly.id, bookId, period: 'week', categoryId: null, amountCents: 80000 },
      context,
    );
    expect(balances(state, bookId)).toEqual([8000, 78000, 298000]);
    expect(state.budgets.find((budget) => budget.id === monthly.id)).toEqual(monthly);
    state = removeBudget(state, weekly.id);
    expect(balances(state, bookId)).toEqual([8000, 0, 298000]);
  });

  it('旧setBudget仍只更新固定月份，不会碰到同月创建的日周模板', () => {
    const { state: start, context, bookId, foodId } = setup();
    let state = expense(start, foodId, 2000, DAY, context);
    state = setBudget(
      state,
      { bookId, month: '2026-11', categoryId: null, amountCents: 300000 },
      context,
    );
    const fixedId = state.budgets[0].id;
    state = setPeriodBudget(
      state,
      { bookId, period: 'day', categoryId: null, amountCents: 10000, anchorDate: DAY },
      context,
    );
    state = setPeriodBudget(
      state,
      { bookId, period: 'week', categoryId: null, amountCents: 70000, anchorDate: DAY },
      context,
    );
    const repeating = structuredClone(state.budgets.filter((budget) => budget.recurring));
    state = setBudget(
      state,
      { bookId, month: '2026-11', categoryId: null, amountCents: 200000 },
      context,
    );
    expect(state.budgets).toHaveLength(3);
    expect(state.budgets.filter((budget) => budget.recurring)).toEqual(repeating);
    expect(state.budgets.find((budget) => budget.id === fixedId)).not.toHaveProperty('period');
    expect(balances(state, bookId)).toEqual([8000, 68000, 198000]);
    expect(balances(state, bookId, '2026-12-01')).toEqual([10000, 70000, 0]);
    expect(budgetProgress(state, fixedId, '2030-01-01').spentCents).toBe(2000);
  });
});

describe('日历窗口与循环模板', () => {
  it('周一默认、周日可显式选择；月跨年和闰日不会用固定30天近似', () => {
    expect(periodRange('2026-11-08', 'week')).toEqual({
      fromDate: '2026-11-02',
      toDate: '2026-11-08',
    });
    expect(periodRange('2026-11-08', 'week', 0)).toEqual({
      fromDate: '2026-11-08',
      toDate: '2026-11-14',
    });
    expect(periodRange('2024-02-29', 'month')).toEqual({
      fromDate: '2024-02-01',
      toDate: '2024-02-29',
    });
    expect(periodRange('2026-12-31', 'month')).toEqual({
      fromDate: '2026-12-01',
      toDate: '2026-12-31',
    });
    expect(periodRange('2026-11-07', 'day')).toEqual({ fromDate: DAY, toDate: DAY });
    expect(() => periodRange('2026-02-30', 'month')).toThrow();
  });

  it('跨月的同一周共享一个周额度，日/月分别使用各自记录范围', () => {
    const { state: start, context, bookId, foodId } = setup();
    let state = start;
    for (const [date, cents] of [
      ['2026-11-29', 700],
      ['2026-11-30', 1100],
      ['2026-12-01', 1300],
      ['2026-12-07', 1700],
    ] as [string, number][])
      state = expense(state, foodId, cents, date, context);
    for (const [period, amountCents] of [
      ['day', 10000],
      ['week', 70000],
      ['month', 300000],
    ] as [BudgetPeriod, number][])
      state = setPeriodBudget(
        state,
        { bookId, period, categoryId: null, amountCents, anchorDate: DAY },
        context,
      );
    expect(balances(state, bookId, '2026-11-30')).toEqual([8900, 67600, 298200]);
    expect(balances(state, bookId, '2026-12-01')).toEqual([8700, 67600, 297000]);
    expect(periodBudgetProgress(state, bookId, '2026-12-07', 'week').remainingCents).toBe(68300);
    expect(periodBudgetProgress(state, bookId, '2027-01-01', 'month').remainingCents).toBe(300000);
  });

  it('周起始可单次或设置覆盖，不修改预算记录本身', () => {
    const { state: start, context, bookId, foodId } = setup();
    let state = expense(start, foodId, 500, '2026-11-08', context);
    state = setPeriodBudget(
      state,
      { bookId, period: 'week', categoryId: null, amountCents: 70000, anchorDate: DAY },
      context,
    );
    const budgets = structuredClone(state.budgets);
    expect(periodBudgetProgress(state, bookId, '2026-11-09', 'week').remainingCents).toBe(70000);
    expect(periodBudgetProgress(state, bookId, '2026-11-09', 'week', 0).remainingCents).toBe(69500);
    state = updateSettings(state, { weekStartsOn: 0 });
    expect(periodBudgetProgress(state, bookId, '2026-11-09', 'week').remainingCents).toBe(69500);
    expect(state.budgets).toEqual(budgets);
  });

  it('显式固定日/周只属于记录的窗口，和循环预算分开识别', () => {
    const { state: start, context, bookId } = setup();
    let state = setPeriodBudget(
      start,
      {
        bookId,
        period: 'day',
        categoryId: null,
        amountCents: 5000,
        recurring: false,
        anchorDate: DAY,
      },
      context,
    );
    state = setPeriodBudget(
      state,
      {
        bookId,
        period: 'week',
        categoryId: null,
        amountCents: 8000,
        recurring: false,
        anchorDate: DAY,
      },
      context,
    );
    const weekly = state.budgets.find((budget) => budget.period === 'week')!;
    expect(weekly.anchorDate).toBe('2026-11-02');
    expect(budgetWindow(weekly, '2030-01-01')).toEqual({
      fromDate: '2026-11-02',
      toDate: '2026-11-08',
    });
    expect(periodBudgetProgress(state, bookId, '2026-11-08', 'day').hasBudget).toBe(false);
    expect(periodBudgetProgress(state, bookId, '2026-11-08', 'week').limitCents).toBe(8000);
    expect(periodBudgetProgress(state, bookId, '2026-11-09', 'week').hasBudget).toBe(false);
    state = setPeriodBudget(
      state,
      { bookId, period: 'week', categoryId: null, amountCents: 9000, anchorDate: DAY },
      context,
    );
    expect(new Set(state.budgets.map(budgetScopeKey)).size).toBe(3);
  });
});

describe('有效额度、分类范围和合并安全', () => {
  it('总体预算最大值优先；无总体时父类覆盖子类，同类别重复取最大，其他分支相加', () => {
    const { state: start, context, bookId, foodId, foodParent, transportId } = setup();
    let state = start;
    for (const [categoryId, amountCents] of [
      [foodParent, 10000],
      [foodId, 6000],
      [foodParent, 9000],
      [transportId, 5000],
    ] as [string, number][])
      state = setPeriodBudget(
        state,
        { bookId, period: 'month', categoryId, amountCents, anchorDate: DAY },
        context,
      );
    expect(effectiveBudgetLimit(state, state.budgets)).toBe(15000);
    expect(effectiveBudgetAllocation(state, state.budgets)).toMatchObject({
      mode: 'categories',
      categoryIds: [foodParent, transportId],
    });
    expect(effectiveBudgetAllocation(state, state.budgets).ignoredBudgetIds).toHaveLength(2);
    for (const amountCents of [13000, 14000, 11000])
      state = setPeriodBudget(
        state,
        { bookId, period: 'month', categoryId: null, amountCents, anchorDate: DAY },
        context,
      );
    expect(effectiveBudgetLimit(state, state.budgets)).toBe(14000);
    expect(state.budgets.filter((budget) => budget.categoryId === null)).toHaveLength(3);
    expect(effectiveBudgetAllocation(state, state.budgets).mode).toBe('overall');
  });

  it('按原包实测仅扣预算覆盖类别，未设预算类别及借贷转账不影响分类预算余额', () => {
    const { state: start, context, bookId, accountId, foodId, transportId } = setup();
    let state = expense(start, foodId, 2100, DAY, context);
    state = setPeriodBudget(
      state,
      { bookId, period: 'day', categoryId: transportId, amountCents: 5000, anchorDate: DAY },
      context,
    );
    const transportBudget = state.budgets[0].id;
    const bank = upsertAccount(state, { bookId, name: '虚构储蓄' }, context);
    state = bank.state;
    let personId = '';
    state = withLedgerDraft(state, (draft) => {
      personId = ensureLoanPersonDraft(draft, bookId, '虚构借贷人', context).id;
    });
    state = upsertTransaction(
      state,
      {
        bookId,
        accountId,
        direction: 'loan',
        loanType: 'borrow',
        personId,
        amountCents: 7100,
        date: DAY,
      },
      context,
    );
    state = upsertTransaction(
      state,
      {
        bookId,
        accountId,
        toAccountId: bank.accountId,
        direction: 'transfer',
        amountCents: 2000,
        date: DAY,
      },
      context,
    );
    expect(periodBudgetProgress(state, bookId, DAY, 'day')).toMatchObject({
      limitCents: 5000,
      remainingCents: 5000,
      spentCents: 0,
      periodExpenseCents: 2100,
      coveredSpentCents: 0,
    });
    expect(budgetProgress(state, transportBudget, DAY)).toMatchObject({
      spentCents: 0,
      remainingCents: 5000,
    });
    state = expense(state, transportId, 1000, DAY, context);
    expect(budgetProgress(state, transportBudget, DAY)).toMatchObject({
      spentCents: 1000,
      remainingCents: 4000,
    });
  });

  it('分类合并不混合日/周/月或固定月份，且保留无关的重复总体预算', () => {
    const { state: start, context, bookId, foodId } = setup();
    const target = createCategoryPath(
      start,
      { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '早饭' },
      context,
    );
    let state = target.state;
    for (const [period, source, destination] of [
      ['day', 1000, 2000],
      ['week', 5000, 7000],
      ['month', 20000, 30000],
    ] as [BudgetPeriod, number, number][]) {
      state = setPeriodBudget(
        state,
        { bookId, period, categoryId: foodId, amountCents: source, anchorDate: DAY },
        context,
      );
      state = setPeriodBudget(
        state,
        {
          bookId,
          period,
          categoryId: target.categoryId,
          amountCents: destination,
          anchorDate: '2026-11-08',
        },
        context,
      );
    }
    state = setPeriodBudget(
      state,
      { bookId, period: 'day', categoryId: foodId, amountCents: 500, anchorDate: DAY },
      context,
    );
    state = setPeriodBudget(
      state,
      { bookId, period: 'day', categoryId: target.categoryId, amountCents: 1500, anchorDate: DAY },
      context,
    );
    for (const [month, a, b] of [
      ['2026-11', 11000, 17000],
      ['2026-12', 600, 700],
    ] as [string, number, number][]) {
      state = setBudget(state, { bookId, month, categoryId: foodId, amountCents: a }, context);
      state = setBudget(
        state,
        { bookId, month, categoryId: target.categoryId, amountCents: b },
        context,
      );
    }
    state = setPeriodBudget(
      state,
      { bookId, period: 'day', categoryId: null, amountCents: 8000, anchorDate: DAY },
      context,
    );
    state = setPeriodBudget(
      state,
      { bookId, period: 'day', categoryId: null, amountCents: 9000, anchorDate: DAY },
      context,
    );
    const overall = structuredClone(state.budgets.filter((budget) => budget.categoryId === null));
    const before = structuredClone(state);
    const result = mergeCategories(state, foodId, target.categoryId);
    expect(state).toEqual(before);
    expect(result.budgets.filter((budget) => budget.categoryId === null)).toEqual(overall);
    for (const [period, amountCents] of [
      ['day', 3000],
      ['week', 12000],
      ['month', 50000],
    ] as [BudgetPeriod, number][]) {
      const budgets = result.budgets.filter(
        (budget) =>
          budget.categoryId === target.categoryId &&
          budget.recurring &&
          budgetPeriod(budget) === period,
      );
      expect(budgets).toHaveLength(1);
      expect(budgets[0].amountCents).toBe(amountCents);
    }
    expect(
      result.budgets.find((budget) => !budget.recurring && budget.month === '2026-11')?.amountCents,
    ).toBe(28000);
    expect(
      result.budgets.find((budget) => !budget.recurring && budget.month === '2026-12')?.amountCents,
    ).toBe(1300);
    expect(result.budgets).toHaveLength(7);
    expect(() => validateState(result)).not.toThrow();
  });

  it('账本之间不混算，非法周期与重复固定范围不能污染现有数据', () => {
    const { state: start, context, bookId } = setup();
    let state = setPeriodBudget(
      start,
      { bookId, period: 'day', categoryId: null, amountCents: 10000, anchorDate: DAY },
      context,
    );
    const second = createBook(state, '虚构第二本', context);
    state = second.state;
    state = setPeriodBudget(
      state,
      {
        bookId: second.bookId,
        period: 'day',
        categoryId: null,
        amountCents: 90000,
        anchorDate: DAY,
      },
      context,
    );
    expect(periodBudgetProgress(state, bookId, DAY, 'day').limitCents).toBe(10000);
    expect(() => effectiveBudgetLimit(state, state.budgets)).toThrow();
    const fixed = setBudget(
      state,
      { bookId, month: '2026-11', categoryId: null, amountCents: 30000 },
      context,
    );
    const anotherMonth = setBudget(
      fixed,
      { bookId, month: '2026-12', categoryId: null, amountCents: 50000 },
      context,
    );
    expect(() =>
      effectiveBudgetLimit(
        anotherMonth,
        anotherMonth.budgets.filter((budget) => !budget.recurring),
      ),
    ).toThrow();
    expect(() =>
      withLedgerDraft(fixed, (draft) => {
        const record = draft.budgets.find((budget) => !budget.recurring)!;
        draft.budgets.push({ ...record, id: 'duplicate-fixed' });
      }),
    ).toThrow();
    expect(() =>
      setBudget(
        fixed,
        {
          bookId,
          month: '2026-11',
          period: 'day',
          recurring: true,
          categoryId: null,
          amountCents: 10000,
        },
        context,
      ),
    ).toThrow();
    expect(() => updateSettings(fixed, { weekStartsOn: 2 as 1 })).toThrow();
  });

  it('旧固定月迁移保持原记录；包含循环预算的v2完整备份往返不丢周期', async () => {
    const legacy = legacyV1Fixture();
    let state = migrateState(legacy);
    expect(state.budgets).toEqual(legacy.budgets);
    const before = structuredClone(state.budgets);
    state = setPeriodBudget(state, {
      bookId: state.books[0].id,
      period: 'day',
      categoryId: null,
      amountCents: 10000,
      anchorDate: DAY,
    });
    expect(state.budgets.slice(0, before.length)).toEqual(before);
    const restored = await decodeBackup(await encodeBackup(state));
    expect(restored.state).toEqual(state);
    expect(restored.state.budgets.at(-1)).toMatchObject({
      period: 'day',
      recurring: true,
      anchorDate: DAY,
    });
  });
});
