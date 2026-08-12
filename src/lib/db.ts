import { createClient, type Client } from "@libsql/client";

import { env } from "./env";

/**
 * One libSQL connection for the process.
 *
 * The same driver speaks to a file and to Turso, so local runs and the deployed
 * one take the same code path — the only difference is the URL. That is the
 * whole reason for choosing libSQL over a hosted Postgres here: there is no
 * second implementation to keep honest.
 *
 *   local   file:./.data/gh-star-reader.db   (the default)
 *   Turso   libsql://<db>-<org>.turso.io     + TURSO_AUTH_TOKEN
 */

const DEFAULT_URL = "file:./.data/gh-star-reader.db";

let client: Client | null = null;
let clientUrl: string | null = null;
let ready: Promise<void> | null = null;

function databaseUrl(): string {
  return env("TURSO_DATABASE_URL") ?? DEFAULT_URL;
}

/**
 * The schema, applied on first use.
 *
 * Every table is either a cache that can be thrown away (summaries, languages)
 * or a small record that must not be (reading, invites). The split matters when
 * something goes wrong: dropping the first two costs time, dropping the last
 * two costs other people's data.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS summaries (
     key          TEXT PRIMARY KEY,
     repo_id      TEXT NOT NULL,
     tree_sha     TEXT NOT NULL,
     model        TEXT NOT NULL,
     generated_at TEXT NOT NULL,
     context_kind TEXT NOT NULL,
     payload      TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS languages (
     key       TEXT PRIMARY KEY,
     full_name TEXT NOT NULL,
     bytes     TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS invites (
     token      TEXT PRIMARY KEY,
     viewer_id  TEXT NOT NULL,
     name       TEXT NOT NULL,
     created_at TEXT NOT NULL,
     revoked_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS reading (
     viewer_id   TEXT NOT NULL,
     github_user TEXT NOT NULL,
     repo_id     TEXT NOT NULL,
     read_at     TEXT NOT NULL,
     PRIMARY KEY (viewer_id, github_user, repo_id)
   )`,
];

export async function db(): Promise<Client> {
  const url = databaseUrl();

  // The URL is read per call rather than captured once, so a test — or a script
  // pointed at a scratch file — can swap databases without reloading modules.
  if (!client || clientUrl !== url) {
    client = createClient({ url, authToken: env("TURSO_AUTH_TOKEN") });
    clientUrl = url;
    ready = null;
  }

  if (!ready) {
    const connection = client;
    ready = (async () => {
      for (const statement of SCHEMA) await connection.execute(statement);
    })().catch((error) => {
      // A failed migration must not be remembered as success.
      ready = null;
      throw error;
    });
  }
  await ready;

  return client;
}
