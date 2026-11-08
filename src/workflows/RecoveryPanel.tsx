import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { X, History, LoaderCircle, AlertTriangle } from 'lucide-react';
import type { LedgerRepository, LoadedLedger } from '../storage/repository';
import type { SnapshotHeader } from '../storage/types';
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
  const [points, setPoints] = useState<SnapshotHeader[]>([]);
  const [verified, setVerified] = useState<LoadedLedger | null>(null);
  const [checking, setChecking] = useState(false);
  const requestId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const writing = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => {
    if (writing.current) return false;
    requestId.current++;
    onClose();
    return true;
  };
  useImperativeHandle(ref, () => ({ requestClose: close }));
  useEffect(() => {
    dialog.current?.showModal();
    let alive = true;
    repository
      .recoveryHeaders()
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
      requestId.current++;
    };
  }, [repository]);
  const inspect = async (revision: number) => {
    const request = ++requestId.current;
    setSelected(revision);
    setConfirmed(false);
    setVerified(null);
    setChecking(true);
    setError('');
    try {
      const value = await repository.inspectRecovery(revision);
      if (request === requestId.current) setVerified(value);
    } catch (cause) {
      if (request === requestId.current)
        setError(cause instanceof Error ? cause.message : '这个保存点未通过校验');
    } finally {
      if (request === requestId.current) setChecking(false);
    }
  };
  const restore = async () => {
    if (selected === null || !confirmed || !verified || checking || writing.current) return;
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
          <p>最近三个本机保存版本，选择后逐一校验</p>
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
                onChange={() => void inspect(point.revision)}
              />
              <div>
                <strong>{new Date(point.savedAt).toLocaleString('zh-CN')}</strong>
                <span>
                  版本 {point.revision} · {(point.bytes / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
            </label>
          ))
        )}
        {checking && (
          <p className="root-loading">
            <LoaderCircle className="import-spin" size={18} />
            校验所选保存点…
          </p>
        )}
        {verified && !checking && (
          <p className="import-good">
            校验通过：{verified.state.transactions.length} 笔流水、{verified.state.books.length}{' '}
            个账本、{verified.state.categories.length} 个分类。
          </p>
        )}
        {verified && !checking && (
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
          disabled={!confirmed || selected === null || !verified || checking || busy}
          onClick={() => void restore()}
        >
          {busy ? '恢复中…' : '恢复所选版本'}
        </button>
      </footer>
    </dialog>
  );
});
