import { useMemo, useState } from 'react';
import {
  categoryPath,
  categoryTotals,
  filterTransactions,
  formatMoney,
  transactionTotals,
  loanTotals,
  type Direction,
  type Transaction,
  type TransactionDirection,
  type LoanType,
} from '../core';
import type { PageProps, Route } from './contracts';
import { Icon } from './Icon';
import { EmptyState, MonthPicker, PageHeader, StatStrip, TransactionRows } from './shared';
import { categoryDisplayLabel, loanLabels } from './display';

export function Details({
  state,
  bookId,
  month,
  onMonth,
  route,
  onBack,
  onOpen,
}: PageProps & {
  month: string;
  onMonth: (month: string) => void;
  route: Route;
  onBack: () => void;
  onOpen: (entry: Transaction) => void;
}) {
  const [direction, setDirection] = useState<TransactionDirection | 'all'>(
    route.direction ?? 'all',
  );
  const [accountId, setAccountId] = useState(route.accountId ?? '');
  const [categoryId, setCategoryId] = useState(route.categoryId ?? '');
  const [memberId, setMemberId] = useState(route.memberId ?? '');
  const [personId, setPersonId] = useState(route.personId ?? '');
  const [loanType, setLoanType] = useState<LoanType | ''>(route.loanType ?? '');
  const [periodRange, setPeriodRange] = useState(
    route.fromDate && route.toDate
      ? { fromDate: route.fromDate, toDate: route.toDate, label: route.periodLabel }
      : null,
  );
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(100);
  const rows = useMemo(
    () =>
      filterTransactions(state, {
        bookId,
        ...(periodRange
          ? { fromDate: periodRange.fromDate, toDate: periodRange.toDate }
          : month
            ? { month }
            : {}),
        ...(accountId ? { accountId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(direction !== 'all' ? { direction } : {}),
        ...(memberId ? { memberId } : {}),
        ...(personId ? { personId } : {}),
        ...(loanType ? { loanType } : {}),
        search,
      }),
    [
      state,
      bookId,
      month,
      accountId,
      categoryId,
      direction,
      search,
      memberId,
      personId,
      loanType,
      periodRange,
    ],
  );
  const visible = rows.slice(0, pageSize);
  const dates = [...new Set(visible.map((item) => item.date))];
  const dayTotals = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    for (const row of rows) {
      const group = groups.get(row.date) ?? [];
      group.push(row);
      groups.set(row.date, group);
    }
    return new Map(
      [...groups].map(([date, transactions]) => [date, transactionTotals(transactions)]),
    );
  }, [rows]);
  const sum = transactionTotals(rows);
  const loanSummary =
    direction === 'loan'
      ? loanTotals(state, {
          bookId,
          ...(periodRange
            ? { fromDate: periodRange.fromDate, toDate: periodRange.toDate }
            : month
              ? { month }
              : {}),
          ...(accountId ? { accountId } : {}),
          ...(personId ? { personId } : {}),
          ...(loanType ? { loanType } : {}),
          search,
        })
      : null;
  const changeFilter = (action: () => void) => {
    action();
    setPageSize(100);
  };
  return (
    <section className="lj-screen">
      <PageHeader title="收支明细" onBack={onBack} />
      <div className="lj-scroll lj-page-pad">
        <MonthPicker
          value={periodRange ? periodRange.fromDate.slice(0, 7) : month}
          onChange={(value) =>
            changeFilter(() => {
              setPeriodRange(null);
              onMonth(value);
            })
          }
          allowAll
        />
        {loanSummary ? (
          <div className="lj-stat-strip lj-loan-stat-strip">
            <div>
              <span>资金流入</span>
              <strong>{formatMoney(loanSummary.cashInCents)}</strong>
            </div>
            <div>
              <span>资金流出</span>
              <strong>{formatMoney(loanSummary.cashOutCents)}</strong>
            </div>
            <div>
              <span>借贷净额</span>
              <strong>{formatMoney(loanSummary.netCents)}</strong>
            </div>
          </div>
        ) : (
          <StatStrip
            income={sum.incomeCents}
            expense={sum.expenseCents}
            balance={sum.balanceCents}
          />
        )}
        {loanSummary && (
          <p className="lj-help">
            以上只汇总当前筛选范围。借贷净额为借出未收减借入未还，不计作普通收入或支出。
          </p>
        )}
        {periodRange && (
          <button
            className="lj-filter-chip"
            onClick={() => {
              setPeriodRange(null);
              onMonth('');
            }}
          >
            {periodRange.label ?? '指定日期'} · {periodRange.fromDate} — {periodRange.toDate}
            <Icon name="close" size={14} />
          </button>
        )}
        <div className="lj-search">
          <Icon name="search" size={18} />
          <input
            aria-label="搜索流水"
            placeholder="搜索备注、分类或账户"
            value={search}
            onChange={(event) => changeFilter(() => setSearch(event.target.value))}
          />
          {search && (
            <button className="lj-icon-button" aria-label="清空搜索" onClick={() => setSearch('')}>
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
        <div className="lj-filter-row">
          <select
            aria-label="筛选账户"
            value={accountId}
            onChange={(event) => changeFilter(() => setAccountId(event.target.value))}
          >
            <option value="">全部账户</option>
            {state.accounts
              .filter((item) => item.bookId === bookId)
              .map((account) => (
                <option value={account.id} key={account.id}>
                  {account.name}
                  {account.archived ? '（已归档）' : ''}
                </option>
              ))}
          </select>
          <select
            aria-label="筛选收支类型"
            value={direction}
            onChange={(event) =>
              changeFilter(() => {
                const next = event.target.value as TransactionDirection | 'all';
                setDirection(next);
                if (next !== 'loan') {
                  setPersonId('');
                  setLoanType('');
                }
                if (next === 'loan') {
                  setMemberId('');
                  setCategoryId('');
                }
              })
            }
          >
            <option value="all">全部类型</option>
            <option value="expense">支出</option>
            <option value="income">收入</option>
            <option value="transfer">转账</option>
            <option value="loan">借贷</option>
          </select>
          <span>{rows.length} 笔</span>
        </div>
        <div className="lj-filter-row lj-people-filters">
          {direction === 'loan' ? (
            <>
              <select
                aria-label="筛选借贷人"
                value={personId}
                onChange={(event) => changeFilter(() => setPersonId(event.target.value))}
              >
                <option value="">全部借贷人</option>
                {state.loanPeople
                  .filter((person) => person.bookId === bookId)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                      {person.archived ? '（已归档）' : ''}
                    </option>
                  ))}
              </select>
              <select
                aria-label="筛选借贷类型"
                value={loanType}
                onChange={(event) =>
                  changeFilter(() => setLoanType(event.target.value as LoanType | ''))
                }
              >
                <option value="">全部借贷类型</option>
                {Object.entries(loanLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <select
              aria-label="筛选成员"
              value={memberId}
              onChange={(event) => changeFilter(() => setMemberId(event.target.value))}
            >
              <option value="">全部成员</option>
              {state.members
                .filter((member) => member.bookId === bookId)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {member.archived ? '（已归档）' : ''}
                  </option>
                ))}
            </select>
          )}
        </div>
        {categoryId && (
          <button className="lj-filter-chip" onClick={() => changeFilter(() => setCategoryId(''))}>
            {categoryDisplayLabel(state, categoryId)}
            <Icon name="close" size={14} />
          </button>
        )}
        {!rows.length && (
          <EmptyState
            title="没有找到符合条件的记录"
            text="换一个月份或筛选条件试试。"
            icon="search"
          />
        )}
        {dates.map((date) => {
          const dayRows = visible.filter((item) => item.date === date);
          const day = dayTotals.get(date)!;
          return (
            <section className="lj-day-group" key={date}>
              <div className="lj-day-heading">
                <strong>
                  {Number(date.slice(5, 7))}月{Number(date.slice(8))}日{' '}
                  <small>{date.slice(0, 4)}</small>
                </strong>
                <span>
                  {day.expenseCount ? `支 ${formatMoney(day.expenseCents)}` : ''}
                  {day.incomeCount ? ` 收 ${formatMoney(day.incomeCents)}` : ''}
                </span>
              </div>
              <TransactionRows state={state} rows={dayRows} onOpen={onOpen} />
            </section>
          );
        })}
        {rows.length > visible.length && (
          <button
            className="lj-secondary lj-load-more"
            onClick={() => setPageSize((size) => size + 100)}
          >
            继续显示 {Math.min(100, rows.length - visible.length)} 笔
          </button>
        )}
        <p className="lj-help">转账与借贷单独记录，不计入普通收入与支出。成员和借贷人分开筛选。</p>
      </div>
    </section>
  );
}

export function Reports({
  state,
  bookId,
  month,
  onMonth,
  onBack,
  onDrill,
}: PageProps & {
  month: string;
  onMonth: (month: string) => void;
  onBack: () => void;
  onDrill: (route: Route) => void;
}) {
  const [direction, setDirection] = useState<Direction>('expense');
  const [level, setLevel] = useState<'primary' | 'secondary'>('secondary');
  const [accountId, setAccountId] = useState('');
  const [memberId, setMemberId] = useState('');
  const filter = {
    bookId,
    ...(month ? { month } : {}),
    ...(accountId ? { accountId } : {}),
    ...(memberId ? { memberId } : {}),
    direction,
  };
  const rows = useMemo(
    () => categoryTotals(state, filter, direction === 'income' ? 'secondary' : level),
    [state, bookId, month, accountId, direction, level, memberId],
  );
  const sum = transactionTotals(filterTransactions(state, filter));
  const total = direction === 'expense' ? sum.expenseCents : sum.incomeCents;
  const count = direction === 'expense' ? sum.expenseCount : sum.incomeCount;
  const colors = [
    '#e68a70',
    '#d9b67d',
    '#9fb6a9',
    '#9eb1c9',
    '#bea5c6',
    '#c6b4a0',
    '#8ba9ae',
    '#cda19b',
  ];
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    cursor += (row.amountCents / total) * 100;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  });
  return (
    <section className="lj-screen">
      <PageHeader title="收支报表" onBack={onBack} />
      <div className="lj-scroll lj-page-pad">
        <MonthPicker value={month} onChange={onMonth} allowAll />
        <div className="lj-segment" aria-label="报表收支类型">
          {(['expense', 'income'] as const).map((value) => (
            <button
              key={value}
              className={direction === value ? 'selected' : ''}
              aria-pressed={direction === value}
              onClick={() => setDirection(value)}
            >
              {value === 'expense' ? '支出分析' : '收入分析'}
            </button>
          ))}
        </div>
        <div
          className="lj-report-chart"
          style={{
            background: segments.length
              ? `conic-gradient(${segments.join(',')})`
              : 'var(--lj-line)',
          }}
        >
          <div>
            <span>
              {month ? '本月' : '累计'}
              {direction === 'expense' ? '支出' : '收入'}
            </span>
            <strong>{formatMoney(total)}</strong>
            <small>{count} 笔记录</small>
          </div>
        </div>
        <div className="lj-filter-row">
          <select
            aria-label="报表账户"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">全部账户</option>
            {state.accounts
              .filter((item) => item.bookId === bookId)
              .map((account) => (
                <option value={account.id} key={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
          {direction === 'expense' && (
            <select
              aria-label="报表分类层级"
              value={level}
              onChange={(event) => setLevel(event.target.value as 'primary' | 'secondary')}
            >
              <option value="primary">一级分类</option>
              <option value="secondary">二级分类</option>
            </select>
          )}
        </div>
        <div className="lj-filter-row">
          <select
            aria-label="报表成员"
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
          >
            <option value="">全部成员</option>
            {state.members
              .filter((member) => member.bookId === bookId)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.archived ? '（已归档）' : ''}
                </option>
              ))}
          </select>
        </div>
        <div className="lj-section-heading">
          <h2>{direction === 'expense' ? '钱花在哪里' : '钱从哪里来'}</h2>
          <span>点分类查看明细</span>
        </div>
        {!rows.length && (
          <EmptyState
            title="这个范围还没有收支"
            text="记账或导入后，分类报表会自动汇总。"
            icon="chart"
          />
        )}
        <div className="lj-report-rows">
          {rows.map((row, index) => (
            <button
              className="lj-report-row"
              key={row.categoryId}
              onClick={() =>
                onDrill({
                  screen: 'details',
                  categoryId: row.categoryId,
                  accountId: accountId || undefined,
                  direction,
                  memberId: memberId || undefined,
                })
              }
            >
              <div>
                <span
                  className="lj-report-dot"
                  style={{ background: colors[index % colors.length] }}
                />
                <strong>
                  {direction === 'income' ? categoryDisplayLabel(state, row.categoryId) : row.label}
                </strong>
                <b>{formatMoney(row.amountCents)}</b>
                <Icon name="right" size={14} />
              </div>
              <div className="lj-report-row-sub">
                <span className="lj-bar">
                  <i
                    style={{
                      width: `${(row.amountCents / total) * 100}%`,
                      background: colors[index % colors.length],
                    }}
                  />
                </span>
                <span>{((row.amountCents / total) * 100).toFixed(1)}%</span>
                <small>{row.count} 笔</small>
              </div>
            </button>
          ))}
        </div>
        <p className="lj-help">
          报表按分类关联汇总，分类改名不会拆开历史记录。同名但不同一级分类的二级分类保持独立。
        </p>
      </div>
    </section>
  );
}
