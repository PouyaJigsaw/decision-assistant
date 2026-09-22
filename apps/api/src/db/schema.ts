import { integer, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
});

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const rubricVersions = sqliteTable(
  "rubric_versions",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id").notNull(),
    version: integer("version").notNull(),
    criteriaJson: text("criteria_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [unique("rubric_versions_role_version").on(table.roleId, table.version)],
);

export const evaluations = sqliteTable(
  "evaluations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
    rubricVersionId: text("rubric_version_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    bodyHash: text("body_hash").notNull(),
    status: text("status").notNull(),
    countsAsUse: integer("counts_as_use").notNull(),
    action: text("action"),
    score: integer("score"),
    reasonCode: text("reason_code"),
    answersJson: text("answers_json"),
    jevModel: text("jev_model"),
    jevInputTokens: integer("jev_input_tokens"),
    jevOutputTokens: integer("jev_output_tokens"),
    jevInputUsd: real("jev_input_usd"),
    jevOutputUsd: real("jev_output_usd"),
    llmModel: text("llm_model"),
    llmInputTokens: integer("llm_input_tokens"),
    llmOutputTokens: integer("llm_output_tokens"),
    llmInputUsdPerMillion: real("llm_input_usd_per_million"),
    llmOutputUsdPerMillion: real("llm_output_usd_per_million"),
    llmInputUsd: real("llm_input_usd"),
    llmOutputUsd: real("llm_output_usd"),
    approvedText: text("approved_text"),
    keepExtracts: integer("keep_extracts").notNull(),
    comparisonEnabled: integer("comparison_enabled").notNull(),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [unique("evaluations_user_idempotency").on(table.userId, table.idempotencyKey)],
);

export const corrections = sqliteTable("corrections", {
  id: text("id").primaryKey(),
  evaluationId: text("evaluation_id").notNull(),
  action: text("action").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const trialUses = sqliteTable("trial_uses", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  evaluationId: text("evaluation_id").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});

export const spendEvents = sqliteTable("spend_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  evaluationId: text("evaluation_id").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  jevInputUsd: real("jev_input_usd"),
  jevOutputUsd: real("jev_output_usd"),
  llmInputUsd: real("llm_input_usd"),
  llmOutputUsd: real("llm_output_usd"),
});
