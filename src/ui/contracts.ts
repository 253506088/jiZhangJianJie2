import type { ReactNode } from 'react';
import type { BudgetPeriod, LedgerState, LoanType, TransactionDirection } from '../core';

export type LedgerMutation = (state: LedgerState) => LedgerState;
export type CommitChange = (mutation: LedgerMutation, successMessage?: string) => Promise<boolean>;

export interface ProductionAppProps {
  state: LedgerState;
  busy: boolean;
  mutate: (mutation: LedgerMutation) => Promise<void>;
  onImport: () => void;
  onExport: () => void;
  onExcelExport?: () => void;
  onRestore: () => void;
  onHistory: () => void;
  dataTools?: ReactNode;
}

export interface ProductionAppHandle {
  /** true when a sheet or in-app page handled the request; false at the home screen. */
  back(): boolean;
  /** The parent changes selectedBookId durably first; this only directs the view. */
  showTransactions(options?: { month?: string; bookId?: string }): void;
}

export type Screen =
  | 'home'
  | 'entry'
  | 'details'
  | 'reports'
  | 'accounts'
  | 'categories'
  | 'books'
  | 'data'
  | 'budgets'
  | 'templates'
  | 'members'
  | 'loanPeople';

export interface Route {
  screen: Screen;
  transactionId?: string;
  templateId?: string;
  templateOnly?: boolean;
  accountId?: string;
  categoryId?: string;
  direction?: TransactionDirection;
  fromDate?: string;
  toDate?: string;
  periodLabel?: string;
  memberId?: string;
  personId?: string;
  loanType?: LoanType;
  budgetPeriod?: BudgetPeriod;
}

export interface PageProps {
  state: LedgerState;
  bookId: string;
  busy: boolean;
  commit: CommitChange;
}
