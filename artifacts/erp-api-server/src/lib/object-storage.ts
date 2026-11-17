import { Storage } from "@google-cloud/storage";
import { runtimeDatabaseProvider } from "@workspace/erp-db";
import { SupabaseFileStorage, supabaseStorageConfig } from "./supabase-storage";
import type { FileStorage } from "./storage-contract";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// 共用的 GCS client，使用 Replit sidecar 認證
const provider = process.env.ERP_STORAGE_PROVIDER || runtimeDatabaseProvider();
if (!["supabase", "replit"].includes(provider)) throw new Error("Invalid ERP_STORAGE_PROVIDER");
export const objectStorageClient: FileStorage = provider === "supabase"
  ? new SupabaseFileStorage()
  : new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export const objectStorageBucketId = provider === "supabase"
  ? supabaseStorageConfig().bucket
  : process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
export const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || "private";
