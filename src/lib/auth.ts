import { cookies } from "next/headers";

import { env } from "./env";
import { findInvite, type Invite } from "./invites";

export const COOKIE_NAME = "reader_token";
/** A year. The link is meant to be handed over once and then forgotten. */
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Whether a viewer needs an invite.
 *
 * Deployed, yes — the URL is reachable by anyone who finds it. Running locally,
 * no: it is your own machine and your own stars, and demanding a token to open
 * localhost would only train you to keep one lying around. INVITE_REQUIRED
 * overrides both directions.
 */
export function inviteRequired(): boolean {
  const setting = env("INVITE_REQUIRED")?.toLowerCase();
  if (setting === "true" || setting === "1") return true;
  if (setting === "false" || setting === "0") return false;
  return process.env.NODE_ENV === "production";
}

export type Viewer = { id: string; name: string };

/** The local, uninvited operator. Their read state lives under this id. */
const OWNER: Viewer = { id: "owner", name: "owner" };

/**
 * Who is asking, or null when access should be refused.
 *
 * Returning a viewer rather than a boolean is deliberate: every caller that
 * needs to know *whether* someone may read also needs to know *whose* read
 * state to touch, and one call answering both means the two can never disagree.
 */
export async function currentViewer(): Promise<Viewer | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const invite: Invite | null = token ? await findInvite(token) : null;
  if (invite) return { id: invite.id, name: invite.name };
  return inviteRequired() ? null : OWNER;
}

export function unauthorized(): Response {
  return Response.json(
    { error: "招待リンクが必要です。共有された URL をもう一度開いてください。" },
    { status: 401 },
  );
}
