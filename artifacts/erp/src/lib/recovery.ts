export type RecoveryEmailStatus = {
  email: string | null;
  verified: boolean;
};

type ErrorBody = {
  error?: unknown;
  message?: unknown;
};

export async function readJsonSafely<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export async function recoveryRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/erp-api/admin/${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const body = await readJsonSafely<T & ErrorBody>(response);
  if (!response.ok) {
    const message = typeof body?.error === "string"
      ? body.error
      : typeof body?.message === "string"
        ? body.message
        : "請求失敗，請稍後再試";
    throw new Error(message);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("伺服器回應格式錯誤，請稍後再試");
  }
  return body;
}

export const PASSWORD_POLICY_TEXT = "至少10個字元，包含英文字母與數字（最多72 UTF-8位元組）";

export function readTokenFromFragment(fragment: string = window.location.hash): string {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  return params.get("token") ?? "";
}

export function clearTokenFromUrl(): void {
  const query = new URLSearchParams(window.location.search);
  query.delete("token");
  const remainingQuery = query.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ""}`,
  );
}

export function passwordValidationMessage(password: string): string | null {
  const byteLength = new TextEncoder().encode(password).length;
  if (Array.from(password).length < 10) return `密碼${PASSWORD_POLICY_TEXT}`;
  if (byteLength > 72) return `密碼${PASSWORD_POLICY_TEXT}`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return `密碼${PASSWORD_POLICY_TEXT}`;
  return null;
}