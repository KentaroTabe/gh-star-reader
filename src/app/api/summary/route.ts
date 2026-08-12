import { currentViewer, unauthorized } from "@/lib/auth";
import { fetchRepoContext, GitHubError } from "@/lib/github";
import { getSummary, putSummary, summaryKey } from "@/lib/store";
import { modelName, privateReposAllowed, summarize, SummarizeError } from "@/lib/summarize";
import type { CachedSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = { owner?: string; name?: string };

export async function POST(request: Request) {
  if (!(await currentViewer())) return unauthorized();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const owner = body.owner?.trim();
  const name = body.name?.trim();
  if (!owner || !name) {
    return Response.json({ error: "owner と name が必要です。" }, { status: 400 });
  }

  try {
    // Nothing is generated until someone opens a card, and the tree SHA is what
    // decides whether the previous answer is still valid.
    const context = await fetchRepoContext(owner, name);

    // Summarising means sending the contents to a third party. For public
    // repositories that changes nothing; for a private one it is a disclosure,
    // so it takes an explicit opt-in.
    if (context.isPrivate && !privateReposAllowed()) {
      return Response.json(
        {
          error:
            "プライベートリポジトリの要約は既定で行いません。内容がモデル提供元に送られるためです。許可する場合は .env.local に ALLOW_PRIVATE_REPOS=true を設定してください。",
        },
        { status: 403 },
      );
    }

    const key = summaryKey(context.fullName, context.treeSha);

    const cached = await getSummary(key);
    if (cached) {
      return Response.json({ summary: cached, cached: true });
    }

    const summary = await summarize(context);
    const record: CachedSummary = {
      ...summary,
      repoId: context.fullName.toLowerCase(),
      treeSha: context.treeSha,
      model: modelName(),
      generatedAt: new Date().toISOString(),
      contextKind: context.sources.length > 0 ? "metadata+source" : "metadata",
    };

    // Private repositories are readable by this user and no one else. Their
    // contents must not end up in a cache that is keyed only by name.
    if (!context.isPrivate) {
      await putSummary(key, record);
    }

    return Response.json({ summary: record, cached: false });
  } catch (error) {
    if (error instanceof GitHubError) {
      const message =
        error.status === 404
          ? `${owner}/${name} が見つかりません。削除または改名された可能性があります。`
          : `GitHub API がエラーを返しました (${error.status}): ${error.message}`;
      return Response.json({ error: message }, { status: error.status });
    }
    if (error instanceof SummarizeError) {
      return Response.json({ error: error.message, raw: error.raw }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `要約を生成できませんでした: ${message}` }, { status: 500 });
  }
}
