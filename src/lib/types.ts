/** A repository the user has starred, plus when they starred it. */
export type StarredRepo = {
  /** "owner/name", lowercased. Stable identifier across the app. */
  id: string;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stargazersCount: number;
  htmlUrl: string;
  /** ISO 8601. Last push to the repository. */
  pushedAt: string;
  /** ISO 8601. When this user starred it. The queue is ordered by this. */
  starredAt: string;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  topics: string[];
};

export type DesignNote = {
  title: string;
  detail: string;
};

export type EntryPoint = {
  path: string;
  why: string;
};

/** What the model is asked to produce for a single repository. */
export type Summary = {
  oneLine: string;
  stack: string[];
  design: DesignNote[];
  entryPoints: EntryPoint[];
  caveats: string | null;
};

/** A summary as stored on disk, with provenance. */
export type CachedSummary = Summary & {
  repoId: string;
  /** Git tree SHA of the default branch. Changes if and only if content changes. */
  treeSha: string;
  model: string;
  generatedAt: string;
  contextKind: "metadata" | "metadata+source";
};

/** Read state. Lives here, never on GitHub. */
export type ReadingRecord = {
  readAt: string;
};

export type ReadingMap = Record<string, ReadingRecord>;
