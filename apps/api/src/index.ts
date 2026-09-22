import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { seedUser } from "./auth";
import { openDatabase } from "./db/client";
import { readEnv } from "./env";
import { createRuntimeProviders } from "./providers/runtime-fakes";

const env = readEnv();
mkdirSync("data", { recursive: true });
const db = openDatabase("data/decision-assistant.db");
seedUser(db, env);

const { jev, llm } = createRuntimeProviders();
const app = createApp({ db, jev, llm, env });
serve({ fetch: app.fetch, hostname: env.host, port: env.port });
