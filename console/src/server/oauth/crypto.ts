/**
 * The OAuth door's small cryptography: sealing (AES-256-GCM) for a refresh token at rest and for the
 * short-lived flow cookie, the PKCE pair (RFC 7636, S256), unguessable ids, and a constant-time
 * compare for `state`. Node's own crypto only; no key ever has a default.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface Sealer {
  /** Seals `plain` bound to `aad` (e.g. the session id hash): a ciphertext moved to another record will not open. */
  seal(plain: string, aad: string): string;
  /** The plaintext, or null for anything tampered, truncated, sealed under another key or another aad. */
  open(sealed: string, aad: string): string | null;
}

const b64u = (b: Buffer): string => b.toString("base64url");
const unb64u = (s: string): Buffer | null => (/^[A-Za-z0-9_-]*$/.test(s) ? Buffer.from(s, "base64url") : null);

/** `key` is 32 random bytes, base64 or base64url (ZOHO_SESSION_KEY). */
export function createSealer(key: string): Sealer {
  const raw = typeof key === "string" ? Buffer.from(key.replace(/-/g, "+").replace(/_/g, "/"), "base64") : Buffer.alloc(0);
  if (raw.length !== 32) throw new TypeError("The session sealing key must be 32 random bytes, base64-encoded.");
  const k = Buffer.from(raw);
  return Object.freeze({
    seal(plain: string, aad: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", k, iv);
      c.setAAD(Buffer.from(aad, "utf8"));
      const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return ["v1", b64u(iv), b64u(c.getAuthTag()), b64u(ct)].join(".");
    },
    open(sealed: string, aad: string): string | null {
      if (typeof sealed !== "string") return null;
      const parts = sealed.split(".");
      if (parts.length !== 4 || parts[0] !== "v1") return null;
      const iv = unb64u(parts[1]!), tag = unb64u(parts[2]!), ct = unb64u(parts[3]!);
      if (!iv || !tag || !ct || iv.length !== 12 || tag.length !== 16) return null;
      try {
        const d = createDecipheriv("aes-256-gcm", k, iv);
        d.setAAD(Buffer.from(aad, "utf8"));
        d.setAuthTag(tag);
        return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
      } catch {
        return null;
      }
    },
  });
}

/** 32 random bytes, base64url: a session id, a `state`, a PKCE verifier (43 chars, RFC 7636 range). */
export const randomToken = (): string => b64u(randomBytes(32));

/** RFC 7636 S256: BASE64URL(SHA256(verifier)). */
export const pkceChallenge = (verifier: string): string => b64u(createHash("sha256").update(verifier, "ascii").digest());

/** What a session store is keyed by: the cookie's id never sits in the store, so a store dump cannot be replayed as a cookie. */
export const idHash = (id: string): string => b64u(createHash("sha256").update(id, "utf8").digest());

export function sameToken(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0) return false;
  const x = Buffer.from(a, "utf8"), y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
