import { isValidDate, MAX_AMOUNT_CENTS } from '../core/model';
import type { CellValue, SheetMapping } from './types';

export function cellText(value: CellValue | undefined) {
  return value === null || value === undefined ? '' : String(value).trim();
}
export function isBlank(value: CellValue | undefined) {
  return cellText(value) === '';
}

export function excelMoney(value: CellValue | undefined, allowZero = false): number {
  let text = cellText(value)
    .normalize('NFKC')
    .replace(/[¥￥,，\s]/g, '')
    .replace(/^(?:人民币|RMB|CNY)/i, '')
    .replace(/元$/, '');
  if (typeof value === 'number') {
    const rounded = Math.round(value * 100);
    if (Number.isSafeInteger(rounded) && Math.abs(value * 100 - rounded) < 0.000001) {
      if (Math.abs(rounded) <= MAX_AMOUNT_CENTS && (allowZero || rounded !== 0)) return rounded;
    }
    throw new Error('金额包含超出两位小数的精度或超过支持范围，请确认原单元格。');
  }
  if (/^\(.*\)$/.test(text)) text = `-${text.slice(1, -1)}`;
  if (!/^[+-]?\d{1,9}(?:\.\d{0,2})?$/.test(text))
    throw new Error('金额不是有效的数字（最多两位小数）。');
  const negative = text.startsWith('-');
  const [whole, decimal = ''] = text.replace(/^[+-]/, '').split('.');
  const cents = (Number(whole) * 100 + Number(decimal.padEnd(2, '0'))) * (negative ? -1 : 1);
  if (
    !Number.isSafeInteger(cents) ||
    Math.abs(cents) > MAX_AMOUNT_CENTS ||
    (!allowZero && cents === 0)
  )
    throw new Error('金额为零或超出支持范围。');
  return cents;
}

function timeFromSeconds(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function excelTime(value: CellValue | undefined): string | undefined {
  if (isBlank(value)) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error('时间单元格无效。');
    const seconds = Math.round((value - Math.floor(value)) * 86400);
    return timeFromSeconds(Math.min(seconds, 86399));
  }
  const text = cellText(value).normalize('NFKC');
  const match = text.match(
    /(?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? 0) > 59)
    throw new Error('时间需为时:分或时:分:秒。');
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}`;
}

/** Preserve the calendar date written in Excel, without implicit timezone conversion. */
export function excelDate(
  value: CellValue | undefined,
  date1904: boolean,
  order: SheetMapping['dateOrder'],
): { date: string; time?: string } {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 2_958_465)
      throw new Error('Excel 日期数值超出范围。');
    const days = Math.floor(value);
    if (!date1904 && (days === 60 || days === 0))
      throw new Error('Excel 日期无效（含 1900 年闰日兼容值）。');
    const base = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31);
    const adjusted = date1904 ? days : days - (days > 60 ? 1 : 0);
    const date = new Date(base + adjusted * 86400000).toISOString().slice(0, 10);
    return { date, ...(value !== days ? { time: excelTime(value) } : {}) };
  }
  const text = cellText(value).normalize('NFKC');
  const normalized = text.replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-');
  const match = normalized.match(/^(\d{1,4})[-.](\d{1,2})[-.](\d{1,4})(?:[ T](.*))?$/);
  if (!match) throw new Error('日期格式无法识别，请确认日期列和年月日顺序。');
  let year: string, month: string, day: string;
  if (match[1].length === 4) [, year, month, day] = match;
  else if (order === 'dmy' && match[3].length === 4) {
    day = match[1];
    month = match[2];
    year = match[3];
  } else if (order === 'mdy' && match[3].length === 4) {
    month = match[1];
    day = match[2];
    year = match[3];
  } else throw new Error('日期存在日/月歧义，请选择日/月/年或月/日/年。');
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (!isValidDate(date)) throw new Error('日期不在有效日历范围内。');
  return { date, ...(match[4] ? { time: excelTime(match[4]) } : {}) };
}
