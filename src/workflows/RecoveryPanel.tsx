import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { X, History, LoaderCircle, AlertTriangle } from 'lucide-react';
import type { LedgerRepository, LoadedLedger } from '../storage/repository';
import type { Theme } from '../core';
import '../imports/wizard.css';

export interface RecoveryPanelHandle {
  requestClose(): boolean;
}
export const RecoveryPanel = forwardRef<
  RecoveryPanelHandle,
  {
    repository: LedgerRepository;
    theme: Theme;
    onClose(): void;
    onRestored(value: LoadedLedger): void;
  }
>(function RecoveryPanel({ repository, theme, onClose, onRestored }, ref) {
  const [points, setPoints] = useState<LoadedLedger[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const writing = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => {
    if (writing.current) return false;
    onClose();
    return true;
  };
  useImperativeHandle(ref, () => ({ requestClose: close }));
  useEffect(() => {
    dialog.current?.showModal();
    let alive = true;
    repository
      .recoveryPoints()
      .then((values) => {
        if (alive) setPoints(values);
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : '无法读取保存点');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [repository]);
  const restore = async () => {
    if (selected === null || !confirmed || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await repository.recover(selected);
      onRestored(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复失败，现有数据仍保留');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="import-dialog recovery-dialog"
      data-theme={theme}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="recovery-title"
    >
      <header className="import-header">
        <button aria-label="关闭历史保存点" disabled={busy} onClick={close}>
          <X />
        </button>
        <div>
          <h1 id="recovery-title">历史保存点</h1>
          <p>最近三个已校验的保存版本，仅保存在本机</p>
        </div>
      </header>
      <div className="import-body">
        <div className="import-good">
          <History size={21} />
          <p>
            恢复将用所选版本整体替换当前账本。当前版本仍会进入历史保存点；这些保存点用于短期恢复，重要数据请另存完整备份。
          </p>
        </div>
        {loading ? (
          <p className="root-loading">
            <LoaderCircle className="import-spin" />
            读取中…
          </p>
        ) : points.length === 0 ? (
          <p className="root-empty">
            暂时没有可恢复的历史保存点。每次成功保存后会自动保留上一个版本。
          </p>
        ) : (
          points.map((point) => (
            <label
              className={`recovery-point ${selected === point.revision ? 'selected' : ''}`}
              key={point.revision}
            >
              <input
                type="radio"
                name="recovery-version"
                checked={selected === point.revision}
                disabled={busy}
                onChange={() => {
                  setSelected(point.revision);
                  setConfirmed(false);
                }}
              />
              <div>
                <strong>{new Date(point.savedAt).toLocaleString('zh-CN')}</strong>
                <span>
                  版本 {point.revision} · {point.state.transactions.length} 笔流水 ·{' '}
                  {point.state.books.length} 个账本 · {point.state.categories.length} 个分类
                </span>
              </div>
            </label>
          ))
        )}
        {selected !== null && (
          <label className="import-check import-warning">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={busy}
            />
            我已核对版本，确认用这个保存点替换当前账本。
          </label>
        )}
        {error && (
          <p className="import-error" role="alert">
            <AlertTriangle size={18} />
            {error}
          </p>
        )}
      </div>
      <footer className="import-footer">
        <button className="import-secondary" disabled={busy} onClick={close}>
          取消
        </button>
        <button
          className="import-primary"
          disabled={!confirmed || selected === null || busy}
          onClick={() => void restore()}
        >
          {busy ? '恢复中…' : '恢复所选版本'}
        </button>
      </footer>
    </dialog>
  );
});
