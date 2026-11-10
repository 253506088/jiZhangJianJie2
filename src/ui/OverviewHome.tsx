import { useState } from 'react';
import {
  periodBudgetProgress,
  filterTransactions,
  formatMoney,
  localDate,
  transactionTotals,
  type BudgetPeriod,
} from '../core';
import type { PageProps, Route } from './contracts';
import { Icon } from './Icon';
import { Modal } from './shared';
import { overviewPeriods } from './overview-periods';

export function OverviewHome({
  state,
  bookId,
  busy,
  navigate,
  onImport,
  onMonth,
}: PageProps & {
  navigate: (route: Route) => void;
  onImport: () => void;
  onMonth: (month: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const book = state.books.find((item) => item.id === bookId)!;
  const periods = overviewPeriods(new Date(), state.settings.weekStartsOn ?? 1);
  const month = localDate().slice(0, 7);
  const rows = filterTransactions(state, { bookId, month });
  const monthTotals = transactionTotals(rows);
  const budgetCards = (['day', 'week', 'month'] as const).map((period) => ({
    period,
    label: { day: '日', week: '周', month: '月' }[period],
    progress: periodBudgetProgress(state, bookId, localDate(), period),
  }));
  const remainderPercent =
    monthTotals.incomeCents > 0
      ? ((BigInt(monthTotals.balanceCents) * 100n) / BigInt(monthTotals.incomeCents)).toString()
      : null;
  const hasEntries = state.transactions.some((item) => item.bookId === bookId);
  const openCurrentBudget = (period: BudgetPeriod = 'month') => {
    onMonth(month);
    navigate({ screen: 'budgets', budgetPeriod: period });
  };
  const menuItems: { label: string; icon: string; screen: Route['screen'] }[] = [
    { label: '收支明细', icon: 'list', screen: 'details' },
    { label: '我的账本', icon: 'book', screen: 'books' },
    { label: '分类管理', icon: 'category', screen: 'categories' },
    { label: '日周月预算', icon: 'chart', screen: 'budgets' },
    { label: '模板记账', icon: 'layers', screen: 'templates' },
    { label: '成员管理', icon: 'members', screen: 'members' },
    { label: '借贷人管理', icon: 'loan', screen: 'loanPeople' },
    { label: '数据与设置', icon: 'settings', screen: 'data' },
  ];
  return (
    <section className="lj-screen lj-home lj-dashboard-home">
      <div className="lj-scroll">
        <header className="lj-dashboard-header">
          <button
            className="lj-dashboard-book"
            disabled={busy}
            onClick={() => navigate({ screen: 'books' })}
          >
            <Icon name="book" size={24} />
            <span>{book.name}</span>
            <Icon name="expand" size={13} />
          </button>
          <h1 className="lj-sr-only">简洁记账</h1>
          <button
            className="lj-icon-button"
            aria-label="搜索明细"
            disabled={busy}
            onClick={() => {
              onMonth('');
              navigate({ screen: 'details' });
            }}
          >
            <Icon name="search" size={23} />
          </button>
        </header>
        <div className="lj-dashboard-hero">
          <svg viewBox="0 0 360 204" className="lj-dashboard-art" aria-hidden="true">
            <circle cx="180" cy="98" r="70" className="lj-art-outline" />
            <path
              d="M53 163c10-30 18-48 13-71 22 17 18 41 5 64m-7-23c-18-7-25-19-23-31 18 1 27 11 29 29"
              className="lj-art-leaf"
            />
            <path d="M51 169h37m-13 1V117" className="lj-art-outline" />
            <g transform="rotate(9 294 122)">
              <rect x="267" y="72" width="49" height="95" rx="7" className="lj-art-book" />
              <path d="M277 77v85m9-59h17m-17 10h17m-17 10h11" className="lj-art-book-lines" />
            </g>
            <path
              d="M82 52h7m-3.5-3.5v7m186-8h6m-3-3v6M236 181h6m-3-3v6"
              className="lj-art-spark"
            />
            <circle cx="102" cy="180" r="3" className="lj-art-dot" />
            <circle cx="256" cy="42" r="2" className="lj-art-dot" />
            <path d="M121 179q58 13 117-2" className="lj-art-ground" />
          </svg>
          <div className="lj-dashboard-hero-copy">
            <span>本月结余率</span>
            <strong className={monthTotals.balanceCents < 0 ? 'lj-expense' : ''}>
              {remainderPercent === null ? '—' : `${remainderPercent}%`}
            </strong>
            <small>结余 ¥{formatMoney(monthTotals.balanceCents)}</small>
          </div>
        </div>
        <section className="lj-dashboard-section">
          <h2>
            <i />
            预算余额
          </h2>
          <div className="lj-budget-tiles">
            {budgetCards.map(({ period, label, progress }) => (
              <button
                key={period}
                disabled={busy}
                aria-label={`设置${label}预算`}
                onClick={() => openCurrentBudget(period)}
              >
                <strong className={progress.displayRemainingCents < 0 ? 'lj-expense' : ''}>
                  {formatMoney(progress.displayRemainingCents)}
                </strong>
                <span>{label}预算</span>
                <small>{progress.hasBudget ? '点此调整' : '未设置'}</small>
              </button>
            ))}
          </div>
        </section>
        <section className="lj-dashboard-section">
          <h2>
            <i />
            收支概况
          </h2>
          <div className="lj-period-cards">
            {periods.map((period) => {
              const transactions = filterTransactions(state, {
                bookId,
                fromDate: period.fromDate,
                toDate: period.toDate,
              });
              const sum = transactionTotals(transactions);
              return (
                <button
                  key={period.key}
                  disabled={busy}
                  onClick={() =>
                    navigate({
                      screen: 'details',
                      fromDate: period.fromDate,
                      toDate: period.toDate,
                      periodLabel: period.label,
                    })
                  }
                  aria-label={`查看${period.label}明细`}
                >
                  <span>
                    <strong>{period.label}</strong>
                    <small>
                      {transactions.length ? `已记账 ${transactions.length} 笔` : '暂未记账'}
                    </small>
                  </span>
                  <span className="lj-period-values">
                    <span>
                      <small>收入</small>
                      {formatMoney(sum.incomeCents)}
                    </span>
                    <span className="lj-accent-amount">
                      <small>支出</small>
                      {formatMoney(sum.expenseCents)}
                    </span>
                  </span>
                  <Icon name="right" size={15} />
                </button>
              );
            })}
          </div>
        </section>
        {!hasEntries && (
          <section className="lj-dashboard-import">
            <Icon name="excel" size={25} />
            <div>
              <h2>把旧账本接着记下去</h2>
              <p>手动选择旧版导出的 Excel，分类会一并初始化。</p>
              <button className="lj-text-button" disabled={busy} onClick={onImport}>
                从 Excel 导入
                <Icon name="arrow" size={16} />
              </button>
            </div>
          </section>
        )}
        <p className="lj-dashboard-note">
          日、周、月额度分别设置。分类预算仅扣对应分类支出；本周从周一开始。
        </p>
      </div>
      <nav className="lj-dashboard-bar" aria-label="底部导航">
        <button
          className="lj-dashboard-menu"
          disabled={busy}
          aria-label="菜单"
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="list" size={25} />
          <span>菜单</span>
        </button>
        <button
          className="lj-dashboard-record"
          disabled={busy}
          aria-label="记一笔"
          onClick={() => navigate({ screen: 'entry' })}
        >
          <Icon name="edit" size={30} />
        </button>
        <div>
          <button
            disabled={busy}
            aria-label="账户"
            onClick={() => navigate({ screen: 'accounts' })}
          >
            <Icon name="wallet" size={25} />
            <span>账户</span>
          </button>
          <button
            disabled={busy}
            aria-label="报表"
            onClick={() => {
              onMonth(month);
              navigate({ screen: 'reports' });
            }}
          >
            <Icon name="chart" size={25} />
            <span>报表</span>
          </button>
          <button
            disabled={busy}
            aria-label="数据与设置"
            onClick={() => navigate({ screen: 'data' })}
          >
            <Icon name="more" size={25} />
            <span>更多</span>
          </button>
        </div>
      </nav>
      {menuOpen && (
        <Modal title="功能菜单" busy={busy} onClose={() => setMenuOpen(false)}>
          <div className="lj-action-list">
            {menuItems.map((item) => (
              <button
                key={item.screen}
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  if (item.screen === 'budgets') openCurrentBudget();
                  else {
                    if (item.screen === 'details') onMonth('');
                    navigate({ screen: item.screen });
                  }
                }}
              >
                <Icon name={item.icon} />
                {item.label}
                <Icon name="right" size={15} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}
