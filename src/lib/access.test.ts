import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

/**
 * Both modules resolve DATA_DIR per call, so pointing it at a fresh directory
 * is enough to isolate a test. Nothing here touches the real .data.
 */
async function withDataDir<T>(run: (modules: {
  store: typeof import("./store");
  invites: typeof import("./invites");
}) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gh-star-reader-test-"));
  process.env.DATA_DIR = dir;
  try {
    const [store, invites] = await Promise.all([import("./store"), import("./invites")]);
    return await run({ store, invites });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const originalDataDir = process.env.DATA_DIR;

describe("read state", () => {
  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("keeps two viewers of the same shelf apart", async () => {
    await withDataDir(async ({ store }) => {
      await store.setReading("v_a", "octocat", "octocat/hello", true);

      assert.deepEqual(Object.keys(await store.getReading("v_a", "octocat")), ["octocat/hello"]);
      // The other viewer is looking at the same account and must see nothing.
      assert.deepEqual(await store.getReading("v_b", "octocat"), {});
    });
  });

  it("keeps one viewer's two shelves apart", async () => {
    await withDataDir(async ({ store }) => {
      await store.setReading("v_a", "octocat", "octocat/hello", true);

      assert.deepEqual(await store.getReading("v_a", "torvalds"), {});
    });
  });

  it("treats the account name case-insensitively", async () => {
    await withDataDir(async ({ store }) => {
      await store.setReading("v_a", "OctoCat", "octocat/hello", true);

      assert.ok((await store.getReading("v_a", "octocat"))["octocat/hello"]);
    });
  });

  it("removes a mark without disturbing the rest", async () => {
    await withDataDir(async ({ store }) => {
      await store.setReading("v_a", "octocat", "octocat/hello", true);
      await store.setReading("v_a", "octocat", "octocat/spoon", true);
      await store.setReading("v_b", "octocat", "octocat/hello", true);

      const left = await store.setReading("v_a", "octocat", "octocat/hello", false);

      assert.deepEqual(Object.keys(left), ["octocat/spoon"]);
      assert.ok((await store.getReading("v_b", "octocat"))["octocat/hello"]);
    });
  });

  it("drops the old flat file rather than attributing it to someone", async () => {
    await withDataDir(async ({ store }) => {
      const file = path.join(process.env.DATA_DIR as string, "reading.json");
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ "octocat/hello": { readAt: "2026-01-01" } }), "utf8");

      assert.deepEqual(await store.getReading("owner", "octocat"), {});
    });
  });
});

describe("invites", () => {
  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("issues a token that resolves to a stable viewer id", async () => {
    await withDataDir(async ({ invites }) => {
      const { token, invite } = await invites.createInvite("田辺");

      assert.equal(token.length, 32);
      const found = await invites.findInvite(token);
      assert.equal(found?.id, invite.id);
      assert.equal(found?.name, "田辺");
    });
  });

  it("refuses an unknown or revoked token", async () => {
    await withDataDir(async ({ invites }) => {
      const { token } = await invites.createInvite("田辺");

      assert.equal(await invites.findInvite("0".repeat(32)), null);
      assert.equal(await invites.findInvite(""), null);

      await invites.revokeInvite(token);
      assert.equal(await invites.findInvite(token), null);
    });
  });

  it("revokes by viewer id too, and keeps the row", async () => {
    await withDataDir(async ({ invites }) => {
      const { invite } = await invites.createInvite("田辺");

      const revoked = await invites.revokeInvite(invite.id);

      assert.ok(revoked?.revokedAt);
      assert.equal((await invites.listInvites()).length, 1);
    });
  });
});
