import { useMemo, useState } from 'react';
import {
  accountBalance,
  bookBalance,
  categoryPath,
  formatMoney,
  loanTotals,
  mergeCategories,
  previewCategoryMerge,
  renameCategory,
  reorderAccounts,
  reorderCategories,
  setAccountArchived,
  setBookArchived,
  setCategoryArchived,
  setCategoryIcon,
  updateSettings,
  type Account,
  type Book,
  type Category,
  type Direction,
} from '../core';
import type { PageProps } from './contracts';
import { AccountForm, BookForm, CategoryForm } from './forms';
import { Icon, iconChoices } from './Icon';
import { ConfirmModal, EmptyState, Field, Modal, PageHeader } from './shared';
import { categoryDisplayLabel } from './display';

function CategoryRenameForm({
  state,
  bookId,
  busy,
  commit,
  category,
  onClose,
}: PageProps & { category: Category; onClose: () => void }) {
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon);
  return (
    <Modal title="分类名称与图标" onClose={onClose} busy={busy}>
      <form
        className="lj-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const success = await commit(
            (current) =>
              setCategoryIcon(renameCategory(current, category.id, name), category.id, icon),
            '分类已更新，历史流水保持关联',
          );
          if (success) onClose();
        }}
      >
        <Field label="分类名称">
          <input
            autoFocus
            required
            aria-label="分类新名称"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="图标">
          <div className="lj-icon-picker">
            {iconChoices.map((value) => (
              <button
                type="button"
                key={value}
                aria-label={`分类图标 ${value}`}
                aria-pressed={icon === value}
                className={icon === value ? 'selected' : ''}
                onClick={() => setIcon(value)}
              >
                <Icon name={value} />
              </button>
            ))}
          </div>
        </Field>
        <p className="lj-help">
          改名会同步更新历史记录的显示，并保留原路径用于识别之后导入的旧数据。
        </p>
        <div className="lj-form-actions">
          <button type="button" className="lj-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="lj-primary" disabled={busy}>
            {busy ? '正在保存…' : '保存修改'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MergeCategoryForm({
  state,
  busy,
  commit,
  source,
  onClose,
}: PageProps & { source: Category; onClose: () => void }) {
  const candidates = state.categories.filter(
    (item) =>
      item.bookId === source.bookId &&
      item.direction === source.direction &&
      item.id !== source.id &&
      !item.archived &&
      (item.parentId === null) === (source.parentId === null),
  );
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');
  const preview = useMemo(() => {
    if (!targetId) return null;
    try {
      return { result: previewCategoryMerge(state, source.id, targetId), error: '' };
    } catch (cause) {
      return { result: null, error: (cause as Error).message };
    }
  }, [state, source.id, targetId]);
  return (
    <Modal title="合并分类" onClose={onClose} busy={busy}>
      <div className="lj-form">
        <div className="lj-merge-source">
          <span>把这个分类合并过去</span>
          <strong>{categoryDisplayLabel(state, source.id)}</strong>
        </div>
        <Field label="目标分类">
          <select
            aria-label="合并目标分类"
            value={targetId}
            onChange={(event) => {
              setTargetId(event.target.value);
              setError('');
            }}
          >
            <option value="">选择保留的分类</option>
            {candidates.map((target) => (
              <option key={target.id} value={target.id}>
                {categoryDisplayLabel(state, target.id)}
              </option>
            ))}
          </select>
        </Field>
        {!candidates.length && (
          <p className="lj-help">需要先创建另一个同层级、同收支类型的分类。</p>
        )}
        {preview?.result && (
          <section className="lj-merge-preview">
            <div>
              <span>来源</span>
              <strong>{preview.result.sourceLabel}</strong>
            </div>
            <Icon name="down" size={18} />
            <div>
              <span>保留</span>
              <strong>{preview.result.targetLabel}</strong>
            </div>
            <dl>
              <div>
                <dt>重新关联的流水</dt>
                <dd>{preview.result.affectedTransactions} 笔</dd>
              </div>
              <div>
                <dt>相关流水金额</dt>
                <dd>¥{formatMoney(preview.result.amountCents)}</dd>
              </div>
              <div>
                <dt>同步模板 / 预算</dt>
                <dd>
                  {preview.result.affectedTemplates} / {preview.result.affectedBudgets}
                </dd>
              </div>
            </dl>
          </section>
        )}
        <p className="lj-help">
          合并会移除源分类，将它的流水、模板和预算关联到目标分类；流水本身不会删除。原分类路径仍可识别后续导入的旧账。此操作影响整个账本，不限于当前月份。
        </p>
        {(error || preview?.error) && (
          <p className="lj-inline-error" role="alert">
            {error || preview?.error}
          </p>
        )}
        <div className="lj-form-actions">
          <button className="lj-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="lj-primary"
            disabled={busy || !preview?.result}
            onClick={async () => {
              const success = await commit(
                (current) => mergeCategories(current, source.id, targetId),
                '分类已合并，流水完整保留',
              );
              if (success) onClose();
            }}
          >
            {busy ? '正在保存…' : '确认合并'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Categories({
  state,
  bookId,
  busy,
  commit,
  onBack,
}: PageProps & { onBack: () => void }) {
  const [direction, setDirection] = useState<Direction>('expense');
  const [showArchived, setShowArchived] = useState(false);
  const [newForm, setNewForm] = useState<{ mode: 'path' | 'primary'; parentId?: string } | null>(
    null,
  );
  const [actionId, setActionId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [mergeId, setMergeId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const roots = state.categories
    .filter(
      (item) =>
        item.bookId === bookId &&
        item.direction === direction &&
        item.parentId === null &&
        (!item.archived || showArchived),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const item of state.transactions) {
      if (item.categoryId) result.set(item.categoryId, (result.get(item.categoryId) ?? 0) + 1);
    }
    return result;
  }, [state.transactions]);
  const count = (category: Category) =>
    category.parentId
      ? (counts.get(category.id) ?? 0)
      : state.categories
          .filter((item) => item.parentId === category.id)
          .reduce((sum, item) => sum + (counts.get(item.id) ?? 0), 0);
  const selected = state.categories.find((item) => item.id === actionId);
  const rename = state.categories.find((item) => item.id === renameId);
  const merge = state.categories.find((item) => item.id === mergeId);
  const archive = state.categories.find((item) => item.id === archiveId);
  const peers = selected
    ? state.categories
        .filter(
          (item) =>
            item.bookId === bookId &&
            item.direction === selected.direction &&
            item.parentId === selected.parentId,
        )
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  const position = peers.findIndex((item) => item.id === actionId);
  const move = async (delta: number) => {
    if (!selected) return;
    const saved = await commit((current) => {
      const same = current.categories
        .filter(
          (item) =>
            item.bookId === bookId &&
            item.direction === selected.direction &&
            item.parentId === selected.parentId,
        )
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => item.id);
      const index = same.indexOf(selected.id);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= same.length) return current;
      [same[index], same[next]] = [same[next], same[index]];
      return reorderCategories(current, same);
    }, '分类顺序已更新');
    if (saved) setActionId(null);
  };
  return (
    <section className="lj-screen">
      <PageHeader
        title="分类管理"
        onBack={onBack}
        action={
          <button
            className="lj-icon-button"
            aria-label="新建分类"
            disabled={busy}
            onClick={() => setNewForm({ mode: 'path' })}
          >
            <Icon name="plus" />
          </button>
        }
      />
      <div className="lj-scroll lj-page-pad">
        <div className="lj-segment">
          {(['expense', 'income'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={direction === value}
              className={direction === value ? 'selected' : ''}
              onClick={() => setDirection(value)}
            >
              {value === 'expense' ? '支出分类' : '收入分类'}
            </button>
          ))}
        </div>
        <div className="lj-management-tools">
          <label>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            显示归档分类
          </label>
          {direction === 'expense' && (
            <button
              className="lj-text-button"
              disabled={busy}
              onClick={() => setNewForm({ mode: 'primary' })}
            >
              <Icon name="plus" size={16} />
              一级分类
            </button>
          )}
        </div>
        {!roots.length && (
          <EmptyState
            title="分类从你的习惯开始"
            text="可以手动建立两级分类，也可以从旧版 Excel 一起导入。"
            icon="category"
          >
            <button className="lj-primary" onClick={() => setNewForm({ mode: 'path' })}>
              新建分类
            </button>
          </EmptyState>
        )}
        {direction === 'income' && (
          <div className="lj-income-management">
            {state.categories
              .filter(
                (item) =>
                  item.bookId === bookId &&
                  item.direction === 'income' &&
                  item.parentId !== null &&
                  (showArchived ||
                    (!item.archived &&
                      !state.categories.find((parent) => parent.id === item.parentId)?.archived)),
              )
              .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'))
              .map((category) => (
                <button
                  className={`lj-category-child ${category.archived ? 'is-archived' : ''}`}
                  key={category.id}
                  aria-label={`管理收入类别 ${categoryDisplayLabel(state, category.id)}`}
                  onClick={() => setActionId(category.id)}
                >
                  <Icon name={category.icon} size={20} />
                  <strong>{categoryDisplayLabel(state, category.id)}</strong>
                  {category.archived && <em>归档</em>}
                  <span>{count(category)} 笔</span>
                  <Icon name="right" size={15} />
                </button>
              ))}
          </div>
        )}
        {direction === 'expense' &&
          roots.map((root) => (
            <section
              className={`lj-category-group ${root.archived ? 'is-archived' : ''}`}
              key={root.id}
            >
              <header>
                <button
                  onClick={() => setActionId(root.id)}
                  aria-label={`管理一级分类 ${root.name}`}
                >
                  <span className="lj-category-group-icon">
                    <Icon name={root.icon} />
                  </span>
                  <span>
                    <strong>{root.name}</strong>
                    <small>
                      {count(root)} 笔{root.archived ? ' · 已归档' : ''}
                    </small>
                  </span>
                  <Icon name="more" size={19} />
                </button>
                <button
                  className="lj-icon-button"
                  disabled={busy || root.archived}
                  aria-label={`在${root.name}下添加二级分类`}
                  onClick={() => setNewForm({ mode: 'path', parentId: root.id })}
                >
                  <Icon name="plus" size={19} />
                </button>
              </header>
              <div>
                {state.categories
                  .filter(
                    (child) => child.parentId === root.id && (!child.archived || showArchived),
                  )
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((child) => (
                    <button
                      className={`lj-category-child ${child.archived ? 'is-archived' : ''}`}
                      key={child.id}
                      onClick={() => setActionId(child.id)}
                      aria-label={`管理二级分类 ${root.name} / ${child.name}`}
                    >
                      <Icon name={child.icon} size={19} />
                      <strong>{child.name}</strong>
                      {child.archived && <em>归档</em>}
                      <span>{count(child)} 笔</span>
                      <Icon name="right" size={15} />
                    </button>
                  ))}
              </div>
            </section>
          ))}
        <p className="lj-help">
          归档只从记账选项中隐藏分类，历史记录仍在。需要把旧名称和新名称统一统计时，使用“合并分类”。
        </p>
      </div>
      {newForm && (
        <CategoryForm
          state={state}
          bookId={bookId}
          busy={busy}
          commit={commit}
          direction={direction}
          mode={newForm.mode}
          initialPrimaryId={newForm.parentId}
          onClose={() => setNewForm(null)}
        />
      )}
      {selected && (
        <Modal
          title={categoryDisplayLabel(state, selected.id)}
          busy={busy}
          onClose={() => setActionId(null)}
        >
          <p className="lj-help">
            {count(selected)} 笔历史记录{selected.archived ? ' · 已归档' : ''}
          </p>
          <div className="lj-action-list">
            <button
              disabled={busy}
              onClick={() => {
                setRenameId(selected.id);
                setActionId(null);
              }}
            >
              <Icon name="edit" />
              修改名称与图标
              <Icon name="right" size={15} />
            </button>
            <div className="lj-action-pair">
              <button disabled={busy || position <= 0} onClick={() => void move(-1)}>
                <Icon name="up" />
                上移
              </button>
              <button
                disabled={busy || position < 0 || position >= peers.length - 1}
                onClick={() => void move(1)}
              >
                <Icon name="down" />
                下移
              </button>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                setMergeId(selected.id);
                setActionId(null);
              }}
            >
              <Icon name="merge" />
              合并到其他分类
              <Icon name="right" size={15} />
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setArchiveId(selected.id);
                setActionId(null);
              }}
            >
              <Icon name={selected.archived ? 'restore' : 'archive'} />
              {selected.archived ? '恢复使用' : '归档分类'}
              <Icon name="right" size={15} />
            </button>
          </div>
        </Modal>
      )}
      {rename && (
        <CategoryRenameForm
          state={state}
          bookId={bookId}
          busy={busy}
          commit={commit}
          category={rename}
          onClose={() => setRenameId(null)}
        />
      )}
      {merge && (
        <MergeCategoryForm
          state={state}
          bookId={bookId}
          busy={busy}
          commit={commit}
          source={merge}
          onClose={() => setMergeId(null)}
        />
      )}
      {archive && (
        <ConfirmModal
          title={archive.archived ? '恢复这个分类？' : '归档这个分类？'}
          busy={busy}
          confirmLabel={archive.archived ? '恢复使用' : '确认归档'}
          onClose={() => setArchiveId(null)}
          onConfirm={async () => {
            if (
              await commit(
                (current) => setCategoryArchived(current, archive.id, !archive.archived),
                archive.archived ? '分类已恢复' : '分类已归档，历史流水保持不变',
              )
            )
              setArchiveId(null);
          }}
        >
          <p>{categoryPath(state, archive.id).label}</p>
          <p>
            {archive.archived
              ? '恢复后可以继续选用该分类记账。'
              : '归档后不再用于新增记账，但所有历史流水和报表关联都会保留。'}
            {archive.parentId === null && !archive.archived
              ? '该一级分类下的二级分类会一起归档。'
              : ''}
          </p>
        </ConfirmModal>
      )}
    </section>
  );
}

export function Accounts({
  state,
  bookId,
  busy,
  commit,
  onBack,
  onDetails,
  onLoans,
}: PageProps & { onBack: () => void; onDetails: (id: string) => void; onLoans: () => void }) {
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Account | null | undefined>(undefined);
  const [actionId, setActionId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const accounts = state.accounts
    .filter((item) => item.bookId === bookId && (!item.archived || showArchived))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const action = state.accounts.find((item) => item.id === actionId);
  const archive = state.accounts.find((item) => item.id === archiveId);
  const loans = loanTotals(state, { bookId });
  const allAccounts = state.accounts
    .filter((item) => item.bookId === bookId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const position = allAccounts.findIndex((item) => item.id === actionId);
  const move = async (delta: number) => {
    if (!action) return;
    const saved = await commit((current) => {
      const list = current.accounts
        .filter((item) => item.bookId === bookId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => item.id);
      const index = list.indexOf(action.id);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= list.length) return current;
      [list[index], list[next]] = [list[next], list[index]];
      return reorderAccounts(current, bookId, list);
    }, '账户顺序已更新');
    if (saved) setActionId(null);
  };
  return (
    <section className="lj-screen">
      <PageHeader
        title="我的账户"
        onBack={onBack}
        action={
          <button
            className="lj-icon-button"
            disabled={busy}
            aria-label="新建账户"
            onClick={() => setEditing(null)}
          >
            <Icon name="plus" />
          </button>
        }
      />
      <div className="lj-scroll lj-page-pad">
        <section className="lj-account-total">
          <span>账户合计</span>
          <strong>
            <small>¥</small>
            {formatMoney(bookBalance(state, bookId))}
          </strong>
          <p>期初余额加上实际资金进出，借贷也会调整账户余额</p>
        </section>
        <button className="lj-loan-balance-summary" disabled={busy} onClick={onLoans}>
          <span>
            借贷净额<strong>{formatMoney(loans.netCents)}</strong>
          </span>
          <span>
            <small>借出未收 {formatMoney(loans.receivableCents)}</small>
            <small>借入未还 {formatMoney(loans.payableCents)}</small>
          </span>
          <Icon name="right" size={17} />
        </button>
        <p className="lj-help">
          借贷另行列示，不在上方账户合计中重复扣减。净额只依据本账本记录，未导入的历史不作推算。
        </p>
        <div className="lj-management-tools">
          <h2>账户列表</h2>
          <label>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            显示归档账户
          </label>
        </div>
        {!accounts.length && (
          <EmptyState
            title="添加一个记账账户"
            text="现金、银行卡或电子钱包，都可以独立记录。"
            icon="wallet"
          >
            <button className="lj-primary" onClick={() => setEditing(null)}>
              新建账户
            </button>
          </EmptyState>
        )}
        <div className="lj-account-cards">
          {accounts.map((account) => (
            <article
              key={account.id}
              className={`lj-account-card ${account.kind} ${account.archived ? 'is-archived' : ''}`}
            >
              <div>
                <span>
                  <Icon
                    name={
                      account.kind === 'bank' ? 'card' : account.kind === 'cash' ? 'cash' : 'wallet'
                    }
                    size={24}
                  />
                </span>
                <h3>{account.name}</h3>
                {account.archived && <small>已归档</small>}
                <button
                  className="lj-icon-button"
                  aria-label={`管理账户 ${account.name}`}
                  onClick={() => setActionId(account.id)}
                >
                  <Icon name="more" size={21} />
                </button>
              </div>
              <button
                className="lj-account-detail-button"
                onClick={() => onDetails(account.id)}
                aria-label={`查看${account.name}流水`}
              >
                <span>
                  余额<strong>{formatMoney(accountBalance(state, account.id))}</strong>
                </span>
                <span>
                  {
                    state.transactions.filter(
                      (item) => item.accountId === account.id || item.toAccountId === account.id,
                    ).length
                  }{' '}
                  笔流水
                  <Icon name="right" size={16} />
                </span>
              </button>
            </article>
          ))}
        </div>
        <p className="lj-help">
          账户之间转账不会改变总余额。归档账户仍保留历史流水，余额也计入合计。
        </p>
      </div>
      {editing !== undefined && (
        <AccountForm
          state={state}
          bookId={bookId}
          busy={busy}
          commit={commit}
          account={editing ?? undefined}
          onClose={() => setEditing(undefined)}
        />
      )}
      {action && (
        <Modal title={action.name} busy={busy} onClose={() => setActionId(null)}>
          <div className="lj-action-list">
            <button
              disabled={busy}
              onClick={() => {
                setEditing(action);
                setActionId(null);
              }}
            >
              <Icon name="edit" />
              修改名称与期初余额
              <Icon name="right" size={15} />
            </button>
            <div className="lj-action-pair">
              <button disabled={busy || position <= 0} onClick={() => void move(-1)}>
                <Icon name="up" />
                上移
              </button>
              <button
                disabled={busy || position < 0 || position >= allAccounts.length - 1}
                onClick={() => void move(1)}
              >
                <Icon name="down" />
                下移
              </button>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                setArchiveId(action.id);
                setActionId(null);
              }}
            >
              <Icon name={action.archived ? 'restore' : 'archive'} />
              {action.archived ? '恢复账户' : '归档账户'}
              <Icon name="right" size={15} />
            </button>
          </div>
        </Modal>
      )}
      {archive && (
        <ConfirmModal
          title={archive.archived ? '恢复账户？' : '归档账户？'}
          busy={busy}
          confirmLabel={archive.archived ? '恢复' : '归档'}
          onClose={() => setArchiveId(null)}
          onConfirm={async () => {
            if (
              await commit(
                (current) => setAccountArchived(current, archive.id, !archive.archived),
                archive.archived ? '账户已恢复' : '账户已归档',
              )
            )
              setArchiveId(null);
          }}
        >
          <p>{archive.name}</p>
          <p>
            {archive.archived
              ? '恢复后可以继续选择该账户记账。'
              : '账户会从新增记账选项中隐藏，历史流水与余额保持不变。'}
          </p>
        </ConfirmModal>
      )}
    </section>
  );
}

export function Books({ state, bookId, busy, commit, onBack }: PageProps & { onBack: () => void }) {
  const [editing, setEditing] = useState<Book | null | undefined>(undefined);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const archive = state.books.find((item) => item.id === archiveId);
  const enabled = state.books.filter((item) => !item.archived).length;
  return (
    <section className="lj-screen">
      <PageHeader
        title="我的账本"
        onBack={onBack}
        action={
          <button
            className="lj-icon-button"
            disabled={busy}
            aria-label="新建账本"
            onClick={() => setEditing(null)}
          >
            <Icon name="plus" />
          </button>
        }
      />
      <div className="lj-scroll lj-page-pad">
        <p className="lj-page-intro">
          生活、家庭、旅行，各自记得清楚。每本账的分类、账户和流水独立管理。
        </p>
        <div className="lj-book-cards">
          {state.books.map((book) => (
            <article
              className={`lj-book-card ${book.id === bookId ? 'selected' : ''} ${book.archived ? 'is-archived' : ''}`}
              key={book.id}
            >
              <button
                className="lj-book-select"
                disabled={busy || book.archived || book.id === bookId}
                onClick={() =>
                  void commit(
                    (current) => updateSettings(current, { selectedBookId: book.id }),
                    '已切换账本',
                  )
                }
                aria-label={`切换到${book.name}`}
              >
                <span className="lj-book-icon">
                  <Icon name="book" size={27} />
                </span>
                <span>
                  <strong>{book.name}</strong>
                  <small>
                    {state.transactions.filter((item) => item.bookId === book.id).length} 笔记录 ·{' '}
                    {
                      state.accounts.filter((item) => item.bookId === book.id && !item.archived)
                        .length
                    }{' '}
                    个账户{book.archived ? ' · 已归档' : ''}
                  </small>
                </span>
                {book.id === bookId ? (
                  <Icon name="check" size={19} />
                ) : (
                  <Icon name="right" size={18} />
                )}
              </button>
              <div className="lj-book-actions">
                <button disabled={busy} onClick={() => setEditing(book)}>
                  <Icon name="edit" size={15} />
                  改名
                </button>
                <button
                  disabled={busy || (!book.archived && enabled === 1)}
                  onClick={() => setArchiveId(book.id)}
                >
                  <Icon name={book.archived ? 'restore' : 'archive'} size={15} />
                  {book.archived ? '恢复' : '归档'}
                </button>
                {book.id === bookId && <span>当前账本</span>}
              </div>
            </article>
          ))}
        </div>
        <p className="lj-help">至少保留一个启用的账本。归档不会删除数据，需要时可以恢复。</p>
      </div>
      {editing !== undefined && (
        <BookForm
          state={state}
          bookId={bookId}
          busy={busy}
          commit={commit}
          book={editing ?? undefined}
          onClose={() => setEditing(undefined)}
        />
      )}{' '}
      {archive && (
        <ConfirmModal
          title={archive.archived ? '恢复账本？' : '归档账本？'}
          busy={busy}
          confirmLabel={archive.archived ? '恢复' : '归档'}
          onClose={() => setArchiveId(null)}
          onConfirm={async () => {
            if (
              await commit(
                (current) => setBookArchived(current, archive.id, !archive.archived),
                archive.archived ? '账本已恢复' : '账本已归档',
              )
            )
              setArchiveId(null);
          }}
        >
          <p>{archive.name}</p>
          <p>账本里的分类、账户、流水和导入记录都会完整保留。</p>
        </ConfirmModal>
      )}
    </section>
  );
}
