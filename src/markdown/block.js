import { renderInline } from './inline.js';
import { escapeHtml } from './escape.js';

export const MAX_BLOCK_DEPTH = 10;

const LANG_RE = /^[a-z0-9-]{1,32}$/;
const DELIM_CELL_RE = /^:?-+:?$/;

/** 行頭の空白の数 (タブは 2) と、最初の非空白文字の位置 */
function leading(line) {
  let width = 0;
  let k = 0;
  while (k < line.length) {
    const c = line.charCodeAt(k);
    if (c === 32) width += 1;
    else if (c === 9) width += 2;
    else break;
    k++;
  }
  return { width, pos: k };
}

function isBlank(line) {
  return line.trim() === '';
}

/** コードフェンスの開始行なら { len, info } */
function fenceOpen(line) {
  const { width, pos } = leading(line);
  if (width > 3) return null;
  let e = pos;
  while (e < line.length && line.charCodeAt(e) === 96) e++;
  if (e - pos < 3) return null;
  return { len: e - pos, info: line.slice(e) };
}

function isFenceClose(line, len) {
  const t = line.trim();
  if (t.length < len) return false;
  for (let k = 0; k < t.length; k++) if (t.charCodeAt(k) !== 96) return false;
  return true;
}

/** ATX 見出しなら { level, text } */
function heading(line) {
  const { width, pos } = leading(line);
  if (width > 3) return null;
  let e = pos;
  while (e < line.length && line.charCodeAt(e) === 35) e++;
  const level = e - pos;
  if (level < 1 || level > 6) return null;
  if (e < line.length && line.charCodeAt(e) !== 32 && line.charCodeAt(e) !== 9) return null;
  let text = line.slice(e).trim();
  let k = text.length;
  while (k > 0 && text.charCodeAt(k - 1) === 35) k--;
  if (k === 0) text = '';
  else if (k < text.length && (text[k - 1] === ' ' || text[k - 1] === '\t')) text = text.slice(0, k).trimEnd();
  return { level, text };
}

function isHr(line) {
  const { width, pos } = leading(line);
  if (width > 3) return false;
  const mark = line[pos];
  if (mark !== '-' && mark !== '*' && mark !== '_') return false;
  let count = 0;
  for (let k = pos; k < line.length; k++) {
    const ch = line[k];
    if (ch === mark) count++;
    else if (ch !== ' ' && ch !== '\t') return false;
  }
  return count >= 3;
}

function isQuote(line) {
  const { width, pos } = leading(line);
  return width <= 3 && line[pos] === '>';
}

/** リスト項目の行なら { indent, ordered, num, content, markerLen } (indent の上限は呼び出し側が見る) */
function listMarker(line) {
  const { width, pos } = leading(line);
  const ch = line[pos];
  if (ch === '-' || ch === '*' || ch === '+') {
    const next = line[pos + 1];
    if (next !== ' ' && next !== '\t') return null;
    return { indent: width, ordered: false, num: 0, content: line.slice(pos + 2).trimStart(), markerLen: 1 };
  }
  let e = pos;
  while (e < line.length && e - pos < 10 && line.charCodeAt(e) >= 48 && line.charCodeAt(e) <= 57) e++;
  const digits = e - pos;
  if (digits < 1 || digits > 9 || line[e] !== '.') return null;
  const next = line[e + 1];
  if (next !== ' ' && next !== '\t') return null;
  return {
    indent: width,
    ordered: true,
    num: Number.parseInt(line.slice(pos, e), 10),
    content: line.slice(e + 2).trimStart(),
    markerLen: digits + 1,
  };
}

/** `|` で分割したセル (先頭・末尾の `|` は除く)。`\|` では分割しない */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let start = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c === 92) k++;
    else if (c === 124) {
      cells.push(s.slice(start, k).trim());
      start = k + 1;
    }
  }
  cells.push(s.slice(start).trim());
  return cells;
}

/** lines[i] が表のヘッダ行で lines[i+1] が区切り行なら { head, aligns } */
function tableStart(lines, i) {
  if (i + 1 >= lines.length) return null;
  const header = lines[i];
  const delim = lines[i + 1];
  if (!header.includes('|') || !delim.includes('|')) return null;
  if (leading(header).width > 3) return null;
  const aligns = splitRow(delim);
  if (!aligns.every((cell) => DELIM_CELL_RE.test(cell))) return null;
  const head = splitRow(header);
  if (head.length !== aligns.length) return null;
  return {
    head,
    aligns: aligns.map((cell) => {
      const left = cell.startsWith(':');
      const right = cell.endsWith(':');
      if (left && right) return 'center';
      if (left) return 'left';
      if (right) return 'right';
      return '';
    }),
  };
}

function startsBlock(lines, i, depth) {
  const line = lines[i];
  if (leading(line).width > 3) return false;
  if (fenceOpen(line) || heading(line) || isHr(line)) return true;
  if (depth < MAX_BLOCK_DEPTH) {
    if (isQuote(line)) return true;
  }
  if (tableStart(lines, i)) return true;
  if (depth < MAX_BLOCK_DEPTH && listMarker(line)) return true;
  return false;
}

function cellHtml(tag, align, text) {
  const cls = align ? ` class="align-${align}"` : '';
  return `<${tag}${cls}>${renderInline(text)}</${tag}>`;
}

function renderTable(lines, i, table) {
  const cols = table.head.length;
  const out = ['<table>', '<thead>'];
  out.push(`<tr>${table.head.map((t, k) => cellHtml('th', table.aligns[k], t)).join('')}</tr>`);
  out.push('</thead>');
  let j = i + 2;
  const rows = [];
  while (j < lines.length && !isBlank(lines[j]) && lines[j].includes('|')) {
    const cells = splitRow(lines[j]);
    const cut = cells.slice(0, cols);
    while (cut.length < cols) cut.push('');
    rows.push(`<tr>${cut.map((t, k) => cellHtml('td', table.aligns[k], t)).join('')}</tr>`);
    j++;
  }
  if (rows.length > 0) out.push('<tbody>', ...rows, '</tbody>');
  out.push('</table>');
  return { html: out.join('\n'), next: j };
}

// ---- リスト ----

function newList(ordered, start) {
  return { ordered, start, items: [] };
}

function newItem(m) {
  return { indent: m.indent, contentIndent: m.indent + m.markerLen + 1, lines: [m.content], children: [] };
}

/** lines[i] から始まるリストを読み取り、木を作って HTML にする */
function parseList(lines, i, depth) {
  const first = listMarker(lines[i]);
  const rootLists = [];
  const stack = [];
  let list = newList(first.ordered, first.num);
  rootLists.push(list);
  let last = newItem(first);
  list.items.push(last);
  stack.push({ container: rootLists, list, indent: first.indent });

  let j = i + 1;
  while (j < lines.length) {
    let line = lines[j];
    if (isBlank(line)) {
      let k = j + 1;
      while (k < lines.length && isBlank(lines[k])) k++;
      if (k >= lines.length) break;
      line = lines[k];
      if (!(listMarker(line) && !isHr(line)) && leading(line).width < last.contentIndent) break;
      j = k;
    }
    const m = isHr(line) ? null : listMarker(line);
    if (m) {
      if (m.indent >= last.indent + 2) {
        if (depth + stack.length >= MAX_BLOCK_DEPTH) {
          last.lines.push(line.trim());
        } else {
          const child = newList(m.ordered, m.num);
          last.children.push(child);
          stack.push({ container: last.children, list: child, indent: m.indent });
          last = newItem(m);
          child.items.push(last);
        }
      } else {
        while (stack.length > 1 && m.indent < stack[stack.length - 1].indent) stack.pop();
        const top = stack[stack.length - 1];
        if (top.list.ordered !== m.ordered) {
          top.list = newList(m.ordered, m.num);
          top.container.push(top.list);
        }
        last = newItem(m);
        top.list.items.push(last);
      }
    } else if (!isHr(line) && leading(line).width >= last.contentIndent) {
      last.lines.push(line.trimStart());
    } else {
      break;
    }
    j++;
  }
  return { html: rootLists.map(listHtml).join('\n'), next: j };
}

function listHtml(list) {
  const tag = list.ordered ? 'ol' : 'ul';
  const open = list.ordered && list.start !== 1 ? `<ol start="${list.start}">` : `<${tag}>`;
  const items = list.items.map(itemHtml);
  return `${open}\n${items.join('\n')}\n</${tag}>`;
}

function itemHtml(item) {
  let text = item.lines.join('\n').trimEnd();
  let open = '<li>';
  let prefix = '';
  const task = /^\[([ xX])\] /.exec(text);
  if (task) {
    open = '<li class="task">';
    prefix = task[1] === ' ' ? '<input type="checkbox" disabled> ' : '<input type="checkbox" disabled checked> ';
    text = text.slice(4);
  }
  let body = prefix + renderInline(text);
  if (item.children.length > 0) body += `\n${item.children.map(listHtml).join('\n')}`;
  return `${open}${body}</li>`;
}

// ---- 本体 ----

/**
 * ブロック構造を解釈して HTML 文字列を返す。入力は改行が "\n" に正規化済みの文字列。例外を投げない。
 * @param {string} src
 * @param {{depth?: number}} [opts]
 * @returns {string}
 */
export function renderBlocks(src, opts) {
  if (typeof src !== 'string' || src === '') return '';
  const depth = (opts && opts.depth) || 0;
  const lines = src.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const indented = leading(line).width > 3;

    if (!indented) {
      const fence = fenceOpen(line);
      if (fence) {
        const body = [];
        let j = i + 1;
        while (j < lines.length && !isFenceClose(lines[j], fence.len)) body.push(lines[j++]);
        const word = fence.info.trim().split(/[ \t]/, 1)[0].toLowerCase();
        const cls = LANG_RE.test(word) ? ` class="language-${word}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
        i = j + 1;
        continue;
      }

      const h = heading(line);
      if (h) {
        out.push(`<h${h.level}>${renderInline(h.text)}</h${h.level}>`);
        i++;
        continue;
      }

      if (isHr(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      if (depth < MAX_BLOCK_DEPTH && isQuote(line)) {
        const inner = [];
        while (i < lines.length && isQuote(lines[i])) {
          let rest = lines[i].slice(leading(lines[i]).pos + 1);
          if (rest.startsWith(' ')) rest = rest.slice(1);
          inner.push(rest);
          i++;
        }
        const body = renderBlocks(inner.join('\n'), { depth: depth + 1 });
        out.push(body === '' ? '<blockquote>\n</blockquote>' : `<blockquote>\n${body}\n</blockquote>`);
        continue;
      }

      const table = tableStart(lines, i);
      if (table) {
        const r = renderTable(lines, i, table);
        out.push(r.html);
        i = r.next;
        continue;
      }

      if (depth < MAX_BLOCK_DEPTH && listMarker(line)) {
        const r = parseList(lines, i, depth);
        out.push(r.html);
        i = r.next;
        continue;
      }
    }

    // 段落
    const para = [line.trimStart()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i, depth)) {
      para.push(lines[i].trimStart());
      i++;
    }
    out.push(`<p>${renderInline(para.join('\n').trimEnd())}</p>`);
  }

  return out.join('\n');
}
