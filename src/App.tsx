import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { createDemoEntries, saveEntry, todayLocal, type Entry } from './domain/ledger';
import { Icon } from './components/Icon';
import { ConfirmDialog, type Confirmation } from './components/ConfirmDialog';
import { HomePage } from './pages/HomePage';
import { EntryEditor } from './pages/EntryEditor';
import { AccountsPage, DataPage, DetailsPage, ReportsPage } from './pages/LedgerPages';

export type Screen = 'home' | 'entry' | 'details' | 'accounts' | 'reports' | 'data';
const pageTitles: Record<Screen, string> = {
  home: '首页',
  entry: '记一笔',
  details: '收支明细',
  accounts: '我的账户',
  reports: '收支报表',
  data: '数据与设置',
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [entries, setEntries] = useState<Entry[]>(() => createDemoEntries());
  const [editing, setEditing] = useState<Entry | null>(null);
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [toast, setToast] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (message: string) => {
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    setToast(message);
    toastTimeout.current = setTimeout(() => setToast(''), 3300);
  };
  useEffect(
    () => () => {
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    },
    [],
  );
  const navigate = (next: Screen) => {
    setEditing(null);
    setAccountFilter(null);
    setScreen(next);
  };
  const editEntry = (entry: Entry) => {
    setEditing(entry);
    setScreen('entry');
  };
  const native = Capacitor.isNativePlatform();
  return (
    <main className={`preview-workspace ${native ? 'native-workspace' : ''}`}>
      <aside className="preview-intro">
        <a
          className="preview-wordmark"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate('home');
          }}
        >
          <span>
            <Icon name="book" size={21} />
          </span>
          简洁记账<small>重制预览</small>
        </a>
        <div className="edition-label">
          <span />
          INTERFACE STUDY · 01
        </div>
        <h1>
          熟悉的习惯。
          <br />
          <em>更轻盈的日常。</em>
        </h1>
        <p className="intro-description">
          保留你顺手的两级分类与记账路径，
          <br />
          让每一笔日常，都清楚而从容。
        </p>
        <div className="intro-divider" />
        <h2>点击体验</h2>
        <nav className="preview-navigation" aria-label="预览页面">
          {(
            [
              { id: 'home', label: '首页概览', icon: 'home' },
              { id: 'entry', label: '记一笔', icon: 'plus' },
              { id: 'details', label: '收支明细', icon: 'list' },
              { id: 'reports', label: '分类报表', icon: 'chart' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={screen === item.id ? 'selected' : ''}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
              <Icon name="right" size={15} />
            </button>
          ))}
        </nav>
        <div className="preview-theme">
          <span>换一种光线</span>
          <button
            aria-label="预览暖白主题"
            aria-pressed={theme === 'light'}
            className={`theme-dot light ${theme === 'light' ? 'selected' : ''}`}
            onClick={() => setTheme('light')}
          />
          <button
            aria-label="预览夜间主题"
            aria-pressed={theme === 'dark'}
            className={`theme-dot dark ${theme === 'dark' ? 'selected' : ''}`}
            onClick={() => setTheme('dark')}
          />
        </div>
        <p className="stack-caption">
          React + TypeScript + Capacitor
          <br />
          <span>同一套界面，可扩展为 Android 与 Web</span>
        </p>
      </aside>
      <div className="device-stage">
        <div className="device-caption">
          <span className="status-dot" />
          可操作预览<span>移动端界面</span>
        </div>
        <div className="device-frame">
          <div className="app-shell" data-theme={theme}>
            <div className="mobile-status">
              <span>简洁记账</span>
              <span>
                演示预览
                <Icon name="book" size={11} />
              </span>
            </div>
            {screen !== 'home' && screen !== 'entry' && (
              <header className="page-header">
                <button
                  className="icon-button"
                  aria-label="返回首页"
                  onClick={() => navigate('home')}
                >
                  <Icon name="left" />
                </button>
                <h1>{pageTitles[screen]}</h1>
                <span className="header-spacer" />
              </header>
            )}
            {screen === 'home' && (
              <HomePage
                entries={entries}
                month={month}
                onMonth={setMonth}
                navigate={navigate}
                onEdit={editEntry}
              />
            )}
            {screen === 'entry' && (
              <EntryEditor
                key={editing?.id ?? 'new'}
                initial={editing}
                onCancel={() => navigate(editing ? 'details' : 'home')}
                onSave={(entry, again) => {
                  setEntries((items) => saveEntry(items, entry));
                  setMonth(entry.date.slice(0, 7));
                  notify(again ? '记好了，继续下一笔' : '已保存这笔账目');
                  if (!again) navigate(editing ? 'details' : 'home');
                }}
                onDelete={(entry) =>
                  setConfirmation({
                    title: '删除这笔演示账目？',
                    message: '删除后，本月统计和账户余额会同步更新。',
                    confirmLabel: '删除',
                    onConfirm: () => {
                      setEntries((items) => items.filter((item) => item.id !== entry.id));
                      navigate('details');
                      notify('已删除');
                    },
                  })
                }
              />
            )}
            {screen === 'details' && (
              <DetailsPage
                entries={entries}
                month={month}
                onMonth={setMonth}
                onEdit={editEntry}
                accountId={accountFilter}
                onClearAccount={() => setAccountFilter(null)}
              />
            )}
            {screen === 'reports' && (
              <ReportsPage entries={entries} month={month} onMonth={setMonth} />
            )}
            {screen === 'accounts' && (
              <AccountsPage
                entries={entries}
                onSelect={(id) => {
                  setAccountFilter(id);
                  setScreen('details');
                }}
              />
            )}
            {screen === 'data' && (
              <DataPage
                entries={entries}
                theme={theme}
                onTheme={setTheme}
                notify={notify}
                onRestore={(items) =>
                  setConfirmation({
                    title: '恢复演示备份？',
                    message: `将用备份中的 ${items.length} 笔虚构记录替换当前演示账目，不会重复叠加。`,
                    confirmLabel: '恢复',
                    onConfirm: () => {
                      setEntries(items);
                      setMonth(items[0]?.date.slice(0, 7) ?? todayLocal().slice(0, 7));
                      notify('演示备份已恢复');
                    },
                  })
                }
                onReset={() =>
                  setConfirmation({
                    title: '重新开始体验？',
                    message: '将恢复最初的虚构账目，清除本次预览中的修改。',
                    confirmLabel: '恢复示例',
                    onConfirm: () => {
                      setEntries(createDemoEntries());
                      setMonth(todayLocal().slice(0, 7));
                      notify('演示账目已恢复');
                    },
                  })
                }
              />
            )}
            <div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">
              <Icon name="check" size={16} />
              {toast}
            </div>
            <ConfirmDialog value={confirmation} onClose={() => setConfirmation(null)} />
          </div>
        </div>
        <div className="device-bottom-caption">全部为虚构数据 · 可以放心点选</div>
      </div>
      <aside className="preview-notes">
        <span className="annotation-index">A LITTLE MORE FAMILIAR</span>
        <h2>
          顺手的部分，
          <br />
          留下来。
        </h2>
        <div className="habit-note">
          <span>01</span>
          <div>
            <strong>还是熟悉的两级分类</strong>
            <p>
              左边选大类，右边选细项。
              <br />
              分类路径始终看得见。
            </p>
          </div>
        </div>
        <div className="habit-note">
          <span>02</span>
          <div>
            <strong>算一算，直接记下来</strong>
            <p>
              数字键盘支持加减，
              <br />
              不用离开记账页面。
            </p>
          </div>
        </div>
        <div className="habit-note">
          <span>03</span>
          <div>
            <strong>保存，或者再记一笔</strong>
            <p>
              连续记账时保留所选分类，
              <br />
              少一些来回，多一点顺手。
            </p>
          </div>
        </div>
        <div className="try-card">
          <span className="try-icon">
            <Icon name="plus" size={18} />
          </span>
          <strong>现在试记一笔</strong>
          <p>
            选择「餐饮 → 早餐」，输入 12.5，
            <br />
            保存后看看首页和报表的变化。
          </p>
          <button onClick={() => navigate('entry')}>
            开始体验
            <Icon name="right" size={15} />
          </button>
        </div>
        <p className="fidelity-note">
          布局参考已提取的旧版资源。
          <br />
          这是可交互的设计稿，细节仍可调整，
          <br />
          尚未验证与旧版行为完全一致。
        </p>
      </aside>
    </main>
  );
}
