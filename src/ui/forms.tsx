import { useState } from 'react';
import {
  activeCategories,
  accountBalance,
  createBook,
  createCategoryPath,
  createPrimaryCategory,
  ensureIncomeCategoryDraft,
  formatMoney,
  moneyInput,
  parseMoneyToCents,
  renameBook,
  setPeriodBudget,
  budgetPeriod,
  localDate,
  upsertAccount,
  withLedgerDraft,
  type Account,
  type AccountKind,
  type Book,
  type Budget,
  type BudgetPeriod,
  type Direction,
} from '../core';
import type { PageProps } from './contracts';
import { Field, Modal } from './shared';
import { Icon, iconChoices } from './Icon';

const iconLabels: Record<string, string> = {
  category: '分类',
  utensils: '餐饮',
  coffee: '饮品',
  basket: '购物',
  shopping: '用品',
  train: '交通',
  car: '汽车',
  home: '居家',
  bolt: '水电',
  film: '娱乐',
  plane: '旅行',
  gift: '礼物',
  work: '工作',
  wallet: '钱包',
  tag: '标签',
};

type CategoryFormProps = PageProps & {
  direction: Direction;
  mode?: 'primary' | 'path';
  initialPrimaryId?: string;
  onClose: () => void;
  onSaved?: (id: string) => void;
};

export function CategoryForm(props: CategoryFormProps) {
  return props.direction === 'income' ? (
    <IncomeCategoryForm {...props} />
  ) : (
    <CategoryPathForm {...props} />
  );
}

function IncomeCategoryForm({ bookId, busy, commit, onClose, onSaved }: CategoryFormProps) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('work');
  return (
    <Modal title="新建收入类别" busy={busy} onClose={onClose}>
      <form
        className="lj-form"
        onSubmit={async (event) => {
          event.preventDefault();
          let categoryId = '';
          const saved = await commit(
            (current) =>
              withLedgerDraft(current, (draft) => {
                categoryId = ensureIncomeCategoryDraft(draft, { bookId, name, icon }).id;
              }),
            '收入类别已保存',
          );
          if (saved) {
            onSaved?.(categoryId);
            onClose();
          }
        }}
      >
        <Field label="收入类别名称">
          <input
            autoFocus
            required
            aria-label="收入类别名称"
            maxLength={120}
            value={name}
            placeholder="例如：工资"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="图标">
          <div className="lj-icon-picker">
            {iconChoices.map((value) => (
              <button
                type="button"
                key={value}
                aria-label={`选择${iconLabels[value]}图标`}
                aria-pressed={icon === value}
                className={icon === value ? 'selected' : ''}
                onClick={() => setIcon(value)}
              >
                <Icon name={value} size={22} />
              </button>
            ))}
          </div>
        </Field>
        <p className="lj-help">
          收入使用单层类别。以后导入同名收入类别时会复用已有关联，不影响旧记录。
        </p>
        <div className="lj-form-actions">
          <button type="button" className="lj-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="lj-primary" disabled={busy}>
            {busy ? '正在保存…' : '保存类别'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CategoryPathForm({
  state,
  bookId,
  busy,
  commit,
  direction,
  mode = 'path',
  initialPrimaryId,
  onClose,
  onSaved,
}: CategoryFormProps) {
  const roots = activeCategories(state, bookId, direction);
  const [primaryId, setPrimaryId] = useState(initialPrimaryId ?? roots[0]?.id ?? 'new');
  const [primaryName, setPrimaryName] = useState('');
  const [secondaryName, setSecondaryName] = useState('');
  const [icon, setIcon] = useState(
    roots.find((item) => item.id === initialPrimaryId)?.icon ?? 'category',
  );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    let createdId = '';
    const success = await commit((current) => {
      if (mode === 'primary') {
        const result = createPrimaryCategory(current, {
          bookId,
          direction,
          name: primaryName,
          icon,
        });
        createdId = result.categoryId;
        return result.state;
      }
      const rootName =
        primaryId === 'new'
          ? primaryName
          : (current.categories.find((item) => item.id === primaryId)?.name ?? '');
      const result = createCategoryPath(current, {
        bookId,
        direction,
        primaryName: rootName,
        secondaryName,
        icon,
      });
      createdId = result.categoryId;
      return result.state;
    }, '分类已保存');
    if (success) {
      onSaved?.(createdId);
      onClose();
    }
  };
  return (
    <Modal
      title={mode === 'primary' ? '新建一级分类' : '新建二级分类'}
      busy={busy}
      onClose={onClose}
    >
      <form className="lj-form" onSubmit={(event) => void submit(event)}>
        <span className="lj-label-chip">{direction === 'expense' ? '支出分类' : '收入分类'}</span>
        {mode === 'path' && (
          <Field label="一级分类">
            <select
              aria-label="所属一级分类"
              value={primaryId}
              onChange={(event) => setPrimaryId(event.target.value)}
            >
              {roots.map((root) => (
                <option key={root.id} value={root.id}>
                  {root.name}
                </option>
              ))}
              <option value="new">＋ 新建一级分类</option>
            </select>
          </Field>
        )}
        {(mode === 'primary' || primaryId === 'new') && (
          <Field label="一级分类名称">
            <input
              autoFocus
              required
              maxLength={120}
              aria-label="一级分类名称"
              value={primaryName}
              placeholder="例如：餐饮"
              onChange={(event) => setPrimaryName(event.target.value)}
            />
          </Field>
        )}
        {mode === 'path' && (
          <Field label="二级分类名称">
            <input
              autoFocus={primaryId !== 'new'}
              required
              maxLength={120}
              aria-label="二级分类名称"
              value={secondaryName}
              placeholder="例如：早餐"
              onChange={(event) => setSecondaryName(event.target.value)}
            />
          </Field>
        )}
        <Field label="图标">
          <div className="lj-icon-picker">
            {iconChoices.map((name) => (
              <button
                type="button"
                key={name}
                aria-label={`选择${iconLabels[name]}图标`}
                aria-pressed={icon === name}
                className={icon === name ? 'selected' : ''}
                onClick={() => setIcon(name)}
              >
                <Icon name={name} size={22} />
              </button>
            ))}
          </div>
        </Field>
        <p className="lj-help">
          分类按完整路径关联历史和新记录。同名的二级分类可以属于不同一级分类。
        </p>
        <div className="lj-form-actions">
          <button type="button" className="lj-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="lj-primary" disabled={busy}>
            {busy ? '正在保存…' : '保存分类'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AccountForm({
  state,
  bookId,
  busy,
  commit,
  account,
  onClose,
  onSaved,
}: PageProps & { account?: Account; onClose: () => void; onSaved?: (id: string) => void }) {
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'wallet');
  const [amount, setAmount] = useState(account ? moneyInput(account.openingBalanceCents) : '0.00');
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    let openingBalanceCents: number;
    try {
      openingBalanceCents = parseMoneyToCents(amount, { allowZero: true, allowNegative: true });
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    let id = '';
    const saved = await commit((current) => {
      const result = upsertAccount(current, {
        id: account?.id,
        bookId,
        name,
        kind,
        openingBalanceCents,
      });
      id = result.accountId;
      return result.state;
    }, '账户已保存');
    if (saved) {
      onSaved?.(id);
      onClose();
    }
  };
  return (
    <Modal title={account ? '编辑账户' : '新建账户'} busy={busy} onClose={onClose}>
      <form className="lj-form" onSubmit={(event) => void submit(event)}>
        <Field label="账户名称">
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            aria-label="账户名称"
            placeholder="例如：微信钱包"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="账户类型">
          <select
            value={kind}
            aria-label="账户类型"
            onChange={(event) => setKind(event.target.value as AccountKind)}
          >
            <option value="cash">现金</option>
            <option value="wallet">电子钱包</option>
            <option value="bank">银行卡</option>
            <option value="other">其他账户</option>
          </select>
        </Field>
        <Field
          label="期初余额"
          hint="指开始使用本账本之前的余额，后续收支会在此基础上累计。可填写负数。"
        >
          <input
            value={amount}
            aria-label="期初余额"
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        {account && (
          <p className="lj-help">
            当前余额：¥{formatMoney(accountBalance(state, account.id))}
            。修改期初余额会相应改变当前余额；账户改名不会断开历史流水。
          </p>
        )}
        {error && (
          <p className="lj-inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="lj-form-actions">
          <button type="button" className="lj-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="lj-primary" disabled={busy}>
            {busy ? '正在保存…' : '保存账户'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function BookForm({
  state,
  bookId,
  busy,
  commit,
  book,
  onClose,
}: PageProps & { book?: Book; onClose: () => void }) {
  const [name, setName] = useState(book?.name ?? '');
  return (
    <Modal title={book ? '修改账本名称' : '新建账本'} busy={busy} onClose={onClose}>
      <form
        className="lj-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const success = await commit(
            (current) =>
              book ? renameBook(current, book.id, name) : createBook(current, name).state,
            book ? '账本已改名' : '账本已创建',
          );
          if (success) onClose();
        }}
      >
        <Field label="账本名称">
          <input
            required
            autoFocus
            aria-label="账本名称"
            maxLength={120}
            placeholder="例如：家庭账本"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <p className="lj-help">每个账本有独立的分类、账户和报表。新账本不会自动加入演示记录。</p>
        <div className="lj-form-actions">
          <button type="button" className="lj-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="lj-primary" disabled={busy}>
            {busy ? '正在保存…' : '保存账本'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function BudgetForm({
  state,
  bookId,
  busy,
  commit,
  budget,
  month: initialMonth,
  initialPeriod = 'month',
  initialDate = localDate(),
  onClose,
}: PageProps & {
  budget?: Budget;
  month: string;
  initialPeriod?: BudgetPeriod;
  initialDate?: string;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(budget?.month ?? initialMonth);
  const [period] = useState(budget ? budgetPeriod(budget) : initialPeriod);
  const [date, setDate] = useState(budget?.anchorDate ?? initialDate);
  const [recurring, setRecurring] = useState(budget ? budget.recurring === true : true);
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? 'all');
  const [amount, setAmount] = useState(budget ? moneyInput(budget.amountCents) : '');
  const [error, setError] = useState('');
  const expenseCategories = state.categories
    .filter(
      (item) =>
        item.bookId === bookId &&
        item.direction === 'expense' &&
        (!item.archived || item.id === budget?.categoryId),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <Modal
      title={budget ? '调整预算' : `设置${{ day: '日', week: '周', month: '月' }[period]}预算`}
      busy={busy}
      onClose={onClose}
    >
      <form
        className="lj-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          let cents: number;
          try {
            cents = parseMoneyToCents(amount);
          } catch (cause) {
            setError((cause as Error).message);
            return;
          }
          const ok = await commit(
            (current) =>
              setPeriodBudget(current, {
                id: budget?.id,
                bookId,
                period,
                recurring,
                anchorDate: period === 'month' ? `${month}-01` : date,
                categoryId: categoryId === 'all' ? null : categoryId,
                amountCents: cents,
              }),
            '预算已保存',
          );
          if (ok) onClose();
        }}
      >
        <label className="lj-help">
          <input
            type="checkbox"
            aria-label="每期重复预算"
            checked={recurring}
            disabled={!!budget}
            onChange={(event) => setRecurring(event.target.checked)}
          />{' '}
          每{{ day: '天', week: '周', month: '月' }[period]}重复使用这个额度
        </label>
        {!recurring && period === 'month' && (
          <Field label="预算月份">
            <input
              aria-label="预算月份"
              type="month"
              required
              disabled={!!budget}
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </Field>
        )}
        {!recurring && period !== 'month' && (
          <Field label="预算日期">
            <input
              aria-label="预算日期"
              type="date"
              value={date}
              required
              disabled={!!budget}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
        )}
        <Field label="预算范围">
          <select
            value={categoryId}
            disabled={!!budget}
            aria-label="预算范围"
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="all">整个账本</option>
            {expenseCategories.map((category) => (
              <option value={category.id} key={category.id}>
                {category.parentId
                  ? `${state.categories.find((parent) => parent.id === category.parentId)?.name} / `
                  : ''}
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="预算金额">
          <input
            autoFocus
            aria-label="预算金额"
            inputMode="decimal"
            value={amount}
            placeholder="0.00"
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        {error && (
          <p className="lj-inline-error" role="alert">
            {error}
          </p>
        )}
        <p className="lj-help">预算只用于提醒，不会新增或改变任何流水。</p>
        <div className="lj-form-actions">
          <button type="button" className="lj-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="lj-primary" disabled={busy}>
            {busy ? '正在保存…' : '保存预算'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
