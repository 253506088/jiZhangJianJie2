import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Database, LoaderCircle, X } from 'lucide-react';
import { formatMoney, type LedgerState } from '../core';
import { loadLegacyDatabase } from './load-file';
import { applyLegacyDatabase } from './prepare';
import type { LegacyDbPlan } from './types';
import './panel.css';

export interface LegacyDbImportHandle {
  requestClose(): boolean;
}
interface Props {
  state: LedgerState;
  onClose(): void;
  onApply(plan: LegacyDbPlan, bookName: string): Promise<void>;
}
export const LegacyDbImportPanel = forwardRef<LegacyDbImportHandle, Props>(
  function LegacyDbImportPanel({ state, onClose, onApply }, ref) {
    const dialog = useRef<HTMLDialogElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const abort = useRef<AbortController | null>(null);
    const writing = useRef(false);
    const [reading, setReading] = useState(false);
    const [applying, setApplying] = useState(false);
    const [plan, setPlan] = useState<LegacyDbPlan | null>(null);
    const [bookName, setBookName] = useState('旧版账本');
    const [confirmed, setConfirmed] = useState(false);
    const [error, setError] = useState('');
    const [complete, setComplete] = useState(false);
    const [systemDark, setSystemDark] = useState(
      () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
    );
    const close = () => {
      if (writing.current) return false;
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
      if (typeof matchMedia === 'undefined') return;
      const media = matchMedia('(prefers-color-scheme: dark)');
      const update = () => setSystemDark(media.matches);
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }, []);
    const read = async (file: File) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setReading(true);
      setPlan(null);
      setError('');
      setConfirmed(false);
      setComplete(false);
      try {
        const result = await loadLegacyDatabase(file, controller.signal);
        if (!controller.signal.aborted) setPlan(result);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '读取失败。');
      } finally {
        if (!controller.signal.aborted) setReading(false);
      }
    };
    const apply = async () => {
      if (!plan || !confirmed || writing.current) return;
      writing.current = true;
      setApplying(true);
      setError('');
      try {
        // Recheck against the current state before handing the same mutation to the repository.
        applyLegacyDatabase(state, plan, bookName);
        await onApply(plan, bookName.trim());
        setComplete(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '导入失败，现有账本未更改。');
      } finally {
        writing.current = false;
        setApplying(false);
      }
    };
    const theme =
      state.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : state.settings.theme;
    return (
      <dialog
        ref={dialog}
        className="legacy-db-dialog"
        data-theme={theme}
        aria-labelledby="legacy-db-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <header>
          <h2 id="legacy-db-title">
            <Database size={22} /> 从旧版 .db 初始化
          </h2>
          <button aria-label="关闭旧版数据库导入" disabled={applying} onClick={close}>
            <X size={22} />
          </button>
        </header>
        <div className="legacy-db-content">
          {complete ? (
            <div role="status">
              <h3>旧版账本已导入</h3>
              <p>
                已保存 {plan?.state.transactions.length}{' '}
                笔流水及关联分类、账户、成员和预算。请使用“年度 Excel 对账”核对旧版全年明细。
              </p>
              <button className="legacy-db-primary" onClick={close}>
                完成
              </button>
            </div>
          ) : (
            <>
              <p>
                选择原版简洁记账“本地备份”生成的 .db，在本机解析后创建一个独立账本。支持已验证的
                4.8.8 数据库，现有账本保留。
              </p>
              <p className="legacy-db-note">
                这与新版 .jzbackup 恢复入口分开。最多 64
                MiB；原始文件不会被修改，也不会读取文件内引用的图片路径。
              </p>
              <input
                ref={input}
                type="file"
                accept=".db,application/octet-stream,application/x-sqlite3,application/vnd.sqlite3"
                aria-label="选择旧版数据库文件"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void read(file);
                }}
              />
              <button disabled={reading || applying} onClick={() => input.current?.click()}>
                {reading ? (
                  <>
                    <LoaderCircle className="spin" size={18} /> 正在校验数据库…
                  </>
                ) : (
                  '选择旧版 .db 文件'
                )}
              </button>
              {reading && (
                <button
                  onClick={() => {
                    abort.current?.abort();
                    setReading(false);
                  }}
                >
                  取消读取
                </button>
              )}
              {plan && (
                <>
                  <h3>导入预览</h3>
                  <p>
                    4 类流水共 <strong>{plan.state.transactions.length}</strong> 笔；
                    {plan.state.categories.filter((c) => c.parentId !== null).length} 个可记账分类、
                    {plan.state.accounts.length} 个账户、{plan.state.members.length} 个成员、
                    {plan.state.loanPeople.length} 位借贷人、{plan.state.budgets.length} 项预算。
                  </p>
                  <div className="legacy-db-totals">
                    {(['expense', 'income', 'transfer', 'loan'] as const).map((type) => (
                      <div key={type}>
                        <span>
                          {
                            { expense: '支出', income: '收入', transfer: '转账', loan: '借贷' }[
                              type
                            ]
                          }
                        </span>
                        <strong>
                          {plan.totals[type].count} 笔 · {formatMoney(plan.totals[type].cents)}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <label className="legacy-db-book">
                    新账本名称
                    <input
                      aria-label="旧版导入账本名称"
                      value={bookName}
                      maxLength={120}
                      disabled={applying}
                      onChange={(event) => {
                        setBookName(event.target.value);
                        setConfirmed(false);
                      }}
                    />
                  </label>
                  <div className="legacy-db-warnings">
                    <h4>迁移范围</h4>
                    <ul>
                      {plan.warnings.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                    <p>
                      原数据库全部表和字段保存在本机迁移附属资料中，并随新版完整备份保存；它们不会自动出现在
                      Excel 或对账报告中。原版多账本请分别检查备份范围。
                    </p>
                  </div>
                  <label className="legacy-db-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={applying}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    我已核对数量并了解迁移范围，确认创建独立账本
                  </label>
                  <button
                    className="legacy-db-primary"
                    disabled={!confirmed || !bookName.trim() || applying}
                    onClick={() => void apply()}
                  >
                    {applying ? '正在原子保存…' : '确认初始化导入'}
                  </button>
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="legacy-db-error">
              {error}
            </p>
          )}
        </div>
      </dialog>
    );
  },
);
