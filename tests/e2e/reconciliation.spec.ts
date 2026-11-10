import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { active, importExcel, openData, openFreshApp } from './helpers';

/** Only the committed fictional original-app fixture is read. */
function annualFixture(changeIncome = false, annual = true) {
  const original = readFileSync(
    new URL('../fixtures/legacy-4.8.8-full-types.xls', import.meta.url),
  );
  expect(createHash('sha256').update(original).digest('hex')).toBe(
    'b809a5863a215c3f32457fe33f3e4ef0f2ee4ba90a1b0436de81ef97cade1584',
  );
  const workbook = XLSX.read(original);
  for (const name of workbook.SheetNames) {
    if (annual) workbook.Sheets[name].B2 = { t: 's', v: '2026-01-01 - 2027-01-01' };
    if (changeIncome && name === '收入') {
      workbook.Sheets[name].A4 = { t: 's', v: '101.24' };
      workbook.Sheets[name].B1 = { t: 's', v: '101.24' };
    }
  }
  return {
    name: 'fictional-annual-reconciliation.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })),
  };
}

async function openReconciliation(page: Page, file = annualFixture()) {
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^年度 Excel 对账/ })
    .click();
  const dialog = page.getByRole('dialog', { name: '年度 Excel 对账', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('对账年份', { exact: true }).fill('2026');
  await dialog.getByLabel('选择年度对账Excel', { exact: true }).setInputFiles(file);
  await dialog.getByRole('button', { name: '开始年度对账', exact: true }).click();
  return dialog;
}

test('年度四表逐笔通过，默认脱敏报告且账本重启后不变', async ({ page }, testInfo) => {
  await openFreshApp(page);
  await importExcel(page, annualFixture(), 8);
  let dialog = await openReconciliation(page);
  await expect(
    dialog.getByRole('heading', { name: '本年明细逐笔一致', exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText('旧版 8 笔 · 新版 8 笔 · 完全匹配 8 笔');
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.screenshot({ path: testInfo.outputPath('annual-reconciliation-mobile.png') });
  await expect(dialog).not.toContainText('Fixture salary memo');
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '保存脱敏报告', exact: true }).click();
  const download = await downloadEvent;
  const reportPath = testInfo.outputPath('redacted-annual-report.json');
  await download.saveAs(reportPath);
  const reportText = readFileSync(reportPath, 'utf8');
  const report = JSON.parse(reportText);
  expect(report).toMatchObject({
    passed: true,
    year: 2026,
    legacyCount: 8,
    currentCount: 8,
    matchedCount: 8,
  });
  for (const value of ['amountCents', 'Fixture', '2026-11-', '现金', '储蓄卡'])
    expect(reportText).not.toContain(value);
  await dialog.getByRole('button', { name: '关闭年度对账', exact: true }).click();
  await page.reload();
  await expect(page.locator('.ledger-app')).toBeVisible();
  dialog = await openReconciliation(page);
  await expect(
    dialog.getByRole('heading', { name: '本年明细逐笔一致', exact: true }),
  ).toBeVisible();
});

test('相同笔数的一分错额显示位置，明确展开后显示金额和备注', async ({ page }) => {
  await openFreshApp(page);
  await importExcel(page, annualFixture(true), 8);
  const dialog = await openReconciliation(page);
  await expect(
    dialog.getByRole('heading', { name: '本年对账尚未通过', exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText('旧版 8 笔 · 新版 8 笔 · 完全匹配 7 笔');
  await expect(dialog).toContainText('金额不同');
  await expect(dialog).toContainText('收入表第 4 行');
  await expect(dialog).not.toContainText('101.25');
  await dialog.getByLabel('显示并导出金额、日期、账户、备注等明细').check();
  await expect(dialog).toContainText('101.25');
  await expect(dialog).toContainText('101.24');
  await expect(dialog).toContainText('Fixture salary memo');
  await expect(dialog.getByRole('button', { name: '保存含明细报告', exact: true })).toBeVisible();
});

test('月度文件即使所有行都匹配也不能通过全年对账，切年份清除旧结果', async ({ page }) => {
  await openFreshApp(page);
  await importExcel(page, annualFixture(false, false), 8);
  const dialog = await openReconciliation(page, annualFixture(false, false));
  await expect(
    dialog.getByRole('heading', { name: '本年对账尚未通过', exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText('完全匹配 8 笔');
  await expect(dialog).toContainText('未完整覆盖所选全年');
  await dialog.getByLabel('对账年份', { exact: true }).fill('2025');
  await expect(dialog.getByLabel('年度对账结果')).not.toBeVisible();
  await dialog.getByRole('button', { name: '开始年度对账', exact: true }).click();
  await expect(dialog).toContainText('旧版 0 笔 · 新版 0 笔 · 完全匹配 0 笔');
  await expect(
    dialog.getByRole('heading', { name: '本年对账尚未通过', exact: true }),
  ).toBeVisible();
});
