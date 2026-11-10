import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  Check,
  Download,
  Eye,
  EyeOff,
  FileUp,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { LedgerState } from '../core';
import {
  decodeBackup,
  encodeBackup,
  inspectBackup,
  summarizeBackupState,
  type BackupInspection,
  type BackupMetadata,
  type BackupSummary,
} from './codec';
import { backupFileName, exactMoney, readBackupFile, saveTextFile } from './files';
import './panel.css';

export interface BackupPanelProps {
  mode: 'export' | 'restore';
  state: LedgerState;
  onClose: () => void;
  /** The parent performs a durable, atomic replacement; this component never writes the repository. */
  onRestore: (state: LedgerState) => Promise<void>;
  onSaved?: () => void;
  /** The state prop is only a theme shell when the persisted ledger could not be read. */
  currentUnavailable?: boolean;
}

export interface BackupPanelHandle {
  /** false means a read/write is still in progress and the caller must keep the panel open. */
  requestClose(): boolean;
}

interface VerifiedBackup {
  state: LedgerState;
  metadata: BackupMetadata;
}

function readableTimestamp(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function Summary({ summary, caption }: { summary: BackupSummary; caption: string }) {
  return (
    <section className="bk-summary" aria-label={caption}>
      <h3>{caption}</h3>
      <dl className="bk-summary-counts">
        <div>
          <dt>流水</dt>
          <dd>
            {summary.transactions.toLocaleString('zh-CN')}
            <small> 笔</small>
          </dd>
        </div>
        <div>
          <dt>账本</dt>
          <dd>
            {summary.books}
            <small> 个</small>
          </dd>
        </div>
        <div>
          <dt>账户</dt>
          <dd>
            {summary.accounts}
            <small> 个</small>
          </dd>
        </div>
        <div>
          <dt>两级分类</dt>
          <dd>
            {summary.primaryCategories}
            <small> / </small>
            {summary.secondaryCategories}
          </dd>
        </div>
      </dl>
      <p className="bk-date-range">
        {summary.firstDate && summary.lastDate
          ? `${summary.firstDate} 至 ${summary.lastDate}`
          : '暂无流水，账户和分类仍会保留'}
      </p>
      <dl className="bk-money-summary">
        <div>
          <dt>收入合计</dt>
          <dd>¥{exactMoney(summary.exactTotals.incomeCents)}</dd>
        </div>
        <div>
          <dt>支出合计</dt>
          <dd>¥{exactMoney(summary.exactTotals.expenseCents)}</dd>
        </div>
        <div>
          <dt>转账合计</dt>
          <dd>¥{exactMoney(summary.exactTotals.transferCents)}</dd>
        </div>
      </dl>
      <p className="bk-retained">
        同时保留 {summary.categoryAliases} 个分类历史关联、{summary.imports} 次导入历史、
        {summary.budgets} 项预算和 {summary.templates} 个模板。
      </p>
    </section>
  );
}

export const BackupPanel = forwardRef<BackupPanelHandle, BackupPanelProps>(function BackupPanel(
  { mode, state, onClose, onRestore, onSaved, currentUnavailable = false },
  ref,
) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const payload = useRef('');
  const alive = useRef(true);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [workLabel, setWorkLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [encrypted, setEncrypted] = useState(true);
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fileName, setFileName] = useState('');
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [verified, setVerified] = useState<VerifiedBackup | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const current = useMemo(() => {
    if (currentUnavailable) {
      return {
        summary: null,
        error:
          mode === 'export'
            ? '当前账本尚未读取，不能用空白数据代替它导出。请先恢复或检查本地保存点。'
            : '',
      };
    }
    try {
      return { summary: summarizeBackupState(state), error: '' };
    } catch {
      return { summary: null, error: '当前账本无法通过校验，请先检查保存状态。' };
    }
  }, [state, mode, currentUnavailable]);

  const clearSecrets = () => {
    payload.current = '';
    setPassword('');
    setPasswordAgain('');
    setVerified(null);
  };
  const requestClose = () => {
    if (busyRef.current) return false;
    generation.current++;
    clearSecrets();
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
      payload.current = '';
    };
  }, []);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setConfirmed(false);
  }, [state]);

  const execute = async (label: string, operation: (isCurrent: () => boolean) => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setWorkLabel(label);
    setError('');
    setNotice('');
    const token = ++generation.current;
    const isCurrent = () => alive.current && token === generation.current;
    try {
      await operation(isCurrent);
    } catch (cause) {
      if (isCurrent())
        setError(cause instanceof Error ? cause.message : '操作未完成，请重试。原账本未更改。');
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
        setBusy(false);
        setWorkLabel('');
      }
    }
  };

  const exportFile = async (event: FormEvent) => {
    event.preventDefault();
    if (current.error) {
      setError(current.error);
      return;
    }
    if (encrypted && (password.length < 8 || password.length > 1024)) {
      setError('加密密码需为 8 至 1024 个字符。');
      return;
    }
    if (encrypted && password !== passwordAgain) {
      setError('两次输入的密码不一致。');
      return;
    }
    await execute(encrypted ? '正在生成加密备份…' : '正在生成完整备份…', async (isCurrent) => {
      const text = await encodeBackup(state, encrypted ? { password } : {});
      if (!isCurrent()) return;
      setWorkLabel('请选择保存位置，完成后将校验文件…');
      const result = await saveTextFile(
        text,
        backupFileName(encrypted),
        'application/octet-stream',
      );
      if (!isCurrent()) return;
      setPassword('');
      setPasswordAgain('');
      setShowPassword(false);
      if (result.cancelled) {
        setNotice('已取消保存。当前账本未更改。');
        return;
      }
      setNotice(
        result.delivery === 'document'
          ? '完整备份已保存，并通过写入校验。'
          : '下载已开始，请确认浏览器已将文件保存。',
      );
      onSaved?.();
    });
  };

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await execute('正在读取和检查备份…', async (isCurrent) => {
      payload.current = '';
      setInspection(null);
      setVerified(null);
      setConfirmed(false);
      setPassword('');
      setPasswordAgain('');
      setShowPassword(false);
      setFileName(file.name);
      const text = await readBackupFile(file);
      const details = inspectBackup(text);
      if (!isCurrent()) return;
      payload.current = text;
      setInspection(details);
      if (!details.passwordRequired) {
        const result = await decodeBackup(text);
        if (!isCurrent()) return;
        setVerified(result);
        payload.current = '';
      }
    });
  };

  const unlockFile = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) {
      setError('请输入这份备份的密码。');
      return;
    }
    await execute('正在解密并校验全部账本…', async (isCurrent) => {
      const result = await decodeBackup(payload.current, { password });
      if (!isCurrent()) return;
      setVerified(result);
      setConfirmed(false);
      setPassword('');
      setShowPassword(false);
      payload.current = '';
    });
  };

  const restoreFile = async () => {
    if (!verified || !confirmed) return;
    const replacement = verified.state;
    await execute('正在安全恢复，请稍候…', async (isCurrent) => {
      await onRestore(replacement);
      if (!isCurrent()) return;
      payload.current = '';
      setPassword('');
      setVerified(null);
      onClose();
    });
  };

  const theme =
    state.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : state.settings.theme;
  const restoreStep = verified ? 3 : inspection ? 2 : 1;
  const passwordField = (
    <label className="bk-field">
      <span>{mode === 'export' ? '加密密码' : '备份密码'}</span>
      <span className="bk-password-wrap">
        <input
          autoComplete={mode === 'export' ? 'new-password' : 'off'}
          type={showPassword ? 'text' : 'password'}
          value={password}
          maxLength={1024}
          disabled={busy}
          placeholder={mode === 'export' ? '至少 8 个字符' : '输入生成这份备份时设置的密码'}
          onChange={(event) => {
            setPassword(event.target.value);
            setError('');
          }}
        />
        <button
          type="button"
          className="bk-eye"
          aria-label={showPassword ? '隐藏备份密码' : '显示备份密码'}
          aria-pressed={showPassword}
          onClick={() => setShowPassword((value) => !value)}
          disabled={busy}
        >
          {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </span>
    </label>
  );

  return (
    <dialog
      ref={dialog}
      className="backup-panel"
      data-theme={theme}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <header className="bk-header">
        <span className="bk-heading-icon">
          {mode === 'export' ? <ShieldCheck size={23} /> : <FileUp size={23} />}
        </span>
        <div>
          <h1 id={titleId}>{mode === 'export' ? '完整账本备份' : '恢复完整备份'}</h1>
          <p>{mode === 'export' ? '把所有账本与关联一起保存' : '先校验，再确认，最后恢复'}</p>
        </div>
        <button
          type="button"
          className="bk-close"
          aria-label="关闭备份面板"
          disabled={busy}
          onClick={requestClose}
        >
          <X size={21} />
        </button>
      </header>
      <div className="bk-scroll">
        {mode === 'export' ? (
          <form id="backup-export-form" onSubmit={exportFile}>
            {current.summary && <Summary summary={current.summary} caption="本次备份范围" />}
            <section className="bk-options">
              <label className="bk-encrypt-toggle">
                <span>
                  <LockKeyhole size={20} />
                  <strong>使用密码加密</strong>
                </span>
                <input
                  type="checkbox"
                  checked={encrypted}
                  disabled={busy}
                  onChange={(event) => {
                    setEncrypted(event.target.checked);
                    setPassword('');
                    setPasswordAgain('');
                    setError('');
                  }}
                />
              </label>
              {encrypted ? (
                <>
                  <p className="bk-help">
                    密码仅在本机使用。请妥善记住它，忘记后无法恢复加密备份。
                  </p>
                  {passwordField}
                  <label className="bk-field">
                    <span>再次确认密码</span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={passwordAgain}
                      maxLength={1024}
                      disabled={busy}
                      placeholder="再次输入相同密码"
                      onChange={(event) => {
                        setPasswordAgain(event.target.value);
                        setError('');
                      }}
                    />
                  </label>
                </>
              ) : (
                <p className="bk-help">明文备份包含完整账本内容，请保存在你信任的位置。</p>
              )}
            </section>
            <p className="bk-footnote">
              备份文件在本机生成，保存位置由你选择。不会上传到账本服务器。
            </p>
          </form>
        ) : (
          <>
            <ol className="bk-steps" aria-label="恢复步骤">
              {['选择文件', '校验备份', '确认恢复'].map((label, index) => (
                <li
                  key={label}
                  className={
                    restoreStep === index + 1 ? 'active' : restoreStep > index + 1 ? 'complete' : ''
                  }
                  aria-current={restoreStep === index + 1 ? 'step' : undefined}
                >
                  <span>{restoreStep > index + 1 ? <Check size={14} /> : index + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
            {currentUnavailable && (
              <div className="bk-unavailable" role="note">
                <strong>当前账本数量未知</strong>
                <p>
                  当前本地账本暂时无法读取，原始数据仍保留。下方只展示你选择并通过校验的备份内容，不把读取失败当成空账本。
                </p>
              </div>
            )}
            <input
              ref={input}
              className="bk-hidden"
              type="file"
              accept=".json,.jzbackup,application/json,application/octet-stream"
              disabled={busy}
              aria-label="选择完整备份文件"
              onChange={selectFile}
            />
            <button
              type="button"
              className="bk-file-choice"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <FileUp size={26} />
              <strong>{fileName || '选择完整备份文件'}</strong>
              <span>{fileName ? '点此重新选择文件' : '.jzbackup 或 .json，由本 App 导出'}</span>
            </button>
            <p className="bk-help">
              这里恢复新版 .jzbackup；旧版 .db 请使用“从旧版 .db 初始化”，旧版 Excel
              请使用导入功能。
            </p>
            {inspection && !verified && (
              <section className="bk-options">
                <p className="bk-file-meta">
                  <span>
                    {inspection.encrypted ? '加密备份' : '明文备份'} ·{' '}
                    {readableTimestamp(inspection.createdAt)}
                  </span>
                  <small>完整性尚未验证</small>
                </p>
                {inspection.passwordRequired && (
                  <form onSubmit={unlockFile}>
                    {passwordField}
                    <p className="bk-help">密码只用于在本机解密，不会发送到服务器。</p>
                    <button
                      className="bk-primary bk-inline-action"
                      type="submit"
                      disabled={busy || !password}
                    >
                      <LockKeyhole size={17} />
                      解密并校验
                    </button>
                  </form>
                )}
              </section>
            )}
            {verified && (
              <>
                <div className="bk-verified">
                  <ShieldCheck size={19} />
                  <span>备份格式、完整性与账本关联已通过校验</span>
                </div>
                <Summary summary={verified.metadata.summary} caption="将恢复的备份" />
                <div className="bk-restore-warning">
                  <strong>恢复会替换当前全部账本</strong>
                  {currentUnavailable ? (
                    <p>
                      当前账本无法读取，实际账本和流水数量未知。恢复前会保留原始保存点，再以这份已验证的备份替换当前账本。
                    </p>
                  ) : (
                    <p>
                      当前共有 {current.summary?.books ?? '—'} 个账本、
                      {current.summary?.transactions.toLocaleString('zh-CN') ?? '—'}{' '}
                      笔流水；恢复后以备份中的数据为准，不会与当前数据叠加。
                    </p>
                  )}
                  <p>
                    {currentUnavailable
                      ? '写入失败时原有本地数据保持不变。'
                      : '请先保留需要的当前备份。校验或写入失败时不会清空现有账本。'}
                  </p>
                </div>
                <label className="bk-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>我已确认，用这份备份替换当前全部账本。</span>
                </label>
              </>
            )}
          </>
        )}
        {(error || current.error) && (
          <p className="bk-error" role="alert">
            {error || current.error}
          </p>
        )}
        {notice && (
          <p className="bk-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      <footer className="bk-footer">
        {busy && (
          <div className="bk-progress" role="status">
            <LoaderCircle size={18} className="bk-spinning" />
            <span>{workLabel}</span>
          </div>
        )}
        <div className="bk-actions">
          <button type="button" className="bk-secondary" disabled={busy} onClick={requestClose}>
            返回
          </button>
          {mode === 'export' ? (
            <button
              type="submit"
              form="backup-export-form"
              className="bk-primary"
              disabled={busy || !!current.error}
            >
              <Download size={18} />
              {busy ? '正在准备…' : '生成并保存备份'}
            </button>
          ) : verified ? (
            <button
              type="button"
              className="bk-primary bk-danger"
              disabled={busy || !confirmed || !!current.error}
              onClick={restoreFile}
            >
              <ShieldCheck size={18} />
              {busy ? '正在恢复…' : '确认恢复全部账本'}
            </button>
          ) : (
            <span className="bk-footer-hint">选择并验证备份后才能恢复</span>
          )}
        </div>
      </footer>
    </dialog>
  );
});
