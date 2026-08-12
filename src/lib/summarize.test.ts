import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { RepoContext } from "./github";
import { parseSummary, privateReposAllowed, summarize, SummarizeError } from "./summarize";

const CONTEXT: RepoContext = {
  fullName: "octocat/hello",
  description: "test",
  topics: [],
  license: null,
  defaultBranch: "main",
  sizeKb: 10,
  stargazersCount: 1,
  pushedAt: "2026-01-01T00:00:00Z",
  isPrivate: false,
  isArchived: false,
  treeSha: "abc123",
  treeTruncated: false,
  fileCount: 1,
  fileList: ["index.ts"],
  languages: { TypeScript: 100 },
  readme: "# hello",
  manifests: [],
  sources: [],
};

const ANSWER = JSON.stringify({
  oneLine: "挨拶を返すだけのサンプル。",
  stack: ["TypeScript"],
  design: [{ title: "単一ファイル", detail: "分割していない。" }],
  entryPoints: [{ path: "index.ts", why: "唯一の入口。" }],
  caveats: null,
});

/** An OpenAI-compatible success body carrying `text` as the assistant message. */
function completion(text: string, finishReason = "stop"): Response {
  return Response.json({
    choices: [{ message: { role: "assistant", content: text }, finish_reason: finishReason }],
  });
}

type Call = { url: string; body: Record<string, unknown> };

/** Replaces fetch with a scripted queue of responses and records the requests. */
function stubFetch(responses: (() => Response)[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const next = responses.shift();
    assert.ok(next, "予定していないリクエストが飛んでいる");
    return next();
  }) as typeof fetch;
  return calls;
}

const realFetch = globalThis.fetch;

describe("summarize", () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://example.test/v1/";
    process.env.LLM_MODEL = "test-model";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.ALLOW_PRIVATE_REPOS;
  });

  it("posts to {base}/chat/completions with the key and the configured model", async () => {
    const calls = stubFetch([() => completion(ANSWER)]);

    const summary = await summarize(CONTEXT);

    assert.equal(summary.oneLine, "挨拶を返すだけのサンプル。");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.test/v1/chat/completions");
    assert.equal(calls[0].body.model, "test-model");
    // Sampling parameters are the thing providers disagree about; send neither.
    assert.equal(calls[0].body.temperature, undefined);
    assert.equal(calls[0].body.top_p, undefined);
  });

  it("retries without response_format when the provider rejects JSON mode", async () => {
    const calls = stubFetch([
      () => Response.json({ error: { message: 'Unknown name "response_format"' } }, { status: 400 }),
      () => completion(ANSWER),
    ]);

    const summary = await summarize(CONTEXT);

    assert.equal(summary.oneLine, "挨拶を返すだけのサンプル。");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
    assert.equal(calls[1].body.response_format, undefined);
  });

  it("does not retry a 400 that has nothing to do with JSON mode", async () => {
    const calls = stubFetch([
      () => Response.json({ error: { message: "context length exceeded" } }, { status: 400 }),
    ]);

    await assert.rejects(summarize(CONTEXT), (error: unknown) => {
      assert.ok(error instanceof SummarizeError);
      assert.match(error.message, /context length exceeded/);
      return true;
    });
    assert.equal(calls.length, 1);
  });

  it("retries a 503 and succeeds on the next attempt", async () => {
    const calls = stubFetch([
      () => Response.json({ error: { message: "high demand" } }, { status: 503 }),
      () => completion(ANSWER),
    ]);

    const summary = await summarize(CONTEXT);

    assert.equal(summary.oneLine, "挨拶を返すだけのサンプル。");
    assert.equal(calls.length, 2);
  });

  it("gives up after three attempts and says the provider is busy", async () => {
    const calls = stubFetch([
      () => Response.json({ error: { message: "high demand" } }, { status: 503 }),
      () => Response.json({ error: { message: "high demand" } }, { status: 503 }),
      () => Response.json({ error: { message: "high demand" } }, { status: 503 }),
    ]);

    await assert.rejects(summarize(CONTEXT), (error: unknown) => {
      assert.match((error as Error).message, /503/);
      assert.match((error as Error).message, /LLM_MODEL/);
      return true;
    });
    assert.equal(calls.length, 3);
  });

  it("does not wait out a Retry-After longer than the request is worth", async () => {
    const calls = stubFetch([
      () =>
        Response.json(
          { error: { message: "quota" } },
          { status: 429, headers: { "retry-after": "600" } },
        ),
    ]);

    await assert.rejects(summarize(CONTEXT), (error: unknown) => {
      assert.match((error as Error).message, /600 秒後に/);
      return true;
    });
    assert.equal(calls.length, 1);
  });

  it("does not retry a failure the user has to fix", async () => {
    const calls = stubFetch([() => Response.json({ error: { message: "bad key" } }, { status: 401 })]);

    await assert.rejects(summarize(CONTEXT));
    assert.equal(calls.length, 1);
  });

  it("names the model in a 404 and the wait in a 429", async () => {
    stubFetch([() => Response.json({ error: { message: "not found" } }, { status: 404 })]);
    await assert.rejects(summarize(CONTEXT), (error: unknown) => {
      assert.match((error as Error).message, /test-model/);
      return true;
    });

    stubFetch([
      () =>
        Response.json({ error: { message: "quota" } }, { status: 429, headers: { "retry-after": "31" } }),
    ]);
    await assert.rejects(summarize(CONTEXT), (error: unknown) => {
      assert.match((error as Error).message, /31 秒後に/);
      return true;
    });
  });

  it("drops thinking output and keeps the answer", async () => {
    stubFetch([() => completion(`<think>どう書くか迷う</think>\n${ANSWER}`)]);

    const summary = await summarize(CONTEXT);

    assert.equal(summary.stack[0], "TypeScript");
  });

  it("reports truncation instead of failing on half a JSON object", async () => {
    stubFetch([() => completion(ANSWER.slice(0, 40), "length")]);

    await assert.rejects(summarize(CONTEXT), (error: unknown) => {
      assert.ok(error instanceof SummarizeError);
      assert.match(error.message, /途中で切れました/);
      assert.ok(error.raw);
      return true;
    });
  });

  it("distinguishes a budget spent on thinking from a cut-off answer", async () => {
    stubFetch([() => completion("", "length")]);

    await assert.rejects(summarize(CONTEXT), (error: unknown) => {
      assert.match((error as Error).message, /推論に使い切られ/);
      return true;
    });
  });

  it("says which variable is missing when there is no key", async () => {
    delete process.env.LLM_API_KEY;
    stubFetch([]);

    await assert.rejects(summarize(CONTEXT), (error: unknown) => {
      assert.match((error as Error).message, /LLM_API_KEY/);
      return true;
    });
  });

  // .env.local is copied from .env.example, so unfilled variables arrive as ""
  // rather than as undefined. Treating those as set breaks every default.
  it("treats an empty variable as unset, not as a value", async () => {
    process.env.LLM_BASE_URL = "";
    process.env.LLM_MODEL = "  ";
    const calls = stubFetch([() => completion(ANSWER)]);

    await summarize(CONTEXT);

    assert.equal(
      calls[0].url,
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    assert.equal(calls[0].body.model, "gemini-3.6-flash");

    process.env.LLM_API_KEY = "";
    stubFetch([]);
    await assert.rejects(summarize(CONTEXT), /LLM_API_KEY/);
  });
});

describe("parseSummary", () => {
  it("finds the object even when the model wraps it in prose", () => {
    const summary = parseSummary(`はい、以下が結果です。\n\`\`\`json\n${ANSWER}\n\`\`\``);
    assert.equal(summary.entryPoints[0].path, "index.ts");
  });

  it("drops malformed entries rather than the whole summary", () => {
    const summary = parseSummary(
      JSON.stringify({
        oneLine: "ひとこと",
        stack: ["TypeScript", 42],
        design: [{ title: "だけ" }],
        entryPoints: [{ path: "a.ts", why: "入口" }, "b.ts"],
        caveats: "",
      }),
    );

    assert.deepEqual(summary.stack, ["TypeScript"]);
    assert.deepEqual(summary.design, []);
    assert.equal(summary.entryPoints.length, 1);
    assert.equal(summary.caveats, null);
  });

  it("keeps the raw response when there is nothing to parse", () => {
    assert.throws(
      () => parseSummary("申し訳ありませんが、お答えできません。"),
      (error: unknown) => {
        assert.ok(error instanceof SummarizeError);
        assert.equal(error.raw, "申し訳ありませんが、お答えできません。");
        return true;
      },
    );
  });

  it("refuses a summary with no oneLine", () => {
    assert.throws(() => parseSummary(JSON.stringify({ stack: ["Go"] })), SummarizeError);
  });
});

describe("privateReposAllowed", () => {
  afterEach(() => {
    delete process.env.ALLOW_PRIVATE_REPOS;
  });

  it("is off unless explicitly turned on", () => {
    assert.equal(privateReposAllowed(), false);
    process.env.ALLOW_PRIVATE_REPOS = "";
    assert.equal(privateReposAllowed(), false);
    process.env.ALLOW_PRIVATE_REPOS = "false";
    assert.equal(privateReposAllowed(), false);
    process.env.ALLOW_PRIVATE_REPOS = "true";
    assert.equal(privateReposAllowed(), true);
    process.env.ALLOW_PRIVATE_REPOS = "1";
    assert.equal(privateReposAllowed(), true);
  });
});
