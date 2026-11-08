import { expect, test, type Page } from '@playwright/test';
import {
  active,
  addExpense,
  backHome,
  importExcel,
  openData,
  openEntry,
  openFreshApp,
  openReports,
  originalLegacyFixture,
  reportRow,
} from './helpers';

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });
test.beforeEach(async ({ page }) => {
  await openFreshApp(page);
});

test('金额键盘默认展开，返回先收起键盘再保护未保存输入', async ({ page }) => {
  await openEntry(page);
  await expect(active(page).locator('.lj-calculator')).toBeVisible();
  await active(page).getByLabel('金额', { exact: true }).fill('12.34');
  await page.keyboard.press('Escape');
  await expect(active(page).locator('.lj-calculator')).toHaveCount(0);
  await expect(active(page).getByRole('heading', { name: '记一笔', exact: true })).toBeVisible();
  await expect(active(page).getByLabel('金额', { exact: true })).toHaveValue('12.34');
  await page.keyboard.press('Escape');
  const discard = page.getByRole('dialog', { name: '离开这笔未保存的账目？', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: '取消', exact: true }).click();
  await active(page).getByLabel('金额', { exact: true }).focus();
  await expect(active(page).locator('.lj-calculator')).toBeVisible();
  await expect(active(page).getByLabel('金额', { exact: true })).toHaveValue('12.34');
});

async function chooseEntryTab(page: Page, name: '支出' | '收入' | '转账' | '借贷') {
  await active(page).getByRole('button', { name, exact: true }).click();
}

async function addLoan(
  page: Page,
  type: '借入' | '借出' | '还款' | '收款',
  amount: string,
  createPerson = false,
) {
  await openEntry(page);
  await chooseEntryTab(page, '借贷');
  await active(page).getByRole('button', { name: type, exact: true }).click();
  if (createPerson) {
    await active(page).getByRole('button', { name: '新建借贷人', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建借贷人', exact: true });
    await dialog.getByLabel('借贷人名称', { exact: true }).fill('虚构往来人');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  } else
    await active(page).getByLabel('借贷人', { exact: true }).selectOption({ label: '虚构往来人' });
  await active(page).getByLabel('金额', { exact: true }).fill(amount);
  await active(page).getByLabel('备注', { exact: true }).fill(`虚构${type}记录`);
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(active(page).locator('.lj-dashboard-home')).toBeVisible();
}

test('新安装默认概况蓝色，日周月钻取有效，经典布局与主题偏好可持久切换', async ({
  page,
}, testInfo) => {
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-home-layout', 'overview');
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-accent', 'blue');
  await expect(active(page).getByRole('heading', { name: '预算余额', exact: true })).toBeVisible();
  await expect(active(page).getByRole('heading', { name: '收支概况', exact: true })).toBeVisible();
  await expect(active(page).locator('.lj-period-cards > button')).toHaveCount(3);
  await expect(
    active(page).getByRole('button', { name: '查看今天明细', exact: true }),
  ).toContainText('暂未记账');
  await expect(active(page).locator('.lj-dashboard-bar button')).toHaveCount(5);
  await active(page).getByRole('button', { name: '查看今天明细', exact: true }).click();
  await expect(active(page).getByRole('heading', { name: '收支明细', exact: true })).toBeVisible();
  await expect(active(page).locator('.lj-filter-chip')).toContainText('2026-11-08');
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(0);
  await backHome(page);
  await active(page).getByRole('button', { name: '查看本周明细', exact: true }).click();
  await expect(active(page).locator('.lj-filter-chip')).toContainText('2026-11-02');
  await expect(active(page).locator('.lj-filter-chip')).toContainText('2026-11-08');
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^经典首页/ })
    .click();
  await active(page).getByRole('button', { name: '选择珊瑚配色', exact: true }).click();
  await backHome(page);
  await expect(active(page).locator('.lj-spending-ring')).toBeVisible();
  await page.reload();
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-home-layout', 'classic');
  await expect(page.locator('.ledger-app')).toHaveAttribute('data-accent', 'coral');
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^概况首页/ })
    .click();
  await active(page).getByRole('button', { name: '选择蓝色配色', exact: true }).click();
  await backHome(page);
  await page.screenshot({ path: testInfo.outputPath('overview-default-blue.png'), fullPage: true });
});

test('未修改原APK导出的四表xls可初始化，原分类与成员可直接用于继续记账', async ({
  page,
}, testInfo) => {
  await importExcel(page, originalLegacyFixture(), 2);
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(2);
  await expect(active(page).locator('.lj-transaction-row').first()).toContainText(
    'FixtureBreakfast',
  );
  await expect(active(page).locator('.lj-transaction-row').first()).toContainText('自己');
  const originalRow = active(page).locator('.lj-transaction-row').filter({ hasText: '19:28' });
  await expect(originalRow).toHaveCount(1);
  await originalRow.click();
  await expect(active(page).getByLabel('记账时间', { exact: true })).toHaveValue('19:28');
  await expect(
    active(page).getByLabel('成员', { exact: true }).locator('option:checked'),
  ).toHaveText('自己');
  await active(page).getByLabel('备注', { exact: true }).fill('虚构测试：只修改备注');
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    active(page).locator('.lj-transaction-row').filter({ hasText: '只修改备注' }),
  ).toContainText('19:28');
  await addExpense(page, 'FixtureFood', 'FixtureBreakfast', '10', '虚构测试：原分类继续记账');
  await openReports(page);
  await expect(reportRow(page, 'FixtureFood / FixtureBreakfast')).toContainText('30.00');
  await expect(reportRow(page, 'FixtureFood / FixtureBreakfast')).toContainText(/3\s*笔/);
  await page.reload();
  await openReports(page);
  await expect(reportRow(page, 'FixtureFood / FixtureBreakfast')).toContainText('30.00');
  await expect(reportRow(page, 'FixtureFood / FixtureBreakfast')).toContainText(/3\s*笔/);
  await page.screenshot({
    path: testInfo.outputPath('original-apk-xls-three-records.png'),
    fullPage: true,
  });
});

test('四种借贷按原包实测改变现金及借贷净额，不混入普通收入支出', async ({ page }, testInfo) => {
  await importExcel(page, originalLegacyFixture(), 2);
  const cases = [
    { label: '借入' as const, amount: '71', balance: '51.00', net: '-71.00' },
    { label: '借出' as const, amount: '13', balance: '38.00', net: '-58.00' },
    { label: '还款' as const, amount: '11', balance: '27.00', net: '-47.00' },
    { label: '收款' as const, amount: '7', balance: '34.00', net: '-54.00' },
  ];
  for (const [index, item] of cases.entries()) {
    await addLoan(page, item.label, item.amount, index === 0);
    const monthCard = active(page).getByRole('button', { name: '查看本月明细', exact: true });
    await expect(monthCard.locator('.lj-period-values > span').first()).toContainText('0.00');
    await expect(monthCard.locator('.lj-accent-amount')).toContainText('20.00');
    await active(page).getByRole('button', { name: '账户', exact: true }).click();
    await expect(active(page).locator('.lj-account-total')).toContainText(item.balance);
    await expect(active(page).locator('.lj-loan-balance-summary strong')).toHaveText(item.net);
  }
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^借贷人管理/ })
    .click();
  await expect(active(page).locator('.lj-person-card')).toContainText('虚构往来人');
  await expect(active(page).locator('.lj-person-card')).toContainText('4 笔关联记录');
  await active(page).getByRole('button', { name: '查看虚构往来人的借贷记录', exact: true }).click();
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(4);
  await expect(active(page).locator('.lj-loan-stat-strip')).toContainText('78.00');
  await expect(active(page).locator('.lj-loan-stat-strip')).toContainText('24.00');
  await expect(active(page).locator('.lj-loan-stat-strip')).toContainText('-54.00');
  await active(page).getByLabel('筛选借贷类型', { exact: true }).selectOption('repay');
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(1);
  await expect(active(page).locator('.lj-transaction-row')).toContainText('还款');
  await expect(active(page).locator('.lj-transaction-row')).toContainText('11.00');
  await active(page).getByLabel('筛选收支类型', { exact: true }).selectOption('expense');
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(2);
  await expect(active(page).getByLabel('筛选借贷人', { exact: true })).toHaveCount(0);
  await page.reload();
  await active(page).getByRole('button', { name: '账户', exact: true }).click();
  await expect(active(page).locator('.lj-account-total')).toContainText('34.00');
  await expect(active(page).locator('.lj-loan-balance-summary strong')).toHaveText('-54.00');
  await page.screenshot({
    path: testInfo.outputPath('loan-cash-and-net-match-original.png'),
    fullPage: true,
  });
});

test('收入保持单层类别，成员默认为自己且可新建筛选改名，不重分历史', async ({ page }, testInfo) => {
  await openEntry(page);
  for (const label of ['支出', '收入', '转账', '借贷'])
    await expect(active(page).getByRole('button', { name: label, exact: true })).toBeVisible();
  await chooseEntryTab(page, '收入');
  await expect(active(page).getByRole('navigation', { name: '一级分类', exact: true })).toHaveCount(
    0,
  );
  await active(page).getByRole('button', { name: '新建收入类别', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新建收入类别', exact: true });
  await dialog.getByLabel('收入类别名称', { exact: true }).fill('工资');
  await dialog.getByRole('button', { name: '保存类别', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(active(page).getByRole('button', { name: '工资', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    active(page).getByLabel('成员', { exact: true }).locator('option:checked'),
  ).toHaveText('自己');
  await active(page).getByRole('button', { name: '新建记账成员', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建成员', exact: true });
  await dialog.getByLabel('成员名称', { exact: true }).fill('虚构家人');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await active(page).getByLabel('金额', { exact: true }).fill('100');
  await active(page).getByLabel('备注', { exact: true }).fill('虚构家人工资');
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await openEntry(page);
  await chooseEntryTab(page, '收入');
  await expect(
    active(page).getByLabel('成员', { exact: true }).locator('option:checked'),
  ).toHaveText('虚构家人');
  await active(page).getByLabel('成员', { exact: true }).selectOption({label:'自己'});
  await active(page).getByLabel('金额', { exact: true }).fill('30');
  await active(page).getByLabel('备注', { exact: true }).fill('虚构自己的工资');
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await openReports(page);
  await active(page).getByRole('button', { name: '收入分析', exact: true }).click();
  await expect(active(page).getByLabel('报表分类层级', { exact: true })).toHaveCount(0);
  await expect(reportRow(page, '工资').locator('strong')).toHaveText('工资');
  await expect(reportRow(page, '工资')).toContainText('130.00');
  await active(page).getByLabel('报表成员', { exact: true }).selectOption({ label: '虚构家人' });
  await expect(reportRow(page, '工资')).toContainText('100.00');
  await active(page).getByLabel('报表成员', { exact: true }).selectOption({ label: '自己' });
  await expect(reportRow(page, '工资')).toContainText('30.00');
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^成员管理/ })
    .click();
  await active(page).getByRole('button', { name: '管理成员 虚构家人', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '修改名称', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '修改成员', exact: true });
  await dialog.getByLabel('成员名称', { exact: true }).fill('虚构家庭成员');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await active(page).getByRole('button', { name: '查看虚构家庭成员的流水', exact: true }).click();
  await expect(active(page).locator('.lj-transaction-row')).toHaveCount(1);
  await expect(active(page).locator('.lj-transaction-row')).toContainText('100.00');
  await expect(active(page).locator('.lj-transaction-row')).toContainText('虚构家庭成员');
  await page.screenshot({
    path: testInfo.outputPath('income-single-level-and-member.png'),
    fullPage: true,
  });
});
