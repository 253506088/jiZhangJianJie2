import { expect, test } from '@playwright/test';
import {
  active,
  addExpense,
  backHome,
  createAccount,
  enterKeys,
  importExcel,
  openCategories,
  openData,
  openEntry,
  openFreshApp,
  openImport,
  openReports,
  reportRow,
  syntheticExcel,
  useClassicLayout,
} from './helpers';

// Each Playwright test gets a fresh, temporary context. No user browser/profile is used.
test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });
test.beforeEach(async ({ page }) => {
  await openFreshApp(page);
  await useClassicLayout(page);
});

test('首次为空账本；两级分类、加减键盘和再记一笔能够持久保存', async ({ page }, testInfo) => {
  await expect(active(page).getByText('0 笔支出记录', { exact: true })).toBeVisible();
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(0);
  await expect(page.getByText('演示账本', { exact: false })).toHaveCount(0);
  await openEntry(page);
  await active(page).getByRole('button', { name: '创建我的分类', exact: true }).click();
  const categoryDialog = page.getByRole('dialog', { name: '新建二级分类', exact: true });
  await categoryDialog.getByLabel('一级分类名称', { exact: true }).fill('餐饮');
  await categoryDialog.getByLabel('二级分类名称', { exact: true }).fill('早餐');
  await categoryDialog.getByRole('button', { name: '保存分类', exact: true }).click();
  await expect(categoryDialog).not.toBeVisible();
  await expect(active(page).getByRole('button', { name: '早餐', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await enterKeys(page, ['0', '.', '1', '加', '0', '.', '2', '计算结果']);
  await expect(active(page).getByLabel('金额', { exact: true })).toHaveValue('0.30');
  await active(page).getByLabel('备注', { exact: true }).fill('虚构精度测试');
  await active(page).getByRole('button', { name: '再记一笔', exact: true }).click();
  await expect(active(page).getByLabel('金额', { exact: true })).toHaveValue('');
  await expect(active(page).getByLabel('备注', { exact: true })).toHaveValue('');
  await expect(active(page).getByRole('button', { name: '早餐', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await enterKeys(page, ['9', '.', '7']);
  await active(page).getByLabel('备注', { exact: true }).fill('虚构连续记账');
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(active(page).locator('.lj-spending-ring')).toContainText('10.00');
  await expect(active(page).getByText('2 笔支出记录', { exact: true })).toBeVisible();
  await page.reload();
  await expect(active(page).locator('.lj-spending-ring')).toContainText('10.00');
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath('manual-entry-persisted.png'),
    fullPage: true,
  });
});

for (const format of ['xls', 'xlsx'] as const) {
  test(`${format} 导入旧年份早餐两笔，直接继续记账；重复导入与刷新保持3笔30元`, async ({
    page,
  }, testInfo) => {
    const file = syntheticExcel(
      [
        ['2018-12-30', '支出', 10, '餐饮', '早餐', '现金', '虚构旧账甲', '生活账本'],
        ['2018-12-31', '支出', 10, '餐饮', '早餐', '现金', '虚构旧账乙', '生活账本'],
      ],
      format,
    );
    await importExcel(page, file, 2);
    await expect(active(page).getByLabel('选择月份', { exact: true })).toHaveValue('2018-12');
    await expect(active(page).locator('.lj-transaction-row')).toHaveCount(2);
    await addExpense(page, '餐饮', '早餐', '10', '虚构新手机继续记账');
    await openReports(page);
    await expect(reportRow(page, '餐饮 / 早餐')).toHaveCount(1);
    await expect(reportRow(page, '餐饮 / 早餐')).toContainText('30.00');
    await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/3\s*笔/);
    await active(page).getByLabel('选择月份', { exact: true }).fill('2018-12');
    await expect(reportRow(page, '餐饮 / 早餐')).toContainText('20.00');
    await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/2\s*笔/);
    await active(page).getByLabel('选择月份', { exact: true }).fill('2026-11');
    await expect(reportRow(page, '餐饮 / 早餐')).toContainText('10.00');
    await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/1\s*笔/);
    const repeated = await openImport(page, file);
    await expect(repeated.getByRole('button', { name: /^确认导入\s+0\s+笔$/ })).toBeDisabled();
    await expect(repeated.getByText(/同一文件的这一行已导入/).first()).toBeVisible();
    await repeated.getByRole('button', { name: '关闭Excel导入', exact: true }).click();
    await page.reload();
    await openReports(page);
    await expect(reportRow(page, '餐饮 / 早餐')).toContainText('30.00');
    await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/3\s*笔/);
    await page.screenshot({
      path: testInfo.outputPath(`regression-${format}-three-records.png`),
      fullPage: true,
    });
  });
}

test('同名子类分开；子类合并、父类改名后旧路径的新导入仍关联原分类', async ({ page }, testInfo) => {
  const file = syntheticExcel([
    ['2026-11-01', '支出', 10, '餐饮', '早餐', '现金', '虚构早餐', '生活账本'],
    ['2026-11-02', '支出', 20, '餐饮', '早饭', '现金', '虚构早饭', '生活账本'],
    ['2026-11-03', '支出', 5, '餐饮', '其他', '现金', '虚构餐饮其他', '生活账本'],
    ['2026-11-04', '支出', 7, '交通', '其他', '现金', '虚构交通其他', '生活账本'],
  ]);
  await importExcel(page, file, 4);
  await openReports(page);
  await expect(reportRow(page, '餐饮 / 其他')).toContainText('5.00');
  await expect(reportRow(page, '交通 / 其他')).toContainText('7.00');
  await openCategories(page);
  await active(page).getByRole('button', { name: '管理二级分类 餐饮 / 早饭', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^合并到其他分类/ })
    .click();
  let dialog = page.getByRole('dialog', { name: '合并分类', exact: true });
  await dialog.getByLabel('合并目标分类', { exact: true }).selectOption({ label: '餐饮 / 早餐' });
  await expect(dialog).toContainText('20.00');
  await dialog.getByRole('button', { name: '确认合并', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    active(page).getByRole('button', { name: '管理二级分类 餐饮 / 早饭', exact: true }),
  ).toHaveCount(0);
  await active(page).getByRole('button', { name: '管理一级分类 餐饮', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^修改名称与图标/ })
    .click();
  dialog = page.getByRole('dialog', { name: '分类名称与图标', exact: true });
  await dialog.getByLabel('分类新名称', { exact: true }).fill('餐食');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    active(page).getByRole('button', { name: '管理一级分类 餐食', exact: true }),
  ).toBeVisible();
  await importExcel(
    page,
    syntheticExcel(
      [['2026-11-08', '支出', 10, '餐饮', '早饭', '现金', '虚构旧名称后续导入', '生活账本']],
      'xlsx',
      'fictional-continuation.xlsx',
    ),
    1,
  );
  await openReports(page);
  await expect(reportRow(page, '餐食 / 早餐')).toContainText('40.00');
  await expect(reportRow(page, '餐食 / 早餐')).toContainText(/3\s*笔/);
  await expect(reportRow(page, '餐饮 / 早餐')).toHaveCount(0);
  await openCategories(page);
  await active(page).getByRole('button', { name: '管理一级分类 交通', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^合并到其他分类/ })
    .click();
  dialog = page.getByRole('dialog', { name: '合并分类', exact: true });
  await dialog.getByLabel('合并目标分类', { exact: true }).selectOption({ label: '餐食' });
  await dialog.getByRole('button', { name: '确认合并', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await openReports(page);
  await expect(reportRow(page, '餐食 / 其他')).toContainText('12.00');
  await expect(reportRow(page, '餐食 / 其他')).toContainText(/2\s*笔/);
  await expect(reportRow(page, '餐食 / 早餐')).toContainText('40.00');
  await page.screenshot({
    path: testInfo.outputPath('merged-category-report.png'),
    fullPage: true,
  });
});

test('转账影响两侧余额但不计收支，编辑和删除同步还原余额', async ({ page }) => {
  await createAccount(page, '虚构储蓄', '100', 'bank');
  await createAccount(page, '虚构钱包', '20', 'wallet');
  await openEntry(page);
  await active(page).getByRole('button', { name: '转账', exact: true }).click();
  await active(page).getByLabel('转出账户', { exact: true }).selectOption({ label: '虚构储蓄' });
  await active(page).getByLabel('转入账户', { exact: true }).selectOption({ label: '虚构钱包' });
  await active(page).getByLabel('金额', { exact: true }).fill('30');
  await active(page).getByLabel('备注', { exact: true }).fill('虚构账户之间转账');
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(active(page).getByText('0 笔支出记录', { exact: true })).toBeVisible();
  await active(page).getByRole('button', { name: '账户', exact: true }).click();
  await expect(active(page).locator('.lj-account-total')).toContainText('120.00');
  await expect(
    active(page)
      .locator('.lj-account-card')
      .filter({ has: page.getByRole('heading', { name: '虚构储蓄', exact: true }) }),
  ).toContainText('70.00');
  await expect(
    active(page)
      .locator('.lj-account-card')
      .filter({ has: page.getByRole('heading', { name: '虚构钱包', exact: true }) }),
  ).toContainText('50.00');
  await active(page).getByRole('button', { name: '查看虚构钱包流水', exact: true }).click();
  await expect(
    active(page).getByLabel('筛选账户', { exact: true }).locator('option:checked'),
  ).toHaveText('虚构钱包');
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(1);
  await active(page)
    .getByRole('button', { name: /查看虚构储蓄.*虚构钱包/ })
    .click();
  await active(page).getByLabel('金额', { exact: true }).fill('20');
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(active(page).locator('.lj-transaction-row')).toContainText('20.00');
  await active(page)
    .getByRole('button', { name: /查看虚构储蓄.*虚构钱包/ })
    .click();
  await active(page).getByRole('button', { name: '删除', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: '删除这笔账目？', exact: true });
  await deletion.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(deletion).not.toBeVisible();
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(0);
  await backHome(page);
  await active(page).getByRole('button', { name: '账户', exact: true }).click();
  await expect(active(page).locator('.lj-account-total')).toContainText('120.00');
  await expect(
    active(page)
      .locator('.lj-account-card')
      .filter({ has: page.getByRole('heading', { name: '虚构储蓄', exact: true }) }),
  ).toContainText('100.00');
  await expect(
    active(page)
      .locator('.lj-account-card')
      .filter({ has: page.getByRole('heading', { name: '虚构钱包', exact: true }) }),
  ).toContainText('20.00');
});

test('主题选择持久化，跟随系统能在同一会话响应变化', async ({ page }) => {
  await openData(page);
  await active(page).getByRole('button', { name: '夜间', exact: true }).click();
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-theme', 'dark');
  await openData(page);
  await active(page).getByRole('button', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-theme', 'dark');
});

test('重复分类错误在弹窗中可见，取消返回提示会保留未保存的金额和备注', async ({ page }) => {
  await importExcel(
    page,
    syntheticExcel([
      ['2026-11-08', '支出', 10, '餐饮', '早餐', '现金', '虚构初始记录', '生活账本'],
    ]),
    1,
  );
  await openCategories(page);
  await active(page).getByRole('button', { name: '一级分类', exact: true }).click();
  const categoryDialog = page.getByRole('dialog', { name: '新建一级分类', exact: true });
  await categoryDialog.getByLabel('一级分类名称', { exact: true }).fill('餐饮');
  await categoryDialog.getByRole('button', { name: '保存分类', exact: true }).click();
  await expect(categoryDialog.getByRole('alert')).toContainText('一级分类名称已存在');
  await expect(categoryDialog).toBeVisible();
  await categoryDialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(
    active(page).getByRole('button', { name: '管理一级分类 餐饮', exact: true }),
  ).toHaveCount(1);
  await openEntry(page);
  await active(page).getByLabel('金额', { exact: true }).fill('12.34');
  await active(page).getByLabel('备注', { exact: true }).fill('虚构未保存输入');
  await active(page).getByRole('button', { name: '返回', exact: true }).click();
  const discard = page.getByRole('dialog', { name: '离开这笔未保存的账目？', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: '取消', exact: true }).click();
  await expect(active(page).getByLabel('金额', { exact: true })).toHaveValue('12.34');
  await expect(active(page).getByLabel('备注', { exact: true })).toHaveValue('虚构未保存输入');
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await openReports(page);
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText('22.34');
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/2\s*笔/);
});

test('错误Excel默认阻止部分导入，取消不写账本；明确确认后只导入有效行并保留报告', async ({
  page,
}) => {
  const file = syntheticExcel(
    [
      ['2026-11-08', '支出', 10, '餐饮', '早餐', '现金', '虚构有效记录', '生活账本'],
      ['2018-02-30', '支出', 20, '餐饮', '早餐', '现金', '虚构非法日期', '生活账本'],
    ],
    'xlsx',
    'fictional-invalid-date.xlsx',
  );
  let dialog = await openImport(page, file);
  await expect(dialog.getByRole('button', { name: /^确认导入\s+1\s+笔$/ })).toBeDisabled();
  await expect(dialog.getByText('日期不在有效日历范围内。', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭Excel导入', exact: true }).click();
  await page.reload();
  await expect(active(page).getByText('0 笔支出记录', { exact: true })).toBeVisible();
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(0);
  dialog = await openImport(page, file);
  await dialog.getByRole('checkbox', { name: /我已查看错误报告，选择仅导入有效行/ }).check();
  await dialog.getByRole('button', { name: /^确认导入\s+1\s+笔$/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(1);
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^导入历史/ })
    .click();
  const history = page.getByRole('dialog', { name: '导入历史', exact: true });
  await expect(history.locator('.lj-import-receipt')).toContainText('fictional-invalid-date.xlsx');
  await expect(history.locator('.lj-import-receipt')).toContainText(/1\s*\/\s*0\s*\/\s*1/);
});
