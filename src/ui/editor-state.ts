import type { LedgerState, Transaction, TransactionDirection, TransactionTemplate } from '../core';

/** Compare only stored record identity/content, never the display name of its linked category. */
export function transactionEditVersion(transaction: Transaction): string {
  return JSON.stringify([
    transaction.id,
    transaction.bookId,
    transaction.direction,
    transaction.categoryId,
    transaction.accountId,
    transaction.toAccountId,
    transaction.amountCents,
    transaction.date,
    transaction.time ?? '',
    transaction.note,
    transaction.createdAt,
    transaction.updatedAt,
    transaction.memberId,
    transaction.personId,
    transaction.loanType,
    transaction.transferType ?? '',
  ]);
}

export function nextExpenseCategory(state: LedgerState, bookId: string, preferredId?: string) {
  const parents = new Map(
    state.categories
      .filter(
        (category) =>
          category.bookId === bookId &&
          category.direction === 'expense' &&
          category.parentId === null &&
          !category.archived,
      )
      .map((category) => [category.id, category]),
  );
  const choices = state.categories
    .filter(
      (category) =>
        category.bookId === bookId &&
        category.direction === 'expense' &&
        category.parentId !== null &&
        !category.archived &&
        parents.has(category.parentId),
    )
    .sort(
      (a, b) =>
        parents.get(a.parentId!)!.sortOrder - parents.get(b.parentId!)!.sortOrder ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, 'zh-CN'),
    );
  return choices.find((category) => category.id === preferredId) ?? choices[0];
}

export function assertTransactionUnchanged(state: LedgerState, original: Transaction): void {
  const current = state.transactions.find((item) => item.id === original.id);
  if (!current || transactionEditVersion(current) !== transactionEditVersion(original)) {
    throw new Error('这条账目已被修改或删除。请返回后重新打开，避免覆盖新的内容。');
  }
}

export function assertTemplateUnchanged(state: LedgerState, original: TransactionTemplate): void {
  const current = state.templates.find((item) => item.id === original.id);
  const version = (template: TransactionTemplate) =>
    JSON.stringify([
      template.id,
      template.bookId,
      template.name,
      template.direction,
      template.categoryId,
      template.accountId,
      template.amountCents,
      template.note,
      template.memberId,
    ]);
  if (!current || version(current) !== version(original)) {
    throw new Error('这个模板已被修改或删除。请返回后重新打开，再保存修改。');
  }
}

interface EditorSelection {
  bookId: string;
  direction: TransactionDirection;
  parentId: string;
  categoryId: string;
  accountId: string;
  transaction?: Transaction;
  template?: TransactionTemplate;
}

/** Missing IDs intentionally remain unselected; never silently reassign a financial record. */
export function resolveEditorSelection(state: LedgerState, selection: EditorSelection) {
  const retainedCategoryId = selection.transaction?.categoryId ?? selection.template?.categoryId;
  const retainedParentId = state.categories.find(
    (item) => item.id === retainedCategoryId,
  )?.parentId;
  const roots = state.categories
    .filter(
      (item) =>
        item.bookId === selection.bookId &&
        item.direction === selection.direction &&
        item.parentId === null &&
        (!item.archived || item.id === retainedParentId),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const chosenCategory = state.categories.find(
    (item) =>
      item.id === selection.categoryId &&
      item.bookId === selection.bookId &&
      item.direction === selection.direction &&
      item.parentId !== null,
  );
  const selectedRoot = roots.find(
    (item) => item.id === (chosenCategory?.parentId ?? selection.parentId),
  );
  const children = state.categories
    .filter(
      (item) =>
        item.parentId === selectedRoot?.id && (!item.archived || item.id === retainedCategoryId),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const selectedChild = children.find((item) => item.id === selection.categoryId);
  const retainedAccountIds = new Set([
    selection.transaction?.accountId,
    selection.transaction?.toAccountId,
    selection.template?.accountId,
  ]);
  const availableAccounts = state.accounts
    .filter(
      (item) =>
        item.bookId === selection.bookId && (!item.archived || retainedAccountIds.has(item.id)),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    roots,
    selectedRoot,
    children,
    selectedChild,
    availableAccounts,
    selectedAccount: availableAccounts.find((item) => item.id === selection.accountId),
  };
}
