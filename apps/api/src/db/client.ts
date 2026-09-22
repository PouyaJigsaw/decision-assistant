import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export function openDatabase(path: string): AppDatabase {
  const sqlite = new Database(path);
  const db = drizzle(sqlite, { schema });
  migrate(db);
  return db;
}

function migrate(db: AppDatabase): void {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at integer NOT NULL
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      expires_at integer NOT NULL
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS roles (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      title text NOT NULL,
      created_at integer NOT NULL
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rubric_versions (
      id text PRIMARY KEY,
      role_id text NOT NULL,
      version integer NOT NULL,
      criteria_json text NOT NULL,
      created_at integer NOT NULL,
      UNIQUE (role_id, version)
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS evaluations (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      role_id text NOT NULL,
      rubric_version_id text NOT NULL,
      idempotency_key text NOT NULL,
      body_hash text NOT NULL,
      status text NOT NULL,
      counts_as_use integer NOT NULL,
      action text,
      score integer,
      reason_code text,
      answers_json text,
      jev_model text,
      jev_input_tokens integer,
      jev_output_tokens integer,
      jev_input_usd real,
      jev_output_usd real,
      llm_model text,
      llm_input_tokens integer,
      llm_output_tokens integer,
      llm_input_usd_per_million real,
      llm_output_usd_per_million real,
      llm_input_usd real,
      llm_output_usd real,
      approved_text text,
      keep_extracts integer NOT NULL,
      comparison_enabled integer NOT NULL,
      notes text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      UNIQUE (user_id, idempotency_key)
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS corrections (
      id text PRIMARY KEY,
      evaluation_id text NOT NULL,
      action text NOT NULL,
      created_at integer NOT NULL
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS trial_uses (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      evaluation_id text NOT NULL UNIQUE,
      created_at integer NOT NULL
    )
  `);
}
