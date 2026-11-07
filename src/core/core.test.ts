import { describe, expect, it } from 'vitest';
import {
  type CommandContext,
  type LedgerState,
  type Transaction,
  accountBalance,
  activeCategories,
  addCents,
  bookBalance,
  budgetProgress,
  categoryPath,
  categoryTotals,
  createBook,
  createCategoryPath,
  createEmptyState,
  createPrimaryCategory,
  ensureAccountDraft,
  ensureCategoryPathDraft,
  evaluateMoneyExpression,
  filterTransactions,
  formatMoney,
  isValidDate,
  isValidTime,
  mergeCategories,
  moneyInput,
  parseMoneyToCents,
  previewCategoryMerge,
  removeTransaction,
  renameCategory,
  reorderAccounts,
  reorderCategories,
  setAccountArchived,
  setBookArchived,
  setBudget,
  setCategoryArchived,
  transactionTotals,
  updateSettings,
  upsertAccount,
  upsertTemplate,
  upsertTransaction,
  validateState,
  withLedgerDraft,
} from './index';

const NOW = '2026-11-08T02:00:00.000Z';
function context(): CommandContext {
  let number = 0;
  return { idFactory: () => `fictional-${++number}`, now: () => NOW };
}
function setup() {
  const ctx = context();
  let state = createEmptyState(ctx);
  const bookId = state.books[0].id;
  const accountId = state.accounts[0].id;
  const created = createCategoryPath(
    state,
    { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '早餐' },
    ctx,
  );
  state = created.state;
  return { state, ctx, bookId, accountId, categoryId: created.categoryId };
}
function addExpense(
  state: LedgerState,
  categoryId: string,
  amountCents: number,
  ctx: CommandContext,
  extra: Partial<Transaction> = {},
): LedgerState {
  const category = state.categories.find((item) => item.id === categoryId)!;
  return upsertTransaction(
    state,
    {
      bookId: category.bookId,
      accountId: state.accounts.find((item) => item.bookId === category.bookId)!.id,
      categoryId,
      direction: 'expense',
      amountCents,
      date: '2026-11-08',
      note: '完全虚构的测试记录',
      ...extra,
    },
    ctx,
  );
}

describe('正式账本与精确金额', () => {
  it('新账本只有账本和现金账户，不注入演示流水或分类', () => {
    const state = createEmptyState(context());
    expect(state.books).toHaveLength(1);
    expect(state.accounts).toHaveLength(1);
    expect(state.categories).toEqual([]);
    expect(state.transactions).toEqual([]);
    expect(state.categoryAliases).toEqual([]);
    expect(state.settings.selectedBookId).toBe(state.books[0].id);
    expect(() => validateState(state)).not.toThrow();
  });
  it('小数加减以整数分处理，支持精确格式化负余额', () => {
    expect(evaluateMoneyExpression('0.10+0.20')).toBe(30);
    expect(evaluateMoneyExpression('12.50+7.25-3.10')).toBe(1665);
    expect(parseMoneyToCents('-1234.05', { allowNegative: true })).toBe(-123405);
    expect(moneyInput(-3)).toBe('-0.03');
    expect(formatMoney(-123405)).toBe('-1,234.05');
  });
  it('不四舍五入无法表示的输入，不接受零、不完整式或溢出', () => {
    for (const value of ['', '0', '-1', '1+', '0.001', '1e3', '9999999999'])
      expect(() => evaluateMoneyExpression(value)).toThrow();
    expect(() => parseMoneyToCents(0.1 + 0.2)).toThrow();
    expect(parseMoneyToCents('0', { allowZero: true })).toBe(0);
    expect(() => addCents(Number.MAX_SAFE_INTEGER, 1)).toThrow();
  });
  it('验证日历中的日期而不把二月三十日滚动成三月', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
  });
  it('可选时间保留未知，存在时严格验证小时分钟秒', () => {
    expect(isValidTime('09:05')).toBe(true);
    expect(isValidTime('23:59:59')).toBe(true);
    for (const value of ['24:00', '09:60', '09:10:60', '9:05', '09:05:00.000', ''])
      expect(isValidTime(value)).toBe(false);
  });
});

describe('分类身份与用户换机 BUG 回归', () => {
  it('导入建立的分类可继续选择，同一路径历史20元加新10元为3笔30元', () => {
    const ctx = context();
    let state = createEmptyState(ctx);
    const bookId = state.books[0].id;
    let categoryId = '';
    state = withLedgerDraft(state, (draft) => {
      categoryId = ensureCategoryPathDraft(
        draft,
        { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '早餐' },
        ctx,
      ).id;
      const account = ensureAccountDraft(draft, bookId, '旧版现金', ctx, 'cash');
      const transactions: Transaction[] = [1, 2].map((row) => ({
        id: `imported-${row}`,
        bookId,
        direction: 'expense',
        amountCents: 1000,
        date: '2018-06-08',
        accountId: account.id,
        categoryId,
        toAccountId: null,
        note: '虚构历史早餐',
        createdAt: NOW,
        updatedAt: NOW,
        source: { batchId: 'batch-1', sheet: '支出', row: row + 1 },
      }));
      draft.transactions.push(...transactions);
      draft.imports.push({
        id: 'batch-1',
        bookId,
        digest: 'a'.repeat(64),
        fileName: 'fictional-legacy.xls',
        importedAt: NOW,
        totalRows: 2,
        importedRows: 2,
        skippedRows: 0,
        rejectedRows: 0,
        transactionIds: transactions.map((item) => item.id),
      });
    });
    const repeated = createCategoryPath(
      state,
      { bookId, direction: 'expense', primaryName: ' 餐饮 ', secondaryName: ' 早餐 ' },
      ctx,
    );
    expect(repeated.categoryId).toBe(categoryId);
    expect(repeated.created).toBe(false);
    expect(
      activeCategories(state, bookId, 'expense', categoryPath(state, categoryId).parent!.id).map(
        (item) => item.id,
      ),
    ).toContain(categoryId);
    state = addExpense(repeated.state, categoryId, 1000, ctx);
    expect(categoryTotals(state, { bookId, direction: 'expense' })).toMatchObject([
      { categoryId, amountCents: 3000, count: 3 },
    ]);
  });
  it('相同二级名在不同一级、不同收支或不同账本中不会自动合并', () => {
    const { ctx, bookId } = setup();
    let state = createEmptyState();
    const firstBook = state.books[0].id;
    const ids: string[] = [];
    for (const [primaryName, direction] of [
      ['餐饮', 'expense'],
      ['交通', 'expense'],
      ['餐饮', 'income'],
    ] as const) {
      const result = createCategoryPath(
        state,
        { bookId: firstBook, direction, primaryName, secondaryName: '其他' },
        ctx,
      );
      state = result.state;
      ids.push(result.categoryId);
    }
    const book = createBook(state, '家庭账本', ctx);
    state = book.state;
    const fourth = createCategoryPath(
      state,
      { bookId: book.bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '其他' },
      ctx,
    );
    ids.push(fourth.categoryId);
    expect(new Set(ids).size).toBe(4);
    expect(bookId).not.toBe(firstBook);
  });
  it('仅做NFC与首尾规范化，不把含义近似或内部空格不同的名称擅自合并', () => {
    const { state, ctx, bookId } = setup();
    const a = createCategoryPath(
      state,
      { bookId, direction: 'expense', primaryName: 'Cafe\u0301', secondaryName: '早 餐' },
      ctx,
    );
    const b = createCategoryPath(
      a.state,
      { bookId, direction: 'expense', primaryName: ' Café ', secondaryName: '早 餐 ' },
      ctx,
    );
    const c = createCategoryPath(
      b.state,
      { bookId, direction: 'expense', primaryName: 'Café', secondaryName: '早餐' },
      ctx,
    );
    expect(a.categoryId).toBe(b.categoryId);
    expect(c.categoryId).not.toBe(a.categoryId);
  });
  it('子分类和父分类改名后身份不变，后续旧路径导入仍落在同一类别', () => {
    const { ctx, bookId, categoryId, state: original } = setup();
    let state = addExpense(original, categoryId, 1000, ctx);
    state = renameCategory(state, categoryId, '早点');
    state = renameCategory(state, categoryPath(state, categoryId).parent!.id, '饮食');
    const imported = createCategoryPath(
      state,
      { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '早餐' },
      ctx,
    );
    expect(imported.categoryId).toBe(categoryId);
    expect(categoryPath(imported.state, categoryId).label).toBe('饮食 / 早点');
    expect(imported.state.transactions[0].categoryId).toBe(categoryId);
    expect(categoryPath(original, categoryId).label).toBe('餐饮 / 早餐');
  });
  it('改名到已有分类会失败且不改原账本', () => {
    const { ctx, bookId, categoryId, state } = setup();
    const other = createCategoryPath(
      state,
      { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '午餐' },
      ctx,
    );
    const before = structuredClone(other.state);
    expect(() => renameCategory(other.state, categoryId, '午餐')).toThrow();
    expect(other.state).toEqual(before);
  });
  it('归档不抹除历史和统计，新增记账拒绝归档类别；导入能重新启用路径', () => {
    const { ctx, bookId, categoryId, state: empty } = setup();
    let state = addExpense(empty, categoryId, 1000, ctx);
    const parentId = categoryPath(state, categoryId).parent!.id;
    state = setCategoryArchived(state, parentId, true);
    expect(transactionTotals(state.transactions).expenseCents).toBe(1000);
    expect(activeCategories(state, bookId, 'expense')).toHaveLength(0);
    expect(() => addExpense(state, categoryId, 1000, ctx)).toThrow();
    const reactivated = createCategoryPath(
      state,
      { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '早餐' },
      ctx,
    );
    expect(reactivated.categoryId).toBe(categoryId);
    expect(activeCategories(reactivated.state, bookId, 'expense', parentId)).toHaveLength(1);
  });
  it('显式叶子合并迁移所有流水、模板、预算和旧名称，不删除记录', () => {
    const { ctx, bookId, accountId, categoryId: sourceId, state: empty } = setup();
    const second = createCategoryPath(
      empty,
      { bookId, direction: 'expense', primaryName: '饮食', secondaryName: '早餐' },
      ctx,
    );
    const targetId = second.categoryId;
    let state = addExpense(second.state, sourceId, 1000, ctx);
    state = addExpense(state, targetId, 2000, ctx);
    state = upsertTemplate(
      state,
      {
        bookId,
        name: '早餐模板',
        direction: 'expense',
        categoryId: sourceId,
        accountId,
        amountCents: 1000,
        note: '',
      },
      ctx,
    );
    state = setBudget(
      state,
      { bookId, categoryId: sourceId, month: '2026-11', amountCents: 5000 },
      ctx,
    );
    state = setBudget(
      state,
      { bookId, categoryId: targetId, month: '2026-11', amountCents: 6000 },
      ctx,
    );
    const before = structuredClone(state.transactions);
    expect(previewCategoryMerge(state, sourceId, targetId)).toMatchObject({
      affectedTransactions: 1,
      amountCents: 1000,
      affectedTemplates: 1,
      affectedBudgets: 1,
    });
    const merged = mergeCategories(state, sourceId, targetId);
    expect(merged.transactions.map((item) => ({ ...item, categoryId: sourceId }))).toEqual(
      before.map((item) => ({ ...item, categoryId: sourceId })),
    );
    expect(merged.templates[0].categoryId).toBe(targetId);
    expect(merged.budgets).toHaveLength(1);
    expect(merged.budgets[0].amountCents).toBe(11000);
    expect(categoryTotals(merged, { direction: 'expense' })).toMatchObject([
      { categoryId: targetId, count: 2, amountCents: 3000 },
    ]);
    expect(
      createCategoryPath(
        merged,
        { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '早餐' },
        ctx,
      ).categoryId,
    ).toBe(targetId);
  });
  it('一级合并只在目标父级内部合并同名子项，其余子项保留身份', () => {
    const { ctx, bookId, categoryId: oldBreakfast, state: empty } = setup();
    const lunch = createCategoryPath(
      empty,
      { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '午餐' },
      ctx,
    );
    const destination = createCategoryPath(
      lunch.state,
      { bookId, direction: 'expense', primaryName: '饮食', secondaryName: '早餐' },
      ctx,
    );
    let state = addExpense(destination.state, oldBreakfast, 1000, ctx);
    state = addExpense(state, destination.categoryId, 2000, ctx);
    state = addExpense(state, lunch.categoryId, 3000, ctx);
    const sourceParent = categoryPath(state, oldBreakfast).parent!.id;
    const targetParent = categoryPath(state, destination.categoryId).parent!.id;
    expect(previewCategoryMerge(state, sourceParent, targetParent).mergingChildPairs).toHaveLength(
      1,
    );
    const merged = mergeCategories(state, sourceParent, targetParent);
    expect(merged.categories.some((item) => item.id === sourceParent)).toBe(false);
    expect(categoryPath(merged, lunch.categoryId).parent!.id).toBe(targetParent);
    expect(categoryTotals(merged, { direction: 'expense' }, 'primary')).toMatchObject([
      { amountCents: 6000, count: 3 },
    ]);
    expect(
      createCategoryPath(
        merged,
        { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '午餐' },
        ctx,
      ).categoryId,
    ).toBe(lunch.categoryId);
  });
  it('多次改名、合并后最早的旧路径仍能解析到最终ID', () => {
    const { ctx, bookId, categoryId, state } = setup();
    const renamed = renameCategory(state, categoryId, '早点');
    const other = createCategoryPath(
      renamed,
      { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '早饭' },
      ctx,
    );
    const merged = mergeCategories(other.state, categoryId, other.categoryId);
    for (const name of ['早餐', '早点', '早饭'])
      expect(
        createCategoryPath(
          merged,
          { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: name },
          ctx,
        ).categoryId,
      ).toBe(other.categoryId);
  });
  it('分类排序不改变身份，不能把不同父级混为一组', () => {
    const { ctx, bookId, categoryId, state } = setup();
    const lunch = createCategoryPath(
      state,
      { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '午餐' },
      ctx,
    );
    const sorted = reorderCategories(lunch.state, [lunch.categoryId, categoryId]);
    const parent = categoryPath(sorted, categoryId).parent!.id;
    expect(activeCategories(sorted, bookId, 'expense', parent).map((item) => item.id)).toEqual([
      lunch.categoryId,
      categoryId,
    ]);
    expect(() => reorderCategories(sorted, [parent, categoryId])).toThrow();
  });
});

describe('流水、转账、账本与账户', () => {
  it('编辑未指定时间时保留已导入时间，可以明确清除但不能写非法时间', () => {
    const { ctx, categoryId, state: empty } = setup();
    const state = addExpense(empty, categoryId, 1000, ctx, { time: '09:05:30' });
    const { time: _time, ...withoutTime } = state.transactions[0];
    const edited = upsertTransaction(state, { ...withoutTime, note: '虚构修改' }, ctx);
    expect(edited.transactions[0].time).toBe('09:05:30');
    const cleared = upsertTransaction(edited, { ...withoutTime, time: null }, ctx);
    expect(cleared.transactions[0].time).toBeUndefined();
    expect(() => upsertTransaction(state, { ...withoutTime, time: '25:00' }, ctx)).toThrow();
  });
  it('内容完全相同的新ID是两笔账，按ID编辑才替换', () => {
    const { ctx, categoryId, state: empty } = setup();
    let state = addExpense(empty, categoryId, 1000, ctx);
    state = addExpense(state, categoryId, 1000, ctx);
    expect(state.transactions).toHaveLength(2);
    expect(transactionTotals(state.transactions).expenseCents).toBe(2000);
    const edited = upsertTransaction(state, { ...state.transactions[0], amountCents: 1500 }, ctx);
    expect(edited.transactions).toHaveLength(2);
    expect(transactionTotals(edited.transactions).expenseCents).toBe(2500);
  });
  it('转账双向改变账户余额，但不改变收支合计或账本净余额', () => {
    const { ctx, bookId, accountId, categoryId, state: empty } = setup();
    let state = upsertAccount(
      empty,
      { id: accountId, bookId, name: '现金', kind: 'cash', openingBalanceCents: 10000 },
      ctx,
    ).state;
    const bank = upsertAccount(
      state,
      { bookId, name: '银行卡', kind: 'bank', openingBalanceCents: 20000 },
      ctx,
    );
    state = bank.state;
    state = addExpense(state, categoryId, 1000, ctx);
    state = upsertTransaction(
      state,
      {
        bookId,
        accountId,
        toAccountId: bank.accountId,
        direction: 'transfer',
        amountCents: 2500,
        date: '2026-11-08',
        note: '虚构转账',
      },
      ctx,
    );
    expect(accountBalance(state, accountId)).toBe(6500);
    expect(accountBalance(state, bank.accountId)).toBe(22500);
    expect(bookBalance(state, bookId)).toBe(29000);
    expect(transactionTotals(state.transactions)).toMatchObject({
      incomeCents: 0,
      expenseCents: 1000,
      transferCents: 2500,
      transferCount: 1,
    });
    expect(filterTransactions(state, { accountId: bank.accountId })).toHaveLength(1);
    expect(categoryTotals(state, { direction: 'expense' })).toHaveLength(1);
    expect(() =>
      upsertTransaction(
        state,
        {
          bookId,
          accountId,
          toAccountId: accountId,
          direction: 'transfer',
          amountCents: 1,
          date: '2026-11-08',
        },
        ctx,
      ),
    ).toThrow();
  });
  it('支持跨年/月筛选和按完整分类路径搜索，不把其他账本混进来', () => {
    const { ctx, bookId, categoryId, state: empty } = setup();
    let state = addExpense(empty, categoryId, 1000, ctx, { date: '2018-11-08' });
    state = addExpense(state, categoryId, 2000, ctx, { date: '2026-11-08' });
    state = addExpense(state, categoryId, 3000, ctx, { date: '2026-10-31' });
    expect(filterTransactions(state, { bookId, month: '2026-11' })).toHaveLength(1);
    expect(
      filterTransactions(state, { fromDate: '2018-01-01', toDate: '2018-12-31' }),
    ).toHaveLength(1);
    expect(filterTransactions(state, { search: '餐饮 / 早餐' })).toHaveLength(3);
    expect(filterTransactions(state, { bookId: 'missing' })).toEqual([]);
  });
  it('账户归档保留历史余额，并拒绝使用归档账户新增账目', () => {
    const { ctx, accountId, categoryId, state: empty } = setup();
    const state = setAccountArchived(addExpense(empty, categoryId, 1000, ctx), accountId, true);
    expect(accountBalance(state, accountId)).toBe(-1000);
    expect(() => addExpense(state, categoryId, 1000, ctx)).toThrow();
    expect(
      upsertTransaction(state, { ...state.transactions[0], note: '只编辑历史备注' }, ctx)
        .transactions[0].note,
    ).toBe('只编辑历史备注');
  });
  it('账本归档切换当前账本，不允许把最后一个活动账本归档', () => {
    const { ctx, bookId, state } = setup();
    expect(() => setBookArchived(state, bookId, true)).toThrow();
    const second = createBook(state, '备用账本', ctx);
    const archived = setBookArchived(second.state, second.bookId, true);
    expect(archived.settings.selectedBookId).toBe(bookId);
    expect(() => updateSettings(archived, { selectedBookId: second.bookId })).toThrow();
  });
  it('期初余额与归档账户排序均不改变流水', () => {
    const { ctx, bookId, accountId, categoryId, state: empty } = setup();
    const state = addExpense(empty, categoryId, 1000, ctx);
    const other = upsertAccount(
      state,
      { bookId, name: '虚构钱包', openingBalanceCents: -500 },
      ctx,
    );
    const reordered = reorderAccounts(other.state, bookId, [other.accountId, accountId]);
    expect(reordered.transactions).toEqual(state.transactions);
    expect(accountBalance(reordered, other.accountId)).toBe(-500);
  });
  it('预算统计包含指定父类的子类，但不包含其他类别或转账', () => {
    const { ctx, bookId, categoryId, state: empty } = setup();
    const state = addExpense(empty, categoryId, 1500, ctx);
    const parentId = categoryPath(state, categoryId).parent!.id;
    const budgeted = setBudget(
      state,
      { bookId, month: '2026-11', categoryId: parentId, amountCents: 5000 },
      ctx,
    );
    expect(budgetProgress(budgeted, budgeted.budgets[0].id)).toMatchObject({
      spentCents: 1500,
      remainingCents: 3500,
      ratio: 0.3,
    });
  });
});

describe('严格校验与原子草稿', () => {
  it('拒绝重复路径、错误外键、错误收支、非法日期及未来schema', () => {
    const { ctx, categoryId, state: empty } = setup();
    const state = addExpense(empty, categoryId, 1000, ctx);
    const mutations: ((draft: LedgerState) => void)[] = [
      (draft) => {
        draft.categories.push({ ...draft.categories[1], id: 'duplicate-category' });
      },
      (draft) => {
        draft.transactions[0].accountId = 'missing-account';
      },
      (draft) => {
        draft.transactions[0].categoryId = draft.categories[0].id;
      },
      (draft) => {
        draft.transactions[0].direction = 'income';
      },
      (draft) => {
        draft.transactions[0].date = '2026-02-30';
      },
      (draft) => {
        draft.transactions[0].amountCents = 0.1;
      },
      (draft) => {
        (draft as { schemaVersion: number }).schemaVersion = 2;
      },
      (draft) => {
        draft.categories[1].parentId = draft.categories[1].id;
      },
    ];
    const before = structuredClone(state);
    for (const mutation of mutations) expect(() => withLedgerDraft(state, mutation)).toThrow();
    expect(state).toEqual(before);
  });
  it('调用者在草稿内抛错时，原账本和所有关联保持原状', () => {
    const { state, bookId, ctx } = setup();
    const before = structuredClone(state);
    expect(() =>
      withLedgerDraft(state, (draft) => {
        ensureCategoryPathDraft(
          draft,
          { bookId, direction: 'expense', primaryName: '新增', secondaryName: '后续失败' },
          ctx,
        );
        throw new Error('synthetic failure');
      }),
    ).toThrow('synthetic failure');
    expect(state).toEqual(before);
  });
  it('删除导入流水后保留批次历史，当前来源行重复仍被拒绝', () => {
    const { state: initial, bookId, accountId, categoryId } = setup();
    const state = withLedgerDraft(initial, (draft) => {
      const transaction: Transaction = {
        id: 'row-1',
        bookId,
        accountId,
        categoryId,
        direction: 'expense',
        amountCents: 1000,
        date: '2026-11-08',
        time: '09:05',
        toAccountId: null,
        note: '',
        createdAt: NOW,
        updatedAt: NOW,
        source: { batchId: 'batch-1', sheet: '账目', row: 2, rawDate: '2026/11/08 09:05' },
      };
      draft.transactions.push(transaction);
      draft.imports.push({
        id: 'batch-1',
        bookId,
        digest: 'b'.repeat(64),
        fileName: 'fictional.xlsx',
        importedAt: NOW,
        totalRows: 1,
        importedRows: 1,
        skippedRows: 0,
        rejectedRows: 0,
        transactionIds: ['row-1'],
      });
    });
    const removed = removeTransaction(state, 'row-1');
    expect(removed.transactions).toEqual([]);
    expect(removed.imports[0].transactionIds).toEqual(['row-1']);
    expect(() => validateState(removed)).not.toThrow();
    expect(() =>
      withLedgerDraft(state, (draft) => {
        draft.transactions[0].source!.rawDate = Infinity;
      }),
    ).toThrow();
    expect(() =>
      withLedgerDraft(state, (draft) => {
        draft.transactions.push({ ...draft.transactions[0], id: 'row-duplicate' });
        const batch = draft.imports[0];
        batch.transactionIds.push('row-duplicate');
        batch.totalRows++;
        batch.importedRows++;
      }),
    ).toThrow();
  });
  it('一级类别可以暂时没有子类，但不能直接记账在一级', () => {
    const ctx = context();
    const initial = createEmptyState(ctx);
    const bookId = initial.books[0].id;
    const result = createPrimaryCategory(
      initial,
      { bookId, direction: 'expense', name: '新分类' },
      ctx,
    );
    expect(() => validateState(result.state)).not.toThrow();
    expect(() =>
      upsertTransaction(
        result.state,
        {
          bookId,
          accountId: initial.accounts[0].id,
          categoryId: result.categoryId,
          direction: 'expense',
          date: '2026-11-08',
          amountCents: 100,
        },
        ctx,
      ),
    ).toThrow();
  });
});
