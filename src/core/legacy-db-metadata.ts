/** Exact columns observed in a normal 4.8.8 / user_version 16 backup. */
export const legacyColumns = {
  android_metadata: ['locale'],
  template: ['id', 'name', 'uri', 'account_type', 'info', 'update_time', 'use_time'],
  sqlite_sequence: ['name', 'seq'],
  remind: ['id', 'isBorrow', 'person', 'money', 'time_remind', 'timeSpanOfSequence'],
  budget: ['id', 'type', 'total', 'expenses'],
  expenses_left: ['id', 'left', 'icon_type', 'updateTime'],
  expenses_right: ['id', 'key', 'value', 'usually_key', 'updateTime'],
  income_type: ['id', 'income_type', 'icon_type', 'updateTime'],
  account_type: ['id', 'key', 'value', 'money'],
  borrow_member: ['id', 'name', 'money', 'updateTime'],
  delete_item: ['id', 'time_span'],
  member: ['id', 'member', 'updateTime'],
  time_sequence: [
    'id',
    'time_span_four',
    'account_type',
    'date',
    'time_span',
    'member',
    'account_detail_1',
    'account_detail_2',
  ],
  expenses: [
    'id',
    'uri',
    'money',
    'type_main',
    'type_detail',
    'account_detail',
    'date',
    'member',
    'remarks',
    'time_span',
    'update_time',
  ],
  income: [
    'id',
    'uri',
    'money',
    'type_detail',
    'account_detail',
    'date',
    'member',
    'remarks',
    'time_span',
    'update_time',
  ],
  transfer: [
    'id',
    'uri',
    'money',
    'type_detail',
    'transfer_account_from',
    'transfer_account_to',
    'date',
    'member',
    'remarks',
    'time_span',
    'update_time',
  ],
  borrow: [
    'id',
    'uri',
    'money',
    'type_detail',
    'account_detail',
    'member',
    'date',
    'remind_model',
    'remind_date',
    'interest',
    'remarks',
    'time_span',
    'update_time',
  ],
  auto_charge: [
    'id',
    'uri',
    'money',
    'type_detail',
    'account_detail',
    'member',
    'date',
    'remind_model',
    'remind_date',
    'interest',
    'remarks',
    'time_span',
    'update_time',
  ],
} as const;

/** Read-only original fields retained locally when migrating a legacy SQLite backup. */
export interface LegacyDbMetadata {
  format: 'jianjie-4.8.8';
  userVersion: 16;
  tables: Record<string, Record<string, string | number | null>[]>;
}

export function validLegacyDbMetadata(value: unknown): value is LegacyDbMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const metadata = value as LegacyDbMetadata;
  if (
    metadata.format !== 'jianjie-4.8.8' ||
    metadata.userVersion !== 16 ||
    !metadata.tables ||
    typeof metadata.tables !== 'object' ||
    Array.isArray(metadata.tables)
  )
    return false;
  const tables = Object.entries(metadata.tables);
  if (tables.length !== Object.keys(legacyColumns).length) return false;
  let rowCount = 0;
  let textLength = 0;
  for (const [table, rows] of tables) {
    if (!Object.hasOwn(legacyColumns, table) || !Array.isArray(rows)) return false;
    const columns = legacyColumns[table as keyof typeof legacyColumns] as readonly string[];
    rowCount += rows.length;
    if (rowCount > 500_000) return false;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
      const cells = Object.entries(row);
      if (cells.length !== columns.length || columns.some((column) => !Object.hasOwn(row, column)))
        return false;
      for (const [key, cell] of cells) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) return false;
        if (cell === null) continue;
        if (typeof cell === 'number') {
          if (!Number.isFinite(cell)) return false;
          continue;
        }
        if (typeof cell !== 'string' || cell.length > 65_536 || cell.includes('\0')) return false;
        textLength += cell.length;
        if (textLength > 32 * 1024 * 1024) return false;
      }
    }
  }
  return true;
}
