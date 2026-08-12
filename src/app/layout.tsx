import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "gh-star-reader — スターを読書キューに変える",
  description:
    "GitHub のスター一覧を未読の本棚として並べ、リポジトリごとに使用技術・設計の工夫・読み始めるべきファイルを要約します。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      {/*
        Browser extensions add attributes to <body> before React hydrates, and
        React reports the difference as a mismatch it will not patch up. This
        page renders nothing variable here — no dates, no random values, no
        window checks — so the diff can only come from outside.

        The suppression is one element deep. A genuine mismatch anywhere inside
        the tree is still reported.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
