import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { readLegacyDatabase } from './read';
import { prepareLegacyDatabase } from './prepare';

self.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer; fileName: string }>) => {
  try {
    const { buffer, fileName } = event.data;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const plan = prepareLegacyDatabase(
      readLegacyDatabase(SQL, new Uint8Array(buffer), fileName, digest),
    );
    self.postMessage({ ok: true, plan });
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : '旧版数据库解析失败。',
    });
  }
};
