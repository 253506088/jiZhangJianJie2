import { expect, type Locator, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const HEADER = ['日期', '收支类型', '金额', '一级分类', '二级分类', '账户', '备注', '账本'];
export const FIXED_TIME = new Date('2026-11-08T04:00:00+08:00');
export type SyntheticRow = (string | number | boolean | null)[];

export function originalLegacyFixture() {
  const buffer = readFileSync(
    new URL('../fixtures/legacy-4.8.8-two-expenses.xls', import.meta.url),
  );
  if (
    createHash('sha256').update(buffer).digest('hex') !==
    '7d523af1fdfc2d5a0ce09db52f9a57a9a3aae883a7c78bbe7c06b2d442d3ed7b'
  )
    throw new Error(
      'Original APK fixture identity changed; re-check its provenance before testing.',
    );
  return { name: 'legacy-4.8.8-two-expenses.xls', mimeType: 'application/vnd.ms-excel', buffer };
}

export function originalBorrowFixture() {
  const buffer = readFileSync(new URL('../fixtures/legacy-4.8.8-borrow71.xls', import.meta.url));
  if (
    createHash('sha256').update(buffer).digest('hex') !==
    '18bf7fe8803187e5274dc6af2a6aa2175b9f9a856e1fb2555dea0bf898c8f64e'
  )
    throw new Error('Original APK loan fixture identity changed; re-check provenance.');
  return { name: 'legacy-4.8.8-borrow71.xls', mimeType: 'application/vnd.ms-excel', buffer };
}

/** Generated from fixed, fictional rows in memory; never opens a user export. */
export function syntheticExcel(
  rows: SyntheticRow[],
  format: 'xls' | 'xlsx' = 'xlsx',
  name = `fictional-ledger.${format}`,
) {
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: '虚构数据自动化测试', Author: 'Local test', CreatedDate: FIXED_TIME };
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([HEADER, ...rows]), '虚构流水');
  return {
    name,
    mimeType:
      format === 'xls'
        ? 'application/vnd.ms-excel'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(
      XLSX.write(workbook, {
        type: 'buffer',
        bookType: format === 'xls' ? 'biff8' : 'xlsx',
        compression: true,
      }),
    ),
  };
}

export function active(page: Page): Locator {
  return page.locator('.lj-route-frame:not([hidden])');
}

export async function openFreshApp(page: Page) {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto('/');
  await expect(page.locator('.ledger-app')).toBeVisible();
  await expect(active(page).getByRole('heading', { name: '简洁记账', exact: true })).toBeVisible();
}

export async function backHome(page: Page) {
  for (let index = 0; index < 8; index++) {
    if (await active(page).locator('.lj-home').count()) return;
    // The active frame itself may be the home route's wrapper, so also inspect its heading.
    if (await active(page).getByRole('heading', { name: '简洁记账', exact: true }).isVisible())
      return;
    const before = await active(page).getByRole('heading').first().textContent();
    await active(page).getByRole('button', { name: '返回', exact: true }).click();
    await expect
      .poll(async () => active(page).getByRole('heading').first().textContent())
      .not.toBe(before);
  }
  throw new Error('Expected to return to the app home within the bounded route stack');
}

export async function openData(page: Page) {
  await backHome(page);
  await active(page).getByRole('button', { name: '数据与设置', exact: true }).click();
  await expect(
    active(page).getByRole('heading', { name: '数据与设置', exact: true }),
  ).toBeVisible();
}

export async function openImport(page: Page, file: ReturnType<typeof syntheticExcel>) {
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^从旧版 Excel 导入/ })
    .click();
  const dialog = page.getByRole('dialog', { name: '导入旧账本', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('选择Excel文件', { exact: true }).setInputFiles(file);
  await expect(dialog.getByLabel('当前工作表', { exact: true })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: '检查导入结果', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '有效记录预览', exact: true })).toBeVisible();
  return dialog;
}

export async function importExcel(
  page: Page,
  file: ReturnType<typeof syntheticExcel>,
  count: number,
) {
  const dialog = await openImport(page, file);
  const confirm = dialog.getByRole('button', { name: new RegExp(`^确认导入\\s+${count}\\s+笔$`) });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(active(page).getByRole('heading', { name: '收支明细', exact: true })).toBeVisible();
}

export async function openEntry(page: Page) {
  await backHome(page);
  await active(page)
    .getByRole('button', { name: /^记一笔(?:\s*记下今天的小日常)?$/ })
    .click();
  await expect(active(page).getByRole('heading', { name: '记一笔', exact: true })).toBeVisible();
}

/** Existing UI regression exercises the retained classic option through real settings controls. */
export async function useClassicLayout(page: Page) {
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^经典首页/ })
    .click();
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-home-layout', 'classic');
  await active(page).getByRole('button', { name: '选择珊瑚配色', exact: true }).click();
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-accent', 'coral');
  await backHome(page);
}

export async function enterKeys(page: Page, keys: string[]) {
  for (const key of keys)
    await active(page).getByRole('button', { name: key, exact: true }).click();
}

export async function addExpense(
  page: Page,
  primary: string,
  secondary: string,
  amount: string,
  note: string,
  date?: string,
) {
  await openEntry(page);
  await active(page).getByRole('button', { name: primary, exact: true }).click();
  await active(page).getByRole('button', { name: secondary, exact: true }).click();
  await active(page).getByLabel('金额', { exact: true }).fill(amount);
  await active(page).getByLabel('备注', { exact: true }).fill(note);
  if (date) await active(page).getByLabel('记账日期', { exact: true }).fill(date);
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(active(page).getByRole('heading', { name: '简洁记账', exact: true })).toBeVisible();
}

export async function openReports(page: Page, allMonths = true) {
  await backHome(page);
  await active(page).getByRole('button', { name: '报表', exact: true }).click();
  await expect(active(page).getByRole('heading', { name: '收支报表', exact: true })).toBeVisible();
  if (allMonths) await active(page).getByRole('button', { name: '全部', exact: true }).click();
}

export function reportRow(page: Page, path: string) {
  return active(page).locator('.lj-report-row').filter({ hasText: path });
}

export async function openCategories(page: Page) {
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^分类管理/ })
    .click();
  await expect(active(page).getByRole('heading', { name: '分类管理', exact: true })).toBeVisible();
}

export async function createAccount(page: Page, name: string, opening: string, kind = 'wallet') {
  await backHome(page);
  await active(page).getByRole('button', { name: '账户', exact: true }).click();
  await active(page).getByRole('button', { name: '新建账户', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建账户', exact: true });
  await dialog.getByLabel('账户名称', { exact: true }).fill(name);
  await dialog.getByLabel('账户类型', { exact: true }).selectOption(kind);
  await dialog.getByLabel('期初余额', { exact: true }).fill(opening);
  await dialog.getByRole('button', { name: '保存账户', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
