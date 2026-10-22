import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnvFile } from "dotenv";
import type { PriceSnapshot } from "@decision-assistant/domain";

export function loadDotenv(cwd = process.cwd()): { loaded: boolean; path: string } {
  const path = resolve(cwd, ".env");
  if (!existsSync(path)) return { loaded: false, path };
  loadEnvFile({ path, override: false });
  return { loaded: true, path };
}

export type Env = {
  accountEmail: string;
  accountPassword: string;
  evaluationsEnabled: boolean;
  trialSuccessCap: number | null;
  dailySpendCapUsd: number;
  databasePath: string;
  host: string;
  port: number;
  providers: "fake" | "live";
  typesafeApiKey: string;
  llmApiKey: string;
  llmModel: string;
  llmPrice: PriceSnapshot;
  jevModel: string;
  jevPrice: PriceSnapshot;
};

function readTrialSuccessCap(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === "") return 3;
  if (trimmed === "infinite" || trimmed === "0") return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("TRIAL_SUCCESS_CAP must be a non-negative integer or infinite");
  }
  return value;
}

function readPrice(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  const value = trimmed === undefined || trimmed === "" ? fallback : Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Prices must be finite and >= 0");
  }
  return value;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const accountEmail = source.ACCOUNT_EMAIL ?? "";
  const accountPassword = source.ACCOUNT_PASSWORD ?? "";
  if (!accountEmail) throw new Error("ACCOUNT_EMAIL is required");
  if (!accountPassword) throw new Error("ACCOUNT_PASSWORD is required");
  const databasePath = source.DATABASE_PATH ?? "";
  if (!databasePath) throw new Error("DATABASE_PATH is required");
  return {
    accountEmail,
    accountPassword,
    evaluationsEnabled: source.EVALUATIONS_ENABLED !== "false",
    trialSuccessCap: readTrialSuccessCap(source.TRIAL_SUCCESS_CAP),
    dailySpendCapUsd: readPrice(source.DAILY_SPEND_CAP_USD, 5),
    databasePath,
    host: source.HOST ?? "127.0.0.1",
    port: Number(source.PORT ?? 8787),
    providers: source.PROVIDERS === "fake" ? "fake" : "live",
    typesafeApiKey: (source.TYPESAFE_API_KEY ?? "").trim(),
    llmApiKey: (source.LLM_API_KEY ?? "").trim(),
    llmModel: source.LLM_MODEL ?? "",
    llmPrice: {
      inputUsdPerMillion: readPrice(source.LLM_INPUT_USD_PER_MILLION, 3),
      outputUsdPerMillion: readPrice(source.LLM_OUTPUT_USD_PER_MILLION, 15),
    },
    jevModel: source.JEV_MODEL?.trim() || "jev-1.13.0",
    jevPrice: {
      inputUsdPerMillion: readPrice(source.JEV_INPUT_USD_PER_MILLION, 0.042),
      outputUsdPerMillion: readPrice(source.JEV_OUTPUT_USD_PER_MILLION, 0),
    },
  };
}
