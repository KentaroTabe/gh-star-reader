"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Shelf from "@/components/Shelf";
import SummaryPanel from "@/components/SummaryPanel";
import { compactCount, relativeAge, yearMonth } from "@/lib/format";
import { languageColor } from "@/lib/languageColors";
import type { CachedSummary, ReadingMap, StarredRepo } from "@/lib/types";

type SortKey = "oldest" | "newest" | "stale" | "stars";

const SORT_LABELS: Record<SortKey, string> = {
  oldest: "スターが古い順",
  newest: "スターが新しい順",
  stale: "更新が止まっている順",
  stars: "スター数が多い順",
};

/**
 * Rounds of language fetching per list. The server answers with what it has
 * cached plus a bounded batch of new lookups, so a full shelf takes a few
 * rounds; the ceiling is only here to stop a bug from looping forever.
 */
const MAX_LANGUAGE_ROUNDS = 20;

export default function Reader({ viewerName }: { viewerName: string | null }) {
  const [username, setUsername] = useState("");
  /** The account whose shelf is on screen. Read state is filed under it. */
  const [account, setAccount] = useState<string | null>(null);
  const [repos, setRepos] = useState<StarredRepo[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  /** Bytes per language, keyed by lowercased full name. Fills in after the list. */
  const [breakdowns, setBreakdowns] = useState<Record<string, Record<string, number>>>({});
  const [reading, setReading] = useState<ReadingMap>({});
  const [summaries, setSummaries] = useState<Record<string, CachedSummary>>({});
  const [pending, setPending] = useState<Record<string, true>>({});
  const [summaryErrors, setSummaryErrors] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const [unreadOnly, setUnreadOnly] = useState(true);
  const [language, setLanguage] = useState("all");
  const [sort, setSort] = useState<SortKey>("oldest");

  // Read state belongs to a pair — this viewer, this GitHub account — so it can
  // only be fetched once we know whose shelf is being opened.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    fetch(`/api/reading?user=${encodeURIComponent(account)}`)
      .then((response) => response.json())
      .then((data: { reading?: ReadingMap }) => {
        if (!cancelled) setReading(data.reading ?? {});
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [account]);

  // The shelf paints each repository by its language mix, which the starred
  // list does not carry — it names one language per repository. Fetched after
  // the list is on screen so a large shelf colours in progressively rather than
  // holding up the first paint.
  useEffect(() => {
    if (!repos || repos.length === 0) return;
    let cancelled = false;

    const load = async () => {
      const wanted = repos.map((repo) => ({ fullName: repo.fullName, pushedAt: repo.pushedAt }));
      for (let round = 0; round < MAX_LANGUAGE_ROUNDS && !cancelled; round++) {
        const response = await fetch("/api/languages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repos: wanted }),
        });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as {
          languages?: Record<string, Record<string, number>>;
          remaining?: number;
        };
        if (cancelled) return;
        setBreakdowns((current) => ({ ...current, ...(data.languages ?? {}) }));
        if (!data.remaining) return;
      }
    };

    // A failure here costs colour, not function: the shelf keeps the primary
    // language it already had.
    void load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repos]);

  const loadStars = useCallback(async (name: string) => {
    setLoading(true);
    setListError(null);
    setOpenId(null);
    try {
      const response = await fetch(`/api/starred?user=${encodeURIComponent(name)}`);
      const data = (await response.json()) as {
        repos?: StarredRepo[];
        truncated?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "取得に失敗しました。");
      setRepos(data.repos ?? []);
      setBreakdowns({});
      setReading({});
      setAccount(name);
      setTruncated(Boolean(data.truncated));
    } catch (error) {
      setRepos(null);
      setAccount(null);
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Nothing is summarised until a card is opened, and never twice. */
  const openEntry = useCallback(
    async (repo: StarredRepo) => {
      if (openId === repo.id) {
        setOpenId(null);
        return;
      }
      setOpenId(repo.id);
      if (summaries[repo.id] || pending[repo.id]) return;

      setPending((current) => ({ ...current, [repo.id]: true }));
      setSummaryErrors((current) => {
        const next = { ...current };
        delete next[repo.id];
        return next;
      });

      try {
        const response = await fetch("/api/summary", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: repo.owner, name: repo.name }),
        });
        const data = (await response.json()) as {
          summary?: CachedSummary;
          error?: string;
          raw?: string | null;
        };
        if (!response.ok || !data.summary) {
          throw new Error(
            [data.error ?? "要約を生成できませんでした。", data.raw ? `\n\n${data.raw}` : ""].join(""),
          );
        }
        setSummaries((current) => ({ ...current, [repo.id]: data.summary as CachedSummary }));
      } catch (error) {
        setSummaryErrors((current) => ({
          ...current,
          [repo.id]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setPending((current) => {
          const next = { ...current };
          delete next[repo.id];
          return next;
        });
      }
    },
    [openId, pending, summaries],
  );

  const toggleRead = useCallback(async (user: string, id: string, read: boolean) => {
    // Optimistic: the write target is a local file, so failure is unlikely and
    // recoverable. The star on GitHub is untouched either way.
    setReading((current) => {
      const next = { ...current };
      if (read) next[id] = { readAt: new Date().toISOString() };
      else delete next[id];
      return next;
    });
    try {
      const response = await fetch("/api/reading", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user, id, read }),
      });
      const data = (await response.json()) as { reading?: ReadingMap };
      if (data.reading) setReading(data.reading);
    } catch {
      // Leave the optimistic state; the next page load re-reads the file.
    }
  }, []);

  const languages = useMemo(() => {
    if (!repos) return [];
    const seen = new Map<string, number>();
    for (const repo of repos) {
      if (!repo.language) continue;
      seen.set(repo.language, (seen.get(repo.language) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [repos]);

  const visible = useMemo(() => {
    if (!repos) return [];
    const filtered = repos.filter((repo) => {
      if (unreadOnly && reading[repo.id]) return false;
      if (language !== "all" && repo.language !== language) return false;
      return true;
    });

    const compare: Record<SortKey, (a: StarredRepo, b: StarredRepo) => number> = {
      oldest: (a, b) => Date.parse(a.starredAt) - Date.parse(b.starredAt),
      newest: (a, b) => Date.parse(b.starredAt) - Date.parse(a.starredAt),
      stale: (a, b) => Date.parse(a.pushedAt) - Date.parse(b.pushedAt),
      stars: (a, b) => b.stargazersCount - a.stargazersCount,
    };

    return [...filtered].sort(compare[sort]);
  }, [repos, reading, unreadOnly, language, sort]);

  const unreadCount = repos?.filter((repo) => !reading[repo.id]).length ?? 0;
  const oldestUnread = useMemo(() => {
    if (!repos) return null;
    const unread = repos.filter((repo) => !reading[repo.id]);
    if (unread.length === 0) return null;
    return unread.reduce((oldest, repo) =>
      Date.parse(repo.starredAt) < Date.parse(oldest.starredAt) ? repo : oldest,
    );
  }, [repos, reading]);

  return (
    <main className="shell">
      <header className="masthead">
        <p className="masthead__eyebrow">gh-star-reader</p>
        <h1 className="masthead__title">スターは、まだ読んでいない本の山です。</h1>
        <p className="masthead__lede">
          GitHub のスター一覧を古い順に並べ直し、開いたものだけ、使われている技術と設計の工夫、
          そしてどのファイルから読めばいいかを要約します。
        </p>

        <form
          className="lookup"
          onSubmit={(event) => {
            event.preventDefault();
            const name = username.trim();
            if (name) void loadStars(name);
          }}
        >
          <label className="lookup__field">
            <span className="lookup__at" aria-hidden="true">
              github.com/
            </span>
            <input
              className="lookup__input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="ユーザー名"
              aria-label="GitHub のユーザー名"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button className="lookup__submit" type="submit" disabled={loading}>
            {loading ? "取得中" : "本棚を開く"}
          </button>
        </form>
      </header>

      {listError && <p className="notice notice--error">{listError}</p>}

      {truncated && (
        <p className="notice">
          スターが 1,000 件を超えています。古い分は表示していません。
        </p>
      )}

      {repos && repos.length > 0 && (
        <>
          <section className="tally">
            <div>
              <span className="tally__figure tally__figure--unread">{unreadCount}</span>
              <span className="tally__label">未読</span>
            </div>
            <div>
              <span className="tally__figure">{repos.length}</span>
              <span className="tally__label">スター総数</span>
            </div>
            {oldestUnread && (
              <div>
                <span className="tally__figure">{yearMonth(oldestUnread.starredAt)}</span>
                <span className="tally__label">最も古い未読</span>
              </div>
            )}
          </section>

          <Shelf
            repos={visible}
            reading={reading}
            languages={breakdowns}
            selectedId={openId}
            onSelect={(id) => {
              const repo = visible.find((item) => item.id === id);
              if (repo) void openEntry(repo);
            }}
          />

          <div className="controls">
            <label className="controls__toggle">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) => setUnreadOnly(event.target.checked)}
              />
              未読のみ
            </label>

            <span className="controls__group">
              言語
              <select
                className="controls__select"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                aria-label="言語で絞り込む"
              >
                <option value="all">すべて</option>
                {languages.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </span>

            <span className="controls__group">
              並び
              <select
                className="controls__select"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                aria-label="並び順"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </span>

            <span className="controls__count">{visible.length} 件</span>
          </div>

          <ul className="entries">
            {visible.map((repo) => {
              const isRead = Boolean(reading[repo.id]);
              const isOpen = openId === repo.id;
              return (
                <li
                  key={repo.id}
                  className="entry"
                  data-read={isRead}
                  style={{ ["--tick-color" as string]: languageColor(repo.language) }}
                >
                  <button
                    type="button"
                    className="entry__head"
                    onClick={() => void openEntry(repo)}
                    aria-expanded={isOpen}
                  >
                    <span className="entry__tick" aria-hidden="true" />
                    <span className="entry__name">
                      <span className="entry__owner">{repo.owner}/</span>
                      {repo.name}
                    </span>
                    <span className="entry__age">
                      {relativeAge(repo.starredAt)}にスター
                    </span>
                    {repo.description && <p className="entry__desc">{repo.description}</p>}
                    <span className="entry__meta">
                      {repo.language && <span>{repo.language}</span>}
                      <span>★ {compactCount(repo.stargazersCount)}</span>
                      <span>最終更新 {relativeAge(repo.pushedAt)}</span>
                      {repo.isArchived && <span className="entry__flag">アーカイブ済み</span>}
                      {repo.isFork && <span>フォーク</span>}
                      {isRead && <span>読了</span>}
                    </span>
                  </button>

                  {isOpen && (
                    <SummaryPanel
                      repo={repo}
                      summary={summaries[repo.id]}
                      loading={Boolean(pending[repo.id])}
                      error={summaryErrors[repo.id] ?? null}
                      isRead={isRead}
                      onToggleRead={() => account && void toggleRead(account, repo.id, !isRead)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {repos && repos.length === 0 && (
        <p className="empty">このユーザーはまだ何もスターしていません。</p>
      )}

      {!repos && !listError && !loading && (
        <p className="empty">
          ユーザー名を入れると、スターした順に本棚が並びます。要約は開いたときに作られるので、
          最初の表示は待たされません。
        </p>
      )}

      <footer className="colophon">
        <p>
          スターは読み取り専用です。読了の記録はサーバー側に保存され、GitHub 側のスターは変更されません。
          {viewerName && `（${viewerName} として閲覧中。読了はあなた専用です）`}
        </p>
      </footer>
    </main>
  );
}
