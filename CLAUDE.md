# 開発方針

## このリポジトリの目的

GitHub のスター一覧を「未読の学習キュー」として扱い、リポジトリごとに
使用技術・設計上の工夫・読み始めるべきファイルを要約する Web アプリ。

## 最も重要な制約

**GitHub には書き込まない。**

スターは私的なブックマークであると同時に、メンテナへの評価表明であり、
ランキングやトレンドを支える公開シグナルでもある。読み終わったことを
スターの削除で表現すると、その評価を撤回することになり、自分が依存している
データを自分で壊す。

したがって:

- `src/lib/github.ts` に書き込み系の関数を追加しない。`PUT` / `DELETE` を
  `/user/starred/...` に対して発行するコードは書かない。
- 既読・読了・メモなど、可変で個人的な状態は `src/lib/store.ts` 経由で
  ローカルの `.data/` に保存する。
- OAuth を導入する場合も、スコープは読み取りのみに留める。

## スコープ外（現時点では実装しない）

- 推薦機能。`/repos/{owner}/{repo}/stargazers` は 2026 年 7 月から
  管理者と共同編集者に限定されたため、ユーザー間の共起は外部から計算できない。
- ログイン画面とパスワード。人の識別は招待リンク（`src/lib/invites.ts`）で行う。
  OAuth も入れない。30 人規模の非公開運用に対して割に合わない。
- ファイル以外の状態置き場を増やすこと。状態は libSQL の 4 テーブルだけ
  （`summaries` `languages` `reading` `invites`）。ローカルはファイル、
  デプロイ先は Turso で、同じドライバが両方を見る。
- リポジトリの clone。取得は GitHub REST API のみで行う。

## 実装の約束

- API キーは Route Handler の中でだけ読む。クライアントコンポーネントに渡さない。
- 新しい Route Handler を足したら、先頭で `currentViewer()` を確認する。
  招待されていない相手に GitHub API と LLM を代理で叩かせない。
- 読了記録のキーは「閲覧者 ID × 見ている GitHub アカウント」。どちらかを
  落とすと、他人の読了を上書きできてしまう。
- `GITHUB_TOKEN` はサーバー運用者のもの。それで見えるプライベート
  リポジトリを閲覧者に出さない（`src/app/api/starred/route.ts` の絞り込み）。
- 環境変数はモジュール読み込み時ではなく、使うたびに `env()` で読む。
  読み込み時に固定すると、テストもデプロイも環境を差し替えられなくなる。
- SQL は `src/lib/store.ts` と `src/lib/invites.ts` にだけ書く。Route Handler
  から `db()` を直に触らない。スキーマは `src/lib/db.ts` の `SCHEMA` が唯一の
  出どころで、初回アクセス時に適用される。
- 招待の発行・失効は `ADMIN_TOKEN` で守った API 経由で行う。デプロイ先に
  シェルで入れる前提を持ち込まない。
- GitHub API の呼び出しは `src/lib/github.ts` に集約する。
- 要約は必ずカードを開いたときに生成する（遅延生成）。一覧表示のために
  LLM を呼ばない。
- 要約のキャッシュキーは `フルネーム@ツリーSHA`。ユーザー ID を含めない。
  同じ内容なら誰が開いても同じ結果でよく、内容が変われば SHA が変わる。
- プライベートリポジトリの要約は既定で行わない。`ALLOW_PRIVATE_REPOS` が
  真のときだけ生成し、その場合もキャッシュには書かない
  （`src/app/api/summary/route.ts` の `isPrivate` 分岐）。
- LLM の出力は JSON で受け取り、`src/lib/summarize.ts` の `parseSummary` で
  検証する。パースに失敗したら握り潰さず、生の応答を画面に出す。
- モデル提供元は OpenAI 互換の chat-completions に限る。呼び出しは
  `src/lib/summarize.ts` に集約し、提供元固有の SDK を入れない。
  base URL・モデル ID・キーは `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY`
  から読み、コードに埋めない。
- `temperature` や `top_p` を設定しない。既定値も許容範囲も提供元ごとに
  違い、非既定値を 400 で弾く提供元がある。送るのは全実装が受け付ける
  パラメータだけにする。
- 応答から取り出すのは assistant のテキストだけ。推論モデルは
  `reasoning_content` や `<think>` タグで思考を返すので、`extractText` で
  取り除く。

## 書き方

- UI の文言は日本語。ラベルは動作をそのまま言う（「読了にする」→ 状態は「読了」）。
- 等幅フォントは機械が言うこと（名前・数値・パス・日付）、セリフ体は
  人間が読む散文（要約本文）。この対応を崩さない。

## コマンド

```bash
npm run dev        # 開発サーバー
npm run typecheck  # 型チェック
npm test           # src/lib のテスト（node:test）
npm run build      # 本番ビルド
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
