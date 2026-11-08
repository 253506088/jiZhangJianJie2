import { expect, test } from '@playwright/test';
import {
  active,
  createAccount,
  importExcel,
  openEntry,
  openFreshApp,
  openReports,
  originalLegacyFixture,
} from './helpers';

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });
test('收入再记一笔按原版回到支出，清空金额备注并保留账户成员、更新时分', async ({ page }) => {
  await openFreshApp(page);
  await importExcel(page, originalLegacyFixture(), 2);
  await createAccount(page, '虚构储蓄卡', '0', 'bank');
  await openEntry(page);
  await active(page).getByRole('button', { name: 'FixtureFood', exact: true }).click();
  await active(page).getByRole('button', { name: 'FixtureBreakfast', exact: true }).click();
  await active(page).getByRole('button', { name: '收入', exact: true }).click();
  await active(page).getByRole('button', { name: '新建收入类别', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新建收入类别', exact: true });
  await dialog.getByLabel('收入类别名称', { exact: true }).fill('工资');
  await dialog.getByRole('button', { name: '保存类别', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await active(page).getByRole('button', { name: '新建记账成员', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建成员', exact: true });
  await dialog.getByLabel('成员名称', { exact: true }).fill('FixtureMember');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await active(page).getByLabel('记账账户', { exact: true }).selectOption({ label: '虚构储蓄卡' });
  await active(page).getByLabel('金额', { exact: true }).fill('101.25');
  await active(page).getByLabel('记账时间', { exact: true }).fill('01:23');
  await active(page).getByLabel('备注', { exact: true }).fill('虚构收入再记测试');
  await active(page).getByRole('button', { name: '再记一笔', exact: true }).click();
  await expect(active(page).getByRole('button', { name: '支出', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    active(page).getByRole('button', { name: 'FixtureBreakfast', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(active(page).getByLabel('金额', { exact: true })).toHaveValue('');
  await expect(active(page).getByLabel('备注', { exact: true })).toHaveValue('');
  await expect(
    active(page).getByLabel('记账账户', { exact: true }).locator('option:checked'),
  ).toHaveText('虚构储蓄卡');
  await expect(
    active(page).getByLabel('成员', { exact: true }).locator('option:checked'),
  ).toHaveText('FixtureMember');
  await expect(active(page).getByLabel('记账时间', { exact: true })).toHaveValue('04:00');
  await expect(active(page).locator('.lj-calculator')).toBeVisible();
  await openReports(page);
  await expect(active(page).locator('.lj-report-chart')).toContainText('20.00');
  await active(page).getByRole('button', { name: '收入分析', exact: true }).click();
  await expect(active(page).locator('.lj-report-chart')).toContainText('101.25');
  await expect(active(page).locator('.lj-report-chart')).toContainText(/1\s*笔/);
});

test('转账再记一笔回到支出并保留原账户而非目标账户，普通收支不变', async ({ page }) => {
  await openFreshApp(page);
  await importExcel(page, originalLegacyFixture(), 2);
  await createAccount(page, '虚构储蓄卡', '100', 'bank');
  await openEntry(page);
  await active(page).getByRole('button', { name: '转账', exact: true }).click();
  await active(page).getByLabel('转出账户', { exact: true }).selectOption({ label: '虚构储蓄卡' });
  await active(page).getByLabel('转入账户', { exact: true }).selectOption({ label: '现金' });
  await active(page).getByRole('button', { name: '新建记账成员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建成员', exact: true });
  await dialog.getByLabel('成员名称', { exact: true }).fill('FixtureMember');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await active(page).getByLabel('金额', { exact: true }).fill('9.50');
  await active(page).getByLabel('记账时间', { exact: true }).fill('01:23');
  await active(page).getByLabel('备注', { exact: true }).fill('虚构转账再记测试');
  await active(page).getByRole('button', { name: '再记一笔', exact: true }).click();
  await expect(active(page).getByRole('button', { name: '支出', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(active(page).getByLabel('金额', { exact: true })).toHaveValue('');
  await expect(active(page).getByLabel('备注', { exact: true })).toHaveValue('');
  await expect(
    active(page).getByLabel('记账账户', { exact: true }).locator('option:checked'),
  ).toHaveText('虚构储蓄卡');
  await expect(
    active(page).getByLabel('成员', { exact: true }).locator('option:checked'),
  ).toHaveText('FixtureMember');
  await expect(active(page).getByLabel('记账时间', { exact: true })).toHaveValue('04:00');
  await expect(active(page).locator('.lj-calculator')).toBeVisible();
  await openReports(page);
  await expect(active(page).locator('.lj-report-chart')).toContainText('20.00');
  await active(page).getByRole('button', { name: '收入分析', exact: true }).click();
  await expect(active(page).locator('.lj-report-chart')).toContainText('0.00');
});
