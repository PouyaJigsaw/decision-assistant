export const RESPONSES_URL = "https://api.openai.com/v1/responses";
export const MODELS_URL = "https://api.openai.com/v1/models";

export class OpenAiError extends Error {
  readonly name = "OpenAiError";
  constructor(
    readonly code: string,
    readonly status: number,
    readonly manageUsage: boolean,
    readonly detail?: string,
  ) {
    super(detail || code);
  }
}

export type ListedModel = { slug: string; display_name: string };

export type Completion = {
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
};

const USAGE_LIMIT_CODES = new Set([
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_usage_unavailable",
]);

function diagnostic(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const row = payload as { detail?: unknown; error?: { message?: unknown } };
  if (typeof row.detail === "string" && row.detail.trim()) return row.detail.trim();
  if (typeof row.error?.message === "string" && row.error.message.trim()) return row.error.message.trim();
  return undefined;
}

function asError(payload: unknown, status: number): OpenAiError {
  const record = payload && typeof payload === "object" ? (payload as { error?: { code?: unknown } }) : {};
  const code = typeof record.error?.code === "string" ? record.error.code : status === 429 ? "rate_limited" : "openai_failed";
  return new OpenAiError(code, status, USAGE_LIMIT_CODES.has(code), diagnostic(payload));
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { code: "invalid_json" } };
  }
}

export async function listModels(opts: {
  token: string;
  planUsage: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ListedModel[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const response = await fetchImpl(MODELS_URL, {
    headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
  });
  const payload = await readJson(response);
  if (!response.ok) throw asError(payload, response.status);
  const models =
    payload && typeof payload === "object" && "models" in payload && Array.isArray((payload as { models: unknown }).models)
      ? (payload as { models: { slug?: unknown; display_name?: unknown; visibility?: unknown; id?: unknown }[] }).models
      : payload && typeof payload === "object" && "data" in payload && Array.isArray((payload as { data: unknown }).data)
        ? (payload as { data: { id?: unknown }[] }).data.map((item) => ({
            slug: item.id,
            display_name: item.id,
            visibility: "list",
          }))
        : [];
  return models
    .filter((item) => !opts.planUsage || item.visibility === "list")
    .map((item) => ({
      slug: String(item.slug ?? item.display_name ?? ""),
      display_name: String(item.display_name ?? item.slug ?? ""),
    }))
    .filter((item) => item.slug);
}

export function pickListedModel(stored: string, listed: ListedModel[]): string {
  if (listed.some((model) => model.slug === stored)) return stored;
  return listed[0]?.slug ?? stored;
}

function requestBody(opts: {
  model: string;
  instructions: string;
  input: string;
  stream: boolean;
  planUsage?: boolean;
  jsonSchema?: Record<string, unknown>;
}) {
  const body: Record<string, unknown> = {
    model: opts.model,
    input: [
      {
        role: "user",
        content: opts.planUsage ? `${opts.instructions}\n\n${opts.input}` : opts.input,
      },
    ],
    store: false,
    stream: opts.stream,
  };
  if (!opts.planUsage) body.instructions = opts.instructions;
  if (opts.jsonSchema) {
    body.text = { format: { type: "json_schema", name: "result", schema: opts.jsonSchema, strict: true } };
  }
  return body;
}

function textFromCompleted(payload: unknown): { model: string; text: string; inputTokens: number; outputTokens: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as {
    model?: unknown;
    output_text?: unknown;
    output?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  let text = typeof row.output_text === "string" ? row.output_text : "";
  if (!text && Array.isArray(row.output)) {
    for (const item of row.output) {
      if (typeof item !== "object" || item === null || !("content" in item) || !Array.isArray(item.content)) continue;
      for (const block of item.content) {
        if (typeof block === "object" && block && "text" in block && typeof block.text === "string") {
          text += block.text;
        }
      }
    }
  }
  const model = typeof row.model === "string" ? row.model : "";
  const inputTokens = typeof row.usage?.input_tokens === "number" ? row.usage.input_tokens : 0;
  const outputTokens = typeof row.usage?.output_tokens === "number" ? row.usage.output_tokens : 0;
  if (!model && !text) return null;
  return { model, text, inputTokens, outputTokens };
}

async function readStream(response: Response): Promise<Completion> {
  if (!response.body) throw new Error("Stream ended without response.completed.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let completed: Completion | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let event: {
          type?: string;
          delta?: unknown;
          response?: {
            error?: { code?: unknown; message?: unknown };
            model?: unknown;
            usage?: { input_tokens?: unknown; output_tokens?: unknown };
          };
        };
        try {
          event = JSON.parse(data) as typeof event;
        } catch {
          continue;
        }
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        }
        if (event.type === "response.failed") {
          const code = typeof event.response?.error?.code === "string" ? event.response.error.code : "openai_failed";
          const detail =
            typeof event.response?.error?.message === "string" ? event.response.error.message : undefined;
          throw new OpenAiError(code, 400, USAGE_LIMIT_CODES.has(code), detail);
        }
        if (event.type === "response.completed") {
          const usage = event.response?.usage;
          completed = {
            model: typeof event.response?.model === "string" ? event.response.model : "",
            text,
            inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
            outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
          };
        }
      }
    }
  }
  if (!completed) throw new Error("Stream ended without response.completed.");
  return completed;
}

export async function completeResponse(opts: {
  token: string;
  model: string;
  instructions: string;
  input: string;
  stream: boolean;
  planUsage?: boolean;
  jsonSchema?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<Completion> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    "Content-Type": "application/json",
    Accept: opts.stream ? "text/event-stream" : "application/json",
  };

  async function post(jsonSchema?: Record<string, unknown>): Promise<Response> {
    return fetchImpl(RESPONSES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody({ ...opts, jsonSchema })),
    });
  }

  let response = await post(opts.jsonSchema);
  if (!response.ok) {
    const payload = await readJson(response.clone());
    const err = asError(payload, response.status);
    if (opts.jsonSchema && err.code === "subscription_sharing_unsupported_capability") {
      response = await post(undefined);
    } else {
      throw err;
    }
  }
  if (!response.ok) throw asError(await readJson(response), response.status);
  if (opts.stream) return readStream(response);
  const completed = textFromCompleted(await readJson(response));
  if (!completed) throw new Error("openai_failed");
  return completed;
}
