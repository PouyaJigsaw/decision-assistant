import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "./db/client";
import { sessions, users } from "./db/schema";
import type { Env } from "./env";

const SCRYPT_KEYLEN = 64;
const SESSION_MS = 12 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, Uint8Array.from(salt), SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Uint8Array.from(Buffer.from(hashHex, "hex"));
  const actual = Uint8Array.from(scryptSync(password, Uint8Array.from(Buffer.from(saltHex, "hex")), expected.length));
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

export function findUserByEmail(db: AppDatabase, email: string) {
  return db.select().from(users).where(eq(users.email, email)).get();
}

export function createSession(db: AppDatabase, userId: string) {
  const token = createSessionToken();
  const expiresAt = sessionExpiresAt();
  db.insert(sessions)
    .values({
      id: crypto.randomUUID(),
      userId,
      tokenHash: hashToken(token),
      expiresAt,
    })
    .run();
  return { token, expiresAt };
}

export function findSessionUser(db: AppDatabase, token: string) {
  const session = db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).get();
  if (!session || session.expiresAt <= Date.now()) return undefined;
  return db.select().from(users).where(eq(users.id, session.userId)).get();
}

export function deleteSession(db: AppDatabase, token: string) {
  db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}

export function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length);
  return token.length > 0 ? token : undefined;
}
