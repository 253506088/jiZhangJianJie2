import { describe, expect, it } from 'vitest';
import {
  createCategoryPath,
  createEmptyState,
  mergeCategories,
  removeTransaction,
  renameCategory,
  setAccountArchived,
  setCategoryArchived,
  upsertAccount,
  upsertTemplate,
  upsertTransaction,
  type LedgerState,
} from '../core';
import {
  assertTemplateUnchanged,
  assertTransactionUnchanged,
  resolveEditorSelection,
} from './editor-state';

function fixture() {
  let counter = 0;
  const context = {
    idFactory: () => `fixture-${++counter}`,
    now: () => '2026-11-08T00:00:00.000Z',
  };
  let state = createEmptyState(context);
  const bookId = state.settings.selectedBookId;
  const addCategory = (primaryName: string, secondaryName: string) => {
    const created = createCategoryPath(
      state,
      { bookId, direction: 'expense', primaryName, secondaryName },
      context,
    );
    state = created.state;
    return created.categoryId;
  };
  const breakfastId = addCategory('餐饮', '早餐');
  const otherId = addCategory('交通', '其他');
  const extra = upsertAccount(state, { bookId, name: '测试钱包', kind: 'wallet' }, context);
  state = extra.state;
  const cashId = state.accounts[0].id;
  state = upsertTransaction(
    state,
    {
      id: 'transaction-1',
      bookId,
      direction: 'expense',
      amountCents: 1000,
      date: '2018-12-31',
      time: '09:05:01',
      accountId: cashId,
      categoryId: breakfastId,
      note: '虚构测试',
    },
    context,
  );
  const transaction = state.transactions[0];
  return {
    state,
    bookId,
    breakfastId,
    otherId,
    cashId,
    walletId: extra.accountId,
    transaction,
    context,
  };
}

describe('编辑时的明确分类与账户关联', () => {
  it('编辑已归档的原分类和账户时仍保留原选择', () => {
    const fixtureData = fixture();
    const { transaction, breakfastId, cashId, bookId } = fixtureData;
    let state = setCategoryArchived(fixtureData.state, breakfastId, true);
    state = setAccountArchived(state, cashId, true);
    const selected = resolveEditorSelection(state, {
      bookId,
      direction: 'expense',
      parentId: '',
      categoryId: breakfastId,
      accountId: cashId,
      transaction,
    });
    expect(selected.selectedChild?.id).toBe(breakfastId);
    expect(selected.selectedAccount?.id).toBe(cashId);
    expect(selected.selectedChild?.archived).toBe(true);
  });

  it('编辑使用已归档分类/账户的模板时，不自动换成另一组', () => {
    const fixtureData = fixture();
    const { breakfastId, cashId, bookId, context } = fixtureData;
    let state = upsertTemplate(
      fixtureData.state,
      {
        name: '虚构早餐模板',
        bookId,
        direction: 'expense',
        categoryId: breakfastId,
        accountId: cashId,
        amountCents: 1000,
        note: '',
      },
      context,
    );
    const template = state.templates[0];
    state = setCategoryArchived(state, breakfastId, true);
    state = setAccountArchived(state, cashId, true);
    const selected = resolveEditorSelection(state, {
      bookId,
      direction: 'expense',
      parentId: '',
      categoryId: breakfastId,
      accountId: cashId,
      template,
    });
    expect(selected.selectedChild?.id).toBe(breakfastId);
    expect(selected.selectedAccount?.id).toBe(cashId);
  });

  it('已失效的选择不回落到第一个其他分类或账户', () => {
    const { state, bookId } = fixture();
    const selected = resolveEditorSelection(state, {
      bookId,
      direction: 'expense',
      parentId: '',
      categoryId: 'missing-category',
      accountId: 'missing-account',
    });
    expect(selected.roots.length).toBeGreaterThan(0);
    expect(selected.availableAccounts.length).toBeGreaterThan(0);
    expect(selected.selectedChild).toBeUndefined();
    expect(selected.selectedAccount).toBeUndefined();
  });

  it('新增记录不自动借用归档类别或账户', () => {
    const { state: base, bookId, breakfastId, cashId } = fixture();
    const state = setAccountArchived(setCategoryArchived(base, breakfastId, true), cashId, true);
    const selected = resolveEditorSelection(state, {
      bookId,
      direction: 'expense',
      parentId: '',
      categoryId: breakfastId,
      accountId: cashId,
    });
    expect(selected.selectedChild).toBeUndefined();
    expect(selected.selectedAccount).toBeUndefined();
  });
});

describe('拒绝覆盖已经发生变化的记录', () => {
  it('修改关联、内容或删除之后必须重新打开；不会把旧编辑保存成新记录', () => {
    const { state, transaction, breakfastId, otherId, context } = fixture();
    const changed = upsertTransaction(state, { ...transaction, amountCents: 1200 }, context);
    expect(() => assertTransactionUnchanged(changed, transaction)).toThrow();
    expect(() =>
      assertTransactionUnchanged(removeTransaction(state, transaction.id), transaction),
    ).toThrow();
    expect(() =>
      assertTransactionUnchanged(mergeCategories(state, breakfastId, otherId), transaction),
    ).toThrow();
  });

  it('只修改分类的显示名称不会被误当作流水内容冲突', () => {
    const { state, transaction, breakfastId } = fixture();
    expect(() =>
      assertTransactionUnchanged(renameCategory(state, breakfastId, '早饭'), transaction),
    ).not.toThrow();
  });

  it('不能用旧表单覆盖另一个窗口修改的模板', () => {
    const { state: initial, bookId, breakfastId, cashId, context } = fixture();
    const state = upsertTemplate(
      initial,
      {
        name: '模板',
        bookId,
        direction: 'expense',
        categoryId: breakfastId,
        accountId: cashId,
        amountCents: null,
        note: '',
      },
      context,
    );
    const template = state.templates[0];
    const changed = upsertTemplate(state, { ...template, note: '新的虚构备注' }, context);
    expect(() => assertTemplateUnchanged(state, template)).not.toThrow();
    expect(() => assertTemplateUnchanged(changed, template)).toThrow();
    const missing: LedgerState = { ...state, templates: [] };
    expect(() => assertTemplateUnchanged(missing, template)).toThrow();
  });
});
