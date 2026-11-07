import { validateState as validateV1, type LedgerState as LedgerStateV1 } from './legacy-v1';
import { LedgerError, SCHEMA_VERSION, validateState, type LedgerState } from './model';

/** Validates the original schema before upgrading. Reading never writes or repairs the stored bytes. */
export function migrateState(value: unknown): LedgerState {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LedgerError('账本格式不正确');
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (version === SCHEMA_VERSION) {
    validateState(value);
    return structuredClone(value);
  }
  if (version !== 1)
    throw new LedgerError('账本版本不受支持，请使用匹配版本的应用', 'UNSUPPORTED_SCHEMA');
  validateV1(value);
  const legacy: LedgerStateV1 = structuredClone(value);
  const unknownByBook = new Map(
    legacy.books.map((book, index) => [book.id, `member-v1-${index + 1}-unspecified`]),
  );
  const migrated: LedgerState = {
    ...legacy,
    schemaVersion: SCHEMA_VERSION,
    members: legacy.books.flatMap((book, index) => [
      {
        id: `member-v1-${index + 1}-self`,
        bookId: book.id,
        name: '自己',
        kind: 'self' as const,
        sortOrder: 0,
        archived: false,
        createdAt: book.createdAt,
      },
      {
        id: unknownByBook.get(book.id)!,
        bookId: book.id,
        name: '未指定',
        kind: 'unspecified' as const,
        sortOrder: 1,
        archived: false,
        createdAt: book.createdAt,
      },
    ]),
    memberAliases: [],
    loanPeople: [],
    loanPersonAliases: [],
    transactions: legacy.transactions.map((transaction) => ({
      ...transaction,
      memberId: unknownByBook.get(transaction.bookId)!,
      loanType: null,
      personId: null,
    })),
    templates: legacy.templates.map((template) => ({
      ...template,
      memberId: unknownByBook.get(template.bookId)!,
    })),
    settings: { ...legacy.settings, homeLayout: 'classic', accentColor: 'coral' },
  };
  validateState(migrated);
  return migrated;
}
