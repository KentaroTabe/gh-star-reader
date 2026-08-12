import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { env } from "./env";

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

/** Resolved per call, for the same reason as in ./store. */
function dataDir(): string {
  return env("DATA_DIR") ?? path.join(process.cwd(), ".data");
}

function inviteFile(): string {
  return path.join(dataDir(), "invites.json");
}

/** 16 bytes of randomness: too much to guess, short enough to paste. */
const TOKEN_BYTES = 16;

export type Invite = {
  /** Stable identity used as the key for this viewer's read state. */
  id: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
};

/** token -> invite. The token is never used as the read-state key, so that
 *  reissuing a link does not throw away what that person has read. */
type InviteMap = Record<string, Invite>;

async function readInvites(): Promise<InviteMap> {
  try {
    return JSON.parse(await fs.readFile(inviteFile(), "utf8")) as InviteMap;
  } catch {
    // No file yet means nobody has been invited.
    return {};
  }
}

async function writeInvites(map: InviteMap): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  const file = inviteFile();
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(map, null, 2), "utf8");
  await fs.rename(temporary, file);
}

export async function findInvite(token: string): Promise<Invite | null> {
  if (!token) return null;
  const invite = (await readInvites())[token];
  if (!invite || invite.revokedAt) return null;
  return invite;
}

export async function listInvites(): Promise<{ token: string; invite: Invite }[]> {
  const map = await readInvites();
  return Object.entries(map).map(([token, invite]) => ({ token, invite }));
}

export async function createInvite(name: string): Promise<{ token: string; invite: Invite }> {
  const map = await readInvites();
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const invite: Invite = {
    id: `v_${randomBytes(6).toString("hex")}`,
    name,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };
  map[token] = invite;
  await writeInvites(map);
  return { token, invite };
}

/** Revokes by token or by viewer id. Read state is kept; only access stops. */
export async function revokeInvite(tokenOrId: string): Promise<Invite | null> {
  const map = await readInvites();
  const entry = Object.entries(map).find(
    ([token, invite]) => token === tokenOrId || invite.id === tokenOrId,
  );
  if (!entry) return null;
  const [token, invite] = entry;
  map[token] = { ...invite, revokedAt: new Date().toISOString() };
  await writeInvites(map);
  return map[token];
}
