import { describe, expect, it } from 'vitest';
import { planDetailsNavigation, resolveBookNavigation } from './navigation-state';

describe('导入完成后的明细导航', () => {
  it('数据尚未渲染时等待指定账本，不先显示旧账本明细', () => {
    const result = planDetailsNavigation('old', 'old', { bookId: 'imported', month: '2018-12' });
    expect(result.applyNow).toBe(false);
    expect(result.retainUntilBookEffect).toBe(true);
    expect(resolveBookNavigation('imported', result.request)).toEqual({
      bookId: 'imported',
      month: '2018-12',
    });
  });

  it('新账本已渲染但切换effect未运行时，保留请求避免被重置回首页', () => {
    const result = planDetailsNavigation('imported', 'old', {
      bookId: 'imported',
      month: '2018-12',
    });
    expect(result.applyNow).toBe(true);
    expect(result.retainUntilBookEffect).toBe(true);
    expect(resolveBookNavigation('imported', result.request)?.month).toBe('2018-12');
  });

  it('同账本导航立即完成，不留下会污染下次切账本的意图', () => {
    const result = planDetailsNavigation('current', 'current', { month: '2018-12' });
    expect(result.request.bookId).toBe('current');
    expect(result.applyNow).toBe(true);
    expect(result.retainUntilBookEffect).toBe(false);
    expect(resolveBookNavigation('unrelated', result.request)).toBeNull();
  });

  it('支持显式全部月份，并拒绝无效月份', () => {
    expect(planDetailsNavigation('current', 'current', { month: '' }).request.month).toBe('');
    expect(() => planDetailsNavigation('current', 'current', { month: '2018-99' })).toThrow();
  });
});
