import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { decodeBackup, inspectBackup } from '../../src/backup/codec';
import {
  active,
  addExpense,
  createAccount,
  openCategories,
  openData,
  openFreshApp,
  openImport,
  openReports,
  reportRow,
  syntheticExcel,
} from './helpers';

// These files and browser contexts are created by this test only. No user profile or export is read.
const PASSWORD = 'fixture-only-password-2026';
const WRONG_PASSWORD = 'fixture-only-wrong-password';

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });
test.beforeEach(async ({ page }) => {
  await openFreshApp(page);
});

async function seedMultipleBooks(page: Page) {
  const file = syntheticExcel([
    ['2018-12-30', '支出', 10, '餐饮', '早餐', '现金', '虚构相同记录也要分别保留', '生活账本'],
    ['2018-12-30', '支出', 10, '餐饮', '早餐', '现金', '虚构相同记录也要分别保留', '生活账本'],
    ['2026-11-07', '收入', 1000, '工作', '工资', '虚构银行卡', '虚构收入', '生活账本'],
    ['2020-06-08', '支出', 12.34, '交通', '地铁', '旅行现金', '虚构另一账本', '虚构旅行'],
  ]);
  const importer = await openImport(page, file);
  await importer.getByLabel('表格有账本列时，按原账本名称分别初始化', { exact: true }).check();
  const submit = importer.getByRole('button', { name: /^确认导入\s+4\s+笔$/ });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(importer).not.toBeVisible();
  await expect(active(page).getByRole('heading', { name: '收支明细', exact: true })).toBeVisible();
}

async function openBackupExport(page: Page) {
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^导出完整备份/ })
    .click();
  const dialog = page.getByRole('dialog', { name: '完整账本备份', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function downloadBackup(page: Page, testInfo: TestInfo, name: string, password?: string) {
  const dialog = await openBackupExport(page);
  if (password) {
    await dialog.getByLabel('使用密码加密', { exact: true }).check();
    await dialog.getByLabel('加密密码', { exact: true }).fill(password);
    await dialog.getByLabel('再次确认密码', { exact: true }).fill(password);
  } else {
    await dialog.getByLabel('使用密码加密', { exact: true }).uncheck();
  }
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '生成并保存备份', exact: true }).click();
  const download = await downloaded;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.jzbackup$/);
  const path = testInfo.outputPath(`${name}.jzbackup`);
  await download.saveAs(path);
  await expect(
    dialog.getByText('下载已开始，请确认浏览器已将文件保存。', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('完整备份已保存，并通过写入校验。', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText('已发起备份下载，请确认浏览器下载结果', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: '关闭备份面板', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const text = await readFile(path, 'utf8');
  return { path, text, decoded: await decodeBackup(text, password ? { password } : {}) };
}

async function chooseRestore(page: Page, path: string) {
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^从完整备份恢复/ })
    .click();
  const dialog = page.getByRole('dialog', { name: '恢复完整备份', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('选择完整备份文件', { exact: true }).setInputFiles(path);
  return dialog;
}

async function confirmRestore(page: Page, path: string, password?: string) {
  const dialog = await chooseRestore(page, path);
  if (password) {
    await dialog.getByLabel('备份密码', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: '解密并校验', exact: true }).click();
  }
  await expect(dialog.getByRole('heading', { name: '将恢复的备份', exact: true })).toBeVisible();
  const confirm = dialog.getByRole('button', { name: '确认恢复全部账本', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('我已确认，用这份备份替换当前全部账本。', { exact: true }).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText('完整备份已恢复，分类与流水关系已核对', { exact: true }),
  ).toBeVisible();
}

test('明文备份实际下载；修改和刷新后恢复所有账本、分类、来源行与独立重复流水', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await seedMultipleBooks(page);
  const original = await downloadBackup(page, testInfo, 'original-plaintext');
  expect(inspectBackup(original.text).encrypted).toBe(false);
  expect(original.decoded.state.books.map((book) => book.name)).toEqual(['生活账本', '虚构旅行']);
  expect(original.decoded.state.transactions).toHaveLength(4);
  expect(original.decoded.state.imports).toHaveLength(2);
  expect(original.decoded.state.imports.flatMap((batch) => batch.sourceRows ?? [])).toHaveLength(4);
  const repeated = original.decoded.state.transactions.filter(
    (item) => item.note === '虚构相同记录也要分别保留',
  );
  expect(repeated).toHaveLength(2);
  expect(repeated[0].id).not.toBe(repeated[1].id);

  await addExpense(page, '餐饮', '早餐', '3.21', '虚构备份后的新记录');
  await openCategories(page);
  await active(page).getByRole('button', { name: '管理一级分类 餐饮', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^修改名称与图标/ })
    .click();
  const rename = page.getByRole('dialog', { name: '分类名称与图标', exact: true });
  await rename.getByLabel('分类新名称', { exact: true }).fill('餐食');
  await rename.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(rename).not.toBeVisible();
  await createAccount(page, '虚构备份后新增账户', '23.45');
  await page.reload();
  await expect(page.locator('.ledger-app')).toBeVisible();
  const modified = await downloadBackup(page, testInfo, 'modified-plaintext');
  expect(modified.decoded.state.transactions).toHaveLength(5);
  expect(modified.decoded.state.accounts).toHaveLength(original.decoded.state.accounts.length + 1);
  expect(modified.decoded.state.categoryAliases.length).toBeGreaterThan(0);

  await confirmRestore(page, original.path);
  await page.reload();
  await expect(page.locator('.ledger-app')).toBeVisible();
  const restored = await downloadBackup(page, testInfo, 'restored-plaintext');
  expect(restored.decoded.state).toEqual(original.decoded.state);
  await openReports(page);
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText('20.00');
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/2\s*笔/);
  await expect(reportRow(page, '餐食 / 早餐')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('plaintext-restored-report.png'),
    fullPage: true,
  });
});

test('加密备份不含明文账目；错误密码不修改数据，正确密码恢复完整状态', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await seedMultipleBooks(page);
  const encrypted = await downloadBackup(page, testInfo, 'encrypted-original', PASSWORD);
  expect(inspectBackup(encrypted.text).passwordRequired).toBe(true);
  expect(encrypted.text).not.toContain('虚构相同记录也要分别保留');
  expect(encrypted.text).not.toContain('虚构旅行');
  expect(encrypted.text).not.toContain(PASSWORD);
  await addExpense(page, '餐饮', '早餐', '7.89', '虚构加密备份后的新增');
  await openData(page);
  await active(page).getByRole('button', { name: '夜间', exact: true }).click();
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-theme', 'dark');
  const beforeFailure = await downloadBackup(page, testInfo, 'state-before-password-error');

  const dialog = await chooseRestore(page, encrypted.path);
  await dialog.getByLabel('备份密码', { exact: true }).fill(WRONG_PASSWORD);
  await dialog.getByRole('button', { name: '解密并校验', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('密码不正确或文件已损坏');
  await expect(dialog.getByRole('heading', { name: '将恢复的备份', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '确认恢复全部账本', exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: testInfo.outputPath('wrong-password-rejected.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: '关闭备份面板', exact: true }).click();
  await page.reload();
  await expect(page.locator('.ledger-app')).toBeVisible();
  const afterFailure = await downloadBackup(page, testInfo, 'state-after-password-error');
  expect(afterFailure.decoded.state).toEqual(beforeFailure.decoded.state);

  await confirmRestore(page, encrypted.path, PASSWORD);
  await page.reload();
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-theme', 'light');
  const restored = await downloadBackup(page, testInfo, 'state-after-correct-password');
  expect(restored.decoded.state).toEqual(encrypted.decoded.state);
  await page.screenshot({ path: testInfo.outputPath('encrypted-round-trip.png'), fullPage: true });
});

test('备份已验证但用户取消恢复时，不写库也不清空后来记录', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await seedMultipleBooks(page);
  const original = await downloadBackup(page, testInfo, 'before-new-entry');
  await addExpense(page, '餐饮', '早餐', '6.66', '虚构取消恢复后应保留');
  const modified = await downloadBackup(page, testInfo, 'before-cancel');
  expect(modified.decoded.state.transactions).toHaveLength(5);

  const dialog = await chooseRestore(page, original.path);
  await expect(dialog.getByRole('heading', { name: '将恢复的备份', exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: '确认恢复全部账本', exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel('我已确认，用这份备份替换当前全部账本。', { exact: true }).check();
  await expect(dialog.getByRole('button', { name: '确认恢复全部账本', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '返回', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('完整备份已恢复，分类与流水关系已核对', { exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.locator('.ledger-app')).toBeVisible();
  const afterCancel = await downloadBackup(page, testInfo, 'after-cancel');
  expect(afterCancel.decoded.state).toEqual(modified.decoded.state);
  await openReports(page);
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText('26.66');
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/3\s*笔/);
  await page.screenshot({
    path: testInfo.outputPath('cancelled-restore-kept-records.png'),
    fullPage: true,
  });
});
