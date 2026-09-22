import type { PriceSnapshot } from "@decision-assistant/domain";

export type Env = {
  accountEmail: string;
  accountPassword: string;
  evaluationsEnabled: boolean;
  host: string;
  port: number;
  llmPrice: PriceSnapshot;
};

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const accountEmail = source.ACCOUNT_EMAIL ?? "";
  const accountPassword = source.ACCOUNT_PASSWORD ?? "";
  if (!accountEmail) throw new Error("ACCOUNT_EMAIL is required");
  if (!accountPassword) throw new Error("ACCOUNT_PASSWORD is required");
  return {
    accountEmail,
    accountPassword,
    evaluationsEnabled: source.EVALUATIONS_ENABLED !== "false",
    host: source.HOST ?? "127.0.0.1",
    port: Number(source.PORT ?? 8787),
    llmPrice: {
      inputUsdPerMillion: Number(source.LLM_INPUT_USD_PER_MILLION ?? 3),
      outputUsdPerMillion: Number(source.LLM_OUTPUT_USD_PER_MILLION ?? 15),
    },
  };
}
