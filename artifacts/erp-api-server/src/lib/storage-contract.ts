import type { Readable, Writable } from "node:stream";

export interface StoredFile {
  name: string;
  metadata: { size?: string | number; timeCreated?: string; contentType?: string };
  getMetadata(): Promise<[StoredFile["metadata"], ...unknown[]]>;
  save(data: Buffer, options?: { contentType?: string }): Promise<unknown>;
  exists(): Promise<[boolean]>;
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>;
  createReadStream(): Readable;
  createWriteStream(options?: {
    contentType?: string;
    resumable?: boolean;
    overwrite?: boolean;
    metadata?: { metadata?: Record<string, string> };
  }): Writable;
}

export interface FileStorage {
  bucket(id: string): {
    file(path: string): StoredFile;
    getFiles(options: { prefix: string }): Promise<[StoredFile[], ...unknown[]]>;
  };
}
