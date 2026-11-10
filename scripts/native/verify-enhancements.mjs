// This script operates only on mumu-device.mjs's verified, project-owned fictional-data VM 1.
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { adb, appId, connect, root, serial } from './mumu-device.mjs';
import { active, backHome, enterKeys, importExcel, openData, openEntry } from '../../tests/e2e/helpers.ts';

const output = path.join(root, '.tools/enhancement-native');
fs.mkdirSync(output, { recursive: true });
const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const bookName = `FixtureEnhancements${runId}`;
const report = { runId, device: 'project-owned MuMu VM 1', fictionalDataOnly: true, checks: {} };
const apk = path.join(root, 'artifacts/jizhang-jianjie2-debug.apk');
report.apkSha256 = createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
execFileSync(path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe'), ['-P', '5052', 'connect', serial], { encoding: 'utf8', timeout: 15000 });
report.sdk = Number(adb('shell', 'getprop', 'ro.build.version.sdk').trim());
if (process.argv.includes('--install')) adb('install', '-r', apk);
const packagePaths = adb('shell', 'pm', 'path', appId).trim().split(/\r?\n/);
if (packagePaths.length !== 1 || !/^package:\/data\/app\/.+\/base\.apk$/.test(packagePaths[0]))
  throw new Error('Expected the project universal APK installation');
report.installedApkSha256 = adb('shell', 'sha256sum', packagePaths[0].slice('package:'.length)).trim().split(/\s/)[0];
if (report.installedApkSha256 !== report.apkSha256)
  throw new Error('Installed APK differs from the current debug artifact; rerun with --install');
adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
adb('shell', 'wm', 'dismiss-keyguard');
// Restart only the project app so rerunning after a cancelled dialog never depends on stale UI.
adb('shell', 'am', 'force-stop', appId);
adb('shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`);

function hierarchy() {
  const result = adb('shell', 'uiautomator', 'dump', '/sdcard/fixture-enhancements-ui.xml');
  if (!/dumped to:/i.test(result)) return { xml: '', nodes: [] };
  const xml = adb('shell', 'cat', '/sdcard/fixture-enhancements-ui.xml');
  return { xml, nodes: [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))) };
}
function tap(node) {
  if (!node) throw new Error('Expected system control missing');
  const [x1, y1, x2, y2] = node.bounds.match(/\d+/g).map(Number);
  adb('shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)));
}
async function systemNode(predicate) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const state = hierarchy(), found = state.nodes.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  fs.writeFileSync(path.join(output, 'system-failure.xml'), hierarchy().xml);
  throw new Error('Requested system control was not present');
}
async function downloads() {
  const nodes = hierarchy().nodes;
  const inDownloads = node => node['resource-id']?.endsWith('/header_title') && /下载|Downloads/.test(node.text);
  if (nodes.some(inDownloads)) return;
  const rootEntry = node => /^(下载|Downloads)$/.test(node.text) && node['resource-id'] === 'android:id/title';
  const openEntry = nodes.find(rootEntry);
  if (openEntry) {
    tap(openEntry);
    await systemNode(inDownloads);
    return;
  }
  const menu = nodes.find((node) => /显示根目录|Show roots/.test(node['content-desc'] ?? ''));
  if (menu) {
    tap(menu);
    tap(await systemNode(rootEntry));
    await systemNode(inDownloads);
  }
}
async function selectSystemFile(fileName) {
  await systemNode((node) => node.package === 'com.android.documentsui' || node.package === 'com.google.android.documentsui');
  await downloads();
  const isTitle = node => node.text === fileName && node.enabled === 'true' && node['resource-id'] === 'android:id/title';
  const hasDocumentRows = nodes => nodes.some(node => /\/(metadata|details|preview_icon)$/.test(node['resource-id'] ?? ''));
  const initial = hierarchy().nodes;
  const visible = hasDocumentRows(initial) ? initial.find(isTitle) : undefined;
  if (visible) { tap(visible); return; }
  const search = initial.find(node => /^(搜索|Search)$/.test(node['content-desc'] ?? '') || node['resource-id']?.endsWith('/option_menu_search'));
  if (search) {
    tap(search);
    tap(await systemNode(node => node.class === 'android.widget.EditText' || node.class === 'android.widget.AutoCompleteTextView'));
    adb('shell', 'input', 'text', fileName);
    adb('shell', 'input', 'keyevent', 'KEYCODE_ENTER');
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    const nodes = hierarchy().nodes, title = nodes.find(isTitle);
    if (title && hasDocumentRows(nodes)) { tap(title); return; }
    if (title && nodes.some(node => (node['content-desc'] ?? '').includes('删除搜索记录'))) tap(title);
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  fs.writeFileSync(path.join(output, 'system-failure.xml'), hierarchy().xml);
  throw new Error('Named fictional system document did not become selectable');
}
const original = fs.readFileSync(path.join(root, 'tests/fixtures/legacy-4.8.8-full-types.xls'));
if (createHash('sha256').update(original).digest('hex') !== 'b809a5863a215c3f32457fe33f3e4ef0f2ee4ba90a1b0436de81ef97cade1584') throw new Error('Known fictional original fixture changed');
const sheets = XLSX.read(original);
const rows = Object.fromEntries(sheets.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json(sheets.Sheets[name], { header: 1 })]));
for (const name of sheets.SheetNames) rows[name][1][1] = '2026-01-01 - 2027-01-01';
rows['支出'].push(['2.00', 'FixtureTransport', 'FixtureBreakfast', '现金', '2026-11-08 12:00', '自己', 'Fixture second parent']);
rows['支出'][0][1] = '22.00';
function workbookFile(name) {
  const data = XLSX.utils.book_new();
  for (const sheetName of sheets.SheetNames) XLSX.utils.book_append_sheet(data, XLSX.utils.aoa_to_sheet(rows[sheetName]), sheetName);
  return { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(XLSX.write(data, { type: 'buffer', bookType: 'xlsx' })) };
}
// Full two-frame GIF is shared with the browser fixture. Read source code, never personal media.
const gifSource = fs.readFileSync(path.join(root, 'tests/e2e/home-background.spec.ts'), 'utf8').match(/const gif\s*=\s*'([^']+)'/)[1];
let connection = await connect(), browser = connection.browser, page = connection.page;
const read = () => page.evaluate(async () => (await window.Capacitor.nativePromise('LedgerStore', 'read', {})).snapshot);
const saveReport = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
try {
  await expect(page.locator('.ledger-app')).toBeVisible({ timeout: 30000 });
  report.webview = await page.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]);
  const before = JSON.parse((await read()).data);
  const previousIds = new Set(before.transactions.map((row) => row.id));
  await openData(page);
  await active(page).getByRole('button', { name: /^概况首页/ }).click();
  await backHome(page);
  await active(page).locator('.lj-dashboard-book').click();
  await active(page).getByRole('button', { name: '新建账本', exact: true }).click();
  const bookDialog = page.getByRole('dialog', { name: '新建账本', exact: true });
  await bookDialog.getByLabel('账本名称', { exact: true }).fill(bookName);
  await bookDialog.getByRole('button', { name: '保存账本', exact: true }).click();
  await expect(bookDialog).not.toBeVisible();
  const selectBook = active(page).getByRole('button', { name: `切换到${bookName}`, exact: true });
  if (await selectBook.count() && await selectBook.isEnabled()) await selectBook.click();
  const selectedAfterCreate = JSON.parse((await read()).data);
  if (selectedAfterCreate.books.find(book => book.name === bookName)?.id !== selectedAfterCreate.settings.selectedBookId)
    throw new Error('New fictional enhancement book was not selected');
  await importExcel(page, workbookFile(`fictional-native-baseline-${runId}.xlsx`), 9);
  const imported = JSON.parse((await read()).data), bookId = imported.books.find((book) => book.name === bookName).id;
  expect(imported.transactions.filter((row) => row.bookId === bookId)).toHaveLength(9);
  for (const row of before.transactions) expect(imported.transactions.find((item) => item.id === row.id)).toEqual(row);
  report.checks.previousFictionalLedgerPreserved = true;
  await backHome(page);
  await expect(active(page).getByRole('button', { name: '查看本年明细', exact: true })).toContainText('9 笔');
  await active(page).getByRole('button', { name: '查看本年明细', exact: true }).click();
  await expect(active(page)).toContainText('本年');
  await expect(active(page)).toContainText('9 笔');
  report.checks.yearEntryAndRange = true;
  await openEntry(page);
  await active(page).getByRole('button', { name: 'FixtureFood', exact: true }).click();
  await active(page).getByLabel('搜索分类', { exact: true }).fill('FixtureBreakfast');
  const search = active(page).getByRole('region', { name: '分类搜索结果', exact: true });
  await expect(search.getByRole('button')).toHaveCount(2);
  await search.getByRole('button', { name: 'FixtureTransport / FixtureBreakfast', exact: true }).click();
  await active(page).getByLabel('金额', { exact: true }).fill('');
  await enterKeys(page, ['2', '加', '3', '乘', '4', '除', '2', '减', '1']);
  await expect(active(page).getByLabel('计算预览', { exact: true })).toHaveText('= ¥7.00');
  await active(page).getByLabel('记账日期', { exact: true }).fill('2026-11-10');
  await active(page).getByLabel('备注', { exact: true }).fill('Fixture calculator');
  await page.screenshot({ path: path.join(output, 'native-calculator.png') });
  await active(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(active(page).getByRole('heading', { name: '简洁记账', exact: true })).toBeVisible();
  const changed = JSON.parse((await read()).data);
  const calculated = changed.transactions.find((row) => row.bookId === bookId && row.note === 'Fixture calculator');
  expect(calculated.amountCents).toBe(700);
  const category = changed.categories.find((item) => item.id === calculated.categoryId);
  expect(category.name).toBe('FixtureBreakfast');
  expect(changed.categories.find((item) => item.id === category.parentId).name).toBe('FixtureTransport');
  report.checks.crossParentSearchAndFourOperations = true;
  await openData(page);
  await active(page).getByLabel('选择首页背景图片', { exact: true }).setInputFiles({ name: 'fixture-two-frame.gif', mimeType: 'image/gif', buffer: Buffer.from(gifSource, 'base64') });
  await active(page).getByRole('button', { name: '应用首页背景', exact: true }).click();
  await backHome(page);
  let image = active(page).locator('.lj-dashboard-hero .lj-home-background');
  await expect(image).toHaveAttribute('src', `data:image/gif;base64,${gifSource}`);
  const frames = new Set();
  for (let index = 0; index < 5; index++) { frames.add((await image.screenshot()).toString('base64')); await page.waitForTimeout(150); }
  expect(frames.size).toBeGreaterThan(1);
  const stored = await read();
  await browser.close();
  adb('shell', 'am', 'force-stop', appId);
  adb('shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`);
  connection = await connect(); browser = connection.browser; page = connection.page;
  await expect(page.locator('.ledger-app')).toBeVisible({ timeout: 30000 });
  expect((await read()).data).toBe(stored.data);
  image = active(page).locator('.lj-dashboard-hero .lj-home-background');
  await expect(image).toHaveAttribute('src', `data:image/gif;base64,${gifSource}`);
  await page.screenshot({ path: path.join(output, 'native-gif-restarted.png') });
  report.checks.gifAnimatedAndExactStateAfterForceStop = true;
  const calcTime = calculated.time ? ` ${calculated.time.slice(0, 5)}` : '';
  rows['支出'].push(['7.00', 'FixtureTransport', 'FixtureBreakfast', '现金', `2026-11-10${calcTime}`, changed.members.find((member) => member.id === calculated.memberId).name, 'Fixture calculator']);
  rows['支出'][0][1] = '29.00';
  const annual = workbookFile(`fixture-native-annual-${runId}.xlsx`), annualPath = path.join(output, annual.name);
  fs.writeFileSync(annualPath, annual.buffer);
  adb('push', annualPath, `/sdcard/Download/${annual.name}`);
  await openData(page);
  await active(page).getByRole('button', { name: /^年度 Excel 对账/ }).click();
  const dialog = page.getByRole('dialog', { name: '年度 Excel 对账', exact: true });
  await dialog.getByLabel('对账年份', { exact: true }).fill('2026');
  await dialog.getByLabel('选择年度对账Excel', { exact: true }).click();
  await selectSystemFile(annual.name);
  await dialog.getByRole('button', { name: '开始年度对账', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '本年明细逐笔一致', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(dialog).toContainText('旧版 10 笔 · 新版 10 笔 · 完全匹配 10 笔');
  await expect(dialog).not.toContainText('Fixture calculator');
  report.checks.systemPickedAnnualExcelAndWorker = true;
  const beforeReport = await read();
  await dialog.getByRole('button', { name: '保存脱敏报告', exact: true }).click();
  const fileNameField = await systemNode((node) => node.class === 'android.widget.EditText');
  tap(fileNameField);
  adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END', ...Array(100).fill('KEYCODE_DEL'));
  const reportFile = `fixture-annual-report-${runId}.json`;
  adb('shell', 'input', 'text', reportFile);
  tap(await systemNode((node) => /^(保存|SAVE|Save)$/.test(node.text) && node.enabled === 'true'));
  await expect(dialog.getByRole('status')).toContainText('对账报告已保存并校验', { timeout: 30000 });
  const savedPath = path.join(output, reportFile);
  adb('pull', `/sdcard/Download/${reportFile}`, savedPath);
  const reportText = fs.readFileSync(savedPath, 'utf8'), saved = JSON.parse(reportText);
  expect(saved).toMatchObject({ passed: true, year: 2026, legacyCount: 10, currentCount: 10, matchedCount: 10 });
  for (const forbidden of ['amountCents', 'Fixture', '2026-11-', '现金', '储蓄卡', 'Fixture calculator']) expect(reportText).not.toContain(forbidden);
  expect((await read()).data).toBe(beforeReport.data);
  report.checks.safReportSavedReadBackRedactedAndNoMutation = true;
  await page.screenshot({ path: path.join(output, 'native-reconciliation-saved.png') });
  await dialog.getByRole('button', { name: '关闭年度对账', exact: true }).click();
  await backHome(page);
  report.checks.existingTransactionCountPreserved = previousIds.size;
  report.checks.syntheticAddedTransactions = 10;
  report.complete = true; saveReport();
  console.log(JSON.stringify(report));
} catch (error) {
  report.complete = false; report.failure = error instanceof Error ? error.message.split('\n')[0] : 'Native verification failed'; saveReport();
  try { await page.screenshot({ path: path.join(output, 'native-failure.png') }); } catch {}
  throw error;
} finally { await browser.close(); }
