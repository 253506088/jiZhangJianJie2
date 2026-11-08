import { categoryPath, type LedgerState, type LoanType } from '../core';

export const loanLabels: Record<LoanType, string> = {
  borrow: '借入',
  lend: '借出',
  repay: '还款',
  collect: '收款',
};

/** Income is one visible level; migrated, genuinely distinct same-name paths remain distinguishable. */
export function categoryDisplayLabel(state: LedgerState, categoryId: string) {
  const path = categoryPath(state, categoryId);
  if (path.category.direction !== 'income' || !path.parent) return path.label;
  const duplicates = state.categories.filter(
    (item) =>
      item.bookId === path.category.bookId &&
      item.direction === 'income' &&
      item.parentId !== null &&
      item.name === path.category.name,
  );
  return duplicates.length > 1 ? path.label : path.category.name;
}

export function memberName(state: LedgerState, id: string | null | undefined) {
  return state.members.find((item) => item.id === id)?.name ?? '未指定';
}

export function personName(state: LedgerState, id: string | null | undefined) {
  return state.loanPeople.find((item) => item.id === id)?.name ?? '未指定借贷人';
}
