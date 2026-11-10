import { useRef, useState } from 'react';
import {
  activeAccounts,
  activeCategories,
  activeMembers,
  activeLoanPeople,
  categoryPath,
  evaluateMoneyExpression,
  localDate,
  moneyInput,
  removeTransaction,
  upsertTemplate,
  upsertTransaction,
  type Transaction,
  type TransactionDirection,
  type TransactionTemplate,
  type LoanType,
} from '../core';
import type { PageProps } from './contracts';
import { AccountForm, CategoryForm } from './forms';
import { PersonForm } from './People';
import { categoryDisplayLabel, loanLabels } from './display';
import { initialEntrySelections, validOrdinarySelection } from './entry-selection-cache';
import { Icon } from './Icon';
import { ConfirmModal, EmptyState, Field, Modal, PageHeader, useBackLayer } from './shared';
import {
  assertTemplateUnchanged,
  assertTransactionUnchanged,
  resolveEditorSelection,
  nextExpenseCategory,
  searchEntryCategories,
} from './editor-state';
import './editor-enhancements.css';

function initialTime() {
  return new Date().toTimeString().slice(0, 5);
}

export function Editor({
  state,
  bookId,
  busy,
  commit,
  transaction,
  template,
  templateOnly = false,
  onBack,
  onDone,
}: PageProps & {
  transaction?: Transaction;
  template?: TransactionTemplate;
  templateOnly?: boolean;
  onBack: () => void;
  onDone: (destination: 'home' | 'details' | 'templates', month?: string) => void;
}) {
  const seedDirection = transaction?.direction ?? template?.direction ?? 'expense';
  const [selectionSeed] = useState(() =>
    initialEntrySelections(state, bookId, transaction, template),
  );
  const ordinarySelection = useRef(selectionSeed.ordinary);
  const loanAccount = useRef(selectionSeed.loanAccountId);
  const seedRoots = activeCategories(
    state,
    bookId,
    seedDirection === 'expense' || seedDirection === 'income' ? seedDirection : 'expense',
  );
  const seedCategoryId =
    transaction?.categoryId ??
    template?.categoryId ??
    (seedRoots[0]
      ? activeCategories(state, bookId, seedRoots[0].direction, seedRoots[0].id)[0]?.id
      : '') ??
    '';
  const seedParent =
    state.categories.find((item) => item.id === seedCategoryId)?.parentId ?? seedRoots[0]?.id ?? '';
  const [direction, setDirection] = useState<TransactionDirection>(seedDirection);
  const [parentId, setParentId] = useState(seedParent);
  const [categoryId, setCategoryId] = useState(seedCategoryId);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [accountId, setAccountId] = useState(
    seedDirection === 'loan' ? selectionSeed.loanAccountId : selectionSeed.ordinary.accountId,
  );
  const [toAccountId, setToAccountId] = useState(transaction?.toAccountId ?? '');
  const [memberId, setMemberId] = useState(selectionSeed.ordinary.memberId);
  const [loanType, setLoanType] = useState<LoanType>(transaction?.loanType ?? 'borrow');
  const [personId, setPersonId] = useState(transaction?.personId ?? '');
  const [personDialog, setPersonDialog] = useState<'member' | 'loan' | null>(null);
  const [expression, setExpression] = useState(
    transaction
      ? moneyInput(transaction.amountCents)
      : template?.amountCents
        ? moneyInput(template.amountCents)
        : '',
  );
  const [date, setDate] = useState(transaction?.date ?? localDate());
  const [time, setTime] = useState(transaction ? (transaction.time ?? '') : initialTime());
  const [note, setNote] = useState(transaction?.note ?? template?.note ?? '');
  const [templateName, setTemplateName] = useState(templateOnly ? (template?.name ?? '') : '');
  const [error, setError] = useState('');
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [categoryFormParent, setCategoryFormParent] = useState<string | undefined>(undefined);
  const [accountDialog, setAccountDialog] = useState(false);
  const [accountDialogTarget, setAccountDialogTarget] = useState<'source' | 'destination'>(
    'source',
  );
  const [templateDialog, setTemplateDialog] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(true);
  const amountInput = useRef<HTMLInputElement>(null);
  const lastExpenseCategory = useRef<string | undefined>(
    seedDirection === 'expense'
      ? seedCategoryId || undefined
      : nextExpenseCategory(state, bookId)?.id,
  );
  const [originalTransaction] = useState(() =>
    transaction ? structuredClone(transaction) : undefined,
  );
  const [originalTemplate] = useState(() =>
    templateOnly && template ? structuredClone(template) : undefined,
  );
  const { roots, selectedRoot, children, selectedChild, availableAccounts, selectedAccount } =
    resolveEditorSelection(state, {
      bookId,
      direction,
      parentId,
      categoryId,
      accountId,
      transaction: originalTransaction,
      template: originalTemplate,
    });
  const incomeCategories = state.categories
    .filter(
      (category) =>
        category.bookId === bookId &&
        category.direction === 'income' &&
        category.parentId !== null &&
        ((!category.archived &&
          !state.categories.find((parent) => parent.id === category.parentId)?.archived) ||
          category.id === originalTransaction?.categoryId ||
          category.id === originalTemplate?.categoryId),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'));
  const chosenCategory =
    direction === 'income'
      ? incomeCategories.find((category) => category.id === categoryId)
      : selectedChild;
  const isCategorized = direction === 'expense' || direction === 'income';
  const categoryResults = isCategorized
    ? searchEntryCategories(
        state,
        bookId,
        direction,
        categoryQuery,
        originalTransaction?.categoryId ?? originalTemplate?.categoryId,
      )
    : [];
  let calculatedAmount: string | undefined;
  if (/[+\-*/×÷−]/.test(expression)) {
    try {
      calculatedAmount = moneyInput(evaluateMoneyExpression(expression));
    } catch {
      // Incomplete expressions are expected during entry; explain them on calculate/save.
    }
  }
  const members = state.members
    .filter(
      (member) =>
        member.bookId === bookId &&
        (!member.archived ||
          member.id === originalTransaction?.memberId ||
          member.id === originalTemplate?.memberId),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const people = state.loanPeople
    .filter(
      (person) =>
        person.bookId === bookId &&
        (!person.archived || person.id === originalTransaction?.personId),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const isDirty = originalTransaction
    ? expression !== moneyInput(originalTransaction.amountCents) ||
      note !== originalTransaction.note ||
      date !== originalTransaction.date ||
      direction !== originalTransaction.direction ||
      (isCategorized ? (chosenCategory?.id ?? null) : null) !== originalTransaction.categoryId ||
      selectedAccount?.id !== originalTransaction.accountId ||
      toAccountId !== (originalTransaction.toAccountId ?? '') ||
      time !== (originalTransaction.time ?? '') ||
      (direction === 'loan' ? null : memberId) !== originalTransaction.memberId ||
      (direction === 'loan' ? loanType : null) !== originalTransaction.loanType ||
      (direction === 'loan' ? personId : null) !== originalTransaction.personId
    : originalTemplate
      ? expression !==
          (originalTemplate.amountCents === null ? '' : moneyInput(originalTemplate.amountCents)) ||
        note !== originalTemplate.note ||
        templateName !== originalTemplate.name ||
        direction !== originalTemplate.direction ||
        chosenCategory?.id !== originalTemplate.categoryId ||
        selectedAccount?.id !== originalTemplate.accountId ||
        memberId !== originalTemplate.memberId
      : Boolean(expression || note || (templateOnly && templateName));
  const requestBack = () => {
    if (busy) return;
    if (isDirty) setDiscard(true);
    else onBack();
  };
  useBackLayer(() => {
    if (busy) return;
    if (keyboardOpen) {
      setKeyboardOpen(false);
      return;
    }
    requestBack();
  });
  const selectDirection = (next: TransactionDirection) => {
    if (next === direction) return;
    if (direction === 'loan') loanAccount.current = accountId;
    else ordinarySelection.current = { accountId, memberId };
    if (next === 'loan') setAccountId(loanAccount.current);
    else {
      setAccountId(ordinarySelection.current.accountId);
      setMemberId(ordinarySelection.current.memberId);
    }
    if (direction === 'expense' && chosenCategory) lastExpenseCategory.current = chosenCategory.id;
    setDirection(next);
    setCategoryQuery('');
    setError('');
    if (next === 'expense' || next === 'income') {
      const root = activeCategories(state, bookId, next)[0];
      setParentId(root?.id ?? '');
      const firstIncome = incomeCategories.find(
        (category) =>
          category.bookId === bookId &&
          category.direction === 'income' &&
          category.parentId !== null &&
          !category.archived &&
          !state.categories.find((parent) => parent.id === category.parentId)?.archived,
      );
      setCategoryId(
        next === 'income'
          ? (firstIncome?.id ?? '')
          : root
            ? (activeCategories(state, bookId, next, root.id)[0]?.id ?? '')
            : '',
      );
    }
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
        setExpression(moneyInput(evaluateMoneyExpression(expression)));
      } catch (cause) {
        setError((cause as Error).message);
      }
      return;
    }
    if (['+', '-', '×', '÷'].includes(key)) {
      if (expression)
        setExpression((value) =>
          /[+\-×÷*/]$/.test(value)
            ? value.slice(0, -1) + key
            : value.length < 160
              ? value + key
              : value,
        );
      return;
    }
    setExpression((value) => {
      if (value.length >= 160) return value;
      const token = value.split(/[+\-×÷*/]/).at(-1) ?? '';
      if (key === '.') {
        const next = value + (token ? '.' : '0.');
        return token.includes('.') || next.length > 160 ? value : next;
      }
      if (
        (token.includes('.') && token.split('.')[1].length >= 2) ||
        (!token.includes('.') && token.length >= 9)
      )
        return value;
      return token === '0' ? value.slice(0, -1) + key : value + key;
    });
  };
  const saveTemplate = async () => {
    setError('');
    if (!isCategorized || !chosenCategory || !selectedAccount || !memberId) {
      setError('请选择收支分类与账户后保存模板');
      return;
    }
    let amountCents: number | null = null;
    try {
      if (expression) amountCents = evaluateMoneyExpression(expression);
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    const saved = await commit((current) => {
      if (originalTemplate) assertTemplateUnchanged(current, originalTemplate);
      return upsertTemplate(current, {
        id: templateOnly ? template?.id : undefined,
        bookId,
        name: templateName,
        direction: direction as 'expense' | 'income',
        categoryId: chosenCategory.id,
        accountId: selectedAccount.id,
        memberId,
        amountCents,
        note,
      });
    }, '模板已保存');
    if (saved) {
      setTemplateDialog(false);
      if (templateOnly) onDone('templates');
    }
  };
  const save = async (again: boolean) => {
    if (templateOnly) {
      await saveTemplate();
      return;
    }
    setError('');
    let amountCents: number;
    try {
      amountCents = evaluateMoneyExpression(expression);
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    if (!selectedAccount) {
      setError(availableAccounts.length ? '所选账户已变更，请重新选择账户' : '请先添加一个账户');
      return;
    }
    if (isCategorized && !chosenCategory) {
      setError(direction === 'income' ? '请先创建并选择收入类别' : '请先创建并选择二级分类');
      return;
    }
    if (direction === 'loan' && !personId) {
      setError('请先选择借贷人');
      return;
    }
    if (direction !== 'loan' && !memberId) {
      setError('请先选择成员');
      return;
    }
    const saved = await commit(
      (current) => {
        if (originalTransaction) assertTransactionUnchanged(current, originalTransaction);
        return upsertTransaction(current, {
          id: transaction?.id,
          bookId,
          direction,
          amountCents,
          date,
          time: time || null,
          accountId: selectedAccount.id,
          categoryId: isCategorized ? chosenCategory?.id : null,
          toAccountId: direction === 'transfer' ? toAccountId : null,
          memberId: direction === 'loan' ? null : memberId,
          loanType: direction === 'loan' ? loanType : null,
          personId: direction === 'loan' ? personId : null,
          note,
        });
      },
      again
        ? direction === 'income' || direction === 'transfer' || direction === 'loan'
          ? `${direction === 'income' ? '收入' : direction === 'transfer' ? '转账' : '借贷'}已保存，已回到支出，请确认账户、成员和分类`
          : '记好了，继续下一笔'
        : '账目已保存',
    );
    if (saved) {
      if (again) {
        setExpression('');
        setCategoryQuery('');
        setNote('');
        setDate(localDate());
        setTime(initialTime());
        if (direction === 'loan') {
          loanAccount.current = selectedAccount.id;
          const ordinary = validOrdinarySelection(state, bookId, ordinarySelection.current);
          ordinarySelection.current = ordinary;
          setAccountId(ordinary.accountId);
          setMemberId(ordinary.memberId);
        } else ordinarySelection.current = { accountId: selectedAccount.id, memberId };
        if (direction !== 'expense') {
          const next = nextExpenseCategory(state, bookId, lastExpenseCategory.current);
          setDirection('expense');
          setParentId(next?.parentId ?? '');
          setCategoryId(next?.id ?? '');
        }
        setKeyboardOpen(true);
        requestAnimationFrame(() => amountInput.current?.focus({ preventScroll: true }));
      } else onDone(transaction ? 'details' : 'home', date.slice(0, 7));
    }
  };
  return (
    <section className="lj-screen lj-editor">
      <PageHeader
        title={
          templateOnly ? (template ? '编辑模板' : '新建模板') : transaction ? '编辑账目' : '记一笔'
        }
        onBack={requestBack}
        action={
          transaction ? (
            <button
              className="lj-text-button lj-danger-text"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              删除
            </button>
          ) : !templateOnly && isCategorized ? (
            <button
              className="lj-text-button"
              disabled={busy}
              onClick={() => setTemplateDialog(true)}
            >
              存为模板
            </button>
          ) : undefined
        }
      />
      <fieldset className="lj-editor-content" disabled={busy} aria-label="记账信息">
        <div className="lj-entry-tools">
          <div className="lj-segment lj-entry-types" role="group" aria-label="记账类型">
            {(
              [
                'expense',
                'income',
                ...(!templateOnly ? ['transfer', 'loan'] : []),
              ] as TransactionDirection[]
            ).map((value) => (
              <button
                key={value}
                className={direction === value ? 'selected' : ''}
                aria-pressed={direction === value}
                disabled={busy}
                onClick={() => selectDirection(value)}
              >
                {value === 'expense'
                  ? '支出'
                  : value === 'income'
                    ? '收入'
                    : value === 'transfer'
                      ? '转账'
                      : '借贷'}
              </button>
            ))}
          </div>
          {isCategorized && (
            <div className="lj-category-search">
              <Icon name="search" size={16} />
              <input
                aria-label="搜索分类"
                placeholder="搜索分类"
                type="search"
                autoComplete="off"
                value={categoryQuery}
                maxLength={120}
                onFocus={() => setKeyboardOpen(false)}
                onChange={(event) => setCategoryQuery(event.target.value)}
              />
              {categoryQuery && (
                <button aria-label="清除分类搜索" onClick={() => setCategoryQuery('')}>
                  <Icon name="close" size={15} />
                </button>
              )}
            </div>
          )}
        </div>
        {templateOnly && (
          <Field label="模板名称">
            <input
              aria-label="模板名称"
              onFocus={() => setKeyboardOpen(false)}
              maxLength={120}
              value={templateName}
              placeholder="例如：工作日早餐"
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </Field>
        )}
        {isCategorized && categoryQuery.trim() ? (
          <section className="lj-category-results" aria-label="分类搜索结果">
            <p className="lj-category-search-summary" role="status">
              {categoryResults.length
                ? `找到 ${categoryResults.length} 个分类 · 已搜索全部一级分类`
                : '没有找到分类，试试其他关键词'}
            </p>
            {categoryResults.map(({ category, parent, path }) => (
              <button
                key={category.id}
                aria-label={path}
                aria-pressed={chosenCategory?.id === category.id}
                className={chosenCategory?.id === category.id ? 'selected' : ''}
                onClick={() => {
                  setParentId(parent.id);
                  setCategoryId(category.id);
                  setCategoryQuery('');
                  setKeyboardOpen(true);
                  requestAnimationFrame(() => amountInput.current?.focus({ preventScroll: true }));
                }}
              >
                <Icon name={category.icon} size={21} />
                <span>
                  {path}
                  {(category.archived || parent.archived) && <small>已归档</small>}
                </span>
                {chosenCategory?.id === category.id && <Icon name="check" size={17} />}
              </button>
            ))}
          </section>
        ) : direction === 'loan' ? (
          <section className="lj-loan-panel">
            <div className="lj-loan-types" aria-label="借贷类型">
              {(Object.entries(loanLabels) as [LoanType, string][]).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={loanType === value}
                  className={loanType === value ? 'selected' : ''}
                  onClick={() => setLoanType(value)}
                >
                  <Icon
                    name={value === 'borrow' || value === 'collect' ? 'income' : 'expense'}
                    size={19}
                  />
                  {label}
                </button>
              ))}
            </div>
            <Field label="借贷人">
              <select
                aria-label="借贷人"
                onFocus={() => setKeyboardOpen(false)}
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
              >
                <option value="">请选择对方</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.archived ? '（已归档）' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <button className="lj-text-button" onClick={() => setPersonDialog('loan')}>
              <Icon name="plus" size={17} />
              新建借贷人
            </button>
            <p className="lj-help">
              {loanType === 'borrow' || loanType === 'collect'
                ? '这笔钱进入所选账户。'
                : '这笔钱从所选账户转出。'}
              借贷单独记录，不计入普通收入或支出。
            </p>
          </section>
        ) : direction === 'transfer' ? (
          <section className="lj-transfer-panel">
            <span>
              <Icon name="transfer" size={29} />
            </span>
            <h2>账户之间转一笔</h2>
            <p>只调整余额，不计入收入或支出。</p>
            {transaction?.transferType && (
              <p className="lj-help">原转账类型：{transaction.transferType}</p>
            )}
            <Field label="转入账户">
              <select
                aria-label="转入账户"
                value={toAccountId}
                onChange={(event) => setToAccountId(event.target.value)}
              >
                <option value="">请选择转入账户</option>
                {availableAccounts
                  .filter((item) => item.id !== selectedAccount?.id)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {account.archived ? '（已归档）' : ''}
                    </option>
                  ))}
              </select>
            </Field>
            {availableAccounts.length < 2 && (
              <button
                className="lj-text-button"
                onClick={() => {
                  setAccountDialogTarget('destination');
                  setAccountDialog(true);
                }}
              >
                <Icon name="plus" size={16} />
                添加另一个账户
              </button>
            )}
          </section>
        ) : direction === 'income' ? (
          <div className="lj-income-selector" role="group" aria-label="收入类别">
            {incomeCategories.map((category) => (
              <button
                key={category.id}
                className={chosenCategory?.id === category.id ? 'selected' : ''}
                aria-pressed={chosenCategory?.id === category.id}
                onClick={() => {
                  setCategoryId(category.id);
                  setParentId(category.parentId ?? '');
                }}
              >
                <Icon name={category.icon} />
                <span>
                  {categoryDisplayLabel(state, category.id)}
                  {category.archived && <small>已归档</small>}
                </span>
                {chosenCategory?.id === category.id && <Icon name="check" size={17} />}
              </button>
            ))}
            {!incomeCategories.length && (
              <p className="lj-help">先建立一个收入类别，也可以从旧版表格一起导入。</p>
            )}
            <button className="lj-category-add" onClick={() => setCategoryDialog(true)}>
              <Icon name="plus" size={17} />
              新建收入类别
            </button>
          </div>
        ) : roots.length ? (
          <div className="lj-category-selector">
            <nav className="lj-parent-categories" aria-label="一级分类">
              {roots.map((root) => (
                <button
                  key={root.id}
                  className={selectedRoot?.id === root.id ? 'selected' : ''}
                  aria-pressed={selectedRoot?.id === root.id}
                  onClick={() => {
                    if (selectedRoot?.id === root.id) return;
                    setParentId(root.id);
                    setCategoryId(activeCategories(state, bookId, 'expense', root.id)[0]?.id ?? '');
                  }}
                >
                  <Icon name={root.icon} size={20} />
                  <span>
                    {root.name}
                    {root.archived && <small>已归档</small>}
                  </span>
                </button>
              ))}
              <button
                className="lj-category-add"
                onClick={() => {
                  setCategoryFormParent('new');
                  setCategoryDialog(true);
                }}
              >
                <Icon name="plus" size={18} />
                新分类
              </button>
            </nav>
            <div className="lj-child-categories" role="group" aria-label="二级分类">
              {children.map((child) => (
                <button
                  key={child.id}
                  className={selectedChild?.id === child.id ? 'selected' : ''}
                  aria-pressed={selectedChild?.id === child.id}
                  onClick={() => setCategoryId(child.id)}
                >
                  <span>
                    <Icon name={child.icon} size={21} />
                    {child.name}
                    {child.archived && <small>归档</small>}
                  </span>
                  {selectedChild?.id === child.id && <Icon name="check" size={17} />}
                </button>
              ))}
              {!children.length && <p className="lj-help">先在这个一级分类下添加一个二级分类。</p>}
              <button
                className="lj-category-add"
                onClick={() => {
                  setCategoryFormParent(selectedRoot?.id);
                  setCategoryDialog(true);
                }}
              >
                <Icon name="plus" size={17} />
                添加二级分类
              </button>
            </div>
          </div>
        ) : (
          <div className="lj-category-empty">
            <EmptyState
              title="先给这一笔选个分类"
              text="建立一级与二级分类，或返回首页导入旧版 Excel。"
              icon="category"
            >
              <button
                className="lj-secondary"
                onClick={() => {
                  setCategoryFormParent('new');
                  setCategoryDialog(true);
                }}
              >
                <Icon name="plus" size={18} />
                创建我的分类
              </button>
            </EmptyState>
          </div>
        )}
        <div className="lj-amount-panel">
          <label htmlFor="formal-entry-amount">
            <span>
              {direction === 'transfer'
                ? '转账金额'
                : direction === 'loan'
                  ? `${loanLabels[loanType]}金额`
                  : chosenCategory
                    ? categoryDisplayLabel(state, chosenCategory.id)
                    : '尚未选择分类'}
            </span>
            <small>{templateOnly ? '金额可留空' : '金额'}</small>
          </label>
          <div>
            <span>¥</span>
            <input
              id="formal-entry-amount"
              ref={amountInput}
              aria-label="金额"
              inputMode="none"
              autoComplete="off"
              maxLength={160}
              placeholder="0.00"
              value={expression}
              onFocus={(event) => {
                const input = event.currentTarget;
                setKeyboardOpen(true);
                requestAnimationFrame(() => input.scrollIntoView({ block: 'nearest' }));
              }}
              onClick={() => setKeyboardOpen(true)}
              onChange={(event) => {
                if (/^[\d.\s+\-*/×÷−]{0,160}$/.test(event.target.value)) {
                  setExpression(event.target.value);
                  setError('');
                }
              }}
            />
          </div>
          <p className="lj-calculation-help">
            {calculatedAmount && <output aria-label="计算预览">= ¥{calculatedAmount}</output>}
            <span>先乘除后加减，结果四舍五入到分</span>
          </p>
        </div>
        <div className="lj-entry-account">
          <Icon name="wallet" size={18} />
          <label>
            <span>{direction === 'transfer' ? '转出账户' : '账户'}</span>
            <select
              aria-label={direction === 'transfer' ? '转出账户' : '记账账户'}
              value={selectedAccount?.id ?? ''}
              onFocus={() => setKeyboardOpen(false)}
              onChange={(event) => {
                setAccountId(event.target.value);
                if (direction === 'loan') loanAccount.current = event.target.value;
                else ordinarySelection.current = { accountId: event.target.value, memberId };
                if (event.target.value === toAccountId) setToAccountId('');
              }}
            >
              {!selectedAccount && (
                <option value="">{availableAccounts.length ? '请重新选择账户' : '暂无账户'}</option>
              )}
              {availableAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                  {account.archived ? '（已归档）' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            className="lj-icon-button"
            aria-label="新建记账账户"
            onClick={() => {
              setAccountDialogTarget('source');
              setAccountDialog(true);
            }}
          >
            <Icon name="plus" size={18} />
          </button>
        </div>
        {direction !== 'loan' && (
          <div className="lj-entry-member">
            <Icon name="person" size={18} />
            <label>
              <span>成员</span>
              <select
                aria-label="成员"
                onFocus={() => setKeyboardOpen(false)}
                value={memberId}
                onChange={(event) => {
                  setMemberId(event.target.value);
                  ordinarySelection.current = { accountId, memberId: event.target.value };
                }}
              >
                {!members.some((member) => member.id === memberId) && (
                  <option value="">请选择成员</option>
                )}
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {member.archived ? '（已归档）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="lj-icon-button"
              aria-label="新建记账成员"
              onClick={() => setPersonDialog('member')}
            >
              <Icon name="plus" size={18} />
            </button>
          </div>
        )}
        {!templateOnly && (
          <div className="lj-entry-date">
            <label>
              <Icon name="calendar" size={17} />
              <input
                aria-label="记账日期"
                type="date"
                onFocus={() => setKeyboardOpen(false)}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label>
              <input
                aria-label="记账时间"
                type="time"
                onFocus={() => setKeyboardOpen(false)}
                step={time.length > 5 ? '1' : '60'}
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          </div>
        )}
        <label className="lj-note-field">
          <Icon name="list" size={17} />
          <textarea
            aria-label="备注"
            rows={1}
            maxLength={20000}
            value={note}
            onFocus={() => setKeyboardOpen(false)}
            placeholder="写点备注，帮自己记住"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        {error && (
          <p className="lj-inline-error" role="alert">
            {error}
          </p>
        )}
      </fieldset>
      <footer className="lj-editor-footer">
        <div className="lj-keyboard-toolbar">
          <span>{keyboardOpen ? '金额键盘' : '点击金额或展开键盘继续输入'}</span>
          <button
            disabled={busy}
            aria-label={keyboardOpen ? '收起金额键盘' : '展开金额键盘'}
            onClick={() => setKeyboardOpen((value) => !value)}
          >
            <Icon name={keyboardOpen ? 'down' : 'up'} size={16} />
            {keyboardOpen ? '完成' : '数字键盘'}
          </button>
        </div>
        {keyboardOpen && (
          <div className="lj-calculator" aria-label="金额键盘">
            {[
              '7',
              '8',
              '9',
              '÷',
              'C',
              '4',
              '5',
              '6',
              '×',
              'delete',
              '1',
              '2',
              '3',
              '-',
              '=',
              '0',
              '.',
              '+',
            ].map((key) => (
              <button
                disabled={busy}
                key={key}
                className={`${['+', '-', '×', '÷', '='].includes(key) ? 'operator' : ''} ${key === '=' ? 'equals' : key === '0' ? 'zero' : ''}`}
                aria-label={
                  key === 'delete'
                    ? '退格'
                    : key === 'C'
                      ? '清空金额'
                      : key === '='
                        ? '计算结果'
                        : key === '+'
                          ? '加'
                          : key === '-'
                            ? '减'
                            : key === '×'
                              ? '乘'
                              : key === '÷'
                                ? '除'
                                : key
                }
                onClick={() => pressKey(key)}
              >
                {key === 'delete' ? <Icon name="delete" size={23} /> : key === '-' ? '−' : key}
              </button>
            ))}
          </div>
        )}
        <div className="lj-save-actions">
          {!transaction && !templateOnly && (
            <button className="lj-secondary" disabled={busy} onClick={() => void save(true)}>
              再记一笔
            </button>
          )}
          <button className="lj-primary" disabled={busy} onClick={() => void save(false)}>
            <Icon name="check" size={20} />
            {busy ? '正在保存…' : templateOnly ? '保存模板' : '保存'}
          </button>
        </div>
      </footer>
      {categoryDialog && (direction === 'expense' || direction === 'income') && (
        <CategoryForm
          state={state}
          bookId={bookId}
          busy={busy}
          commit={commit}
          direction={direction}
          initialPrimaryId={categoryFormParent ?? selectedRoot?.id}
          onClose={() => {
            setCategoryDialog(false);
            setCategoryFormParent(undefined);
          }}
          onSaved={(id) => {
            setCategoryId(id);
            const existing = state.categories.find((item) => item.id === id);
            if (existing?.parentId) setParentId(existing.parentId);
          }}
        />
      )}
      {personDialog && (
        <PersonForm
          state={state}
          bookId={bookId}
          busy={busy}
          commit={commit}
          mode={personDialog}
          onClose={() => setPersonDialog(null)}
          onSaved={(id) => {
            if (personDialog === 'member') {
              setMemberId(id);
              ordinarySelection.current = { accountId, memberId: id };
            } else setPersonId(id);
          }}
        />
      )}
      {accountDialog && (
        <AccountForm
          state={state}
          bookId={bookId}
          busy={busy}
          commit={commit}
          onClose={() => setAccountDialog(false)}
          onSaved={(id) => {
            if (accountDialogTarget === 'destination') setToAccountId(id);
            else {
              setAccountId(id);
              if (direction === 'loan') loanAccount.current = id;
              else ordinarySelection.current = { accountId: id, memberId };
              if (toAccountId === id) setToAccountId('');
            }
          }}
        />
      )}
      {templateDialog && (
        <Modal title="保存为记账模板" busy={busy} onClose={() => setTemplateDialog(false)}>
          <form
            className="lj-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTemplate();
            }}
          >
            <Field label="模板名称">
              <input
                autoFocus
                required
                aria-label="新模板名称"
                maxLength={120}
                value={templateName}
                placeholder="例如：工作日早餐"
                onChange={(event) => setTemplateName(event.target.value)}
              />
            </Field>
            <p className="lj-help">
              保存分类、账户、金额和备注，下次记账可直接套用。不会额外记入一笔流水。
            </p>
            {error && (
              <p className="lj-inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="lj-form-actions">
              <button
                type="button"
                className="lj-secondary"
                disabled={busy}
                onClick={() => setTemplateDialog(false)}
              >
                取消
              </button>
              <button className="lj-primary" disabled={busy}>
                {busy ? '正在保存…' : '保存模板'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {discard && (
        <ConfirmModal
          title="离开这笔未保存的账目？"
          busy={busy}
          confirmLabel="放弃修改"
          onClose={() => setDiscard(false)}
          onConfirm={() => {
            setDiscard(false);
            onBack();
          }}
        >
          <p>当前输入尚未保存，离开后需要重新填写。</p>
        </ConfirmModal>
      )}
      {deleting && transaction && (
        <ConfirmModal
          title="删除这笔账目？"
          busy={busy}
          danger
          confirmLabel="确认删除"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            if (
              await commit((current) => {
                if (originalTransaction) assertTransactionUnchanged(current, originalTransaction);
                return removeTransaction(current, transaction.id);
              }, '账目已删除')
            )
              onDone('details');
          }}
        >
          <p>删除后，账户余额和收支统计会同步更新。不会影响其他流水。</p>
        </ConfirmModal>
      )}
    </section>
  );
}
