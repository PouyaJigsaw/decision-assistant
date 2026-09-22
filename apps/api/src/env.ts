import type { PriceSnapshot } from "@decision-assistant/domain";

export type Env = {
  accountEmail: string;
  accountPassword: string;
  evaluationsEnabled: boolean;
  port: number;
  llmPrice: PriceSnapshot;
};

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    accountEmail: source.ACCOUNT_EMAIL ?? "",
    accountPassword: source.ACCOUNT_PASSWORD ?? "",
    evaluationsEnabled: source.EVALUATIONS_ENABLED !== "false",
    port: Number(source.PORT ?? 8787),
    llmPrice: {
      inputUsdPerMillion: Number(source.LLM_INPUT_USD_PER_MILLION ?? 3),
      outputUsdPerMillion: Number(source.LLM_OUTPUT_USD_PER_MILLION ?? 15),
    },
  };
}
