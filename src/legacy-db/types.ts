import type { LedgerState, TransactionDirection } from '../core/model';

export type LegacyValue = string | number | null;
export type LegacyRow = Record<string, LegacyValue>;
export interface LegacyDatabase {
  fileName: string;
  digest: string;
  userVersion: number;
  tables: Record<string, LegacyRow[]>;
}

export interface LegacyDbPlan {
  fileName: string;
  digest: string;
  state: LedgerState;
  warnings: string[];
  totals: Record<TransactionDirection, { count: number; cents: number }>;
}

export const MAX_LEGACY_DB_BYTES = 64 * 1024 * 1024;
