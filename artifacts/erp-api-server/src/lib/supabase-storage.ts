import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PassThrough, Readable, Writable } from "node:stream";
import type { FileStorage, StoredFile } from "./storage-contract";

export function supabaseStorageConfig(env = process.env) {
  const project = env.SUPABASE_PROJECT_REF || "kfmstyauifksaepahvrp";
  const key = env.SUPABASE_STORAGE_KEY || "";
  const bucket = env.SUPABASE_STORAGE_BUCKET || "erp-private";
  if (!/^[a-z]{20}$/.test(project) || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket) ||
      !(key.startsWith("sb_secret_") || key.startsWith("eyJ"))) {
    throw new Error("Supabase private storage configuration required");
  }
  return { url: `https://${project}.supabase.co`, key, bucket };
}

function objectKey(path: string): string {
  const key = path.replace(/^\/+/, "");
  if (!key || key.split("/").some(p => p === "." || p === "..") || /[\0\r\n]/.test(key)) {
    throw new Error("Invalid storage object path");
  }
  return key;
}

/** No upstream text or request URL: those may contain credentials or filenames. */
function storageFailure(status?: number) {
  return new Error(`Supabase private storage request failed${status ? ` (HTTP ${status})` : ""}`);
}

function missingObject(error: unknown): boolean {
  const e = error as { status?: number; originalError?: { status?: number } } | null;
  return [400, 404].includes(Number(e?.status ?? e?.originalError?.status));
}

export class SupabaseFileStorage implements FileStorage {
  readonly config: ReturnType<typeof supabaseStorageConfig>;
  private readonly client: SupabaseClient;

  constructor(env = process.env, private readonly fetcher: typeof fetch = fetch) {
    this.config = supabaseStorageConfig(env);
    this.client = createClient(this.config.url, this.config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: this.fetcher },
    });
  }

  /** Explicit migration/preflight call only; normal runtime never creates a bucket. */
  async verifyPrivateBucket(): Promise<void> {
    const { data, error } = await this.client.storage.getBucket(this.config.bucket);
    if (error || !data || data.public !== false) throw storageFailure();
  }

  private async request(method: string, path: string, body?: PassThrough, signal?: AbortSignal, overwrite = true) {
    const encodedPath = objectKey(path).split("/").map(encodeURIComponent).join("/");
    const url = `${this.config.url}/storage/v1/object/${this.config.bucket}/${encodedPath}`;
    try {
      const headers = new Headers({
          apikey: this.config.key, Authorization: `Bearer ${this.config.key}`,
      });
      if (body) {
        headers.set("Content-Type", "application/octet-stream");
        headers.set("x-upsert", String(overwrite));
      }
      const options = {
        method, signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
          : AbortSignal.timeout(120_000),
        headers,
        ...(body ? {
          body: Readable.toWeb(body, { strategy: {
            highWaterMark: 64 * 1024, size: chunk => chunk.byteLength,
          } }) as NonNullable<Parameters<typeof fetch>[1]>["body"],
          duplex: "half" as const,
        } : {}),
      };
      const response = await this.fetcher(url, options);
      if (!response.ok) {
        await response.body?.cancel();
        throw storageFailure(response.status);
      }
      return response;
    } catch (error) {
      if (error instanceof Error && /^Supabase private storage request failed/.test(error.message)) throw error;
      throw storageFailure();
    }
  }

  bucket(id: string) {
    if (id !== this.config.bucket) throw new Error("Unexpected storage bucket");
    return {
      file: (path: string): StoredFile => this.file(path),
      getFiles: async ({ prefix }: { prefix: string }): Promise<[StoredFile[]]> => {
        const wanted = objectKey(prefix);
        const root = wanted.endsWith("/") ? wanted.slice(0, -1) : wanted.split("/").slice(0, -1).join("/");
        const files: StoredFile[] = [];
        const walk = async (folder: string, depth: number): Promise<void> => {
          if (depth > 20 || files.length > 100_000) throw new Error("Storage listing limit exceeded");
          for (let offset = 0; ; offset += 1000) {
            const { data, error } = await this.client.storage.from(id).list(folder, {
              limit: 1000, offset, sortBy: { column: "name", order: "asc" },
            });
            if (error || !data) throw storageFailure();
            for (const item of data) {
              const path = `${folder ? folder + "/" : ""}${item.name}`;
              if (!item.id) { await walk(path, depth + 1); continue; }
              if (!path.startsWith(wanted)) continue;
              const file = this.file(path);
              file.metadata = {
                size: item.metadata?.size,
                timeCreated: item.created_at ?? undefined,
                contentType: item.metadata?.mimetype,
              };
              files.push(file);
            }
            if (data.length < 1000) break;
          }
        };
        await walk(root, 0);
        return [files];
      },
    };
  }

  private file(path: string): StoredFile {
    const name = objectKey(path);
    const store = this.client.storage.from(this.config.bucket);
    return {
      name, metadata: {},
      getMetadata: async () => {
        const { data, error } = await store.info(name);
        if (error || !data) throw storageFailure();
        return [{ size: data.size, timeCreated: data.createdAt, contentType: data.contentType }];
      },
      save: async (data, options) => {
        const { error } = await store.upload(name, data, { contentType: options?.contentType, upsert: true });
        if (error) throw storageFailure();
      },
      exists: async () => {
        try {
          const { data, error } = await store.exists(name);
          if (error && !missingObject(error)) throw storageFailure();
          return [data];
        } catch { throw storageFailure(); }
      },
      delete: async (options) => {
        if (!options?.ignoreNotFound) {
          const { data, error } = await store.exists(name).catch(() => { throw storageFailure(); });
          if (error || !data) throw storageFailure();
        }
        const { error } = await store.remove([name]);
        if (error) throw storageFailure();
      },
      createReadStream: () => {
        const request = this.request.bind(this);
        return Readable.from((async function* () {
          const response = await request("GET", name);
          if (!response.body) throw storageFailure();
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              yield Buffer.from(value);
            }
          } finally { await reader.cancel().catch(() => undefined); }
        })());
      },
      createWriteStream: (options) => {
        const input = new PassThrough();
        const abort = new AbortController();
        let uploaded: Promise<void> | undefined;
        const startUpload = () => {
          if (!uploaded) {
            // pg_dump can spend a long time reading remote catalogs before its
            // first byte. Do not consume the HTTP upload deadline while idle.
            uploaded = this.request("POST", name, input, abort.signal, options?.overwrite ?? true)
              .then(async response => { await response.body?.cancel(); });
            void uploaded.catch(error => output.destroy(error));
          }
          return uploaded;
        };
        const output = new Writable({
          write(chunk, _encoding, callback) { startUpload(); input.write(chunk, callback); },
          final(callback) {
            const remote = startUpload();
            input.end();
            void remote.then(() => callback(), error => callback(error));
          },
          destroy(error, callback) { abort.abort(); input.destroy(); callback(error); },
        });
        // finish must mean remote upload success, not merely buffered input.
        input.on("error", error => output.destroy(error));
        return output;
      },
    };
  }
}
