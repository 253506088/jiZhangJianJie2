import {
  LedgerError,
  makeId,
  normalizeName,
  nowIso,
  validateState,
  type CommandContext,
  type LedgerState,
  type LoanPerson,
  type Member,
} from './model';

function nameOf(value: string): string {
  if (typeof value !== 'string') throw new LedgerError('名称格式不正确');
  const name = normalizeName(value);
  if (!name || name.length > 120 || name.includes('\0'))
    throw new LedgerError('名称不能为空，且最多120个字');
  return name;
}

function activeBook(state: LedgerState, bookId: string) {
  const book = state.books.find((item) => item.id === bookId);
  if (!book || book.archived) throw new LedgerError('账本不存在或已归档', 'ARCHIVED');
}

function update(state: LedgerState, operation: (draft: LedgerState) => void): LedgerState {
  validateState(state);
  const draft = structuredClone(state);
  operation(draft);
  validateState(draft);
  return draft;
}

export function ensureSelfMemberDraft(
  draft: LedgerState,
  bookId: string,
  context: CommandContext = {},
): Member {
  activeBook(draft, bookId);
  const existing = draft.members.find(
    (member) => member.bookId === bookId && member.kind === 'self',
  );
  if (existing) {
    existing.archived = false;
    return existing;
  }
  if (draft.members.some((member) => member.bookId === bookId && member.name === '自己'))
    throw new LedgerError('自己成员身份存在冲突');
  const member: Member = {
    id: makeId(context),
    bookId,
    name: '自己',
    kind: 'self',
    sortOrder: 0,
    archived: false,
    createdAt: nowIso(context),
  };
  draft.members.push(member);
  return member;
}

/** Only caller-owned drafts may be mutated. Missing imported evidence should explicitly use 未指定. */
export function ensureMemberDraft(
  draft: LedgerState,
  bookId: string,
  rawName: string,
  context: CommandContext = {},
): Member {
  activeBook(draft, bookId);
  const name = nameOf(rawName);
  const alias = draft.memberAliases.find((item) => item.bookId === bookId && item.name === name);
  let existing = alias
    ? draft.members.find((item) => item.id === alias.memberId)
    : draft.members.find((item) => item.bookId === bookId && item.name === name);
  if (!existing && name === '自己') return ensureSelfMemberDraft(draft, bookId, context);
  if (!existing && name === '未指定')
    existing = draft.members.find((item) => item.bookId === bookId && item.kind === 'unspecified');
  if (existing) {
    existing.archived = false;
    return existing;
  }
  const order = draft.members
    .filter((item) => item.bookId === bookId)
    .reduce((next, item) => Math.max(next, item.sortOrder + 1), 0);
  const member: Member = {
    id: makeId(context),
    bookId,
    name,
    kind: name === '未指定' ? 'unspecified' : 'custom',
    sortOrder: order,
    archived: false,
    createdAt: nowIso(context),
  };
  draft.members.push(member);
  return member;
}

export function ensureLoanPersonDraft(
  draft: LedgerState,
  bookId: string,
  rawName: string,
  context: CommandContext = {},
): LoanPerson {
  activeBook(draft, bookId);
  const name = nameOf(rawName);
  const alias = draft.loanPersonAliases.find(
    (item) => item.bookId === bookId && item.name === name,
  );
  const existing = alias
    ? draft.loanPeople.find((item) => item.id === alias.personId)
    : draft.loanPeople.find((item) => item.bookId === bookId && item.name === name);
  if (existing) {
    existing.archived = false;
    return existing;
  }
  const order = draft.loanPeople
    .filter((item) => item.bookId === bookId)
    .reduce((next, item) => Math.max(next, item.sortOrder + 1), 0);
  const person: LoanPerson = {
    id: makeId(context),
    bookId,
    name,
    sortOrder: order,
    archived: false,
    createdAt: nowIso(context),
  };
  draft.loanPeople.push(person);
  return person;
}

function renameMemberDraft(draft: LedgerState, member: Member, rawName: string) {
  const name = nameOf(rawName);
  if (name === member.name) return;
  if (
    draft.members.some(
      (item) => item.bookId === member.bookId && item.name === name && item.id !== member.id,
    ) ||
    draft.memberAliases.some(
      (item) => item.bookId === member.bookId && item.name === name && item.memberId !== member.id,
    )
  )
    throw new LedgerError('成员名称已存在或属于其他历史成员', 'DUPLICATE_NAME');
  if (
    !draft.memberAliases.some((item) => item.bookId === member.bookId && item.name === member.name)
  )
    draft.memberAliases.push({ bookId: member.bookId, name: member.name, memberId: member.id });
  member.name = name;
}

function renamePersonDraft(draft: LedgerState, person: LoanPerson, rawName: string) {
  const name = nameOf(rawName);
  if (name === person.name) return;
  if (
    draft.loanPeople.some(
      (item) => item.bookId === person.bookId && item.name === name && item.id !== person.id,
    ) ||
    draft.loanPersonAliases.some(
      (item) => item.bookId === person.bookId && item.name === name && item.personId !== person.id,
    )
  )
    throw new LedgerError('借贷人名称已存在或属于其他历史联系人', 'DUPLICATE_NAME');
  if (
    !draft.loanPersonAliases.some(
      (item) => item.bookId === person.bookId && item.name === person.name,
    )
  )
    draft.loanPersonAliases.push({ bookId: person.bookId, name: person.name, personId: person.id });
  person.name = name;
}

export function upsertMember(
  state: LedgerState,
  input: { id?: string; bookId: string; name: string },
  context: CommandContext = {},
) {
  let memberId = '';
  const next = update(state, (draft) => {
    activeBook(draft, input.bookId);
    if (input.id) {
      const existing = draft.members.find(
        (item) => item.id === input.id && item.bookId === input.bookId,
      );
      if (!existing) throw new LedgerError('成员不存在', 'NOT_FOUND');
      renameMemberDraft(draft, existing, input.name);
      memberId = existing.id;
    } else {
      const name = nameOf(input.name);
      if (
        draft.members.some((item) => item.bookId === input.bookId && item.name === name) ||
        draft.memberAliases.some((item) => item.bookId === input.bookId && item.name === name)
      )
        throw new LedgerError('该成员或历史名称已存在，请编辑原成员', 'DUPLICATE_NAME');
      memberId = ensureMemberDraft(draft, input.bookId, name, context).id;
    }
  });
  return { state: next, memberId };
}

export function renameMember(state: LedgerState, memberId: string, rawName: string): LedgerState {
  return update(state, (draft) => {
    const member = draft.members.find((item) => item.id === memberId);
    if (!member) throw new LedgerError('成员不存在', 'NOT_FOUND');
    activeBook(draft, member.bookId);
    renameMemberDraft(draft, member, rawName);
  });
}

export function setMemberArchived(
  state: LedgerState,
  memberId: string,
  archived: boolean,
): LedgerState {
  return update(state, (draft) => {
    const member = draft.members.find((item) => item.id === memberId);
    if (!member) throw new LedgerError('成员不存在', 'NOT_FOUND');
    activeBook(draft, member.bookId);
    if (member.kind === 'self' && archived)
      throw new LedgerError('自己成员用于新记账的默认选择，不能归档', 'DEFAULT_MEMBER');
    member.archived = archived;
  });
}

export function upsertLoanPerson(
  state: LedgerState,
  input: { id?: string; bookId: string; name: string },
  context: CommandContext = {},
) {
  let personId = '';
  const next = update(state, (draft) => {
    activeBook(draft, input.bookId);
    if (input.id) {
      const existing = draft.loanPeople.find(
        (item) => item.id === input.id && item.bookId === input.bookId,
      );
      if (!existing) throw new LedgerError('借贷联系人不存在', 'NOT_FOUND');
      renamePersonDraft(draft, existing, input.name);
      personId = existing.id;
    } else {
      const name = nameOf(input.name);
      if (
        draft.loanPeople.some((item) => item.bookId === input.bookId && item.name === name) ||
        draft.loanPersonAliases.some((item) => item.bookId === input.bookId && item.name === name)
      )
        throw new LedgerError('该联系人或历史名称已存在，请编辑原联系人', 'DUPLICATE_NAME');
      personId = ensureLoanPersonDraft(draft, input.bookId, name, context).id;
    }
  });
  return { state: next, personId };
}

export function renameLoanPerson(
  state: LedgerState,
  personId: string,
  rawName: string,
): LedgerState {
  return update(state, (draft) => {
    const person = draft.loanPeople.find((item) => item.id === personId);
    if (!person) throw new LedgerError('借贷联系人不存在', 'NOT_FOUND');
    activeBook(draft, person.bookId);
    renamePersonDraft(draft, person, rawName);
  });
}

export function setLoanPersonArchived(
  state: LedgerState,
  personId: string,
  archived: boolean,
): LedgerState {
  return update(state, (draft) => {
    const person = draft.loanPeople.find((item) => item.id === personId);
    if (!person) throw new LedgerError('借贷联系人不存在', 'NOT_FOUND');
    activeBook(draft, person.bookId);
    person.archived = archived;
  });
}

function reorder<T extends { id: string; bookId: string; sortOrder: number }>(
  items: T[],
  bookId: string,
  ids: string[],
) {
  if (new Set(ids).size !== ids.length) throw new LedgerError('排序标识重复');
  const scope = items.filter((item) => item.bookId === bookId);
  const byId = new Map(scope.map((item) => [item.id, item]));
  if (ids.some((id) => !byId.has(id))) throw new LedgerError('排序对象不属于当前账本');
  const chosen = new Set(ids);
  [
    ...ids.map((id) => byId.get(id)!),
    ...scope.filter((item) => !chosen.has(item.id)).sort((a, b) => a.sortOrder - b.sortOrder),
  ].forEach((item, index) => {
    item.sortOrder = index;
  });
}

export function reorderMembers(state: LedgerState, bookId: string, ids: string[]): LedgerState {
  return update(state, (draft) => {
    activeBook(draft, bookId);
    reorder(draft.members, bookId, ids);
  });
}

export function reorderLoanPeople(state: LedgerState, bookId: string, ids: string[]): LedgerState {
  return update(state, (draft) => {
    activeBook(draft, bookId);
    reorder(draft.loanPeople, bookId, ids);
  });
}
