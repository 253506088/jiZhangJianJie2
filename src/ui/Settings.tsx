import { useMemo, useState, type ReactNode } from 'react';
import {
  budgetProgressForRecord,
  periodBudgetProgress,
  localDate,
  categoryPath,
  formatMoney,
  removeBudget,
  removeTemplate,
  updateSettings,
  type AccentColor,
  type HomeLayout,
  type Budget,
  type BudgetPeriod,
  type ImportBatch,
  type Theme,
  type TransactionTemplate,
} from '../core';
import type { PageProps, Route } from './contracts';
import { BudgetForm } from './forms';
import { Icon } from './Icon';
import { ConfirmModal, EmptyState, Modal, MonthPicker, PageHeader } from './shared';

export function DataSettings({
  state,
  bookId,
  busy,
  commit,
  onBack,
  navigate,
  onImport,
  onExport,
  onExcelExport,
  onRestore,
  onHistory,
  dataTools,
}: PageProps & {
  onBack: () => void;
  navigate: (route: Route) => void;
  onImport: () => void;
  onExport: () => void;
  onExcelExport?: () => void;
  onRestore: () => void;
  onHistory: () => void;
  dataTools?: ReactNode;
}) {
  const [showImports, setShowImports] = useState(false);
  const imports = state.imports
    .filter((item) => item.bookId === bookId)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  const existingIds = useMemo(
    () => new Set(state.transactions.map((item) => item.id)),
    [state.transactions],
  );
  const actions = [
    {
      icon: 'category',
      title: '分类管理',
      text: '支出两级分类、收入类别、改名与合并',
      run: () => navigate({ screen: 'categories' }),
    },
    {
      icon: 'book',
      title: '我的账本',
      text: '每本账独立管理',
      run: () => navigate({ screen: 'books' }),
    },
    {
      icon: 'wallet',
      title: '我的账户',
      text: '账户余额与期初设置',
      run: () => navigate({ screen: 'accounts' }),
    },
    {
      icon: 'layers',
      title: '模板记账',
      text: '常用记录，一次设置反复使用',
      run: () => navigate({ screen: 'templates' }),
    },
    {
      icon: 'members',
      title: '成员管理',
      text: '按成员记录日常收支',
      run: () => navigate({ screen: 'members' }),
    },
    {
      icon: 'loan',
      title: '借贷人管理',
      text: '借入、借出、还款与收款往来',
      run: () => navigate({ screen: 'loanPeople' }),
    },
    {
      icon: 'chart',
      title: '月度预算',
      text: '整本账与分类预算',
      run: () => navigate({ screen: 'budgets' }),
    },
  ];
  return (
    <section className="lj-screen">
      <PageHeader title="数据与设置" onBack={onBack} />
      <div className="lj-scroll lj-page-pad">
        <section className="lj-data-hero">
          <span className="lj-brand-mark">
            <Icon name="book" size={31} />
          </span>
          <h2>你的日常，只属于你</h2>
          <p>
            账本保存在本机，文件由你手动选择。
            <br />
            导入与备份不需要把内容上传到服务器。
          </p>
          <span className="lj-private-badge">
            <Icon name="shield" size={14} />
            本机账本
          </span>
        </section>
        <section className="lj-settings-group">
          <h3>日常管理</h3>
          {actions.map((action) => (
            <button
              className="lj-setting-row"
              key={action.title}
              disabled={busy}
              onClick={action.run}
            >
              <Icon name={action.icon} />
              <span>
                <strong>{action.title}</strong>
                <small>{action.text}</small>
              </span>
              <Icon name="right" size={17} />
            </button>
          ))}
        </section>
        <section className="lj-settings-group">
          <h3>导入与备份</h3>
          <button className="lj-setting-row" disabled={busy} onClick={onImport}>
            <Icon name="excel" />
            <span>
              <strong>从旧版 Excel 导入</strong>
              <small>预览字段和分类，再初始化账本</small>
            </span>
            <Icon name="right" size={17} />
          </button>
          <button className="lj-setting-row" disabled={busy} onClick={() => setShowImports(true)}>
            <Icon name="list" />
            <span>
              <strong>导入历史</strong>
              <small>{imports.length} 个导入批次</small>
            </span>
            <Icon name="right" size={17} />
          </button>
          {onExcelExport && (
            <button className="lj-setting-row" disabled={busy} onClick={onExcelExport}>
              <Icon name="excel" />
              <span>
                <strong>导出 Excel</strong>
                <small>按工作表导出收支、转账和借贷</small>
              </span>
              <Icon name="right" size={17} />
            </button>
          )}
          <button className="lj-setting-row" disabled={busy} onClick={onExport}>
            <Icon name="download" />
            <span>
              <strong>导出完整备份</strong>
              <small>保留账本、分类、流水和关联</small>
            </span>
            <Icon name="right" size={17} />
          </button>
          <button className="lj-setting-row" disabled={busy} onClick={onRestore}>
            <Icon name="upload" />
            <span>
              <strong>从完整备份恢复</strong>
              <small>覆盖前先核对备份内容</small>
            </span>
            <Icon name="right" size={17} />
          </button>
          <button className="lj-setting-row" disabled={busy} onClick={onHistory}>
            <Icon name="recovery" />
            <span>
              <strong>历史保存点</strong>
              <small>查看最近的有效保存状态</small>
            </span>
            <Icon name="right" size={17} />
          </button>
        </section>
        <section className="lj-settings-group">
          <h3>显示偏好</h3>
          <div className="lj-home-layout-picker" aria-label="首页布局">
            {(
              [
                {
                  value: 'overview',
                  label: '概况首页',
                  text: '预算卡片、日周月收支',
                  icon: 'list',
                },
                {
                  value: 'classic',
                  label: '经典首页',
                  text: '圆形月度收支、常用入口',
                  icon: 'chart',
                },
              ] as const
            ).map((item) => (
              <button
                key={item.value}
                disabled={busy}
                className={state.settings.homeLayout === item.value ? 'selected' : ''}
                aria-pressed={state.settings.homeLayout === item.value}
                onClick={() =>
                  void commit(
                    (current) => updateSettings(current, { homeLayout: item.value as HomeLayout }),
                    '首页布局已更新',
                  )
                }
              >
                <Icon name={item.icon} size={24} />
                <strong>{item.label}</strong>
                <small>{item.text}</small>
              </button>
            ))}
          </div>
          <h3 className="lj-palette-heading">主题配色</h3>
          <div className="lj-color-picker" aria-label="主题配色">
            {(
              [
                ['blue', '蓝色', '#17b6ed'],
                ['pink', '粉色', '#db81a0'],
                ['yellow', '黄色', '#d9a428'],
                ['red', '红色', '#d96a64'],
                ['brown', '棕色', '#a87c62'],
                ['green', '绿色', '#7dad54'],
                ['gray', '灰色', '#8b9295'],
                ['teal', '蓝绿', '#45a798'],
                ['coral', '珊瑚', '#de856d'],
              ] as const
            ).map(([value, label, color]) => (
              <button
                key={value}
                disabled={busy}
                aria-label={`选择${label}配色`}
                aria-pressed={state.settings.accentColor === value}
                className={state.settings.accentColor === value ? 'selected' : ''}
                onClick={() =>
                  void commit((current) =>
                    updateSettings(current, { accentColor: value as AccentColor }),
                  )
                }
              >
                <span style={{ background: color }} />
                {label}
                {state.settings.accentColor === value && <Icon name="check" size={12} />}
              </button>
            ))}
          </div>
          <h3 className="lj-palette-heading">明暗模式</h3>
          <div className="lj-theme-picker" aria-label="界面主题">
            {(
              [
                { value: 'light', label: '暖白', icon: 'sunrise' },
                { value: 'dark', label: '夜间', icon: 'moon' },
                { value: 'system', label: '跟随系统', icon: 'settings' },
              ] as const
            ).map((item) => (
              <button
                key={item.value}
                className={state.settings.theme === item.value ? 'selected' : ''}
                aria-pressed={state.settings.theme === item.value}
                disabled={busy}
                onClick={() =>
                  void commit((current) => updateSettings(current, { theme: item.value as Theme }))
                }
              >
                <Icon name={item.icon} size={20} />
                {item.label}
              </button>
            ))}
          </div>
        </section>
        {dataTools}
        <p className="lj-help">
          卸载应用可能清除本机账本，换机前请导出完整备份。旧版 Excel 的导入记录不会替代完整备份。
        </p>
        <div className="lj-about">
          <Icon name="book" size={17} />
          简洁记账 · 本地版
        </div>
      </div>
      {showImports && (
        <Modal title="导入历史" wide busy={busy} onClose={() => setShowImports(false)}>
          <div className="lj-import-history">
            {imports.length ? (
              imports.map((batch) => (
                <ImportReceipt
                  key={batch.id}
                  batch={batch}
                  existing={batch.transactionIds.filter((id) => existingIds.has(id)).length}
                />
              ))
            ) : (
              <EmptyState
                title="还没有导入记录"
                text="通过 Excel 导入完成后，这里会记录每个批次的结果。"
                icon="excel"
              />
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

function ImportReceipt({ batch, existing }: { batch: ImportBatch; existing: number }) {
  return (
    <article className="lj-import-receipt">
      <div>
        <Icon name="excel" size={20} />
        <strong>{batch.fileName}</strong>
      </div>
      <small>{new Date(batch.importedAt).toLocaleString('zh-CN')}</small>
      <dl>
        <div>
          <dt>来源数据行</dt>
          <dd>{batch.totalRows}</dd>
        </div>
        <div>
          <dt>导入 / 跳过 / 错误</dt>
          <dd>
            {batch.importedRows} / {batch.skippedRows} / {batch.rejectedRows}
          </dd>
        </div>
        <div>
          <dt>当前仍在账本中</dt>
          <dd>{existing} 笔</dd>
        </div>
      </dl>
      {existing !== batch.importedRows && (
        <p>导入后可能有记录被删除；导入历史仍保留原始批次数量。</p>
      )}
    </article>
  );
}

export function Budgets({
  state,
  bookId,
  busy,
  commit,
  month,
  onMonth,
  onBack,
  initialPeriod = 'month',
}: PageProps & {
  month: string;
  onMonth: (month: string) => void;
  onBack: () => void;
  initialPeriod?: BudgetPeriod;
}) {
  const [editing, setEditing] = useState<Budget | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Budget | null>(null);
  const [period, setPeriod] = useState<BudgetPeriod>(initialPeriod);
  const [date, setDate] = useState(localDate().startsWith(month) ? localDate() : `${month}-01`);
  const selectedDate = period === 'month' ? `${month}-01` : date;
  const progress = periodBudgetProgress(state, bookId, selectedDate, period);
  const budgets = progress.budgets;
  return (
    <section className="lj-screen">
      <PageHeader
        title="日周月预算"
        onBack={onBack}
        action={
          <button
            className="lj-icon-button"
            disabled={busy}
            aria-label="新建预算"
            onClick={() => setEditing(null)}
          >
            <Icon name="plus" />
          </button>
        }
      />
      <div className="lj-scroll lj-page-pad">
        <div className="lj-segment" aria-label="预算周期">
          {(['day', 'week', 'month'] as const).map((value) => (
            <button
              key={value}
              disabled={busy}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {{ day: '日预算', week: '周预算', month: '月预算' }[value]}
            </button>
          ))}
        </div>
        {period === 'month' ? (
          <MonthPicker value={month} onChange={onMonth} />
        ) : (
          <label className="lj-form">
            查看日期
            <input
              aria-label="预算查看日期"
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
            />
          </label>
        )}
        <p className="lj-help">
          {progress.range.fromDate} 至 {progress.range.toDate} · 本期支出 ¥
          {formatMoney(progress.periodExpenseCents)}
        </p>
        {!budgets.length && (
          <EmptyState
            title="给这一期安排一份预算"
            text="预算只作提醒，超出时也不会影响正常记账。"
            icon="chart"
          >
            <button className="lj-primary" onClick={() => setEditing(null)}>
              设置预算
            </button>
          </EmptyState>
        )}
        <div className="lj-budget-cards">
          {budgets.map((budget) => {
            const result = budgetProgressForRecord(state, budget.id, selectedDate);
            return (
              <article className="lj-budget-card" key={budget.id}>
                <header>
                  <h2>
                    {budget.categoryId ? categoryPath(state, budget.categoryId).label : '整个账本'}
                    <small className="lj-help">
                      {budget.recurring ? ' · 每期重复' : ' · 仅本期'}
                    </small>
                  </h2>
                  <button
                    className="lj-icon-button"
                    aria-label={`编辑${budget.categoryId ? categoryPath(state, budget.categoryId).label : '整本账'}预算`}
                    disabled={busy}
                    onClick={() => setEditing(budget)}
                  >
                    <Icon name="edit" size={18} />
                  </button>
                </header>
                <div className="lj-budget-amount">
                  <strong className={result.remainingCents < 0 ? 'lj-danger-text' : ''}>
                    {formatMoney(result.spentCents)}
                  </strong>
                  <span>/ {formatMoney(budget.amountCents)}</span>
                </div>
                <div className="lj-budget-bar">
                  <span
                    className={result.ratio > 1 ? 'over' : ''}
                    style={{ width: `${Math.min(1, result.ratio) * 100}%` }}
                  />
                </div>
                <footer>
                  <span>
                    {result.remainingCents >= 0 ? '剩余' : '超出'} ¥
                    {formatMoney(Math.abs(result.remainingCents))}
                  </span>
                  <button
                    className="lj-text-button"
                    disabled={busy}
                    onClick={() => setDeleting(budget)}
                  >
                    移除预算
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
        <p className="lj-help">
          一级分类预算包含全部二级分类。有整本预算时以整本额度为准，否则按不重复分类范围汇总；各日、周、月预算独立。预算只提醒，不限制记账。
        </p>
      </div>
      {editing !== undefined && (
        <BudgetForm
          state={state}
          bookId={bookId}
          busy={busy}
          commit={commit}
          month={month}
          initialPeriod={period}
          initialDate={selectedDate}
          budget={editing ?? undefined}
          onClose={() => setEditing(undefined)}
        />
      )}{' '}
      {deleting && (
        <ConfirmModal
          title="移除这个预算？"
          busy={busy}
          confirmLabel="移除预算"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            if (await commit((current) => removeBudget(current, deleting.id), '预算已移除'))
              setDeleting(null);
          }}
        >
          <p>只移除预算提醒，所有流水保持不变。</p>
        </ConfirmModal>
      )}
    </section>
  );
}

export function Templates({
  state,
  bookId,
  busy,
  commit,
  onBack,
  onOpen,
}: PageProps & { onBack: () => void; onOpen: (templateId?: string, edit?: boolean) => void }) {
  const [deleting, setDeleting] = useState<TransactionTemplate | null>(null);
  const templates = state.templates.filter((item) => item.bookId === bookId);
  return (
    <section className="lj-screen">
      <PageHeader
        title="模板记账"
        onBack={onBack}
        action={
          <button
            className="lj-icon-button"
            disabled={busy}
            aria-label="新建模板"
            onClick={() => onOpen(undefined, true)}
          >
            <Icon name="plus" />
          </button>
        }
      />
      <div className="lj-scroll lj-page-pad">
        <p className="lj-page-intro">
          常用的分类、账户和备注先存成模板。使用时仍会确认金额与日期，再保存为一笔新账。
        </p>
        {!templates.length && (
          <EmptyState
            title="把常记的那一笔留下来"
            text="例如早餐、房租、交通费。模板本身不会计入流水。"
            icon="layers"
          >
            <button className="lj-primary" onClick={() => onOpen(undefined, true)}>
              新建模板
            </button>
          </EmptyState>
        )}
        <div className="lj-template-cards">
          {templates.map((template) => {
            const path = categoryPath(state, template.categoryId);
            const account = state.accounts.find((item) => item.id === template.accountId);
            const member = state.members.find((item) => item.id === template.memberId);
            const unavailable =
              path.category.archived ||
              path.parent?.archived ||
              account?.archived ||
              member?.archived ||
              !member;
            return (
              <article className="lj-template-card" key={template.id}>
                <button
                  className="lj-template-use"
                  disabled={busy || unavailable}
                  onClick={() => onOpen(template.id, false)}
                >
                  <span className={`lj-transaction-icon ${template.direction}`}>
                    <Icon name={path.category.icon} />
                  </span>
                  <span>
                    <strong>{template.name}</strong>
                    <small>
                      {path.label} · {account?.name}
                    </small>
                    {unavailable && <em>分类、账户或成员已归档，请先恢复或修改模板</em>}
                  </span>
                  <b className={template.direction === 'income' ? 'lj-income' : ''}>
                    {template.amountCents === null ? '填写金额' : formatMoney(template.amountCents)}
                  </b>
                </button>
                {template.note && <p>{template.note}</p>}
                <footer>
                  <button disabled={busy} onClick={() => onOpen(template.id, true)}>
                    <Icon name="edit" size={15} />
                    编辑模板
                  </button>
                  <button disabled={busy} onClick={() => setDeleting(template)}>
                    <Icon name="trash" size={15} />
                    删除
                  </button>
                  <button
                    className="lj-text-button"
                    disabled={busy || unavailable}
                    onClick={() => onOpen(template.id, false)}
                  >
                    记一笔
                    <Icon name="right" size={15} />
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      </div>
      {deleting && (
        <ConfirmModal
          title="删除这个模板？"
          busy={busy}
          danger
          confirmLabel="删除模板"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            if (await commit((current) => removeTemplate(current, deleting.id), '模板已删除'))
              setDeleting(null);
          }}
        >
          <p>{deleting.name}</p>
          <p>只删除模板，已经记入的流水不会改变。</p>
        </ConfirmModal>
      )}
    </section>
  );
}
