import type { LedgerState } from '../core';
import type { WorkbookData } from '../imports/types';
import type { ReconciliationOptions, ReconciliationResult } from './model';

export function runReconciliation(
  state: LedgerState,
  workbook: WorkbookData,
  options: ReconciliationOptions,
  signal: AbortSignal,
): Promise<ReconciliationResult> {
  if (signal.aborted) return Promise.reject(new DOMException('已取消对账', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./reconciliation.worker.ts', import.meta.url), {
      type: 'module',
    });
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error('对账超过 45 秒，已停止。账本未改动。')),
      45_000,
    );
    const abort = () => finish(new DOMException('已取消对账', 'AbortError'));
    function finish(error?: Error, result?: ReconciliationResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    }
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) =>
      event.data.ok ? finish(undefined, event.data.result) : finish(new Error(event.data.message));
    worker.onerror = () => finish(new Error('对账未完成，账本未改动。'));
    worker.postMessage({ state, workbook, options });
  });
}
