import { Capacitor } from '@capacitor/core';
import { createEmptyState, validateState, type LedgerState } from '../core/model';
import { IndexedDbStorage } from './indexed-db';
import { NativeSqliteStorage } from './native';
import {
  RevisionConflictError,
  StorageIntegrityError,
  type SnapshotStorage,
  type StoredSnapshot,
} from './types';

export interface LoadedLedger {
  state: LedgerState;
  revision: number;
  savedAt: string;
}

const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function pack(state: LedgerState, revision: number): Promise<StoredSnapshot> {
  validateState(state);
  const data = JSON.stringify(state);
  if (new TextEncoder().encode(data).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error('账本超过当前版本支持的 64 MB，请先导出备份并按账本拆分。');
  }
  return { revision, data, sha256: await sha256(data), savedAt: new Date().toISOString() };
}

export async function unpack(snapshot: StoredSnapshot): Promise<LoadedLedger> {
  try {
    if (
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 1 ||
      snapshot.revision >= 2147483647 ||
      typeof snapshot.savedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T/.test(snapshot.savedAt) ||
      !Number.isFinite(Date.parse(snapshot.savedAt)) ||
      typeof snapshot.data !== 'string' ||
      new TextEncoder().encode(snapshot.data).byteLength > MAX_SNAPSHOT_BYTES ||
      !/^[a-f0-9]{64}$/.test(snapshot.sha256) ||
      (await sha256(snapshot.data)) !== snapshot.sha256
    ) {
      throw new StorageIntegrityError();
    }
    const state: unknown = JSON.parse(snapshot.data);
    validateState(state);
    return { state, revision: snapshot.revision, savedAt: snapshot.savedAt };
  } catch (error) {
    if (error instanceof StorageIntegrityError) throw error;
    throw new StorageIntegrityError('账本格式或关系校验未通过。原数据已保留，不会自动清空。');
  }
}

/** All mutations are serialized and only become visible after an atomic durable commit. */
export class LedgerRepository {
  private current: LoadedLedger | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly storage: SnapshotStorage) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async readCurrent(): Promise<LoadedLedger> {
    const existing = await this.storage.read();
    if (existing) return unpack(existing);
    const initial = await pack(createEmptyState(), 1);
    try {
      await this.storage.write(initial, 0);
      return unpack(initial);
    } catch (error) {
      if (!(error instanceof RevisionConflictError)) throw error;
      const raced = await this.storage.read();
      if (!raced) throw error;
      return unpack(raced);
    }
  }

  load(): Promise<LoadedLedger> {
    return this.enqueue(async () => {
      this.current = await this.readCurrent();
      return structuredClone(this.current);
    });
  }

  mutate(
    operation: (state: LedgerState) => LedgerState | Promise<LedgerState>,
  ): Promise<LoadedLedger> {
    return this.enqueue(async () => {
      const before = this.current ?? (await this.readCurrent());
      const next = await operation(structuredClone(before.state));
      const snapshot = await pack(next, before.revision + 1);
      try {
        await this.storage.write(snapshot, before.revision);
      } catch (error) {
        if (error instanceof RevisionConflictError) this.current = null;
        throw error;
      }
      this.current = {
        state: structuredClone(next),
        revision: snapshot.revision,
        savedAt: snapshot.savedAt,
      };
      return structuredClone(this.current);
    });
  }

  replace(state: LedgerState): Promise<LoadedLedger> {
    validateState(state);
    const copy = structuredClone(state);
    return this.mutate(() => copy);
  }

  async recoveryPoints(): Promise<LoadedLedger[]> {
    await this.queue;
    const results: LoadedLedger[] = [];
    for (const snapshot of await this.storage.history()) {
      try {
        results.push(await unpack(snapshot));
      } catch {
        /* A corrupt history point is never offered as recoverable. */
      }
    }
    return results;
  }

  recover(revision: number): Promise<LoadedLedger> {
    return this.enqueue(async () => {
      const history = await this.storage.history();
      const selected = history.find((snapshot) => snapshot.revision === revision);
      if (!selected) throw new Error('该保存点已不存在，请重新载入恢复列表。');
      const recovered = await unpack(selected);
      const current = await this.storage.read();
      if (!current || !Number.isSafeInteger(current.revision) || current.revision < 1)
        throw new StorageIntegrityError();
      const next = await pack(recovered.state, current.revision + 1);
      await this.storage.write(next, current.revision);
      this.current = { ...recovered, revision: next.revision, savedAt: next.savedAt };
      return structuredClone(this.current);
    });
  }

  async close() {
    await this.queue;
    await this.storage.close?.();
    this.current = null;
  }
}

export function createRepository() {
  return new LedgerRepository(
    Capacitor.isNativePlatform() ? new NativeSqliteStorage() : new IndexedDbStorage(),
  );
}
