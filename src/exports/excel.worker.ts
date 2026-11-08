import { buildLegacyExcel } from './codec';
import type { ExcelExportOptions } from './model';
import type { LedgerState } from '../core';

self.onmessage = (event: MessageEvent<{ state: LedgerState; options: ExcelExportOptions }>) => {
  try {
    const result = buildLegacyExcel(event.data.state, event.data.options);
    self.postMessage({ ok: true, result }, { transfer: [result.bytes.buffer] });
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : '生成 Excel 失败，账本未更改。',
    });
  }
};
