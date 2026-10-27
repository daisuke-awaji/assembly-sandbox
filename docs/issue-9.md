# Markdown メモ帳アプリを作り、GitHub Pages で公開する

## 背景と目的

- 既存のサンプルコード（`src/price.js` など）をすべて削除し、何もない状態から作り直す。
- ブラウザの中だけで動く **Markdown メモ帳** を作り、GitHub Pages で公開して、実際に触って確かめられるようにする。
- Software Factory の検証も兼ねる。複数の VM（計画・実装・テスト・コードレビュー・セキュリティレビュー）に作業を分けて開発する。

## スコープ

### 作るもの（MVP）
- メモの作成・編集・削除と一覧表示（更新日時の新しい順）
- 左にエディタ、右にプレビューを並べて表示する。プレビューは入力中に随時更新し、更新の間隔は 150ms 程度に抑える
- 自作の Markdown 変換器（対応する記法は下の「Markdown の対応範囲」）
- localStorage に自動で保存する（入力が止まって 500ms ほどしたら保存）
- 全文検索（タイトルと本文。大文字と小文字は区別しない）
- タグ（本文にある `#tag` を取り出す）と、タグでの絞り込み
- JSON での書き出しと読み込み（読み込み時はスキーマを検証する）
- キーボードショートカット: `Ctrl/Cmd+S` で即座に保存、`Ctrl/Cmd+N` で新しいメモ、`Ctrl/Cmd+K` で検索欄へ移動
- ダークモード（OS の設定 `prefers-color-scheme` に合わせる）
- スマートフォン向けの表示（狭い画面では「編集」と「プレビュー」をタブで切り替える）

### 作らないもの
- サーバー側の処理、ログイン、端末間の同期
- 外部の npm パッケージや CDN（実行時もテストも Node.js の標準機能だけで行う）
- ビルドの工程（ES Modules をそのまま配信する）
- 生の HTML をそのまま表示すること（入力された HTML は、すべてエスケープして文字として表示する）

## 技術方針

| 項目 | 方針 |
|---|---|
| 言語 | HTML / CSS / JavaScript（ES Modules）。ブラウザ側で変換しない |
| 実行環境 | 最新の Chrome / Firefox / Safari |
| テスト | `node --test`（Node.js 22）。DOM を使わない純粋な関数を中心にテストする |
| 依存パッケージ | なし（`package.json` の `dependencies` は空） |
| 公開 | GitHub Actions（`actions/upload-pages-artifact` と `actions/deploy-pages`） |
| セキュリティ | CSP（Content Security Policy）は `<meta>` で指定する。インラインのスクリプトとスタイルは禁止する |

## ディレクトリ構成

```
.
├── index.html               # 入り口となるページ。CSP の meta を置く
├── assets/
│   └── style.css
├── src/
│   ├── markdown/
│   │   ├── escape.js        # HTML エスケープと URL のサニタイズ
│   │   ├── inline.js        # インラインの記法（強調、コード、リンクなど）
│   │   ├── block.js         # ブロックの記法（見出し、リスト、コードブロックなど）
│   │   └── index.js         # render(markdown) -> HTML 文字列
│   ├── store/
│   │   ├── notes.js         # メモの作成・取得・更新・削除と検索（ストレージを差し替えられる）
│   │   ├── storage.js       # localStorage のラッパーと、メモリ上の実装（テスト用）
│   │   ├── schema.js        # メモと書き出しファイルの検証
│   │   └── tags.js          # 本文からタグを取り出す
│   ├── ui/
│   │   ├── app.js           # 起動処理と、状態の管理
│   │   ├── editor.js        # エディタ、自動保存、ショートカット
│   │   ├── preview.js       # プレビューの描画
│   │   ├── sidebar.js       # 一覧、検索、タグでの絞り込み
│   │   └── io.js            # 書き出しと読み込み
│   └── util/
│       └── debounce.js
├── test/
│   ├── markdown/*.test.js
│   ├── store/*.test.js
│   └── security/xss.test.js # XSS のペイロード集を使った回帰テスト
├── .github/workflows/
│   ├── ci.yml               # PR と push のときに node --test を実行する
│   └── pages.yml            # main への push でテストし、Pages にデプロイする
├── package.json
└── README.md
```

## モジュールの仕様

### `src/markdown`（Markdown 変換器）

公開する関数は `render(src: string): string` の 1 つで、安全な HTML 文字列を返す。

**Markdown の対応範囲**
- ブロック: 見出し（`#`〜`######`）、段落、空行での区切り、引用（`>`、入れ子あり）、順序なしリスト（`-` `*` `+`）、順序付きリスト（`1.`）、リストの入れ子（字下げは 2 スペース）、コードブロック（```` ``` ```` で囲む。言語名は `class="language-xxx"` にする。言語名は `[a-z0-9-]` だけ許す）、水平線（`---`）、表（GFM 形式。列の揃えも扱う）、チェックリスト（`- [ ]` と `- [x]`。表示だけでチェックはできない）
- インライン: `**太字**`、`*斜体*`、`~~取り消し線~~`、`` `コード` ``、`[リンク](url)`、`![画像](url)`、URL の自動リンク（`https://...`）、バックスラッシュによるエスケープ、改行（行末に 2 つのスペース）

**安全のための仕様（必須）**
- 入力された文字列は、まずすべてエスケープする（`& < > " '`）。変換器が自分で作るタグだけを HTML として出力する。
- リンクと画像の URL は許可した形式だけ通す。`http:`、`https:`、`mailto:`、相対パス、`#` で始まるアンカーは許す。`javascript:`、`data:`、`vbscript:` などはリンクにせず、文字として表示する。判定の前に、制御文字と空白を取り除き、大文字と小文字の違い、および HTML エンティティの表記の違いをそろえる。
- 外部へのリンクには `rel="noopener noreferrer"` と `target="_blank"` を付ける。
- 属性値は必ずダブルクォートで囲み、中身をエスケープする。
- 長い入力や、深く入れ子になった入力でも止まらないようにする。正規表現の作りが原因で処理が極端に遅くなる問題（ReDoS）を避ける。入れ子の深さには上限（例: 10）を設ける。

### `src/store`（データ層）

```js
// メモ 1 件のデータ
{ id: string /* crypto.randomUUID() */, title: string, body: string,
  tags: string[], createdAt: number, updatedAt: number }
```

- `createNotesStore(storage)` が返すもの: `list({query, tag})`、`get(id)`、`create(partial)`、`update(id, patch)`、`remove(id)`、`exportAll()`、`importAll(json, {mode: 'merge'|'replace'})`
- タイトルは本文の最初の見出しから取る。見出しがなければ最初の行、本文が空なら「無題」にする。
- localStorage のキーは `mdmemo:v1:notes`。データにはスキーマのバージョンを持たせ、将来の移行に備える。
- 保存できる容量を超えたとき（`QuotaExceededError`）は、例外を UI へ伝えて、保存に失敗したことを表示する。
- 読み込むファイルの検証:
  - 最上位は `{version: 1, notes: Note[]}`。
  - 1 件ごとに、型、文字数の上限（タイトルは 200 文字、本文は 1MB）、ファイル全体の件数の上限（例: 5,000）を確かめる。
  - 知らないキーは捨てる。`__proto__`、`constructor`、`prototype` のキーは拒否する（プロトタイプ汚染の対策）。
  - id が重複しているときは、`merge` では `updatedAt` が新しいほうを残す。
- 保存先が壊れていても（JSON として読めないなど）、アプリが落ちないようにする。壊れたデータは退避用のキーに移し、空の状態から起動する。

### `src/ui`（画面）

- DOM には `textContent` で値を入れる。`innerHTML` を使ってよいのは、プレビューで `render()` の結果を入れる 1 か所だけにする。
- 状態は 1 か所にまとめて持つ。変更したら描画する、という単純な流れにする（フレームワークは使わない）。
- アクセシビリティ: ボタンにはラベルを付ける。キーボードだけで操作できるようにし、フォーカスの位置が見えるようにする。色のコントラストは WCAG AA を目安にする。
- 読み込みのときは、上書き（replace）か統合（merge）かを確認するダイアログを出す。

## セキュリティ要件（チェックリスト）

- [ ] Markdown から XSS が起きない（`<script>`、`onerror=`、`javascript:` の URL、エンティティを使って URL を難読化したもの、SVG、属性から抜け出す入力など）
- [ ] 読み込んだ JSON からの XSS とプロトタイプ汚染が起きない
- [ ] `innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`、`eval`、`new Function` を、許可した 1 か所以外で使っていない（テストで grep して確かめる）
- [ ] CSP は `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; form-action 'none'`
- [ ] 外部リンクに `noopener noreferrer` が付いている
- [ ] 正規表現による極端な遅延が起きない（100KB の悪意のある入力でも 1 秒以内に変換が終わる）
- [ ] 依存パッケージがない（`npm ls` の結果が空）
- [ ] GitHub Actions の権限を必要最小限にする（`permissions:` で `contents: read` を基本にし、`pages: write` と `id-token: write` はデプロイのジョブだけに付ける）。使う action のバージョンは固定する

## テスト計画

| 種類 | 内容 | 合格の基準 |
|---|---|---|
| 単体（markdown） | 記法ごとの正常系と、記法が混ざった入力、壊れた Markdown | すべて通る |
| 単体（store） | メモの作成・取得・更新・削除、検索、タグ、書き出しと読み込み、壊れたデータからの復旧、容量超過 | すべて通る |
| セキュリティ回帰 | `test/security/xss.test.js`。50 件以上のペイロードについて、出力に危険なタグや属性、スキームが含まれないことを確かめる | すべて通る |
| 静的チェック | 使ってはいけない API が入っていないかを grep で確かめるテスト | 違反が 0 件 |
| 性能 | 100KB の入力と、深く入れ子になった入力の変換時間 | 1 秒以内 |
| 手動確認（Pages） | 公開した URL で、作成・編集・リロードしても残ること・検索・タグ・書き出しと読み込み・ダークモード・スマートフォン表示を確かめる | チェックリストがすべて OK |

実行するコマンドは `npm test`（中身は `node --test`）。

## 作業の分担（Software Factory の VM）

| 段階 | タスク | 担当 | 並列 | 成果物 |
|---|---|---|---|---|
| 0 | 既存のコードを削除し、雛形を作る（`package.json`、`index.html`、`ci.yml`） | Orchestrator | - | 雛形のコミット |
| 1 | `plan-` 詳細設計（モジュール間の境界と、関数の型の定義） | ワーカー 1 台 | - | `docs/design.md` |
| 2 | `impl-markdown` 変換器とそのテスト | ワーカー | ◎ | `src/markdown`、`test/markdown` |
| 2 | `impl-store` データ層とそのテスト | ワーカー | ◎ | `src/store`、`test/store` |
| 2 | `impl-ui` 画面と CSS（`render` と store はモックで代用） | ワーカー | ◎ | `src/ui`、`index.html`、`assets` |
| 3 | 結合（Orchestrator）して、`lll exec` で全テストを実行する | Orchestrator | - | 結合のコミット |
| 4 | `test-` テストを増やす（境界値、異常系、性能） | ワーカー | ◎ | 追加のテスト |
| 4 | `review-code` 設計と品質、読みやすさのレビュー | ワーカー | ◎ | 指摘の一覧 |
| 4 | `review-security` 上のチェックリストに沿ったセキュリティレビュー、XSS のペイロードを増やす | ワーカー | ◎ | 指摘の一覧と追加のペイロード |
| 5 | 指摘の修正（`impl-fix-*`）と再テスト | ワーカー / Orchestrator | ○ | 修正のコミット |
| 6 | `pages.yml` を加え、PR を作る | Orchestrator | - | PR |
| 7 | マージして公開し、公開された URL で動きを確認する | Orchestrator + ユーザー | - | 公開 URL |

## マイルストーンと完了の条件

1. **M1 雛形**: 既存のコードが削除され、空のページが表示でき、`npm test` が通る
2. **M2 中核**: markdown と store の単体テストがすべて通る
3. **M3 画面**: ローカルで（`python3 -m http.server` などを使って）一通り操作できる
4. **M4 品質**: レビューとセキュリティの指摘への対応が完了し、すべてのテストが通る
5. **M5 公開**: GitHub Pages で公開され、手動確認のチェックリストがすべて OK

**完了の条件（Definition of Done）**
- [ ] 既存のサンプルコードがすべて削除されている
- [ ] `npm test` がすべて通る（CI でも通る）
- [ ] 「セキュリティ要件」のチェックリストがすべて満たされている
- [ ] `https://daisuke-awaji.github.io/assembly-sandbox/` で動いている
- [ ] README に、使い方、開発の手順（ローカルでの起動とテスト）、公開の方法が書いてある

## 前提と、リポジトリ管理者にお願いしたいこと

- **GitHub Pages を有効にする**: Settings → Pages → Build and deployment → Source を「**GitHub Actions**」にする（現在は Pages が無効で、bot の権限では変更できない）。
- **workflow ファイルを push できるか**: bot（GitHub App）に `workflows` の権限がなければ `.github/workflows/` を push できない。その場合は、権限を追加するか、「Deploy from a branch」（`main` の `/`（ルート））で公開する方法に切り替える。
- Actions の設定で、GitHub Actions の実行が許可されていること。

## リスクと対策

| リスク | 対策 |
|---|---|
| 自作の変換器に XSS の抜け穴が残る | 「先にすべてエスケープし、URL は許可した形式だけ通す」という作りにする。ペイロード集で回帰テストし、レビューは専任の VM が行う |
| 並列で作った部分を結合するときに食い違う | 段階 1 でモジュール間の境界（関数の型）を固め、ワーカーはそれだけに頼って作る |
| 権限不足でデプロイできない | 早めに設定をお願いし、ブランチから公開する方法も用意しておく |
| localStorage の容量（約 5MB）を超える | 保存に失敗したことを画面に出し、書き出しでの退避を勧める |
