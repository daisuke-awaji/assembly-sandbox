# Markdown メモ帳

ブラウザの中だけで動く Markdown メモ帳です。サーバーもログインも不要で、メモはブラウザの localStorage に保存されます。

公開 URL: https://daisuke-awaji.github.io/assembly-sandbox/

## 使い方

- **新規**ボタン（`Ctrl/Cmd+N`）でメモを作り、左のエディタに Markdown を書きます。右のプレビューは入力中に更新されます。
- 入力が止まって 0.5 秒ほどで自動保存します。`Ctrl/Cmd+S` ですぐに保存できます。
- メモのタイトルは、本文の最初の見出し（なければ最初の行）から決まります。
- 本文に `#tag` と書くとタグになります。サイドバーのタグを押すと絞り込めます（もう一度押すと解除）。
- 検索欄（`Ctrl/Cmd+K`）で、タイトルと本文を大文字・小文字を区別せずに検索します。
- **書き出し**でメモを JSON ファイルに保存し、**読み込み**で戻せます。読み込むときは「統合（merge）」か「上書き（replace）」かを選びます。
- 画面の幅が狭いときは「編集」と「プレビュー」をタブで切り替えます。ダークモードは OS の設定に合わせます。

> ブラウザによっては `Ctrl+N`（新しいウィンドウ）を横取りできません。その場合は「新規」ボタンを使ってください。
> localStorage の容量（約 5MB）を超えると保存に失敗し、画面に表示されます。書き出しで退避してください。

### 対応する Markdown

見出し、段落、引用（入れ子）、リスト（`-` `*` `+` / `1.`、2 スペースで入れ子）、チェックリスト（`- [ ]` `- [x]`、表示のみ）、コードブロック（```` ```lang ````）、水平線（`---`）、表（GFM、列の揃え）、`**太字**`、`*斜体*`、`~~取り消し線~~`、`` `コード` ``、`[リンク](url)`、`![画像](url)`、URL の自動リンク、バックスラッシュによるエスケープ、行末 2 スペースの改行。

入力された HTML はすべて文字として表示します。リンクと画像の URL は `http:` `https:` `mailto:`、相対パス、`#` アンカーだけを許します。

## 開発

必要なもの: Node.js 22 以上（依存パッケージはありません）、静的ファイルを配信できるサーバー（例: Python 3）。

```sh
npm test     # node --test で全テストを実行
npm start    # python3 -m http.server 8000 → http://localhost:8000/ を開く
```

ES Modules をそのまま配信するので、ビルドの工程はありません。`index.html` をファイルとして直接開くと ES Modules が読み込めないため、必ず HTTP サーバー経由で開いてください。

構成:

| パス | 内容 |
|---|---|
| `index.html` | 入り口。CSP を `<meta>` で指定（インラインのスクリプトとスタイルは禁止） |
| `src/markdown/` | 自作の Markdown 変換器 `render(src)`（先にすべてエスケープし、URL は許可リストで判定） |
| `src/store/` | メモの保存・検索・タグ・書き出しと読み込みの検証 |
| `src/ui/` | 画面（フレームワークなし。状態を 1 か所に持ち、変わったら描画） |
| `test/` | 単体・結合・XSS 回帰・性能・禁止 API の静的チェック |
| `docs/design.md` | 詳細設計 |

## 公開（GitHub Pages）

現在は「Deploy from a branch」で公開しています。リポジトリの Settings → Pages → Build and deployment で、Source を **Deploy from a branch**、ブランチを `main` の `/ (root)` にしてください。`main` へ push すると、そのまま公開されます（`.nojekyll` を置いているので Jekyll の変換はかかりません）。

GitHub Actions で公開する場合（テストに通ったものだけを公開できます）は、`docs/workflows/ci.yml` と `docs/workflows/pages.yml` を `.github/workflows/` に移し、Source を **GitHub Actions** にしてください。`ci.yml` は PR と push でテストを実行し、`pages.yml` は `main` への push でテストしてから `index.html`・`assets/`・`src/` をデプロイします。
