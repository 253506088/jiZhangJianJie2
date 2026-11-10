import type { LegacyDbPlan } from './types';
import { MAX_LEGACY_DB_BYTES } from './types';

/** Every selected file is parsed in an owned, cancellable worker; it never writes the ledger. */
export async function loadLegacyDatabase(file: File, signal?: AbortSignal): Promise<LegacyDbPlan> {
  if (!/\.db$/i.test(file.name)) throw new Error('请选择旧版简洁记账“本地备份”导出的 .db 文件。');
  if (!file.size || file.size > MAX_LEGACY_DB_BYTES)
    throw new Error('旧版数据库需为非空且不超过 64 MiB。');
  if (signal?.aborted) throw new DOMException('已取消读取', 'AbortError');
  const buffer = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException('已取消读取', 'AbortError');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./database.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error('解析超过 60 秒，已停止，现有账本未更改。')),
      60_000,
    );
    const onAbort = () => finish(new DOMException('已取消读取', 'AbortError'));
    function finish(error?: Error, result?: LegacyDbPlan) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event) =>
      event.data.ok ? finish(undefined, event.data.plan) : finish(new Error(event.data.message));
    worker.onerror = () => finish(new Error('无法解析这份旧版数据库，现有账本未更改。'));
    worker.postMessage({ fileName: file.name, buffer }, [buffer]);
  });
}
