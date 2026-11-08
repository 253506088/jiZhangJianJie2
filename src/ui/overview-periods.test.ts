import { describe, expect, it } from 'vitest';
import { overviewPeriods } from './overview-periods';

describe('概况的本地日历范围', () => {
  it('周一到周日，跨月份也不混入其他日期', () => {
    const periods = overviewPeriods(new Date(2026, 10, 1, 23, 30));
    expect(periods).toEqual([
      { key: 'day', label: '今天', fromDate: '2026-11-01', toDate: '2026-11-01' },
      { key: 'week', label: '本周', fromDate: '2026-10-26', toDate: '2026-11-01' },
      { key: 'month', label: '本月', fromDate: '2026-11-01', toDate: '2026-11-30' },
    ]);
  });
  it('闰年二月与跨年周使用真实日历', () => {
    expect(overviewPeriods(new Date(2024, 1, 29))[2].toDate).toBe('2024-02-29');
    expect(overviewPeriods(new Date(2026, 0, 1))[1]).toEqual({
      key: 'week',
      label: '本周',
      fromDate: '2025-12-29',
      toDate: '2026-01-04',
    });
  });
});
