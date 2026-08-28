// Sign-in without passwords.
//
// A specialist signs in perhaps six times a year. A password they set once and never use is a
// password they will reset every time, so the reset email IS the login — this just removes the
// password that was only ever in the way.
//
// THE TOKEN IS STORED AS A HASH, NEVER IN THE CLEAR. A portal database that leaks its own sign-in
// tokens is a database that hands over every specialist's account. The clear token exists only in
// the email we send and in the link the specialist clicks; what we keep is a digest we can compare
// against, exactly as with a password.
//
// SINGLE USE, SHORT LIFE, AND CONSUMED EVEN ON FAILURE OF THE ROUND AFTER. A link that still works
// after sign-in is a link sitting in a mailbox forever.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const TOKEN_TTL_MINUTES = 20;

export const PracticeEmailSchema = z.string().email().max(254);

export interface IssuedLink {
  /** Goes in the email. Never stored. */
  readonly token: string;
  readonly record: StoredLink;
}

export const StoredLinkSchema = z
  .object({
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
    email: PracticeEmailSchema,
    ahpraId: z.string(),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
    usedAt: z.union([z.number().int(), z.null()]),
  })
  .strict();
export type StoredLink = z.infer<typeof StoredLinkSchema>;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueMagicLink(
  email: string,
  ahpraId: string,
  now: Date,
  randomHex: () => string = () => randomBytes(32).toString("hex"),
): IssuedLink {
  const token = randomHex();
  return {
    token,
    record: StoredLinkSchema.parse({
      tokenHash: hashToken(token),
      email: PracticeEmailSchema.parse(email),
      ahpraId,
      issuedAt: now.getTime(),
      expiresAt: now.getTime() + TOKEN_TTL_MINUTES * 60_000,
      usedAt: null,
    }),
  };
}

export type LinkCheck =
  | { readonly ok: true; readonly link: StoredLink }
  | { readonly ok: false; readonly reason: "unknown" | "expired" | "already-used" };

/**
 * All three failures return the same shape and should render the same message to the visitor:
 * "that link has expired, here is a new one". Distinguishing them out loud tells someone holding
 * a stolen token whether it was ever real.
 */
export function checkMagicLink(token: string, stored: readonly StoredLink[], now: Date): LinkCheck {
  const digest = hashToken(token);
  const candidate = stored.find((link) => {
    const a = Buffer.from(link.tokenHash, "hex");
    const b = Buffer.from(digest, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!candidate) return { ok: false, reason: "unknown" };
  if (candidate.usedAt !== null) return { ok: false, reason: "already-used" };
  if (now.getTime() > candidate.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, link: candidate };
}

export function consume(link: StoredLink, now: Date): StoredLink {
  return { ...link, usedAt: now.getTime() };
}
