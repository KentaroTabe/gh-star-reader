"use client";

import type { CachedSummary, StarredRepo } from "@/lib/types";

type Props = {
  repo: StarredRepo;
  summary: CachedSummary | undefined;
  loading: boolean;
  error: string | null;
  isRead: boolean;
  onToggleRead: () => void;
};

export default function SummaryPanel({
  repo,
  summary,
  loading,
  error,
  isRead,
  onToggleRead,
}: Props) {
  if (loading) {
    return <div className="panel"><p className="panel__status">読み解いています…</p></div>;
  }

  if (error) {
    return (
      <div className="panel">
        <p className="panel__error">{error}</p>
        <div className="panel__actions">
          <a className="action action--link" href={repo.htmlUrl} target="_blank" rel="noreferrer">
            GitHub で開く
          </a>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="panel">
      <p className="panel__oneline">{summary.oneLine}</p>

      {summary.stack.length > 0 && (
        <section className="panel__section">
          <h3 className="panel__heading">使用技術</h3>
          <ul className="chips">
            {summary.stack.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {summary.design.length > 0 && (
        <section className="panel__section">
          <h3 className="panel__heading">設計上の工夫</h3>
          <ul className="notes">
            {summary.design.map((note) => (
              <li key={note.title}>
                <div className="notes__title">{note.title}</div>
                <p className="notes__detail">{note.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.entryPoints.length > 0 && (
        <section className="panel__section">
          <h3 className="panel__heading">読む順序</h3>
          <ol className="route">
            {summary.entryPoints.map((entry) => (
              <li key={entry.path}>
                <div>
                  <a
                    className="route__path"
                    href={`${repo.htmlUrl}/blob/HEAD/${entry.path}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {entry.path}
                  </a>
                  <p className="route__why">{entry.why}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {summary.caveats && <p className="panel__caveat">{summary.caveats}</p>}

      <div className="panel__actions">
        <button
          type="button"
          className={isRead ? "action action--done" : "action"}
          onClick={onToggleRead}
        >
          {isRead ? "読了を取り消す" : "読了にする"}
        </button>
        <a className="action action--link" href={repo.htmlUrl} target="_blank" rel="noreferrer">
          GitHub で開く
        </a>
        <span className="panel__provenance">
          {summary.contextKind === "metadata+source" ? "ソース読解" : "メタ情報のみ"} ·{" "}
          {summary.model} · {summary.treeSha.slice(0, 7)}
        </span>
      </div>
    </div>
  );
}
