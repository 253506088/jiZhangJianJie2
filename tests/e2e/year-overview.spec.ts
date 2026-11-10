import { expect, test } from '@playwright/test';
import { active, backHome, importExcel, openFreshApp, syntheticExcel } from './helpers';

test('本年汇总与明细覆盖全年，排除相邻年份', async ({ page }) => {
  await openFreshApp(page);
  await importExcel(
    page,
    syntheticExcel([
      ['2026-01-01', '支出', 10, '测试餐饮', '早餐', '现金', '', '日常账本'],
      ['2026-11-08', '支出', 20, '测试餐饮', '早餐', '现金', '', '日常账本'],
      ['2026-12-31', '收入', 30, '测试收入', '', '现金', '', '日常账本'],
      ['2025-12-31', '支出', 40, '测试餐饮', '早餐', '现金', '', '日常账本'],
      ['2027-01-01', '支出', 50, '测试餐饮', '早餐', '现金', '', '日常账本'],
    ]),
    5,
  );
  await backHome(page);
  const card = active(page).getByRole('button', { name: '查看本年明细', exact: true });
  await expect(card).toContainText('已记账 3 笔');
  await expect(card).toContainText('收入30.00');
  await expect(card).toContainText('支出30.00');
  await card.click();
  await expect(active(page)).toContainText('2026-01-01');
  await expect(active(page)).toContainText('2026-12-31');
  await expect(active(page)).not.toContainText('2025-12-31');
  await expect(active(page)).not.toContainText('2027-01-01');
});
