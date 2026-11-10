import { reconcileLegacyWorkbook } from './model';

self.onmessage = (event) => {
  try {
    const { state, workbook, options } = event.data;
    self.postMessage({ ok: true, result: reconcileLegacyWorkbook(state, workbook, options) });
  } catch (cause) {
    self.postMessage({
      ok: false,
      message: cause instanceof Error ? cause.message : '无法完成对账，账本未改动。',
    });
  }
};
