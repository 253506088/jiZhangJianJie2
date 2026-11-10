import type { SqlJsStatic } from 'sql.js';
import { MAX_LEGACY_DB_BYTES, type LegacyDatabase, type LegacyRow } from './types';

import { legacyColumns } from '../core/legacy-db-metadata';

export function readLegacyDatabase(
  SQL: SqlJsStatic,
  bytes: Uint8Array,
  fileName: string,
  digest: string,
): LegacyDatabase {
  if (
    !bytes.byteLength ||
    bytes.byteLength > MAX_LEGACY_DB_BYTES ||
    new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0'
  )
    throw new Error('这不是可识别的 SQLite 旧版备份（不支持加密或压缩数据库）。');
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('文件摘要无效。');
  const database = new SQL.Database(bytes);
  try {
    database.run('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;');
    const version = database.exec('PRAGMA user_version')[0]?.values[0]?.[0];
    if (version !== 16)
      throw new Error(
        '这份旧版数据库的结构版本尚未验证，未导入任何内容。当前支持简洁记账 4.8.8（版本 16）。',
      );
    const schema =
      database.exec(
        "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','view','trigger')",
      )[0]?.values ?? [];
    const names = new Set<string>();
    for (const [kind, name, sql] of schema) {
      if (
        kind !== 'table' ||
        typeof name !== 'string' ||
        !Object.hasOwn(legacyColumns, name) ||
        typeof sql !== 'string' ||
        /\b(VIRTUAL|GENERATED)\b/i.test(sql)
      )
        throw new Error('数据库含有未验证的表、视图或触发器，已停止导入。');
      names.add(name);
    }
    if (names.size !== Object.keys(legacyColumns).length)
      throw new Error('数据库表不完整，不是受支持的旧版完整备份。');
    if (database.exec('PRAGMA integrity_check(1)')[0]?.values[0]?.[0] !== 'ok')
      throw new Error('数据库完整性检查失败，请重新从旧版备份。');
    const tables: Record<string, LegacyRow[]> = {};
    let totalRows = 0;
    for (const [table, columns] of Object.entries(legacyColumns)) {
      const info = database.exec(`PRAGMA table_xinfo("${table}")`)[0]?.values ?? [];
      if (
        info.length !== columns.length ||
        info.some((row, index) => row[1] !== columns[index] || row[6] !== 0)
      )
        throw new Error('数据库字段结构与已验证版本不同，已停止导入。');
      const count = database.exec(`SELECT count(*) FROM "${table}" NOT INDEXED`)[0]?.values[0]?.[0];
      if (
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > 200_000 ||
        (totalRows += count) > 500_000
      )
        throw new Error('数据库记录数量超出支持范围。');
      const statement = database.prepare(`SELECT * FROM "${table}" NOT INDEXED`);
      const rows: LegacyRow[] = [];
      try {
        while (statement.step()) {
          const raw = statement.getAsObject();
          const row: LegacyRow = {};
          for (const column of columns) {
            const value = raw[column];
            if (value !== null && typeof value !== 'string' && typeof value !== 'number')
              throw new Error('数据库包含无法无损读取的二进制字段，已停止导入。');
            if (
              (typeof value === 'number' && !Number.isFinite(value)) ||
              (typeof value === 'string' && (value.length > 65_536 || value.includes('\0')))
            )
              throw new Error('数据库字段无效或过长，已停止导入。');
            row[column] = value;
          }
          rows.push(row);
        }
      } finally {
        statement.free();
      }
      tables[table] = rows;
    }
    return { fileName, digest, userVersion: version, tables };
  } catch (error) {
    if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)) throw error;
    throw new Error('旧版数据库无法完整读取，现有账本未更改。');
  } finally {
    database.close();
  }
}
