import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { seedUser } from "./auth";
import { openDatabase } from "./db/client";
import { readEnv } from "./env";
import type { JevClient, LlmClient } from "./providers/types";

const env = readEnv();
mkdirSync("data", { recursive: true });
const db = openDatabase("data/decision-assistant.db");
seedUser(db, env);

const jev: JevClient = {
  calls: 0,
  async evaluate() {
    throw new Error("not stubbed");
  },
};

const llm: LlmClient = {
  calls: 0,
  async draftRubric() {
    throw new Error("not stubbed");
  },
  async compare() {
    throw new Error("not stubbed");
  },
};

const app = createApp({ db, jev, llm, env });
serve({ fetch: app.fetch, port: env.port });
