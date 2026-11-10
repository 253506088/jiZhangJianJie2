import {
  periodBudgetProgress,
  filterTransactions,
  formatMoney,
  localDate,
  transactionTotals,
  type Transaction,
} from '../core';
import type { PageProps, Route } from './contracts';
import { Icon } from './Icon';
import { EmptyState, MonthPicker, TransactionRows } from './shared';
import { HomeBackground } from './HomeBackground';

export function Home({
  state,
  bookId,
  busy,
  month,
  onMonth,
  navigate,
  onImport,
  onLegacyImport,
  onOpen,
}: PageProps & {
  month: string;
  onMonth: (month: string) => void;
  navigate: (route: Route) => void;
  onImport: () => void;
  onLegacyImport?: () => void;
  onOpen: (entry: Transaction) => void;
}) {
  const book = state.books.find((item) => item.id === bookId)!;
  const rows = filterTransactions(state, { bookId, month });
  const summary = transactionTotals(rows);
  const budget = periodBudgetProgress(
    state,
    bookId,
    `${month || localDate().slice(0, 7)}-01`,
    'month',
  );
  const budgetStatus = budget.hasBudget
    ? { ...budget, remainingCents: budget.displayRemainingCents }
    : null;
  const progress = summary.incomeCents > 0 ? summary.expenseCents / summary.incomeCents : 0;
  const today = rows.filter((item) => item.date === localDate());
  const recent = (today.length ? today : rows).slice(0, 5);
  return (
    <section className="lj-screen lj-home">
      <div className="lj-scroll">
        <header className="lj-home-header">
          <span className="lj-brand-mark">
            <Icon name="book" size={26} />
          </span>
          <div>
            <h1>简洁记账</h1>
            <button className="lj-book-switch" onClick={() => navigate({ screen: 'books' })}>
              {book.name}
              <Icon name="expand" size={13} />
            </button>
          </div>
          <button
            className="lj-icon-button"
            aria-label="数据与设置"
            onClick={() => navigate({ screen: 'data' })}
          >
            <Icon name="settings" />
          </button>
        </header>
        <section
          className={`lj-overview${state.settings.homeBackground ? ' has-background' : ''}`}
          aria-label="本月收支"
        >
          <HomeBackground value={state.settings.homeBackground} />
          <MonthPicker value={month} onChange={onMonth} />
          <div className="lj-balance-layout">
            <div className="lj-spending-ring">
              <svg viewBox="0 0 200 200" aria-hidden="true">
                <circle cx="100" cy="100" r="86" className="lj-ring-track" />
                <circle
                  cx="100"
                  cy="100"
                  r="86"
                  className={`lj-ring-value ${progress > 1 ? 'over' : ''}`}
                  strokeDasharray={`${Math.max(0, Math.min(progress, 1)) * 540.35} 540.35`}
                />
              </svg>
              <div>
                <span>本月支出</span>
                <strong>
                  <small>¥</small>
                  {formatMoney(summary.expenseCents)}
                </strong>
                <em>{summary.expenseCount} 笔支出记录</em>
              </div>
            </div>
            <div className="lj-month-statistics">
              <div>
                <span>
                  <i className="lj-dot income" />
                  本月收入
                </span>
                <strong>{formatMoney(summary.incomeCents)}</strong>
              </div>
              <div>
                <span>
                  <i className="lj-dot expense" />
                  本月支出
                </span>
                <strong>{formatMoney(summary.expenseCents)}</strong>
              </div>
              <div>
                <span>本月结余</span>
                <strong className={summary.balanceCents >= 0 ? 'lj-income' : 'lj-expense'}>
                  {formatMoney(summary.balanceCents)}
                </strong>
              </div>
            </div>
          </div>
          <button className="lj-budget-summary" onClick={() => navigate({ screen: 'budgets' })}>
            <span>
              {budgetStatus
                ? `${budgetStatus.remainingCents >= 0 ? '预算剩余' : '预算超出'} ¥${formatMoney(Math.abs(budgetStatus.remainingCents))}`
                : '给这个月，安排一份预算'}
            </span>
            <Icon name={budgetStatus ? 'right' : 'plus'} size={17} />
          </button>
        </section>
        <button className="lj-primary lj-add-entry" onClick={() => navigate({ screen: 'entry' })}>
          <span>
            <Icon name="plus" size={25} />
          </span>
          <div>
            记一笔<small>记下今天的小日常</small>
          </div>
          <Icon name="right" size={20} />
        </button>
        <nav className="lj-quick-actions" aria-label="常用功能">
          {(
            [
              { screen: 'details', label: '明细', icon: 'list', tone: 'sage' },
              { screen: 'accounts', label: '账户', icon: 'wallet', tone: 'blue' },
              { screen: 'reports', label: '报表', icon: 'chart', tone: 'sand' },
              { screen: 'data', label: '数据', icon: 'book', tone: 'lavender' },
            ] as const
          ).map((item) => (
            <button key={item.screen} onClick={() => navigate({ screen: item.screen })}>
              <span className={item.tone}>
                <Icon name={item.icon} size={25} />
              </span>
              {item.label}
            </button>
          ))}
        </nav>
        {state.transactions.filter((item) => item.bookId === bookId).length === 0 ? (
          <section className="lj-welcome-card">
            <span className="lj-welcome-icon">
              <Icon name="excel" size={25} />
            </span>
            <div>
              <h2>把熟悉的旧账本带过来</h2>
              <p>选择旧版 .db 迁移账本，或用 Excel 导入明细。</p>
              {onLegacyImport && (
                <button className="lj-text-button" disabled={busy} onClick={onLegacyImport}>
                  从旧版 .db 初始化
                  <Icon name="arrow" size={16} />
                </button>
              )}
              <button className="lj-text-button" disabled={busy} onClick={onImport}>
                从 Excel 导入
                <Icon name="arrow" size={16} />
              </button>
            </div>
          </section>
        ) : null}
        <section className="lj-recent">
          <div className="lj-section-heading">
            <h2>{today.length ? '今天的记录' : '最近记录'}</h2>
            <button className="lj-text-button" onClick={() => navigate({ screen: 'details' })}>
              查看全部
              <Icon name="right" size={15} />
            </button>
          </div>
          {recent.length ? (
            <TransactionRows state={state} rows={recent} onOpen={onOpen} />
          ) : (
            <EmptyState title="从今天的第一笔开始" text="记录会一直留在你的设备里。" />
          )}
        </section>
        <p className="lj-quiet-footer">
          <span />
          收支有数，生活从容
          <span />
        </p>
      </div>
    </section>
  );
}
