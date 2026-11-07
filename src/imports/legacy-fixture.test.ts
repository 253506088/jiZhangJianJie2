import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readWorkbookBytes } from './workbook';
import { autoMapping } from './mapping';
import { prepareImport } from './plan';

const path=new URL('../../tests/fixtures/legacy-4.8.8-two-expenses.xls',import.meta.url);
const bytes=readFileSync(path);
const digest=createHash('sha256').update(bytes).digest('hex');

describe('未修改原App导出的完全虚构文件',()=>{
  it('固定输入身份和OLE/BIFF容器保持原样',()=>{
    expect(bytes.length).toBe(13824);
    expect(digest).toBe('7d523af1fdfc2d5a0ce09db52f9a57a9a3aae883a7c78bbe7c06b2d442d3ed7b');
    expect(bytes.subarray(0,8).toString('hex')).toBe('d0cf11e0a1b11ae1');
  });
  it('读取四张原工作表和第3行的实际表头，成员仍在原始行中',()=>{
    const workbook=readWorkbookBytes(Uint8Array.from(bytes).buffer,'legacy.xls');
    expect(workbook.sheets.map(sheet=>sheet.name)).toEqual(['支出','收入','转账','借贷']);
    expect(workbook.sheets[0].rows[2]).toEqual(['金额','支出大类','支出小类','账户','时间','成员','备注']);
    expect(workbook.sheets[0].rows[3]).toEqual(['10.00','FixtureFood','FixtureBreakfast','现金','2026-11-07 19:28','自己','']);
    expect(workbook.sheets[1].rows[2]).toContain('收入类别');
    expect(workbook.sheets[2].rows[2]).toContain('转账类型');
    expect(workbook.sheets[3].rows[2]).toContain('借贷人');
  });
  it('现有解析器准确读取两笔支出的金额、路径和分钟，不把元信息当流水',()=>{
    const workbook={...readWorkbookBytes(Uint8Array.from(bytes).buffer,'legacy.xls'),digest};
    const mappings=workbook.sheets.map(autoMapping);
    expect(mappings.map(mapping=>mapping.headerRow)).toEqual([3,3,3,3]);
    const plan=prepareImport(workbook,mappings);
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(2);
    expect(plan.totals.expense).toBe(2000);
    expect(plan.rows[0]).toMatchObject({primary:'FixtureFood',secondary:'FixtureBreakfast',amountCents:1000,date:'2026-11-07',time:'19:28:00'});
  });
});
