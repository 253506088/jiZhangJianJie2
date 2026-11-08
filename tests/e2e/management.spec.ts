import { expect, test, type Page } from '@playwright/test';
import {
  active,
  backHome,
  createAccount,
  importExcel,
  openCategories,
  openData,
  openEntry,
  openFreshApp,
  openReports,
  reportRow,
  syntheticExcel,
  useClassicLayout,
} from './helpers';

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });
test.beforeEach(async ({ page }) => {
  await openFreshApp(page);
  await useClassicLayout(page);
});

async function createFirstExpense(page: Page, amount: string, note: string) {
  await openEntry(page);
  await active(page).getByRole('button', { name: '创建我的分类', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建二级分类', exact: true });
  await dialog.getByLabel('一级分类名称', { exact: true }).fill('餐饮');
  await dialog.getByLabel('二级分类名称', { exact: true }).fill('早餐');
  await dialog.getByRole('button', { name: '保存分类', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await active(page).getByLabel('金额', { exact: true }).fill(amount);
  await active(page).getByLabel('备注', { exact: true }).fill(note);
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(active(page).getByRole('heading', { name: '简洁记账', exact: true })).toBeVisible();
}

test('分类排序持久化；归档隐藏新增选择但保留历史，恢复后可继续选择', async ({ page }, testInfo) => {
  await importExcel(
    page,
    syntheticExcel([
      ['2026-11-06', '支出', 10, '餐饮', '早餐', '现金', '虚构早餐', '生活账本'],
      ['2026-11-07', '支出', 20, '餐饮', '晚饭', '现金', '虚构晚饭', '生活账本'],
      ['2026-11-08', '支出', 5, '交通', '地铁', '现金', '虚构交通', '生活账本'],
    ]),
    3,
  );
  await openCategories(page);
  await active(page).getByRole('button', { name: '管理二级分类 餐饮 / 晚饭', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '上移', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const food = active(page)
    .locator('.lj-category-group')
    .filter({ has: page.getByRole('button', { name: '管理一级分类 餐饮', exact: true }) });
  await expect(food.locator('.lj-category-child strong')).toHaveText(['晚饭', '早餐']);
  await active(page).getByRole('button', { name: '管理一级分类 交通', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '上移', exact: true }).click();
  await expect(active(page).locator('.lj-category-group > header strong')).toHaveText([
    '交通',
    '餐饮',
  ]);
  await page.reload();
  await openCategories(page);
  await expect(active(page).locator('.lj-category-group > header strong')).toHaveText([
    '交通',
    '餐饮',
  ]);
  await expect(
    active(page)
      .locator('.lj-category-group')
      .filter({ has: page.getByRole('button', { name: '管理一级分类 餐饮', exact: true }) })
      .locator('.lj-category-child strong'),
  ).toHaveText(['晚饭', '早餐']);
  await active(page).getByRole('button', { name: '管理二级分类 餐饮 / 早餐', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '归档分类', exact: true }).click();
  let confirmation = page.getByRole('dialog', { name: '归档这个分类？', exact: true });
  await confirmation.getByRole('button', { name: '确认归档', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(
    active(page).getByRole('button', { name: '管理二级分类 餐饮 / 早餐', exact: true }),
  ).toHaveCount(0);
  await openReports(page);
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText('10.00');
  await expect(reportRow(page, '餐饮 / 晚饭')).toContainText('20.00');
  await openEntry(page);
  await active(page).getByRole('button', { name: '餐饮', exact: true }).click();
  await expect(active(page).getByRole('button', { name: '早餐', exact: true })).toHaveCount(0);
  await expect(active(page).getByRole('button', { name: '晚饭', exact: true })).toBeVisible();
  await openCategories(page);
  await active(page).getByRole('checkbox', { name: '显示归档分类', exact: true }).check();
  await active(page).getByRole('button', { name: '管理二级分类 餐饮 / 早餐', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '恢复使用', exact: true }).click();
  confirmation = page.getByRole('dialog', { name: '恢复这个分类？', exact: true });
  await confirmation.getByRole('button', { name: '恢复使用', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await openEntry(page);
  await active(page).getByRole('button', { name: '餐饮', exact: true }).click();
  await active(page).getByRole('button', { name: '早餐', exact: true }).click();
  await expect(active(page).getByRole('button', { name: '早餐', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({
    path: testInfo.outputPath('category-restored-selection.png'),
    fullPage: true,
  });
});

test('编辑期初余额正确叠加流水；相同分类在不同账本独立并持久切换', async ({ page }) => {
  await createAccount(page, '虚构储蓄', '100', 'bank');
  await createFirstExpense(page, '10', '虚构生活账本早餐');
  await active(page).getByRole('button', { name: '账户', exact: true }).click();
  await expect(active(page).locator('.lj-account-total')).toContainText('90.00');
  await active(page).getByRole('button', { name: '管理账户 虚构储蓄', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^修改名称与期初余额/ })
    .click();
  let dialog = page.getByRole('dialog', { name: '编辑账户', exact: true });
  await dialog.getByLabel('期初余额', { exact: true }).fill('150');
  await dialog.getByRole('button', { name: '保存账户', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(active(page).locator('.lj-account-total')).toContainText('140.00');
  await backHome(page);
  await active(page).getByRole('button', { name: '生活账本', exact: true }).click();
  await active(page).getByRole('button', { name: '新建账本', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建账本', exact: true });
  await dialog.getByLabel('账本名称', { exact: true }).fill('虚构旅行账本');
  await dialog.getByRole('button', { name: '保存账本', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    active(page).getByRole('button', { name: '虚构旅行账本', exact: true }),
  ).toBeVisible();
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(0);
  await createFirstExpense(page, '7', '虚构旅行账本早餐');
  await openReports(page);
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText('7.00');
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/1\s*笔/);
  await backHome(page);
  await active(page).getByRole('button', { name: '虚构旅行账本', exact: true }).click();
  await active(page).getByRole('button', { name: '切换到生活账本', exact: true }).click();
  await expect(active(page).getByRole('heading', { name: '简洁记账', exact: true })).toBeVisible();
  await openReports(page);
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText('10.00');
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/1\s*笔/);
  await page.reload();
  await expect(active(page).getByRole('button', { name: '生活账本', exact: true })).toBeVisible();
  await active(page).getByRole('button', { name: '账户', exact: true }).click();
  await expect(active(page).locator('.lj-account-total')).toContainText('140.00');
});

test('归档账户后编辑旧记录仍保留原账户，不会自动改派到其他钱包', async ({ page }) => {
  await importExcel(
    page,
    syntheticExcel([
      ['2026-11-08', '支出', 10, '餐饮', '早餐', '现金', '虚构原账户记录', '生活账本'],
    ]),
    1,
  );
  await createAccount(page, '虚构其他钱包', '0');
  await active(page).getByRole('button', { name: '管理账户 现金', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '归档账户', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '归档账户？', exact: true });
  await dialog.getByRole('button', { name: '归档', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await backHome(page);
  await active(page).getByRole('button', { name: '明细', exact: true }).click();
  await active(page)
    .getByRole('button', { name: /查看餐饮 \/ 早餐，10.00元/ })
    .click();
  await expect(
    active(page).getByLabel('记账账户', { exact: true }).locator('option:checked'),
  ).toHaveText('现金（已归档）');
  await active(page).getByLabel('备注', { exact: true }).fill('只改虚构备注，保留原账户');
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(active(page).locator('.lj-transaction-row')).toContainText('现金');
  await expect(active(page).locator('.lj-transaction-row')).toContainText(
    '只改虚构备注，保留原账户',
  );
  await backHome(page);
  await active(page).getByRole('button', { name: '账户', exact: true }).click();
  await active(page).getByRole('checkbox', { name: '显示归档账户', exact: true }).check();
  const cash = active(page)
    .locator('.lj-account-card')
    .filter({ has: page.getByRole('heading', { name: '现金', exact: true }) });
  const other = active(page)
    .locator('.lj-account-card')
    .filter({ has: page.getByRole('heading', { name: '虚构其他钱包', exact: true }) });
  await expect(cash).toContainText('-10.00');
  await expect(other).toContainText('0.00');
  await active(page).getByRole('button', { name: '管理账户 现金', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '恢复账户', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '恢复账户？', exact: true });
  await dialog.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await openEntry(page);
  await expect(
    active(page).getByLabel('记账账户', { exact: true }).locator('option'),
  ).toContainText(['现金', '虚构其他钱包']);
});

test('预算与模板操作不额外记账，使用模板后按确认金额保存并可编辑删除', async ({
  page,
}, testInfo) => {
  await importExcel(
    page,
    syntheticExcel([
      ['2026-11-08', '支出', 10, '餐饮', '早餐', '现金', '虚构原始早餐', '生活账本'],
    ]),
    1,
  );
  await backHome(page);
  await active(page)
    .getByRole('button', { name: /给这个月，安排一份预算/ })
    .click();
  await active(page).getByRole('button', { name: '设置预算', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '设置月预算', exact: true });
  await dialog.getByLabel('预算金额', { exact: true }).fill('100');
  await dialog.getByRole('button', { name: '保存预算', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(active(page).locator('.lj-budget-card')).toContainText('90.00');
  await active(page).getByRole('button', { name: '编辑整本账预算', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '调整预算', exact: true });
  await dialog.getByLabel('预算金额', { exact: true }).fill('120');
  await dialog.getByRole('button', { name: '保存预算', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(active(page).locator('.lj-budget-card')).toContainText('110.00');
  await active(page).getByRole('button', { name: '移除预算', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '移除这个预算？', exact: true });
  await dialog.getByRole('button', { name: '移除预算', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(active(page).locator('.lj-budget-card')).toHaveCount(0);
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^模板记账/ })
    .click();
  await active(page)
    .locator('.lj-header')
    .getByRole('button', { name: '新建模板', exact: true })
    .click();
  await active(page).getByLabel('模板名称', { exact: true }).fill('虚构早餐模板');
  await active(page).getByLabel('金额', { exact: true }).fill('12');
  await active(page).getByLabel('备注', { exact: true }).fill('虚构模板备注');
  await active(page).getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(active(page).locator('.lj-template-card')).toContainText('12.00');
  await openReports(page);
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText('10.00');
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/1\s*笔/);
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^模板记账/ })
    .click();
  await active(page)
    .locator('.lj-template-card')
    .getByRole('button', { name: '记一笔', exact: true })
    .click();
  await expect(active(page).getByLabel('金额', { exact: true })).toHaveValue('12.00');
  await active(page).getByLabel('金额', { exact: true }).fill('15');
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await openReports(page);
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText('25.00');
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/2\s*笔/);
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^模板记账/ })
    .click();
  await active(page).getByRole('button', { name: '编辑模板', exact: true }).click();
  await active(page).getByLabel('金额', { exact: true }).fill('20');
  await active(page).getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(active(page).locator('.lj-template-card')).toContainText('20.00');
  await active(page).getByRole('button', { name: '编辑模板', exact: true }).click();
  await expect(page.locator('.lj-toast')).toContainText('模板已保存');
  const saveButton = active(page).getByRole('button', { name: '保存模板', exact: true });
  const box = await saveButton.boundingBox();
  expect(box).not.toBeNull();
  const hitTarget = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.trim(),
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
  );
  expect(hitTarget).toBe('保存模板');
  await active(page).getByRole('button', { name: '返回', exact: true }).click();
  await expect(active(page).getByRole('heading', { name: '模板记账', exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('template-edited-no-extra-transaction.png'),
    fullPage: true,
  });
  await active(page).getByRole('button', { name: '删除', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '删除这个模板？', exact: true });
  await dialog.getByRole('button', { name: '删除模板', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(active(page).locator('.lj-template-card')).toHaveCount(0);
  await openReports(page);
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText('25.00');
  await expect(reportRow(page, '餐饮 / 早餐')).toContainText(/2\s*笔/);
});
