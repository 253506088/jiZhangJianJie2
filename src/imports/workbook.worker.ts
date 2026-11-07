import { readWorkbookBytes } from './workbook';

self.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer; fileName: string }>) => {
  try {
    const { buffer, fileName } = event.data;
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
    const digest = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    self.postMessage({ ok: true, workbook: { ...readWorkbookBytes(buffer, fileName), digest } });
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : '读取工作簿失败。',
    });
  }
};
