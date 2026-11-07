import { registerPlugin } from '@capacitor/core';
import { RevisionConflictError, type SnapshotStorage, type StoredSnapshot } from './types';

interface LedgerStorePlugin {
  read(): Promise<{ snapshot: StoredSnapshot | null }>;
  write(options: { snapshot: StoredSnapshot; expectedRevision: number }): Promise<void>;
  history(): Promise<{ snapshots: StoredSnapshot[] }>;
}

const plugin = registerPlugin<LedgerStorePlugin>('LedgerStore');

export class NativeSqliteStorage implements SnapshotStorage {
  async read() {
    return (await plugin.read()).snapshot;
  }

  async write(snapshot: StoredSnapshot, expectedRevision: number) {
    try {
      await plugin.write({ snapshot, expectedRevision });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'REVISION_CONFLICT'
      ) {
        throw new RevisionConflictError();
      }
      throw new Error('账本未保存成功，当前数据尚未更改。请检查设备可用空间后再试。');
    }
  }

  async history() {
    return (await plugin.history()).snapshots;
  }
}
