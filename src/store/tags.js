// 本文からタイトルとタグを導出する。他のモジュールに依存しない。

const TITLE_MAX = 200;
const TAG_MAX_LENGTH = 50;
const TAGS_MAX = 50;
const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]+)/gu;

/**
 * フェンス開始行ならバッククォートの個数、そうでなければ 0。
 * @param {string} line
 * @returns {number}
 */
function fenceOpenLength(line) {
  let i = 0;
  while (i < 3 && line[i] === ' ') i++;
  let n = 0;
  while (line[i + n] === '`') n++;
  return n >= 3 ? n : 0;
}

/**
 * フェンス終了行か (同数以上のバッククォートだけの行)。
 * @param {string} line
 * @param {number} openLength
 */
function isFenceClose(line, openLength) {
  const t = line.trim();
  if (t.length < openLength) return false;
  for (let i = 0; i < t.length; i++) if (t[i] !== '`') return false;
  return true;
}

/**
 * フェンスコードブロックの外にある行だけを順に返す。
 * @param {string} body
 * @returns {Generator<string>}
 */
function* linesOutsideFences(body) {
  let open = 0;
  for (const line of body.split(/\r\n|\r|\n/)) {
    if (open) {
      if (isFenceClose(line, open)) open = 0;
      continue;
    }
    const n = fenceOpenLength(line);
    if (n) {
      open = n;
      continue;
    }
    yield line;
  }
}

/**
 * 1 行からインラインコードを取り除く (空白以外の印に置き換える)。
 * @param {string} line
 * @returns {string}
 */
function stripInlineCode(line) {
  if (!line.includes('`')) return line;
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i++];
      continue;
    }
    let n = 0;
    while (line[i + n] === '`') n++;
    // 同じ長さのバッククォート列を探す
    let j = i + n;
    let close = -1;
    while (j < line.length) {
      if (line[j] !== '`') {
        j++;
        continue;
      }
      let m = 0;
      while (line[j + m] === '`') m++;
      if (m === n) {
        close = j;
        break;
      }
      j += m;
    }
    if (close === -1) {
      out += line.slice(i, i + n);
      i += n;
    } else {
      out += '\u0001';
      i = close + n;
    }
  }
  return out;
}

/**
 * #tag を取り出す。
 * @param {string} body
 * @returns {string[]}
 */
export function extractTags(body) {
  const seen = new Set();
  for (const line of linesOutsideFences(body)) {
    if (!line.includes('#')) continue;
    for (const m of stripInlineCode(line).matchAll(TAG_RE)) {
      if (m[2].length > TAG_MAX_LENGTH) continue;
      const tag = m[2].toLowerCase();
      if (tag.length > TAG_MAX_LENGTH) continue;
      seen.add(tag);
      if (seen.size >= TAGS_MAX) return [...seen];
    }
  }
  return [...seen];
}

/**
 * 見出し行なら中身 (閉じ # と前後の空白を除いたもの)、見出しでなければ null。
 * @param {string} line
 * @returns {string|null}
 */
function headingText(line) {
  let i = 0;
  while (i < 3 && line[i] === ' ') i++;
  let n = 0;
  while (line[i + n] === '#') n++;
  if (n < 1 || n > 6) return null;
  const sep = line[i + n];
  if (sep !== ' ' && sep !== '\t') return null;
  let text = line.slice(i + n).trim();
  if (text === '') return null;
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end--;
  if (end === 0) return '';
  if (end < text.length && (text[end - 1] === ' ' || text[end - 1] === '\t')) {
    text = text.slice(0, end).trim();
  }
  return text;
}

/**
 * 行頭の引用記号・リスト記号・チェックボックスを取り除いて trim する。
 * @param {string} line
 * @returns {string}
 */
function stripBlockMarkers(line) {
  let t = line.trim();
  for (;;) {
    const next = t
      .replace(/^>\s*/, '')
      .replace(/^(?:[-*+]|\d+[.)])(?:\s+|$)/, '')
      .replace(/^\[[ xX]\](?:\s+|$)/, '');
    if (next === t) return t;
    t = next.trim();
  }
}

/**
 * タイトルを導出する。
 * @param {string} body
 * @returns {string}
 */
export function deriveTitle(body) {
  for (const line of linesOutsideFences(body)) {
    const h = headingText(line);
    if (h) return h.slice(0, TITLE_MAX);
  }
  for (const line of linesOutsideFences(body)) {
    const t = stripBlockMarkers(line);
    if (t) return t.slice(0, TITLE_MAX);
  }
  return '無題';
}

/**
 * タグ引数の正規化: 先頭の # を 1 つ取り、trim し、小文字化。
 * @param {string} tag
 * @returns {string}
 */
export function normalizeTag(tag) {
  let s = String(tag);
  if (s.startsWith('#')) s = s.slice(1);
  return s.trim().toLowerCase();
}
