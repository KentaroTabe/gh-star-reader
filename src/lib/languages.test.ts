import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aggregateLanguages, dominantLanguage, matchesSelection, OTHER, UNKNOWN } from "./languages";
import type { StarredRepo } from "./types";

function repo(name: string, language: string | null): StarredRepo {
  return {
    id: `owner/${name}`,
    owner: "owner",
    name,
    fullName: `owner/${name}`,
    description: null,
    language,
    stargazersCount: 0,
    htmlUrl: `https://github.com/owner/${name}`,
    pushedAt: "2026-01-01T00:00:00Z",
    starredAt: "2026-01-01T00:00:00Z",
    isPrivate: false,
    isArchived: false,
    isFork: false,
    topics: [],
  };
}

function share(shares: ReturnType<typeof aggregateLanguages>, name: string): number {
  return shares.find((item) => item.name === name)?.share ?? 0;
}

describe("aggregateLanguages", () => {
  it("gives every repository the same weight, whatever its size", () => {
    const repos = [repo("huge", "Rust"), repo("tiny", "Elixir")];
    // Two orders of magnitude apart in bytes, and deliberately irrelevant.
    const breakdowns = {
      "owner/huge": { Rust: 10_000_000 },
      "owner/tiny": { Elixir: 100 },
    };

    const shares = aggregateLanguages(repos, breakdowns);

    assert.equal(share(shares, "Rust"), 0.5);
    assert.equal(share(shares, "Elixir"), 0.5);
  });

  it("splits one repository's weight across its own languages", () => {
    const repos = [repo("mixed", "TypeScript"), repo("pure", "Go")];
    const breakdowns = {
      "owner/mixed": { TypeScript: 75, CSS: 25 },
      "owner/pure": { Go: 1 },
    };

    const shares = aggregateLanguages(repos, breakdowns);

    // Half the shelf is the mixed repository, and three quarters of that is TS.
    assert.equal(share(shares, "TypeScript"), 0.375);
    assert.equal(share(shares, "CSS"), 0.125);
    assert.equal(share(shares, "Go"), 0.5);
  });

  it("counts a repository whose breakdown has not arrived yet", () => {
    const shares = aggregateLanguages([repo("a", "Python"), repo("b", "Python")], {});

    assert.equal(share(shares, "Python"), 1);
  });

  it("files a repository with no language at all under 不明", () => {
    const shares = aggregateLanguages([repo("a", null)], {});

    assert.equal(share(shares, UNKNOWN), 1);
  });

  it("reports how many repositories each language leads", () => {
    const repos = [repo("a", "Rust"), repo("b", "Rust"), repo("c", "Go")];
    const breakdowns = { "owner/a": { Rust: 90, Go: 10 } };

    const shares = aggregateLanguages(repos, breakdowns);

    assert.equal(shares.find((item) => item.name === "Rust")?.repoCount, 2);
    assert.equal(shares.find((item) => item.name === "Go")?.repoCount, 1);
  });

  it("folds the tail into one selectable segment", () => {
    const repos = ["a", "b", "c", "d"].map((name) => repo(name, "TypeScript"));
    const breakdowns = {
      "owner/a": { TypeScript: 100 },
      "owner/b": { Go: 100 },
      "owner/c": { Rust: 100 },
      "owner/d": { Elixir: 100 },
    };

    const shares = aggregateLanguages(repos, breakdowns, 2);

    assert.equal(shares.length, 3);
    const other = shares[2];
    assert.equal(other.name, OTHER);
    assert.equal(other.folded.length, 2);
    // Nothing is lost in the folding: the segments still describe the whole.
    assert.ok(Math.abs(shares.reduce((sum, item) => sum + item.share, 0) - 1) < 1e-9);
  });

  it("has nothing to say about an empty shelf", () => {
    assert.deepEqual(aggregateLanguages([], {}), []);
  });
});

describe("dominantLanguage", () => {
  it("prefers the breakdown over the primary language", () => {
    assert.equal(dominantLanguage(repo("a", "TypeScript"), { CSS: 900, TypeScript: 100 }), "CSS");
  });

  it("falls back to the primary language, then to 不明", () => {
    assert.equal(dominantLanguage(repo("a", "Go"), undefined), "Go");
    assert.equal(dominantLanguage(repo("a", "Go"), {}), "Go");
    assert.equal(dominantLanguage(repo("a", null), undefined), UNKNOWN);
  });
});

describe("matchesSelection", () => {
  const repos = [repo("a", "Rust"), repo("b", "Go"), repo("c", "Elixir")];
  const shares = aggregateLanguages(repos, {}, 1);

  it("keeps only the repositories the chosen language leads", () => {
    const rust = shares.find((item) => item.name === "Rust");
    assert.ok(rust);
    assert.deepEqual(
      repos.filter((item) => matchesSelection(item, undefined, rust)).map((item) => item.name),
      ["a"],
    );
  });

  it("その他 keeps exactly what the named segments do not", () => {
    const other = shares.find((item) => item.name === OTHER);
    assert.ok(other);
    assert.deepEqual(
      repos.filter((item) => matchesSelection(item, undefined, other)).map((item) => item.name),
      ["b", "c"],
    );
  });
});
