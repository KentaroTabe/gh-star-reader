import type { RepoContext } from "./github";

const SYSTEM = `あなたはOSSのコードリーディングを支援するアシスタントです。
与えられたリポジトリの情報を読み、これから読もうとしている学習者向けに要約します。

出力は必ず次の形の JSON のみとし、前後に説明文やコードフェンスを付けないでください。

{
  "oneLine": "このリポジトリが何をするものかを一文で",
  "stack": ["使用技術。言語・フレームワーク・主要ライブラリを具体名で3〜8個"],
  "design": [
    { "title": "設計上の工夫の見出し（15文字程度）", "detail": "2〜3文の説明" }
  ],
  "entryPoints": [
    { "path": "リポジトリ内の実在するパス", "why": "そこから読むべき理由を1〜2文で" }
  ],
  "caveats": "情報が不足していて判断できなかった点。無ければ null"
}

制約:
- 日本語で書く。
- design は2〜4件、entryPoints は3〜5件。
- entryPoints の path は、与えられたファイル一覧に実在するものだけを使う。推測でパスを作らない。
- ソースコードが与えられていない場合、コードの内部構造を断定しない。READMEや依存関係から読み取れる範囲にとどめ、不確かな点は caveats に書く。
- 「優れた」「モダンな」といった評価語ではなく、何がどう作られているかを書く。`;

function section(title: string, body: string | null | undefined): string {
  if (!body) return "";
  return `\n## ${title}\n${body}\n`;
}

function languageBreakdown(languages: Record<string, number>): string | null {
  const entries = Object.entries(languages);
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  if (total === 0) return null;
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, bytes]) => `- ${name}: ${((bytes / total) * 100).toFixed(1)}%`)
    .join("\n");
}

function files(items: { path: string; content: string }[]): string | null {
  if (items.length === 0) return null;
  return items.map((file) => `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\``).join("\n\n");
}

export function buildPrompt(context: RepoContext): { system: string; user: string } {
  const facts = [
    `- リポジトリ: ${context.fullName}`,
    `- 説明: ${context.description ?? "（なし）"}`,
    `- スター数: ${context.stargazersCount}`,
    `- 最終更新: ${context.pushedAt}`,
    `- 規模: ${context.fileCount} ファイル / 約 ${context.sizeKb} KB`,
    `- ライセンス: ${context.license ?? "（不明）"}`,
    context.topics.length > 0 ? `- トピック: ${context.topics.join(", ")}` : "",
    context.isArchived ? "- このリポジトリはアーカイブ済みです。" : "",
    context.treeTruncated ? "- ファイル一覧は大きすぎるため一部のみです。" : "",
  ]
    .filter(Boolean)
    .join("\n");

  const sourceNote =
    context.sources.length > 0
      ? "以下は実際のソースコードです。構造や工夫はここから読み取ってください。"
      : "ソースコードは規模が大きいため添付していません。README・依存関係・ファイル構成から読み取れる範囲で答えてください。";

  const user = [
    `# ${context.fullName}`,
    section("基本情報", facts),
    section("言語構成", languageBreakdown(context.languages)),
    section("ファイル構成", context.fileList.length > 0 ? context.fileList.join("\n") : null),
    section("README", context.readme),
    section("依存関係の定義", files(context.manifests)),
    section("ソースコード", files(context.sources)),
    `\n---\n${sourceNote}`,
  ]
    .filter(Boolean)
    .join("");

  return { system: SYSTEM, user };
}
