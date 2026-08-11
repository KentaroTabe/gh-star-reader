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
      <body>{children}</body>
    </html>
  );
}
