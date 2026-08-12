"use client";

import { daysSince, relativeAge } from "@/lib/format";
import { languageColor } from "@/lib/languageColors";
import type { ReadingMap, StarredRepo } from "@/lib/types";

/** Three years unread reaches full height. Past that the point is made. */
const FULL_HEIGHT_DAYS = 1095;

function spineHeight(repo: StarredRepo, isRead: boolean): string {
  if (isRead) return "16%";
  const ratio = Math.min(daysSince(repo.starredAt) / FULL_HEIGHT_DAYS, 1);
  return `${28 + ratio * 72}%`;
}

/** Below this a slice is a hairline nobody can read; folding it in is honest. */
const MIN_SHARE = 0.03;

/**
 * A spine painted with the repository's language breakdown, divided left to
 * right in proportion to bytes. The single primary language is what the row
 * below says; the shelf says what the repository is actually made of, which for
 * most projects is three or four languages, not one.
 *
 * Across the bar rather than up it, so the height stays one thing only: how
 * long this has gone unread. Two quantities on the same axis read as one.
 *
 * Falls back to the flat primary colour while the breakdown is still loading,
 * or when GitHub reports none.
 */
function spineBackground(repo: StarredRepo, languages: Record<string, number> | undefined): string {
  const fallback = languageColor(repo.language);
  if (!languages) return fallback;

  const entries = Object.entries(languages).filter(([, bytes]) => bytes > 0);
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  if (total === 0) return fallback;

  const shares = entries
    .map(([name, bytes]) => ({ name, share: bytes / total }))
    .filter(({ share }) => share >= MIN_SHARE)
    .sort((a, b) => b.share - a.share);
  if (shares.length === 0) return fallback;
  if (shares.length === 1) return languageColor(shares[0].name);

  // Dropped slices are given back proportionally, so the stops still reach 100%.
  const kept = shares.reduce((sum, { share }) => sum + share, 0);

  const stops: string[] = [];
  let cursor = 0;
  shares.forEach(({ name, share }, index) => {
    const end = index === shares.length - 1 ? 100 : cursor + (share / kept) * 100;
    stops.push(`${languageColor(name)} ${cursor.toFixed(2)}% ${end.toFixed(2)}%`);
    cursor = end;
  });

  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** "TypeScript 62% / CSS 24% / Shell 14%" — the hover tooltip for a spine. */
function describeLanguages(languages: Record<string, number> | undefined): string {
  if (!languages) return "";
  const entries = Object.entries(languages).filter(([, bytes]) => bytes > 0);
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  if (total === 0) return "";
  const parts = entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, bytes]) => `${name} ${Math.round((bytes / total) * 100)}%`);
  return `\n${parts.join(" / ")}`;
}

type Props = {
  repos: StarredRepo[];
  reading: ReadingMap;
  /** Bytes per language, keyed by lowercased full name. Absent until fetched. */
  languages: Record<string, Record<string, number>>;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * The pile, rendered as a shelf.
 *
 * Ordered oldest star first, so the tall bars on the left are the things that
 * have been waiting longest. A list can tell you there are 127 unread
 * repositories; this tells you what that feels like.
 */
export default function Shelf({ repos, reading, languages, selectedId, onSelect }: Props) {
  if (repos.length === 0) return null;

  const ordered = [...repos].sort(
    (a, b) => Date.parse(a.starredAt) - Date.parse(b.starredAt),
  );

  return (
    <div className="shelf">
      <div className="shelf__rail" role="list" aria-label="スターした順の本棚">
        {ordered.map((repo) => {
          const isRead = Boolean(reading[repo.id]);
          return (
            <button
              key={repo.id}
              type="button"
              role="listitem"
              className="spine"
              data-read={isRead}
              data-selected={repo.id === selectedId}
              style={{
                height: spineHeight(repo, isRead),
                background: spineBackground(repo, languages[repo.id]),
              }}
              title={`${repo.fullName} — ${relativeAge(repo.starredAt)}にスター${isRead ? "・読了" : ""}${describeLanguages(languages[repo.id])}`}
              aria-label={`${repo.fullName}、${relativeAge(repo.starredAt)}にスター${isRead ? "、読了済み" : "、未読"}`}
              onClick={() => onSelect(repo.id)}
            />
          );
        })}
      </div>
      <p className="shelf__legend">
        <span>古いスター</span>
        <span>高いほど長く未読 / 色は言語構成</span>
        <span>新しいスター</span>
      </p>
    </div>
  );
}
