import { expect, test } from '@playwright/test';
import {
  active,
  backHome,
  importExcel,
  openData,
  openFreshApp,
  openReports,
  originalBorrowFixture,
} from './helpers';

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });
test('原APK借入71元的真实格式xls保留三笔记录、成员和借贷人并复现原余额', async ({
  page,
}, testInfo) => {
  await openFreshApp(page);
  await importExcel(page, originalBorrowFixture(), 3);
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(3);
  await expect(
    active(page).getByRole('button', { name: /查看借入.*FixtureLender.*71.00元/ }),
  ).toBeVisible();
  await backHome(page);
  await active(page).getByRole('button', { name: '账户', exact: true }).click();
  await expect(active(page).locator('.lj-account-total')).toContainText('51.00');
  await expect(active(page).locator('.lj-loan-balance-summary strong')).toHaveText('-71.00');
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^借贷人管理/ })
    .click();
  await expect(active(page).locator('.lj-person-card')).toContainText('FixtureLender');
  await expect(active(page).locator('.lj-person-card')).toContainText('1 笔关联记录');
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^成员管理/ })
    .click();
  await expect(active(page).locator('.lj-person-card')).toHaveCount(1);
  await expect(active(page).locator('.lj-person-card')).toContainText('自己');
  await expect(active(page).locator('.lj-person-card')).toContainText('2 笔关联记录');
  await openReports(page);
  await expect(active(page).locator('.lj-report-chart')).toContainText('20.00');
  await active(page).getByRole('button', { name: '收入分析', exact: true }).click();
  await expect(active(page).locator('.lj-report-chart')).toContainText('0.00');
  await page.screenshot({
    path: testInfo.outputPath('original-borrow-file-no-false-income.png'),
    fullPage: true,
  });
});
