import Reader from "@/components/Reader";
import { currentViewer, inviteRequired } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The door. Everything below it is a client component; this half exists only to
 * decide whether the visitor gets in, because that decision needs the cookie
 * and the invite list, and neither belongs in the browser.
 */
export default async function Page() {
  const viewer = await currentViewer();

  if (!viewer) {
    return (
      <main className="shell">
        <header className="masthead">
          <p className="masthead__eyebrow">gh-star-reader</p>
          <h1 className="masthead__title">招待された人だけが読めます。</h1>
          <p className="masthead__lede">
            共有された招待リンク（<code>/i/…</code> で終わる URL）を開いてください。一度開けば、
            この端末では次からそのまま使えます。リンクが切れている場合は、渡してくれた人に
            再発行を頼んでください。
          </p>
        </header>
      </main>
    );
  }

  // The name is shown so a shared machine cannot quietly file one person's
  // reading under another's. It is not a secret; the token behind it is.
  return <Reader viewerName={inviteRequired() ? viewer.name : null} />;
}
