import { randomBytes } from "node:crypto";

import { db } from "./db";

/**
 * The whole access model, in one file.
 *
 * There is no login. Each person gets a URL containing a token; opening it once
 * exchanges the token for a cookie. The token is the credential, so treat the
 * link as one — anyone holding it is that viewer.
 *
 * Names exist only so the owner can tell rows apart when revoking. Nothing else
 * in the app reads them.
 */

/** 16 bytes of randomness: too much to guess, short enough to paste. */
const TOKEN_BYTES = 16;

export type Invite = {
  /** Stable identity used as the key for this viewer's read state. */
  id: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
};

type Row = {
  viewer_id: unknown;
  name: unknown;
  created_at: unknown;
  revoked_at: unknown;
};

function toInvite(row: Row): Invite {
  return {
    id: String(row.viewer_id),
    name: String(row.name),
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at === null ? null : String(row.revoked_at),
  };
}

export async function findInvite(token: string): Promise<Invite | null> {
  if (!token) return null;
  const client = await db();
  const result = await client.execute({
    sql: "SELECT viewer_id, name, created_at, revoked_at FROM invites WHERE token = ? AND revoked_at IS NULL",
    args: [token],
  });
  const row = result.rows[0];
  return row ? toInvite(row as unknown as Row) : null;
}

export async function listInvites(): Promise<{ token: string; invite: Invite }[]> {
  const client = await db();
  const result = await client.execute(
    "SELECT token, viewer_id, name, created_at, revoked_at FROM invites ORDER BY created_at",
  );
  return result.rows.map((row) => ({
    token: String(row.token),
    invite: toInvite(row as unknown as Row),
  }));
}

/** The token is returned once, here. It is not recoverable from the row later
 *  by design — the link is a credential, and reissuing is cheap. */
export async function createInvite(name: string): Promise<{ token: string; invite: Invite }> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const invite: Invite = {
    id: `v_${randomBytes(6).toString("hex")}`,
    name,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };

  const client = await db();
  await client.execute({
    sql: "INSERT INTO invites (token, viewer_id, name, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)",
    args: [token, invite.id, invite.name, invite.createdAt],
  });

  return { token, invite };
}

/** Revokes by token or by viewer id. Read state is kept; only access stops. */
export async function revokeInvite(tokenOrId: string): Promise<Invite | null> {
  const client = await db();
  const result = await client.execute({
    sql: `UPDATE invites SET revoked_at = ?
          WHERE (token = ? OR viewer_id = ?) AND revoked_at IS NULL
          RETURNING viewer_id, name, created_at, revoked_at`,
    args: [new Date().toISOString(), tokenOrId, tokenOrId],
  });
  const row = result.rows[0];
  return row ? toInvite(row as unknown as Row) : null;
}
