import { createHash } from 'node:crypto';
import { readFile, readFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import * as XLSX from 'xlsx';
import { autoMapping } from '../../src/imports/mapping';
import { prepareImport } from '../../src/imports/plan';
import { readWorkbookBytes } from '../../src/imports/workbook';
import { active, addExpense, importExcel, openData, openFreshApp } from './helpers';

const SOURCE_HASH = 'b809a5863a215c3f32457fe33f3e4ef0f2ee4ba90a1b0436de81ef97cade1584';
const WORKER_ROUTE = '**/src/exports/excel.worker.ts*';

function fixture() {
  const buffer = readFileSync(new URL('../fixtures/legacy-4.8.8-full-types.xls', import.meta.url));
  if (createHash('sha256').update(buffer).digest('hex') !== SOURCE_HASH)
    throw new Error('Only the verified original-app fictional fixture may be used by this test.');
  return { name: 'legacy-4.8.8-full-types.xls', mimeType: 'application/vnd.ms-excel', buffer };
}

function parsed(buffer: Uint8Array, fileName: string) {
  const workbook = {
    ...readWorkbookBytes(new Uint8Array(buffer).buffer, fileName),
    digest: createHash('sha256').update(buffer).digest('hex'),
  };
  return { workbook, plan: prepareImport(workbook, workbook.sheets.map(autoMapping)) };
}

/** Read-only snapshot of this test's fresh browser context, populated only from the named fictional fixture. */
async function storedSnapshot(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('jizhang-jianjie2-production');
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(
          new Error('Test ledger was not initialized; no database is created by this reader.'),
        );
      };
      request.onerror = () => reject(new Error('Cannot read the initialized test ledger.'));
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise<{ revision: number; data: string; sha256: string }>(
        (resolve, reject) => {
          const transaction = database.transaction('current', 'readonly');
          const request = transaction.objectStore('current').get('ledger');
          request.onerror = () => reject(new Error('Cannot read test snapshot.'));
          request.onsuccess = () => {
            const snapshot = request.result;
            if (!snapshot) reject(new Error('Test snapshot missing.'));
            else
              resolve({
                revision: snapshot.revision,
                data: snapshot.data,
                sha256: snapshot.sha256,
              });
          };
        },
      );
    } finally {
      database.close();
    }
  });
}

async function openExport(page: Page) {
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^导出 Excel/ })
    .click();
  const dialog = page.getByRole('dialog', { name: '导出 Excel', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function saveExport(
  page: Page,
  dialog: Locator,
  testInfo: TestInfo,
  name: string,
  count: number,
) {
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '生成并保存 Excel', exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  const path = testInfo.outputPath(name);
  await download.saveAs(path);
  await expect(
    dialog.getByText(`已发起 ${count} 笔明细的下载，请确认浏览器保存结果。`, { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(new RegExp(`^已保存并校验 ${count} 笔明细`))).toHaveCount(0);
  const buffer = await readFileAsync(path);
  return { buffer, suggested: download.suggestedFilename(), ...parsed(buffer, name) };
}

test.beforeEach(async ({ page }) => {
  await openFreshApp(page);
  await importExcel(page, fixture(), 8);
});

test('原包八笔四类型导入后，XLSX实际下载并核对全部成员、金额和时间', async ({ page }, testInfo) => {
  const before = await storedSnapshot(page);
  const dialog = await openExport(page);
  await expect(dialog.getByRole('heading', { name: /^将导出\s+8\s+笔$/ })).toBeVisible();
  await expect(dialog.getByLabel('导出全部历史', { exact: true })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /^XLSX\b/ })).toBeChecked();
  await expect(dialog).toContainText('完整迁移请用完整备份');
  const result = await saveExport(page, dialog, testInfo, 'eight-records.xlsx', 8);
  expect(result.suggested).toMatch(/\.xlsx$/);
  expect([...result.buffer.subarray(0, 2)]).toEqual([0x50, 0x4b]);
  expect(result.workbook.sheets.map((sheet) => sheet.name)).toEqual([
    '支出',
    '收入',
    '转账',
    '借贷',
  ]);
  const reference = parsed(fixture().buffer, 'legacy-4.8.8-full-types.xls');
  for (const sheet of result.workbook.sheets) {
    const original = reference.workbook.sheets.find((item) => item.name === sheet.name)!;
    expect(sheet.rows[2]).toEqual(original.rows[2]);
    expect(sheet.rows.slice(3)).toEqual(original.rows.slice(3));
  }
  expect(result.workbook.sheets[0].rows[0].slice(0, 2)).toEqual(['支出', '20.00']);
  expect(result.workbook.sheets[1].rows[0].slice(0, 2)).toEqual(['收入', '101.25']);
  expect(result.plan.errors).toEqual([]);
  expect(result.plan.rows).toHaveLength(8);
  expect(result.plan.totals).toEqual({ expense: 2000, income: 10125, transfer: 550, loan: 10200 });
  expect(
    result.plan.rows.filter((row) => row.direction === 'loan').map((row) => row.loanType),
  ).toEqual(['borrow', 'lend', 'repay', 'collect']);
  expect(
    result.plan.rows
      .filter((row) => row.direction === 'loan')
      .every((row) => row.person === 'FixtureLender'),
  ).toBe(true);
  expect(result.plan.rows.find((row) => row.direction === 'income')?.member).toBe('FixtureMember');
  expect(result.plan.rows.find((row) => row.direction === 'transfer')?.member).toBe(
    'FixtureMember',
  );
  expect(result.workbook.sheets[2].rows[3][1]).toBe('');
  expect(await storedSnapshot(page)).toEqual(before);
  await page.screenshot({
    path: testInfo.outputPath('xlsx-export-downloaded.png'),
    fullPage: true,
  });
});

test('日期区间XLS含起止日；空范围也下载四张完整空表，不更改账本', async ({ page }, testInfo) => {
  test.setTimeout(75_000);
  await addExpense(
    page,
    'FixtureFood',
    'FixtureBreakfast',
    '9.87',
    '虚构导出区间外新增记录',
    '2026-11-08',
  );
  const before = await storedSnapshot(page);
  const dialog = await openExport(page);
  await dialog.getByRole('radio', { name: /^XLS\b/ }).check();
  await dialog.getByLabel('导出全部历史', { exact: true }).uncheck();
  await dialog.getByLabel('导出开始日期', { exact: true }).fill('2026-11-07');
  await dialog.getByLabel('导出结束日期', { exact: true }).fill('2026-11-07');
  await expect(dialog.getByRole('heading', { name: /^将导出\s+8\s+笔$/ })).toBeVisible();
  const originalDay = await saveExport(page, dialog, testInfo, 'original-day.xls', 8);
  expect(originalDay.suggested).toMatch(/\.xls$/);
  expect([...originalDay.buffer.subarray(0, 8)]).toEqual([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
  ]);
  expect(originalDay.plan.rows).toHaveLength(8);
  expect(originalDay.plan.rows.every((row) => row.date === '2026-11-07')).toBe(true);
  expect(originalDay.workbook.sheets[0].rows[1].slice(0, 2)).toEqual([
    '时间',
    '2026-11-07 - 2026-11-07',
  ]);

  await dialog.getByLabel('导出开始日期', { exact: true }).fill('2026-11-08');
  await dialog.getByLabel('导出结束日期', { exact: true }).fill('2026-11-08');
  const nextDay = await saveExport(page, dialog, testInfo, 'next-day.xls', 1);
  expect(nextDay.plan.rows).toHaveLength(1);
  expect(nextDay.plan.rows[0]).toMatchObject({
    date: '2026-11-08',
    amountCents: 987,
    note: '虚构导出区间外新增记录',
  });

  await dialog.getByLabel('导出开始日期', { exact: true }).fill('2026-11-09');
  await dialog.getByLabel('导出结束日期', { exact: true }).fill('2026-11-09');
  const empty = await saveExport(page, dialog, testInfo, 'empty-range.xls', 0);
  expect(empty.workbook.sheets).toHaveLength(4);
  expect(empty.workbook.sheets.every((sheet) => sheet.rows.length === 3)).toBe(true);
  expect(empty.plan.rows).toHaveLength(0);
  expect(empty.plan.errors).toEqual([]);
  expect(empty.workbook.sheets[0].rows[0].slice(0, 2)).toEqual(['支出', '0.00']);
  expect(await storedSnapshot(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('empty-range-export.png'), fullPage: true });
});

test('无效日期被阻止；取消准备会关闭工作器，错误不改写账本', async ({ page }, testInfo) => {
  const before = await storedSnapshot(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  let dialog = await openExport(page);
  await dialog.getByLabel('导出全部历史', { exact: true }).uncheck();
  await dialog.getByLabel('导出开始日期', { exact: true }).fill('2026-12-01');
  await dialog.getByLabel('导出结束日期', { exact: true }).fill('2026-11-01');
  await expect(dialog.getByRole('alert')).toContainText('日期范围不正确');
  await expect(
    dialog.getByRole('button', { name: '生成并保存 Excel', exact: true }),
  ).toBeDisabled();
  expect(await storedSnapshot(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('invalid-export-range.png'), fullPage: true });
  await dialog.getByRole('button', { name: '返回', exact: true }).click();
  await expect(dialog).not.toBeVisible();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = 0;
  await page.route(WORKER_ROUTE, async (route) => {
    intercepted++;
    await gate;
    // The intended cancellation may already have disposed the held network request.
    await route.abort('aborted').catch(() => undefined);
  });
  try {
    dialog = await openExport(page);
    await dialog.getByRole('button', { name: '生成并保存 Excel', exact: true }).click();
    await expect.poll(() => intercepted).toBe(1);
    await expect(dialog.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '取消准备', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    release();
    await page.unroute(WORKER_ROUTE);
  } finally {
    release();
  }
  expect(downloads).toBe(0);
  expect(await storedSnapshot(page)).toEqual(before);
  await page.reload();
  await expect(page.locator('.ledger-app')).toBeVisible();
  expect(await storedSnapshot(page)).toEqual(before);
});

test('工作器加载失败有明确错误，重试后可下载且账本版本始终不变', async ({ page }, testInfo) => {
  const before = await storedSnapshot(page);
  await page.route(WORKER_ROUTE, (route) => route.abort('failed'));
  const dialog = await openExport(page);
  await dialog.getByRole('button', { name: '生成并保存 Excel', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('生成 Excel 失败');
  await expect(dialog.getByRole('button', { name: '生成并保存 Excel', exact: true })).toBeEnabled();
  expect(await storedSnapshot(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('worker-export-failure.png'), fullPage: true });
  await page.unroute(WORKER_ROUTE);
  const retry = await saveExport(page, dialog, testInfo, 'retry-after-failure.xlsx', 8);
  expect(retry.plan.rows).toHaveLength(8);
  expect(await storedSnapshot(page)).toEqual(before);
});
