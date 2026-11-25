import crypto from "node:crypto";

/**
 * Google OAuth 2.0 (authorization-code flow) + refresh-token encryption.
 *
 * Deliberately dependency-free — no `googleapis`/`google-auth-library`. The
 * flow is a handful of HTTPS calls (`fetch`) and the token at rest is sealed
 * with Node's `crypto` (AES-256-GCM). Keeps node_modules small and the surface
 * fully auditable, which matters for a refresh token that can read/write a
 * clinic's whole agenda.
 *
 * Required env (all server-only):
 *   GOOGLE_CLIENT_ID          OAuth web-client id
 *   GOOGLE_CLIENT_SECRET      OAuth web-client secret
 *   GOOGLE_TOKEN_ENC_KEY      base64 of 32 random bytes — seals refresh tokens
 *   GOOGLE_OAUTH_REDIRECT_URI (optional) overrides the derived callback URL
 */

// calendar = full access — needed to CREATE one calendar per doctor
// (calendars.insert); it also covers reading/writing events. openid+email =
// so we can show WHICH Google account is connected.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "openid",
  "email",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_TOKEN_ENC_KEY,
  );
}

/** The `/api/google/callback` URL Google redirects back to. */
export function redirectUri(origin: string): string {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI ?? `${origin}/api/google/callback`
  );
}

/** Build the consent-screen URL. `state` is our CSRF token (cookie-checked). */
export function buildAuthUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // ← we get a refresh_token
    prompt: "consent", // ← force it every time, so re-connecting always yields one
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
};

/** Exchange the authorization code for tokens. */
export async function exchangeCode(
  origin: string,
  code: string,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(origin),
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Trade a stored refresh token for a fresh short-lived access token. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

/** Best-effort read of the connected account's email from the id_token (JWT). */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

// --- refresh-token sealing (AES-256-GCM) -----------------------------------

function encKey(): Buffer {
  const b64 = process.env.GOOGLE_TOKEN_ENC_KEY;
  if (!b64) throw new Error("GOOGLE_TOKEN_ENC_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENC_KEY must be base64 of exactly 32 bytes");
  }
  return key;
}

/** Seal a refresh token for storage. Format: `v1:<iv>:<tag>:<ciphertext>` (b64). */
export function sealToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Reverse of {@link sealToken}. */
export function openToken(sealed: string): string {
  const [v, ivB64, tagB64, ctB64] = sealed.split(":");
  if (v !== "v1") throw new Error("Unrecognized sealed-token version");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return (
    decipher.update(Buffer.from(ctB64, "base64")).toString("utf8") +
    decipher.final("utf8")
  );
}
