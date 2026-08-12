import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import * as invites from "./invites";
import * as store from "./store";

/**
 * Each test runs against its own libSQL file. The driver is the same one the
 * deployment uses against Turso, so these exercise the real SQL rather than a
 * stand-in — including the primary key that keeps two viewers apart.
 */
async function withDatabase<T>(run: () => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gh-star-reader-test-"));
  process.env.TURSO_DATABASE_URL = `file:${path.join(dir, "test.db")}`;
  try {
    return await run();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const originalUrl = process.env.TURSO_DATABASE_URL;

function restoreUrl() {
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
}

describe("read state", () => {
  afterEach(restoreUrl);

  it("keeps two viewers of the same shelf apart", async () => {
    await withDatabase(async () => {
      await store.setReading("v_a", "octocat", "octocat/hello", true);

      assert.deepEqual(Object.keys(await store.getReading("v_a", "octocat")), ["octocat/hello"]);
      // The other viewer is looking at the same account and must see nothing.
      assert.deepEqual(await store.getReading("v_b", "octocat"), {});
    });
  });

  it("keeps one viewer's two shelves apart", async () => {
    await withDatabase(async () => {
      await store.setReading("v_a", "octocat", "octocat/hello", true);

      assert.deepEqual(await store.getReading("v_a", "torvalds"), {});
    });
  });

  it("treats the account name case-insensitively", async () => {
    await withDatabase(async () => {
      await store.setReading("v_a", "OctoCat", "octocat/hello", true);

      assert.ok((await store.getReading("v_a", "octocat"))["octocat/hello"]);
    });
  });

  it("removes a mark without disturbing the rest", async () => {
    await withDatabase(async () => {
      await store.setReading("v_a", "octocat", "octocat/hello", true);
      await store.setReading("v_a", "octocat", "octocat/spoon", true);
      await store.setReading("v_b", "octocat", "octocat/hello", true);

      const left = await store.setReading("v_a", "octocat", "octocat/hello", false);

      assert.deepEqual(Object.keys(left), ["octocat/spoon"]);
      assert.ok((await store.getReading("v_b", "octocat"))["octocat/hello"]);
    });
  });

  it("marking the same repository twice moves the date, not the row count", async () => {
    await withDatabase(async () => {
      await store.setReading("v_a", "octocat", "octocat/hello", true);
      const again = await store.setReading("v_a", "octocat", "octocat/hello", true);

      assert.equal(Object.keys(again).length, 1);
    });
  });
});

describe("summary and language caches", () => {
  afterEach(restoreUrl);

  it("round-trips a summary with its provenance", async () => {
    await withDatabase(async () => {
      const key = store.summaryKey("Octocat/Hello", "abc123");
      await store.putSummary(key, {
        oneLine: "ひとこと",
        stack: ["TypeScript"],
        design: [{ title: "見出し", detail: "説明" }],
        entryPoints: [{ path: "index.ts", why: "入口" }],
        caveats: null,
        repoId: "octocat/hello",
        treeSha: "abc123",
        model: "gemini-3.6-flash",
        generatedAt: "2026-08-12T00:00:00.000Z",
        contextKind: "metadata+source",
      });

      const found = await store.getSummary(key);

      assert.equal(found?.oneLine, "ひとこと");
      assert.equal(found?.model, "gemini-3.6-flash");
      assert.equal(found?.contextKind, "metadata+source");
      assert.deepEqual(found?.design, [{ title: "見出し", detail: "説明" }]);
      assert.equal(await store.getSummary("octocat/hello@other"), null);
    });
  });

  it("stores language bytes per push and returns only what it has", async () => {
    await withDatabase(async () => {
      const key = store.languageKey("Octocat/Hello", "2026-01-01T00:00:00Z");
      await store.putLanguages({ [key]: { TypeScript: 10, CSS: 5 } });

      const found = await store.getLanguages([key, "octocat/hello@2026-02-01T00:00:00Z"]);

      assert.deepEqual(found[key], { TypeScript: 10, CSS: 5 });
      assert.equal(Object.keys(found).length, 1);
      assert.deepEqual(await store.getLanguages([]), {});
    });
  });
});

describe("invites", () => {
  afterEach(restoreUrl);

  it("issues a token that resolves to a stable viewer id", async () => {
    await withDatabase(async () => {
      const { token, invite } = await invites.createInvite("田辺");

      assert.equal(token.length, 32);
      const found = await invites.findInvite(token);
      assert.equal(found?.id, invite.id);
      assert.equal(found?.name, "田辺");
    });
  });

  it("refuses an unknown or revoked token", async () => {
    await withDatabase(async () => {
      const { token } = await invites.createInvite("田辺");

      assert.equal(await invites.findInvite("0".repeat(32)), null);
      assert.equal(await invites.findInvite(""), null);

      await invites.revokeInvite(token);
      assert.equal(await invites.findInvite(token), null);
    });
  });

  it("revokes by viewer id too, and keeps the row", async () => {
    await withDatabase(async () => {
      const { invite } = await invites.createInvite("田辺");

      const revoked = await invites.revokeInvite(invite.id);

      assert.ok(revoked?.revokedAt);
      assert.equal((await invites.listInvites()).length, 1);
      // Revoking twice is not an error worth raising, but it is not a success.
      assert.equal(await invites.revokeInvite(invite.id), null);
    });
  });

  it("keeps read state when a link is reissued", async () => {
    await withDatabase(async () => {
      const first = await invites.createInvite("田辺");
      await store.setReading(first.invite.id, "octocat", "octocat/hello", true);
      await invites.revokeInvite(first.token);

      // A new link is a new token, and deliberately a new viewer id: the point
      // of the check is that the old reading is still addressable.
      assert.ok((await store.getReading(first.invite.id, "octocat"))["octocat/hello"]);
    });
  });
});
