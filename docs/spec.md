# 仕様

## 画面

ひとつの画面で完結する。

1. ユーザー名を入力すると、スター一覧を取得して並べる。
2. 上部に集計（未読数・総数・最も古い未読の年月）と本棚を表示する。
3. 一覧から項目を開くと、その場で要約を生成して表示する。
4. 「読了にする」でローカルに記録する。GitHub 側は変わらない。

### 本棚（背表紙）

スターした順に、1 リポジトリ 1 本の縦棒を並べる。

- 高さ: 未読期間。0 日で 28%、3 年で 100%。読了済みは 16% に潰す。
- 色: 主要言語（GitHub の言語カラーを使用）。
- 読了済みは不透明度 0.22 に落とす。

数字で「未読 127 件」と言うより、放置の分布が一目で分かる。

## API

### `GET /api/starred?user={username}`

`GET /users/{username}/starred` を `Accept: application/vnd.github.star+json`
付きで最大 10 ページ（1,000 件）取得する。このメディアタイプでないと
`starred_at` が返らず、キューの並び順が作れない。

```json
{ "username": "octocat", "repos": [ /* StarredRepo[] */ ], "truncated": false }
```

### `POST /api/summary`

```json
{ "owner": "vercel", "name": "next.js" }
```

1. `fetchRepoContext` でメタ情報・言語比率・ファイル一覧・README・
   依存定義を取得する。小規模なら主要ソースも取得する。
2. キャッシュキー `フルネーム@ツリーSHA` で照会。あればそれを返す。
3. なければ Claude API を呼び、JSON を検証して保存する。
4. プライベートリポジトリは保存しない。

```json
{ "summary": { /* CachedSummary */ }, "cached": true }
```

### `GET` / `POST /api/reading`

読了記録の取得と更新。`POST` のボディは `{ "id": "owner/name", "read": true }`。

## 要約の入力

| 項目 | 取得元 |
| --- | --- |
| 基本情報 | `GET /repos/{o}/{r}` |
| 言語比率 | `GET /repos/{o}/{r}/languages` |
| ファイル一覧・ツリー SHA | `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1` |
| README | `GET /repos/{o}/{r}/readme`（raw） |
| 依存定義 | ルート直下の既知ファイル名を最大 5 件 |
| ソース | 条件を満たす場合のみ最大 12 件 |

### ソースを含める条件

すべて満たすとき、`contextKind` が `metadata+source` になる。

- ツリーが truncated でない
- 除外パターンを除いたコードファイルが 60 件以下
- リポジトリサイズが 4,000 KB 以下

マイナーなリポジトリほどこの条件を満たす。人気リポジトリは巨大で文脈に
入らないので、メタ情報のみになる。**説明タスクでは、小さいリポジトリの方が
良い要約が出る。**

除外するもの: `node_modules` `vendor` `dist` `build` `out` `target`
`third_party` `.next` `__pycache__` `testdata` `fixtures` `examples` 配下、
および `*.min.*` `*-lock.json` `*.lock` `*.d.ts` `*_pb2.py`。

1 ファイル 6,000 文字、ソース合計 90,000 文字で打ち切る。

## 出力

```ts
type Summary = {
  oneLine: string;
  stack: string[];                              // 3〜8
  design: { title: string; detail: string }[];  // 2〜4
  entryPoints: { path: string; why: string }[]; // 3〜5
  caveats: string | null;
};
```

`entryPoints` の `path` は与えたファイル一覧に実在するものだけを使わせる。
ソースを渡していない場合は内部構造を断定させず、不確かな点を `caveats` に
書かせる。

## 保存

| ファイル | 内容 | キー |
| --- | --- | --- |
| `.data/summaries.json` | 要約キャッシュ | `owner/name@treeSha` |
| `.data/reading.json` | 読了記録 | `owner/name` |

どちらも gitignore 済み。書き込みは直列化し、テンポラリファイル経由で
rename する。

キャッシュキーにユーザー ID を含めないのは、意図的に共有するためではなく、
それが最も単純なキーだから。再オープンで再生成しないことが第一の目的で、
ユーザー間の共有はその副産物にすぎない。

## 意図的に作らないもの

- **推薦**。2026 年 7 月から stargazers 一覧の取得が管理者と共同編集者に
  限定され、ユーザー間の共起を外部から計算する手段が実質失われた。
  また、マイナーなリポジトリは定義上スターが少なく、協調フィルタリングの
  シグナルが原理的に存在しない。
- **スターの削除**。理由は `CLAUDE.md` を参照。
- **Star Lists との同期**。意味論的には理想だが、公式の API がない。
