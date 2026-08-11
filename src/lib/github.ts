import type { StarredRepo } from "./types";

const API = "https://api.github.com";

/**
 * Every call here is a read. This module deliberately exposes no way to
 * write to GitHub — no starring, no unstarring. Read state lives in ./store.
 */

export class GitHubError extends Error {
  status: number;
  rateLimitRemaining: string | null;
  rateLimitReset: string | null;

  constructor(
    status: number,
    message: string,
    rateLimitRemaining: string | null = null,
    rateLimitReset: string | null = null,
  ) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.rateLimitRemaining = rateLimitRemaining;
    this.rateLimitReset = rateLimitReset;
  }
}

function buildHeaders(accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gh-star-reader",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request(url: string, accept = "application/vnd.github+json"): Promise<Response> {
  const res = await fetch(url, { headers: buildHeaders(accept), cache: "no-store" });
  if (res.ok) return res;

  let detail = "";
  try {
    const body = (await res.json()) as { message?: string };
    detail = body.message ?? "";
  } catch {
    // Body was not JSON. The status alone will have to do.
  }
  throw new GitHubError(
    res.status,
    detail || res.statusText,
    res.headers.get("x-ratelimit-remaining"),
    res.headers.get("x-ratelimit-reset"),
  );
}

async function requestJson<T>(url: string, accept?: string): Promise<T> {
  const res = await request(url, accept);
  return (await res.json()) as T;
}

/** Returns null on 404 instead of throwing. Used for optional resources. */
async function optionalText(url: string, accept: string): Promise<string | null> {
  try {
    const res = await request(url, accept);
    return await res.text();
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

async function optionalJson<T>(url: string, accept?: string): Promise<T | null> {
  try {
    return await requestJson<T>(url, accept);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Starred list
// ---------------------------------------------------------------------------

type RawRepo = {
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  language: string | null;
  stargazers_count: number;
  html_url: string;
  pushed_at: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  topics?: string[];
  default_branch: string;
  size: number;
  license?: { spdx_id?: string | null; name?: string | null } | null;
};

type StarEnvelope = { starred_at: string; repo: RawRepo };

function toStarredRepo(envelope: StarEnvelope): StarredRepo {
  const repo = envelope.repo;
  return {
    id: repo.full_name.toLowerCase(),
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    language: repo.language,
    stargazersCount: repo.stargazers_count,
    htmlUrl: repo.html_url,
    pushedAt: repo.pushed_at,
    starredAt: envelope.starred_at,
    isPrivate: repo.private,
    isArchived: repo.archived,
    isFork: repo.fork,
    topics: repo.topics ?? [],
  };
}

/**
 * Lists everything a user has starred, newest star first (GitHub's own order).
 *
 * `application/vnd.github.star+json` is what makes `starred_at` available.
 * Without it the response is a bare repository list and the queue loses its
 * most useful column: how long something has been sitting unread.
 */
export async function fetchStarred(
  username: string,
  maxPages = 10,
): Promise<{ repos: StarredRepo[]; truncated: boolean }> {
  const repos: StarredRepo[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${API}/users/${encodeURIComponent(username)}/starred?per_page=100&page=${page}`;
    const batch = await requestJson<StarEnvelope[]>(url, "application/vnd.github.star+json");
    for (const item of batch) repos.push(toStarredRepo(item));
    if (batch.length < 100) return { repos, truncated: false };
  }

  return { repos, truncated: true };
}

// ---------------------------------------------------------------------------
// Repository context
// ---------------------------------------------------------------------------

export type SourceFile = { path: string; content: string };

export type RepoContext = {
  fullName: string;
  description: string | null;
  topics: string[];
  license: string | null;
  defaultBranch: string;
  sizeKb: number;
  stargazersCount: number;
  pushedAt: string;
  isPrivate: boolean;
  isArchived: boolean;
  /** Git tree SHA of the default branch. The cache key depends on this. */
  treeSha: string;
  treeTruncated: boolean;
  fileCount: number;
  fileList: string[];
  languages: Record<string, number>;
  readme: string | null;
  manifests: SourceFile[];
  sources: SourceFile[];
};

type TreeEntry = { path: string; type: string; size?: number; sha: string };
type TreeResponse = { sha: string; tree: TreeEntry[]; truncated: boolean };

const MANIFEST_FILES = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "pubspec.yaml",
  "Package.swift",
  "mix.exs",
  "deno.json",
  "CMakeLists.txt",
  "Makefile",
  "justfile",
  "Dockerfile",
  "docker-compose.yml",
  "flake.nix",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".rb", ".java", ".kt", ".kts", ".swift",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".php",
  ".ex", ".exs", ".scala", ".lua", ".dart", ".vue", ".svelte",
  ".sh", ".sql", ".zig", ".hs", ".ml", ".pl", ".r", ".jl", ".clj",
]);

const SKIP_DIRECTORY = /(^|\/)(node_modules|vendor|dist|build|out|target|third_party|\.git|\.next|__pycache__|testdata|fixtures|examples?)\//i;
const SKIP_FILE = /(\.min\.[a-z]+$|-lock\.json$|\.lock$|\.generated\.|_pb2?\.py$|\.d\.ts$)/i;

/** Repositories above these thresholds get metadata-only summaries. */
const SOURCE_MAX_CODE_FILES = 60;
const SOURCE_MAX_REPO_KB = 4000;
const SOURCE_MAX_FILES_FETCHED = 12;
const SOURCE_MAX_CHARS_PER_FILE = 6000;
const SOURCE_MAX_CHARS_TOTAL = 90_000;

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function depthOf(path: string): number {
  return path.split("/").length;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… (${text.length - limit} 文字省略)`;
}

/**
 * Gathers everything the model needs to describe a repository.
 *
 * For small repositories this includes actual source files. That is not a
 * fallback — a 40-file project fits comfortably in context, and reading the
 * code produces a far better summary than reading the README about the code.
 */
export async function fetchRepoContext(owner: string, name: string): Promise<RepoContext> {
  const meta = await requestJson<RawRepo>(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  const slug = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const branch = meta.default_branch;

  const [languages, tree, readme] = await Promise.all([
    optionalJson<Record<string, number>>(`${API}/repos/${slug}/languages`),
    optionalJson<TreeResponse>(`${API}/repos/${slug}/git/trees/${encodeURIComponent(branch)}?recursive=1`),
    optionalText(`${API}/repos/${slug}/readme`, "application/vnd.github.raw"),
  ]);

  const entries = tree?.tree ?? [];
  const blobs = entries.filter((entry) => entry.type === "blob");

  const manifestPaths = blobs
    .filter((entry) => !entry.path.includes("/") && MANIFEST_FILES.has(entry.path))
    .slice(0, 5)
    .map((entry) => entry.path);

  const codeFiles = blobs.filter((entry) => {
    if (SKIP_DIRECTORY.test(entry.path)) return false;
    if (SKIP_FILE.test(entry.path)) return false;
    return CODE_EXTENSIONS.has(extensionOf(entry.path));
  });

  const includeSource =
    tree !== null &&
    !tree.truncated &&
    codeFiles.length > 0 &&
    codeFiles.length <= SOURCE_MAX_CODE_FILES &&
    meta.size <= SOURCE_MAX_REPO_KB;

  const sourcePaths = includeSource
    ? [...codeFiles]
        .sort((a, b) => depthOf(a.path) - depthOf(b.path) || (b.size ?? 0) - (a.size ?? 0))
        .slice(0, SOURCE_MAX_FILES_FETCHED)
        .map((entry) => entry.path)
    : [];

  const [manifests, sources] = await Promise.all([
    fetchFiles(slug, manifestPaths, SOURCE_MAX_CHARS_PER_FILE, Number.POSITIVE_INFINITY),
    fetchFiles(slug, sourcePaths, SOURCE_MAX_CHARS_PER_FILE, SOURCE_MAX_CHARS_TOTAL),
  ]);

  return {
    fullName: meta.full_name,
    description: meta.description,
    topics: meta.topics ?? [],
    license: meta.license?.spdx_id ?? meta.license?.name ?? null,
    defaultBranch: branch,
    sizeKb: meta.size,
    stargazersCount: meta.stargazers_count,
    pushedAt: meta.pushed_at,
    isPrivate: meta.private,
    isArchived: meta.archived,
    treeSha: tree?.sha ?? "empty",
    treeTruncated: tree?.truncated ?? false,
    fileCount: blobs.length,
    fileList: blobs
      .map((entry) => entry.path)
      .filter((path) => !SKIP_DIRECTORY.test(path))
      .slice(0, 250),
    languages: languages ?? {},
    readme: readme === null ? null : truncate(readme, 20_000),
    manifests,
    sources,
  };
}

async function fetchFiles(
  slug: string,
  paths: string[],
  perFileLimit: number,
  totalLimit: number,
): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  let budget = totalLimit;

  const results = await Promise.all(
    paths.map((path) =>
      optionalText(`${API}/repos/${slug}/contents/${encodePath(path)}`, "application/vnd.github.raw"),
    ),
  );

  for (let i = 0; i < paths.length; i++) {
    const content = results[i];
    if (content === null) continue;
    if (budget <= 0) break;
    const clipped = truncate(content, Math.min(perFileLimit, budget));
    budget -= clipped.length;
    files.push({ path: paths[i], content: clipped });
  }

  return files;
}
