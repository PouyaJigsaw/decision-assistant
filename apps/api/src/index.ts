import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { seedUser } from "./auth";
import { openDatabase } from "./db/client";
import { readEnv } from "./env";
import { FakeJev } from "./providers/fake-jev";
import { FakeLlm } from "./providers/fake-llm";

const env = readEnv();
mkdirSync("data", { recursive: true });
const db = openDatabase("data/decision-assistant.db");
seedUser(db, env);

const jev = new FakeJev(() => {
  throw new Error("not stubbed");
});
const llm = new FakeLlm({});

const app = createApp({ db, jev, llm, env });
serve({ fetch: app.fetch, port: env.port });
