import { currentViewer, unauthorized } from "@/lib/auth";
import { fetchStarred, GitHubError } from "@/lib/github";
import { privateReposAllowed } from "@/lib/summarize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await currentViewer())) return unauthorized();

  const username = new URL(request.url).searchParams.get("user")?.trim();

  if (!username) {
    return Response.json({ error: "GitHub のユーザー名を入力してください。" }, { status: 400 });
  }

  try {
    const { repos, truncated } = await fetchStarred(username);

    // GITHUB_TOKEN belongs to whoever runs the server, not to whoever is
    // looking. Anything it can see that the public cannot — private stars —
    // would otherwise be published to every invited viewer.
    const visible = privateReposAllowed() ? repos : repos.filter((repo) => !repo.isPrivate);

    return Response.json({ username, repos: visible, truncated });
  } catch (error) {
    if (error instanceof GitHubError) {
      return Response.json({ error: describe(error, username) }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `スター一覧を取得できませんでした: ${message}` }, { status: 500 });
  }
}

function describe(error: GitHubError, username: string): string {
  if (error.status === 404) {
    return `ユーザー ${username} が見つかりません。綴りを確認してください。`;
  }
  if (error.status === 403 && error.rateLimitRemaining === "0") {
    const reset = error.rateLimitReset
      ? new Date(Number(error.rateLimitReset) * 1000).toLocaleTimeString("ja-JP")
      : null;
    return [
      "GitHub API のレート上限に達しました。",
      reset ? `${reset} に回復します。` : "",
      "GITHUB_TOKEN を設定すると 60 → 5,000 リクエスト/時になります。",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (error.status === 401) {
    return "GITHUB_TOKEN が無効です。トークンを再発行して .env.local を更新してください。";
  }
  return `GitHub API がエラーを返しました (${error.status}): ${error.message}`;
}
