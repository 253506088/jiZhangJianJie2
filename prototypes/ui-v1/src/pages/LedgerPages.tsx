import { useRef, useState } from 'react';
import {
  accountBalance,
  accounts,
  categoryFor,
  categoryTotals,
  money,
  monthEntries,
  parseBackup,
  serializeBackup,
  totals,
  type Direction,
  type Entry,
} from '../domain/ledger';
import { EntryList } from '../components/EntryList';
import { Icon } from '../components/Icon';
import { MonthPicker } from '../components/MonthPicker';

export function DetailsPage({
  entries,
  month,
  onMonth,
  onEdit,
  accountId,
  onClearAccount,
}: {
  entries: Entry[];
  month: string;
  onMonth: (value: string) => void;
  onEdit: (entry: Entry) => void;
  accountId: string | null;
  onClearAccount: () => void;
}) {
  const [filter, setFilter] = useState<'all' | Direction>('all');
  const all = monthEntries(entries, month).filter(
    (entry) => !accountId || entry.accountId === accountId,
  );
  const selected = all.filter((entry) => filter === 'all' || entry.direction === filter);
  const summary = totals(all);
  const dates = [...new Set(selected.map((entry) => entry.date))];
  return (
    <div className="page-scroll standard-page">
      <MonthPicker month={month} onChange={onMonth} />
      <div className="mini-summary">
        <div>
          <span>收入</span>
          <strong className="income">+{money(summary.income)}</strong>
        </div>
        <div>
          <span>支出</span>
          <strong>{money(summary.expense)}</strong>
        </div>
        <div>
          <span>结余</span>
          <strong>{money(summary.income - summary.expense)}</strong>
        </div>
      </div>
      {accountId && (
        <button className="filter-chip" onClick={onClearAccount}>
          {accounts.find((account) => account.id === accountId)?.name}
          <Icon name="close" size={14} />
        </button>
      )}
      <div className="list-filters">
        {(['all', 'expense', 'income'] as const).map((value) => (
          <button
            className={filter === value ? 'selected' : ''}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            key={value}
          >
            {value === 'all' ? '全部' : value === 'expense' ? '支出' : '收入'}
          </button>
        ))}
        <span>{selected.length} 笔记录</span>
      </div>
      {!selected.length && <EntryList entries={[]} onEdit={onEdit} />}
      {dates.map((date) => {
        const daily = selected.filter((entry) => entry.date === date);
        const sum = totals(daily);
        return (
          <section className="day-group" key={date}>
            <div className="day-heading">
              <strong>
                {Number(date.slice(5, 7))}月{Number(date.slice(8))}日
              </strong>
              <span>
                {sum.expense ? `支 ${money(sum.expense)}` : ''}
                {sum.income ? ` 收 ${money(sum.income)}` : ''}
              </span>
            </div>
            <EntryList entries={daily} onEdit={onEdit} />
          </section>
        );
      })}
    </div>
  );
}

export function ReportsPage({
  entries,
  month,
  onMonth,
}: {
  entries: Entry[];
  month: string;
  onMonth: (value: string) => void;
}) {
  const [direction, setDirection] = useState<Direction>('expense');
  const selected = monthEntries(entries, month);
  const rows = categoryTotals(selected, direction);
  const sum = totals(selected)[direction];
  const colors = ['#ed977d', '#d8b77c', '#a4bbb0', '#a4b4ca', '#c4accb', '#cebdac'];
  let accumulated = 0;
  const segments = rows.map((item, index) => {
    const begin = accumulated;
    accumulated += (item.cents / sum) * 100;
    return `${colors[index % colors.length]} ${begin}% ${accumulated}%`;
  });
  return (
    <div className="page-scroll standard-page">
      <MonthPicker month={month} onChange={onMonth} />
      <div className="small-tabs">
        {(['expense', 'income'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={direction === value}
            className={value === direction ? 'selected' : ''}
            onClick={() => setDirection(value)}
          >
            {value === 'expense' ? '支出分析' : '收入分析'}
          </button>
        ))}
      </div>
      <div
        className="report-chart"
        style={{
          background: segments.length ? `conic-gradient(${segments.join(',')})` : 'var(--line)',
        }}
      >
        <div>
          <span>本月{direction === 'expense' ? '支出' : '收入'}</span>
          <strong>{money(sum)}</strong>
          <small>{selected.filter((entry) => entry.direction === direction).length} 笔记录</small>
        </div>
      </div>
      <div className="section-heading">
        <h2>{direction === 'expense' ? '钱花在哪里' : '钱从哪里来'}</h2>
        <span>按二级分类统计</span>
      </div>
      <div className="report-rows">
        {rows.map((row, index) => {
          const { child, path } = categoryFor(row.categoryId);
          return (
            <div className="report-row" key={row.categoryId}>
              <div className="report-row-title">
                <span className="report-icon" style={{ color: colors[index % colors.length] }}>
                  <Icon name={child.icon} size={20} />
                </span>
                <strong>{path}</strong>
                <span>{money(row.cents)}</span>
              </div>
              <div className="report-row-bottom">
                <div className="report-bar">
                  <span
                    style={{
                      width: `${(row.cents / sum) * 100}%`,
                      background: colors[index % colors.length],
                    }}
                  />
                </div>
                <small>{((row.cents / sum) * 100).toFixed(1)}%</small>
                <em>{row.count} 笔</em>
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <div className="empty-state">
            <Icon name="chart" size={32} />
            <strong>这个月还没有记录</strong>
            <span>记上一笔，就能看到分类统计。</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function AccountsPage({
  entries,
  onSelect,
}: {
  entries: Entry[];
  onSelect: (id: string) => void;
}) {
  const total = accounts.reduce((sum, account) => sum + accountBalance(entries, account.id), 0);
  return (
    <div className="page-scroll standard-page">
      <section className="account-overview">
        <span>账户总余额</span>
        <strong>
          <small>¥</small>
          {money(total)}
        </strong>
        <p>3 个演示账户，收支自动记入余额</p>
      </section>
      <div className="section-heading">
        <h2>我的账户</h2>
        <span>点击查看流水</span>
      </div>
      <div className="account-cards">
        {accounts.map((account) => (
          <button
            className={`account-card ${account.tone}`}
            key={account.id}
            onClick={() => onSelect(account.id)}
          >
            <div>
              <span className="account-card-icon">
                <Icon name={account.icon} size={24} />
              </span>
              <strong>{account.name}</strong>
              <Icon name="right" size={18} />
            </div>
            <small>余额</small>
            <b>{money(accountBalance(entries, account.id))}</b>
            <p>{entries.filter((entry) => entry.accountId === account.id).length} 笔记录</p>
          </button>
        ))}
      </div>
      <p className="data-note">账户包含虚构的期初余额，仅用于体验记账流程。</p>
    </div>
  );
}

export function DataPage({
  entries,
  onRestore,
  onReset,
  theme,
  onTheme,
  notify,
}: {
  entries: Entry[];
  onRestore: (entries: Entry[]) => void;
  onReset: () => void;
  theme: 'light' | 'dark';
  onTheme: (value: 'light' | 'dark') => void;
  notify: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const exportData = () => {
    const url = URL.createObjectURL(
      new Blob([serializeBackup(entries)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '简洁记账-演示备份.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('演示备份已导出');
  };
  return (
    <div className="page-scroll standard-page">
      <section className="data-identity">
        <span className="brand-mark">
          <Icon name="book" size={29} />
        </span>
        <h2>你的日常，只属于你</h2>
        <p>
          这里是虚构账目的交互预览。
          <br />
          不需要登录，也不需要提供真实账本。
        </p>
        <span className="demo-badge">演示账本 · {entries.length} 笔记录</span>
      </section>
      <section className="settings-section">
        <h3>显示偏好</h3>
        <div className="setting-row">
          <span>
            <Icon name="sunrise" />
            界面主题
          </span>
          <div className="theme-segment">
            <button
              className={theme === 'light' ? 'selected' : ''}
              onClick={() => onTheme('light')}
            >
              暖白
            </button>
            <button className={theme === 'dark' ? 'selected' : ''} onClick={() => onTheme('dark')}>
              夜间
            </button>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <h3>演示数据</h3>
        <button className="setting-row" onClick={exportData}>
          <span>
            <Icon name="download" />
            导出演示备份
          </span>
          <Icon name="right" size={17} />
        </button>
        <button className="setting-row" onClick={() => input.current?.click()}>
          <span>
            <Icon name="upload" />
            恢复演示备份
          </span>
          <Icon name="right" size={17} />
        </button>
        <button className="setting-row" onClick={onReset}>
          <span>
            <Icon name="reset" />
            恢复最初的演示账目
          </span>
          <Icon name="right" size={17} />
        </button>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          aria-label="选择演示备份"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
              if (file.size > 2_000_000) throw new Error('演示备份不能超过 2 MB');
              onRestore(parseBackup(await file.text()));
            } catch (cause) {
              notify((cause as Error).message);
            }
          }}
        />
      </section>
      <p className="data-note">
        预览中的修改只保留在当前页面，刷新会恢复示例。请勿用于保存真实账本。旧版 Excel
        导入尚未实现。
      </p>
      <div className="about-version">
        <Icon name="book" size={16} />
        简洁记账 · 界面预览 0.1
      </div>
    </div>
  );
}
