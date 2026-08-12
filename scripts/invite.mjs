#!/usr/bin/env node
// Mints, lists and revokes invite links. Run it wherever .data lives — locally
// for a local run, or inside the deployed machine for the deployed one.
//
//   node scripts/invite.mjs list
//   node scripts/invite.mjs add 田辺
//   node scripts/invite.mjs revoke <token または viewer id>
//
// BASE_URL decides what the printed link points at. Without it you get a path
// and can paste it after your own origin.

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR?.trim() || path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "invites.json");
const BASE_URL = (process.env.BASE_URL?.trim() || "").replace(/\/+$/, "");

async function read() {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

async function write(map) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${FILE}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(map, null, 2), "utf8");
  await fs.rename(temporary, FILE);
}

function link(token) {
  return BASE_URL ? `${BASE_URL}/i/${token}` : `/i/${token}`;
}

const [command, ...rest] = process.argv.slice(2);
const map = await read();

if (command === "add") {
  const name = rest.join(" ").trim();
  if (!name) {
    console.error("名前が要ります: node scripts/invite.mjs add 田辺");
    process.exit(1);
  }
  const token = randomBytes(16).toString("hex");
  map[token] = {
    id: `v_${randomBytes(6).toString("hex")}`,
    name,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };
  await write(map);
  console.log(`${name} 宛の招待リンク:`);
  console.log(link(token));
  console.log("\nこの URL を渡した相手は、開いた時点でその人として扱われます。");
  console.log("リンク自体が鍵なので、公開の場所には置かないでください。");
} else if (command === "revoke") {
  const target = rest[0]?.trim();
  const entry = Object.entries(map).find(([token, invite]) => token === target || invite.id === target);
  if (!entry) {
    console.error(`${target} に該当する招待がありません。`);
    process.exit(1);
  }
  map[entry[0]] = { ...entry[1], revokedAt: new Date().toISOString() };
  await write(map);
  console.log(`${entry[1].name} の招待を失効させました。読了記録は残ります。`);
} else if (command === "list" || command === undefined) {
  const rows = Object.entries(map);
  if (rows.length === 0) {
    console.log("招待はまだありません。");
  }
  for (const [token, invite] of rows) {
    const state = invite.revokedAt ? "失効" : "有効";
    console.log(`${state}\t${invite.name}\t${invite.id}\t${link(token)}`);
  }
} else {
  console.error("使い方: node scripts/invite.mjs [list|add <名前>|revoke <token|id>]");
  process.exit(1);
}
