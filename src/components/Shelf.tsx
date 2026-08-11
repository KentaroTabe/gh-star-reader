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

type Props = {
  repos: StarredRepo[];
  reading: ReadingMap;
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
export default function Shelf({ repos, reading, selectedId, onSelect }: Props) {
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
                background: languageColor(repo.language),
              }}
              title={`${repo.fullName} — ${relativeAge(repo.starredAt)}にスター${isRead ? "・読了" : ""}`}
              aria-label={`${repo.fullName}、${relativeAge(repo.starredAt)}にスター${isRead ? "、読了済み" : "、未読"}`}
              onClick={() => onSelect(repo.id)}
            />
          );
        })}
      </div>
      <p className="shelf__legend">
        <span>古いスター</span>
        <span>高いほど長く未読 / 色は言語</span>
        <span>新しいスター</span>
      </p>
    </div>
  );
}
