import { currentViewer, unauthorized } from "@/lib/auth";
import { getReading, setReading } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();

  const user = new URL(request.url).searchParams.get("user")?.trim();
  if (!user) {
    return Response.json({ error: "user が必要です。" }, { status: 400 });
  }

  return Response.json({ reading: await getReading(viewer.id, user) });
}

type Body = { user?: string; id?: string; read?: boolean };

export async function POST(request: Request) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const user = body.user?.trim();
  const id = body.id?.trim();
  if (!user || !id) {
    return Response.json({ error: "user と id が必要です。" }, { status: 400 });
  }

  // This writes to .data/reading.json and nowhere else. Marking a repository
  // read never touches the star on GitHub — and it is filed under this viewer,
  // so it never touches anyone else's shelf either.
  const reading = await setReading(viewer.id, user, id, body.read !== false);
  return Response.json({ reading });
}
