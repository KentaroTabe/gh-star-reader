import { currentViewer, unauthorized } from "@/lib/auth";
import { fetchLanguages, GitHubError } from "@/lib/github";
import { getLanguages, languageKey, putLanguages } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How many uncached repositories one request will fetch, and how many of those
 * run at once. A shelf of 500 stars is 500 requests against a 5,000/hour
 * budget; asking for them in bounded batches keeps one page load from spending
 * the whole allowance, and lets the client paint what it already has.
 */
const MAX_FETCHED_PER_REQUEST = 60;
const CONCURRENCY = 8;

type Item = { fullName?: string; pushedAt?: string };
type Body = { repos?: Item[] };

export async function POST(request: Request) {
  if (!(await currentViewer())) return unauthorized();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const items = (body.repos ?? []).flatMap((item) =>
    typeof item?.fullName === "string" && typeof item?.pushedAt === "string"
      ? [{ fullName: item.fullName, pushedAt: item.pushedAt }]
      : [],
  );
  if (items.length === 0) {
    return Response.json({ languages: {}, remaining: 0 });
  }

  try {
    const keys = items.map((item) => languageKey(item.fullName, item.pushedAt));
    const cached = await getLanguages(keys);

    const missing = items.filter((item, index) => !cached[keys[index]]);
    const batch = missing.slice(0, MAX_FETCHED_PER_REQUEST);

    const fetched: Record<string, Record<string, number>> = {};
    for (let start = 0; start < batch.length; start += CONCURRENCY) {
      const slice = batch.slice(start, start + CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (item) => {
          try {
            return await fetchLanguages(item.fullName);
          } catch (error) {
            // One unreadable repository must not cost the whole shelf its
            // colours. An empty breakdown falls back to the primary language.
            if (error instanceof GitHubError && error.status === 404) return {};
            throw error;
          }
        }),
      );
      slice.forEach((item, index) => {
        fetched[languageKey(item.fullName, item.pushedAt)] = results[index];
      });
    }

    await putLanguages(fetched);

    // Keyed by repository for the client; it has no reason to know about the
    // cache key.
    const languages: Record<string, Record<string, number>> = {};
    items.forEach((item, index) => {
      const entry = cached[keys[index]] ?? fetched[keys[index]];
      if (entry) languages[item.fullName.toLowerCase()] = entry;
    });

    return Response.json({ languages, remaining: missing.length - batch.length });
  } catch (error) {
    if (error instanceof GitHubError) {
      const message =
        error.status === 403 && error.rateLimitRemaining === "0"
          ? "GitHub API のレート上限に達したため、言語構成を取得できませんでした。GITHUB_TOKEN を設定すると 60 → 5,000 リクエスト/時になります。"
          : `GitHub API がエラーを返しました (${error.status}): ${error.message}`;
      return Response.json({ error: message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `言語構成を取得できませんでした: ${message}` }, { status: 500 });
  }
}
