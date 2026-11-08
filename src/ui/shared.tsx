import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { categoryPath, formatMoney, localDate, type LedgerState, type Transaction } from '../core';
import { Icon } from './Icon';
import { categoryDisplayLabel, loanLabels, memberName, personName } from './display';

export const BackLayerContext = createContext<(handler: () => void) => () => void>(
  () => () => undefined,
);
export const BusyContext = createContext(false);
export const CommitFeedbackContext = createContext<{
  error: string | null;
  clearError: () => void;
}>({
  error: null,
  clearError: () => undefined,
});

export function useBackLayer(handler: () => void, enabled = true) {
  const register = useContext(BackLayerContext);
  const current = useRef(handler);
  current.current = handler;
  useEffect(() => (enabled ? register(() => current.current()) : undefined), [register, enabled]);
}

export function PageHeader({
  title,
  onBack,
  action,
}: {
  title: string;
  onBack: () => void;
  action?: ReactNode;
}) {
  const busy = useContext(BusyContext);
  return (
    <header className="lj-header">
      <button className="lj-icon-button" aria-label="返回" disabled={busy} onClick={onBack}>
        <Icon name="back" />
      </button>
      <h1>{title}</h1>
      <div className="lj-header-action">{action}</div>
    </header>
  );
}

export function EmptyState({
  title,
  text,
  icon = 'book',
  children,
}: {
  title: string;
  text?: string;
  icon?: string;
  children?: ReactNode;
}) {
  return (
    <div className="lj-empty">
      <span>
        <Icon name={icon} size={30} />
      </span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {children && <div className="lj-empty-actions">{children}</div>}
    </div>
  );
}

export function MonthPicker({
  value,
  onChange,
  allowAll = false,
}: {
  value: string;
  onChange: (month: string) => void;
  allowAll?: boolean;
}) {
  const move = (amount: number) => {
    const current = value || localDate().slice(0, 7);
    const [year, month] = current.split('-').map(Number);
    const date = new Date(year, month - 1 + amount, 1);
    onChange(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  };
  return (
    <div className="lj-month-picker">
      <button className="lj-icon-button" aria-label="上个月" onClick={() => move(-1)}>
        <Icon name="left" size={18} />
      </button>
      <label>
        <span>{value ? `${value.slice(0, 4)}年 ${Number(value.slice(5))}月` : '全部月份'}</span>
        <Icon name="expand" size={14} />
        <input
          type="month"
          aria-label="选择月份"
          value={value}
          onChange={(event) => {
            if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) onChange(event.target.value);
          }}
        />
      </label>
      <button className="lj-icon-button" aria-label="下个月" onClick={() => move(1)}>
        <Icon name="right" size={18} />
      </button>
      {allowAll && (
        <button
          className={`lj-text-button ${!value ? 'selected' : ''}`}
          onClick={() => onChange('')}
        >
          全部
        </button>
      )}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const feedback = useContext(CommitFeedbackContext);
  useEffect(() => {
    ref.current?.showModal();
    feedback.clearError();
  }, [feedback.clearError]);
  useBackLayer(() => {
    if (!busy) onClose();
  });
  return (
    <dialog
      ref={ref}
      className={`lj-modal ${wide ? 'lj-modal-wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      aria-label={title}
    >
      <div className="lj-modal-body" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button
            className="lj-icon-button"
            aria-label="关闭弹窗"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" size={19} />
          </button>
        </header>
        <fieldset className="lj-modal-content" disabled={busy}>
          {children}
        </fieldset>
        {feedback.error && (
          <p className="lj-inline-error lj-modal-feedback" role="alert">
            {feedback.error}
          </p>
        )}
      </div>
    </dialog>
  );
}

export function ConfirmModal({
  title,
  children,
  confirmLabel = '确认',
  onClose,
  onConfirm,
  busy = false,
  danger = false,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <div className="lj-confirm-copy">{children}</div>
      <div className="lj-form-actions">
        <button className="lj-secondary" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className={`lj-primary ${danger ? 'lj-danger-button' : ''}`}
          disabled={busy}
          onClick={() => void onConfirm()}
        >
          {busy ? '正在保存…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="lj-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function TransactionRows({
  state,
  rows,
  onOpen,
}: {
  state: LedgerState;
  rows: Transaction[];
  onOpen: (transaction: Transaction) => void;
}) {
  const accounts = new Map(state.accounts.map((item) => [item.id, item]));
  const categoryMap = new Map(state.categories.map((item) => [item.id, item]));
  return (
    <div className="lj-transaction-list">
      {rows.map((transaction) => {
        const transfer = transaction.direction === 'transfer';
        const loan = transaction.direction === 'loan';
        const path = transaction.categoryId ? categoryPath(state, transaction.categoryId) : null;
        const title = transfer
          ? '账户转账'
          : loan
            ? (loanLabels[transaction.loanType!] ?? '借贷')
            : (path?.secondaryName ?? path?.primaryName ?? '未分类');
        const label = transfer
          ? `${accounts.get(transaction.accountId)?.name ?? '账户'} → ${accounts.get(transaction.toAccountId ?? '')?.name ?? '账户'} · ${memberName(state, transaction.memberId)}`
          : loan
            ? `${personName(state, transaction.personId)} · ${accounts.get(transaction.accountId)?.name ?? ''}`
            : `${transaction.direction === 'expense' ? `${path?.primaryName ?? ''} · ` : ''}${accounts.get(transaction.accountId)?.name ?? ''} · ${memberName(state, transaction.memberId)}`;
        return (
          <button
            className="lj-transaction-row"
            key={transaction.id}
            onClick={() => onOpen(transaction)}
            aria-label={`查看${path ? categoryDisplayLabel(state, path.category.id) : loan ? `${title} · ${label}` : label}，${formatMoney(transaction.amountCents)}元`}
          >
            <span className={`lj-transaction-icon ${transaction.direction}`}>
              <Icon
                name={
                  transfer
                    ? 'transfer'
                    : loan
                      ? 'loan'
                      : categoryMap.get(transaction.categoryId ?? '')?.icon || 'tag'
                }
              />
            </span>
            <span className="lj-transaction-copy">
              <strong>
                {title}
                {transaction.source && <i>导入</i>}
              </strong>
              <span>{transaction.note || label}</span>
              {(transaction.note || transaction.time) && (
                <small>
                  {transaction.time ? `${transaction.time} · ` : ''}
                  {transaction.note ? label : ''}
                </small>
              )}
            </span>
            <span
              className={`lj-transaction-amount ${transaction.direction} ${loan && (transaction.loanType === 'borrow' || transaction.loanType === 'collect') ? 'loan-in' : ''}`}
            >
              {transfer
                ? ''
                : transaction.direction === 'income' ||
                    (loan &&
                      (transaction.loanType === 'borrow' || transaction.loanType === 'collect'))
                  ? '+'
                  : '−'}
              {formatMoney(transaction.amountCents)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function StatStrip({
  income,
  expense,
  balance,
}: {
  income: number;
  expense: number;
  balance: number;
}) {
  return (
    <div className="lj-stat-strip">
      <div>
        <span>收入</span>
        <strong className="lj-income">{formatMoney(income)}</strong>
      </div>
      <div>
        <span>支出</span>
        <strong>{formatMoney(expense)}</strong>
      </div>
      <div>
        <span>结余</span>
        <strong>{formatMoney(balance)}</strong>
      </div>
    </div>
  );
}
