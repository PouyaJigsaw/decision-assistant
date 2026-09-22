import type { PriceSnapshot } from "@decision-assistant/domain";

export type Env = {
  accountEmail: string;
  accountPassword: string;
  evaluationsEnabled: boolean;
  dailySpendCapUsd: number;
  host: string;
  port: number;
  providers: "fake" | "live";
  typesafeApiKey: string;
  anthropicApiKey: string;
  anthropicModel: string;
  llmPrice: PriceSnapshot;
};

function readPrice(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  const value = trimmed === undefined || trimmed === "" ? fallback : Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("LLM prices must be finite and >= 0");
  }
  return value;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const accountEmail = source.ACCOUNT_EMAIL ?? "";
  const accountPassword = source.ACCOUNT_PASSWORD ?? "";
  if (!accountEmail) throw new Error("ACCOUNT_EMAIL is required");
  if (!accountPassword) throw new Error("ACCOUNT_PASSWORD is required");
  const inputFallback = Number(source.LLM_INPUT_USD_PER_MILLION ?? 3);
  const outputFallback = Number(source.LLM_OUTPUT_USD_PER_MILLION ?? 15);
  return {
    accountEmail,
    accountPassword,
    evaluationsEnabled: source.EVALUATIONS_ENABLED !== "false",
    dailySpendCapUsd: readPrice(source.DAILY_SPEND_CAP_USD, 5),
    host: source.HOST ?? "127.0.0.1",
    port: Number(source.PORT ?? 8787),
    providers: source.PROVIDERS === "fake" ? "fake" : "live",
    typesafeApiKey: source.TYPESAFE_API_KEY ?? "",
    anthropicApiKey: source.ANTHROPIC_API_KEY ?? "",
    anthropicModel: source.ANTHROPIC_MODEL ?? "",
    llmPrice: {
      inputUsdPerMillion: readPrice(source.ANTHROPIC_INPUT_USD_PER_MILLION, inputFallback),
      outputUsdPerMillion: readPrice(source.ANTHROPIC_OUTPUT_USD_PER_MILLION, outputFallback),
    },
  };
}
