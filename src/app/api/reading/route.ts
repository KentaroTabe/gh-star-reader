import { getReading, setReading } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ reading: await getReading() });
}

type Body = { id?: string; read?: boolean };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const id = body.id?.trim();
  if (!id) {
    return Response.json({ error: "id が必要です。" }, { status: 400 });
  }

  // This writes to .data/reading.json and nowhere else. Marking a repository
  // read never touches the star on GitHub.
  const reading = await setReading(id, body.read !== false);
  return Response.json({ reading });
}
