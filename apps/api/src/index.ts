import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { seedUser } from "./auth";
import { openDatabase } from "./db/client";
import { loadDotenv, readEnv } from "./env";

loadDotenv();
import { createLiveJev } from "./providers/live-jev";
import { createLiveLlm } from "./providers/live-llm";
import { createRuntimeProviders } from "./providers/runtime-fakes";
import type { JevClient, LlmClient } from "./providers/types";

const env = readEnv();
const db = openDatabase(env.databasePath);
seedUser(db, env);

let jev: JevClient;
let llm: LlmClient;
function unusedLlm(): LlmClient {
  return {
    calls: 0,
    async draftRubric() {
      throw new Error("llm_moved_to_client");
    },
    async compare() {
      throw new Error("llm_moved_to_client");
    },
  };
}

if (env.providers === "live") {
  if (!env.typesafeApiKey) {
    throw new Error("TYPESAFE_API_KEY is required when PROVIDERS is live");
  }
  jev = createLiveJev({ apiKey: env.typesafeApiKey, model: env.jevModel });
  llm =
    env.llmApiKey && env.llmModel
      ? createLiveLlm({ apiKey: env.llmApiKey, model: env.llmModel })
      : unusedLlm();
} else {
  ({ jev, llm } = createRuntimeProviders());
}

const app = createApp({ db, jev, llm, env });
serve({ fetch: app.fetch, hostname: env.host, port: env.port });
