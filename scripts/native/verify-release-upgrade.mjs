// Restricted by mumu-device.mjs to this project's fictional-data VM 1.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { adb, appId, connect, root } from './mumu-device.mjs';

const output = path.join(root, '.tools/release-1.1.0');
fs.mkdirSync(output, { recursive: true });
const expectedPath = path.join(output, 'expected-state.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { fictionalDataOnly: true, version: '1.1.0', checks: {} };
if (process.argv.includes('--capture')) {
  const { browser, page } = await connect();
  try {
    const snapshot = await page.evaluate(
      async () => (await window.Capacitor.nativePromise('LedgerStore', 'read', {})).snapshot,
    );
    const state = JSON.parse(snapshot.data);
    assert(
      state.imports.some((batch) => batch.legacyDb),
      'Expected the fictional DB migration first',
    );
    assert(state.settings.homeBackground, 'Expected the fictional animated background first');
    fs.writeFileSync(expectedPath, JSON.stringify(state));
    fs.writeFileSync(
      path.join(output, 'baseline.json'),
      JSON.stringify({ sha256: hash(snapshot.data), records: state.transactions.length }, null, 2),
    );
    console.log(JSON.stringify({ captured: true, records: state.transactions.length }));
  } finally {
    await browser.close();
  }
} else {
  const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
  const apk = path.join(root, 'artifacts/jizhang-jianjie2-release.apk');
  report.apkSha256 = hash(fs.readFileSync(apk));
  if (process.argv.includes('--install')) adb('install', '-r', apk);
  const packagePath = adb('shell', 'pm', 'path', appId)
    .trim()
    .replace(/^package:/, '');
  assert(packagePath.endsWith('/base.apk') && !packagePath.includes('\n'));
  const installed = path.join(output, 'installed-release.apk');
  adb('pull', packagePath, installed);
  assert.equal(hash(fs.readFileSync(installed)), report.apkSha256);
  const info = adb('shell', 'dumpsys', 'package', appId);
  assert(!/\bDEBUGGABLE\b/.test(info), 'Release must not be debuggable');
  assert(!info.includes('android.permission.INTERNET'), 'Release must stay offline');
  assert(info.includes('versionName=1.1.0'));
  report.checks.installedReleaseIdentityAndOffline = true;
  for (let index = 0; index < 3; index++) {
    adb('shell', 'am', 'force-stop', appId);
    adb('shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`);
    await delay(700);
    assert(/^\d+$/.test(adb('shell', 'pidof', appId).trim()));
  }
  report.checks.threeColdStarts = true;
  const captureId = Date.now();
  let serial = 0;
  function hierarchy() {
    const remote = `/sdcard/fixture-release-ui-${captureId}-${++serial}.xml`;
    adb('shell', 'uiautomator', 'dump', remote);
    const xml = adb('shell', 'cat', remote);
    return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) =>
      Object.fromEntries(
        [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
      ),
    );
  }
  function tap(node) {
    const [x1, y1, x2, y2] = node.bounds.match(/\d+/g).map(Number);
    adb(
      'shell',
      'input',
      'tap',
      String(Math.round((x1 + x2) / 2)),
      String(Math.round((y1 + y2) / 2)),
    );
  }
  async function find(predicate, scroll = false) {
    for (let attempt = 0; attempt < 20; attempt++) {
      let nodes;
      try {
        nodes = hierarchy();
      } catch {
        await delay(300);
        continue;
      }
      const visible = nodes.filter((node) => {
        const bounds = node.bounds?.match(/\d+/g)?.map(Number);
        return bounds?.length === 4 && bounds[2] > bounds[0] && bounds[3] > bounds[1];
      });
      const found = visible.find(predicate);
      if (found) return found;
      if (scroll) {
        const view = visible.find((node) => node.class === 'android.webkit.WebView');
        if (view) {
          const [x1, y1, x2, y2] = view.bounds.match(/\d+/g).map(Number);
          const x = Math.round((x1 + x2) / 2);
          adb(
            'shell',
            'input',
            'swipe',
            String(x),
            String(Math.round(y1 + (y2 - y1) * 0.78)),
            String(x),
            String(Math.round(y1 + (y2 - y1) * 0.3)),
            '400',
          );
        }
      }
      await delay(250);
    }
    throw new Error('Expected release/system control not found');
  }
  try {
    tap(
      await find(
        (node) =>
          node.text === '数据与设置' ||
          node['content-desc'] === '数据与设置' ||
          node.text === '更多',
      ),
    );
    tap(await find((node) => /^导出完整备份(?:\s|$)/.test(node.text), true));
    const encryption = await find(
      (node) => node.class === 'android.widget.CheckBox' && node.text === '使用密码加密',
      true,
    );
    if (encryption.checked === 'true') tap(encryption);
    tap(await find((node) => node.text === '生成并保存备份', true));
    tap(
      await find(
        (node) => node.class === 'android.widget.EditText' && /documentsui/.test(node.package),
      ),
    );
    adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END', ...Array(100).fill('KEYCODE_DEL'));
    const name = `fixture-release-${Date.now()}.jzbackup`;
    adb('shell', 'input', 'text', name);
    tap(await find((node) => /^(保存|SAVE|Save)$/.test(node.text) && node.enabled === 'true'));
    await find((node) => /完整备份已保存，并通过写入校验/.test(node.text), true);
    const destination = path.join(output, name);
    adb('pull', `/sdcard/Download/${name}`, destination);
    const backup = JSON.parse(fs.readFileSync(destination, 'utf8'));
    assert.equal(backup.encryption, 'none');
    assert(
      isDeepStrictEqual(backup.data, expected),
      'Release backup differs from the pre-upgrade state',
    );
    report.checks.safBackupEqualsEveryPreUpgradeField = true;
    report.checks.legacySourceAndAnimatedBackgroundPreserved = true;
    report.records = expected.transactions.length;
    report.backupSha256 = hash(fs.readFileSync(destination));
    report.complete = true;
    adb('shell', 'screencap', '-p', '/sdcard/fixture-release-result.png');
    adb('pull', '/sdcard/fixture-release-result.png', path.join(output, 'release-saved.png'));
  } catch (cause) {
    report.complete = false;
    report.failure =
      cause instanceof Error ? cause.message.split('\n')[0] : 'Release verification failed';
    throw cause;
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
