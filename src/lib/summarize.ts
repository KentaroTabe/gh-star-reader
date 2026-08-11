import type { RepoContext } from "./github";
import { buildPrompt } from "./prompt";
import type { DesignNote, EntryPoint, Summary } from "./types";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";

export class SummarizeError extends Error {
  /** Raw model output, when the failure was a parse failure. Shown in the UI. */
  raw: string | null;

  constructor(message: string, raw: string | null = null) {
    super(message);
    this.name = "SummarizeError";
    this.raw = raw;
  }
}

type ContentBlock = { type: string; text?: string };
type MessagesResponse = { content: ContentBlock[] };

export function modelName(): string {
  return process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
}

export async function summarize(context: RepoContext): Promise<Summary> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new SummarizeError(
      "ANTHROPIC_API_KEY が設定されていません。.env.example を .env.local にコピーして値を入れてください。",
    );
  }

  const { system, user } = buildPrompt(context);

  const response = await fetch(MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    // No temperature or top_p. Sonnet 5 rejects non-default sampling
    // parameters with a 400, so they are omitted rather than set to a value.
    body: JSON.stringify({
      model: modelName(),
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? detail;
    } catch {
      // Non-JSON error body; the status text stands.
    }
    throw new SummarizeError(`Claude API がエラーを返しました (${response.status}): ${detail}`);
  }

  const body = (await response.json()) as MessagesResponse;

  // Adaptive thinking is on by default, so the response can contain blocks
  // other than text. Only text blocks carry the answer.
  const text = body.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");

  return parseSummary(text);
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
