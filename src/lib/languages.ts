import type { StarredRepo } from "./types";

/**
 * The language composition of a whole shelf.
 *
 * Every repository counts the same, whatever its size. Weighting by bytes would
 * let one vendored monorepo decide what the whole shelf looks like, and the
 * question being asked here is "what do the things I star tend to be written
 * in", not "where are the bytes".
 */

/** Beyond this the segments are too thin to hit, and the tail is folded in. */
export const TOP_LANGUAGES = 8;
export const OTHER = "その他";
export const UNKNOWN = "不明";

export type LanguageShare = {
  name: string;
  /** 0–1 of the whole shelf. */
  share: number;
  /** Repositories this language leads. What selecting the segment shows. */
  repoCount: number;
  /** For OTHER, the languages folded into it. Empty otherwise. */
  folded: string[];
};

/**
 * The one language a repository counts as, for filtering.
 *
 * The breakdown decides it when there is one; GitHub's own primary language is
 * the fallback, and it is what the list rows show, so the two agree in the
 * common case.
 */
export function dominantLanguage(
  repo: StarredRepo,
  breakdown: Record<string, number> | undefined,
): string {
  if (breakdown) {
    let best: string | null = null;
    let bestBytes = 0;
    for (const [name, bytes] of Object.entries(breakdown)) {
      if (bytes > bestBytes) {
        best = name;
        bestBytes = bytes;
      }
    }
    if (best) return best;
  }
  return repo.language ?? UNKNOWN;
}

/** Bytes to fractions within one repository, or all of it on one language. */
function repoShares(
  repo: StarredRepo,
  breakdown: Record<string, number> | undefined,
): Map<string, number> {
  const shares = new Map<string, number>();
  const entries = breakdown ? Object.entries(breakdown).filter(([, bytes]) => bytes > 0) : [];
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);

  if (total === 0) {
    // No breakdown yet, or GitHub reports none: the repository still counts,
    // as one whole vote for the language it is filed under.
    shares.set(repo.language ?? UNKNOWN, 1);
    return shares;
  }

  for (const [name, bytes] of entries) shares.set(name, bytes / total);
  return shares;
}

export function aggregateLanguages(
  repos: StarredRepo[],
  breakdowns: Record<string, Record<string, number>>,
  topLanguages = TOP_LANGUAGES,
): LanguageShare[] {
  if (repos.length === 0) return [];

  const totals = new Map<string, number>();
  const leads = new Map<string, number>();
  const weight = 1 / repos.length;

  for (const repo of repos) {
    const breakdown = breakdowns[repo.id];
    for (const [name, share] of repoShares(repo, breakdown)) {
      totals.set(name, (totals.get(name) ?? 0) + share * weight);
    }
    const dominant = dominantLanguage(repo, breakdown);
    leads.set(dominant, (leads.get(dominant) ?? 0) + 1);
  }

  const ranked = [...totals.entries()]
    .map(([name, share]) => ({ name, share, repoCount: leads.get(name) ?? 0, folded: [] }))
    .sort((a, b) => b.share - a.share);

  const kept = ranked.slice(0, topLanguages);
  const rest = ranked.slice(topLanguages);
  if (rest.length === 0) return kept;

  // The tail is one segment rather than a fringe of unclickable slivers. It
  // stays selectable: what it selects is every repository the named segments
  // do not lead.
  return [
    ...kept,
    {
      name: OTHER,
      share: rest.reduce((sum, item) => sum + item.share, 0),
      repoCount: rest.reduce((sum, item) => sum + item.repoCount, 0),
      folded: rest.map((item) => item.name),
    },
  ];
}

/** Whether a repository belongs to the selected segment. */
export function matchesSelection(
  repo: StarredRepo,
  breakdown: Record<string, number> | undefined,
  selected: LanguageShare,
): boolean {
  const dominant = dominantLanguage(repo, breakdown);
  return selected.name === OTHER
    ? selected.folded.includes(dominant)
    : dominant === selected.name;
}
