import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { ClipboardCheck, Download, X } from 'lucide-react';
import { localDate, type LedgerState } from '../core';
import { exactMoney, saveTextFile } from '../backup/files';
import { loadWorkbook } from '../imports/load-file';
import { reconciliationReport, type ComparedRecord, type ReconciliationResult } from './model';
import { runReconciliation } from './run';
import './panel.css';

export interface ReconciliationPanelProps {
  state: LedgerState;
  onClose: () => void;
}
export interface ReconciliationPanelHandle {
  requestClose(): boolean;
}
const labels = { expense: '支出', income: '收入', transfer: '转账', loan: '借贷' } as const;
const differenceLabels = {
  missing: '新版缺少',
  extra: '新版多出',
  amount: '金额不同',
  ambiguous: '对应不唯一',
} as const;

function recordLabel(record: ComparedRecord, legacy: boolean) {
  return legacy ? `${record.sheet}表第 ${record.row} 行` : `本年记录第 ${record.position} 笔`;
}
function RecordDetails({ record }: { record: ComparedRecord }) {
  return (
    <p className="rc-private">
      {record.date} {record.time} · ¥{exactMoney(String(record.amountCents))}
      <br />
      {[
        record.category,
        record.account,
        record.toAccount && `→ ${record.toAccount}`,
        record.member,
        record.person,
        record.loanType,
        record.transferType,
      ]
        .filter(Boolean)
        .join(' · ')}
      {record.note && (
        <>
          <br />
          备注：{record.note}
        </>
      )}
    </p>
  );
}

export const ReconciliationPanel = forwardRef<ReconciliationPanelHandle, ReconciliationPanelProps>(
  function ReconciliationPanel({ state, onClose }, ref) {
    const heading = useId();
    const dialog = useRef<HTMLDialogElement>(null);
    const controller = useRef<AbortController | null>(null);
    const alive = useRef(true);
    const phaseRef = useRef<'idle' | 'reading' | 'saving'>('idle');
    const [phase, setPhase] = useState<'idle' | 'reading' | 'saving'>('idle');
    const [bookId, setBookId] = useState(state.settings.selectedBookId);
    const [year, setYear] = useState(localDate().slice(0, 4));
    const [file, setFile] = useState<File | null>(null);
    const [result, setResult] = useState<ReconciliationResult | null>(null);
    const [resultState, setResultState] = useState<LedgerState | null>(null);
    const [privateDetails, setPrivateDetails] = useState(false);
    const [page, setPage] = useState(0);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [systemDark, setSystemDark] = useState(
      () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
    );
    const requestClose = () => {
      if (phaseRef.current === 'saving') return false;
      controller.current?.abort();
      onClose();
      return true;
    };
    useImperativeHandle(ref, () => ({ requestClose }));
    useEffect(() => {
      alive.current = true;
      dialog.current?.showModal();
      return () => {
        alive.current = false;
        controller.current?.abort();
      };
    }, []);
    useEffect(() => {
      if (typeof matchMedia === 'undefined') return;
      const media = matchMedia('(prefers-color-scheme: dark)');
      const update = () => setSystemDark(media.matches);
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }, []);
    const clear = () => {
      setResult(null);
      setResultState(null);
      setError('');
      setNotice('');
      setPage(0);
      setPrivateDetails(false);
    };
    const busy = phase !== 'idle';
    const stale = !!result && resultState !== state;
    const run = async () => {
      if (!file || phaseRef.current !== 'idle') return;
      clear();
      phaseRef.current = 'reading';
      setPhase('reading');
      const selected = new AbortController();
      controller.current = selected;
      try {
        if (!/\.xlsx?$/i.test(file.name)) throw new Error('请选择旧版导出的 .xls 或 .xlsx 文件。');
        const workbook = await loadWorkbook(file, selected.signal);
        const compared = await runReconciliation(
          state,
          workbook,
          { bookId, year: Number(year) },
          selected.signal,
        );
        if (alive.current && !selected.signal.aborted) {
          setResult(compared);
          setResultState(state);
        }
      } catch (cause) {
        if (alive.current && !selected.signal.aborted)
          setError(cause instanceof Error ? cause.message : '无法完成对账。');
      } finally {
        if (alive.current) {
          phaseRef.current = 'idle';
          setPhase('idle');
          controller.current = null;
        }
      }
    };
    const save = async () => {
      if (!result || stale || phaseRef.current !== 'idle') return;
      phaseRef.current = 'saving';
      setPhase('saving');
      setError('');
      setNotice('');
      try {
        const saved = await saveTextFile(
          reconciliationReport(result, privateDetails),
          `年度对账-${result.year}-${privateDetails ? '含明细' : '脱敏'}.json`,
        );
        if (alive.current)
          setNotice(
            saved.cancelled
              ? '已取消保存。'
              : saved.delivery === 'document'
                ? '对账报告已保存并校验。'
                : '已发起报告下载，请确认浏览器保存结果。',
          );
      } catch (cause) {
        if (alive.current) setError(cause instanceof Error ? cause.message : '报告保存失败。');
      } finally {
        if (alive.current) {
          phaseRef.current = 'idle';
          setPhase('idle');
        }
      }
    };
    return (
      <dialog
        ref={dialog}
        className="reconciliation-panel"
        aria-labelledby={heading}
        data-theme={
          state.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : state.settings.theme
        }
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) requestClose();
        }}
      >
        <header className="rc-header">
          <ClipboardCheck size={26} />
          <div>
            <h1 id={heading}>年度 Excel 对账</h1>
            <p>与旧版全年明细逐笔核对</p>
          </div>
          <button
            type="button"
            aria-label="关闭年度对账"
            disabled={phase === 'saving'}
            onClick={requestClose}
          >
            <X size={22} />
          </button>
        </header>
        <div className="rc-scroll">
          <p className="rc-help">
            在旧版按年导出
            Excel，在这里选择对应账本。按日期与分钟、完整分类路径、账户、成员或借贷人、类型和备注匹配，再核对每笔金额及重复笔数。对账只读取文件和当前账本。
          </p>
          <div className="rc-fields">
            <label>
              对账账本
              <select
                value={bookId}
                disabled={busy}
                onChange={(event) => {
                  setBookId(event.target.value);
                  clear();
                }}
              >
                {state.books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                    {book.archived ? '（已归档）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              对账年份
              <input
                type="number"
                inputMode="numeric"
                min="1900"
                max="9998"
                step="1"
                value={year}
                disabled={busy}
                onChange={(event) => {
                  setYear(event.target.value);
                  clear();
                }}
              />
            </label>
          </div>
          <label className="rc-file">
            旧版全年 Excel
            <input
              aria-label="选择年度对账Excel"
              type="file"
              accept=".xls,.xlsx"
              disabled={busy}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                clear();
              }}
            />
          </label>
          <button
            className="rc-primary"
            type="button"
            disabled={busy || !file || !/^\d{4}$/.test(year)}
            onClick={() => void run()}
          >
            {phase === 'reading' ? '正在读取与对账…' : '开始年度对账'}
          </button>
          {phase === 'reading' && (
            <button
              type="button"
              className="rc-secondary"
              onClick={() => controller.current?.abort()}
            >
              取消对账
            </button>
          )}
          {error && (
            <p className="rc-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="rc-help" role="status">
              {notice}
            </p>
          )}
          {result && (
            <section className="rc-results" aria-label="年度对账结果">
              <h2 className={result.passed && !stale ? 'rc-success' : 'rc-error'}>
                {stale
                  ? '账本已变化，请重新对账'
                  : result.passed
                    ? '本年明细逐笔一致'
                    : '本年对账尚未通过'}
              </h2>
              <p>
                旧版 {result.legacyCount} 笔 · 新版 {result.currentCount} 笔 · 完全匹配{' '}
                {result.matchedCount} 笔
              </p>
              <div className="rc-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th>旧版笔数</th>
                      <th>新版笔数</th>
                      <th>匹配笔数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(labels) as (keyof typeof labels)[]).map((type) => (
                      <tr key={type}>
                        <th>{labels[type]}</th>
                        <td>{result.counts[type].legacy}</td>
                        <td>{result.counts[type].current}</td>
                        <td>{result.counts[type].matched}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!!result.blockers.length && (
                <ul className="rc-blockers">
                  {result.blockers.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
              {!!result.invalidRows.length && (
                <p className="rc-error">
                  无法解析的来源：
                  {result.invalidRows
                    .slice(0, 30)
                    .map((row) => `${row.sheet}表第${row.row}行`)
                    .join('、')}
                  {result.invalidRows.length > 30 ? '…完整行号见报告' : ''}
                </p>
              )}
              <label className="rc-check">
                <input
                  type="checkbox"
                  checked={privateDetails}
                  disabled={busy}
                  onChange={(event) => setPrivateDetails(event.target.checked)}
                />
                显示并导出金额、日期、账户、备注等明细
              </label>
              <p className="rc-help">
                默认仅显示笔数和差异位置，报告不含金额或私人明细。分类的明确改名/合并历史会用于匹配；其他字段变化可能表现为一笔缺少、一笔多出。旧版
                Excel 没有稳定流水 ID，“对应不唯一”需人工确认。
              </p>
              {privateDetails && (
                <div className="rc-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>类型</th>
                        <th>旧版金额</th>
                        <th>新版金额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(labels) as (keyof typeof labels)[]).map((type) => (
                        <tr key={type}>
                          <th>{labels[type]}</th>
                          <td>¥{exactMoney(result.totals[type].legacyCents)}</td>
                          <td>¥{exactMoney(result.totals[type].currentCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!!result.differences.length && (
                <>
                  <h3>差异 {result.differences.length} 项</h3>
                  <ol className="rc-differences" start={page * 50 + 1}>
                    {result.differences
                      .slice(page * 50, page * 50 + 50)
                      .map((difference, index) => (
                        <li key={`${page}-${index}`}>
                          <strong>{differenceLabels[difference.kind]}</strong>
                          {difference.kind === 'ambiguous' && (
                            <p>
                              同组有 {difference.legacy.length} 笔旧版、{difference.current.length}{' '}
                              笔新版未匹配，金额组合不同，未强行指定对应关系。
                            </p>
                          )}
                          {(['legacy', 'current'] as const).map((side) => (
                            <div key={side}>
                              {difference[side].slice(0, 20).map((record) => (
                                <div key={record.position}>
                                  <span>{recordLabel(record, side === 'legacy')}</span>
                                  {privateDetails && <RecordDetails record={record} />}
                                </div>
                              ))}
                              {difference[side].length > 20 && (
                                <p>另有 {difference[side].length - 20} 笔，完整位置见报告。</p>
                              )}
                            </div>
                          ))}
                        </li>
                      ))}
                  </ol>
                  <div className="rc-pagination">
                    <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
                      上一页
                    </button>
                    <span>
                      {page + 1} / {Math.ceil(result.differences.length / 50)}
                    </span>
                    <button
                      type="button"
                      disabled={(page + 1) * 50 >= result.differences.length}
                      onClick={() => setPage(page + 1)}
                    >
                      下一页
                    </button>
                  </div>
                </>
              )}
              <button
                className="rc-secondary"
                type="button"
                disabled={busy || stale}
                onClick={() => void save()}
              >
                <Download size={17} />
                {phase === 'saving'
                  ? '正在保存…'
                  : privateDetails
                    ? '保存含明细报告'
                    : '保存脱敏报告'}
              </button>
            </section>
          )}
        </div>
        <footer className="rc-footer">
          <button
            className="rc-secondary"
            type="button"
            disabled={phase === 'saving'}
            onClick={requestClose}
          >
            返回
          </button>
        </footer>
      </dialog>
    );
  },
);
