export interface StoredSnapshot {
  revision: number;
  savedAt: string;
  data: string;
  sha256: string;
}

export interface SnapshotStorage {
  read(): Promise<StoredSnapshot | null>;
  write(snapshot: StoredSnapshot, expectedRevision: number): Promise<void>;
  history(): Promise<StoredSnapshot[]>;
  close?(): Promise<void>;
}

export class RevisionConflictError extends Error {
  readonly code = 'REVISION_CONFLICT';
  constructor() {
    super('账本已在另一个窗口更新，请重新载入后再试。');
    this.name = 'RevisionConflictError';
  }
}

export class StorageIntegrityError extends Error {
  readonly code = 'STORAGE_INTEGRITY';
  constructor(message = '本地账本校验未通过。原数据已保留，请从历史保存点或备份恢复。') {
    super(message);
    this.name = 'StorageIntegrityError';
  }
}
