import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { BookOpen, LoaderCircle, ShieldAlert } from 'lucide-react';
import { createEmptyState, type LedgerState } from './core';
import { createRepository, type LedgerRepository, type LoadedLedger } from './storage/repository';
import { RevisionConflictError } from './storage/types';
import { ProductionApp, type ProductionAppHandle, type LedgerMutation } from './ui';
import { ImportWizard, type ImportWizardHandle } from './imports/ImportWizard';
import { applyImport, type ImportResult } from './imports/apply';
import type { ImportOptions, ImportPlan } from './imports/types';
import { BackupPanel, type BackupPanelHandle, saveTextFile } from './backup';
import { RecoveryPanel, type RecoveryPanelHandle } from './workflows/RecoveryPanel';
import { ExcelExportPanel, type ExcelExportPanelHandle } from './exports/ExcelExportPanel';
import {
  ReconciliationPanel,
  type ReconciliationPanelHandle,
} from './reconciliation/ReconciliationPanel';
import { LegacyDbImportPanel, type LegacyDbImportHandle } from './legacy-db/LegacyDbImportPanel';
import { applyLegacyDatabase } from './legacy-db/prepare';

type Panel =
  | 'import'
  | 'legacy-db'
  | 'export'
  | 'excel-export'
  | 'reconcile'
  | 'restore'
  | 'history'
  | null;

export default function App() {
  const [loaded, setLoaded] = useState<LoadedLedger | null>(null);
  const [bootError, setBootError] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<{ message: string; serial: number } | null>(null);
  const repository = useRef<LedgerRepository | null>(null);
  const writing = useRef(false);
  const busyRef = useRef(false);
  const panelRef = useRef<Panel>(null);
  const app = useRef<ProductionAppHandle>(null);
  const importer = useRef<ImportWizardHandle>(null);
  const backup = useRef<BackupPanelHandle>(null);
  const recovery = useRef<RecoveryPanelHandle>(null);
  const excelExport = useRef<ExcelExportPanelHandle>(null);
  const reconciliation = useRef<ReconciliationPanelHandle>(null);
  const legacyImporter = useRef<LegacyDbImportHandle>(null);
  const unavailableShell = useMemo(() => createEmptyState(), []);
  panelRef.current = panel;
  busyRef.current = busy;

  const notify = useCallback((message: string) => {
    setNotice((current) => ({ message, serial: (current?.serial ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    let active = true;
    const store = createRepository();
    repository.current = store;
    store
      .load()
      .then((value) => {
        if (active) {
          setLoaded(value);
          setBootError('');
        }
      })
      .catch((cause) => {
        if (active)
          setBootError(
            cause instanceof Error ? cause.message : '本地账本无法读取，原数据未被删除。',
          );
      });
    return () => {
      active = false;
      if (repository.current === store) repository.current = null;
      void store.close();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(timer);
  }, [notice]);

  const closePanel = useCallback(() => {
    if (writing.current) return;
    setPanel(null);
  }, []);

  useEffect(() => {
    const back = () => {
      if (writing.current || busyRef.current) return true;
      if (panelRef.current === 'import') {
        importer.current?.requestClose();
        return true;
      }
      if (panelRef.current === 'legacy-db') {
        legacyImporter.current?.requestClose();
        return true;
      }
      if (panelRef.current === 'export' || panelRef.current === 'restore') {
        backup.current?.requestClose();
        return true;
      }
      if (panelRef.current === 'history') {
        recovery.current?.requestClose();
        return true;
      }
      if (panelRef.current === 'excel-export') {
        excelExport.current?.requestClose();
        return true;
      }
      if (panelRef.current === 'reconcile') {
        reconciliation.current?.requestClose();
        return true;
      }
      return app.current?.back() ?? false;
    };
    const listener = Capacitor.isNativePlatform()
      ? NativeApp.addListener('backButton', () => {
          if (!back()) void NativeApp.exitApp();
        })
      : null;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !panelRef.current &&
        !document.querySelector('dialog[open]') &&
        back()
      )
        event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (listener) void listener.then((handle) => handle.remove());
    };
  }, []);

  const mutate = useCallback(async (operation: LedgerMutation) => {
    if (!repository.current) throw new Error('账本尚未加载完成。');
    if (writing.current) throw new Error('上一项保存仍在进行，请稍候。');
    writing.current = true;
    setBusy(true);
    try {
      const value = await repository.current.mutate(operation);
      setLoaded(value);
      setBootError('');
    } catch (cause) {
      if (cause instanceof RevisionConflictError) {
        try {
          setLoaded(await repository.current.load());
        } catch {
          /* Original files remain available for recovery. */
        }
      }
      throw cause;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }, []);

  const apply = useCallback(
    async (plan: ImportPlan, options: ImportOptions) => {
      let result: ImportResult | undefined;
      await mutate((state) => {
        result = applyImport(state, plan, options);
        if (!result.added)
          throw new Error('这些来源行已经导入，或全部在选择范围之外，没有新增记录。');
        return result.state;
      });
      return result!;
    },
    [mutate],
  );

  const restore = useCallback(
    async (state: LedgerState) => {
      if (!repository.current || writing.current) throw new Error('当前还不能恢复，请稍候。');
      writing.current = true;
      setBusy(true);
      try {
        const value = await repository.current.restoreFromBackup(state);
        setLoaded(value);
        setBootError('');
        notify('完整备份已恢复，分类与流水关系已核对');
      } finally {
        writing.current = false;
        setBusy(false);
      }
    },
    [notify],
  );

  const reload = async () => {
    if (!repository.current || writing.current) return;
    setBootError('');
    try {
      setLoaded(await repository.current.load());
    } catch (cause) {
      setBootError(cause instanceof Error ? cause.message : '重新读取失败');
    }
  };

  const state = loaded?.state ?? unavailableShell;
  const latestImports = loaded
    ? [...loaded.state.imports]
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
        .slice(0, 10)
    : [];
  return (
    <div
      className="app-root"
      data-theme={state.settings.theme}
      data-accent={state.settings.accentColor}
    >
      {loaded ? (
        <ProductionApp
          ref={app}
          state={loaded.state}
          busy={busy}
          mutate={mutate}
          onImport={() => setPanel('import')}
          onLegacyImport={() => setPanel('legacy-db')}
          onExport={() => setPanel('export')}
          onExcelExport={() => setPanel('excel-export')}
          onReconcile={() => setPanel('reconcile')}
          onRestore={() => setPanel('restore')}
          onHistory={() => setPanel('history')}
          dataTools={
            <section className="root-data-status">
              <p>数据保存在本机。最近保存：{new Date(loaded.savedAt).toLocaleString('zh-CN')}。</p>
              {latestImports.length > 0 && (
                <>
                  <h3>最近导入</h3>
                  <ul className="root-import-list">
                    {latestImports.map((batch) => (
                      <li key={batch.id}>
                        <strong>{batch.fileName}</strong>
                        <span>
                          {new Date(batch.importedAt).toLocaleString('zh-CN')} · 新增{' '}
                          {batch.importedRows} 笔 · 跳过 {batch.skippedRows} 行 · 未导入{' '}
                          {batch.rejectedRows} 行
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          }
        />
      ) : (
        <main className="root-boot">
          {bootError ? (
            <>
              <ShieldAlert size={42} />
              <h1>账本暂时无法打开</h1>
              <p role="alert">{bootError}</p>
              <div className="root-actions">
                <button onClick={() => void reload()}>重新读取</button>
                <button onClick={() => setPanel('history')}>历史保存点</button>
                <button onClick={() => setPanel('restore')}>从完整备份恢复</button>
              </div>
              <p>现有数据会保留，不会自动创建空账本覆盖它。</p>
            </>
          ) : (
            <>
              <BookOpen size={44} />
              <h1>简洁记账</h1>
              <p className="root-loading">
                <LoaderCircle className="import-spin" size={18} />
                正在打开本地账本…
              </p>
            </>
          )}
        </main>
      )}
      {panel === 'import' && loaded && (
        <ImportWizard
          ref={importer}
          state={loaded.state}
          onClose={closePanel}
          onApply={apply}
          onSaveReport={(content, fileName) => saveTextFile(content, fileName, 'text/csv')}
          onComplete={(result) => {
            closePanel();
            app.current?.showTransactions({
              month: result.latestDate?.slice(0, 7),
              bookId: result.firstBookId,
            });
            notify('已导入 ' + result.added + ' 笔，分类可直接用于继续记账');
          }}
        />
      )}
      {panel === 'legacy-db' && loaded && (
        <LegacyDbImportPanel
          ref={legacyImporter}
          state={loaded.state}
          onClose={closePanel}
          onApply={async (plan, bookName) => {
            await mutate((current) => applyLegacyDatabase(current, plan, bookName));
          }}
        />
      )}
      {(panel === 'export' || panel === 'restore') && (
        <BackupPanel
          ref={backup}
          mode={panel}
          state={state}
          currentUnavailable={!loaded}
          onClose={closePanel}
          onRestore={restore}
          onSaved={() =>
            notify(
              Capacitor.isNativePlatform()
                ? '备份文件已保存'
                : '已发起备份下载，请确认浏览器下载结果',
            )
          }
        />
      )}
      {panel === 'excel-export' && loaded && (
        <ExcelExportPanel ref={excelExport} state={loaded.state} onClose={closePanel} />
      )}
      {panel === 'reconcile' && loaded && (
        <ReconciliationPanel ref={reconciliation} state={loaded.state} onClose={closePanel} />
      )}
      {panel === 'history' && repository.current && (
        <RecoveryPanel
          ref={recovery}
          repository={repository.current}
          theme={state.settings.theme}
          onClose={closePanel}
          onRestored={(value) => {
            setLoaded(value);
            setBootError('');
            closePanel();
            notify('已恢复历史保存点');
          }}
        />
      )}
      {notice && (
        <div className="root-notice" role="status">
          {notice.message}
        </div>
      )}
    </div>
  );
}
