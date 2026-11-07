import { money, monthEntries, todayLocal, totals, type Entry } from '../domain/ledger';
import { EntryList } from '../components/EntryList';
import { Icon } from '../components/Icon';
import { MonthPicker } from '../components/MonthPicker';
import type { Screen } from '../App';

export function HomePage({
  entries,
  month,
  onMonth,
  navigate,
  onEdit,
}: {
  entries: Entry[];
  month: string;
  onMonth: (month: string) => void;
  navigate: (screen: Screen) => void;
  onEdit: (entry: Entry) => void;
}) {
  const selected = monthEntries(entries, month);
  const summary = totals(selected);
  const today = selected.filter((entry) => entry.date === todayLocal());
  const fraction = summary.income
    ? Math.min(summary.expense / summary.income, 1)
    : summary.expense
      ? 1
      : 0;
  return (
    <div className="home-page page-scroll">
      <header className="home-header">
        <div className="brand-mark">
          <Icon name="book" size={23} />
        </div>
        <div>
          <h1>简洁记账</h1>
          <span>
            生活账本 <b>演示</b>
          </span>
        </div>
        <button
          className="icon-button header-more"
          aria-label="账本设置"
          onClick={() => navigate('data')}
        >
          <Icon name="more" />
        </button>
      </header>
      <section className="monthly-overview" aria-label="本月收支">
        <MonthPicker month={month} onChange={onMonth} />
        <div className="balance-layout">
          <div className="spending-ring">
            <svg viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r="86" className="ring-track" />
              <circle
                cx="100"
                cy="100"
                r="86"
                className="ring-value"
                strokeDasharray={`${Math.max(fraction * 540.35, fraction ? 9 : 0)} 540.35`}
              />
            </svg>
            <div>
              <span>本月支出</span>
              <strong>
                <small>¥</small>
                {money(summary.expense)}
              </strong>
              <em>
                {selected.filter((entry) => entry.direction === 'expense').length} 笔，把日常记下来
              </em>
            </div>
          </div>
          <div className="month-statistics">
            <div>
              <span>
                <i className="dot green" />
                本月收入
              </span>
              <strong>{money(summary.income)}</strong>
            </div>
            <div>
              <span>
                <i className="dot coral" />
                本月支出
              </span>
              <strong>{money(summary.expense)}</strong>
            </div>
            <div className="balance-total">
              <span>本月结余</span>
              <strong>{money(summary.income - summary.expense)}</strong>
            </div>
          </div>
        </div>
        <div className="monthly-footnote">
          <span>收支有数，心里有底。</span>
          <Icon name="sunrise" size={20} />
        </div>
      </section>
      <button className="primary-button add-entry-button" onClick={() => navigate('entry')}>
        <span className="add-entry-icon">
          <Icon name="plus" size={24} />
        </span>
        <span>
          记一笔<small>记下今天的小日常</small>
        </span>
        <Icon name="right" size={20} />
      </button>
      <nav className="quick-actions" aria-label="常用功能">
        {[
          { screen: 'details', label: '明细', icon: 'list', tone: 'sage' },
          { screen: 'accounts', label: '账户', icon: 'wallet', tone: 'blue' },
          { screen: 'reports', label: '报表', icon: 'chart', tone: 'sand' },
          { screen: 'data', label: '数据', icon: 'book', tone: 'lavender' },
        ].map((action) => (
          <button key={action.screen} onClick={() => navigate(action.screen as Screen)}>
            <span className={`quick-icon ${action.tone}`}>
              <Icon name={action.icon} size={24} />
            </span>
            <span>{action.label}</span>
          </button>
        ))}
      </nav>
      <section className="recent-section">
        <div className="section-heading">
          <div>
            <h2>{today.length ? '今天的记录' : '最近记录'}</h2>
            <span>{today.length ? `${today.length} 笔日常` : `${selected.length} 笔记录`}</span>
          </div>
          <button className="text-button" onClick={() => navigate('details')}>
            全部
            <Icon name="right" size={14} />
          </button>
        </div>
        <EntryList entries={(today.length ? today : selected).slice(0, 3)} onEdit={onEdit} />
      </section>
      <p className="quiet-footer">
        <span />
        用简单的方式，记好每一天
        <span />
      </p>
    </div>
  );
}
