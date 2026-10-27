# Markdown メモ帳 詳細設計

Issue #9 の仕様を、3 人の実装者 (impl-markdown / impl-store / impl-ui) が互いの作業を見ずに並列で実装できるよう、
モジュール間の境界を固定する文書。**この文書に書かれた名前・形・振る舞いが唯一の契約**であり、
迷ったらこの文書に従う (推測で拡張しない)。この文書に無いことは各担当が自由に決めてよいが、他モジュールから見える形にしてはならない。

共通ルール:

- 言語は ES Modules (`"type": "module"`)。import は相対パスで **拡張子 `.js` を必ず付ける**。外部パッケージ・CDN は使わない。
- ブラウザと Node.js 22 の両方で動く部分 (`src/markdown`, `src/store`, `src/util`) は、DOM・`window` を import 時に参照しない。
- 時刻は「エポックミリ秒の整数」(`Date.now()`)。
- `src/` 配下の **コメントを含む全行** に、禁止 API の名前 (§6.2) を書かない (静的チェックが grep で見つけるため)。ただし §6.2 の許可行は除く。
- 各モジュールの JSDoc の型名 (`Note`, `ExportFile`, `StoreError` など) は §2 の定義を指す。

---

## 1. 全体構成と依存関係

```
index.html ── src/ui/main.js ─┬─ src/ui/app.js ─┬─ editor.js ── util/debounce.js
 (唯一の配線箇所)              │                  ├─ preview.js ─ util/debounce.js  (render は注入)
                              │                  ├─ sidebar.js                      (store は注入)
                              │                  └─ io.js
                              ├─ src/markdown/index.js ── block.js ── inline.js ── escape.js
                              └─ src/store/notes.js ─┬─ schema.js ─┐
                                                     ├─ tags.js    │ (StoreError もここ)
                                                     └─ storage.js ┘
```

依存のルール (これを破る import は禁止):

| モジュール | import してよいもの |
|---|---|
| `markdown/escape.js` | なし |
| `markdown/inline.js` | `escape.js` |
| `markdown/block.js` | `inline.js`, `escape.js` |
| `markdown/index.js` | `block.js` |
| `store/schema.js` | `tags.js` |
| `store/storage.js` | `schema.js` (`StoreError` のみ) |
| `store/tags.js` | なし |
| `store/notes.js` | `schema.js`, `storage.js`, `tags.js` |
| `util/debounce.js` | なし |
| `ui/app.js`, `editor.js`, `preview.js`, `sidebar.js`, `io.js` | `util/debounce.js` と ui 内のモジュールのみ。**`src/markdown`・`src/store` を import しない** (`render` と store は引数で受け取る) |
| `test/ui/mocks.js` (テスト専用。配信しない) | なし |
| `ui/main.js` | すべて (実物を配線する唯一のファイル) |

`index.html` の `<script type="module" src="src/ui/app.js">` は `src/ui/main.js` に変更する (impl-ui が担当)。

---

## 2. 共有する型とデータ形式

### 2.1 Note

```js
/**
 * @typedef {Object} Note
 * @property {string}   id         crypto.randomUUID() (インポートされたものは §3.3 の形式なら何でもよい)
 * @property {string}   title      body から導出 (§3.2)。1〜200 文字。空にはならない ("無題")
 * @property {string}   body       Markdown 本文。0〜1,048,576 文字 (String#length)
 * @property {string[]} tags       body から導出 (§3.2)。小文字・重複なし・本文での出現順
 * @property {number}   createdAt  作成時刻 (整数 ms。0〜8.64e15)
 * @property {number}   updatedAt  最終更新時刻 (整数 ms。0〜8.64e15)
 */
```

`title` と `tags` は **常に body から導出される派生値**。create / update / importAll のいずれでも、外部から渡された値は信用せず再計算する。

### 2.2 ExportFile (書き出しファイル = localStorage 上の保存形式)

```js
/**
 * @typedef {Object} ExportFile
 * @property {1}      version  スキーマバージョン。現在は 1 のみ
 * @property {Note[]} notes    最大 5,000 件
 */
```

localStorage の値 (キー `mdmemo:v1:notes`) は `JSON.stringify(ExportFile)` そのもの。書き出しファイルと同じ形にすることで検証コードを共有する。

| 定数 | 値 |
|---|---|
| 保存キー `STORAGE_KEY` | `"mdmemo:v1:notes"` |
| 退避キー `CORRUPT_KEY` | `"mdmemo:v1:corrupt"` (壊れた生文字列をそのまま 1 つだけ保持。新しい破損で上書き) |
| `SCHEMA_VERSION` | `1` |

これらは `src/store/schema.js` が export する。

### 2.3 制限値 (`LIMITS`, schema.js が export)

```js
export const LIMITS = Object.freeze({
  MAX_TITLE: 200,           // 文字数 (String#length)
  MAX_BODY: 1048576,        // 文字数 (String#length)
  MAX_NOTES: 5000,
  MAX_TAGS_PER_NOTE: 50,
  MAX_TAG_LENGTH: 50,
  MAX_ID_LENGTH: 100,
  MAX_IMPORT_CHARS: 20000000, // importAll に渡す JSON 文字列の長さ
});
```

### 2.4 エラー型 `StoreError` (schema.js が定義・export)

store が投げる例外はすべて `StoreError` (プログラミングミスの `TypeError` を除く)。UI は **`err.name === 'StoreError'` と `err.code`** だけを見て分岐する (`instanceof` に依存しない。UI は store を import しないため)。

```js
export const ERROR_CODES = Object.freeze({
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',           // 保存容量超過
  VALIDATION: 'VALIDATION',                   // 入力・読み込みファイルの検証エラー
  NOT_FOUND: 'NOT_FOUND',                     // update の id が存在しない
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE', // 容量超過以外の保存失敗 (SecurityError 等)
});

export class StoreError extends Error {
  /**
   * @param {keyof typeof ERROR_CODES} code
   * @param {string} message  日本語の短い説明 (UI にそのまま出してよい)
   * @param {{details?: string[], cause?: unknown}} [opts]
   */
  constructor(code, message, opts) {}
  // this.name === 'StoreError'
  // this.code: string
  // this.details: string[]   VALIDATION のとき "notes[3].title: 200 文字を超えています" 形式。最大 20 件。それ以外は []
}
```

UI が表示するメッセージ (app.js が組み立てる。code → 文言):

| code | 表示 |
|---|---|
| `QUOTA_EXCEEDED` | 「保存できませんでした。ブラウザの保存容量がいっぱいです。『書き出し』でバックアップし、不要なメモを削除してください。」 |
| `VALIDATION` | `err.message` + `details` の先頭 3 件 |
| `NOT_FOUND` | 「メモが見つかりません。」 |
| `STORAGE_UNAVAILABLE` | 「ブラウザの保存領域を使えません。書き出しでバックアップしてください。」 |
| それ以外 | 「予期しないエラーが発生しました。」 |

### 2.5 ImportResult

```js
/**
 * @typedef {Object} ImportResult
 * @property {'merge'|'replace'} mode
 * @property {number} added      新規に追加されたメモ数 (replace では取り込んだ全件)
 * @property {number} updated    merge で既存を置き換えたメモ数 (replace では 0)
 * @property {number} skipped    取り込まなかったメモ数 (id 重複で古い側 / 既存より新しくない)
 * @property {number} total      処理後の store 内のメモ総数
 */
```

---

## 3. store API (`src/store/`)

### 3.1 storage.js — ストレージ抽象

```js
/**
 * @typedef {Object} Storage  localStorage と同じ最小サブセット (同期 API)
 * @property {(key: string) => string|null} getItem
 * @property {(key: string, value: string) => void} setItem  容量超過時は name==='QuotaExceededError' の例外を投げる
 * @property {(key: string) => void} removeItem
 */

/**
 * localStorage のラッパー。生成時に例外を投げない。
 * 各メソッドは backend の例外をそのまま伝える (変換は notes.js が行う)。
 * @param {Storage} [backend=globalThis.localStorage]
 * @returns {Storage}
 */
export function createLocalStorage(backend) {}

/**
 * テスト用のメモリ実装。
 * @param {Record<string,string>} [initial={}]  初期内容
 * @param {{quotaChars?: number}} [opts]  全値の文字数合計がこれを超える setItem は
 *        `Object.assign(new Error('quota'), {name: 'QuotaExceededError'})` を投げる (既定 Infinity)。
 *        失敗した setItem は内容を変えない。
 * @returns {Storage & {dump(): Record<string,string>}}  dump() は現在の内容のコピー
 */
export function createMemoryStorage(initial, opts) {}
```

### 3.2 tags.js — 本文からの導出

```js
/**
 * #tag を取り出す。
 * - 対象: 行頭または空白の直後にある `#` + 1 文字以上の [\p{L}\p{N}_-] (最大 50 文字で打ち切らず、51 文字以上のものは無視)
 * - `# 見出し` (# の直後が空白) はタグではない
 * - フェンスコードブロック (``` で囲まれた範囲) の中とインラインコード (`...`) の中は無視
 * - 小文字化 (toLowerCase) し、重複を除き、出現順に並べる。最大 50 個
 * @param {string} body
 * @returns {string[]}
 */
export function extractTags(body) {}

/**
 * タイトルを導出する。
 * 1. フェンスコードブロック外で最初に現れる見出し行 (`^ {0,3}#{1,6}[ \t]+(.+)$`) の本文
 *    (行末の閉じ `#` 列と前後の空白は除く)。中身が空なら次の候補へ
 * 2. なければ、空白のみでない最初の行 (trim したもの)
 * 3. なければ "無題"
 * 結果は先頭 200 文字 (slice(0, 200)) に切り詰める。Markdown 記法の除去はしない。
 * @param {string} body
 * @returns {string} 常に 1 文字以上
 */
export function deriveTitle(body) {}

/**
 * タグ引数の正規化: 先頭の `#` を 1 つ取り、trim し、toLowerCase。
 * @param {string} tag
 * @returns {string}
 */
export function normalizeTag(tag) {}
```

### 3.3 schema.js — 検証

```js
export const SCHEMA_VERSION, STORAGE_KEY, CORRUPT_KEY, LIMITS, ERROR_CODES;
export class StoreError extends Error {}

/**
 * 1 件のメモを検証して正規化する。
 * - 必須キー: id, title, body, tags, createdAt, updatedAt。型が違えば VALIDATION
 * - id: /^[A-Za-z0-9_-]{1,100}$/
 * - title: string, 200 文字以下 (超過は **エラー**。切り詰めない)
 * - body: string, 1,048,576 文字以下
 * - tags: string[] (各 50 文字以下・最大 50 個)
 * - createdAt, updatedAt: Number.isSafeInteger かつ 0 以上
 * - 知らないキーは捨てる。`__proto__` / `constructor` / `prototype` を **own property として持つ** オブジェクトは、
 *   どの階層でも VALIDATION (Object.hasOwn で判定)
 * - 戻り値の title / tags は body から再計算した値 (deriveTitle / extractTags)
 * @param {unknown} value
 * @param {string} [path='note']  エラー details に使う接頭辞 (例 "notes[3]")
 * @returns {Note}  新しいオブジェクト (入力とは別物)
 * @throws {StoreError} code VALIDATION
 */
export function validateNote(value, path) {}

/**
 * ExportFile を検証して正規化する。最上位は `{version: 1, notes: Note[]}` 以外は VALIDATION
 * (version が 1 以外・notes が配列でない・件数が 5,000 超・最上位に禁止キー)。
 * notes の各要素を validateNote する。id の重複はここでは **検査しない** (importAll が解決する)。
 * 1 件でも不正なら全体を不正とし、details に最大 20 件まで集めて投げる。
 * @param {unknown} value
 * @returns {ExportFile}
 * @throws {StoreError} VALIDATION
 */
export function validateExportFile(value) {}

/**
 * JSON 文字列 → ExportFile。長さが MAX_IMPORT_CHARS 超、または JSON.parse に失敗した場合も VALIDATION。
 * @param {string} text
 * @returns {ExportFile}
 * @throws {StoreError} VALIDATION
 */
export function parseExportFile(text) {}
```

将来の移行のため、保存データの読み出しは `parseExportFile` の前に `version` を見る。現状 `version === 1` 以外 (将来版・数値以外) は VALIDATION とし、store 起動時は「壊れたデータ」と同じ扱い (§3.5) になる。

### 3.4 notes.js — `createNotesStore`

```js
/**
 * @typedef {Object} NotesStore
 * @property {(opts?: {query?: string, tag?: string|null}) => Note[]} list
 * @property {(id: string) => Note|null} get
 * @property {(partial?: {body?: string}) => Note} create
 * @property {(id: string, patch: {body: string}) => Note} update
 * @property {(id: string) => boolean} remove
 * @property {() => {tag: string, count: number}[]} listTags
 * @property {() => ExportFile} exportAll
 * @property {(json: string, opts: {mode: 'merge'|'replace'}) => ImportResult} importAll
 * @property {() => {recovered: boolean, reason: string|null}} getLoadInfo
 */

/**
 * @param {Storage} storage  §3.1 のインターフェース
 * @param {{now?: () => number, genId?: () => string}} [deps]
 *   now   既定 `Date.now`   — updatedAt / createdAt の生成。テストで差し替える
 *   genId 既定 `() => crypto.randomUUID()` — id の生成。テストで差し替える
 * @returns {NotesStore}
 */
export function createNotesStore(storage, deps) {}
```

**すべて同期 API**。メモは生成時に 1 回だけ storage から読み込み、以降はメモリ上の配列を正とし、変更のたびに全体を `STORAGE_KEY` へ書き戻す。戻り値の Note は **常にコピー** (呼び出し側が書き換えても store 内部は変わらない)。

**list({query, tag})**
- 引数省略・`undefined` 可。`query` は trim 後、空なら絞り込まない。`tag` は `null`/`undefined`/`''` なら絞り込まない。
- `query`: `title` と `body` の **どちらかに部分一致** (`toLowerCase()` 同士の `includes`。単語分割はしない。トリム後の文字列全体を 1 つの部分文字列として扱う)。
- `tag`: `normalizeTag(tag)` が `note.tags` に含まれること。
- `query` と `tag` は AND。
- 並び順: `updatedAt` の降順 → 同値なら `createdAt` の降順 → さらに同値なら `id` の昇順 (`<` 比較)。
- 該当なしは `[]`。

**listTags()**: 全メモのタグを集計し `{tag, count}[]` を `count` 降順 → `tag` 昇順 (`<` 比較) で返す。絞り込みの影響を受けない。

**get(id)**: 見つからなければ `null`。

**create(partial)**
- `partial.body` が省略なら `''`。文字列でない・1,048,576 文字超なら `StoreError(VALIDATION)`。`partial` に他のキーがあっても無視。
- `id = genId()`、`createdAt = updatedAt = now()`、`title = deriveTitle(body)`、`tags = extractTags(body)`。
- 保存に失敗したら例外を投げ、**メモリ上の状態も元に戻す** (失敗した create は存在しなかったことになる)。
- 成功時は作成した Note を返す。

**update(id, patch)**
- `patch.body` は必須 (create と同じ検証)。`id`/`title`/`tags`/`createdAt`/`updatedAt` は patch に含まれても無視。
- id が無ければ `StoreError(NOT_FOUND)`。
- `patch.body === 既存の body` のときは **何も書かず、updatedAt も変えず**、既存の Note を返す。
- それ以外は `body`, `title`, `tags` を再計算し、`updatedAt = now()`。ただし `now()` が既存の `updatedAt` 以下なら `既存 updatedAt + 1` にする (単調増加を保証。テストで時計が固定されていても一覧の並びが安定する)。
- 保存失敗時は変更を巻き戻して例外を投げる。成功時は更新後の Note を返す。

**remove(id)**: 存在すれば削除して `true`、無ければ何もせず `false`。保存失敗時は巻き戻して例外。

**exportAll()**: `{version: 1, notes}` を返す。`notes` は `list()` と同じ並び順のコピー。

**importAll(json, {mode})**
- `json` は **JSON 文字列** (ファイルのテキスト)。`mode` は `'merge'` か `'replace'` 以外なら `StoreError(VALIDATION)`。
- `parseExportFile(json)` で検証。**不正なら何も変更せず** `VALIDATION` を投げる (部分的な取り込みはしない)。
- ファイル内の id 重複は、`updatedAt` が新しいほうを残す (同値ならファイル内で先に出たほう)。捨てた分は `skipped` に数える。
- `replace`: 既存を全て捨て、ファイルの (重複解決後の) メモだけにする。`added` = その件数、`updated` = 0。ファイルのメモが 0 件なら store は空になる。
- `merge`: 既存にない id は追加 (`added`)。既存にある id は、ファイル側の `updatedAt` が **厳密に大きい** ときだけ置き換え (`updated`)、そうでなければ既存を残す (`skipped`)。
- 取り込み後の総数が 5,000 を超える場合は、何も変更せず `VALIDATION` (details に超過の説明)。
- 保存失敗時は変更を巻き戻して例外 (`QUOTA_EXCEEDED` など)。
- 戻り値は §2.5 の `ImportResult`。`title`/`tags` は body から再計算される (ファイルの値は使わない)。

**getLoadInfo()**: 起動時の読み込み結果。`{recovered: false, reason: null}` なら正常。`recovered: true` のとき `reason` は `'invalid-json' | 'invalid-schema' | 'unavailable'`。

### 3.5 起動時の読み込み・壊れたデータの扱い・容量超過

起動 (`createNotesStore` 内) の手順:

1. `storage.getItem(STORAGE_KEY)` が `null` → 空の状態で開始 (`recovered: false`)。
2. 文字列なら `JSON.parse` → `version` チェック → `validateExportFile`。
3. いずれかが失敗したら **例外を外へ投げず**:
   `storage.setItem(CORRUPT_KEY, 生の文字列)` (失敗しても無視) → `storage.removeItem(STORAGE_KEY)` (失敗しても無視) → 空の状態で開始し `recovered: true, reason: 'invalid-json' | 'invalid-schema'` とする。
4. `getItem` 自体が例外を投げたら、空の状態で開始し `reason: 'unavailable'`。
5. 起動時には `setItem` しない (空のままなら何も書かない)。

書き込み失敗の変換 (notes.js の内部関数 `persist()`):
- `err.name === 'QuotaExceededError'` もしくは `err.name === 'NS_ERROR_DOM_QUOTA_REACHED'` もしくは `err.code` が 22 / 1014 → `StoreError(QUOTA_EXCEEDED, ..., {cause})`
- それ以外 → `StoreError(STORAGE_UNAVAILABLE, ..., {cause})`

---

## 4. Markdown 変換器 (`src/markdown/`)

### 4.1 呼び出し関係と責務

```
render(src)            index.js   正規化 (改行・NUL) → renderBlocks → 文字列
  └ renderBlocks(src)  block.js   行単位の状態機械。ブロック構造を決め、各ブロックの文字列を
      │                           renderInline に渡して HTML を組み立てる
      └ renderInline(text)  inline.js  1 つの文字列を左から右へ走査 (文字単位のスキャナ)
          └ escapeHtml / sanitizeUrl / isExternalUrl   escape.js   葉の文字列を必ず通る
```

**エスケープの原則**: 生の入力文字列が HTML に出力されるのは、必ず `escapeHtml` を通った後だけ。タグ・属性名は変換器が文字列リテラルとして書く。属性値は `escapeHtml` で包み、ダブルクォートで囲む。コードブロックの中身も `escapeHtml` のみ (inline.js は通さない)。

### 4.2 escape.js

```js
/**
 * & < > " ' を &amp; &lt; &gt; &quot; &#39; に置換する (1 回の走査)。属性値にも同じ関数を使う。
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {}

/**
 * リンク/画像の URL を検証し、出力してよい文字列を返す。通らなければ null。
 * 手順:
 *  1. string でなければ null
 *  2. probe を作る: s を HTML エンティティ復号 (数値 10 進/16 進 + 名前付き amp lt gt quot apos colon tab newline lpar rpar sol 等の小さな表。
 *     変化しなくなるまで最大 3 回) → 制御文字・空白 (U+0000–U+0020, U+007F–U+009F, U+00AD, U+200B–U+200F, U+2028, U+2029, U+FEFF) を全て除去 → toLowerCase
 *  3. probe が空、または `\` を含む → null
 *  4. probe 内の最初の `:` が、最初の `/` `?` `#` より前にある (またはそれらが無い) → その手前をスキーム名とする。
 *     許可: kind==='link' なら http / https / mailto、kind==='image' なら http / https。それ以外 (javascript, data, vbscript, file, 未知のスキーム、空のスキーム) → null
 *  5. スキームが無ければ相対パス・`#アンカー`・`?クエリ`・`//ホスト` として許可
 *  6. 返す値は「元の文字列から手順 2 の除去対象文字だけを取り除いたもの」(エンティティ復号も小文字化もしない)。
 *     呼び出し側は属性に入れるとき必ず escapeHtml を通す
 * @param {string} raw
 * @param {'link'|'image'} [kind='link']
 * @returns {string|null}
 */
export function sanitizeUrl(raw, kind) {}

/**
 * sanitizeUrl が返した URL が外部 (別オリジン) か。
 * 大文字小文字を無視して `http:` `https:` で始まる、または `//` で始まる場合 true。mailto・相対・アンカーは false。
 * @param {string} url  sanitizeUrl の戻り値
 * @returns {boolean}
 */
export function isExternalUrl(url) {}
```

### 4.3 inline.js

```js
export const MAX_INLINE_DEPTH = 10;

/**
 * インライン記法を HTML に変換する。入力は生の文字列 (エスケープ前)。必ず安全な HTML 断片を返し、例外を投げない。
 * 行は "\n" で連結されて渡される。
 * @param {string} text
 * @param {{depth?: number, inLink?: boolean}} [opts]  depth: 強調・リンクテキストの入れ子の深さ (0 開始)。inLink: リンクテキスト内
 * @returns {string}
 */
export function renderInline(text, opts) {}
```

左から右への 1 回の走査。各位置で次の順に判定し、どれにも当たらなければ 1 文字を `escapeHtml` して出力する。

| 記法 | 出力 (属性順も固定) |
|---|---|
| `\` + ASCII 記号 | その記号 1 文字 (エスケープして出力)。それ以外の `\` は文字として出力 |
| `` `code` `` (同じ長さのバッククォート列で閉じる。前後に空白が 1 つずつあれば両方外す) | `<code>…</code>` (中身は `escapeHtml` のみ)。閉じが無ければバッククォート列を文字として出力 |
| `![alt](url)` | `<img src="URL" alt="ALT" loading="lazy" referrerpolicy="no-referrer">`。ALT は alt の生テキストを `escapeHtml` (inline 変換しない)。`sanitizeUrl(url,'image')` が null なら、マッチ全体の元テキストを `escapeHtml` して文字として出す |
| `[text](url)` | 外部: `<a href="URL" target="_blank" rel="noopener noreferrer">TEXT</a>`、外部でない: `<a href="URL">TEXT</a>`。TEXT は `renderInline(text, {depth: depth+1, inLink: true})`。`sanitizeUrl(url,'link')` が null ならマッチ全体の元テキストを文字として出す |
| 自動リンク `https://…` / `http://…` (直前が英数字でない。`inLink` 内では無効) | リンクと同じ形式 (必ず外部)。テキストは URL を `escapeHtml` したもの。URL は空白・`<`・`>` で終わり、末尾の `.,;:!?)` は含めない。`sanitizeUrl` が null なら文字として出す |
| `**x**` | `<strong>X</strong>` |
| `*x*` | `<em>X</em>` |
| `~~x~~` | `<del>X</del>` |
| 行末の空白 2 つ以上 + `\n` | `<br>` の直後に `\n` |
| 単なる `\n` | `\n` のまま |

規則:
- URL 部分は `(` の直後から、**括弧の対応を数えながら**最初の対応する `)` まで。空白を含む URL (タイトル指定 `"..."` も含む) はリンクとして扱わず文字のまま。`[text]` の `]` は対応する括弧を数えて探す。
- 強調は、開始記号の直後と終了記号の直前が空白でないこと。閉じが見つからない開始記号は文字として出力。`_` は強調に使わない。
- 強調やリンクテキストの内側は `renderInline(inner, {depth: depth+1, …})`。`depth >= MAX_INLINE_DEPTH` では記法を解釈せず `escapeHtml(text)` をそのまま出す。
- **計算量**: 入力長 n に対し O(n × MAX_INLINE_DEPTH) で終わること。閉じを探して見つからなかった区切り (`**`, `*`, `~~`、バッククォート列の各長さ、`[`) は結果を記憶し、同じ区切りの後続の開始記号では再探索しない (`*` を 10 万個並べても 2 次にならない)。正規表現は入れ子の量指定子・後方参照・先読みの繰り返しを使わず、走査は文字単位で行う。

### 4.4 block.js

```js
export const MAX_BLOCK_DEPTH = 10;

/**
 * ブロック構造を解釈して HTML 文字列を返す。入力は改行が "\n" に正規化済みの文字列。例外を投げない。
 * ブロックの出力は "\n" で連結する (末尾に改行を付けない)。空入力は ''。
 * @param {string} src
 * @param {{depth?: number}} [opts]  引用の入れ子 (再帰) の深さ。リストの入れ子も同じ深さ数に数える
 * @returns {string}
 */
export function renderBlocks(src, opts) {}
```

ブロックの判定は行頭から次の優先順位で行う (行頭の空白は 0〜3 個まで許す。タブは空白 2 個として数える):

| 優先 | ブロック | 判定 | 出力 |
|---|---|---|---|
| 1 | コードブロック | 行が ```` ``` ```` (3 個以上のバッククォート) で始まる。閉じは同じ数以上のバッククォートだけの行。閉じが無ければ入力の最後まで | `<pre><code class="language-xxx">ESC</code></pre>`。言語名なしは `<pre><code>ESC</code></pre>`。ESC は中身の行を `\n` で連結し `escapeHtml` したもの。言語名 = 開始行の info の最初の単語を toLowerCase したものが `/^[a-z0-9-]{1,32}$/` に一致するときだけ class を付ける (一致しなければ class なし) |
| 2 | 見出し | `#`×1〜6 の直後が空白か行末 (`#tag` は見出しではない)。行末の閉じ `#` 列と前後の空白は除く | `<h1>…</h1>`〜`<h6>…</h6>` (id 属性は付けない)。中身は `renderInline` |
| 3 | 水平線 | `-` `*` `_` のどれか 1 種類だけが 3 個以上 (間の空白は可) の行 | `<hr>` |
| 4 | 引用 | 行頭が `>`。連続する `>` 行の `>` と直後の空白 1 つを外して集め、`renderBlocks(集めた行, {depth: depth+1})` | `<blockquote>\n中身\n</blockquote>` (中身が空なら `<blockquote>\n</blockquote>`)。`>` の付かない継続行 (lazy continuation) は引用に含めない |
| 5 | 表 | `|` を含む行の次の行が区切り行 (`:?-+:?` のセルを `|` で並べたもの。セル数がヘッダと同じ) | 下記 |
| 6 | リスト | 行頭 (インデント後) が `-` `*` `+` + 空白、または `数字(1〜9 桁)` + `.` + 空白 | 下記 |
| 7 | 段落 | 上記以外。次の空行か、1〜6 のいずれかが始まる行まで | `<p>…</p>` (中身は連続行を `\n` で連結して `renderInline`) |

空行はブロックの区切り (出力なし)。`depth >= MAX_BLOCK_DEPTH` に達した引用・リストは構造として解釈せず、その行を段落の文字 (`>` や `-` を含む元の行) として扱う。

**表**
```html
<table>
<thead>
<tr><th class="align-left">h1</th><th>h2</th></tr>
</thead>
<tbody>
<tr><td class="align-left">a</td><td>b</td></tr>
</tbody>
</table>
```
- 揃えは **`class`** で表す (`align` 属性は非推奨・`style` は CSP で禁止のため): `:--` → `class="align-left"`、`:-:` → `class="align-center"`、`--:` → `class="align-right"`、指定なしは class を付けない。`th` と `td` の両方に付ける。CSS 側 (`assets/style.css`) でこの 3 つの class を定義する (impl-ui の責務)。
- 行の先頭・末尾の `|` は省略可。セルは `\|` 以外の `|` で分割 (コードスパン内でも分割する)、各セルは trim して `renderInline`。セル数がヘッダより多い分は捨て、少なければ空セルで補う。データ行が 0 行なら `<tbody>` を出さない。表は空行か `|` を含まない行で終わる。

**リスト**
- 字下げ 2 スペースで 1 段階の入れ子。判定は「直前の項目より 2 以上深い字下げの項目は子」。項目間の空行は無視する (常に tight 表示、項目の中身を `<p>` で包まない)。同じ字下げで `ul`/`ol` の種類が変わったら新しいリスト。`-`/`*`/`+` の違いは同じリストとして扱う。
- 項目の継続行 (マーカーでなく、空行でもなく、項目本文の字下げ以上で始まる行) は項目本文に `\n` で連結する。
- 出力: `<ul>\n<li>A</li>\n<li>B\n<ul>\n<li>C</li>\n</ul></li>\n</ul>`。順序付きは `<ol>`。最初の番号が 1 以外なら `<ol start="N">` (N は整数)。
- チェックリスト: 項目本文が `[ ] ` または `[x] ` / `[X] ` で始まる (`- [ ]` の直後に空白) とき、`<li class="task"><input type="checkbox" disabled> TEXT</li>`。チェック済みは `<input type="checkbox" disabled checked>`。`ol` の項目でも同様。マーカーが外れたあとの TEXT は `renderInline`。

### 4.5 index.js

```js
/**
 * Markdown を安全な HTML 文字列に変換する。この関数が markdown モジュールの唯一の公開 API。
 * - 改行 `\r\n` / `\r` を `\n` に統一し、NUL (U+0000) を除去してから renderBlocks に渡す
 * - string 以外が渡されたら TypeError
 * - string に対しては例外を投げず、入力長に対して線形に近い時間 (§4.3, §7.3) で終わる
 * @param {string} src
 * @returns {string}
 */
export function render(src) {}
```

出力は「`<script>` 等の生タグを含まず、属性値がすべてダブルクォートで囲まれ `escapeHtml` 済み」であることが不変条件。`#tag` は特別扱いせず文字としてそのまま出す。

---

## 5. UI (`src/ui/`)

### 5.1 index.html の DOM と id 一覧

`<head>` の CSP の `<meta>` は現状のまま変更しない。`<script type="module" src="src/ui/main.js">`。インラインの `<script>` / `style=` 属性 / `on*=` 属性は使わない。

```html
<body>
  <div id="app" data-view="edit">
    <header id="toolbar">
      <h1 id="app-title">Markdown メモ帳</h1>
      <button id="btn-new" type="button" aria-label="新しいメモ (Ctrl/Cmd+N)">新規</button>
      <button id="btn-delete" type="button" aria-label="このメモを削除">削除</button>
      <button id="btn-export" type="button" aria-label="JSON で書き出し">書き出し</button>
      <button id="btn-import" type="button" aria-label="JSON を読み込み">読み込み</button>
      <input id="import-file" type="file" accept="application/json,.json" hidden>
      <span id="save-status" role="status" aria-live="polite"></span>
    </header>
    <div id="error-banner" role="alert" hidden>
      <span id="error-text"></span>
      <button id="error-close" type="button" aria-label="エラーを閉じる">×</button>
    </div>
    <aside id="sidebar" aria-label="メモ一覧">
      <input id="search" type="search" placeholder="検索 (Ctrl/Cmd+K)" aria-label="メモを検索">
      <div id="tag-filter" role="group" aria-label="タグで絞り込み"></div>
      <ul id="note-list"></ul>
      <p id="empty-message" hidden>メモがありません</p>
    </aside>
    <main id="workspace">
      <div id="tabs" role="tablist" aria-label="表示切り替え">
        <button id="tab-edit" type="button" role="tab" aria-selected="true" aria-controls="editor">編集</button>
        <button id="tab-preview" type="button" role="tab" aria-selected="false" aria-controls="preview">プレビュー</button>
      </div>
      <textarea id="editor" aria-label="Markdown 本文" spellcheck="false"></textarea>
      <article id="preview" aria-label="プレビュー" tabindex="0"></article>
    </main>
    <dialog id="import-dialog" aria-labelledby="import-title">
      <h2 id="import-title">メモを読み込む</h2>
      <p id="import-summary"></p>
      <button id="import-merge" type="button">統合 (merge)</button>
      <button id="import-replace" type="button">上書き (replace)</button>
      <button id="import-cancel" type="button">キャンセル</button>
    </dialog>
  </div>
</body>
```

- ダイアログは `<form>` を使わない (CSP の `form-action 'none'` を避けるため)。各ボタンの click で `dialog.close(値)` を呼び、`close` イベントの `dialog.returnValue` (`'merge' | 'replace' | 'cancel'`、Esc は `''` = cancel 扱い) で分岐する。`showModal()` を使う。
- `#error-banner` は `hidden` 属性の付け外しで表示を制御。メッセージは `#error-text.textContent` に入れる。
- 読み込みダイアログ (`#import-summary`) の文言: 「ファイル名 (サイズ)。現在のメモ N 件。『統合』は同じ id の新しいほうを残して追加、『上書き』は現在のメモを全て削除します。」
- メモ削除は `globalThis.confirm('このメモを削除しますか?')` で確認する (app.js が呼ぶ。テストで差し替えられるよう `deps.confirm` で受け取る)。

### 5.2 状態オブジェクト (app.js)

```js
/**
 * @typedef {Object} AppState
 * @property {Note[]}  notes        現在の絞り込み条件での store.list() の結果
 * @property {{tag: string, count: number}[]} tags  store.listTags() の結果
 * @property {string|null} selectedId  編集中のメモの id。メモが 1 件も無ければ null
 * @property {string}  draft        エディタの現在の内容 (未保存の可能性あり)
 * @property {string}  query        検索欄の文字列
 * @property {string|null} tag      絞り込み中のタグ (小文字) か null
 * @property {'edit'|'preview'} view  狭い画面のタブ
 * @property {'saved'|'dirty'|'error'} saveStatus
 * @property {{code: string, message: string}|null} error  エラーバナー。null なら非表示
 * @property {boolean} recovered     起動時に壊れたデータを退避した (バナーで告知)
 */
export function createInitialState() {}    // notes:[], tags:[], selectedId:null, draft:'', query:'', tag:null, view:'edit', saveStatus:'saved', error:null, recovered:false

/**
 * アプリを起動する。import しただけでは何も実行されない (副作用なし)。
 * @param {{
 *   document: Document,
 *   store: NotesStore,
 *   render: (src: string) => string,
 *   confirm?: (message: string) => boolean,
 *   now?: () => number
 * }} deps  store と render は注入する (impl-ui は test/ui/mocks.js のモックで動かせる)
 * @returns {{getState: () => AppState, destroy: () => void}}
 */
export function startApp(deps) {}
```

更新の流れ (単方向):

```
ユーザー操作 / タイマー → ハンドラ (store を呼ぶ) → setState(patch) → render(prev, next) → 各モジュールの update(next)
```

- `setState(patch)`: `state = {...state, ...patch}` し、すぐに `render(prev, state)` を呼ぶ。状態を直接書き換えない。
- `render(prev, next)`: 変化したフィールドだけ反映する (参照/値の比較)。
  - `notes`/`tags`/`selectedId`/`query`/`tag` のいずれか変化 → `sidebar.update(next)`
  - `draft` 変化 → `preview.update(next.draft)` (preview 側で 150ms デバウンス)
  - `saveStatus` 変化 → `#save-status.textContent` を「保存済み」「編集中…」「保存に失敗しました」に
  - `error` 変化 → バナーの表示/非表示と文言
  - `view` 変化 → `#app` の `data-view` と、タブの `aria-selected`
  - **エディタ (`textarea`) は render では書き換えない**: キャレット位置が飛ぶため。`selectedId` が変わったときだけハンドラが `editor.setValue(body)` を呼ぶ。
- 主な操作:
  - 入力 (`editor` の `onInput(body)`): `setState({draft: body, saveStatus: 'dirty'})`
  - 自動保存 (`onSave(body)`, 入力停止 500ms 後 / Ctrl+S): `try { store.update(selectedId, {body}) } catch → setState({saveStatus:'error', error})` / 成功時 `setState({saveStatus:'saved', error:null, notes: store.list({query, tag}), tags: store.listTags()})`。失敗しても draft は捨てない (次の入力か Ctrl+S で再試行)
  - 新規 (`btn-new` / Ctrl+N): `editor.flush()` → `store.create({body: ''})` → `selectedId` を新 id、`draft: ''`、`editor.setValue('')`、`editor.focus()`、`view: 'edit'`、一覧を更新
  - 選択 (一覧クリック): `editor.flush()` → `store.get(id)` → `selectedId`/`draft` を更新、`editor.setValue(note.body)`、`preview.flush()` (選択直後は待たずに描画)
  - 削除: `deps.confirm` が true なら `store.remove(id)` → 一覧を再取得 → 先頭のメモを選択、無ければ空メモを 1 件 `create` して選択
  - 検索/タグ: `setState({query | tag})` の後に `notes` を `store.list({query, tag})` で再取得
  - 読み込み完了 (`io` の `onImported(result)`): 一覧・タグを再取得し、選択中の id が消えていれば先頭を選択して `editor.setValue`。結果は `#save-status.textContent` に「N 件を読み込みました」と一時表示 (次の `saveStatus` 変更まで)
  - 起動時: `store.getLoadInfo().recovered` なら `recovered: true` とし、エラーバナーに「保存データを読み込めなかったため退避し、空の状態で起動しました」を表示。メモが 0 件なら空メモを 1 件 `create`、あれば `updatedAt` が最新の 1 件を選択。
- どの `store` 呼び出しも `try/catch` で囲み、`StoreError` を §2.4 の文言に変換して `state.error` に入れる。アプリ全体が例外で止まらないこと。

### 5.3 各 ui モジュールが受け取るもの

すべて **ファクトリ関数** (副作用は呼び出し時だけ)。DOM 要素は引数で受け取り、`document.getElementById` を直接呼ぶのは app.js のみ。DOM への文字列の流し込みは `textContent` / `setAttribute` / `dataset` / `createElement` のみ。

```js
// editor.js
/**
 * @param {{
 *   el: HTMLTextAreaElement,
 *   doc?: Document,                 ショートカットと pagehide の登録先 (既定 el.ownerDocument)
 *   onInput: (body: string) => void,   input イベントごとに即時
 *   onSave: (body: string) => void,    入力が止まって 500ms 後に 1 回。flush() で即時
 *   onShortcut: (name: 'new'|'search') => void,
 *   wait?: number,                     既定 500
 *   timers?: {setTimeout: Function, clearTimeout: Function}  debounce へ渡す (テスト用)
 * }} opts
 * @returns {{setValue(body: string): void, getValue(): string, focus(): void, flush(): void, destroy(): void}}
 */
export function createEditor(opts) {}
```
- `setValue` は保留中の自動保存を **発火させずに破棄** する (呼び出し側が先に `flush()` する)。`onInput` も呼ばない。
- ショートカット: `doc` の `keydown` で `(e.ctrlKey || e.metaKey)` かつ `e.key.toLowerCase()` が `s` → `preventDefault()` して `flush()` (保留が無くても `onSave(getValue())` を呼ぶ)、`n` → `preventDefault()` + `onShortcut('new')`、`k` → `preventDefault()` + `onShortcut('search')`。Shift/Alt 付きは無視。
- `pagehide` と `visibilitychange` (hidden) で `flush()`。

```js
// preview.js
/**
 * @param {{
 *   el: HTMLElement,
 *   render: (src: string) => string,   markdown/index.js の render と同じ契約
 *   wait?: number,                     既定 150
 *   timers?: {setTimeout: Function, clearTimeout: Function}
 * }} opts
 * @returns {{update(src: string): void, flush(): void, destroy(): void}}
 */
export function createPreview(opts) {}
```
- `update` は 150ms デバウンス (最後の呼び出しだけが描画される)。`flush()` は保留中の描画を即実行 (保留が無くても最新の src で描画)。
- 描画は `el.innerHTML = html; // lint-allow: innerHTML` の **この 1 行だけ**。`render` が例外を投げたら `el.textContent = 'プレビューを表示できません'`。
- 初回 (`update` を一度も呼ばない状態) の `el` は空。

```js
// sidebar.js
/**
 * @param {{
 *   searchEl: HTMLInputElement, tagEl: HTMLElement, listEl: HTMLUListElement, emptyEl: HTMLElement,
 *   onSelect: (id: string) => void,
 *   onSearch: (query: string) => void,   input イベントを 150ms デバウンスして通知
 *   onTag: (tag: string|null) => void,   選択中のタグをもう一度押すと null
 *   doc?: Document,
 *   timers?: {setTimeout: Function, clearTimeout: Function}
 * }} opts
 * @returns {{update(state: Pick<AppState,'notes'|'tags'|'selectedId'|'query'|'tag'>): void, focusSearch(): void}}
 */
export function createSidebar(opts) {}
```
- 一覧は `replaceChildren` で作り直す。項目は `<li><button type="button" class="note-item" data-id="…" aria-current="true|false">` の中にタイトル (`<span class="note-title">`)、更新日時 (`<time class="note-date">`、`Intl.DateTimeFormat('ja-JP', {dateStyle:'short', timeStyle:'short'})`)、タグ (`<span class="note-tag">#tag</span>`)。すべて `textContent`。再構築の前にフォーカスが一覧内の `data-id` にあれば、後で同じ id にフォーカスを戻す。
- 検索欄の `value` は、現在値が `state.query` と違うときだけ書き換える (入力中のキャレットを壊さない)。
- タグボタン: `<button type="button" class="tag-chip" aria-pressed="true|false">#tag (count)</button>`。
- `notes` が空なら `emptyEl.hidden = false`。

```js
// io.js
/**
 * @param {{
 *   exportBtn: HTMLElement, importBtn: HTMLElement, fileInput: HTMLInputElement,
 *   dialog: HTMLDialogElement, summaryEl: HTMLElement,
 *   mergeBtn: HTMLElement, replaceBtn: HTMLElement, cancelBtn: HTMLElement,
 *   exportAll: () => ExportFile,
 *   importAll: (json: string, opts: {mode: 'merge'|'replace'}) => ImportResult,
 *   getNoteCount: () => number,
 *   onImported: (result: ImportResult) => void,
 *   onError: (err: unknown) => void,
 *   now?: () => number,
 *   download?: (filename: string, text: string) => void   既定は Blob + URL.createObjectURL + a[download] (終了後 revokeObjectURL)
 * }} opts
 * @returns {{destroy(): void}}
 */
export function createIo(opts) {}

/**
 * 書き出しファイル名。UTC の日時を使う。
 * @param {number} nowMs
 * @returns {string}  例 "mdmemo-20261027-153045.json"
 */
export function exportFileName(nowMs) {}
```
- 書き出し: `JSON.stringify(exportAll(), null, 2)` を `application/json` で保存。
- 読み込み: `importBtn` click → `fileInput.click()`。`change` で `file.size > 20,000,000` なら `onError` (VALIDATION 相当の `{name:'StoreError', code:'VALIDATION', message:'ファイルが大きすぎます', details:[]}`)。そうでなければ `await file.text()` → ダイアログ表示 → 選択 `merge`/`replace` で `importAll(text, {mode})` → `onImported(result)`。`importAll` の例外は `onError`。キャンセル/Esc は何もしない。処理後 `fileInput.value = ''` (同じファイルを再選択できるように)。

```js
// test/ui/mocks.js — impl-ui が用意するテスト用モック (src には置かない)
/** §3.4 の NotesStore と同じ形・振る舞いの簡易版 (メモリのみ。検証は省略可。StoreError 相当は {name:'StoreError', code} の素のオブジェクト/Error で良い) */
export function createMockStore(initialNotes) {}
/** escapeHtml 相当だけを行い `<p>` で包む。markdown 実物の代用 */
export function mockRender(src) {}
```

### 5.4 main.js

`src/ui/main.js` は import しただけで `startApp({document, store: createNotesStore(createLocalStorage()), render})` を実行する唯一のファイル (副作用あり)。ロジックを持たない。

### 5.5 スマホ表示 (assets/style.css)

- `#app` は CSS Grid。幅 > 720px: 左に `#sidebar` (固定幅 260px)、右の `#workspace` を 2 列に分けて `#editor` と `#preview` を並べる。`#tabs` は `display: none`。
- 幅 ≤ 720px (`@media (max-width: 720px)`): 1 列。`#sidebar` は上に積み `max-height: 35vh; overflow: auto`。`#tabs` を表示し、`#app[data-view="edit"] #preview { display: none }`、`#app[data-view="preview"] #editor { display: none }`。
- タブは `click` で `onView('edit'|'preview')` → `setState({view})`。矢印キー左右でタブ間を移動できる (roving tabindex は不要。ボタンはどちらも Tab で到達可)。プレビューへ切り替えたときは `preview.flush()`。
- ダークモード: `:root { color-scheme: light dark; }` と CSS 変数 (`--bg`, `--fg`, `--muted`, `--border`, `--accent`, `--code-bg`) をライト/ダークで定義し、`@media (prefers-color-scheme: dark)` で上書き。本文とリンク色は背景に対して WCAG AA (通常テキスト 4.5:1) を目安にする。
- `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` を全要素に有効にし、`outline: none` を単独で書かない。
- プレビュー用: `.align-left { text-align: left }`、`.align-center { text-align: center }`、`.align-right { text-align: right }`、`li.task { list-style: none }`、`pre code`、`blockquote`、`table`、`img { max-width: 100% }`。`style=` 属性や `<style>` は使わない。

---

## 6. テスト方針

実行は `npm test` (= `node --test`)。DOM を使わないテストが中心。`test/` 配下の `*.test.js` は自動的に拾われる。

### 6.1 ファイル別テスト

| 対象 | テストファイル | 内容 | 担当 |
|---|---|---|---|
| `markdown/escape.js` | `test/markdown/escape.test.js` | `escapeHtml` の 5 文字、`sanitizeUrl` の許可/拒否 (大文字小文字、タブ/改行混入、`&#106;avascript:`、`&colon;`、`java&#x09;script:`、先頭空白、`data:`、`vbscript:`、`\`、相対/`#`/`mailto`、image で `mailto` 拒否)、`isExternalUrl` | impl-markdown |
| `markdown/inline.js` | `test/markdown/inline.test.js` | 各記法の正常系 (出力 HTML は §4 と完全一致)、エスケープ、閉じない記法、リンクの外部/内部、autolink の末尾記号、入れ子の上限 | impl-markdown |
| `markdown/block.js` | `test/markdown/block.test.js` | 見出し、段落、引用の入れ子、リスト (入れ子、`ol start`)、チェックリスト、コードブロックの言語名、水平線、表と揃え、閉じないコードブロック | impl-markdown |
| `markdown/index.js` | `test/markdown/render.test.js` | 記法が混ざった入力、CRLF、`#tag` が文字のままなこと、`TypeError` | impl-markdown |
| 変換の性能 | `test/markdown/perf.test.js` | 100KB の悪意ある入力 (`*`/`` ` ``/`[`/`(`/`>`/`-` の大量反復、深い入れ子の引用とリスト) が各 1 秒以内 | impl-markdown |
| XSS 回帰 | `test/security/xss.test.js` | 50 件以上のペイロード。各出力に対し: (a) `<script`、`<img`、`<svg`、`<iframe`、`onerror=` 等の **ペイロード由来の生タグが無い** (変換器が出す許可済みタグ `<a>` `<img>` を除外して判定: 出力から `<(a|img|p|…)` の許可リストのタグ名を持つ開始タグだけを取り出し、それ以外のタグ名が無いことを確認)、(b) すべての `href`/`src` 属性値が `http:` `https:` `mailto:` 相対 `#` のいずれか、(c) 属性値はダブルクォートで閉じており `on\w+=` の属性が存在しない | impl-markdown |
| `store/tags.js` | `test/store/tags.test.js` | `extractTags` (見出しと区別、コード内を無視、小文字化、重複、51 文字)、`deriveTitle` (見出し優先、最初の行、空で "無題"、200 文字、コードブロック内の `#`) | impl-store |
| `store/schema.js` | `test/store/schema.test.js` | 型違反、文字数上限 (200 / 1,048,576 / 境界ちょうど)、5,000 件、知らないキーの破棄、`__proto__`/`constructor`/`prototype` の拒否 (JSON.parse 経由で)、version 違い、details の形 | impl-store |
| `store/storage.js` | `test/store/storage.test.js` | メモリ実装の get/set/remove、quota、`createLocalStorage` に偽 backend を渡す | impl-store |
| `store/notes.js` | `test/store/notes.test.js` | CRUD、`now`/`genId` を差し替えた決定的なテスト、list の並び順と query/tag の AND、listTags、update の no-op と単調増加、容量超過での巻き戻し (`quotaChars` 指定)、壊れたデータからの復旧 (退避キーに残る、`getLoadInfo`)、exportAll → importAll の往復、merge/replace、id 重複、不正ファイルで store が変化しないこと、プロトタイプ汚染 (`({}).polluted === undefined`) | impl-store |
| `util/debounce.js` | `test/util/debounce.test.js` | 偽タイマーを注入して trailing・cancel・flush・pending | impl-ui |
| `ui` の純粋関数 | `test/ui/*.test.js` | `exportFileName`、`createInitialState`、`mocks.js` の `createMockStore` が §3.4 の形を満たすこと。DOM を使うモジュール (editor/preview/sidebar/io/app) は、最小の偽 DOM オブジェクト (必要なメソッドだけ持つ plain object) で `preview` のデバウンスと `innerHTML` 代入先、`editor` のショートカット分岐をテストしてよい (任意) | impl-ui |
| 静的チェック | `test/security/static.test.js` | §6.2 | impl-ui |

テスト内では `crypto.randomUUID`・実時間・実 `localStorage` に依存しない (store は `createMemoryStorage` と `deps.now`/`deps.genId` で固定する)。

### 6.2 静的チェックテスト仕様 (`test/security/static.test.js`)

対象: `src/` 配下の **すべての `.js` ファイル** (再帰。`fs.readdir(…, {recursive: true})`) と `index.html`。`test/` は対象外。

**禁止パターン** (行ごとに判定。コメント行も含める):

| 名前 | 正規表現 |
|---|---|
| innerHTML | `/\binnerHTML\b/` |
| outerHTML | `/\bouterHTML\b/` |
| insertAdjacentHTML | `/\binsertAdjacentHTML\b/` |
| document.write | `/\bdocument\s*\.\s*write(ln)?\b/` |
| eval | `/\beval\s*\(/` |
| new Function | `/\bnew\s+Function\b/` と `/\bFunction\s*\(/` |
| 動的 import | `/\bimport\s*\(/` |
| 外部リソース | `/from\s+['"]https?:/`、`/\bfetch\s*\(/`、`/\bXMLHttpRequest\b/`、`/\bWebSocket\b/`、`/\bsendBeacon\b/` |
| 文字列のタイマー | `/\bset(Timeout|Interval)\s*\(\s*['"`]/` |

**許可する 1 か所の指定**: `src/ui/preview.js` の中で、**行内に文字列 `lint-allow: innerHTML` を含む行**だけ、`innerHTML` パターンの違反を免除する。それ以外のパターンやファイルでは免除しない。さらに、

1. 免除行は `src` 全体でちょうど 1 行 (0 行でも 2 行以上でもテスト失敗)。
2. その行は `.innerHTML =` を含む代入であること。

**追加の検査** (同じテストファイル内の別 `test()`):

- `index.html`: インライン `<script>` (`src` 属性のない `<script`) が無い、`style="` 属性が無い、`\son\w+\s*=` (イベントハンドラ属性) が無い、`<style` が無い。CSP の `<meta>` が §要件どおりの文字列を含む (scaffold.test.js と同じ正規表現)。`index.html` が参照する `src/ui/main.js` と `assets/style.css` が存在する。
- `package.json`: `dependencies` が空オブジェクト (または未定義)、`devDependencies` も空/未定義。
- `assets/style.css`: `@import` と `url(http` を含まない。

違反時のメッセージは `ファイル:行番号: パターン名` の形式にして、一覧で出す (assert の message に全違反を連結)。

---

## 7. その他の決定事項

### 7.1 util/debounce.js

```js
/**
 * trailing 方式のデバウンス。呼び出しが wait ms 途切れたら、最後の引数で fn を 1 回呼ぶ。
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} wait  ミリ秒 (0 以上)
 * @param {{setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout}} [timers]  既定はグローバル。テストで偽物を注入
 * @returns {F & {cancel(): void, flush(): void, pending(): boolean}}
 *   cancel: 保留を破棄 / flush: 保留があれば今すぐ最後の引数で fn を呼ぶ (無ければ何もしない) / pending: 保留中か
 */
export function debounce(fn, wait, timers) {}
```
(preview の `flush()` は「保留が無くても最新の src で描画」するので、preview 側は最新の src を自分で保持する。)

### 7.2 時刻と ID

`createNotesStore` の `deps.now` / `deps.genId` で差し替える (§3.4)。UI 側は `startApp` の `deps.now` (読み込み結果表示と `exportFileName` 用) のみ。ID はユーザー入力由来を信用せず、UI は `data-id` などに文字列として入れるだけで、セレクタ文字列には連結しない。

### 7.3 入れ子・計算量の上限まとめ

| 項目 | 上限 | 超えたとき |
|---|---|---|
| 引用 + リストの入れ子 | `MAX_BLOCK_DEPTH = 10` | それ以上は構造化せず、行を文字として段落に |
| 強調・リンクの入れ子 | `MAX_INLINE_DEPTH = 10` | 内側は文字として出力 |
| 変換時間 | 100KB の悪意ある入力で 1 秒以内 (目標は 100ms 以下) | — |
| タグ | 1 メモ 50 個・各 50 文字 | 超過分を無視 |
| 読み込み | ファイル 20,000,000 文字、5,000 件、本文 1,048,576 文字、タイトル 200 文字 | VALIDATION |

### 7.4 セキュリティ要件との対応

| 要件 | 設計上の担保 |
|---|---|
| Markdown の XSS | §4.1 の escape-first、§4.2 の URL 許可リスト、`class` の言語名は `[a-z0-9-]` のみ、`xss.test.js` |
| JSON 経由の XSS・汚染 | §3.3 の検証と正規化 (`title`/`tags` も再計算)、禁止キーの拒否、UI は `textContent` のみ |
| 禁止 API | §6.2 の静的チェック。許可は preview.js の 1 行 |
| CSP | `index.html` の `<meta>` は固定。インライン・`style` 属性なし、表の揃えは class、ダイアログは `<form>` 不使用 |
| 外部リンク | §4.3 の `target="_blank" rel="noopener noreferrer"` |
| ReDoS | §4.3 の線形走査・失敗記憶、`perf.test.js` |
| 依存なし | `package.json` の dependencies 空 (§6.2 で検査) |

---

## 8. 実装者ごとの担当ファイル (重複なし)

| 実装者 | 作る・変更するファイル |
|---|---|
| **impl-markdown** | `src/markdown/escape.js`, `src/markdown/inline.js`, `src/markdown/block.js`, `src/markdown/index.js`, `test/markdown/*.test.js`, `test/security/xss.test.js` |
| **impl-store** | `src/store/notes.js`, `src/store/storage.js`, `src/store/schema.js`, `src/store/tags.js`, `test/store/*.test.js` |
| **impl-ui** | `src/ui/app.js`, `src/ui/editor.js`, `src/ui/preview.js`, `src/ui/sidebar.js`, `src/ui/io.js`, `src/ui/main.js`, `test/ui/mocks.js`, `src/util/debounce.js`, `index.html`, `assets/style.css`, `test/ui/*.test.js`, `test/util/debounce.test.js`, `test/security/static.test.js` |
| (誰も触らない) | `package.json`, `test/scaffold.test.js`, `.github/**`, `README.md`, `docs/**` (Orchestrator の担当) |

他の担当のファイルは変更しない。必要な変更・食い違いに気づいたら、実装は設計書どおりに進め、最終報告に「設計書の曖昧な点/矛盾」として書く。

### 8.1 並列実装のための補足

- **impl-ui**: `src/markdown` と `src/store` が存在しなくても動かせるようにする。`app.js` などは `deps` からのみ受け取り、動作確認は `createMockStore()` / `mockRender` を `startApp` に渡して行う (ローカル確認用に `python3 -m http.server` で `index.html?mock=1` のような仕組みを作る必要はない。`main.js` は常に実物を配線する)。
- **impl-store / impl-markdown**: ui を一切参照しない。互いのモジュールも import しない。
- 統合 (Orchestrator) は、`main.js` の配線と `npm test` の全件通過、ローカルでの手動確認で行う。
