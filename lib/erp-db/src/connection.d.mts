export function resolveDatabaseSource(env?: NodeJS.ProcessEnv): "url" | "pg";
export function resolveDatabaseUrl(env?: NodeJS.ProcessEnv): string;