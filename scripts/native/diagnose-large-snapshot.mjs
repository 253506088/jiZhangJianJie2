// Destructive ONLY to the named project test AVD's fabricated ledger. Never targets a phone.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.join(root,'.tools/native-test');
const adbPath=path.join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe');
const adb=(...args)=>execFileSync(adbPath,['-P','5051','-s','emulator-5586',...args],{encoding:'utf8',timeout:20000});
if(!adb('emu','avd','name').split(/\r?\n/).map(line=>line.trim()).includes('jianjie_verify36'))throw new Error('Unknown test device');
const pid=adb('shell','pidof','dev.keepaccounts.jianjie2').trim();
if(!/^\d+$/.test(pid))throw new Error('Test app not running');
adb('forward','tcp:9238',`localabstract:webview_devtools_remote_${pid}`);
const browser=await chromium.connectOverCDP('http://127.0.0.1:9238',{noDefaults:true,artifactsDir:output});
try{
  const page=browser.contexts().flatMap(context=>context.pages()).find(page=>/^https?:\/\/localhost\//.test(page.url()));
  if(!page)throw new Error('No project WebView');
  const previous=await page.evaluate(()=>window.Capacitor.nativePromise('LedgerStore','read',{}));
  const original=JSON.parse(previous.snapshot.data);
  if(original.transactions.length!==2||original.schemaVersion!==1)throw new Error('Requires the known two-record v1 fixture baseline');
  fs.writeFileSync(path.join(output,'large-test-original.json'),JSON.stringify(previous.snapshot));
  const large=structuredClone(original);
  large.imports=[];
  large.transactions=Array.from({length:10000},(_,index)=>{
    const item={...original.transactions[0],id:`native-large-${index}`,note:`Native fixture ${index} · 完全虚构性能测试 🔖`};
    delete item.source;
    return item;
  });
  const data=JSON.stringify(large);
  const next={revision:previous.snapshot.revision+1,savedAt:new Date().toISOString(),data,sha256:createHash('sha256').update(data).digest('hex')};
  const bytes=Buffer.byteLength(data);
  if(bytes<2.5*1024*1024)throw new Error('Fixture is too small to test CursorWindow boundaries');
  await page.evaluate(({snapshot,expectedRevision})=>window.Capacitor.nativePromise('LedgerStore','write',{snapshot,expectedRevision}),{snapshot:next,expectedRevision:previous.snapshot.revision});
  let result;
  try{const value=await page.evaluate(()=>window.Capacitor.nativePromise('LedgerStore','read',{}));result={readSucceeded:true,transactions:JSON.parse(value.snapshot.data).transactions.length};}
  catch(error){result={readSucceeded:false,error:String(error.message)};}
  const report={purpose:'fabricated large native ledger',bytes,revision:next.revision,sha256:next.sha256,...result};
  fs.writeFileSync(path.join(output,'large-read-diagnostic.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{await browser.close();}
