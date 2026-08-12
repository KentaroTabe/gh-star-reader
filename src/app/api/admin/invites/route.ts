import { timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { createInvite, listInvites, revokeInvite } from "@/lib/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Invite administration over HTTP, because the deployment has no shell.
 *
 * On Render there is no reliable way to run a one-off command against the
 * running instance, so minting a link had to become a request. It is guarded by
 * ADMIN_TOKEN, which is a different secret from any invite: whoever holds it
 * can issue access to everyone.
 */
function authorised(request: Request): boolean {
  const expected = env("ADMIN_TOKEN");
  if (!expected) return false;

  const provided = request.headers.get("x-admin-token") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which is itself a leak of the
  // length; comparing a fixed-size digest-shaped pair avoids the throw.
  return a.length === b.length && timingSafeEqual(a, b);
}

function refuse(): Response {
  return Response.json(
    {
      error: env("ADMIN_TOKEN")
        ? "ADMIN_TOKEN が一致しません。"
        : "ADMIN_TOKEN が設定されていないため、招待の管理は無効です。",
    },
    { status: env("ADMIN_TOKEN") ? 401 : 503 },
  );
}

export async function GET(request: Request) {
  if (!authorised(request)) return refuse();
  return Response.json({ invites: await listInvites() });
}

export async function POST(request: Request) {
  if (!authorised(request)) return refuse();

  let body: { name?: string };
  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return Response.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return Response.json({ error: "name が必要です。" }, { status: 400 });
  }

  const { token, invite } = await createInvite(name);
  return Response.json({ token, invite, path: `/i/${token}` });
}

export async function DELETE(request: Request) {
  if (!authorised(request)) return refuse();

  const target = new URL(request.url).searchParams.get("target")?.trim();
  if (!target) {
    return Response.json({ error: "target が必要です。" }, { status: 400 });
  }

  const invite = await revokeInvite(target);
  if (!invite) {
    return Response.json({ error: `${target} に該当する有効な招待がありません。` }, { status: 404 });
  }
  return Response.json({ invite });
}
