import { LedgerError, MAX_AMOUNT_CENTS } from './model';

export function addCents(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || !Number.isSafeInteger(result))
    throw new LedgerError('金额合计超过安全范围', 'AMOUNT_OVERFLOW');
  return result;
}

/** Exact decimal parsing. No rounding or silent precision loss is performed. */
export function parseMoneyToCents(
  value: string | number,
  options: { allowZero?: boolean; allowNegative?: boolean } = {},
): number {
  const text = String(value).trim();
  if (!/^-?\d{1,9}(?:\.\d{0,2})?$/.test(text))
    throw new LedgerError('金额格式不正确，最多保留两位小数', 'INVALID_AMOUNT');
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const cents = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (negative ? -1 : 1);
  if (
    !Number.isSafeInteger(cents) ||
    Math.abs(cents) > MAX_AMOUNT_CENTS ||
    (!options.allowNegative && cents < 0) ||
    (!options.allowZero && cents === 0)
  )
    throw new LedgerError('金额必须大于零且在支持范围内', 'INVALID_AMOUNT');
  return cents;
}

export function evaluateMoneyExpression(expression: string): number {
  const parts = expression.replace(/\s/g, '').split(/([+-])/);
  if (!parts[0] || parts.length > 99) throw new LedgerError('请填写有效金额', 'INVALID_AMOUNT');
  let cents = parseMoneyToCents(parts[0], { allowZero: true });
  for (let index = 1; index < parts.length; index += 2) {
    const operand = parseMoneyToCents(parts[index + 1], { allowZero: true });
    cents = addCents(cents, operand * (parts[index] === '-' ? -1 : 1));
  }
  if (cents <= 0 || cents > MAX_AMOUNT_CENTS)
    throw new LedgerError('金额必须大于零且在支持范围内', 'INVALID_AMOUNT');
  return cents;
}

export function moneyInput(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new LedgerError('金额不在安全范围内', 'INVALID_AMOUNT');
  const absolute = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function formatMoney(cents: number): string {
  const input = moneyInput(cents);
  const [whole, fraction] = input.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
