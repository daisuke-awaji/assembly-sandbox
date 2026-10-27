const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const NEEDS_ESCAPE = /[&<>"']/;
const ESCAPE_ALL = /[&<>"']/g;

/**
 * & < > " ' を &amp; &lt; &gt; &quot; &#39; に置換する (1 回の走査)。属性値にも同じ関数を使う。
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  s = String(s);
  if (!NEEDS_ESCAPE.test(s)) return s;
  return s.replace(ESCAPE_ALL, (c) => HTML_ESCAPES[c]);
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n',
  lpar: '(', rpar: ')', sol: '/', bsol: '\\', num: '#', lsqb: '[', rsqb: ']', lbrack: '[', rbrack: ']',
  period: '.', comma: ',', semi: ';', excl: '!', quest: '?', commat: '@', percnt: '%', equals: '=',
  plus: '+', ast: '*', lowbar: '_', grave: '`', dollar: '$', verbar: '|', vert: '|', nbsp: '\u00a0',
};

// 先頭の & から始まる 1 つのエンティティ。量指定子は 1 段で、入れ子にしない
const ENTITY = /&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,8})|([a-zA-Z]{2,8}));?/g;

function decodeEntitiesOnce(s) {
  return s.replace(ENTITY, (m, dec, hex, name) => {
    if (name !== undefined) {
      const v = NAMED_ENTITIES[name.toLowerCase()];
      return v === undefined ? m : v;
    }
    const cp = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    if (cp > 0x10ffff) return '\ufffd';
    return String.fromCodePoint(cp);
  });
}

// 制御文字・空白・不可視文字 (URL の判定時に取り除くもの)
const STRIP = /[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g;

/**
 * リンク/画像の URL を検証し、出力してよい文字列を返す。通らなければ null。
 * 戻り値は属性に入れるとき必ず escapeHtml を通すこと。
 * @param {string} raw
 * @param {'link'|'image'} [kind='link']
 * @returns {string|null}
 */
export function sanitizeUrl(raw, kind = 'link') {
  if (typeof raw !== 'string') return null;
  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    const next = decodeEntitiesOnce(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  const probe = decoded.replace(STRIP, '').toLowerCase();
  if (probe === '' || probe.includes('\\')) return null;

  const colon = probe.indexOf(':');
  if (colon !== -1) {
    let firstSep = probe.length;
    for (const sep of ['/', '?', '#']) {
      const k = probe.indexOf(sep);
      if (k !== -1 && k < firstSep) firstSep = k;
    }
    if (colon < firstSep) {
      const scheme = probe.slice(0, colon);
      const allowed = kind === 'image' ? ['http', 'https'] : ['http', 'https', 'mailto'];
      if (!allowed.includes(scheme)) return null;
    }
  }
  return raw.replace(STRIP, '');
}

/**
 * sanitizeUrl が返した URL が外部 (別オリジン) か。
 * @param {string} url
 * @returns {boolean}
 */
export function isExternalUrl(url) {
  return /^(?:https?:|\/\/)/i.test(url);
}
