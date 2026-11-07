import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { IndexedDbStorage } from './indexed-db';
import { LedgerRepository, unpack } from './repository';
import {
  RevisionConflictError,
  StorageIntegrityError,
  type SnapshotStorage,
  type StoredSnapshot,
} from './types';

const repositories: LedgerRepository[] = [];
function repository(name = crypto.randomUUID()) {
  const storage = new IndexedDbStorage(name);
  const result = new LedgerRepository(storage);
  repositories.push(result);
  return result;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.close()));
});

describe('正式账本持久化', () => {
  it('首次启动为空账本，重新打开保留保存结果', async () => {
    const name = crypto.randomUUID();
    const first = repository(name);
    const initial = await first.load();
    expect(initial.state.transactions).toEqual([]);
    expect(initial.state.categories).toEqual([]);
    expect(initial.state.books).toHaveLength(1);
    const saved = await first.mutate((state) => ({
      ...state,
      settings: { ...state.settings, theme: 'dark' },
    }));
    await first.close();
    const second = repository(name);
    expect(await second.load()).toEqual(saved);
  });

  it('调用者拿到独立副本，未提交的更改不污染内存或数据库', async () => {
    const store = repository();
    const loaded = await store.load();
    loaded.state.books[0].name = '未提交的变更';
    expect((await store.load()).state.books[0].name).not.toBe('未提交的变更');
  });

  it('并行操作按顺序保存，不丢失先完成的修改', async () => {
    const store = repository();
    await store.load();
    await Promise.all([
      store.mutate(async (state) => ({ ...state, settings: { ...state.settings, theme: 'dark' } })),
      store.mutate((state) => {
        state.books[0].name = '家庭账本';
        return state;
      }),
    ]);
    const final = await store.load();
    expect(final.state.settings.theme).toBe('dark');
    expect(final.state.books[0].name).toBe('家庭账本');
    expect(final.revision).toBe(3);
  });

  it('第二窗口的陈旧写入被拒绝，不能覆盖第一窗口的新数据', async () => {
    const name = crypto.randomUUID();
    const first = repository(name);
    const second = repository(name);
    await first.load();
    await second.load();
    await first.mutate((state) => {
      state.books[0].name = '已保存';
      return state;
    });
    await expect(
      second.mutate((state) => {
        state.books[0].name = '旧窗口覆盖';
        return state;
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    expect((await second.load()).state.books[0].name).toBe('已保存');
  });

  it('磁盘写入失败不会给出保存成功，也不会改变原数据', async () => {
    const backing = new IndexedDbStorage(crypto.randomUUID());
    let fail = false;
    const adapter: SnapshotStorage = {
      read: () => backing.read(),
      history: () => backing.history(),
      close: () => backing.close(),
      write: (snapshot, revision) =>
        fail ? Promise.reject(new Error('模拟磁盘已满')) : backing.write(snapshot, revision),
    };
    const store = new LedgerRepository(adapter);
    repositories.push(store);
    const before = await store.load();
    fail = true;
    await expect(
      store.mutate((state) => {
        state.books[0].name = '失败写入';
        return state;
      }),
    ).rejects.toThrow('模拟磁盘已满');
    expect(await store.load()).toEqual(before);
  });

  it('损坏的数据不会被静默替换为空账本，可显式恢复有效保存点', async () => {
    const name = crypto.randomUUID();
    const store = repository(name);
    await store.load();
    await store.mutate((state) => ({ ...state, settings: { ...state.settings, theme: 'dark' } }));
    await store.mutate((state) => ({ ...state, settings: { ...state.settings, theme: 'light' } }));
    const database = await openDB(name);
    const current = (await database.get('current', 'ledger')) as StoredSnapshot;
    await database.put('current', { ...current, data: 'damaged' }, 'ledger');
    database.close();
    await expect(store.load()).rejects.toBeInstanceOf(StorageIntegrityError);
    expect((await store.storage.read())?.data).toBe('damaged');
    const recovery = await store.recoveryPoints();
    expect(recovery.some((point) => point.state.settings.theme === 'dark')).toBe(true);
    const restored = await store.recover(
      recovery.find((point) => point.state.settings.theme === 'dark')!.revision,
    );
    expect(restored.state.settings.theme).toBe('dark');
    expect((await store.load()).revision).toBe(4);
  });

  it('保留最近3个历史保存点，并验证结构与摘要', async () => {
    const store = repository();
    await store.load();
    for (let index = 0; index < 5; index++)
      await store.mutate((state) => {
        state.books[0].name = `账本${index}`;
        return state;
      });
    expect((await store.recoveryPoints()).map((point) => point.revision)).toEqual([5, 4, 3]);
    const snapshot = (await store.storage.read())!;
    await expect(unpack({ ...snapshot, sha256: '0'.repeat(64) })).rejects.toBeInstanceOf(
      StorageIntegrityError,
    );
    await expect(unpack({ ...snapshot, savedAt: 'invalid-date' })).rejects.toBeInstanceOf(
      StorageIntegrityError,
    );
  });
});
