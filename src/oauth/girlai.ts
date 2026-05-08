import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";

const GIRLAI_BASE = "https://api.girl-agent.com";
const AUTHORIZE_URL = `${GIRLAI_BASE}/oauth/authorize`;
const TOKEN_URL = `${GIRLAI_BASE}/oauth/token`;
const REVOKE_URL = `${GIRLAI_BASE}/oauth/revoke`;

/** Built-in OAuth client for girl-agent CLI. */
const CLIENT_ID = "oac_dcce490e74a452a9ed20";
const CLIENT_SECRET = "abnfSGmeisM7SFdMn_c1MwFYAHaqzgs7";
const CALLBACK_PORT = 3000;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
}

/**
 * Run the full OAuth authorization-code flow:
 * 1. Start a temporary local HTTP server for the callback
 * 2. Open the browser to the authorize URL
 * 3. Wait for the redirect with the auth code
 * 4. Exchange the code for tokens
 */
export async function runOAuthFlow(log: (msg: string) => void): Promise<OAuthTokens> {
  const state = crypto.randomBytes(16).toString("hex");
  const { waitForCode, close } = await startCallbackServer(state);

  const authorizeParams = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    state
  });

  const url = `${AUTHORIZE_URL}?${authorizeParams}`;
  log(`открываю браузер для авторизации: ${url}`);
  openBrowser(url);

  let code: string;
  try {
    code = await waitForCode;
  } finally {
    close();
  }

  log("код получен, обмениваю на токен...");
  return exchangeCode(code, REDIRECT_URI);
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCode(code: string, redirectUri: string = REDIRECT_URI): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: redirectUri
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000
  };
}

/**
 * Refresh an expired access token using a refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000
  };
}

/**
 * Revoke an access or refresh token.
 */
export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString()
  });
}

/**
 * Check if the stored access token is expired (with 60s buffer).
 */
export function isTokenExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt - 60_000;
}

// ── internals ──

function startCallbackServer(expectedState: string): Promise<{
  waitForCode: Promise<string>;
  close: () => void;
}> {
  return new Promise((resolveSetup) => {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const waitForCode = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const timeout = setTimeout(() => {
      rejectCode(new Error("OAuth callback timeout (5 minutes)"));
      server.close();
    }, 5 * 60 * 1000);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Авторизация отклонена</h2><p>Можешь закрыть эту вкладку.</p>");
        clearTimeout(timeout);
        rejectCode(new Error(`OAuth denied: ${error}`));
        return;
      }

      if (!code || state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Ошибка</h2><p>Неверный state или отсутствует code.</p>");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>Авторизация успешна!</h2><p>Можешь закрыть эту вкладку и вернуться в терминал.</p>");
      clearTimeout(timeout);
      resolveCode(code);
    });

    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      resolveSetup({
        waitForCode,
        close: () => server.close()
      });
    });
  });
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? `open "${url}"` :
    platform === "win32" ? `start "" "${url}"` :
    `xdg-open "${url}" 2>/dev/null || sensible-browser "${url}" 2>/dev/null || echo "открой вручную: ${url}"`;

  exec(cmd, (err) => {
    if (err) {
      process.stderr.write(`[girlai-oauth] не удалось открыть браузер, открой вручную:\n  ${url}\n`);
    }
  });
}
