import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BACKUP_FILE_BYTES } from './codec';

const bridge = vi.hoisted(() => ({ native: vi.fn(), saveDocument: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: bridge.native },
  registerPlugin: () => ({ saveDocument: bridge.saveDocument }),
}));

import { backupFileName, exactMoney, readBackupFile, saveTextFile } from './files';

beforeEach(() => {
  bridge.native.mockReset().mockReturnValue(false);
  bridge.saveDocument.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('用户选择的完整备份文件', () => {
  it('读取UTF-8原文件，保留Unicode与换行', async () => {
    const text = '{"fictional":"早餐☕\n第二行"}';
    const file = new File([text], '虚构备份.jzbackup', { type: 'application/json' });
    expect(await readBackupFile(file)).toBe(text);
  });

  it('在读取前拒绝旧版Excel、空文件和过大的文件', async () => {
    const read = vi.fn();
    for (const input of [
      { name: 'private.xls', size: 10, arrayBuffer: read },
      { name: 'empty.json', size: 0, arrayBuffer: read },
      { name: 'large.jzbackup', size: MAX_BACKUP_FILE_BYTES + 1, arrayBuffer: read },
    ])
      await expect(readBackupFile(input as unknown as File)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('拒绝无效UTF-8，不用替换字符修复损坏内容', async () => {
    const file = new File([new Uint8Array([0xff, 0xfe, 0xfd])], 'broken.jzbackup');
    await expect(readBackupFile(file)).rejects.toThrow('UTF-8');
  });
});

describe('文件保存交接', () => {
  it('等待安卓原生完成，取消不能当成保存成功', async () => {
    bridge.native.mockReturnValue(true);
    let finish!: (value: { cancelled: boolean }) => void;
    bridge.saveDocument.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    let settled = false;
    const saving = saveTextFile('虚构内容', 'fixture.jzbackup').then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish({ cancelled: true });
    expect(await saving).toEqual({ cancelled: true, delivery: 'document' });
    expect(bridge.saveDocument).toHaveBeenCalledWith({
      content: '虚构内容',
      fileName: 'fixture.jzbackup',
      mimeType: 'application/json',
    });
  });

  it('只在原生返回明确成功时确认文件，并支持本地CSV错误报告', async () => {
    bridge.native.mockReturnValue(true);
    bridge.saveDocument.mockResolvedValue({ cancelled: false });
    expect(await saveTextFile('row,error\n2,invalid', 'issues.csv', 'text/csv')).toEqual({
      cancelled: false,
      delivery: 'document',
    });
    expect(bridge.saveDocument).toHaveBeenCalledWith({
      content: 'row,error\n2,invalid',
      fileName: 'issues.csv',
      mimeType: 'text/csv',
    });
  });

  it('原生错误或非法回执只给出无隐私值的失败消息', async () => {
    bridge.native.mockReturnValue(true);
    bridge.saveDocument.mockRejectedValueOnce(new Error('PRIVATE-VALUE-MUST-NOT-ESCAPE'));
    await expect(saveTextFile('虚构内容', 'fixture.json')).rejects.not.toThrow('PRIVATE-VALUE');
    bridge.saveDocument.mockResolvedValue({});
    await expect(saveTextFile('虚构内容', 'fixture.json')).rejects.toThrow('未保存成功');
  });

  it('浏览器创建下载但不宣称原生文件已写入，并延迟释放Blob', async () => {
    vi.useFakeTimers();
    const anchor = { href: '', download: '', hidden: false, click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal('document', { createElement: () => anchor, body: { append } });
    vi.stubGlobal('window', { setTimeout });
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fictional-backup');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    expect(await saveTextFile('虚构内容', 'fixture.json')).toEqual({
      cancelled: false,
      delivery: 'download',
    });
    expect(anchor.download).toBe('fixture.json');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(anchor);
    expect(createUrl).toHaveBeenCalledOnce();
    expect(revokeUrl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revokeUrl).toHaveBeenCalledWith('blob:fictional-backup');
  });

  it('拒绝目录注入、控制字符和不支持的类型', async () => {
    for (const name of ['../ledger.json', 'a\\b.json', 'a\nb.json', ''])
      await expect(saveTextFile('test', name)).rejects.toThrow('文件名');
    await expect(saveTextFile('test', 'fixture.json', 'text/html')).rejects.toThrow('文件类型');
    expect(bridge.saveDocument).not.toHaveBeenCalled();
  });
});

describe('备份显示辅助', () => {
  it('文件名使用本地日期时间并清楚区分加密', () => {
    expect(backupFileName(true, new Date(2026, 10, 8, 3, 9, 7))).toBe(
      '简洁记账-加密备份-20261108-030907.jzbackup',
    );
  });
  it('超出安全整数的合计仍精确显示到分', () => {
    expect(exactMoney('9100000000000001')).toBe('91,000,000,000,000.01');
    expect(exactMoney('1')).toBe('0.01');
    expect(exactMoney('-101')).toBe('−1.01');
  });
});
