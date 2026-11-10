import { describe, expect, it } from 'vitest';
import { evaluateMoneyExpression } from './money-expression';

describe('金额四则运算', () => {
  it.each([
    ['0.10+0.20', 30],
    ['12.50+7.25-3.10', 1665],
    ['2+3×4', 1400],
    ['20-6÷4', 1850],
    ['8÷4×2', 400],
    ['5-2-1', 200],
    [' 2 + 3 * 4 / 2 ', 800],
    ['0.1×0.2', 2],
    ['1÷3', 33],
    ['2÷3', 67],
    ['0.01÷2', 1],
    ['1÷3×3', 100],
    ['0.01÷2+0.01÷2', 1],
    ['-1+2', 100],
    ['1--2', 300],
    ['999999999×999999999÷999999999', 99999999900],
  ])('精确计算 %s 得到 %i 分', (expression, cents) => {
    expect(evaluateMoneyExpression(expression)).toBe(cents);
  });

  it.each([
    '',
    '0',
    '-1',
    '1-2',
    '1+',
    '2×',
    '1/0',
    '1/0.00',
    '0.001',
    '1.234+1',
    '1e3',
    '9999999999',
    '999999999×2',
    '0.01/3',
    '1 2',
    '1..2',
    '1;alert(1)',
    'Math.random()',
    '2**3',
    '(1+2)*3',
    '1/'.repeat(90),
  ])('拒绝无效或无法保存的金额 %s', (expression) => {
    expect(() => evaluateMoneyExpression(expression)).toThrow();
  });

  it('分别解释除零、负结果、不到一分和溢出', () => {
    expect(() => evaluateMoneyExpression('1/0')).toThrow('除数不能为零');
    expect(() => evaluateMoneyExpression('1-2')).toThrow('计算结果必须大于零');
    expect(() => evaluateMoneyExpression('0.01/3')).toThrow('小于 0.01 元');
    expect(() => evaluateMoneyExpression('999999999*2')).toThrow('超过支持的金额范围');
  });
});
