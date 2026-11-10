import { describe, expect, it } from 'vitest';
import { createEmptyState, updateSettings, validateState } from './index';
import { MAX_BACKGROUND_BYTES, validHomeBackground } from './home-background';
import { decodeBackup, encodeBackup } from '../backup/codec';

const gif =
  'R0lGODlhUAAoAIEAAGm90QAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAGQAAACwAAAAAUAAoAAAIXQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTpygDAgAh+QQAGQAAACwAAAAAUAAoAIHvoFsAAAAAAAAAAAAIXQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTpygDAgA7';
describe('首页背景保真与模型校验', () => {
  it('旧账本无背景时可读，动图原字节经过备份恢复保持相同', async () => {
    const empty = createEmptyState();
    validateState(empty);
    const state = updateSettings(empty, {
      homeBackground: { dataUrl: `data:image/gif;base64,${gif}`, fit: 'contain' },
    });
    const restored = await decodeBackup(await encodeBackup(state));
    expect(restored.state).toEqual(state);
    expect(updateSettings(state, { homeBackground: null }).settings.homeBackground).toBeNull();
  });
  it('拒绝远程地址、SVG、伪装类型、无效数据和超限图片', () => {
    for (const dataUrl of [
      'https://example.com/image.gif',
      'data:image/svg+xml;base64,PHN2Zz4=',
      `data:image/png;base64,${gif}`,
      'data:image/gif;base64,***=',
      `data:image/gif;base64,${'A'.repeat(Math.ceil(MAX_BACKGROUND_BYTES / 3) * 4 + 4)}`,
    ]) {
      expect(validHomeBackground({ dataUrl, fit: 'cover' })).toBe(false);
      expect(() =>
        updateSettings(createEmptyState(), { homeBackground: { dataUrl, fit: 'cover' } }),
      ).toThrow();
    }
  });
});
