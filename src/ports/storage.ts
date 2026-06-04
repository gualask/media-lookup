export interface StoragePutOptions {
  ttlSeconds?: number;
}

export interface StoragePort {
  getText(key: string): Promise<string | null>;
  putText(key: string, value: string, options?: StoragePutOptions): Promise<void>;
}
