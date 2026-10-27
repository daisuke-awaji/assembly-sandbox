import { escapeHtml, sanitizeUrl, isExternalUrl } from './escape.js';

export const MAX_INLINE_DEPTH = 10;

const ASCII_PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

const UNICODE_WS = /\s/u;

function isWs(code) {
  return code <= 32 || code === 0xa0 || code === 0x3000;
}

function isAlnum(ch) {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** ソート済み配列から v 以上の最初の要素を二分探索する。無ければ -1 */
function lowerBound(arr, v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo < arr.length ? arr[lo] : -1;
}

/**
 * 対応する開き・閉じ括弧の位置表を 1 回の走査で作る (バックスラッシュの次の 1 文字は読み飛ばす)。
 * @returns {Int32Array} 開き括弧の位置 → 対応する閉じ括弧の位置 (無ければ -1)
 */
function matchPairs(text, open, close) {
  const table = new Int32Array(text.length).fill(-1);
  const stack = [];
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (c === '\\') k++;
    else if (c === open) stack.push(k);
    else if (c === close && stack.length > 0) table[stack.pop()] = k;
  }
  return table;
}

/**
 * インライン記法を HTML に変換する。入力は生の文字列 (エスケープ前)。必ず安全な HTML 断片を返し、例外を投げない。
 * @param {string} text
 * @param {{depth?: number, inLink?: boolean}} [opts]
 * @returns {string}
 */
export function renderInline(text, opts) {
  if (typeof text !== 'string') return '';
  const depth = (opts && opts.depth) || 0;
  const inLink = !!(opts && opts.inLink);
  if (depth >= MAX_INLINE_DEPTH) return escapeHtml(text);

  const n = text.length;
  let out = '';
  let plain = 0; // まだ出力していない通常文字の開始位置
  let i = 0;

  // 必要になったときだけ作る補助表 (どれも O(n) で 1 回きり)
  let bracketClose = null;
  let parenClose = null;
  let nextSpace = null;
  let tickRuns = null;

  // 閉じが見つからなかった探索の開始位置の最小値。これ以降の開始記号は再探索しない
  let strongFail = Infinity;
  let emFail = Infinity;
  let delFail = Infinity;

  function emit(html, next) {
    if (plain < i) out += escapeHtml(text.slice(plain, i));
    out += html;
    i = next;
    plain = next;
  }

  function getBrackets() {
    if (bracketClose === null) bracketClose = matchPairs(text, '[', ']');
    return bracketClose;
  }

  function getParens() {
    if (parenClose === null) parenClose = matchPairs(text, '(', ')');
    return parenClose;
  }

  function hasSpaceBetween(from, to) {
    if (nextSpace === null) {
      nextSpace = new Int32Array(n + 1);
      nextSpace[n] = n;
      for (let k = n - 1; k >= 0; k--) {
        nextSpace[k] = text.charCodeAt(k) <= 32 ? k : nextSpace[k + 1];
      }
    }
    return nextSpace[from] < to;
  }

  /** `](url)` を調べる。リンクとして成立すれば { end, url } を返す。end は `)` の位置 */
  function destination(closeBracket) {
    if (closeBracket < 0 || text[closeBracket + 1] !== '(') return null;
    const p = closeBracket + 1;
    const q = getParens()[p];
    if (q < 0 || hasSpaceBetween(p + 1, q)) return null;
    return { end: q, url: text.slice(p + 1, q) };
  }

  /** 区切り文字 ch の連なり (最大連続) のうち、閉じとして使えるものを from 以降で探す */
  function findCloser(ch, from, minRun, exactRun) {
    const code = ch.charCodeAt(0);
    let k = from;
    while (k < n) {
      if (text.charCodeAt(k) !== code) {
        k++;
        continue;
      }
      let e = k + 1;
      while (e < n && text.charCodeAt(e) === code) e++;
      const startsRun = k === 0 || text.charCodeAt(k - 1) !== code;
      const len = e - k;
      if (startsRun && k > 0 && (exactRun ? len === 1 : len >= minRun)) {
        const prev = text.charCodeAt(k - 1);
        if (!isWs(prev) && prev !== 92) return { start: k, end: e };
      }
      k = e;
    }
    return null;
  }

  function buildTickRuns() {
    tickRuns = new Map();
    let k = 0;
    while (k < n) {
      if (text.charCodeAt(k) !== 96) {
        k++;
        continue;
      }
      let e = k + 1;
      while (e < n && text.charCodeAt(e) === 96) e++;
      const len = e - k;
      const list = tickRuns.get(len);
      if (list) list.push(k);
      else tickRuns.set(len, [k]);
      k = e;
    }
  }

  function linkHtml(url, innerHtml, external) {
    return external
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${innerHtml}</a>`
      : `<a href="${escapeHtml(url)}">${innerHtml}</a>`;
  }

  function inner(s) {
    return renderInline(s, { depth: depth + 1, inLink });
  }

  while (i < n) {
    const c = text.charCodeAt(i);

    if (c === 92) {
      // バックスラッシュ
      if (i + 1 < n && ASCII_PUNCT.includes(text[i + 1])) emit(escapeHtml(text[i + 1]), i + 2);
      else i++;
      continue;
    }

    if (c === 96) {
      // `code`
      let e = i + 1;
      while (e < n && text.charCodeAt(e) === 96) e++;
      const len = e - i;
      if (tickRuns === null) buildTickRuns();
      const list = tickRuns.get(len);
      const close = list ? lowerBound(list, e) : -1;
      if (close === -1) {
        i = e;
        continue;
      }
      let code = text.slice(e, close);
      if (code.length >= 2 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim() !== '') {
        code = code.slice(1, -1);
      }
      emit(`<code>${escapeHtml(code)}</code>`, close + len);
      continue;
    }

    if (c === 33 && text.charCodeAt(i + 1) === 91) {
      // ![alt](url)
      const closeB = getBrackets()[i + 1];
      const dest = destination(closeB);
      if (dest) {
        const src = sanitizeUrl(dest.url, 'image');
        if (src === null) {
          emit(escapeHtml(text.slice(i, dest.end + 1)), dest.end + 1);
        } else {
          const alt = text.slice(i + 2, closeB);
          emit(
            `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer">`,
            dest.end + 1,
          );
        }
        continue;
      }
      i++;
      continue;
    }

    if (c === 91 && !inLink) {
      // [text](url) (リンクのラベル内ではリンクにしない: <a> の入れ子を避ける)
      const closeB = getBrackets()[i];
      const dest = destination(closeB);
      if (dest) {
        const href = sanitizeUrl(dest.url, 'link');
        if (href === null) {
          emit(escapeHtml(text.slice(i, dest.end + 1)), dest.end + 1);
        } else {
          const label = renderInline(text.slice(i + 1, closeB), { depth: depth + 1, inLink: true });
          emit(linkHtml(href, label, isExternalUrl(href)), dest.end + 1);
        }
        continue;
      }
      i++;
      continue;
    }

    if ((c === 104 || c === 72) && !inLink) {
      // 自動リンク
      const head = text.slice(i, i + 8).toLowerCase();
      const schemeLen = head.startsWith('https://') ? 8 : head.startsWith('http://') ? 7 : 0;
      if (schemeLen > 0 && (i === 0 || !isAlnum(text[i - 1]))) {
        let e = i + schemeLen;
        let opens = 0;
        let closes = 0;
        while (e < n) {
          const ch = text.charCodeAt(e);
          if (ch <= 32 || ch === 60 || ch === 62 || (ch > 127 && UNICODE_WS.test(text[e]))) break;
          if (ch === 40) opens++;
          else if (ch === 41) closes++;
          e++;
        }
        // 末尾の句読点を削る。`)` は対応する `(` が URL 内に無いときだけ削る
        while (e > i + schemeLen) {
          const last = text[e - 1];
          if (last === ')') {
            if (closes <= opens) break;
            closes--;
          } else if (!'.,;:!?'.includes(last)) break;
          e--;
        }
        if (e > i + schemeLen) {
          const url = text.slice(i, e);
          const href = sanitizeUrl(url, 'link');
          if (href === null) emit(escapeHtml(url), e);
          else emit(linkHtml(href, escapeHtml(url), true), e);
          continue;
        }
      }
      i++;
      continue;
    }

    if (c === 42) {
      // ** と *
      let e = i + 1;
      while (e < n && text.charCodeAt(e) === 42) e++;
      const runLen = e - i;
      if (runLen >= 2 && e < n && !isWs(text.charCodeAt(i + 2)) && e < strongFail) {
        const close = findCloser('*', e, 2, false);
        if (close) {
          emit(`<strong>${inner(text.slice(i + 2, close.end - 2))}</strong>`, close.end);
          continue;
        }
        strongFail = e;
      }
      if (i + 1 < n && !isWs(text.charCodeAt(i + 1)) && i + 1 < emFail) {
        const close = findCloser('*', i + 1, 1, true);
        if (close) {
          emit(`<em>${inner(text.slice(i + 1, close.start))}</em>`, close.end);
          continue;
        }
        emFail = i + 1;
      }
      i = e; // 開始記号になれなかった連なりは文字として読み飛ばす
      continue;
    }

    if (c === 126) {
      // ~~
      let e = i + 1;
      while (e < n && text.charCodeAt(e) === 126) e++;
      if (e - i >= 2 && e < n && !isWs(text.charCodeAt(i + 2)) && e < delFail) {
        const close = findCloser('~', e, 2, false);
        if (close) {
          emit(`<del>${inner(text.slice(i + 2, close.end - 2))}</del>`, close.end);
          continue;
        }
        delFail = e;
      }
      i = e;
      continue;
    }

    if (c === 32) {
      // 行末の空白 2 つ以上 + 改行 → <br>
      let e = i + 1;
      while (e < n && text.charCodeAt(e) === 32) e++;
      if (e - i >= 2 && text.charCodeAt(e) === 10) emit('<br>', e);
      else i = e;
      continue;
    }

    i++;
  }

  if (plain < n) out += escapeHtml(text.slice(plain));
  return out;
}
