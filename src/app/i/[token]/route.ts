import { COOKIE_MAX_AGE_SECONDS, COOKIE_NAME } from "@/lib/auth";
import { findInvite } from "@/lib/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The invite link. Opening it once trades the token in the URL for a cookie,
 * then redirects to the app so the token stops being in the address bar, out of
 * history and out of screenshots.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const invite = await findInvite(token);

  // A relative Location, deliberately. Behind a TLS terminator the request URL
  // this handler sees is the internal one (http, internal host), and echoing it
  // back would send visitors somewhere that does not exist from outside.
  if (!invite) {
    return new Response(null, { status: 302, headers: { Location: "/?invite=invalid" } });
  }

  // Same reason: the external protocol is only knowable from the proxy's header.
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const https = forwarded ? forwarded === "https" : new URL(request.url).protocol === "https:";

  const response = new Response(null, { status: 302, headers: { Location: "/" } });
  response.headers.append(
    "set-cookie",
    [
      `${COOKIE_NAME}=${token}`,
      "Path=/",
      `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
      "HttpOnly",
      "SameSite=Lax",
      // Omitted on a plain-http local run, where it would stop the cookie working.
      https ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
  return response;
}
