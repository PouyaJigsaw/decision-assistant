import {
  COMPARE_JSON_SCHEMA,
  compareLlmRequest,
  draftLlmRequest,
  type Criterion,
} from "@decision-assistant/domain";
import {
  loadChatGptAuth,
  refreshChatGpt,
  type OAuthHost,
} from "./chatgpt-oauth";
import {
  credentialForRequest,
  getConnection,
  type DualKv,
} from "./llm-credentials";
import { RESPONSES_URL, completeResponse, type Completion } from "./openai-responses";

export const SELECTED_MODEL_KEY = "openaiModel";
const DEFAULT_MODEL = "gpt-5.4";

export type { Completion };

export { getConnection };

export async function selectedModel(kv: DualKv): Promise<string> {
  const stored = await kv.local.get([SELECTED_MODEL_KEY]);
  return typeof stored[SELECTED_MODEL_KEY] === "string" && stored[SELECTED_MODEL_KEY]
    ? String(stored[SELECTED_MODEL_KEY])
    : DEFAULT_MODEL;
}

export async function setSelectedModel(kv: DualKv, model: string): Promise<void> {
  await kv.local.set({ [SELECTED_MODEL_KEY]: model });
}

async function bearer(kv: DualKv, host: OAuthHost) {
  const auth = await loadChatGptAuth(kv.local);
  if (auth?.refresh_token && auth.expires_at - host.now() < 60_000) {
    await refreshChatGpt(host, kv.local);
  }
  const cred = await credentialForRequest(kv, RESPONSES_URL);
  if (!cred) throw new Error("llm_not_connected");
  return cred;
}

async function complete(
  kv: DualKv,
  host: OAuthHost,
  request: { instructions: string; input: string; jsonSchema?: Record<string, unknown> },
): Promise<Completion> {
  const cred = await bearer(kv, host);
  return completeResponse({
    token: cred.token,
    model: await selectedModel(kv),
    instructions: request.instructions,
    input: request.input,
    stream: cred.stream,
    jsonSchema: request.jsonSchema,
    fetchImpl: host.fetch,
  });
}

export async function completeDraft(kv: DualKv, host: OAuthHost, notes: string): Promise<Completion> {
  return complete(kv, host, draftLlmRequest(notes));
}

export async function completeCompare(
  kv: DualKv,
  host: OAuthHost,
  criteria: Criterion[],
  approvedText: string,
): Promise<Completion> {
  return complete(kv, host, { ...compareLlmRequest(criteria, approvedText), jsonSchema: COMPARE_JSON_SCHEMA });
}
