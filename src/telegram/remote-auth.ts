/**
 * HTTP client for the TG auth proxy server.
 * Allows users without their own api_id/api_hash to log in
 * using the owner's credentials via a remote proxy.
 * The proxy handles the Telegram MTProto auth flow; the client
 * only sends phone, code, and optional 2FA password.
 */

const DEFAULT_PROXY = "https://tgproxy.girl-agent.com";

function proxyUrl(): string {
  return process.env.MANAGER_AGENT_AUTH_PROXY ?? DEFAULT_PROXY;
}

export interface SendCodeResult {
  loginToken: string;
}

export interface AuthSuccess {
  sessionString: string;
  apiId?: number;
  apiHash?: string;
}

export interface Needs2FA {
  needs2fa: true;
  loginToken: string;
}

export type VerifyCodeResult = AuthSuccess | Needs2FA;

async function post<T>(path: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(`${proxyUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `proxy ${path} failed (${res.status})`);
  return data;
}

export function remoteSendCode(phone: string): Promise<SendCodeResult> {
  return post("/send-code", { phone });
}

export function remoteVerifyCode(loginToken: string, code: string): Promise<VerifyCodeResult> {
  return post("/verify-code", { loginToken, code });
}

export function remoteVerifyPassword(loginToken: string, password: string): Promise<AuthSuccess> {
  return post("/verify-password", { loginToken, password });
}

export function isNeeds2FA(r: VerifyCodeResult): r is Needs2FA {
  return "needs2fa" in r && r.needs2fa === true;
}
