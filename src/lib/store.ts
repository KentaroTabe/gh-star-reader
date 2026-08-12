import { promises as fs } from "node:fs";
import path from "node:path";

import { env } from "./env";
import type { CachedSummary, ReadingMap, ReadingStore, ViewerReading } from "./types";

/**
 * Two JSON files, both local, both gitignored.
 *
 * `reading.json` is the whole reason this file exists. Read state is private,
 * per-user and mutable; a GitHub star is public, shared and a signal to the
 * maintainer. Marking something read must never mean unstarring it, so read
 * state is written here and GitHub is only ever read from.
 */

/**
 * Resolved per call, not once at import. Where the data lives is a property of
 * the running process, and reading it at module load froze it before anything
 * could set it — which is how an empty DATA_DIR once became mkdir("").
 */
function dataDir(): string {
  return env("DATA_DIR") ?? path.join(process.cwd(), ".data");
}

function summaryFile(): string {
  return path.join(dataDir(), "summaries.json");
}

function readingFile(): string {
  return path.join(dataDir(), "reading.json");
}

function languageFile(): string {
  return path.join(dataDir(), "languages.json");
}

type SummaryMap = Record<string, CachedSummary>;
type LanguageMap = Record<string, Record<string, number>>;

/** Serialises writes so two concurrent requests can't clobber each other. */
let writeChain: Promise<unknown> = Promise.resolve();

function queue<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => undefined);
  return next;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    // Missing or corrupt file. Starting from empty is the right recovery here:
    // both files are caches of things that can be regenerated or re-marked.
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temporary, file);
}

// ---------------------------------------------------------------------------
// Summary cache
// ---------------------------------------------------------------------------

/**
 * Keyed by repository and tree SHA, not by user. Two things follow from that:
 * reopening a card never regenerates, and if two users happen to read the same
 * repository the second one is free. The sharing is a side effect of picking
 * the simplest key, not a feature that needed designing.
 */
export function summaryKey(fullName: string, treeSha: string): string {
  return `${fullName.toLowerCase()}@${treeSha}`;
}

export async function getSummary(key: string): Promise<CachedSummary | null> {
  const map = await readJson<SummaryMap>(summaryFile(), {});
  return map[key] ?? null;
}

export async function putSummary(key: string, summary: CachedSummary): Promise<void> {
  await queue(async () => {
    const map = await readJson<SummaryMap>(summaryFile(), {});
    map[key] = summary;
    await writeJson(summaryFile(), map);
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

export async function getLanguages(keys: string[]): Promise<LanguageMap> {
  const map = await readJson<LanguageMap>(languageFile(), {});
  const found: LanguageMap = {};
  for (const key of keys) {
    const entry = map[key];
    if (entry) found[key] = entry;
  }
  return found;
}

export async function putLanguages(entries: LanguageMap): Promise<void> {
  if (Object.keys(entries).length === 0) return;
  await queue(async () => {
    const map = await readJson<LanguageMap>(languageFile(), {});
    await writeJson(languageFile(), { ...map, ...entries });
  });
}

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

/**
 * Read state is addressed by two things at once: who is looking, and whose
 * stars they are looking at. Both are needed — one viewer browses several
 * accounts, and several viewers browse the same account — and a key missing
 * either one lets one person's "読了" erase another's.
 */
function bucket(store: ReadingStore, viewerId: string, githubUser: string): ReadingMap {
  return store[viewerId]?.[githubUser.toLowerCase()] ?? {};
}

/**
 * Reads the file, discarding anything that is not the two-level shape.
 *
 * The first version of this file was flat (repoId -> record) with no viewer and
 * no account, so old entries cannot be attributed to either and are dropped
 * rather than guessed at. Losing read marks is recoverable; assigning them to
 * the wrong person is not.
 */
async function readStore(): Promise<ReadingStore> {
  const raw = await readJson<Record<string, unknown>>(readingFile(), {});
  const store: ReadingStore = {};
  for (const [viewerId, byUser] of Object.entries(raw)) {
    if (typeof byUser !== "object" || byUser === null) continue;
    const viewer: ViewerReading = {};
    for (const [githubUser, entries] of Object.entries(byUser as Record<string, unknown>)) {
      if (typeof entries !== "object" || entries === null) continue;
      const map: ReadingMap = {};
      for (const [repoId, record] of Object.entries(entries as Record<string, unknown>)) {
        const readAt = (record as { readAt?: unknown })?.readAt;
        if (typeof readAt === "string") map[repoId] = { readAt };
      }
      if (Object.keys(map).length > 0) viewer[githubUser.toLowerCase()] = map;
    }
    if (Object.keys(viewer).length > 0) store[viewerId] = viewer;
  }
  return store;
}

export async function getReading(viewerId: string, githubUser: string): Promise<ReadingMap> {
  return bucket(await readStore(), viewerId, githubUser);
}

export async function setReading(
  viewerId: string,
  githubUser: string,
  id: string,
  read: boolean,
): Promise<ReadingMap> {
  const account = githubUser.toLowerCase();
  return queue(async () => {
    const store = await readStore();
    const map = { ...bucket(store, viewerId, account) };
    if (read) {
      map[id] = { readAt: new Date().toISOString() };
    } else {
      delete map[id];
    }
    store[viewerId] = { ...store[viewerId], [account]: map };
    await writeJson(readingFile(), store);
    return map;
  });
}
