import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { seedUser } from "./auth";
import { openDatabase } from "./db/client";
import { readEnv } from "./env";
import { createLiveJev } from "./providers/live-jev";
import { createLiveLlm } from "./providers/live-llm";
import { createRuntimeProviders } from "./providers/runtime-fakes";
import type { JevClient, LlmClient } from "./providers/types";

const env = readEnv();
mkdirSync("data", { recursive: true });
const db = openDatabase("data/decision-assistant.db");
seedUser(db, env);

let jev: JevClient;
let llm: LlmClient;
if (env.providers === "live") {
  if (!env.typesafeApiKey || !env.anthropicApiKey) {
    throw new Error("TYPESAFE_API_KEY and ANTHROPIC_API_KEY are required when PROVIDERS is live");
  }
  jev = createLiveJev({ apiKey: env.typesafeApiKey });
  llm = createLiveLlm({ apiKey: env.anthropicApiKey, model: env.anthropicModel });
} else {
  ({ jev, llm } = createRuntimeProviders());
}

const app = createApp({ db, jev, llm, env });
serve({ fetch: app.fetch, hostname: env.host, port: env.port });
