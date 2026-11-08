import type { LedgerState } from '../core';
import type { BuiltExcelExport } from './codec';
import type { ExcelExportOptions } from './model';

export function generateExcelExport(
  state: LedgerState,
  options: ExcelExportOptions,
  signal?: AbortSignal,
): Promise<BuiltExcelExport> {
  if (signal?.aborted) return Promise.reject(new DOMException('已取消导出', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./excel.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const cancel = () => finish(new DOMException('已取消导出', 'AbortError'));
    const timer = setTimeout(
      () => finish(new Error('生成 Excel 超过 90 秒，已停止。请缩小日期范围。')),
      90_000,
    );
    const finish = (error?: Error, result?: BuiltExcelExport) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event) =>
      event.data.ok ? finish(undefined, event.data.result) : finish(new Error(event.data.message));
    worker.onerror = () => finish(new Error('生成 Excel 失败，账本未更改。请重试或缩小范围。'));
    try {
      worker.postMessage({ state, options });
    } catch {
      finish(new Error('无法准备工作簿数据，账本未更改。'));
    }
  });
}
