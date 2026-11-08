import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';

const bridge = vi.hoisted(() => ({ native: vi.fn(), saveDocument: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: bridge.native },
  registerPlugin: () => ({ saveDocument: bridge.saveDocument }),
}));
import { saveBinaryFile } from '../backup/files';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
beforeEach(() => {
  bridge.native.mockReset().mockReturnValue(true);
  bridge.saveDocument.mockReset().mockResolvedValue({ cancelled: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('二进制保存不经过UTF-8文本转换', () => {
  it('正确传递任意字节与跨Base64分块长度', async () => {
    for (const size of [1, 2, 3, 24575, 24576, 24577]) {
      const bytes = Uint8Array.from({ length: size }, (_, index) => index % 256);
      const result = await saveBinaryFile(bytes, 'fixture.xlsx', MIME);
      expect(result).toEqual({ cancelled: false, delivery: 'document' });
      const options = bridge.saveDocument.mock.calls.at(-1)![0];
      expect(options.encoding).toBe('base64');
      expect(Buffer.from(options.content, 'base64')).toEqual(Buffer.from(bytes));
      expect(options.mimeType).toBe(MIME);
    }
  });
  it('取消和原生失败不会被误当成已保存', async () => {
    bridge.saveDocument.mockResolvedValueOnce({ cancelled: true });
    expect(
      await saveBinaryFile(new Uint8Array([0, 255]), 'fixture.xls', 'application/vnd.ms-excel'),
    ).toEqual({ cancelled: true, delivery: 'document' });
    bridge.saveDocument.mockRejectedValueOnce(new Error('DO-NOT-EXPOSE-BINARY-PAYLOAD'));
    await expect(saveBinaryFile(new Uint8Array([1]), 'fixture.xlsx', MIME)).rejects.not.toThrow(
      'DO-NOT-EXPOSE',
    );
  });
  it('Web Blob保留原始字节、MIME和文件名，仅确认下载已发起', async () => {
    bridge.native.mockReturnValue(false);
    vi.useFakeTimers();
    const anchor = { href: '', download: '', hidden: false, click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => anchor, body: { append: vi.fn() } });
    vi.stubGlobal('window', { setTimeout });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fictional-binary');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const bytes = new Uint8Array([0, 255, 128, 1, 13, 10]);
    expect(await saveBinaryFile(bytes, 'fixture.xlsx', MIME)).toEqual({
      cancelled: false,
      delivery: 'download',
    });
    const blob = create.mock.calls[0][0] as Blob;
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(blob.type).toBe(MIME);
    expect(anchor.download).toBe('fixture.xlsx');
    expect(anchor.click).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:fictional-binary');
  });
});
