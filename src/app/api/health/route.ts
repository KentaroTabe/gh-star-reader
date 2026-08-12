import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What Render polls. It answers "can this instance serve a request", which for
 * this app means the database is reachable — an instance that cannot read
 * invites cannot let anyone in, and should not be counted as healthy.
 */
export async function GET() {
  try {
    const client = await db();
    await client.execute("SELECT 1");
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: message }, { status: 503 });
  }
}
