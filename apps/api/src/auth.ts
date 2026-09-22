import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "./db/client";
import { users } from "./db/schema";
import type { Env } from "./env";

const SCRYPT_KEYLEN = 64;
const SESSION_MS = 12 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionExpiresAt(now = Date.now()): number {
  return now + SESSION_MS;
}

export function seedUser(db: AppDatabase, env: Env) {
  const existing = db.select().from(users).where(eq(users.email, env.accountEmail)).get();
  if (existing) return existing;
  const row = {
    id: crypto.randomUUID(),
    email: env.accountEmail,
    passwordHash: hashPassword(env.accountPassword),
    createdAt: Date.now(),
  };
  db.insert(users).values(row).run();
  return row;
}
