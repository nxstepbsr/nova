/**
 * Single-password session tokens, signed with Web Crypto (not node:crypto)
 * so the same code runs in Next.js middleware (Edge runtime) and route
 * handlers (Node runtime) without a runtime-specific import.
 *
 * The signing key is APP_PASSWORD itself — there's no separate secret to
 * configure. A token is `${issuedAtMs}.${hmacSignature}`; verifying just
 * re-derives the signature and checks it matches, plus a max age.
 */

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const encoder = new TextEncoder();

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(signature);
}

export async function createSessionToken(secret: string): Promise<string> {
  const payload = String(Date.now());
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const issuedAt = Number(payload);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_MAX_AGE_MS) return false;

  const expected = await sign(payload, secret);
  return expected === signature;
}

export const SESSION_COOKIE = "canvas_session";
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_MS / 1000;
