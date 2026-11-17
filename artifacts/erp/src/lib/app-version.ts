// 這一版的版本號，打包時由 vite.config.ts 寫入（來源：專案根目錄的 app-version.mjs）。
declare const __APP_VERSION__: { version: string; commit: string | null; builtAt: string } | undefined;

export const APP_VERSION: { version: string; commit: string | null; builtAt: string | null } =
  typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__
    ? __APP_VERSION__
    : { version: "dev", commit: null, builtAt: null };
