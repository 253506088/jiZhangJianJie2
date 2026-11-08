import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { RevisionConflictError, type SnapshotStorage, type StoredSnapshot } from './types';

interface LedgerDatabase extends DBSchema {
  current: { key: string; value: StoredSnapshot };
  history: { key: number; value: StoredSnapshot };
}

/** Web storage; Android uses the private SQLite plugin through the same contract. */
export class IndexedDbStorage implements SnapshotStorage {
  private database: Promise<IDBPDatabase<LedgerDatabase>>;

  constructor(name = 'jizhang-jianjie2-production') {
    this.database = openDB<LedgerDatabase>(name, 1, {
      upgrade(database) {
        database.createObjectStore('current');
        database.createObjectStore('history', { keyPath: 'revision' });
      },
      blocking: () => {
        void this.database.then((database) => database.close());
      },
    });
  }

  async read() {
    return (await (await this.database).get('current', 'ledger')) ?? null;
  }

  async write(snapshot: StoredSnapshot, expectedRevision: number) {
    if (snapshot.revision !== expectedRevision + 1) throw new RevisionConflictError();
    const database = await this.database;
    const transaction = database.transaction(['current', 'history'], 'readwrite', {
      durability: 'strict',
    });
    const currentStore = transaction.objectStore('current');
    const previous = await currentStore.get('ledger');
    if ((previous?.revision ?? 0) !== expectedRevision) {
      transaction.abort();
      await transaction.done.catch(() => undefined);
      throw new RevisionConflictError();
    }
    if (previous) await transaction.objectStore('history').put(previous);
    await currentStore.put(snapshot, 'ledger');
    const revisions = await transaction.objectStore('history').getAllKeys();
    for (const revision of revisions.slice(0, Math.max(0, revisions.length - 3))) {
      await transaction.objectStore('history').delete(revision);
    }
    await transaction.done;
  }

  async history() {
    return (await (await this.database).getAll('history')).sort((a, b) => b.revision - a.revision);
  }

  async historyHeaders() {
    const headers = [];
    let cursor = await (await this.database).transaction('history').store.openCursor(null, 'prev');
    while (cursor) {
      const { revision, savedAt, sha256, data } = cursor.value;
      headers.push({ revision, savedAt, sha256, bytes: new TextEncoder().encode(data).byteLength });
      cursor = await cursor.continue();
    }
    return headers;
  }

  async readHistory(revision: number) {
    return (await (await this.database).get('history', revision)) ?? null;
  }

  async close() {
    (await this.database).close();
  }
}
