// Real SAF + SQLite migration checks, confined by mumu-device.mjs to fictional-data VM 1.
// Run only after building the intended Debug APK. Never clears data or touches MuMu VM 0.
// Full loop: node scripts/native/verify-db-migration.mjs --install \
//   --annual-excel analysis/legacy-lab/<actual-original-annual-export>.xls \
//   --annual-sha256 <digest-confirmed-by-the-original-APK-export-experiment>
// Without annual input this records DB checks as complete, but leaves the full loop pending.
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { adb, appId, connect, root, serial } from './mumu-device.mjs';
import { active, backHome, openData } from '../../tests/e2e/helpers.ts';

const sourceSha256 = '9f130b34a9080d497e3bf02eb1ff21d61fa1498312a1e5459f847debd302f7f9';
const output = path.join(root, '.tools/db-native');
const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const sourcePath = path.join(root, 'analysis/legacy-lab/db/legacy-4.8.8-generated.db');
const fixturePath = path.join(root, 'tests/fixtures/legacy-4.8.8-db.json');
const apkPath = path.join(root, 'artifacts/jizhang-jianjie2-debug.apk');
const options = { install: false, annualPath: '', annualSha256: '' };
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--install') options.install = true;
  else if (argument === '--annual-excel') options.annualPath = process.argv[++index] ?? '';
  else if (argument === '--annual-sha256')
    options.annualSha256 = (process.argv[++index] ?? '').toLowerCase();
  else throw new Error('Unknown native verification argument');
}
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const same = (left, right) => canonical(left) === canonical(right);
const sourceBytes = fs.readFileSync(sourcePath);
check(sha256(sourceBytes) === sourceSha256, 'The explicitly authorized fictional database changed');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
check(
  fixture.sourceSha256 === sourceSha256 && fixture.userVersion === 16,
  'Fictional schema fixture identity changed',
);
const originalTables = Object.fromEntries(
  Object.entries(fixture.tables).map(([name, value]) => [name, value.rows]),
);
const tableForDirection = {
  expense: 'expenses',
  income: 'income',
  transfer: 'transfer',
  loan: 'borrow',
};
const originalCount = Object.values(tableForDirection).reduce(
  (count, table) => count + originalTables[table].length,
  0,
);
check(
  originalCount === 12,
  'This verification is restricted to the original twelve-record fixture',
);
const years = new Set(
  Object.values(tableForDirection).flatMap((table) =>
    originalTables[table].map((row) => String(row.date).slice(0, 4)),
  ),
);
check(years.size === 1, 'The fixed fixture no longer belongs to one verification year');
const year = Number([...years][0]);
let annual = null;
check(
  Boolean(options.annualPath) === Boolean(options.annualSha256),
  'Annual export path and verified SHA-256 must be supplied together',
);
if (options.annualPath) {
  const resolved = fs.realpathSync(path.resolve(root, options.annualPath));
  const authorized = fs.realpathSync(path.join(root, 'analysis/legacy-lab'));
  const relative = path.relative(authorized, resolved);
  check(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'Annual input must belong to the project-owned fictional legacy lab',
  );
  check(
    /\.xls$/i.test(resolved) && /^[a-f0-9]{64}$/.test(options.annualSha256),
    'Expected the original APK XLS export and its verified digest',
  );
  const bytes = fs.readFileSync(resolved);
  check(
    sha256(bytes) === options.annualSha256,
    'Original annual Excel digest does not match the supplied evidence',
  );
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  const sheets = ['支出', '收入', '转账', '借贷'];
  check(
    workbook.SheetNames.length === 4 && sheets.every((name) => workbook.SheetNames.includes(name)),
    'Original annual file must have all four sheets',
  );
  let count = 0;
  for (const name of sheets) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null });
    const range = String(rows[1]?.[1] ?? '').trim();
    check(
      range === `${year}-01-01 - ${year + 1}-01-01` || range === `${year}-01-01 - ${year}-12-31`,
      'The actual original export is not the expected full calendar year',
    );
    count += rows
      .slice(3)
      .filter((row) => row.some((cell) => cell !== null && String(cell).trim())).length;
  }
  check(
    count === originalCount,
    'Original annual file must retain the same twelve records as the database',
  );
  annual = {
    path: resolved,
    sha256: options.annualSha256,
    name: `fixture-original-annual-${options.annualSha256.slice(0, 12)}.xls`,
  };
}

fs.mkdirSync(output, { recursive: true });
const report = {
  runId,
  fictionalDataOnly: true,
  device: 'project-owned MuMu VM 1',
  sourceSha256,
  apkSha256: sha256(fs.readFileSync(apkPath)),
  year,
  sourceRecords: originalCount,
  annualExcelSha256: annual?.sha256 ?? null,
  annualExcelStatus: annual ? 'pending' : 'not provided; full loop pending',
  checks: {},
  dbChecksComplete: false,
  complete: false,
};
let phase = 'connect-dedicated-device';
let browser, page;
const saveReport = () => {
  const json = JSON.stringify(report, null, 2);
  fs.writeFileSync(path.join(output, 'report.json'), json);
  fs.writeFileSync(path.join(output, `report-${runId}.json`), json);
};
function hierarchy() {
  const result = adb('shell', 'uiautomator', 'dump', '/sdcard/fixture-db-migration-ui.xml');
  // A transient non-idle result leaves the old file untouched; never reuse that stale tree.
  if (!/dumped to:/i.test(result)) return { xml: '', nodes: [] };
  const xml = adb('shell', 'cat', '/sdcard/fixture-db-migration-ui.xml');
  return {
    xml,
    nodes: [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) =>
      Object.fromEntries(
        [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
      ),
    ),
  };
}
function tap(node) {
  check(node?.bounds, 'Required system control was not present');
  const bounds = node.bounds.match(/\d+/g).map(Number);
  adb(
    'shell',
    'input',
    'tap',
    String(Math.round((bounds[0] + bounds[2]) / 2)),
    String(Math.round((bounds[1] + bounds[3]) / 2)),
  );
}
async function systemNode(predicate) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const found = hierarchy().nodes.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  // Only this ownership-guarded fictional VM may produce a diagnostic hierarchy.
  fs.writeFileSync(path.join(output, `system-failure-${runId}.xml`), hierarchy().xml);
  throw new Error('Required Android system control did not appear');
}
async function downloads() {
  const nodes = hierarchy().nodes;
  const inDownloads = (node) =>
    node['resource-id']?.endsWith('/header_title') && /下载|Downloads/.test(node.text);
  if (nodes.some(inDownloads)) return;
  const rootEntry = (node) =>
    /^(下载|Downloads)$/.test(node.text) && node['resource-id'] === 'android:id/title';
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
  await systemNode((node) =>
    /^(com.android.documentsui|com.google.android.documentsui)$/.test(node.package),
  );
  await downloads();
  const initialNodes = hierarchy().nodes;
  const isTitle = (node) =>
    node.text === fileName && node.enabled === 'true' && node['resource-id'] === 'android:id/title';
  const hasDocumentRows = (nodes) =>
    nodes.some((node) => /\/(metadata|details|preview_icon)$/.test(node['resource-id'] ?? ''));
  const visible = hasDocumentRows(initialNodes) ? initialNodes.find(isTitle) : undefined;
  if (visible) {
    tap(visible);
    return;
  }
  const search = hierarchy().nodes.find(
    (node) =>
      /^(搜索|Search)$/.test(node['content-desc'] ?? '') ||
      node['resource-id']?.endsWith('/menu_search'),
  );
  if (search) {
    tap(search);
    tap(
      await systemNode(
        (node) =>
          node.class === 'android.widget.EditText' ||
          node.class === 'android.widget.AutoCompleteTextView',
      ),
    );
    adb('shell', 'input', 'text', fileName);
    adb('shell', 'input', 'keyevent', 'KEYCODE_ENTER');
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    const nodes = hierarchy().nodes;
    const title = nodes.find(isTitle);
    if (title && hasDocumentRows(nodes)) {
      tap(title);
      return;
    }
    // Android 12 may show the submitted query as a history suggestion first.
    if (title && nodes.some((node) => (node['content-desc'] ?? '').includes('删除搜索记录')))
      tap(title);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  fs.writeFileSync(path.join(output, `system-failure-${runId}.xml`), hierarchy().xml);
  throw new Error('The named fictional system document did not become selectable');
}
async function saveSystemFile(fileName) {
  await systemNode((node) =>
    /^(com.android.documentsui|com.google.android.documentsui)$/.test(node.package),
  );
  await downloads();
  tap(await systemNode((node) => node.class === 'android.widget.EditText'));
  adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END', ...Array(160).fill('KEYCODE_DEL'));
  adb('shell', 'input', 'text', fileName);
  tap(await systemNode((node) => /^(保存|SAVE|Save)$/.test(node.text) && node.enabled === 'true'));
}
async function connected() {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      return await connect();
    } catch (error) {
      if (attempt === 11) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}
const read = () =>
  page.evaluate(
    async () => (await window.Capacitor.nativePromise('LedgerStore', 'read', {})).snapshot,
  );
const parse = (snapshot) => JSON.parse(snapshot.data);
async function openDbPanel(remoteName) {
  await openData(page);
  await active(page)
    .getByRole('button', { name: /从旧版 \.db 初始化/ })
    .click();
  const panel = page.getByRole('dialog', { name: '从旧版 .db 初始化', exact: true });
  await panel.getByRole('button', { name: '选择旧版 .db 文件', exact: true }).click();
  await selectSystemFile(remoteName);
  await expect(panel.getByRole('heading', { name: '导入预览', exact: true })).toBeVisible({
    timeout: 65000,
  });
  await expect(panel).toContainText('12 笔');
  return panel;
}
const collectionKeys = [
  'books',
  'accounts',
  'members',
  'memberAliases',
  'loanPeople',
  'loanPersonAliases',
  'categories',
  'categoryAliases',
  'transactions',
  'imports',
  'budgets',
  'templates',
];
function previousContentPreserved(before, after) {
  for (const key of collectionKeys)
    check(
      same(before[key], after[key].slice(0, before[key].length)),
      'A prior fictional ledger collection changed',
    );
  const { selectedBookId: beforeBook, ...beforeSettings } = before.settings;
  const { selectedBookId: afterBook, ...afterSettings } = after.settings;
  check(same(beforeSettings, afterSettings), 'Existing appearance or other settings changed');
}
function cents(value) {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d{0,2}))?$/);
  check(match, 'Fixed source money could not be checked exactly');
  return (match[1] ? -1 : 1) * (Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0')));
}
function verifyImportedState(state, bookId) {
  const normalized = (value) =>
    String(value ?? '')
      .normalize('NFC')
      .trim();
  const accountName = (id) => state.accounts.find((item) => item.id === id)?.name;
  const transactions = state.transactions.filter((row) => row.bookId === bookId);
  check(
    transactions.length === originalCount,
    'Migrated record count differs from the original twelve rows',
  );
  const batch = state.imports.find(
    (item) => item.bookId === bookId && item.digest === sourceSha256,
  );
  check(
    batch?.legacyDb?.format === 'jianjie-4.8.8',
    'The migrated book lost its original database identity',
  );
  check(
    same(batch.legacyDb.tables, originalTables),
    'Original metadata tables or fields were not preserved exactly',
  );
  for (const [direction, table] of Object.entries(tableForDirection)) {
    const rows = transactions.filter((row) => row.direction === direction);
    check(
      rows.length === originalTables[table].length,
      'One transaction type has missing or duplicated rows',
    );
    const rowIds = new Set(rows.map((row) => row.source?.row));
    check(
      rows.every((row) => row.source?.batchId === batch.id && row.source.sheet === table),
      'A migrated record lost its source association',
    );
    check(
      rowIds.size === rows.length && originalTables[table].every((row) => rowIds.has(row.id)),
      'Original row identity coverage is incomplete',
    );
    for (const original of originalTables[table]) {
      const row = rows.find((item) => item.source.row === original.id);
      const [sourceDate, sourceTime] = String(original.date).split(' ');
      check(
        row.amountCents === cents(original.money),
        'A migrated amount differs from its original row',
      );
      check(
        row.date === sourceDate &&
          row.time === sourceTime &&
          row.note === String(original.remarks ?? ''),
        'A migrated date, minute, or note differs from its original row',
      );
      check(
        accountName(row.accountId) ===
          normalized(
            direction === 'transfer' ? original.transfer_account_from : original.account_detail,
          ),
        'A migrated source account differs from its original row',
      );
      if (direction === 'transfer')
        check(
          accountName(row.toAccountId) === normalized(original.transfer_account_to),
          'A migrated transfer destination differs from its original row',
        );
      if (direction === 'loan') {
        const person = state.loanPeople.find((item) => item.id === row.personId);
        check(
          person?.name === normalized(original.member) &&
            row.loanType ===
              { 借入: 'borrow', 借出: 'lend', 还款: 'repay', 收款: 'collect' }[
                original.type_detail
              ],
          'A migrated loan party or direction differs from its original row',
        );
      } else {
        check(
          state.members.find((item) => item.id === row.memberId)?.name ===
            normalized(original.member),
          'A migrated member differs from its original row',
        );
      }
      if (direction === 'expense' || direction === 'income') {
        const category = state.categories.find((item) => item.id === row.categoryId);
        const parent = state.categories.find((item) => item.id === category?.parentId);
        check(
          category?.name === normalized(original.type_detail) &&
            parent?.name === (direction === 'expense' ? normalized(original.type_main) : '收入'),
          'A migrated complete category path differs from its original row',
        );
      }
    }
  }
  for (const original of originalTables.account_type) {
    const account = state.accounts.find(
      (item) =>
        item.bookId === bookId && item.name === String(original.value).normalize('NFC').trim(),
    );
    check(account, 'An original account is missing');
    let balance = account.openingBalanceCents;
    for (const row of transactions) {
      if (row.accountId === account.id) {
        const positive =
          row.direction === 'income' ||
          (row.direction === 'loan' && ['borrow', 'collect'].includes(row.loanType));
        balance += positive ? row.amountCents : -row.amountCents;
      }
      if (row.direction === 'transfer' && row.toAccountId === account.id)
        balance += row.amountCents;
    }
    check(
      Number.isSafeInteger(balance) && balance === cents(original.money),
      'Migrated current account balance differs from the original stored snapshot',
    );
  }
}

try {
  execFileSync(
    path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe'),
    ['-P', '5052', 'connect', serial],
    { encoding: 'utf8', timeout: 15000 },
  );
  report.sdk = Number(adb('shell', 'getprop', 'ro.build.version.sdk').trim());
  if (options.install) adb('install', '-r', apkPath);
  const packagePaths = adb('shell', 'pm', 'path', appId).trim().split(/\r?\n/);
  check(
    packagePaths.length === 1 && /^package:\/data\/app\/.+\/base\.apk$/.test(packagePaths[0]),
    'Expected one universal project APK',
  );
  report.installedApkSha256 = adb('shell', 'sha256sum', packagePaths[0].slice('package:'.length))
    .trim()
    .split(/\s/)[0];
  check(
    report.installedApkSha256 === report.apkSha256,
    'Installed APK does not match the current Debug artifact; use --install',
  );
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  adb('shell', 'wm', 'dismiss-keyguard');
  adb('shell', 'am', 'force-stop', appId);
  adb('shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`);
  ({ browser, page } = await connected());
  await expect(page.locator('.ledger-app')).toBeVisible({ timeout: 30000 });
  report.webview = await page.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]);
  const baseline = await read(),
    before = parse(baseline);
  report.priorBooks = before.books.length;
  report.priorRecords = before.transactions.length;
  report.baselineSnapshotSha256 = baseline.sha256;
  const existing = before.imports.filter((batch) => batch.digest === sourceSha256);
  check(existing.length <= 1, 'The fixture already has ambiguous duplicate import batches');
  let bookId = existing[0]?.bookId;
  const remoteName = `fixture-legacy-${sourceSha256.slice(0, 12)}.db`;
  adb('push', sourcePath, `/sdcard/Download/${remoteName}`);
  check(
    adb('shell', 'sha256sum', `/sdcard/Download/${remoteName}`).trim().split(/\s/)[0] ===
      sourceSha256,
    'Pushed system-picker database changed',
  );
  phase = 'system-database-selection';
  const panel = await openDbPanel(remoteName);
  check((await read()).data === baseline.data, 'Database preview changed the ledger');
  report.checks.actualSafDatabaseSelectionAndReadOnlyPreview = true;
  await expect(panel.getByRole('button', { name: '确认初始化导入', exact: true })).toBeDisabled();
  await panel.getByLabel('旧版导入账本名称', { exact: true }).fill(`FixtureDbMigration${runId}`);
  await panel.getByRole('checkbox').check();
  phase = existing.length ? 'reuse-existing-fixture' : 'initialize-independent-book';
  await panel.getByRole('button', { name: '确认初始化导入', exact: true }).click();
  if (existing.length) {
    await expect(panel.getByRole('alert')).toContainText('已经导入');
    check(
      (await read()).data === baseline.data,
      'Repeated initialization changed the existing fictional ledger',
    );
    await panel.getByRole('button', { name: '关闭旧版数据库导入', exact: true }).click();
    report.reusedExistingFixtureBook = true;
  } else {
    await expect(panel.getByRole('heading', { name: '旧版账本已导入', exact: true })).toBeVisible({
      timeout: 30000,
    });
    await page.screenshot({ path: path.join(output, `database-imported-${runId}.png`) });
    await panel.getByRole('button', { name: '完成', exact: true }).click();
    const next = parse(await read());
    bookId = next.imports.find((batch) => batch.digest === sourceSha256)?.bookId;
    check(
      bookId && next.books.length === before.books.length + 1,
      'Initialization did not add exactly one separate book',
    );
    check(
      next.transactions.length === before.transactions.length + originalCount,
      'Initialization did not add exactly twelve records',
    );
    report.reusedExistingFixtureBook = false;
  }
  let after = parse(await read());
  previousContentPreserved(before, after);
  verifyImportedState(after, bookId);
  report.checks.existingBooksAndSettingsPreserved = true;
  report.checks.allTwelveSourceRowsOnceAndAllMetadataPreserved = true;
  report.checks.currentAccountBalancesEqualOriginalSnapshots = true;
  if (after.settings.selectedBookId !== bookId) {
    phase = 'select-existing-fixture-book';
    await openData(page);
    await active(page)
      .getByRole('button', { name: /^我的账本/ })
      .click();
    const book = after.books.find((item) => item.id === bookId);
    check(
      book && !book.archived,
      'The previously migrated fixture book is not available for verification',
    );
    await active(page)
      .getByRole('button', { name: `切换到${book.name}`, exact: true })
      .click();
    // Changing books resets the route to home; wait for that transition instead of racing Back.
    await expect.poll(async () => parse(await read()).settings.selectedBookId).toBe(bookId);
    await expect(
      active(page).getByRole('heading', { name: '简洁记账', exact: true }),
    ).toBeVisible();
  }
  phase = 'restart-persistence';
  const stored = await read();
  await browser.close();
  browser = null;
  adb('shell', 'am', 'force-stop', appId);
  adb('shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`);
  ({ browser, page } = await connected());
  await expect(page.locator('.ledger-app')).toBeVisible({ timeout: 30000 });
  check(
    (await read()).data === stored.data,
    'Force-stop restart did not retain the exact complete state',
  );
  verifyImportedState(parse(await read()), bookId);
  report.checks.exactStateAfterForceStop = true;
  phase = 'duplicate-database-rejection';
  const beforeDuplicate = await read();
  const duplicate = await openDbPanel(remoteName);
  await duplicate.getByLabel('旧版导入账本名称', { exact: true }).fill(`FixtureDuplicate${runId}`);
  await duplicate.getByRole('checkbox').check();
  await duplicate.getByRole('button', { name: '确认初始化导入', exact: true }).click();
  await expect(duplicate.getByRole('alert')).toContainText('已经导入');
  check(
    (await read()).data === beforeDuplicate.data,
    'Duplicate rejection changed persisted state',
  );
  await page.screenshot({ path: path.join(output, `duplicate-rejected-${runId}.png`) });
  await duplicate.getByRole('button', { name: '关闭旧版数据库导入', exact: true }).click();
  report.checks.duplicateSafInputRejectedWithoutWrite = true;

  if (annual) {
    phase = 'actual-original-annual-excel';
    adb('push', annual.path, `/sdcard/Download/${annual.name}`);
    check(
      adb('shell', 'sha256sum', `/sdcard/Download/${annual.name}`).trim().split(/\s/)[0] ===
        annual.sha256,
      'Pushed annual export changed',
    );
    await openData(page);
    await active(page)
      .getByRole('button', { name: /^年度 Excel 对账/ })
      .click();
    const comparison = page.getByRole('dialog', { name: '年度 Excel 对账', exact: true });
    await comparison.getByRole('combobox').selectOption(bookId);
    await comparison.getByLabel('对账年份', { exact: true }).fill(String(year));
    await comparison.getByLabel('选择年度对账Excel', { exact: true }).click();
    await selectSystemFile(annual.name);
    const beforeCompare = await read();
    await comparison.getByRole('button', { name: '开始年度对账', exact: true }).click();
    await expect(
      comparison.getByRole('heading', { name: '本年明细逐笔一致', exact: true }),
    ).toBeVisible({ timeout: 65000 });
    await expect(comparison).toContainText('旧版 12 笔 · 新版 12 笔 · 完全匹配 12 笔');
    check((await read()).data === beforeCompare.data, 'Annual reconciliation wrote to the ledger');
    await page.screenshot({ path: path.join(output, `original-annual-matched-${runId}.png`) });
    await comparison.getByRole('button', { name: '保存脱敏报告', exact: true }).click();
    const reportName = `fixture-db-annual-report-${runId}.json`;
    await saveSystemFile(reportName);
    await expect(comparison.getByRole('status')).toContainText('对账报告已保存并校验', {
      timeout: 30000,
    });
    const reportPath = path.join(output, reportName);
    adb('pull', `/sdcard/Download/${reportName}`, reportPath);
    const annualText = fs.readFileSync(reportPath, 'utf8'),
      annualResult = JSON.parse(annualText);
    check(
      annualResult.passed === true &&
        annualResult.legacyCount === 12 &&
        annualResult.currentCount === 12 &&
        annualResult.matchedCount === 12,
      'Saved original annual report did not verify every record',
    );
    check(
      !/amountCents|account|person|member|note|Fixture|2026-\d{2}-/.test(annualText),
      'Default annual report included private detail fields',
    );
    check(
      (await read()).data === beforeCompare.data,
      'Saving the annual report changed the ledger',
    );
    report.checks.actualOriginalAnnualSafExcelTwelveMatches = true;
    report.checks.annualReportSavedRedactedWithoutMutation = true;
    report.annualExcelStatus = 'actual original export matched all twelve records';
    await comparison.getByRole('button', { name: '关闭年度对账', exact: true }).click();
  }

  phase = 'full-backup-with-original-metadata';
  const beforeBackup = await read();
  await openData(page);
  await active(page)
    .getByRole('button', { name: /^导出完整备份/ })
    .click();
  const backup = page.getByRole('dialog', { name: '完整账本备份', exact: true });
  await backup.getByLabel('使用密码加密', { exact: true }).uncheck();
  await backup.getByRole('button', { name: '生成并保存备份', exact: true }).click();
  const backupName = `fixture-db-metadata-${runId}.jzbackup`;
  await saveSystemFile(backupName);
  await expect(backup.getByText('完整备份已保存，并通过写入校验。', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const backupPath = path.join(output, backupName);
  adb('pull', `/sdcard/Download/${backupName}`, backupPath);
  const backupBytes = fs.readFileSync(backupPath),
    envelope = JSON.parse(backupBytes.toString('utf8'));
  check(
    envelope.format === 'jizhang-jianjie2-backup' && envelope.encryption === 'none',
    'Saved full backup format was not expected',
  );
  check(
    same(envelope.data, parse(beforeBackup)),
    'Saved full backup differs from the complete current state',
  );
  check(
    envelope.integrity?.algorithm === 'SHA-256' &&
      envelope.integrity.digest ===
        sha256(
          canonical({
            format: envelope.format,
            version: envelope.version,
            createdAt: envelope.createdAt,
            encryption: envelope.encryption,
            data: envelope.data,
          }),
        ),
    'Saved full backup integrity did not verify',
  );
  verifyImportedState(envelope.data, bookId);
  check((await read()).data === beforeBackup.data, 'Full backup export changed persisted state');
  report.backupSha256 = sha256(backupBytes);
  report.backupBytes = backupBytes.length;
  report.checks.safFullBackupAllStateAndOriginalMetadataVerified = true;
  await backup.getByRole('button', { name: '关闭备份面板', exact: true }).click();
  await backHome(page);
  after = parse(await read());
  previousContentPreserved(before, after);
  report.finalSnapshotSha256 = (await read()).sha256;
  report.dbChecksComplete = true;
  report.complete = Boolean(annual);
  saveReport();
  console.log(JSON.stringify(report));
} catch (error) {
  report.complete = false;
  report.failurePhase = phase;
  // Keep terminal/report output free of source row values or assertion dumps.
  report.failure = error instanceof Error ? error.name : 'NativeVerificationError';
  saveReport();
  try {
    await page?.screenshot({ path: path.join(output, `failure-${runId}.png`) });
  } catch {}
  try {
    adb('shell', 'screencap', '-p', '/sdcard/fixture-db-migration-failure.png');
    adb(
      'pull',
      '/sdcard/fixture-db-migration-failure.png',
      path.join(output, `system-failure-${runId}.png`),
    );
  } catch {}
  throw new Error(
    `Fictional DB verification failed during ${phase}; see the local summary and screenshot`,
  );
} finally {
  if (browser) await browser.close();
}
