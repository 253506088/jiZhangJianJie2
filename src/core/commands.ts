import {
  type Account,
  type AccountKind,
  type Book,
  type Budget,
  type Category,
  type CategoryAlias,
  type CommandContext,
  type Direction,
  type LedgerState,
  type Transaction,
  type TransactionDirection,
  type TransactionSource,
  type TransactionTemplate,
  type LoanType,
  LedgerError,
  categoryPathKey,
  makeId,
  normalizeName,
  nowIso,
  validateState,
} from './model';
import { addCents } from './money';
import { ensureSelfMemberDraft } from './people';

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new LedgerError(message, 'NOT_FOUND');
  return value;
}

function cleanName(value: string): string {
  if (typeof value !== 'string') throw new LedgerError('名称格式不正确', 'INVALID_NAME');
  const name = normalizeName(value);
  if (!name || name.length > 120 || name.includes('\0'))
    throw new LedgerError('名称不能为空，且最多 120 个字', 'INVALID_NAME');
  return name;
}

function activeBook(state: LedgerState, id: string): Book {
  const book = required(
    state.books.find((item) => item.id === id),
    '账本不存在',
  );
  if (book.archived) throw new LedgerError('请先恢复已归档的账本', 'ARCHIVED');
  return book;
}

function primaryFor(state: LedgerState, category: Category): Category {
  return category.parentId === null
    ? category
    : required(
        state.categories.find((item) => item.id === category.parentId),
        '父分类不存在',
      );
}

/** Clone once per transaction/import. The supplied draft is private until final validation succeeds. */
export function withLedgerDraft(
  state: LedgerState,
  apply: (draft: LedgerState) => void,
): LedgerState {
  validateState(state);
  const draft = structuredClone(state);
  apply(draft);
  validateState(draft);
  return draft;
}

export interface CategoryPathInput {
  bookId: string;
  direction: Direction;
  primaryName: string;
  secondaryName: string;
  icon?: string;
}

/** Mutates ONLY a caller-owned draft. Wrap bulk import in withLedgerDraft for atomic validation. */
export function ensureBookDraft(
  draft: LedgerState,
  rawName: string,
  context: CommandContext = {},
): Book {
  const name = cleanName(rawName);
  const existing = draft.books.find((book) => book.name === name);
  if (existing) {
    existing.archived = false;
    return existing;
  }
  const book: Book = {
    id: makeId(context),
    name,
    currency: 'CNY',
    archived: false,
    createdAt: nowIso(context),
  };
  draft.books.push(book);
  ensureSelfMemberDraft(draft, book.id, context);
  return book;
}

/** Same-book exact name identity; never merges separate books or adjusts an existing opening balance. */
export function ensureAccountDraft(
  draft: LedgerState,
  bookId: string,
  rawName: string,
  context: CommandContext = {},
  kind: AccountKind = 'other',
): Account {
  activeBook(draft, bookId);
  const name = cleanName(rawName);
  const existing = draft.accounts.find(
    (account) => account.bookId === bookId && account.name === name,
  );
  if (existing) {
    existing.archived = false;
    return existing;
  }
  const orders = draft.accounts
    .filter((account) => account.bookId === bookId)
    .map((account) => account.sortOrder);
  const account: Account = {
    id: makeId(context),
    bookId,
    name,
    kind,
    openingBalanceCents: 0,
    archived: false,
    sortOrder: orders.length ? Math.max(...orders) + 1 : 0,
    createdAt: nowIso(context),
  };
  draft.accounts.push(account);
  return account;
}

/** Resolves explicit historical aliases, then current full paths, before creating two usable levels. */
export function ensureCategoryPathDraft(
  draft: LedgerState,
  input: CategoryPathInput,
  context: CommandContext = {},
): Category {
  activeBook(draft, input.bookId);
  const primaryName = cleanName(input.primaryName);
  const secondaryName = cleanName(input.secondaryName);
  const key = categoryPathKey(input.bookId, input.direction, primaryName, secondaryName);
  const alias = draft.categoryAliases.find(
    (item) =>
      categoryPathKey(item.bookId, item.direction, item.primaryName, item.secondaryName) === key,
  );
  if (alias) {
    const target = required(
      draft.categories.find((item) => item.id === alias.categoryId),
      '历史分类目标不存在',
    );
    target.archived = false;
    primaryFor(draft, target).archived = false;
    return target;
  }
  let primary = draft.categories.find(
    (item) =>
      item.bookId === input.bookId &&
      item.direction === input.direction &&
      item.parentId === null &&
      item.name === primaryName,
  );
  if (!primary) {
    const peers = draft.categories.filter(
      (item) =>
        item.bookId === input.bookId &&
        item.direction === input.direction &&
        item.parentId === null,
    );
    primary = {
      id: makeId(context),
      bookId: input.bookId,
      direction: input.direction,
      parentId: null,
      name: primaryName,
      sortOrder: peers.reduce((maximum, item) => Math.max(maximum, item.sortOrder + 1), 0),
      archived: false,
      icon: input.icon ?? 'category',
    };
    draft.categories.push(primary);
  }
  primary.archived = false;
  let category = draft.categories.find(
    (item) => item.parentId === primary!.id && item.name === secondaryName,
  );
  if (!category) {
    const peers = draft.categories.filter((item) => item.parentId === primary!.id);
    category = {
      id: makeId(context),
      bookId: input.bookId,
      direction: input.direction,
      parentId: primary.id,
      name: secondaryName,
      sortOrder: peers.reduce((maximum, item) => Math.max(maximum, item.sortOrder + 1), 0),
      archived: false,
      icon: input.icon ?? 'category',
    };
    draft.categories.push(category);
  }
  category.archived = false;
  return category;
}

export function createCategoryPath(
  state: LedgerState,
  input: CategoryPathInput,
  context: CommandContext = {},
) {
  let categoryId = '';
  let created = false;
  const next = withLedgerDraft(state, (draft) => {
    const existingIds = new Set(draft.categories.map((item) => item.id));
    const category = ensureCategoryPathDraft(draft, input, context);
    categoryId = category.id;
    created = !existingIds.has(category.id);
  });
  return { state: next, categoryId, created };
}

/** The original export has one income category; its stable leaf uses a hidden 收入 parent. */
export function ensureIncomeCategoryDraft(
  draft: LedgerState,
  input: { bookId: string; name: string; icon?: string },
  context: CommandContext = {},
): Category {
  return ensureCategoryPathDraft(
    draft,
    {
      bookId: input.bookId,
      direction: 'income',
      primaryName: '收入',
      secondaryName: input.name,
      ...(input.icon ? { icon: input.icon } : {}),
    },
    context,
  );
}

export function createPrimaryCategory(
  state: LedgerState,
  input: { bookId: string; direction: Direction; name: string; icon?: string },
  context: CommandContext = {},
) {
  let categoryId = '';
  const next = withLedgerDraft(state, (draft) => {
    activeBook(draft, input.bookId);
    const name = cleanName(input.name);
    if (
      draft.categories.some(
        (item) =>
          item.bookId === input.bookId &&
          item.direction === input.direction &&
          item.parentId === null &&
          item.name === name,
      )
    )
      throw new LedgerError('一级分类名称已存在', 'DUPLICATE_PATH');
    const peers = draft.categories.filter(
      (item) =>
        item.bookId === input.bookId &&
        item.direction === input.direction &&
        item.parentId === null,
    );
    categoryId = makeId(context);
    draft.categories.push({
      id: categoryId,
      bookId: input.bookId,
      direction: input.direction,
      parentId: null,
      name,
      sortOrder: peers.reduce((maximum, item) => Math.max(maximum, item.sortOrder + 1), 0),
      archived: false,
      icon: input.icon ?? 'category',
    });
  });
  return { state: next, categoryId };
}

function aliasDraft(draft: LedgerState, alias: CategoryAlias) {
  const key = categoryPathKey(
    alias.bookId,
    alias.direction,
    alias.primaryName,
    alias.secondaryName,
  );
  const previous = draft.categoryAliases.find(
    (item) =>
      categoryPathKey(item.bookId, item.direction, item.primaryName, item.secondaryName) === key,
  );
  if (previous && previous.categoryId !== alias.categoryId)
    throw new LedgerError('该历史分类路径已关联其他分类', 'DUPLICATE_PATH');
  if (!previous) draft.categoryAliases.push(alias);
}

function rememberPath(draft: LedgerState, category: Category, destinationId = category.id) {
  if (category.parentId === null) return;
  aliasDraft(draft, {
    bookId: category.bookId,
    direction: category.direction,
    primaryName: primaryFor(draft, category).name,
    secondaryName: category.name,
    categoryId: destinationId,
  });
}

export function renameCategory(
  state: LedgerState,
  categoryId: string,
  rawName: string,
): LedgerState {
  return withLedgerDraft(state, (draft) => {
    const category = required(
      draft.categories.find((item) => item.id === categoryId),
      '分类不存在',
    );
    activeBook(draft, category.bookId);
    const name = cleanName(rawName);
    if (name === category.name) return;
    if (
      draft.categories.some(
        (item) =>
          item.id !== categoryId &&
          item.bookId === category.bookId &&
          item.direction === category.direction &&
          item.parentId === category.parentId &&
          item.name === name,
      )
    )
      throw new LedgerError('同名分类已存在，请使用合并功能', 'DUPLICATE_PATH');
    if (category.parentId === null) {
      for (const child of draft.categories.filter((item) => item.parentId === category.id))
        rememberPath(draft, child);
    } else rememberPath(draft, category);
    category.name = name;
  });
}

function coalesceBudgets(draft: LedgerState) {
  const merged = new Map<string, Budget>();
  for (const budget of draft.budgets) {
    const key = JSON.stringify([budget.bookId, budget.month, budget.categoryId]);
    const existing = merged.get(key);
    if (existing) existing.amountCents = addCents(existing.amountCents, budget.amountCents);
    else merged.set(key, budget);
  }
  draft.budgets = [...merged.values()];
}

function mergeLeafDraft(draft: LedgerState, source: Category, target: Category) {
  // Retarget old aliases before recording the source's current name.
  for (const alias of draft.categoryAliases)
    if (alias.categoryId === source.id) alias.categoryId = target.id;
  rememberPath(draft, source, target.id);
  for (const transaction of draft.transactions)
    if (transaction.categoryId === source.id) transaction.categoryId = target.id;
  for (const template of draft.templates)
    if (template.categoryId === source.id) template.categoryId = target.id;
  for (const budget of draft.budgets)
    if (budget.categoryId === source.id) budget.categoryId = target.id;
  draft.categories = draft.categories.filter((item) => item.id !== source.id);
  target.archived = false;
  primaryFor(draft, target).archived = false;
}

/** Explicit user-selected merge. Matching names alone never invoke this operation. */
export function mergeCategories(
  state: LedgerState,
  sourceId: string,
  targetId: string,
): LedgerState {
  return withLedgerDraft(state, (draft) => {
    if (sourceId === targetId) throw new LedgerError('不能合并到分类自身', 'INVALID_MERGE');
    const source = required(
      draft.categories.find((item) => item.id === sourceId),
      '源分类不存在',
    );
    const target = required(
      draft.categories.find((item) => item.id === targetId),
      '目标分类不存在',
    );
    activeBook(draft, source.bookId);
    if (
      source.bookId !== target.bookId ||
      source.direction !== target.direction ||
      (source.parentId === null) !== (target.parentId === null)
    )
      throw new LedgerError('只能合并同账本、同收支类型、同层级的分类', 'INVALID_MERGE');
    if (source.parentId !== null) mergeLeafDraft(draft, source, target);
    else {
      for (const child of draft.categories.filter((item) => item.parentId === source.id)) {
        const existing = draft.categories.find(
          (item) => item.parentId === target.id && item.name === child.name,
        );
        if (existing) mergeLeafDraft(draft, child, existing);
        else {
          rememberPath(draft, child);
          child.parentId = target.id;
        }
      }
      for (const budget of draft.budgets)
        if (budget.categoryId === source.id) budget.categoryId = target.id;
      draft.categories = draft.categories.filter((item) => item.id !== source.id);
      target.archived = false;
    }
    coalesceBudgets(draft);
  });
}

export function setCategoryArchived(
  state: LedgerState,
  categoryId: string,
  archived: boolean,
): LedgerState {
  return withLedgerDraft(state, (draft) => {
    const category = required(
      draft.categories.find((item) => item.id === categoryId),
      '分类不存在',
    );
    activeBook(draft, category.bookId);
    category.archived = archived;
    if (category.parentId === null && archived)
      for (const child of draft.categories.filter((item) => item.parentId === category.id))
        child.archived = true;
    if (category.parentId !== null && !archived) primaryFor(draft, category).archived = false;
  });
}

export function reorderCategories(state: LedgerState, categoryIds: string[]): LedgerState {
  return withLedgerDraft(state, (draft) => {
    if (new Set(categoryIds).size !== categoryIds.length)
      throw new LedgerError('分类排序中有重复标识');
    const ordered = categoryIds.map((id) =>
      required(
        draft.categories.find((item) => item.id === id),
        '排序分类不存在',
      ),
    );
    const first = ordered[0];
    if (!first) return;
    activeBook(draft, first.bookId);
    if (
      ordered.some(
        (item) =>
          item.bookId !== first.bookId ||
          item.direction !== first.direction ||
          item.parentId !== first.parentId,
      )
    )
      throw new LedgerError('只能在同一层级内排序');
    ordered.forEach((category, index) => {
      category.sortOrder = index;
    });
  });
}

export function setCategoryIcon(state: LedgerState, categoryId: string, icon: string): LedgerState {
  return withLedgerDraft(state, (draft) => {
    const category = required(
      draft.categories.find((item) => item.id === categoryId),
      '分类不存在',
    );
    activeBook(draft, category.bookId);
    category.icon = icon;
  });
}

export interface TransactionInput {
  id?: string;
  bookId: string;
  direction: TransactionDirection;
  amountCents: number;
  date: string;
  /** Undefined preserves existing time on edit; null explicitly clears it. */
  time?: string | null;
  accountId: string;
  categoryId?: string | null;
  toAccountId?: string | null;
  memberId?: string | null;
  loanType?: LoanType | null;
  personId?: string | null;
  /** Undefined preserves a transfer's original label; null clears it explicitly. */
  transferType?: string | null;
  note?: string;
  source?: TransactionSource;
}

/** An existing identity is edited; content-identical new identities remain separate records. */
export function upsertTransaction(
  state: LedgerState,
  input: TransactionInput,
  context: CommandContext = {},
): LedgerState {
  return withLedgerDraft(state, (draft) => {
    activeBook(draft, input.bookId);
    const existing = input.id ? draft.transactions.find((item) => item.id === input.id) : undefined;
    const account = required(
      draft.accounts.find((item) => item.id === input.accountId && item.bookId === input.bookId),
      '账户不属于当前账本',
    );
    if (account.archived && existing?.accountId !== account.id)
      throw new LedgerError('不能使用已归档的账户新增记账', 'ARCHIVED');
    if (input.direction === 'expense' || input.direction === 'income') {
      const category = required(
        draft.categories.find(
          (item) =>
            item.id === input.categoryId &&
            item.bookId === input.bookId &&
            item.direction === input.direction &&
            item.parentId !== null,
        ),
        '请选择当前收支类型的二级分类',
      );
      if (
        (category.archived || primaryFor(draft, category).archived) &&
        existing?.categoryId !== category.id
      )
        throw new LedgerError('不能使用已归档的分类新增记账', 'ARCHIVED');
    } else if (input.direction === 'transfer') {
      const destination = required(
        draft.accounts.find(
          (item) => item.id === input.toAccountId && item.bookId === input.bookId,
        ),
        '转入账户不属于当前账本',
      );
      if (destination.archived && existing?.toAccountId !== destination.id)
        throw new LedgerError('不能转入已归档的账户', 'ARCHIVED');
    }
    const sameBook = existing?.bookId === input.bookId;
    let memberId: string | null = null;
    let personId: string | null = null;
    let loanType: LoanType | null = null;
    if (input.direction === 'loan') {
      personId =
        input.personId === undefined && sameBook && existing?.direction === 'loan'
          ? existing.personId
          : (input.personId ?? null);
      loanType =
        input.loanType === undefined && existing?.direction === 'loan'
          ? existing.loanType
          : (input.loanType ?? null);
      const person = required(
        draft.loanPeople.find((item) => item.id === personId && item.bookId === input.bookId),
        '请选择当前账本的借贷人',
      );
      if (person.archived && existing?.personId !== person.id)
        throw new LedgerError('不能使用已归档的联系人新增借贷', 'ARCHIVED');
      if (!loanType) throw new LedgerError('请选择借入、借出、还款或收款');
    } else {
      if (input.memberId === null)
        throw new LedgerError('请明确选择成员；缺少来源信息时使用未指定成员');
      memberId =
        input.memberId === undefined && sameBook && existing?.memberId
          ? existing.memberId
          : (input.memberId ?? ensureSelfMemberDraft(draft, input.bookId, context).id);
      const member = required(
        draft.members.find((item) => item.id === memberId && item.bookId === input.bookId),
        '成员不属于当前账本',
      );
      if (member.archived && existing?.memberId !== member.id)
        throw new LedgerError('不能使用已归档的成员新增记账', 'ARCHIVED');
    }
    const now = nowIso(context);
    const time = input.time === undefined ? existing?.time : input.time;
    const source = input.source ?? existing?.source;
    const transferType =
      input.direction === 'transfer'
        ? input.transferType === undefined && existing?.direction === 'transfer'
          ? existing.transferType
          : input.transferType
        : undefined;
    const transaction: Transaction = {
      id: existing?.id ?? input.id ?? makeId(context),
      bookId: input.bookId,
      direction: input.direction,
      amountCents: input.amountCents,
      date: input.date,
      accountId: input.accountId,
      categoryId:
        input.direction === 'transfer' || input.direction === 'loan'
          ? null
          : (input.categoryId ?? null),
      toAccountId: input.direction === 'transfer' ? (input.toAccountId ?? null) : null,
      memberId,
      personId,
      loanType,
      note: input.note ?? existing?.note ?? '',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(time !== undefined && time !== null ? { time } : {}),
      ...(source ? { source: structuredClone(source) } : {}),
      ...(transferType !== undefined && transferType !== null ? { transferType } : {}),
    };
    if (existing) draft.transactions[draft.transactions.indexOf(existing)] = transaction;
    else draft.transactions.push(transaction);
  });
}

export function removeTransaction(state: LedgerState, transactionId: string): LedgerState {
  return withLedgerDraft(state, (draft) => {
    required(
      draft.transactions.find((item) => item.id === transactionId),
      '流水不存在',
    );
    draft.transactions = draft.transactions.filter((item) => item.id !== transactionId);
  });
}

export function createBook(state: LedgerState, rawName: string, context: CommandContext = {}) {
  let bookId = '';
  const next = withLedgerDraft(state, (draft) => {
    const name = cleanName(rawName);
    if (draft.books.some((book) => book.name === name))
      throw new LedgerError('账本名称已存在', 'DUPLICATE_NAME');
    const book = ensureBookDraft(draft, name, context);
    bookId = book.id;
    ensureAccountDraft(draft, book.id, '现金', context, 'cash');
    draft.settings.selectedBookId = book.id;
  });
  return { state: next, bookId };
}

export function renameBook(state: LedgerState, bookId: string, rawName: string): LedgerState {
  return withLedgerDraft(state, (draft) => {
    const book = required(
      draft.books.find((item) => item.id === bookId),
      '账本不存在',
    );
    book.name = cleanName(rawName);
  });
}

export function setBookArchived(
  state: LedgerState,
  bookId: string,
  archived: boolean,
): LedgerState {
  return withLedgerDraft(state, (draft) => {
    const book = required(
      draft.books.find((item) => item.id === bookId),
      '账本不存在',
    );
    book.archived = archived;
    if (archived && draft.settings.selectedBookId === bookId)
      draft.settings.selectedBookId = required(
        draft.books.find((item) => !item.archived),
        '至少保留一个启用的账本',
      ).id;
  });
}

export function upsertAccount(
  state: LedgerState,
  input: {
    id?: string;
    bookId: string;
    name: string;
    kind?: AccountKind;
    openingBalanceCents?: number;
  },
  context: CommandContext = {},
) {
  let accountId = '';
  const next = withLedgerDraft(state, (draft) => {
    activeBook(draft, input.bookId);
    const name = cleanName(input.name);
    const existing = input.id
      ? required(
          draft.accounts.find((item) => item.id === input.id && item.bookId === input.bookId),
          '账户不存在',
        )
      : undefined;
    if (
      draft.accounts.some(
        (item) => item.bookId === input.bookId && item.name === name && item.id !== existing?.id,
      )
    )
      throw new LedgerError('同名账户已存在', 'DUPLICATE_NAME');
    const account =
      existing ?? ensureAccountDraft(draft, input.bookId, name, context, input.kind ?? 'other');
    account.name = name;
    account.kind = input.kind ?? account.kind;
    account.openingBalanceCents = input.openingBalanceCents ?? account.openingBalanceCents;
    accountId = account.id;
  });
  return { state: next, accountId };
}

export function setAccountArchived(
  state: LedgerState,
  accountId: string,
  archived: boolean,
): LedgerState {
  return withLedgerDraft(state, (draft) => {
    const account = required(
      draft.accounts.find((item) => item.id === accountId),
      '账户不存在',
    );
    activeBook(draft, account.bookId);
    account.archived = archived;
  });
}

export function reorderAccounts(
  state: LedgerState,
  bookId: string,
  accountIds: string[],
): LedgerState {
  return withLedgerDraft(state, (draft) => {
    activeBook(draft, bookId);
    if (new Set(accountIds).size !== accountIds.length)
      throw new LedgerError('账户排序中有重复标识');
    accountIds.forEach((id, index) => {
      const account = required(
        draft.accounts.find((item) => item.id === id && item.bookId === bookId),
        '排序账户不属于当前账本',
      );
      account.sortOrder = index;
    });
  });
}

export function setBudget(
  state: LedgerState,
  input: Omit<Budget, 'id'>,
  context: CommandContext = {},
): LedgerState {
  return withLedgerDraft(state, (draft) => {
    activeBook(draft, input.bookId);
    const existing = draft.budgets.find(
      (item) =>
        item.bookId === input.bookId &&
        item.month === input.month &&
        item.categoryId === input.categoryId,
    );
    if (existing) existing.amountCents = input.amountCents;
    else draft.budgets.push({ ...input, id: makeId(context) });
  });
}

export function removeBudget(state: LedgerState, budgetId: string): LedgerState {
  return withLedgerDraft(state, (draft) => {
    required(
      draft.budgets.find((item) => item.id === budgetId),
      '预算不存在',
    );
    draft.budgets = draft.budgets.filter((item) => item.id !== budgetId);
  });
}

export function upsertTemplate(
  state: LedgerState,
  input: Omit<TransactionTemplate, 'id' | 'memberId'> & { id?: string; memberId?: string },
  context: CommandContext = {},
): LedgerState {
  return withLedgerDraft(state, (draft) => {
    activeBook(draft, input.bookId);
    const existing = input.id
      ? required(
          draft.templates.find((item) => item.id === input.id),
          '模板不存在',
        )
      : undefined;
    const account = required(
      draft.accounts.find((item) => item.id === input.accountId),
      '模板账户不存在',
    );
    const category = required(
      draft.categories.find((item) => item.id === input.categoryId),
      '模板分类不存在',
    );
    if (
      (account.archived && existing?.accountId !== account.id) ||
      ((category.archived || primaryFor(draft, category).archived) &&
        existing?.categoryId !== category.id)
    )
      throw new LedgerError('新模板不能使用已归档的账户或分类', 'ARCHIVED');
    const template: TransactionTemplate = {
      ...input,
      id: existing?.id ?? makeId(context),
      name: cleanName(input.name),
      memberId:
        input.memberId ??
        (existing?.bookId === input.bookId ? existing.memberId : undefined) ??
        ensureSelfMemberDraft(draft, input.bookId, context).id,
    };
    const member = required(
      draft.members.find((item) => item.id === template.memberId && item.bookId === input.bookId),
      '模板成员不属于该账本',
    );
    if (member.archived && existing?.memberId !== member.id)
      throw new LedgerError('新模板不能使用已归档的成员', 'ARCHIVED');
    if (existing) draft.templates[draft.templates.indexOf(existing)] = template;
    else draft.templates.push(template);
  });
}

export function removeTemplate(state: LedgerState, templateId: string): LedgerState {
  return withLedgerDraft(state, (draft) => {
    required(
      draft.templates.find((item) => item.id === templateId),
      '模板不存在',
    );
    draft.templates = draft.templates.filter((item) => item.id !== templateId);
  });
}

export function updateSettings(
  state: LedgerState,
  settings: Partial<LedgerState['settings']>,
): LedgerState {
  return withLedgerDraft(state, (draft) => {
    draft.settings = { ...draft.settings, ...settings };
  });
}
