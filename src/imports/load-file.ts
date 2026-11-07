import type { WorkbookData } from './types';

/** The parser runs away from the UI, has a deadline, and can be cancelled without changing the ledger. */
export async function loadWorkbook(file: File, signal?: AbortSignal): Promise<WorkbookData> {
  if (!/\.(xlsx?|csv)$/i.test(file.name)) throw new Error('请选择 .xls、.xlsx 或 CSV 表格。');
  if (file.size > 32 * 1024 * 1024 || !file.size) throw new Error('文件需为非空且不超过 32 MB。');
  const buffer = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException('已取消读取', 'AbortError');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workbook.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(
      () => finish(new Error('解析超过 45 秒，已停止。请按年份分批导出后再试。')),
      45_000,
    );
    const onAbort = () => finish(new DOMException('已取消读取', 'AbortError'));
    let settled = false;
    function finish(error?: Error, workbook?: WorkbookData) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      if (error) reject(error);
      else resolve(workbook!);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event) =>
      event.data.ok
        ? finish(undefined, event.data.workbook)
        : finish(new Error(event.data.message));
    worker.onerror = () => finish(new Error('读取工作簿失败，账本未更改。请检查文件或重试。'));
    worker.postMessage({ fileName: file.name, buffer }, [buffer]);
  });
}
