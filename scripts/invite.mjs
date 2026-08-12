#!/usr/bin/env node
// Mints, lists and revokes invite links by talking to a running instance.
//
//   npm run invite -- list
//   npm run invite -- add 田辺
//   npm run invite -- revoke <token または viewer id>
//
// The instance owns the database, so this speaks to it rather than to Turso —
// one place holds the schema, and the deployed app needs no shell access.
//
//   BASE_URL     既定は http://localhost:3000
//   ADMIN_TOKEN  デプロイ先に設定したものと同じ値

const BASE_URL = (process.env.BASE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim();

if (!ADMIN_TOKEN) {
  console.error("ADMIN_TOKEN が設定されていません。.env.local か環境変数で渡してください。");
  process.exit(1);
}

const endpoint = `${BASE_URL}/api/admin/invites`;
const headers = { "x-admin-token": ADMIN_TOKEN, "content-type": "application/json" };

async function call(method, path = "", body) {
  let response;
  try {
    response = await fetch(`${endpoint}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    console.error(`${BASE_URL} に接続できませんでした: ${error.message}`);
    console.error("BASE_URL が起動しているか確認してください。");
    process.exit(1);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`${response.status}: ${data.error ?? response.statusText}`);
    process.exit(1);
  }
  return data;
}

const [command, ...rest] = process.argv.slice(2);

if (command === "add") {
  const name = rest.join(" ").trim();
  if (!name) {
    console.error("名前が要ります: npm run invite -- add 田辺");
    process.exit(1);
  }
  const { path } = await call("POST", "", { name });
  console.log(`${name} 宛の招待リンク:`);
  console.log(`${BASE_URL}${path}`);
  console.log("\nこの URL を渡した相手は、開いた時点でその人として扱われます。");
  console.log("リンク自体が鍵なので、公開の場所には置かないでください。");
} else if (command === "revoke") {
  const target = rest[0]?.trim();
  if (!target) {
    console.error("token か viewer id が要ります。");
    process.exit(1);
  }
  const { invite } = await call("DELETE", `?target=${encodeURIComponent(target)}`);
  console.log(`${invite.name} の招待を失効させました。読了記録は残ります。`);
} else if (command === "list" || command === undefined) {
  const { invites } = await call("GET");
  if (invites.length === 0) console.log("招待はまだありません。");
  for (const { token, invite } of invites) {
    const state = invite.revokedAt ? "失効" : "有効";
    console.log(`${state}\t${invite.name}\t${invite.id}\t${BASE_URL}/i/${token}`);
  }
} else {
  console.error("使い方: npm run invite -- [list|add <名前>|revoke <token|id>]");
  process.exit(1);
}
