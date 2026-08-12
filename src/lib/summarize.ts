import { env } from "./env";
import type { RepoContext } from "./github";
import { buildPrompt } from "./prompt";
import type { DesignNote, EntryPoint, Summary } from "./types";

/**
 * The model provider is any OpenAI-compatible chat-completions endpoint.
 * Nothing here is specific to one vendor: base URL, model ID and key all come
 * from the environment, so switching provider is an .env.local edit.
 */

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-3.6-flash";
/**
 * Thinking tokens are charged against this budget and are not part of the
 * answer, so the cap has to cover both. Too low and the response comes back
 * empty with finish_reason "length" — all budget spent before the first word.
 */
const MAX_OUTPUT_TOKENS = 8000;
/** Per attempt. Retries share the deadline below, so this is not the total. */
const REQUEST_TIMEOUT_MS = 45_000;
/** The whole call, retries included. Below the route's maxDuration (120s). */
const TOTAL_DEADLINE_MS = 100_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;
/** Longer than this and waiting is worse than telling the user to come back. */
const MAX_RETRY_AFTER_MS = 20_000;
/** Transient by definition: the same request usually succeeds seconds later. */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export class SummarizeError extends Error {
  /** Raw model output, when the failure was a parse failure. Shown in the UI. */
  raw: string | null;

  constructor(message: string, raw: string | null = null) {
    super(message);
    this.name = "SummarizeError";
    this.raw = raw;
  }
}

type ChatMessage = { role: "system" | "user"; content: string };

type ContentPart = { type?: string; text?: string };

type ChatChoice = {
  message?: {
    content?: string | ContentPart[] | null;
    /** Some providers put chain-of-thought here. It is never part of the answer. */
    reasoning_content?: string | null;
  };
  finish_reason?: string | null;
};

type ChatResponse = { choices?: ChatChoice[] };

export function modelName(): string {
  return env("LLM_MODEL") ?? DEFAULT_MODEL;
}

/**
 * Whether private repository contents may leave the machine. Off unless asked
 * for: free tiers commonly reserve the right to train on what you send them,
 * and a private repository is the one thing here that is not already public.
 */
export function privateReposAllowed(): boolean {
  const value = env("ALLOW_PRIVATE_REPOS")?.toLowerCase();
  return value === "true" || value === "1";
}

function endpoint(): string {
  const base = (env("LLM_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function providerHost(): string {
  try {
    return new URL(endpoint()).host;
  } catch {
    return env("LLM_BASE_URL") ?? DEFAULT_BASE_URL;
  }
}

export async function summarize(context: RepoContext): Promise<Summary> {
  const apiKey = env("LLM_API_KEY");
  if (!apiKey) {
    throw new SummarizeError(
      "LLM_API_KEY が設定されていません。.env.example を .env.local にコピーして値を入れてください。",
    );
  }

  const { system, user } = buildPrompt(context);
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const deadline = Date.now() + TOTAL_DEADLINE_MS;

  // JSON mode is not implemented by every OpenAI-compatible provider. Ask for
  // it first; if the provider rejects the field, send the same request without
  // it. parseSummary can find the object either way, so the fallback only costs
  // one extra round trip on providers that lack the feature.
  let response = await post(apiKey, messages, true, deadline);
  if (response.status === 400) {
    const detail = await errorDetail(response);
    if (!/response_format|json/i.test(detail)) {
      throw new SummarizeError(describe(400, detail, response));
    }
    response = await post(apiKey, messages, false, deadline);
  }

  if (!response.ok) {
    throw new SummarizeError(describe(response.status, await errorDetail(response), response));
  }

  const body = (await response.json()) as ChatResponse;
  const choice = body.choices?.[0];
  if (!choice) {
    throw new SummarizeError(
      `モデル提供元 (${providerHost()}) が空の応答を返しました。`,
      clip(JSON.stringify(body)),
    );
  }

  const text = extractText(choice);

  if (choice.finish_reason === "length") {
    // An empty answer here means the model spent the whole budget on thinking.
    const cause =
      text.trim().length === 0
        ? "推論に使い切られ、本文が返りませんでした"
        : "達して途中で切れました";
    throw new SummarizeError(
      `応答が上限 (${MAX_OUTPUT_TOKENS} トークン) に${cause}。`,
      clip(text),
    );
  }

  if (text.trim().length === 0) {
    throw new SummarizeError("モデルの応答が空でした。", clip(JSON.stringify(choice)));
  }

  return parseSummary(text);
}

/**
 * Sends the request, retrying while the failure is transient and the deadline
 * allows. Free-tier endpoints answer 503 "high demand" often enough that one
 * attempt is not a working app; the same request usually succeeds seconds
 * later. Anything the caller could fix — a bad key, a wrong model — comes back
 * on the first attempt instead.
 */
async function post(
  apiKey: string,
  messages: ChatMessage[],
  jsonMode: boolean,
  deadline: number,
): Promise<Response> {
  // No temperature or top_p. Providers disagree on both the allowed range and
  // the default, and some reject non-default sampling parameters outright, so
  // the request carries only what every implementation accepts.
  const body: Record<string, unknown> = {
    model: modelName(),
    messages,
    max_tokens: MAX_OUTPUT_TOKENS,
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  const payload = JSON.stringify(body);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    let response: Response;
    try {
      response = await fetch(endpoint(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: payload,
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
        cache: "no-store",
      });
    } catch (error) {
      lastError = error;
      if (!(await pause(retryDelay(attempt, null), deadline))) break;
      continue;
    }

    if (response.ok || !RETRY_STATUSES.has(response.status)) return response;
    if (attempt === MAX_ATTEMPTS) return response;

    const delay = retryDelay(attempt, response.headers.get("retry-after"));
    if (delay === null) return response;
    // The body is not read on a retry; release it rather than leak the socket.
    await response.body?.cancel().catch(() => undefined);
    if (!(await pause(delay, deadline))) return response;
  }

  const name = lastError instanceof Error ? lastError.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    throw new SummarizeError(
      `モデル提供元 (${providerHost()}) が時間内に応答しませんでした。しばらく待ってから再試行してください。`,
    );
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new SummarizeError(`モデル提供元 (${providerHost()}) に接続できませんでした: ${reason}`);
}

/** How long to wait before the next attempt, or null if waiting is pointless. */
function retryDelay(attempt: number, retryAfter: string | null): number | null {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (!Number.isFinite(seconds)) return RETRY_BASE_DELAY_MS * attempt;
    const requested = seconds * 1000;
    return requested > MAX_RETRY_AFTER_MS ? null : requested;
  }
  return RETRY_BASE_DELAY_MS * attempt;
}

/** Waits, unless that would eat the deadline. Returns whether to try again. */
async function pause(delay: number | null, deadline: number): Promise<boolean> {
  if (delay === null) return false;
  if (Date.now() + delay >= deadline) return false;
  await new Promise((resolve) => setTimeout(resolve, delay));
  return true;
}

/** Reads the error body once and returns whatever explanation it carries. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof body.error === "string") return body.error;
    return body.error?.message ?? body.message ?? response.statusText;
  } catch {
    // Non-JSON error body; the status text stands.
    return response.statusText;
  }
}

/** Turns a provider error into something that says what to change. */
function describe(status: number, detail: string, response: Response): string {
  if (status === 401 || status === 403) {
    return `LLM_API_KEY が拒否されました (${status})。${providerHost()} で発行したキーか確認してください: ${detail}`;
  }
  if (status === 404) {
    return `モデル ${modelName()} が見つかりません (404)。LLM_MODEL と LLM_BASE_URL は組で変える必要があります: ${detail}`;
  }
  if (status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const wait = retryAfter ? `${retryAfter} 秒後に` : "しばらく待ってから";
    return `無料枠のレート上限に達しました (429)。${wait}再試行してください: ${detail}`;
  }
  if (status >= 500) {
    return `モデル提供元 (${providerHost()}) が ${MAX_ATTEMPTS} 回とも一時エラーを返しました (${status})。混雑しています。少し待つか、LLM_MODEL を別のモデルに変えてください: ${detail}`;
  }
  return `モデル提供元 (${providerHost()}) がエラーを返しました (${status}): ${detail}`;
}

/**
 * Only the assistant's text counts. Thinking models expose their reasoning as a
 * separate field or wrapped in <think> tags, and neither is the answer.
 */
function extractText(choice: ChatChoice): string {
  const content = choice.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((part) => part.type === undefined || part.type === "text")
            .map((part) => part.text ?? "")
            .join("")
        : "";

  return text.replace(/<think>[\s\S]*?<\/think>/gi, "");
}

/** Pulls the JSON object out of the response and validates its shape. */
export function parseSummary(text: string): Summary {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new SummarizeError("モデルの応答に JSON が含まれていませんでした。", clip(text));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SummarizeError(`モデルの応答を JSON として解析できませんでした: ${reason}`, clip(text));
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new SummarizeError("モデルの応答が期待した形式ではありません。", clip(text));
  }

  const record = parsed as Record<string, unknown>;
  const oneLine = typeof record.oneLine === "string" ? record.oneLine : null;
  if (!oneLine) {
    throw new SummarizeError("モデルの応答に oneLine がありません。", clip(text));
  }

  return {
    oneLine,
    stack: stringArray(record.stack),
    design: designNotes(record.design),
    entryPoints: entryPoints(record.entryPoints),
    caveats: typeof record.caveats === "string" && record.caveats.length > 0 ? record.caveats : null,
  };
}

function clip(text: string): string {
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function designNotes(value: unknown): DesignNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.title !== "string" || typeof record.detail !== "string") return [];
    return [{ title: record.title, detail: record.detail }];
  });
}

function entryPoints(value: unknown): EntryPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.path !== "string" || typeof record.why !== "string") return [];
    return [{ path: record.path, why: record.why }];
  });
}
