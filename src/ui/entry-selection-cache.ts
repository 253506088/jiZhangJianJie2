import type { LedgerState, Transaction, TransactionTemplate } from '../core';

export interface OrdinarySelection {
  accountId: string;
  memberId: string;
}

export function validOrdinarySelection(
  state: LedgerState,
  bookId: string,
  preferred?: Partial<OrdinarySelection>,
): OrdinarySelection {
  const accounts = state.accounts
    .filter((account) => account.bookId === bookId && !account.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const members = state.members
    .filter((member) => member.bookId === bookId && !member.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    accountId:
      accounts.find((account) => account.id === preferred?.accountId)?.id ??
      accounts.find((account) => account.kind === 'cash')?.id ??
      accounts[0]?.id ??
      '',
    memberId:
      members.find((member) => member.id === preferred?.memberId)?.id ??
      members.find((member) => member.kind === 'self')?.id ??
      '',
  };
}

/** Recent saved selections seed the form; explicit unsaved choices then live in separate refs. */
export function initialEntrySelections(
  state: LedgerState,
  bookId: string,
  transaction?: Transaction,
  template?: TransactionTemplate,
) {
  const latest = state.transactions
    .filter((item) => item.bookId === bookId)
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.date.localeCompare(a.date) ||
        (b.time ?? '').localeCompare(a.time ?? ''),
    );
  const previous = latest.find((item) => item.direction !== 'loan');
  const priorMember = state.members.find((member) => member.id === previous?.memberId);
  let ordinary = validOrdinarySelection(
    state,
    bookId,
    previous
      ? {
          accountId: previous.accountId,
          memberId:
            priorMember?.kind === 'unspecified' ? undefined : (previous.memberId ?? undefined),
        }
      : undefined,
  );
  if (template) ordinary = { accountId: template.accountId, memberId: template.memberId };
  if (transaction && transaction.direction !== 'loan')
    ordinary = {
      accountId: transaction.accountId,
      memberId: transaction.memberId ?? ordinary.memberId,
    };
  const priorLoan = latest.find((item) => item.direction === 'loan');
  const defaultLoan = validOrdinarySelection(state, bookId, { accountId: priorLoan?.accountId });
  return {
    ordinary,
    loanAccountId:
      transaction?.direction === 'loan' ? transaction.accountId : defaultLoan.accountId,
  };
}
