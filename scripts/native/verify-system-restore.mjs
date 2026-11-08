import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { connect, adb, output, hierarchy, tapNode, screenshot } from './device.mjs';
import { addExpense, openData, active } from '../../tests/e2e/helpers.ts';

// Requires the preceding three-row fictional native import and its encrypted SAF backup.
// It is intentionally confined to device.mjs's project-owned test AVD.
const name = adb('shell','ls','/sdcard/Download').trim().split(/\r?\n/).map(s=>s.trim()).filter(s=>s.includes('加密')&&s.endsWith('.jzbackup')).sort().at(-1);
if (!name) throw new Error('Missing project-generated encrypted backup');
const {browser,page}=await connect();
const read=async()=>page.evaluate(async()=>(await window.Capacitor.nativePromise('LedgerStore','read',{})).snapshot);
try {
  await expect(page.locator('.ledger-app')).toBeVisible({timeout:30000});
  const baseline=await read();
  if(JSON.parse(baseline.data).transactions.length!==3) throw new Error('Expected the fictional three-row baseline');
  await addExpense(page,'FixtureFood','FixtureBreakfast','1.23','Fictional native backup delta');
  const changed=await read();
  if(JSON.parse(changed.data).transactions.length!==4)throw new Error('Missing test delta');
  await openData(page);
  await active(page).getByRole('button',{name:/^从完整备份恢复/}).click();
  const dialog=page.getByRole('dialog',{name:'恢复完整备份',exact:true});
  await dialog.locator('.bk-file-choice').click();
  await page.waitForTimeout(1000);
  const node=hierarchy().nodes.find(n=>n.text===name);
  if(!node||node.enabled!=='true')throw new Error('Saved .jzbackup must be selectable in system picker');
  tapNode(n=>n.text===name);
  await dialog.getByLabel('备份密码',{exact:true}).fill('wrong-fixture-password');
  await dialog.getByRole('button',{name:'解密并校验',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('密码不正确或文件已损坏');
  if((await read()).sha256!==changed.sha256)throw new Error('Wrong password changed data');
  await dialog.getByLabel('备份密码',{exact:true}).fill('fixture-native-password');
  await dialog.getByRole('button',{name:'解密并校验',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'将恢复的备份',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'确认恢复全部账本',exact:true})).toBeDisabled();
  screenshot('native-backup-verified-before-restore');
  await dialog.getByLabel('我已确认，用这份备份替换当前全部账本。',{exact:true}).check();
  await dialog.getByRole('button',{name:'确认恢复全部账本',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  const restored=await read();
  if(restored.data!==baseline.data)throw new Error('Restored state differs from pre-backup state');
  const report={actualSystemPicker:true,jzbackupSelectable:true,wrongPasswordUnchanged:true,explicitConfirmationRequired:true,exactStateRestored:true,transactions:3};
  fs.writeFileSync(path.join(output,'native-restore-report.json'),JSON.stringify(report,null,2));
  console.log(report);
} finally { await browser.close(); }
