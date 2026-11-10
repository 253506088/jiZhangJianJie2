import { LedgerError, MAX_AMOUNT_CENTS } from './model';

interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

const invalid = () => new LedgerError('请填写有效金额算式，支持加减乘除', 'INVALID_AMOUNT');

function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (denominator === 0n) throw new LedgerError('除数不能为零', 'INVALID_AMOUNT');
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  let left = numerator < 0n ? -numerator : numerator;
  let right = denominator;
  while (right) [left, right] = [right, left % right];
  return { numerator: numerator / left, denominator: denominator / left };
}

/**
 * Calculate in exact rational yuan, with multiplication/division before addition/subtraction.
 * Operands have at most two decimals. Round once, half up, at the final cent boundary.
 * No JavaScript expression execution or floating-point arithmetic is involved.
 */
export function evaluateMoneyExpression(expression: string): number {
  if (expression.length > 160) throw invalid();
  const text = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').trim();
  let position = 0;
  const skipSpaces = () => {
    while (/\s/.test(text[position] ?? '') && position < text.length) position++;
  };
  const operand = (): Fraction => {
    skipSpaces();
    let sign = 1n;
    if (text[position] === '+' || text[position] === '-') {
      if (text[position] === '-') sign = -1n;
      position++;
      skipSpaces();
    }
    const match = /^\d{1,9}(?:\.\d{0,2})?/.exec(text.slice(position));
    if (!match) throw invalid();
    position += match[0].length;
    const [whole, decimals = ''] = match[0].split('.');
    return fraction(sign * (BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0'))), 100n);
  };
  const product = (): Fraction => {
    let value = operand();
    skipSpaces();
    while (text[position] === '*' || text[position] === '/') {
      const operator = text[position++];
      const next = operand();
      value =
        operator === '*'
          ? fraction(value.numerator * next.numerator, value.denominator * next.denominator)
          : fraction(value.numerator * next.denominator, value.denominator * next.numerator);
      skipSpaces();
    }
    return value;
  };
  let result = product();
  skipSpaces();
  while (text[position] === '+' || text[position] === '-') {
    const operator = text[position++];
    const next = product();
    result = fraction(
      result.numerator * next.denominator +
        (operator === '+' ? 1n : -1n) * next.numerator * result.denominator,
      result.denominator * next.denominator,
    );
    skipSpaces();
  }
  if (position !== text.length) throw invalid();
  if (result.numerator <= 0n) throw new LedgerError('计算结果必须大于零', 'INVALID_AMOUNT');
  const scaled = result.numerator * 100n;
  const cents =
    scaled / result.denominator +
    ((scaled % result.denominator) * 2n >= result.denominator ? 1n : 0n);
  if (cents === 0n) throw new LedgerError('计算结果小于 0.01 元，请调整金额', 'INVALID_AMOUNT');
  if (cents > BigInt(MAX_AMOUNT_CENTS))
    throw new LedgerError('计算结果超过支持的金额范围', 'AMOUNT_OVERFLOW');
  return Number(cents);
}
