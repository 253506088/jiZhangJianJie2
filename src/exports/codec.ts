import * as XLSX from 'xlsx';
import type { LedgerState } from '../core';
import {
  excelExportFileName,
  MAX_EXCEL_OUTPUT_BYTES,
  prepareLegacyExport,
  type ExcelExportOptions,
  type ExcelExportSummary,
} from './model';

export interface BuiltExcelExport {
  bytes: Uint8Array<ArrayBuffer>;
  fileName: string;
  mimeType: string;
  summary: ExcelExportSummary;
}

export function buildLegacyExcel(
  state: LedgerState,
  options: ExcelExportOptions,
): BuiltExcelExport {
  const prepared = prepareLegacyExport(state, options);
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: `简洁记账明细：${prepared.summary.bookName}`,
    Author: '简洁记账重制',
    Comments: '四表兼容明细；完整分类身份、期初余额、预算模板与导入历史请使用完整备份。',
  };
  for (const table of prepared.sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(table.rows);
    sheet['!cols'] = table.rows[2].map((label) => ({
      wch: label === '备注' ? 42 : label === '时间' ? 24 : label === '收入类别' ? 26 : 17,
    }));
    sheet['!rows'] = [{ hpt: 24 }, { hpt: 22 }, { hpt: 24 }];
    XLSX.utils.book_append_sheet(workbook, sheet, table.name);
  }
  const bytes = new Uint8Array(
    XLSX.write(workbook, {
      type: 'array',
      bookType: options.format === 'xls' ? 'biff8' : 'xlsx',
      compression: options.format === 'xlsx',
      bookSST: true,
    }),
  );
  if (!bytes.byteLength || bytes.byteLength > MAX_EXCEL_OUTPUT_BYTES)
    throw new Error('Excel 文件超过 32 MiB，请缩小日期范围，或使用完整备份保存全部数据。');
  return {
    bytes,
    fileName: excelExportFileName(prepared.summary),
    mimeType:
      options.format === 'xls'
        ? 'application/vnd.ms-excel'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    summary: prepared.summary,
  };
}
