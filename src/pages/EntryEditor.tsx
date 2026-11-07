import { useState } from 'react';
import { Delete } from 'lucide-react';
import {
  accounts,
  calculateAmount,
  categories,
  categoryFor,
  todayLocal,
  validateEntry,
  type Direction,
  type Entry,
} from '../domain/ledger';
import { Icon } from '../components/Icon';

function rawAmount(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function EntryEditor({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: Entry | null;
  onSave: (entry: Entry, again: boolean) => void;
  onCancel: () => void;
  onDelete: (entry: Entry) => void;
}) {
  const [direction, setDirection] = useState<Direction>(initial?.direction ?? 'expense');
  const [parentId, setParentId] = useState(
    initial ? categoryFor(initial.categoryId).parent.id : 'food',
  );
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? 'breakfast');
  const [expression, setExpression] = useState(initial ? rawAmount(initial.amountCents) : '');
  const [accountId, setAccountId] = useState(initial?.accountId ?? 'wechat');
  const [date, setDate] = useState(initial?.date ?? todayLocal());
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState('');
  const parent = categories.find((item) => item.id === parentId)!;
  const changeDirection = (value: Direction) => {
    if (value === direction) return;
    const next = categories.find((item) => item.direction === value)!;
    setDirection(value);
    setParentId(next.id);
    setCategoryId(next.children[0].id);
    setError('');
  };
  const pressKey = (key: string) => {
    setError('');
    if (key === 'C') {
      setExpression('');
      return;
    }
    if (key === 'delete') {
      setExpression((value) => value.slice(0, -1));
      return;
    }
    if (key === '=') {
      try {
        setExpression(rawAmount(calculateAmount(expression)));
      } catch (cause) {
        setError((cause as Error).message);
      }
      return;
    }
    if (key === '+' || key === '-') {
      if (expression)
        setExpression((value) => (/[+-]$/.test(value) ? value.slice(0, -1) + key : value + key));
      return;
    }
    setExpression((value) => {
      const token = value.split(/[+-]/).at(-1) ?? '';
      if (key === '.') return token.includes('.') ? value : value + (token ? '.' : '0.');
      if (
        value.length > 100 ||
        (token.includes('.') && token.split('.')[1].length >= 2) ||
        (!token.includes('.') && token.length >= 8)
      )
        return value;
      return token === '0' ? value.slice(0, -1) + key : value + key;
    });
  };
  const save = (again: boolean) => {
    try {
      const entry: Entry = {
        id: initial?.id ?? crypto.randomUUID(),
        direction,
        categoryId,
        amountCents: calculateAmount(expression),
        accountId,
        date,
        note: note.trim(),
      };
      validateEntry(entry);
      onSave(entry, again);
      if (again) {
        setExpression('');
        setNote('');
      }
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return (
    <section className="editor-page">
      <header className="page-header">
        <button className="icon-button" onClick={onCancel} aria-label="返回首页">
          <Icon name="left" />
        </button>
        <h1>{initial ? '编辑账目' : '记一笔'}</h1>
        {initial ? (
          <button className="text-button danger" onClick={() => onDelete(initial)}>
            删除
          </button>
        ) : (
          <span className="header-spacer" />
        )}
      </header>
      <div className="editor-content">
        <div className="direction-tabs" aria-label="收支类型">
          <button
            aria-pressed={direction === 'expense'}
            className={direction === 'expense' ? 'selected' : ''}
            onClick={() => changeDirection('expense')}
          >
            支出
          </button>
          <button
            aria-pressed={direction === 'income'}
            className={direction === 'income' ? 'selected income' : ''}
            onClick={() => changeDirection('income')}
          >
            收入
          </button>
        </div>
        <div className="category-selector">
          <nav className="parent-categories" aria-label="一级分类">
            {categories
              .filter((item) => item.direction === direction)
              .map((item) => (
                <button
                  className={parentId === item.id ? 'selected' : ''}
                  key={item.id}
                  aria-pressed={parentId === item.id}
                  onClick={() => {
                    setParentId(item.id);
                    setCategoryId(item.children[0].id);
                  }}
                >
                  <Icon name={item.icon} size={19} />
                  {item.name}
                </button>
              ))}
          </nav>
          <div className="child-categories" role="group" aria-label="二级分类">
            {parent.children.map((item) => (
              <button
                className={categoryId === item.id ? 'selected' : ''}
                key={item.id}
                aria-pressed={categoryId === item.id}
                onClick={() => setCategoryId(item.id)}
              >
                <span>
                  <Icon name={item.icon} size={20} />
                  {item.name}
                </span>
                {categoryId === item.id && <Icon name="check" size={17} />}
              </button>
            ))}
          </div>
        </div>
        <div className="amount-panel">
          <label htmlFor="entry-amount">
            {categoryFor(categoryId).path}
            <span>金额</span>
          </label>
          <div>
            <span>¥</span>
            <input
              id="entry-amount"
              aria-label="金额"
              inputMode="none"
              autoComplete="off"
              placeholder="0.00"
              value={expression}
              onChange={(event) => {
                if (/^[\d.+-]*$/.test(event.target.value)) setExpression(event.target.value);
              }}
            />
          </div>
        </div>
        <div className="entry-options">
          <label>
            <Icon name="wallet" size={17} />
            <select
              aria-label="账户"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.shortName}
                </option>
              ))}
            </select>
            <Icon name="down" size={13} />
          </label>
          <label className="date-option">
            <input
              type="date"
              aria-label="记账日期"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        </div>
        <label className="note-field">
          <Icon name="list" size={17} />
          <input
            aria-label="备注"
            placeholder="写点备注，帮自己记住"
            maxLength={120}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="editor-error" role="alert">
          {error}
        </div>
      </div>
      <div className="editor-bottom">
        <div className="calculator" aria-label="金额键盘">
          {[
            '7',
            '8',
            '9',
            '+',
            '4',
            '5',
            '6',
            '-',
            '1',
            '2',
            '3',
            'delete',
            'C',
            '0',
            '.',
            '=',
          ].map((key) => (
            <button
              key={key}
              className={`${['+', '-', '='].includes(key) ? 'operator' : ''} ${key === '=' ? 'equals' : ''}`}
              aria-label={
                key === 'delete'
                  ? '退格'
                  : key === 'C'
                    ? '清空金额'
                    : key === '='
                      ? '计算结果'
                      : key === '-'
                        ? '减'
                        : key === '+'
                          ? '加'
                          : key
              }
              onClick={() => pressKey(key)}
            >
              {key === 'delete' ? <Delete size={22} strokeWidth={1.7} /> : key === '-' ? '−' : key}
            </button>
          ))}
        </div>
        <div className="save-actions">
          {!initial && (
            <button className="secondary-button" onClick={() => save(true)}>
              再记一笔
            </button>
          )}
          <button className="primary-button" onClick={() => save(false)}>
            <Icon name="check" size={20} />
            保存
          </button>
        </div>
      </div>
    </section>
  );
}
