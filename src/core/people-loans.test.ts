import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  activeMembers,
  activeLoanPeople,
  bookBalance,
  budgetProgress,
  createBook,
  createCategoryPath,
  createEmptyState,
  ensureIncomeCategoryDraft,
  ensureLoanPersonDraft,
  ensureMemberDraft,
  filterTransactions,
  loanPeopleTotals,
  loanTotals,
  migrateState,
  renameLoanPerson,
  renameMember,
  reorderLoanPeople,
  reorderMembers,
  setBudget,
  setLoanPersonArchived,
  setMemberArchived,
  transactionTotals,
  upsertLoanPerson,
  upsertMember,
  upsertTemplate,
  upsertTransaction,
  validateState,
  withLedgerDraft,
  type LoanType,
  type Transaction,
} from './index';
import { decodeBackup, encodeBackup } from '../backup/codec';
import { legacyV1Fixture } from './testing/v1-fixture';

const NOW = '2026-11-08T02:00:00.000Z';
function setup() {
  let sequence = 0;
  const context = { idFactory: () => `v2-fictional-${++sequence}`, now: () => NOW };
  let state = createEmptyState(context);
  const bookId = state.books[0].id;
  const accountId = state.accounts[0].id;
  const category = createCategoryPath(
    state,
    { bookId, direction: 'expense', primaryName: '餐饮', secondaryName: '早餐' },
    context,
  );
  state = category.state;
  return { state, context, bookId, accountId, categoryId: category.categoryId };
}

describe('稳定成员与联系人身份', () => {
  it('新记账默认自己；改名、归档和再次导入旧名字都不改变历史成员ID', () => {
    const { state: start, context, bookId, accountId, categoryId } = setup();
    let state = upsertTransaction(
      start,
      { bookId, accountId, categoryId, direction: 'expense', amountCents: 10, date: '2026-11-08' },
      context,
    );
    expect(state.transactions[0].memberId).toBe(start.members[0].id);
    const member = upsertMember(state, { bookId, name: '虚构家人' }, context);
    state = member.state;
    state = upsertTransaction(
      state,
      {
        bookId,
        accountId,
        categoryId,
        memberId: member.memberId,
        direction: 'expense',
        amountCents: 20,
        date: '2026-11-08',
      },
      context,
    );
    state = renameMember(state, member.memberId, '虚构同行者');
    expect(filterTransactions(state, { memberId: member.memberId })).toHaveLength(1);
    state = withLedgerDraft(state, (draft) => {
      expect(ensureMemberDraft(draft, bookId, '虚构家人', context).id).toBe(member.memberId);
    });
    expect(state.members).toHaveLength(2);
    state = setMemberArchived(state, member.memberId, true);
    expect(activeMembers(state, bookId).some((item) => item.id === member.memberId)).toBe(false);
    expect(filterTransactions(state, { search: '虚构同行者' })).toHaveLength(1);
    expect(() =>
      upsertTransaction(
        state,
        {
          bookId,
          accountId,
          categoryId,
          memberId: member.memberId,
          direction: 'expense',
          amountCents: 1,
          date: '2026-11-08',
        },
        context,
      ),
    ).toThrow();
    expect(() => setMemberArchived(state, start.members[0].id, true)).toThrow();
  });

  it('同名成员/联系人跨账本独立，别名和排序不串账本', () => {
    const { state: start, context, bookId } = setup();
    let state = upsertMember(start, { bookId, name: '朋友' }, context).state;
    state = upsertLoanPerson(state, { bookId, name: '朋友' }, context).state;
    const second = createBook(state, '虚构第二本', context);
    state = second.state;
    state = upsertMember(state, { bookId: second.bookId, name: '朋友' }, context).state;
    state = upsertLoanPerson(state, { bookId: second.bookId, name: '朋友' }, context).state;
    expect(state.members.filter((item) => item.name === '朋友')).toHaveLength(2);
    expect(state.loanPeople.filter((item) => item.name === '朋友')).toHaveLength(2);
    const own = activeMembers(state, bookId);
    state = reorderMembers(state, bookId, own.map((item) => item.id).reverse());
    expect(activeMembers(state, bookId)[0].name).toBe('朋友');
    expect(() =>
      reorderMembers(state, bookId, [
        state.members.find((item) => item.bookId === second.bookId)!.id,
      ]),
    ).toThrow();
    expect(() =>
      reorderLoanPeople(state, bookId, [
        state.loanPeople.find((item) => item.bookId === second.bookId)!.id,
      ]),
    ).toThrow();
  });

  it('迁移后的普通编辑保留未指定成员和时间；新模板默认自己、旧模板保持未知', () => {
    let state = migrateState(legacyV1Fixture());
    const old = state.transactions[0];
    state = upsertTransaction(state, {
      id: old.id,
      bookId: old.bookId,
      accountId: old.accountId,
      categoryId: old.categoryId,
      direction: old.direction,
      amountCents: 1500,
      date: old.date,
    });
    expect(state.transactions[0]).toMatchObject({ memberId: old.memberId, time: old.time });
    expect(state.members.find((item) => item.id === old.memberId)?.kind).toBe('unspecified');
    const template = state.templates[0];
    state = upsertTemplate(state, { ...template, memberId: undefined, name: '旧模板改名' });
    expect(state.templates[0].memberId).toBe(template.memberId);
    state = upsertTemplate(state, {
      bookId: old.bookId,
      name: '新模板',
      direction: 'expense',
      categoryId: old.categoryId!,
      accountId: old.accountId,
      amountCents: 2000,
      note: '',
    });
    expect(state.members.find((item) => item.id === state.templates[1].memberId)?.kind).toBe(
      'self',
    );
  });

  it('原版单层收入映射到稳定隐藏父分类，重复初始化复用ID', () => {
    const { state: start, context, bookId } = setup();
    let first = '';
    const state = withLedgerDraft(start, (draft) => {
      first = ensureIncomeCategoryDraft(draft, { bookId, name: '工资' }, context).id;
      expect(ensureIncomeCategoryDraft(draft, { bookId, name: ' 工资 ' }, context).id).toBe(first);
    });
    const leaf = state.categories.find((item) => item.id === first)!;
    expect(state.categories.find((item) => item.id === leaf.parentId)?.name).toBe('收入');
    expect(leaf.name).toBe('工资');
  });
});

describe('借贷现金与待收待还规则', () => {
  it('借入71的原包观测：现金-20→51，收入0/支出20不变，借贷净额-71', () => {
    const { state: start, context, bookId, accountId, categoryId } = setup();
    let state = upsertTransaction(
      start,
      {
        bookId,
        accountId,
        categoryId,
        direction: 'expense',
        amountCents: 2000,
        date: '2026-11-07',
      },
      context,
    );
    const person = upsertLoanPerson(state, { bookId, name: 'FixtureLender' }, context);
    state = person.state;
    state = upsertTransaction(
      state,
      {
        bookId,
        accountId,
        direction: 'loan',
        loanType: 'borrow',
        personId: person.personId,
        amountCents: 7100,
        date: '2026-11-07',
      },
      context,
    );
    expect(accountBalance(state, accountId)).toBe(5100);
    expect(bookBalance(state, bookId)).toBe(5100);
    expect(transactionTotals(state.transactions)).toMatchObject({
      incomeCents: 0,
      expenseCents: 2000,
      transferCents: 0,
      loanInCents: 7100,
      loanOutCents: 0,
      loanCount: 1,
    });
    expect(loanTotals(state, { bookId })).toMatchObject({
      payableCents: 7100,
      receivableCents: 0,
      netCents: -7100,
    });
    expect(state.transactions[1]).toMatchObject({
      memberId: null,
      categoryId: null,
      toAccountId: null,
    });
  });

  it('复现原包四类借贷现金轨迹，普通收支和预算保持不变', () => {
    const { state: start, context, bookId, accountId, categoryId } = setup();
    let state = upsertTransaction(
      start,
      {
        bookId,
        accountId,
        categoryId,
        direction: 'expense',
        amountCents: 2000,
        date: '2026-11-06',
      },
      context,
    );
    const person = upsertLoanPerson(state, { bookId, name: '虚构联系人甲' }, context);
    state = person.state;
    for (const [loanType, amountCents, cash, net] of [
      ['borrow', 7100, 5100, -7100],
      ['lend', 1300, 3800, -5800],
      ['repay', 1100, 2700, -4700],
      ['collect', 700, 3400, -5400],
    ] as [LoanType, number, number, number][]) {
      state = upsertTransaction(
        state,
        {
          bookId,
          accountId,
          direction: 'loan',
          loanType,
          personId: person.personId,
          amountCents,
          date: '2026-11-07',
        },
        context,
      );
      expect(accountBalance(state, accountId)).toBe(cash);
      expect(loanTotals(state, { bookId }).netCents).toBe(net);
      expect(transactionTotals(state.transactions)).toMatchObject({
        incomeCents: 0,
        expenseCents: 2000,
      });
    }
    expect(accountBalance(state, accountId)).toBe(3400);
    expect(bookBalance(state, bookId, '2026-11-06')).toBe(-2000);
    expect(loanTotals(state, { bookId })).toEqual({
      borrowedCents: 7100,
      lentCents: 1300,
      repaidCents: 1100,
      collectedCents: 700,
      receivableCents: 600,
      payableCents: 6000,
      netCents: -5400,
      cashInCents: 7800,
      cashOutCents: 2400,
      count: 4,
    });
    expect(transactionTotals(state.transactions)).toMatchObject({
      incomeCents: 0,
      expenseCents: 2000,
      transferCents: 0,
      loanCount: 4,
    });
    state = setBudget(
      state,
      { bookId, month: '2026-11', categoryId: null, amountCents: 10000 },
      context,
    );
    expect(budgetProgress(state, state.budgets[0].id).spentCents).toBe(2000);
    state = renameLoanPerson(state, person.personId, '虚构联系人新名');
    state = withLedgerDraft(state, (draft) => {
      expect(ensureLoanPersonDraft(draft, bookId, '虚构联系人甲', context).id).toBe(
        person.personId,
      );
    });
    state = setLoanPersonArchived(state, person.personId, true);
    expect(activeLoanPeople(state, bookId)).toHaveLength(0);
    expect(loanPeopleTotals(state, { bookId })[0]).toMatchObject({
      name: '虚构联系人新名',
      archived: true,
      receivableCents: 600,
      payableCents: 6000,
      count: 4,
    });
    expect(
      filterTransactions(state, { search: '虚构联系人新名', loanType: 'borrow' }),
    ).toHaveLength(1);
  });

  it('只有还款/收款的部分期间保留负净额，不伪造此前借贷', () => {
    const { state: start, context, bookId, accountId } = setup();
    const person = upsertLoanPerson(start, { bookId, name: '虚构期间联系人' }, context);
    const state = upsertTransaction(
      person.state,
      {
        bookId,
        accountId,
        direction: 'loan',
        loanType: 'repay',
        personId: person.personId,
        amountCents: 300,
        date: '2026-11-08',
      },
      context,
    );
    expect(loanTotals(state, { bookId })).toMatchObject({
      payableCents: -300,
      receivableCents: 0,
      netCents: 300,
    });
    expect(state.transactions).toHaveLength(1);
  });

  it('不同联系人的待收待还分别保留，不用总净额覆盖个人余额', () => {
    const { state: start, context, bookId, accountId } = setup();
    const first = upsertLoanPerson(start, { bookId, name: '虚构借款人' }, context);
    const second = upsertLoanPerson(first.state, { bookId, name: '虚构出借人' }, context);
    let state = upsertTransaction(
      second.state,
      {
        bookId,
        accountId,
        direction: 'loan',
        loanType: 'lend',
        personId: first.personId,
        amountCents: 1300,
        date: '2026-11-08',
      },
      context,
    );
    state = upsertTransaction(
      state,
      {
        bookId,
        accountId,
        direction: 'loan',
        loanType: 'borrow',
        personId: second.personId,
        amountCents: 7100,
        date: '2026-11-08',
      },
      context,
    );
    expect(
      loanPeopleTotals(state, { bookId }).find((item) => item.personId === first.personId),
    ).toMatchObject({ receivableCents: 1300, payableCents: 0, netCents: 1300 });
    expect(
      loanPeopleTotals(state, { bookId }).find((item) => item.personId === second.personId),
    ).toMatchObject({ receivableCents: 0, payableCents: 7100, netCents: -7100 });
    expect(loanTotals(state, { bookId }).netCents).toBe(-5800);
    expect(state.transactions).toHaveLength(2);
  });

  it('严格拒绝跨账本人员/错误借贷类型；转账类型原文编辑时保留', () => {
    const { state: start, context, bookId, accountId, categoryId } = setup();
    const other = createBook(start, '另一虚构账本', context);
    const person = upsertLoanPerson(other.state, { bookId: other.bookId, name: '其他人' }, context);
    expect(() =>
      upsertTransaction(
        person.state,
        {
          bookId,
          accountId,
          direction: 'loan',
          loanType: 'borrow',
          personId: person.personId,
          amountCents: 100,
          date: '2026-11-08',
        },
        context,
      ),
    ).toThrow();
    expect(() =>
      upsertTransaction(
        person.state,
        {
          bookId,
          accountId,
          direction: 'expense',
          categoryId,
          memberId: null,
          amountCents: 100,
          date: '2026-11-08',
        },
        context,
      ),
    ).toThrow();
    const legacy = migrateState(legacyV1Fixture());
    const transfer = legacy.transactions.find((item) => item.direction === 'transfer')!;
    let next = upsertTransaction(legacy, { ...transfer, transferType: '原版虚构转账类型' });
    next = upsertTransaction(next, { ...transfer, amountCents: 1234 });
    expect(next.transactions.find((item) => item.id === transfer.id)?.transferType).toBe(
      '原版虚构转账类型',
    );
    const malformed = structuredClone(next);
    malformed.transactions[0].transferType = '不适用';
    expect(() => validateState(malformed)).toThrow();
  });

  it('v2备份完全保留成员与借贷关系，借贷不伪装成转账摘要', async () => {
    const { state: start, context, bookId, accountId } = setup();
    const person = upsertLoanPerson(start, { bookId, name: '虚构备份联系人' }, context);
    const state = upsertTransaction(
      person.state,
      {
        bookId,
        accountId,
        direction: 'loan',
        loanType: 'borrow',
        personId: person.personId,
        amountCents: 7100,
        date: '2026-11-08',
      },
      context,
    );
    const result = await decodeBackup(await encodeBackup(state));
    expect(result.state).toEqual(state);
    expect(result.metadata.summary).toMatchObject({
      members: 1,
      loanPeople: 1,
      loanCount: 1,
      transferCents: 0,
      loanInCents: 7100,
      loanOutCents: 0,
    });
  });
});
