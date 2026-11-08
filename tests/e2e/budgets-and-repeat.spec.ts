import { expect, test, type Page } from '@playwright/test';
import { active, backHome, openFreshApp, importExcel, syntheticExcel, openEntry, originalBorrowFixture, createAccount, openReports } from './helpers';

async function budget(page: Page, period: '日'|'周'|'月', amount: string, category?: string) {
  await backHome(page);
  await active(page).getByRole('button', {name:`设置${period}预算`, exact:true}).click();
  await active(page).getByRole('button', {name:'新建预算',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:`设置${period}预算`,exact:true});
  if(category) await dialog.getByLabel('预算范围',{exact:true}).selectOption({label:category});
  await dialog.getByLabel('预算金额',{exact:true}).fill(amount);
  await dialog.getByRole('button',{name:'保存预算',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await backHome(page);
}

test('独立日周月预算、分类覆盖和原版结余百分比可见且刷新保持',async({page},info)=>{
  await openFreshApp(page);
  await importExcel(page,syntheticExcel([
    ['2026-11-08','支出',21,'餐饮','早餐','现金','虚构当日消费','生活账本'],
    ['2026-11-01','支出',2,'交通','公交','现金','虚构上周消费','生活账本'],
    ['2026-11-08','收入',200,'收入','工资','现金','虚构收入','生活账本'],
  ]),3);
  await backHome(page);
  await expect(active(page).locator('.lj-dashboard-hero-copy')).toContainText('88%');
  await budget(page,'日','50','交通');
  await expect(active(page).getByRole('button',{name:'设置日预算',exact:true})).toContainText('50.00');
  await budget(page,'日','100');
  await budget(page,'周','700');
  await budget(page,'月','3000');
  await expect(active(page).getByRole('button',{name:'设置日预算',exact:true})).toContainText('79.00');
  await expect(active(page).getByRole('button',{name:'设置周预算',exact:true})).toContainText('679.00');
  await expect(active(page).getByRole('button',{name:'设置月预算',exact:true})).toContainText('2,977.00');
  await page.reload();
  await expect(active(page).getByRole('button',{name:'设置日预算',exact:true})).toContainText('79.00');
  await expect(active(page).locator('.lj-dashboard-hero-copy')).toContainText('88%');
  await page.screenshot({path:info.outputPath('independent-budgets.png'),fullPage:true});
});

test('借贷再记回支出、恢复普通账户成员并将历史日期重置为今天',async({page},info)=>{
  await openFreshApp(page);
  await importExcel(page,originalBorrowFixture(),3);
  await createAccount(page,'虚构普通卡','0','bank');
  await createAccount(page,'虚构借贷卡','0','bank');
  await openEntry(page);
  await active(page).getByLabel('记账账户',{exact:true}).selectOption({label:'虚构普通卡'});
  await active(page).getByRole('button',{name:'新建记账成员',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'新建成员',exact:true});
  await dialog.getByLabel('成员名称',{exact:true}).fill('虚构家人');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await active(page).getByRole('button',{name:'借贷',exact:true}).click();
  await active(page).getByLabel('记账账户',{exact:true}).selectOption({label:'虚构借贷卡'});
  await active(page).getByLabel('借贷人',{exact:true}).selectOption({label:'FixtureLender'});
  await active(page).getByLabel('金额',{exact:true}).fill('13');
  await active(page).getByLabel('记账日期',{exact:true}).fill('2018-01-01');
  await active(page).getByLabel('记账时间',{exact:true}).fill('01:23');
  await active(page).getByLabel('备注',{exact:true}).fill('虚构历史借贷');
  await active(page).getByRole('button',{name:'再记一笔',exact:true}).click();
  await expect(active(page).getByRole('button',{name:'支出',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(active(page).getByLabel('记账账户',{exact:true}).locator('option:checked')).toHaveText('虚构普通卡');
  await expect(active(page).getByLabel('成员',{exact:true}).locator('option:checked')).toHaveText('虚构家人');
  await expect(active(page).getByLabel('记账日期',{exact:true})).toHaveValue('2026-11-08');
  await expect(active(page).getByLabel('记账时间',{exact:true})).toHaveValue('04:00');
  await expect(active(page).getByLabel('金额',{exact:true})).toHaveValue('');
  await expect(active(page).getByLabel('备注',{exact:true})).toHaveValue('');
  await expect(active(page).locator('.lj-calculator')).toBeVisible();
  await page.screenshot({path:info.outputPath('loan-repeat.png'),fullPage:true});
  await openReports(page);
  await expect(active(page).locator('.lj-report-chart')).toContainText('20.00');
});
