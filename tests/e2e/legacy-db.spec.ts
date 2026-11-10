import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import fixture from '../fixtures/legacy-4.8.8-db.json' with { type: 'json' };
import { active, addExpense, openData, openFreshApp, openReports, reportRow } from './helpers';

async function databaseFixture() {
  const SQL = await initSqlJs({
    wasmBinary: Uint8Array.from(readFileSync('node_modules/sql.js/dist/sql-wasm.wasm')).buffer,
  });
  const db = new SQL.Database();
  for (const [table, value] of Object.entries(fixture.tables))
    if (table !== 'sqlite_sequence') db.run(value.sql);
  for (const [table, value] of Object.entries(fixture.tables)) {
    if (table === 'sqlite_sequence') continue;
    for (const row of value.rows)
      db.run(
        `INSERT INTO "${table}" VALUES (${Object.keys(row)
          .map(() => '?')
          .join(',')})`,
        Object.values(row),
      );
  }
  db.run('PRAGMA user_version=16');
  const buffer = Buffer.from(db.export());
  db.close();
  return { name: 'synthetic-original-schema.db', mimeType: 'application/octet-stream', buffer };
}
async function openPanel(page: import('@playwright/test').Page) {
  await openData(page);
  await active(page)
    .getByRole('button', { name: /从旧版 \.db 初始化/ })
    .click();
  return page.getByRole('dialog', { name: '从旧版 .db 初始化', exact: true });
}
test('old database initializes a separate book, persists, and allows continued use of imported categories', async ({
  page,
}) => {
  await openFreshApp(page);
  const panel = await openPanel(page);
  await panel.getByLabel('选择旧版数据库文件').setInputFiles(await databaseFixture());
  await expect(panel.getByRole('heading', { name: '导入预览' })).toBeVisible();
  await expect(panel).toContainText('12 笔');
  await expect(panel.getByRole('button', { name: '确认初始化导入' })).toBeDisabled();
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: '确认初始化导入' }).click();
  await expect(panel.getByRole('heading', { name: '旧版账本已导入' })).toBeVisible();
  await panel.getByRole('button', { name: '完成', exact: true }).click();
  await page.reload();
  await expect(page.locator('.ledger-app')).toBeVisible();
  await addExpense(
    page,
    'FixtureFood',
    'FixtureBreakfast',
    '10',
    'new synthetic entry',
    '2026-11-07',
  );
  await openReports(page);
  const report = reportRow(page, 'FixtureFood');
  await expect(report).toContainText('34.21');
  const duplicate = await openPanel(page);
  await duplicate.getByLabel('选择旧版数据库文件').setInputFiles(await databaseFixture());
  await expect(duplicate.getByRole('heading', { name: '导入预览' })).toBeVisible();
  await duplicate.getByLabel('旧版导入账本名称').fill('另一个导入');
  await duplicate.getByRole('checkbox').check();
  await duplicate.getByRole('button', { name: '确认初始化导入' }).click();
  await expect(duplicate.getByRole('alert')).toContainText('已经导入');
});
test('invalid database and cancellation do not replace the current ledger', async ({ page }) => {
  await openFreshApp(page);
  const panel = await openPanel(page);
  await panel
    .getByLabel('选择旧版数据库文件')
    .setInputFiles({
      name: 'broken.db',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('not a database'),
    });
  await expect(panel.getByRole('alert')).toContainText('不是可识别');
  await panel.getByLabel('选择旧版数据库文件').setInputFiles(await databaseFixture());
  await expect(panel.getByRole('heading', { name: '导入预览' })).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await panel.getByRole('button', { name: '关闭旧版数据库导入' }).click();
  await page.reload();
  await expect(page.locator('.ledger-app')).toBeVisible();
  await expect(page.locator('.ledger-app')).toContainText('生活账本');
});
test('old database panel follows explicit dark mode', async ({ page }) => {
  await openFreshApp(page);
  await openData(page);
  await active(page).getByRole('button', { name: '夜间', exact: true }).click();
  await active(page)
    .getByRole('button', { name: /从旧版 \.db 初始化/ })
    .click();
  const panel = page.getByRole('dialog', { name: '从旧版 .db 初始化', exact: true });
  await expect(panel).toHaveAttribute('data-theme', 'dark');
  await expect(panel).toHaveCSS('color-scheme', 'dark');
});
