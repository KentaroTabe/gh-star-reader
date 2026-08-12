import { db } from "./db";
import type { CachedSummary, ReadingMap, Summary } from "./types";

/**
 * Everything mutable, in four tables.
 *
 * `reading` is the whole reason this file exists. Read state is private,
 * per-viewer and mutable; a GitHub star is public, shared and a signal to the
 * maintainer. Marking something read must never mean unstarring it, so read
 * state is written here and GitHub is only ever read from.
 */

// ---------------------------------------------------------------------------
// Summary cache
// ---------------------------------------------------------------------------

/**
 * Keyed by repository and tree SHA, not by viewer. Two things follow from that:
 * reopening a card never regenerates, and if two people happen to read the same
 * repository the second one is free. The sharing is a side effect of picking
 * the simplest key, not a feature that needed designing.
 */
export function summaryKey(fullName: string, treeSha: string): string {
  return `${fullName.toLowerCase()}@${treeSha}`;
}

export async function getSummary(key: string): Promise<CachedSummary | null> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT repo_id, tree_sha, model, generated_at, context_kind, payload FROM summaries WHERE key = ?",
    args: [key],
  });
  const row = result.rows[0];
  if (!row) return null;

  return {
    ...(JSON.parse(String(row.payload)) as Summary),
    repoId: String(row.repo_id),
    treeSha: String(row.tree_sha),
    model: String(row.model),
    generatedAt: String(row.generated_at),
    contextKind: String(row.context_kind) as CachedSummary["contextKind"],
  };
}

export async function putSummary(key: string, summary: CachedSummary): Promise<void> {
  const { repoId, treeSha, model, generatedAt, contextKind, ...rest } = summary;
  const client = await db();
  await client.execute({
    sql: `INSERT INTO summaries (key, repo_id, tree_sha, model, generated_at, context_kind, payload)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            model = excluded.model,
            generated_at = excluded.generated_at,
            context_kind = excluded.context_kind,
            payload = excluded.payload`,
    args: [key, repoId, treeSha, model, generatedAt, contextKind, JSON.stringify(rest)],
  });
}

// ---------------------------------------------------------------------------
// Language breakdown cache
// ---------------------------------------------------------------------------

/**
 * Keyed by the last push, for the same reason summaries are keyed by tree SHA:
 * the answer can only change when the repository does. No expiry to tune.
 */
export function languageKey(fullName: string, pushedAt: string): string {
  return `${fullName.toLowerCase()}@${pushedAt}`;
}

export async function getLanguages(keys: string[]): Promise<Record<string, Record<string, number>>> {
  if (keys.length === 0) return {};
  const client = await db();
  const result = await client.execute({
    sql: `SELECT key, bytes FROM languages WHERE key IN (${keys.map(() => "?").join(", ")})`,
    args: keys,
  });

  const found: Record<string, Record<string, number>> = {};
  for (const row of result.rows) {
    found[String(row.key)] = JSON.parse(String(row.bytes)) as Record<string, number>;
  }
  return found;
}

export async function putLanguages(
  entries: Record<string, Record<string, number>>,
): Promise<void> {
  const rows = Object.entries(entries);
  if (rows.length === 0) return;

  const client = await db();
  await client.batch(
    rows.map(([key, bytes]) => ({
      sql: `INSERT INTO languages (key, full_name, bytes) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET bytes = excluded.bytes`,
      args: [key, key.split("@")[0], JSON.stringify(bytes)],
    })),
    "write",
  );
}

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

/**
 * Addressed by two things at once: who is looking, and whose stars they are
 * looking at. Both are needed — one viewer browses several accounts, and
 * several viewers browse the same account — and a key missing either one lets
 * one person's "読了" erase another's. The primary key enforces it.
 */
export async function getReading(viewerId: string, githubUser: string): Promise<ReadingMap> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT repo_id, read_at FROM reading WHERE viewer_id = ? AND github_user = ?",
    args: [viewerId, githubUser.toLowerCase()],
  });

  const map: ReadingMap = {};
  for (const row of result.rows) {
    map[String(row.repo_id)] = { readAt: String(row.read_at) };
  }
  return map;
}

export async function setReading(
  viewerId: string,
  githubUser: string,
  id: string,
  read: boolean,
): Promise<ReadingMap> {
  const account = githubUser.toLowerCase();
  const client = await db();

  if (read) {
    await client.execute({
      sql: `INSERT INTO reading (viewer_id, github_user, repo_id, read_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(viewer_id, github_user, repo_id) DO UPDATE SET read_at = excluded.read_at`,
      args: [viewerId, account, id, new Date().toISOString()],
    });
  } else {
    await client.execute({
      sql: "DELETE FROM reading WHERE viewer_id = ? AND github_user = ? AND repo_id = ?",
      args: [viewerId, account, id],
    });
  }

  return getReading(viewerId, account);
}
