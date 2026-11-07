import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  ChevronLeft,
  X,
  LoaderCircle,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { formatMoney, type LedgerState } from '../core';
import { applyImport, type ImportResult } from './apply';
import { loadWorkbook } from './load-file';
import { autoMapping, inferColumns } from './mapping';
import { prepareImport } from './plan';
import {
  columnLabels,
  type ColumnField,
  type ImportOptions,
  type ImportPlan,
  type SheetMapping,
  type WorkbookData,
} from './types';
import './wizard.css';

export interface ImportWizardHandle {
  requestClose(): boolean;
}
interface Props {
  state: LedgerState;
  onClose(): void;
  onApply(plan: ImportPlan, options: ImportOptions): Promise<ImportResult>;
  onComplete(result: ImportResult): void;
  onSaveReport(content: string, fileName: string): Promise<unknown>;
}

function letter(index: number) {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

export const ImportWizard = forwardRef<ImportWizardHandle, Props>(function ImportWizard(
  { state, onClose, onApply, onComplete, onSaveReport },
  ref,
) {
  const [step, setStep] = useState<'file' | 'mapping' | 'preview'>('file');
  const [workbook, setWorkbook] = useState<WorkbookData | null>(null);
  const [mappings, setMappings] = useState<SheetMapping[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [reading, setReading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [error, setError] = useState('');
  const [targetBookId, setTargetBookId] = useState(state.settings.selectedBookId);
  const [useBookColumn, setUseBookColumn] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [acceptRejected, setAcceptRejected] = useState(false);
  const [acceptOverlap, setAcceptOverlap] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const close = () => {
    if (writing.current || savingReport) return false;
    abort.current?.abort();
    onClose();
    return true;
  };
  useImperativeHandle(ref, () => ({ requestClose: close }));
  useEffect(() => {
    dialog.current?.showModal();
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    setAcceptRejected(false);
    setAcceptOverlap(false);
  }, [plan, targetBookId, useBookColumn, fromDate, toDate]);

  const selectFile = async (file: File) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setReading(true);
    setError('');
    try {
      const value = await loadWorkbook(file, controller.signal);
      setWorkbook(value);
      setMappings(value.sheets.map(autoMapping));
      setSheetIndex(0);
      setStep('mapping');
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '读取失败');
    } finally {
      if (!controller.signal.aborted) setReading(false);
    }
  };
  const mapping = mappings[sheetIndex];
  const sheet = workbook?.sheets[sheetIndex];
  const patchMapping = (patch: Partial<SheetMapping>) =>
    setMappings((values) =>
      values.map((item, index) => (index === sheetIndex ? { ...item, ...patch } : item)),
    );
  const columns = sheet?.rows[(mapping?.headerRow ?? 1) - 1] ?? [];
  const primaryFields: ColumnField[] =
    mapping?.defaultDirection === 'loan'
      ? ['date', 'amount', 'loanType', 'person', 'account', 'note']
      : mapping?.defaultDirection === 'transfer'
        ? ['date', 'amount', 'account', 'toAccount', 'transferType', 'member', 'note']
        : ['date', 'direction', 'amount', 'primary', 'secondary', 'account', 'member', 'note'];
  const fieldSelect = (field: ColumnField) => (
    <label key={field}>
      {columnLabels[field]}
      <select
        aria-label={`${columnLabels[field]}列`}
        value={mapping.columns[field] ?? ''}
        disabled={!mapping.enabled}
        onChange={(event) =>
          patchMapping({
            columns: {
              ...mapping.columns,
              [field]: event.target.value === '' ? null : Number(event.target.value),
            },
          })
        }
      >
        <option value="">未映射</option>
        {columns.map((value, index) => (
          <option key={index} value={index}>
            {letter(index)} · {String(value ?? '').slice(0, 70) || '无标题'}
          </option>
        ))}
      </select>
    </label>
  );
  const options: ImportOptions = {
    targetBookId,
    useBookColumn,
    allowRejectedRows: acceptRejected,
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
  };
  const preview = useMemo(() => {
    if (!plan) return { result: null, error: '' };
    try {
      return {
        result: applyImport(state, plan, {
          targetBookId,
          useBookColumn,
          allowRejectedRows: true,
          ...(fromDate ? { fromDate } : {}),
          ...(toDate ? { toDate } : {}),
        }),
        error: '',
      };
    } catch (cause) {
      return { result: null, error: cause instanceof Error ? cause.message : '预览失败' };
    }
  }, [plan, state, targetBookId, useBookColumn, fromDate, toDate]);
  const next = () => {
    if (!workbook) return;
    setError('');
    try {
      const value = prepareImport(workbook, mappings);
      setPlan(value);
      setStep('preview');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '字段映射不完整');
    }
  };
  const commit = async () => {
    if (!plan || writing.current || !preview.result?.added) return;
    writing.current = true;
    setApplying(true);
    setError('');
    try {
      const result = await onApply(plan, options);
      onComplete(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入未完成，原账本仍保留');
    } finally {
      writing.current = false;
      setApplying(false);
    }
  };
  const exportIssues = async () => {
    if (!plan) return;
    setSavingReport(true);
    setError('');
    const quote = (value: string | number) => {
      const text = String(value);
      return `"${(/^[=+@-]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"`;
    };
    const rows = [
      ['工作表', '原始行号', '类型', '原因'],
      ...plan.errors.map((item) => [item.sheet, item.row, '未导入', item.message]),
      ...(preview.result?.issues ?? plan.skipped).map((item) => [
        item.sheet,
        item.row,
        '跳过',
        item.message,
      ]),
    ];
    try {
      await onSaveReport(
        '\ufeff' + rows.map((row) => row.map(quote).join(',')).join('\r\n'),
        '导入检查报告.csv',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '报告未保存');
    } finally {
      setSavingReport(false);
    }
  };
  const allIssues = [...(plan?.errors ?? []), ...(preview.result?.issues ?? [])];
  const result = preview.result;
  const ready =
    !!result?.added &&
    !preview.error &&
    (!plan?.errors.length || acceptRejected) &&
    (!result.overlapCandidates || acceptOverlap);

  return (
    <dialog
      ref={dialog}
      className="import-dialog"
      data-theme={state.settings.theme}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="import-title"
    >
      <header className="import-header">
        <button aria-label="关闭Excel导入" onClick={close} disabled={applying || savingReport}>
          <X size={22} />
        </button>
        <div>
          <h1 id="import-title">导入旧账本</h1>
          <p>Excel 读取、分类初始化与流水校验</p>
        </div>
        <span>{step === 'file' ? '01' : step === 'mapping' ? '02' : '03'} / 03</span>
      </header>
      <div className="import-body">
        {step === 'file' && (
          <section className="import-file-step">
            <span className="import-file-icon">
              <FileSpreadsheet size={44} />
            </span>
            <h2>让旧账，接着记下去</h2>
            <p>
              选择简洁记账导出的 .xls 或 .xlsx，
              <br />
              先核对字段，再把分类和流水一起导入。
            </p>
            <button
              className="import-primary"
              onClick={() => fileInput.current?.click()}
              disabled={reading}
            >
              {reading ? (
                <>
                  <LoaderCircle className="import-spin" size={19} />
                  正在读取工作表…
                </>
              ) : (
                <>
                  选择 Excel 文件
                  <ArrowRight size={18} />
                </>
              )}
            </button>
            <p className="import-private">
              文件仅在此设备解析，不会上传。
              <br />
              导入前会展示结果；取消不会修改账本。
            </p>
            <small>支持 .xls / .xlsx / CSV，每个文件最多 32 MB。</small>
          </section>
        )}
        <input
          className="import-hidden"
          type="file"
          ref={fileInput}
          aria-label="选择Excel文件"
          accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void selectFile(file);
          }}
        />
        {step === 'mapping' && workbook && mapping && sheet && (
          <>
            <div className="import-file-summary">
              <FileSpreadsheet size={20} />
              <div>
                <strong>{workbook.fileName}</strong>
                <span>
                  {workbook.sheets.length} 张工作表 · {(workbook.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <button
                onClick={() => {
                  setStep('file');
                  setError('');
                }}
              >
                换一个文件
              </button>
            </div>
            <div className="import-sheet-row">
              <label>
                当前工作表
                <select
                  aria-label="当前工作表"
                  value={sheetIndex}
                  onChange={(event) => setSheetIndex(Number(event.target.value))}
                >
                  {workbook.sheets.map((item, index) => (
                    <option key={item.name} value={index}>
                      {item.name}（{item.rows.length} 行）
                    </option>
                  ))}
                </select>
              </label>
              <label className="import-check">
                <input
                  type="checkbox"
                  checked={mapping.enabled}
                  onChange={(event) => patchMapping({ enabled: event.target.checked })}
                />
                导入这张表
              </label>
            </div>
            <div className="import-header-row">
              <label>
                表头位于第
                <input
                  aria-label="表头行号"
                  type="number"
                  min="1"
                  max={sheet.rows.length || 1}
                  value={mapping.headerRow}
                  onChange={(event) => {
                    const headerRow = Number(event.target.value);
                    patchMapping({
                      headerRow,
                      columns: inferColumns(sheet.rows[headerRow - 1] ?? []),
                    });
                  }}
                />
                行
              </label>
              <span>自动识别是候选，请核对下方对应关系。</span>
            </div>
            <div className="import-mapping-grid">{primaryFields.map(fieldSelect)}</div>
            {mapping.legacyFormat && (
              <p className="import-note">
                已识别原版导出结构：第3行是表头，当前表按“{sheet.name}
                ”处理。收入的单层类别会保留原名称，成员与借贷人会一起初始化。
              </p>
            )}
            <details className="import-advanced">
              <summary>更多格式与字段选项</summary>
              <div className="import-mapping-grid">
                {(Object.keys(columnLabels) as ColumnField[])
                  .filter((field) => !primaryFields.includes(field))
                  .map(fieldSelect)}
                <label>
                  没有收支列时
                  <select
                    aria-label="默认收支类型"
                    value={mapping.defaultDirection ?? ''}
                    onChange={(event) =>
                      patchMapping({
                        defaultDirection:
                          (event.target.value as SheetMapping['defaultDirection']) || null,
                      })
                    }
                  >
                    <option value="">必须选择收支列</option>
                    <option value="expense">该表全部为支出</option>
                    <option value="income">该表全部为收入</option>
                    <option value="transfer">该表全部为转账</option>
                    <option value="loan">该表全部为借贷</option>
                    <option value="signed">金额正数收入、负数支出</option>
                  </select>
                </label>
                <label>
                  文字日期顺序
                  <select
                    value={mapping.dateOrder}
                    onChange={(event) =>
                      patchMapping({ dateOrder: event.target.value as SheetMapping['dateOrder'] })
                    }
                  >
                    <option value="ymd">年 / 月 / 日</option>
                    <option value="dmy">日 / 月 / 年</option>
                    <option value="mdy">月 / 日 / 年</option>
                  </select>
                </label>
                <label>
                  缺少账户时使用
                  <input
                    value={mapping.defaultAccount}
                    onChange={(event) => patchMapping({ defaultAccount: event.target.value })}
                  />
                </label>
                <label>
                  缺少成员时使用
                  <input
                    value={mapping.defaultMember}
                    onChange={(event) => patchMapping({ defaultMember: event.target.value })}
                  />
                </label>
                <label>
                  缺少借贷人时使用
                  <input
                    value={mapping.defaultPerson}
                    onChange={(event) => patchMapping({ defaultPerson: event.target.value })}
                  />
                </label>
                <label>
                  缺少一级分类时使用
                  <input
                    placeholder="请明确填写，避免猜测"
                    value={mapping.defaultPrimary}
                    onChange={(event) => patchMapping({ defaultPrimary: event.target.value })}
                  />
                </label>
                <label>
                  缺少二级分类时使用
                  <input
                    value={mapping.defaultSecondary}
                    onChange={(event) => patchMapping({ defaultSecondary: event.target.value })}
                  />
                </label>
                <label>
                  分类路径分隔符
                  <input
                    value={mapping.pathSeparator}
                    onChange={(event) => patchMapping({ pathSeparator: event.target.value })}
                  />
                </label>
                <label>
                  哪些值表示支出
                  <input
                    value={mapping.expenseLabels}
                    onChange={(event) => patchMapping({ expenseLabels: event.target.value })}
                  />
                </label>
                <label>
                  哪些值表示收入
                  <input
                    value={mapping.incomeLabels}
                    onChange={(event) => patchMapping({ incomeLabels: event.target.value })}
                  />
                </label>
                <label>
                  哪些值表示转账
                  <input
                    value={mapping.transferLabels}
                    onChange={(event) => patchMapping({ transferLabels: event.target.value })}
                  />
                </label>
                <label>
                  哪些值表示借贷
                  <input
                    value={mapping.loanLabels}
                    onChange={(event) => patchMapping({ loanLabels: event.target.value })}
                  />
                </label>
              </div>
              <p>
                多个收支值用逗号分隔。独立收入/支出金额列映射后优先于单一金额列。缺少二级分类时会明确使用“未细分”，可修改。
              </p>
            </details>
            <h2 className="import-section-title">原表前几行</h2>
            <div className="import-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>行</th>
                    {columns.map((value, index) => (
                      <th key={index}>
                        {letter(index)} · {String(value ?? '')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows
                    .slice(mapping.headerRow, mapping.headerRow + 5)
                    .map((cells, index) => (
                      <tr key={index}>
                        <th>{mapping.headerRow + index + 1}</th>
                        {columns.map((_, column) => (
                          <td key={column} title={String(cells[column] ?? '')}>
                            {String(cells[column] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="import-note">
              不清楚的字段可以重新选择。空白行与合计行会单独说明，不会当作流水。多张表请逐一核对。
            </p>
          </>
        )}
        {step === 'preview' && plan && (
          <>
            <div className="import-destination">
              <label>
                导入到
                <select
                  aria-label="导入目标账本"
                  value={targetBookId}
                  onChange={(event) => setTargetBookId(event.target.value)}
                  disabled={applying}
                >
                  {state.books
                    .filter((book) => !book.archived)
                    .map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="import-check">
                <input
                  type="checkbox"
                  checked={useBookColumn}
                  onChange={(event) => setUseBookColumn(event.target.checked)}
                  disabled={applying}
                />
                表格有账本列时，按原账本名称分别初始化
              </label>
              <div className="import-date-range">
                <label>
                  只导入此日期之后（含）
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(event) => setFromDate(event.target.value)}
                    disabled={applying}
                  />
                </label>
                <label>
                  至（含）
                  <input
                    type="date"
                    value={toDate}
                    onChange={(event) => setToDate(event.target.value)}
                    disabled={applying}
                  />
                </label>
              </div>
            </div>
            {result && (
              <>
                <div className="import-stat-grid">
                  <div>
                    <span>准备新增流水</span>
                    <strong>
                      {result.added}
                      <small>笔</small>
                    </strong>
                  </div>
                  <div>
                    <span>初始化分类</span>
                    <strong>
                      {result.createdCategories}
                      <small>个</small>
                    </strong>
                  </div>
                  <div>
                    <span>已导入 / 范围外</span>
                    <strong>
                      {result.duplicateRows + result.filteredRows}
                      <small>笔</small>
                    </strong>
                  </div>
                  <div>
                    <span>未通过校验</span>
                    <strong className={plan.errors.length ? 'import-danger' : ''}>
                      {plan.errors.length}
                      <small>行</small>
                    </strong>
                  </div>
                </div>
                <div className="import-amounts">
                  <span>
                    收入 <b>¥{formatMoney(result.totals.income)}</b>
                  </span>
                  <span>
                    支出 <b>¥{formatMoney(result.totals.expense)}</b>
                  </span>
                  {result.totals.transfer > 0 && (
                    <span>
                      转账 <b>¥{formatMoney(result.totals.transfer)}</b>
                    </span>
                  )}
                  {result.totals.loan > 0 && (
                    <span>
                      借贷流水金额 <b>¥{formatMoney(result.totals.loan)}</b>
                    </span>
                  )}
                </div>
                <div className="import-good">
                  <CheckCircle2 size={20} />
                  <p>
                    分类和流水将一起保存。以后选择相同分类记账，会和本次导入的数据统一统计。新建{' '}
                    {result.createdAccounts} 个账户、{result.createdBooks} 个账本。 成员{' '}
                    {result.createdMembers} 人、借贷人 {result.createdLoanPeople} 人会一并初始化。
                  </p>
                </div>
              </>
            )}
            {preview.error && (
              <div role="alert" className="import-error">
                {preview.error}
              </div>
            )}
            {!!plan.rows.filter((row) => row.warnings.length).length && (
              <p className="import-note">
                {plan.rows.filter((row) => row.warnings.length).length}{' '}
                条候选记录使用了默认分类、账户或成员标记，请核对映射。新建账户期初余额为
                0；表格未提供的期初余额需在账户设置中自行校准。
              </p>
            )}
            {!!result?.overlapCandidates && (
              <label className="import-warning import-check">
                <input
                  type="checkbox"
                  checked={acceptOverlap}
                  onChange={(event) => setAcceptOverlap(event.target.checked)}
                  disabled={applying}
                />
                <span>
                  有 {result.overlapCandidates}{' '}
                  笔与现有记录内容相同。我已核对日期范围，确认保留为独立记录。系统不会仅凭同额同日删除真实流水。
                </span>
              </label>
            )}
            {!!plan.errors.length && (
              <label className="import-warning import-check">
                <input
                  type="checkbox"
                  checked={acceptRejected}
                  onChange={(event) => setAcceptRejected(event.target.checked)}
                  disabled={applying}
                />
                <span>我已查看错误报告，选择仅导入有效行；{plan.errors.length} 行本次不导入。</span>
              </label>
            )}
            {!!allIssues.length && (
              <section className="import-issues">
                <div>
                  <h2>检查报告 · {allIssues.length} 行</h2>
                  <button onClick={() => void exportIssues()} disabled={savingReport || applying}>
                    {savingReport ? '保存中…' : '导出完整报告'}
                  </button>
                </div>
                <ul>
                  {allIssues.slice(0, 30).map((item, index) => (
                    <li key={index}>
                      <strong>
                        {item.sheet} · 第{item.row}行
                      </strong>
                      <span>{item.message}</span>
                    </li>
                  ))}
                </ul>
                {allIssues.length > 30 && <p>此处展示前30行，完整报告可导出。</p>}
              </section>
            )}
            <h2 className="import-section-title">有效记录预览</h2>
            <div className="import-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>来源</th>
                    <th>日期</th>
                    <th>收支</th>
                    <th>金额</th>
                    <th>分类</th>
                    <th>账户</th>
                    <th>成员 / 借贷人</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.slice(0, 20).map((row) => (
                    <tr key={`${row.sheet}:${row.row}`}>
                      <td>
                        {row.sheet}:{row.row}
                      </td>
                      <td>
                        {row.date} {row.time ?? ''}
                      </td>
                      <td>
                        {row.direction === 'expense'
                          ? '支出'
                          : row.direction === 'income'
                            ? '收入'
                            : row.direction === 'transfer'
                              ? '转账'
                              : { borrow: '借入', lend: '借出', repay: '还款', collect: '收款' }[
                                  row.loanType ?? 'borrow'
                                ]}
                      </td>
                      <td>{formatMoney(row.amountCents)}</td>
                      <td>
                        {row.direction === 'loan'
                          ? '借贷'
                          : row.direction === 'transfer'
                            ? (row.transferType ?? '转账')
                            : row.direction === 'income' && row.primary === '收入'
                              ? row.secondary
                              : row.primary + ' / ' + row.secondary}
                      </td>
                      <td>{row.account}</td>
                      <td>{row.direction === 'loan' ? row.person : row.member}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="import-note">
              展示前20条解析有效的记录；最终新增笔数以日期范围与重复检测后的统计为准。导入采用一次事务，失败时原账本保持完整。
            </p>
          </>
        )}
        {error && (
          <div className="import-error" role="alert">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}
      </div>
      {step !== 'file' && (
        <footer className="import-footer">
          <button
            className="import-secondary"
            disabled={applying || savingReport}
            onClick={() => {
              setError('');
              setStep(step === 'preview' ? 'mapping' : 'file');
            }}
          >
            <ChevronLeft size={18} />
            上一步
          </button>
          {step === 'mapping' ? (
            <button className="import-primary" onClick={next}>
              检查导入结果
              <ArrowRight size={18} />
            </button>
          ) : (
            <button
              className="import-primary"
              onClick={() => void commit()}
              disabled={!ready || applying || savingReport}
            >
              {applying ? (
                <>
                  <LoaderCircle className="import-spin" size={18} />
                  正在保存…
                </>
              ) : (
                <>确认导入 {result?.added ?? 0} 笔</>
              )}
            </button>
          )}
        </footer>
      )}
    </dialog>
  );
});
