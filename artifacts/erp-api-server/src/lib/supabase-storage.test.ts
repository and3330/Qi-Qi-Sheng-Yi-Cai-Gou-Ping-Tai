import { describe, it, expect, vi } from "vitest";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { SupabaseFileStorage, supabaseStorageConfig } from "./supabase-storage";

const env = { SUPABASE_STORAGE_KEY: "sb_secret_unit_test_only_not_a_real_key" };
const bucket = "erp-private";
function fakeFetch(run: (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => Promise<Response>) {
  return vi.fn(async (url, init = {}) => run(String(url), init)) as unknown as typeof fetch;
}
describe("Supabase private storage", () => {
  it("rejects public keys, invalid project/bucket, and unsafe object paths", () => {
    expect(() => supabaseStorageConfig({ SUPABASE_STORAGE_KEY: "sb_publishable_test" })).toThrow();
    expect(() => supabaseStorageConfig({ ...env, SUPABASE_STORAGE_BUCKET: "../public" })).toThrow();
    const storage = new SupabaseFileStorage(env);
    expect(() => storage.bucket("other")).toThrow();
    for (const path of ["", "../private", "private/../other", "private/\0key"]) {
      expect(() => storage.bucket(bucket).file(path)).toThrow();
    }
  });
  it("authenticates streaming reads and never returns private URLs", async () => {
    const request = fakeFetch(async (url, init) => {
      expect(url).toBe("https://kfmstyauifksaepahvrp.supabase.co/storage/v1/object/erp-private/private/a%20b.dump");
      expect(new Headers(init.headers).get("apikey")).toBe(env.SUPABASE_STORAGE_KEY);
      return new Response("verified backup");
    });
    const file = new SupabaseFileStorage(env, request).bucket(bucket).file("/private/a b.dump");
    const chunks = [];
    for await (const chunk of file.createReadStream()) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe("verified backup");
  });
  it("does not finish an upload before remote success, preserves bytes, and can forbid overwrite", async () => {
    let complete!: () => void;
    const remote = new Promise<void>(resolve => { complete = resolve; });
    const request = fakeFetch(async (_url, init) => {
      expect(new Headers(init.headers).get("x-upsert")).toBe("false");
      let bytes = 0;
      for await (const chunk of init.body as unknown as Readable) bytes += Buffer.byteLength(chunk);
      expect(bytes).toBe(128 * 1024);
      await remote;
      return new Response("{}", { status: 200 });
    });
    let finished = false;
    const output = new SupabaseFileStorage(env, request).bucket(bucket).file("private/backup.dump")
      .createWriteStream({ overwrite: false });
    const done = pipeline(Readable.from([Buffer.alloc(128 * 1024)]), output).then(() => { finished = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(finished).toBe(false);
    complete(); await done; expect(finished).toBe(true);
  });
  it("redacts upstream errors and propagates failed uploads", async () => {
    const request = fakeFetch(async () => new Response(`private ${env.SUPABASE_STORAGE_KEY}`, { status: 403 }));
    const output = new SupabaseFileStorage(env, request).bucket(bucket).file("private/backup.dump").createWriteStream();
    await expect(pipeline(Readable.from(["bytes"]), output))
      .rejects.toThrow("Supabase private storage request failed (HTTP 403)");
  });
  it("waits for producer data before opening HTTP and handles many backpressured chunks", async () => {
    const request = fakeFetch(async (_url, init) => {
      let bytes = 0;
      for await (const chunk of init.body as unknown as Readable) bytes += Buffer.byteLength(chunk);
      expect(bytes).toBe(32 * 16 * 1024);
      return new Response("{}");
    });
    const output = new SupabaseFileStorage(env, request).bucket(bucket).file("private/delayed.dump").createWriteStream();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(request).not.toHaveBeenCalled();
    await pipeline(Readable.from(Array.from({ length: 32 }, () => Buffer.alloc(16 * 1024))), output);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("uploads empty files on finalization even without a first data chunk", async () => {
    const request = fakeFetch(async (_url, init) => {
      let bytes = 0;
      for await (const chunk of init.body as unknown as Readable) bytes += Buffer.byteLength(chunk);
      expect(bytes).toBe(0);
      return new Response("{}");
    });
    const output = new SupabaseFileStorage(env, request).bucket(bucket).file("private/empty").createWriteStream();
    await pipeline(Readable.from([]), output);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("missing objects are false, but authentication failures are not missing", async () => {
    const missing = fakeFetch(async () => new Response(null, { status: 404 }));
    await expect(new SupabaseFileStorage(env, missing).bucket(bucket).file("private/a").exists()).resolves.toEqual([false]);
    const denied = fakeFetch(async () => new Response(null, { status: 401 }));
    await expect(new SupabaseFileStorage(env, denied).bucket(bucket).file("private/a").exists())
      .rejects.toThrow("Supabase private storage request failed");
  });
  it("refuses public buckets", async () => {
    const request = fakeFetch(async () => new Response(JSON.stringify({ id: bucket, public: true }), {
      headers: { "Content-Type": "application/json" },
    }));
    await expect(new SupabaseFileStorage(env, request).verifyPrivateBucket()).rejects.toThrow();
  });
});
