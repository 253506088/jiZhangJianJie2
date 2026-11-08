import * as XLSX from 'xlsx';
import type { CellValue, WorkbookData } from './types';

export const MAX_EXCEL_BYTES = 32 * 1024 * 1024;
const MAX_ROWS = 200_000;
// The record cap does not include the header/title rows emitted by the four-sheet format.
const MAX_PHYSICAL_ROWS = MAX_ROWS + 40 * 60;
const MAX_COLUMNS = 256;

function guardZip(bytes: Uint8Array) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let position = bytes.byteLength - 22;
    position >= Math.max(0, bytes.byteLength - 65557);
    position--
  ) {
    if (view.getUint32(position, true) === 0x06054b50) {
      end = position;
      break;
    }
  }
  if (end < 0) throw new Error('Excel 压缩结构不完整，请重新导出文件。');
  const count = view.getUint16(end + 10, true);
  const start = view.getUint32(end + 16, true);
  if (count > 5000 || start === 0xffffffff || start >= bytes.length)
    throw new Error('工作簿结构过大，请分批导出。');
  let position = start;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (position + 46 > bytes.length || view.getUint32(position, true) !== 0x02014b50)
      throw new Error('Excel 压缩目录损坏。');
    const size = view.getUint32(position + 24, true);
    expanded += size;
    if (size === 0xffffffff || expanded > 128 * 1024 * 1024)
      throw new Error('解压后的工作簿超过 128 MB，请缩小导出范围。');
    position +=
      46 +
      view.getUint16(position + 28, true) +
      view.getUint16(position + 30, true) +
      view.getUint16(position + 32, true);
  }
}

/** Reads cached values only. Macros, formula execution, links and remote resources are not executed. */
export function readWorkbookBytes(
  buffer: ArrayBuffer,
  fileName: string,
): Omit<WorkbookData, 'digest'> {
  if (!buffer.byteLength || buffer.byteLength > MAX_EXCEL_BYTES)
    throw new Error('请选择不超过 32 MB 的 Excel 文件。');
  guardZip(new Uint8Array(buffer));
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'array',
      cellDates: false,
      cellFormula: true,
      cellStyles: false,
      cellHTML: false,
      sheetRows: MAX_PHYSICAL_ROWS + 1,
      bookVBA: false,
    });
  } catch {
    throw new Error('无法读取这个工作簿。请使用未加密的 .xls 或 .xlsx 原始导出文件。');
  }
  if (!workbook.SheetNames.length || workbook.SheetNames.length > 40)
    throw new Error('工作表数量不受支持（最多 40 张）。');
  let totalRows = 0;
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const ref = sheet['!fullref'] || sheet['!ref'];
    if (!ref) return { name, rows: [] };
    const range = XLSX.utils.decode_range(ref);
    if (range.e.r >= MAX_PHYSICAL_ROWS || range.e.c >= MAX_COLUMNS)
      throw new Error('工作表超过 20 万行或 256 列，请分批导出。');
    totalRows += range.e.r + 1;
    if (totalRows > MAX_PHYSICAL_ROWS)
      throw new Error('整个文件超过记录与表头规模上限，请分批导出。');
    const rows: CellValue[][] = [];
    for (let row = 0; row <= range.e.r; row++) {
      const cells: CellValue[] = [];
      for (let column = 0; column <= range.e.c; column++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (!cell) {
          cells.push(null);
          continue;
        }
        if (cell.t === 'e' || (cell.f && cell.v === undefined)) {
          cells.push('#EXCEL_CELL_ERROR');
          continue;
        }
        const value: unknown = cell.v;
        if (typeof value === 'string' || typeof value === 'boolean') cells.push(value);
        else if (typeof value === 'number' && Number.isFinite(value)) cells.push(value);
        else cells.push(null);
      }
      rows.push(cells);
    }
    return { name, rows };
  });
  return {
    fileName,
    size: buffer.byteLength,
    date1904: workbook.Workbook?.WBProps?.date1904 === true,
    sheets,
  };
}
