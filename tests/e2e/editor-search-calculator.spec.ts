import { expect, test } from '@playwright/test';
import {
  active,
  enterKeys,
  importExcel,
  openEntry,
  openFreshApp,
  openReports,
  reportRow,
  syntheticExcel,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openFreshApp(page);
  await importExcel(
    page,
    syntheticExcel([
      ['2026-11-08', '支出', 1, '餐饮', '其他', '现金', '虚构餐饮', '生活账本'],
      ['2026-11-08', '支出', 2, '交通', '其他', '现金', '虚构交通', '生活账本'],
      ['2026-11-08', '收入', 3, '收入', '其他收入', '现金', '虚构收入', '生活账本'],
    ]),
    3,
  );
  await openEntry(page);
  await expect(page.locator('.root-notice')).not.toBeVisible();
  await expect(page.locator('.lj-toast')).not.toBeVisible();
});

test('跨一级搜索同名分类后用四则键盘记账，完整路径与金额刷新后保持', async ({ page }, testInfo) => {
  await active(page).getByRole('button', { name: '餐饮', exact: true }).click();
  await active(page).getByLabel('搜索分类', { exact: true }).fill('其他');
  const results = active(page).getByRole('region', { name: '分类搜索结果', exact: true });
  await expect(results.getByRole('button')).toHaveCount(2);
  await expect(results.getByRole('button', { name: '餐饮 / 其他', exact: true })).toBeVisible();
  await expect(results.getByRole('button', { name: '交通 / 其他', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('category-search.png'), fullPage: true });
  await results.getByRole('button', { name: '交通 / 其他', exact: true }).click();
  await expect(active(page).getByRole('button', { name: '交通', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(active(page).getByLabel('搜索分类', { exact: true })).toHaveValue('');
  await enterKeys(page, ['2', '加', '3', '乘', '4', '除', '2', '减', '1']);
  await expect(active(page).getByLabel('计算预览', { exact: true })).toHaveText('= ¥7.00');
  await page.screenshot({ path: testInfo.outputPath('four-operator-entry.png'), fullPage: true });
  await active(page).getByRole('button', { name: '计算结果', exact: true }).click();
  await expect(active(page).getByLabel('金额', { exact: true })).toHaveValue('7.00');
  await active(page).getByLabel('备注', { exact: true }).fill('虚构搜索与四则记账');
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await page.reload();
  await openReports(page);
  await expect(reportRow(page, '交通 / 其他')).toContainText('9.00');
  await expect(reportRow(page, '交通 / 其他')).toContainText('2 笔');
  await expect(reportRow(page, '餐饮 / 其他')).toContainText('1.00');
  await expect(reportRow(page, '餐饮 / 其他')).toContainText('1 笔');
});

test('除零不保存；可预览除法舍入并直接保存最终只舍入一次的算式', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await active(page).getByLabel('金额', { exact: true }).fill('1÷0');
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(active(page).getByRole('alert')).toHaveText('除数不能为零');
  await expect(active(page).getByRole('heading', { name: '记一笔', exact: true })).toBeVisible();
  await enterKeys(page, ['清空金额', '1', '除', '3', '计算结果']);
  await expect(active(page).getByLabel('金额', { exact: true })).toHaveValue('0.33');
  await active(page).getByLabel('金额', { exact: true }).fill('0.01÷2+0.01÷2');
  await expect(active(page).getByLabel('计算预览', { exact: true })).toHaveText('= ¥0.01');
  await expect(active(page).locator('.lj-entry-tools')).toBeInViewport();
  await expect(active(page).getByRole('button', { name: '乘', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('calculator-320px.png'), fullPage: true });
  await active(page).getByRole('button', { name: '再记一笔', exact: true }).click();
  await expect(active(page).getByLabel('金额', { exact: true })).toHaveValue('');
  await active(page).getByRole('button', { name: '返回', exact: true }).click();
  await openReports(page);
  await expect(reportRow(page, '餐饮 / 其他')).toContainText('1.01');
  await expect(reportRow(page, '餐饮 / 其他')).toContainText('2 笔');
});

test('搜索空结果不改分类，切换类型清空查询且收入结果保持类型隔离', async ({ page }) => {
  await active(page).getByLabel('搜索分类', { exact: true }).fill('不存在');
  await expect(
    active(page).getByText('没有找到分类，试试其他关键词', { exact: true }),
  ).toBeVisible();
  await active(page).getByRole('button', { name: '清除分类搜索', exact: true }).click();
  await expect(active(page).getByRole('button', { name: '餐饮', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await active(page).getByLabel('搜索分类', { exact: true }).fill('交通');
  await active(page).getByRole('button', { name: '收入', exact: true }).click();
  await expect(active(page).getByLabel('搜索分类', { exact: true })).toHaveValue('');
  await active(page).getByLabel('搜索分类', { exact: true }).fill('其他');
  const results = active(page).getByRole('region', { name: '分类搜索结果', exact: true });
  await expect(results.getByRole('button')).toHaveCount(1);
  await expect(results.getByRole('button', { name: '收入 / 其他收入', exact: true })).toBeVisible();
  await active(page).getByRole('button', { name: '转账', exact: true }).click();
  await expect(active(page).getByLabel('搜索分类', { exact: true })).toHaveCount(0);
});
