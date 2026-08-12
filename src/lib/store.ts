import { promises as fs } from "node:fs";
import path from "node:path";

import { env } from "./env";
import type { CachedSummary, ReadingMap } from "./types";

/**
 * Two JSON files, both local, both gitignored.
 *
 * `reading.json` is the whole reason this file exists. Read state is private,
 * per-user and mutable; a GitHub star is public, shared and a signal to the
 * maintainer. Marking something read must never mean unstarring it, so read
 * state is written here and GitHub is only ever read from.
 */

const DATA_DIR = env("DATA_DIR") ?? path.join(process.cwd(), ".data");
const SUMMARY_FILE = path.join(DATA_DIR, "summaries.json");
const READING_FILE = path.join(DATA_DIR, "reading.json");
const LANGUAGE_FILE = path.join(DATA_DIR, "languages.json");

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
  await fs.mkdir(DATA_DIR, { recursive: true });
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
  const map = await readJson<SummaryMap>(SUMMARY_FILE, {});
  return map[key] ?? null;
}

export async function putSummary(key: string, summary: CachedSummary): Promise<void> {
  await queue(async () => {
    const map = await readJson<SummaryMap>(SUMMARY_FILE, {});
    map[key] = summary;
    await writeJson(SUMMARY_FILE, map);
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
  const map = await readJson<LanguageMap>(LANGUAGE_FILE, {});
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
    const map = await readJson<LanguageMap>(LANGUAGE_FILE, {});
    await writeJson(LANGUAGE_FILE, { ...map, ...entries });
  });
}

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

export async function getReading(): Promise<ReadingMap> {
  return readJson<ReadingMap>(READING_FILE, {});
}

export async function setReading(id: string, read: boolean): Promise<ReadingMap> {
  return queue(async () => {
    const map = await readJson<ReadingMap>(READING_FILE, {});
    if (read) {
      map[id] = { readAt: new Date().toISOString() };
    } else {
      delete map[id];
    }
    await writeJson(READING_FILE, map);
    return map;
  });
}
