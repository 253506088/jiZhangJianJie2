/** Frozen schema-v1 validator and types. Used only to authenticate a legacy structure before migration. */
export const SCHEMA_VERSION = 1 as const;
export const MAX_AMOUNT_CENTS = 99_999_999_999;
export const MAX_TRANSACTIONS = 200_000;

export type Direction = 'expense' | 'income';
export type TransactionDirection = Direction | 'transfer';
export type Theme = 'light' | 'dark' | 'system';
export type AccountKind = 'cash' | 'bank' | 'wallet' | 'other';

export interface CommandContext {
  idFactory?: () => string;
  now?: () => string;
}

export interface Book {
  id: string;
  name: string;
  currency: 'CNY';
  archived: boolean;
  createdAt: string;
}

export interface Account {
  id: string;
  bookId: string;
  name: string;
  kind: AccountKind;
  openingBalanceCents: number;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  bookId: string;
  direction: Direction;
  parentId: string | null;
  name: string;
  sortOrder: number;
  archived: boolean;
  icon: string;
}

/** Explicit rename/merge history. Import uses these paths before creating categories. */
export interface CategoryAlias {
  bookId: string;
  direction: Direction;
  primaryName: string;
  secondaryName: string;
  categoryId: string;
}

export interface TransactionSource {
  batchId: string;
  sheet: string;
  /** One-based source worksheet row, never an array index. */
  row: number;
  /** Original exported date cell, retained without guessing its representation. */
  rawDate?: string | number;
}

export interface Transaction {
  id: string;
  bookId: string;
  direction: TransactionDirection;
  amountCents: number;
  date: string;
  /** Optional source/local wall-clock time; absence remains unknown, not midnight. */
  time?: string;
  accountId: string;
  /** A second-level category for income/expense; null for transfers. */
  categoryId: string | null;
  /** Destination account for a transfer; null otherwise. */
  toAccountId: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  source?: TransactionSource;
}

export interface ImportBatch {
  id: string;
  bookId: string;
  digest: string;
  fileName: string;
  importedAt: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  rejectedRows: number;
  /** Historical import identity: IDs remain here after a transaction is deleted. */
  transactionIds: string[];
  /** Retained after deletion so a repeated/partial import cannot resurrect the same source row. */
  sourceRows?: { sheet: string; row: number; transactionId: string }[];
}

export interface Budget {
  id: string;
  bookId: string;
  month: string;
  /** null means the whole book; a category can be first or second level. */
  categoryId: string | null;
  amountCents: number;
}

export interface TransactionTemplate {
  id: string;
  bookId: string;
  name: string;
  direction: Direction;
  categoryId: string;
  accountId: string;
  amountCents: number | null;
  note: string;
}

export interface LedgerState {
  schemaVersion: typeof SCHEMA_VERSION;
  books: Book[];
  accounts: Account[];
  categories: Category[];
  categoryAliases: CategoryAlias[];
  transactions: Transaction[];
  imports: ImportBatch[];
  budgets: Budget[];
  templates: TransactionTemplate[];
  settings: {
    selectedBookId: string;
    theme: Theme;
  };
}

export class LedgerError extends Error {
  constructor(
    message: string,
    readonly code = 'INVALID_STATE',
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

export function makeId(context: CommandContext = {}): string {
  if (context.idFactory) return context.idFactory();
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function nowIso(context: CommandContext = {}): string {
  return context.now?.() ?? new Date().toISOString();
}

export function normalizeName(value: string): string {
  return value.normalize('NFC').trim();
}

export function categoryPathKey(
  bookId: string,
  direction: Direction,
  primaryName: string,
  secondaryName: string,
): string {
  return JSON.stringify([
    bookId,
    direction,
    normalizeName(primaryName),
    normalizeName(secondaryName),
  ]);
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createEmptyState(context: CommandContext = {}): LedgerState {
  const bookId = makeId(context);
  const createdAt = nowIso(context);
  return {
    schemaVersion: SCHEMA_VERSION,
    books: [{ id: bookId, name: '生活账本', currency: 'CNY', archived: false, createdAt }],
    accounts: [
      {
        id: makeId(context),
        bookId,
        name: '现金',
        kind: 'cash',
        openingBalanceCents: 0,
        sortOrder: 0,
        archived: false,
        createdAt,
      },
    ],
    categories: [],
    categoryAliases: [],
    transactions: [],
    imports: [],
    budgets: [],
    templates: [],
    settings: { selectedBookId: bookId, theme: 'light' },
  };
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new LedgerError(message);
}

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  requireValue(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label}格式不正确`,
  );
}

function list(value: unknown, label: string, limit: number): asserts value is unknown[] {
  requireValue(Array.isArray(value) && value.length <= limit, `${label}格式或数量不正确`);
}

function string(
  value: unknown,
  label: string,
  max: number,
  allowEmpty = false,
): asserts value is string {
  requireValue(
    typeof value === 'string' &&
      value.length <= max &&
      (allowEmpty || value.length > 0) &&
      !value.includes('\0'),
    `${label}格式不正确`,
  );
}

function identifier(value: unknown, label: string): asserts value is string {
  string(value, label, 128);
}

function name(value: unknown, label: string): asserts value is string {
  string(value, label, 120);
  requireValue(value === normalizeName(value), `${label}需要去除首尾空白并规范化`);
}

function timestamp(value: unknown, label: string): asserts value is string {
  string(value, label, 40);
  requireValue(
    /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
    `${label}格式不正确`,
  );
}

function moneyValue(
  value: unknown,
  label: string,
  allowZero = false,
  allowNegative = false,
): asserts value is number {
  requireValue(
    typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      Math.abs(value) <= MAX_AMOUNT_CENTS &&
      (allowNegative || value >= 0) &&
      (allowZero || value !== 0),
    `${label}必须是有效的整数金额`,
  );
}

function order(value: unknown): asserts value is number {
  requireValue(Number.isSafeInteger(value) && (value as number) >= 0, '排序值不正确');
}

function distinctIds<T extends { id: string }>(items: T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    requireValue(!result.has(item.id), `${label}包含重复标识`);
    result.set(item.id, item);
  }
  return result;
}

/** Validates without repairing, normalizing, logging or otherwise changing caller data. */
export function validateState(value: unknown): asserts value is LedgerState {
  record(value, '账本');
  requireValue(value.schemaVersion === SCHEMA_VERSION, '账本版本不受支持，请使用匹配版本的应用');
  list(value.books, '账本列表', 1000);
  list(value.accounts, '账户列表', 20_000);
  list(value.categories, '分类列表', 50_000);
  list(value.categoryAliases, '分类历史', 100_000);
  list(value.transactions, '流水列表', MAX_TRANSACTIONS);
  list(value.imports, '导入记录', 20_000);
  list(value.budgets, '预算列表', 50_000);
  list(value.templates, '模板列表', 20_000);
  record(value.settings, '设置');
  requireValue(value.books.length > 0, '至少需要一个账本');

  for (const book of value.books) {
    record(book, '账本记录');
    identifier(book.id, '账本标识');
    name(book.name, '账本名称');
    requireValue(book.currency === 'CNY', '此版本仅支持人民币账本');
    requireValue(typeof book.archived === 'boolean', '账本归档状态不正确');
    timestamp(book.createdAt, '账本创建时间');
  }
  const state = value as unknown as LedgerState;
  const books = distinctIds(state.books, '账本');
  const bookNames = new Set<string>();
  for (const book of state.books) {
    requireValue(!bookNames.has(book.name), '账本名称重复');
    bookNames.add(book.name);
  }
  identifier(value.settings.selectedBookId, '当前账本');
  requireValue(
    books.has(value.settings.selectedBookId) && !books.get(value.settings.selectedBookId)!.archived,
    '当前账本不存在或已归档',
  );
  requireValue(
    ['light', 'dark', 'system'].includes(value.settings.theme as string),
    '主题设置不正确',
  );

  const accountNames = new Set<string>();
  for (const account of value.accounts) {
    record(account, '账户');
    identifier(account.id, '账户标识');
    identifier(account.bookId, '账户所属账本');
    name(account.name, '账户名称');
    requireValue(books.has(account.bookId), '账户所属账本不存在');
    requireValue(
      ['cash', 'bank', 'wallet', 'other'].includes(account.kind as string),
      '账户类型不正确',
    );
    requireValue(typeof account.archived === 'boolean', '账户归档状态不正确');
    moneyValue(account.openingBalanceCents, '期初余额', true, true);
    order(account.sortOrder);
    timestamp(account.createdAt, '账户创建时间');
    const key = JSON.stringify([account.bookId, account.name]);
    requireValue(!accountNames.has(key), '同一账本下的账户名称重复');
    accountNames.add(key);
  }
  const accounts = distinctIds(state.accounts, '账户');

  const categoryKeys = new Set<string>();
  for (const category of value.categories) {
    record(category, '分类');
    identifier(category.id, '分类标识');
    identifier(category.bookId, '分类所属账本');
    name(category.name, '分类名称');
    requireValue(books.has(category.bookId), '分类所属账本不存在');
    requireValue(
      category.direction === 'expense' || category.direction === 'income',
      '分类收支类型不正确',
    );
    requireValue(
      category.parentId === null || typeof category.parentId === 'string',
      '父分类标识不正确',
    );
    requireValue(typeof category.archived === 'boolean', '分类归档状态不正确');
    string(category.icon, '分类图标', 80, true);
    order(category.sortOrder);
    const key = JSON.stringify([
      category.bookId,
      category.direction,
      category.parentId,
      category.name,
    ]);
    requireValue(!categoryKeys.has(key), '同一父分类下不能存在同名分类');
    categoryKeys.add(key);
  }
  const categories = distinctIds(state.categories, '分类');
  const fullPaths = new Map<string, string>();
  for (const category of state.categories) {
    if (category.parentId === null) continue;
    const parent = categories.get(category.parentId);
    requireValue(
      parent &&
        parent.parentId === null &&
        parent.bookId === category.bookId &&
        parent.direction === category.direction,
      '分类必须属于同账本、同收支类型的一级分类',
    );
    requireValue(!parent.archived || category.archived, '已归档的一级分类不能包含启用的二级分类');
    fullPaths.set(
      categoryPathKey(category.bookId, category.direction, parent.name, category.name),
      category.id,
    );
  }
  const aliasKeys = new Set<string>();
  for (const alias of value.categoryAliases) {
    record(alias, '分类历史');
    identifier(alias.bookId, '历史分类所属账本');
    identifier(alias.categoryId, '历史分类目标');
    name(alias.primaryName, '历史一级分类');
    name(alias.secondaryName, '历史二级分类');
    requireValue(
      alias.direction === 'expense' || alias.direction === 'income',
      '历史分类收支类型不正确',
    );
    const category = categories.get(alias.categoryId);
    requireValue(
      category &&
        category.parentId !== null &&
        category.bookId === alias.bookId &&
        category.direction === alias.direction,
      '历史分类目标无效',
    );
    const key = categoryPathKey(
      alias.bookId,
      alias.direction,
      alias.primaryName,
      alias.secondaryName,
    );
    requireValue(!aliasKeys.has(key), '历史分类路径重复');
    aliasKeys.add(key);
    requireValue(
      !fullPaths.has(key) || fullPaths.get(key) === alias.categoryId,
      '历史分类路径与当前分类冲突',
    );
  }

  const importedSourceKeys = new Set<string>();
  for (const batch of value.imports) {
    record(batch, '导入批次');
    identifier(batch.id, '导入批次标识');
    identifier(batch.bookId, '导入目标账本');
    requireValue(books.has(batch.bookId), '导入目标账本不存在');
    requireValue(
      typeof batch.digest === 'string' && /^[a-f0-9]{64}$/i.test(batch.digest),
      '导入文件摘要格式不正确',
    );
    string(batch.fileName, '导入文件名', 512);
    timestamp(batch.importedAt, '导入时间');
    for (const field of ['totalRows', 'importedRows', 'skippedRows', 'rejectedRows'] as const) {
      requireValue(
        Number.isSafeInteger(batch[field]) && (batch[field] as number) >= 0,
        '导入行数不正确',
      );
    }
    requireValue(
      (batch.importedRows as number) +
        (batch.skippedRows as number) +
        (batch.rejectedRows as number) ===
        batch.totalRows,
      '导入行数不平衡',
    );
    list(batch.transactionIds, '导入流水标识', MAX_TRANSACTIONS);
    requireValue(batch.transactionIds.length === batch.importedRows, '导入流水数量不匹配');
    const ids = new Set<string>();
    for (const id of batch.transactionIds) {
      identifier(id, '导入流水标识');
      requireValue(!ids.has(id), '导入批次内的流水标识重复');
      ids.add(id);
    }
    if (batch.sourceRows !== undefined) {
      list(batch.sourceRows, '导入来源行', MAX_TRANSACTIONS);
      requireValue(batch.sourceRows.length === batch.importedRows, '导入来源行数量不匹配');
      const rowIds = new Set<string>();
      for (const source of batch.sourceRows) {
        record(source, '导入来源行');
        string(source.sheet, '来源工作表', 255);
        requireValue(
          Number.isSafeInteger(source.row) && (source.row as number) >= 1,
          '来源行号不正确',
        );
        identifier(source.transactionId, '导入来源流水');
        requireValue(
          ids.has(source.transactionId) && !rowIds.has(source.transactionId),
          '来源行与导入流水不一致',
        );
        rowIds.add(source.transactionId);
        const key = JSON.stringify([batch.bookId, batch.digest, source.sheet, source.row]);
        requireValue(!importedSourceKeys.has(key), '同一文件来源行已经导入');
        importedSourceKeys.add(key);
      }
    }
  }
  const batches = distinctIds(state.imports, '导入批次');
  const batchTransactionIds = new Map(
    state.imports.map((batch) => [batch.id, new Set(batch.transactionIds)]),
  );
  const batchSourceById = new Map(
    state.imports.map((batch) => [
      batch.id,
      new Map((batch.sourceRows ?? []).map((source) => [source.transactionId, source])),
    ]),
  );
  const sourceRows = new Set<string>();
  for (const transaction of value.transactions) {
    record(transaction, '流水');
    identifier(transaction.id, '流水标识');
    identifier(transaction.bookId, '流水所属账本');
    identifier(transaction.accountId, '流水账户');
    requireValue(books.has(transaction.bookId), '流水所属账本不存在');
    const account = accounts.get(transaction.accountId);
    requireValue(account && account.bookId === transaction.bookId, '流水账户不属于该账本');
    requireValue(
      ['expense', 'income', 'transfer'].includes(transaction.direction as string),
      '流水类型不正确',
    );
    moneyValue(transaction.amountCents, '流水金额');
    requireValue(isValidDate(transaction.date), '流水日期不正确');
    if (transaction.time !== undefined)
      requireValue(isValidTime(transaction.time), '流水时间不正确');
    string(transaction.note, '流水备注', 20_000, true);
    timestamp(transaction.createdAt, '流水创建时间');
    timestamp(transaction.updatedAt, '流水修改时间');
    if (transaction.direction === 'transfer') {
      requireValue(transaction.categoryId === null, '转账不能关联收支分类');
      identifier(transaction.toAccountId, '转入账户');
      const destination = accounts.get(transaction.toAccountId);
      requireValue(
        destination && destination.bookId === transaction.bookId && destination.id !== account.id,
        '转入账户必须是同账本的另一个账户',
      );
    } else {
      requireValue(transaction.toAccountId === null, '普通收支不能包含转入账户');
      identifier(transaction.categoryId, '流水分类');
      const category = categories.get(transaction.categoryId);
      requireValue(
        category &&
          category.parentId !== null &&
          category.bookId === transaction.bookId &&
          category.direction === transaction.direction,
        '流水必须关联同账本、同收支类型的二级分类',
      );
    }
    if (transaction.source !== undefined) {
      record(transaction.source, '流水来源');
      identifier(transaction.source.batchId, '来源批次');
      string(transaction.source.sheet, '来源工作表', 255);
      requireValue(
        Number.isSafeInteger(transaction.source.row) && (transaction.source.row as number) >= 1,
        '来源行号不正确',
      );
      if (transaction.source.rawDate !== undefined) {
        if (typeof transaction.source.rawDate === 'number')
          requireValue(Number.isFinite(transaction.source.rawDate), '原始日期表示不正确');
        else string(transaction.source.rawDate, '原始日期表示', 256, true);
      }
      const batch = batches.get(transaction.source.batchId);
      requireValue(
        batch &&
          batch.bookId === transaction.bookId &&
          batchTransactionIds.get(batch.id)!.has(transaction.id),
        '流水来源批次无效',
      );
      if (batch?.sourceRows) {
        const imported = batchSourceById.get(batch.id)?.get(transaction.id);
        requireValue(
          imported &&
            imported.sheet === transaction.source.sheet &&
            imported.row === transaction.source.row,
          '流水来源与批次行号不一致',
        );
      }
      const key = JSON.stringify([
        transaction.source.batchId,
        transaction.source.sheet,
        transaction.source.row,
      ]);
      requireValue(!sourceRows.has(key), '同一导入批次的来源行重复');
      sourceRows.add(key);
    }
  }
  distinctIds(state.transactions, '流水');
  const transactionMap = new Map(
    state.transactions.map((transaction) => [transaction.id, transaction]),
  );
  for (const batch of state.imports) {
    for (const id of batch.transactionIds) {
      const transaction = transactionMap.get(id);
      requireValue(
        !transaction ||
          (transaction.bookId === batch.bookId && transaction.source?.batchId === batch.id),
        '导入记录与流水来源不一致',
      );
    }
  }

  const budgetKeys = new Set<string>();
  for (const budget of value.budgets) {
    record(budget, '预算');
    identifier(budget.id, '预算标识');
    identifier(budget.bookId, '预算所属账本');
    requireValue(books.has(budget.bookId) && isValidMonth(budget.month), '预算账本或月份不正确');
    moneyValue(budget.amountCents, '预算金额');
    requireValue(
      budget.categoryId === null || typeof budget.categoryId === 'string',
      '预算分类不正确',
    );
    if (typeof budget.categoryId === 'string') {
      const category = categories.get(budget.categoryId);
      requireValue(
        category && category.bookId === budget.bookId && category.direction === 'expense',
        '预算只能关联本账本的支出分类',
      );
    }
    const key = JSON.stringify([budget.bookId, budget.month, budget.categoryId]);
    requireValue(!budgetKeys.has(key), '同一范围预算重复');
    budgetKeys.add(key);
  }
  distinctIds(state.budgets, '预算');
  const templateNames = new Set<string>();
  for (const template of value.templates) {
    record(template, '模板');
    identifier(template.id, '模板标识');
    identifier(template.bookId, '模板所属账本');
    name(template.name, '模板名称');
    identifier(template.accountId, '模板账户');
    identifier(template.categoryId, '模板分类');
    requireValue(
      template.direction === 'expense' || template.direction === 'income',
      '模板收支类型不正确',
    );
    const account = accounts.get(template.accountId);
    const category = categories.get(template.categoryId);
    requireValue(
      account?.bookId === template.bookId &&
        category?.bookId === template.bookId &&
        category.parentId !== null &&
        category.direction === template.direction,
      '模板账户或分类关系不正确',
    );
    if (template.amountCents !== null) moneyValue(template.amountCents, '模板金额');
    string(template.note, '模板备注', 20_000, true);
    const key = JSON.stringify([template.bookId, template.name]);
    requireValue(!templateNames.has(key), '同一账本模板名称重复');
    templateNames.add(key);
  }
  distinctIds(state.templates, '模板');
}
