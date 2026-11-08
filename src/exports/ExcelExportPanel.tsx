import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { CalendarDays, Download, FileSpreadsheet, LoaderCircle, X } from 'lucide-react';
import { localDate, type AccentColor, type LedgerState } from '../core';
import { saveBinaryFile } from '../backup/files';
import { generateExcelExport } from './generate';
import {
  centsAsText,
  summarizeExcelExport,
  type ExcelExportFormat,
  type ExcelExportOptions,
} from './model';
import './panel.css';

export interface ExcelExportPanelProps {
  state: LedgerState;
  onClose: () => void;
  onSaved?: () => void;
}
export interface ExcelExportPanelHandle {
  /** Preparation is cancellable; a system save already in progress must finish or be cancelled in the picker. */
  requestClose(): boolean;
}

const palette: Record<AccentColor, [string, string, string]> = {
  blue: ['#17b6ed', '#e4f5fc', '#087da5'],
  pink: ['#db81a0', '#fbedf2', '#a34368'],
  yellow: ['#d9a428', '#fbf3dd', '#86600e'],
  red: ['#d96a64', '#fcece8', '#a83e39'],
  brown: ['#a87c62', '#f4ebe4', '#805139'],
  green: ['#7dad54', '#eff6e9', '#4c752b'],
  gray: ['#8b9295', '#edf0f1', '#60696e'],
  teal: ['#45a798', '#e5f5f1', '#207c70'],
  coral: ['#de856d', '#fbeddf', '#b85942'],
};

export const ExcelExportPanel = forwardRef<ExcelExportPanelHandle, ExcelExportPanelProps>(
  function ExcelExportPanel({ state, onClose, onSaved }, ref) {
    const headingId = useId();
    const dialog = useRef<HTMLDialogElement>(null);
    const alive = useRef(true);
    const generation = useRef(0);
    const controller = useRef<AbortController | null>(null);
    const phaseRef = useRef<'idle' | 'generating' | 'saving'>('idle');
    const [phase, setPhase] = useState<'idle' | 'generating' | 'saving'>('idle');
    const [bookId, setBookId] = useState(state.settings.selectedBookId);
    const [format, setFormat] = useState<ExcelExportFormat>('xlsx');
    const [allDates, setAllDates] = useState(true);
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [systemDark, setSystemDark] = useState(
      () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
    );
    const options = useMemo<ExcelExportOptions>(
      () => ({
        bookId,
        format,
        ...(!allDates && fromDate ? { fromDate } : {}),
        ...(!allDates && toDate ? { toDate } : {}),
      }),
      [bookId, format, allDates, fromDate, toDate],
    );
    const analysis = useMemo(() => {
      try {
        return { summary: summarizeExcelExport(state, options), error: '' };
      } catch (cause) {
        return {
          summary: null,
          error: cause instanceof Error ? cause.message : '暂时无法读取导出范围。',
        };
      }
    }, [state, options]);
    const summary = analysis.summary;
    const busy = phase !== 'idle';
    const requestClose = () => {
      if (phaseRef.current === 'saving') return false;
      controller.current?.abort();
      generation.current++;
      onClose();
      return true;
    };
    useImperativeHandle(ref, () => ({ requestClose }));
    useEffect(() => {
      alive.current = true;
      dialog.current?.showModal();
      return () => {
        alive.current = false;
        generation.current++;
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
    const changeBook = (value: string) => {
      setBookId(value);
      setAllDates(true);
      setFromDate('');
      setToDate('');
      setError('');
      setNotice('');
    };
    const exportFile = async (event: FormEvent) => {
      event.preventDefault();
      if (phaseRef.current !== 'idle' || !summary || summary.tooManyXlsRows) return;
      phaseRef.current = 'generating';
      setPhase('generating');
      setError('');
      setNotice('');
      const token = ++generation.current;
      const current = () => alive.current && generation.current === token;
      controller.current = new AbortController();
      try {
        const result = await generateExcelExport(state, options, controller.current.signal);
        if (!current()) return;
        phaseRef.current = 'saving';
        setPhase('saving');
        const saved = await saveBinaryFile(result.bytes, result.fileName, result.mimeType);
        if (!current()) return;
        if (saved.cancelled) {
          setNotice('已取消文件保存，账本没有改动。');
          return;
        }
        setNotice(
          saved.delivery === 'document'
            ? `已保存并校验 ${result.summary.count} 笔明细。`
            : `已发起 ${result.summary.count} 笔明细的下载，请确认浏览器保存结果。`,
        );
        onSaved?.();
      } catch (cause) {
        if (current() && !(cause instanceof DOMException && cause.name === 'AbortError'))
          setError(cause instanceof Error ? cause.message : 'Excel 导出未完成，账本没有改动。');
      } finally {
        if (current()) {
          phaseRef.current = 'idle';
          setPhase('idle');
          controller.current = null;
        }
      }
    };
    const theme =
      state.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : state.settings.theme;
    const [accent, soft, button] = palette[state.settings.accentColor];
    const variables = {
      '--xe-accent': accent,
      '--xe-soft': soft,
      '--xe-button': button,
    } as CSSProperties;
    return (
      <dialog
        ref={dialog}
        className="excel-export-panel"
        data-theme={theme}
        style={variables}
        aria-labelledby={headingId}
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) requestClose();
        }}
      >
        <header className="xe-header">
          <span className="xe-icon">
            <FileSpreadsheet size={24} />
          </span>
          <div>
            <h1 id={headingId}>导出 Excel</h1>
            <p>按账本与日期保存四类明细</p>
          </div>
          <button
            type="button"
            className="xe-close"
            aria-label="关闭Excel导出"
            disabled={phase === 'saving'}
            onClick={requestClose}
          >
            <X size={21} />
          </button>
        </header>
        <div className="xe-scroll">
          <form id="excel-export-form" onSubmit={exportFile}>
            <label className="xe-field">
              <span>导出账本</span>
              <select
                aria-label="导出账本"
                value={bookId}
                disabled={busy}
                onChange={(event) => changeBook(event.target.value)}
              >
                {state.books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                    {book.archived ? '（已归档）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <section className="xe-range">
              <label className="xe-check">
                <span>
                  <CalendarDays size={18} />
                  全部历史记录
                </span>
                <input
                  aria-label="导出全部历史"
                  type="checkbox"
                  checked={allDates}
                  disabled={busy}
                  onChange={(event) => {
                    setAllDates(event.target.checked);
                    if (!event.target.checked) {
                      setFromDate(summary?.firstDate ?? localDate());
                      setToDate(summary?.lastDate ?? localDate());
                    }
                    setError('');
                    setNotice('');
                  }}
                />
              </label>
              <div className="xe-date-fields">
                <label className="xe-field">
                  <span>开始日期</span>
                  <input
                    aria-label="导出开始日期"
                    type="date"
                    value={fromDate}
                    disabled={busy || allDates}
                    onChange={(event) => setFromDate(event.target.value)}
                  />
                </label>
                <label className="xe-field">
                  <span>结束日期</span>
                  <input
                    aria-label="导出结束日期"
                    type="date"
                    value={toDate}
                    disabled={busy || allDates}
                    onChange={(event) => setToDate(event.target.value)}
                  />
                </label>
              </div>
              <p className="xe-help">包含开始日和结束日；留空的一端不限制日期。</p>
            </section>
            <fieldset className="xe-formats">
              <legend>文件格式</legend>
              <label className={format === 'xlsx' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="excel-format"
                  value="xlsx"
                  checked={format === 'xlsx'}
                  disabled={busy}
                  onChange={() => setFormat('xlsx')}
                />
                <span>
                  <strong>XLSX</strong>
                  <small>推荐 · 适合较多明细</small>
                </span>
              </label>
              <label className={format === 'xls' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="excel-format"
                  value="xls"
                  checked={format === 'xls'}
                  disabled={busy}
                  onChange={() => setFormat('xls')}
                />
                <span>
                  <strong>XLS</strong>
                  <small>每张表最多 65,533 笔</small>
                </span>
              </label>
            </fieldset>
            {summary && (
              <section className="xe-summary" aria-label="Excel导出范围">
                <header>
                  <h2>将导出 {summary.count.toLocaleString('zh-CN')} 笔</h2>
                  <span>{summary.rangeLabel}</span>
                </header>
                <dl className="xe-counts">
                  {(
                    [
                      ['expense', '支出'],
                      ['income', '收入'],
                      ['transfer', '转账'],
                      ['loan', '借贷'],
                    ] as const
                  ).map(([type, label]) => (
                    <div key={type}>
                      <dt>{label}</dt>
                      <dd>
                        {summary.counts[type].toLocaleString('zh-CN')}
                        <small> 笔</small>
                      </dd>
                    </div>
                  ))}
                </dl>
                <dl className="xe-amounts">
                  <div>
                    <dt>普通收入</dt>
                    <dd>¥{centsAsText(BigInt(summary.exactTotals.income))}</dd>
                  </div>
                  <div>
                    <dt>普通支出</dt>
                    <dd>¥{centsAsText(BigInt(summary.exactTotals.expense))}</dd>
                  </div>
                </dl>
                <p className="xe-help">转账与借贷单独成表，不混入普通收支合计。</p>
              </section>
            )}
            <aside className="xe-boundary">
              <strong>Excel 用于交换明细，完整迁移请用完整备份</strong>
              <p>
                四张表采用原版字段，不包含稳定
                ID、期初余额、分类历史别名、预算或模板。空表也会保留表头，导出不会修改当前账本。
              </p>
              {!!summary?.flattenedIncomeRows && (
                <p>
                  {summary.flattenedIncomeRows} 笔收入有非原版的两级结构，将把完整“父 /
                  子”名称写入收入类别；旧格式只能保留可见名称，原样恢复这类结构请用完整备份。
                </p>
              )}
              {!!summary?.dateOnlyRows && (
                <p>{summary.dateOnlyRows} 笔记录没有具体时间，仅保留日期，不补造零点。</p>
              )}
            </aside>
            {summary?.tooManyXlsRows && (
              <p className="xe-error" role="alert">
                某张表超过 XLS 的 65,533 条上限，请改选 XLSX 或缩小范围。不会截断明细。
              </p>
            )}
            {(analysis.error || error) && (
              <p className="xe-error" role="alert">
                {error || analysis.error}
              </p>
            )}
            {notice && (
              <p className="xe-notice" role="status">
                {notice}
              </p>
            )}
          </form>
        </div>
        <footer className="xe-footer">
          {busy && (
            <div className="xe-progress" role="status">
              <LoaderCircle size={18} />
              <span>
                {phase === 'generating'
                  ? '正在生成工作簿，可取消准备…'
                  : '请选择保存位置，完成后校验文件…'}
              </span>
            </div>
          )}
          <div className="xe-actions">
            <button
              type="button"
              className="xe-secondary"
              disabled={phase === 'saving'}
              onClick={requestClose}
            >
              {phase === 'generating' ? '取消准备' : '返回'}
            </button>
            <button
              className="xe-primary"
              type="submit"
              form="excel-export-form"
              disabled={busy || !summary || !!analysis.error || summary.tooManyXlsRows}
            >
              <Download size={18} />
              {busy ? '正在导出…' : '生成并保存 Excel'}
            </button>
          </div>
        </footer>
      </dialog>
    );
  },
);
