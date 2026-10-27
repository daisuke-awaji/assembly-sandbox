import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../src/markdown/index.js';
import { renderBlocks, MAX_BLOCK_DEPTH } from '../../src/markdown/block.js';
import { renderInline, MAX_INLINE_DEPTH } from '../../src/markdown/inline.js';
import { sanitizeUrl, isExternalUrl, escapeHtml } from '../../src/markdown/escape.js';

const A = ' target="_blank" rel="noopener noreferrer"';

// ---- 入力の型・正規化 ----
test('string 以外は TypeError', () => {
  for (const v of [undefined, null, 1, {}, [], Symbol.iterator]) assert.throws(() => render(v), TypeError);
});

test('空・空白のみ・改行のみは空文字列', () => {
  for (const s of ['', ' ', '\n', '\n\n\n', '   \n  \n', '\t', '\r\n\r\n']) assert.equal(render(s), '', JSON.stringify(s));
});

test('CRLF / CR / LF は同じ結果、NUL は除去される', () => {
  const lf = render('a\nb\n\n# h');
  assert.equal(render('a\r\nb\r\n\r\n# h'), lf);
  assert.equal(render('a\rb\r\r# h'), lf);
  assert.equal(render('a\u0000b'), render('ab'));
  assert.equal(render('\u0000'), '');
});

test('サロゲートペア・結合文字・RTL 制御文字を壊さない', () => {
  assert.equal(render('😀 **𠮷野家**'), '<p>😀 <strong>𠮷野家</strong></p>');
  assert.equal(render('é'), '<p>é</p>');
  assert.equal(render('‮abc'), '<p>‮abc</p>');
});

test('孤立サロゲートでも例外を投げない', () => {
  assert.doesNotThrow(() => render('\ud800 **a** \udc00'));
});

// ---- インラインの境界 ----
test('強調: 空白に接する記号は強調にならない', () => {
  assert.equal(render('** a**'), '<p>** a**</p>');
  assert.equal(render('**a **'), '<p>**a **</p>');
  assert.equal(render('x * a*'), '<p>x * a*</p>');
  assert.equal(render('~~ a~~'), '<p>~~ a~~</p>');
});

test('強調: 閉じがなければ文字のまま', () => {
  assert.equal(render('**a'), '<p>**a</p>');
  assert.equal(render('a*'), '<p>a*</p>');
  assert.equal(render('~~a'), '<p>~~a</p>');
  assert.equal(render('a ****'), '<p>a ****</p>');
  assert.equal(render('****'), '<hr>');
});

test('強調の混在: 入れ子と交差', () => {
  assert.equal(render('**bold *it* x**'), '<p><strong>bold <em>it</em> x</strong></p>');
  assert.equal(render('~~a **b** c~~'), '<p><del>a <strong>b</strong> c</del></p>');
  assert.equal(render('***a***'), '<p><strong><em>a</em></strong></p>');
  assert.equal(render('~~a **b~~ c**'), '<p><del>a **b</del> c**</p>');
});

test('アンダースコアは強調に使わない', () => {
  assert.equal(render('_a_ __b__ snake_case_word'), '<p>_a_ __b__ snake_case_word</p>');
});

test('コードスパン: 中身は解釈されず、長さの違うバッククォートは中身', () => {
  assert.equal(render('`**x**`'), '<p><code>**x**</code></p>');
  assert.equal(render('`a``b`'), '<p><code>a``b</code></p>');
  assert.equal(render('``a`b``'), '<p><code>a`b</code></p>');
  assert.equal(render('`<b>&`'), '<p><code>&lt;b&gt;&amp;</code></p>');
  assert.equal(render('` a `'), '<p><code>a</code></p>');
  assert.equal(render('`unclosed'), '<p>`unclosed</p>');
  assert.equal(render('``'), '<p>``</p>');
});

test('コードスパンはリンクの URL 区切りより優先される', () => {
  assert.equal(render('`[a](http://x.com)`'), '<p><code>[a](http://x.com)</code></p>');
});

test('バックスラッシュエスケープ', () => {
  assert.equal(render('\\*x\\*'), '<p>*x*</p>');
  assert.equal(render('\\<b\\>'), '<p>&lt;b&gt;</p>');
  assert.equal(render('a\\b'), '<p>a\\b</p>');
  assert.equal(render('\\'), '<p>\\</p>');
  assert.equal(render('\\\\'), '<p>\\</p>');
  assert.equal(render('\\あ'), '<p>\\あ</p>');
});

test('リンク: 基本形・括弧の対応・空・タイトル付きは文字', () => {
  assert.equal(render('[a](http://a.com)'), `<p><a href="http://a.com"${A}>a</a></p>`);
  assert.equal(render('[a](/rel)'), '<p><a href="/rel">a</a></p>');
  assert.equal(render('[a](#top)'), '<p><a href="#top">a</a></p>');
  assert.equal(render('[a](mailto:x@y.z)'), '<p><a href="mailto:x@y.z">a</a></p>');
  assert.equal(render('[a](http://a.com/(x))'), `<p><a href="http://a.com/(x)"${A}>a</a></p>`);
  assert.equal(render('[a]()'), '<p>[a]()</p>');
  assert.ok(!render('[a](/x "t")').includes('<a href'));
});

test('リンク: 危険なスキームはリンクにならず文字として出る', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:x', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', ' javascript:x', 'java\tscript:x', '&#106;avascript:x', '\\evil.com']) {
    const html = render(`[a](${url})`);
    assert.ok(!/<a\b/.test(html), `${url} -> ${html}`);
  }
});

test('リンクテキストの中のリンク・自動リンクは入れ子にならない', () => {
  const html = render('[see http://a.com](http://b.com)');
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.ok(html.includes('href="http://b.com"'));
});

test('画像: http(s) と相対のみ。mailto / javascript は文字', () => {
  assert.ok(render('![a](https://x/y.png)').includes('<img src="https://x/y.png" alt="a"'));
  assert.ok(render('![a](rel.png)').includes('<img'));
  assert.ok(!render('![a](mailto:x@y)').includes('<img'));
  assert.ok(!render('![a](javascript:x)').includes('<img'));
});

test('画像の alt は inline 変換されずエスケープされる', () => {
  const html = render('![**a** "q"](x.png)');
  assert.ok(html.includes('alt="**a** &quot;q&quot;"'), html);
});

test('属性値に引用符を入れて属性を増やせない', () => {
  const html = render('[a](/x"onmouseover="alert(1))');
  assert.ok(!/\sonmouseover=/.test(html), html);
  assert.equal(html, '<p><a href="/x&quot;onmouseover=&quot;alert(1)">a</a></p>');
});

test('自動リンク: 末尾の句読点は含まない、英数字直後は対象外', () => {
  assert.equal(render('http://a.com/x).'), `<p><a href="http://a.com/x"${A}>http://a.com/x</a>).</p>`);
  assert.equal(render('see https://a.com, ok'), `<p>see <a href="https://a.com"${A}>https://a.com</a>, ok</p>`);
  assert.ok(!render('xhttp://a.com').includes('<a '));
  assert.ok(!render('ftp://a.com').includes('<a '));
});

test('行末 2 スペースで br、1 スペースでは br にならない', () => {
  assert.equal(render('a  \nb'), '<p>a<br>\nb</p>');
  assert.equal(render('a   \nb'), '<p>a<br>\nb</p>');
  assert.equal(render('a \nb'), '<p>a \nb</p>');
});

test('生 HTML・エンティティ風の文字列は全てエスケープされる', () => {
  assert.equal(render('<b>x</b>'), '<p>&lt;b&gt;x&lt;/b&gt;</p>');
  assert.equal(render('&amp; &lt; &#60;'), '<p>&amp;amp; &amp;lt; &amp;#60;</p>');
  assert.equal(render('"\''), '<p>&quot;&#39;</p>');
  assert.equal(render('<!-- c -->'), '<p>&lt;!-- c --&gt;</p>');
});

// ---- 深さの上限 ----
test('inline: MAX_INLINE_DEPTH を超えた強調は文字のまま', () => {
  const n = MAX_INLINE_DEPTH + 3;
  const src = '*a '.repeat(n) + 'x' + '* '.repeat(n).trimEnd();
  assert.doesNotThrow(() => render(src));
  const html = renderInline('**'.repeat(1) + 'x' + '**', { depth: MAX_INLINE_DEPTH });
  assert.equal(html, '**x**');
  assert.equal(renderInline('**x**', { depth: MAX_INLINE_DEPTH - 1 }), '<strong>x</strong>');
});

test('block: 引用の入れ子は MAX_BLOCK_DEPTH で止まり、残りは段落の文字', () => {
  const n = MAX_BLOCK_DEPTH + 5;
  const html = render('> '.repeat(n) + 'x');
  const open = (html.match(/<blockquote>/g) ?? []).length;
  assert.equal(open, MAX_BLOCK_DEPTH);
  assert.ok(html.includes('x'));
  assert.equal(open, (html.match(/<\/blockquote>/g) ?? []).length);
});

test('block: 引用+リストの入れ子も合算して上限がある', () => {
  const src = '> - > - > - > - > - > - > - > - > - > - > - > - x';
  const html = render(src);
  const opens = (html.match(/<(blockquote|ul)>/g) ?? []).length;
  assert.ok(opens <= MAX_BLOCK_DEPTH, `${opens}`);
  assert.equal((html.match(/<(blockquote|ul)>/g) ?? []).length, (html.match(/<\/(blockquote|ul)>/g) ?? []).length);
});

// ---- ブロックの境界 ----
test('見出し: 1〜6 個の # だけが見出し、7 個・#tag・先頭 4 空白は違う', () => {
  for (let i = 1; i <= 6; i++) assert.equal(render('#'.repeat(i) + ' t'), `<h${i}>t</h${i}>`);
  assert.equal(render('####### t'), '<p>####### t</p>');
  assert.equal(render('#tag'), '<p>#tag</p>');
  assert.equal(render('    # t').startsWith('<h1>'), false);
  assert.equal(render('   # t'), '<h1>t</h1>');
  assert.equal(render('# t ##'), '<h1>t</h1>');
  assert.equal(render('# t#'), '<h1>t#</h1>');
});

test('見出し: # だけの行 (中身が空) でも例外を投げない', () => {
  assert.doesNotThrow(() => render('#'));
  assert.doesNotThrow(() => render('# '));
  assert.doesNotThrow(() => render('## ##'));
});

test('見出し中の強調・コード・リンク', () => {
  assert.equal(render('# **b** `c`'), '<h1><strong>b</strong> <code>c</code></h1>');
});

test('水平線: 3 個以上、混在は不可、間の空白は可', () => {
  for (const s of ['---', '***', '___', '- - -', '*  *  *', '-----']) assert.equal(render(s), '<hr>', s);
  assert.notEqual(render('--'), '<hr>');
  assert.notEqual(render('-*-'), '<hr>');
  assert.notEqual(render('--a'), '<hr>');
});

test('コードブロック: 言語名の検証・閉じの長さ・閉じなし', () => {
  assert.equal(render('```js\nx\n```'), '<pre><code class="language-js">x</code></pre>');
  assert.equal(render('```JS extra\nx\n```'), '<pre><code class="language-js">x</code></pre>');
  assert.equal(render('```a"b\nx\n```'), '<pre><code>x</code></pre>');
  assert.equal(render('```' + 'a'.repeat(33) + '\nx\n```'), '<pre><code>x</code></pre>');
  assert.equal(render('```' + 'a'.repeat(32) + '\nx\n```'), `<pre><code class="language-${'a'.repeat(32)}">x</code></pre>`);
  assert.equal(render('```\nunclosed **x**'), '<pre><code>unclosed **x**</code></pre>');
  assert.equal(render('````\n```\nx\n````'), '<pre><code>```\nx</code></pre>');
  assert.equal(render('```\n```'), '<pre><code></code></pre>');
  assert.equal(render('```\n<script>\n```'), '<pre><code>&lt;script&gt;</code></pre>');
});

test('コードブロックの中は Markdown として解釈されない', () => {
  const html = render('```\n# h\n- a\n> q\n| a |\n```');
  assert.ok(!html.includes('<h1>') && !html.includes('<li>') && !html.includes('<blockquote>') && !html.includes('<table>'));
});

test('引用: 空の引用、lazy continuation は含まない', () => {
  assert.equal(render('>'), '<blockquote>\n</blockquote>');
  assert.equal(render('> a\nb'), '<blockquote>\n<p>a</p>\n</blockquote>\n<p>b</p>');
  assert.equal(render('> # h\n> - a'), '<blockquote>\n<h1>h</h1>\n<ul>\n<li>a</li>\n</ul>\n</blockquote>');
});

test('表: セル数の過不足・揃え・空データ行・エスケープされた |', () => {
  assert.equal(
    render('| a | b |\n|---|---|\n| 1 |'),
    '<table>\n<thead>\n<tr><th>a</th><th>b</th></tr>\n</thead>\n<tbody>\n<tr><td>1</td><td></td></tr>\n</tbody>\n</table>',
  );
  assert.equal(
    render('a|b\n-|-\n1|2|3'),
    '<table>\n<thead>\n<tr><th>a</th><th>b</th></tr>\n</thead>\n<tbody>\n<tr><td>1</td><td>2</td></tr>\n</tbody>\n</table>',
  );
  assert.equal(render('| a |\n|---|'), '<table>\n<thead>\n<tr><th>a</th></tr>\n</thead>\n</table>');
  const al = render('|a|b|c|\n|:--|:-:|--:|\n|1|2|3|');
  assert.ok(al.includes('<th class="align-left">a</th><th class="align-center">b</th><th class="align-right">c</th>'));
  assert.ok(al.includes('<td class="align-right">3</td>'));
  assert.ok(render('| a |\n|---|\n| x \\| y |').includes('<td>x | y</td>'));
});

test('表: 区切り行のセル数が違う・区切りが無いなら表にならない', () => {
  assert.ok(!render('| a | b |\n|---|').includes('<table>'));
  assert.ok(!render('| a | b |\n| c | d |').includes('<table>'));
  assert.ok(!render('| a |\n|--x|').includes('<table>'));
});

test('表のセルにはインライン記法が使え、HTML は無効', () => {
  const html = render('| a |\n|---|\n| **b** <i> `c|d` |');
  assert.ok(html.includes('<strong>b</strong>'));
  assert.ok(html.includes('&lt;i&gt;'));
});

test('表は空行で終わり、続く段落は表に入らない', () => {
  const html = render('|a|\n|-|\n|1|\n\ntext');
  assert.ok(html.endsWith('</table>\n<p>text</p>'), html);
});

test('リスト: 入れ子・種類の変更・開始番号・チェックリスト', () => {
  assert.equal(render('- a\n  - b\n    - c'), '<ul>\n<li>a\n<ul>\n<li>b\n<ul>\n<li>c</li>\n</ul></li>\n</ul></li>\n</ul>');
  assert.equal(render('- a\n1. b'), '<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>');
  assert.equal(render('3. a\n4. b'), '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
  assert.equal(render('1. a'), '<ol>\n<li>a</li>\n</ol>');
  assert.equal(render('- a\n* b\n+ c'), '<ul>\n<li>a</li>\n<li>b</li>\n<li>c</li>\n</ul>');
  assert.equal(
    render('- [ ] t\n- [x] d\n- [X] e'),
    '<ul>\n<li class="task"><input type="checkbox" disabled> t</li>\n<li class="task"><input type="checkbox" disabled checked> d</li>\n<li class="task"><input type="checkbox" disabled checked> e</li>\n</ul>',
  );
  assert.ok(!render('- [ ]t').includes('checkbox'));
  assert.ok(!render('- [y] t').includes('checkbox'));
});

test('リスト: 項目間の空行は無視され tight、マーカー後に空白がなければ段落', () => {
  assert.equal(render('- a\n\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.equal(render('-a'), '<p>-a</p>');
  assert.equal(render('1.a'), '<p>1.a</p>');
});

test('リスト: 番号は 9 桁まで、10 桁は段落', () => {
  assert.ok(render('123456789. a').includes('<ol'));
  assert.ok(!render('1234567890. a').includes('<ol'));
});

test('リスト項目の継続行は項目に連結される', () => {
  assert.equal(render('- a\n  b'), '<ul>\n<li>a\nb</li>\n</ul>');
});

test('段落は他のブロック開始行で終わる', () => {
  assert.equal(render('a\n# h'), '<p>a</p>\n<h1>h</h1>');
  assert.equal(render('a\n- b'), '<p>a</p>\n<ul>\n<li>b</li>\n</ul>');
  assert.equal(render('a\n> b'), '<p>a</p>\n<blockquote>\n<p>b</p>\n</blockquote>');
  assert.equal(render('a\n```\nb\n```'), '<p>a</p>\n<pre><code>b</code></pre>');
});

// ---- 混在 ----
test('混在: 引用の中のリスト・表・コードブロック', () => {
  const html = render('> - a\n> - b\n>\n> ```\n> code\n> ```\n>\n> |x|\n> |-|\n> |1|');
  assert.ok(html.includes('<ul>') && html.includes('<pre><code>code</code></pre>') && html.includes('<table>'), html);
});

test('混在: リストの中の強調・リンク・コード', () => {
  const html = render('1. **a** [l](/x)\n2. `c` ~~d~~');
  assert.equal(html, '<ol>\n<li><strong>a</strong> <a href="/x">l</a></li>\n<li><code>c</code> <del>d</del></li>\n</ol>');
});

test('壊れた入力: 閉じていない記法の山でも例外を投げず安全', () => {
  const junk = ['[', '[[', '[a](', '[a](b', '![', '![a](', '**', '~~', '`', '```', '|', '|-|', '> ', '- ', '1. ', '\\', '&', '<', '[a]]', '[[a]', '(((', '[a](()', '[a](b))'];
  for (const j of junk) {
    for (const wrap of [(s) => s, (s) => `> ${s}`, (s) => `- ${s}`, (s) => `# ${s}`, (s) => `|${s}|\n|-|\n|${s}|`]) {
      const html = render(wrap(j));
      assert.equal(typeof html, 'string');
      assert.ok(!/<(script|iframe|object|embed|style)\b/i.test(html));
    }
  }
});

test('出力の属性は常にダブルクォートで囲まれる', () => {
  const html = render('[a](/x) ![i](/y.png) http://z.com');
  for (const m of html.matchAll(/<(a|img)\s([^>]*)>/g)) {
    assert.ok(/^(\w[\w-]*(="[^"]*")?\s?)+$/.test(m[2]), m[2]);
  }
});

test('render は冪等 (同じ入力で同じ出力)', () => {
  const src = '# t\n\n- **a**\n- [l](/x)\n\n|a|\n|-|\n|1|';
  assert.equal(render(src), render(src));
});

// ---- escape.js ----
test('escapeHtml: 空文字・全記号・非 string', () => {
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml('日本語😀'), '日本語😀');
});

test('sanitizeUrl: 許可・拒否の境界', () => {
  assert.equal(sanitizeUrl('http://a'), 'http://a');
  assert.equal(sanitizeUrl('HTTPS://A'), 'HTTPS://A');
  assert.equal(sanitizeUrl('//host/x'), '//host/x');
  assert.equal(sanitizeUrl('a:b'), null);
  assert.equal(sanitizeUrl(':x'), null);
  assert.equal(sanitizeUrl(''), null);
  assert.equal(sanitizeUrl('   '), null);
  assert.equal(sanitizeUrl(null), null);
  assert.equal(sanitizeUrl(1), null);
  assert.equal(sanitizeUrl('x?a=b:c'), 'x?a=b:c');
  assert.equal(sanitizeUrl('/a:b'), '/a:b');
  assert.equal(sanitizeUrl('mailto:a@b', 'image'), null);
  assert.equal(sanitizeUrl('mailto:a@b', 'link'), 'mailto:a@b');
  assert.equal(sanitizeUrl('java​script:x'), null);
  assert.equal(sanitizeUrl('&#x6A;avascript:x'), null);
  assert.equal(sanitizeUrl('&amp;#106;avascript:x'), null);
  assert.equal(sanitizeUrl('jav&Tab;ascript:x'), null);
  assert.equal(sanitizeUrl('a\\b'), null);
});

test('sanitizeUrl: 除去対象の制御文字だけを取り除いて返す', () => {
  assert.equal(sanitizeUrl('/a\tb\nc'), '/abc');
  assert.equal(sanitizeUrl('/a&amp;b'), '/a&amp;b');
});

test('isExternalUrl', () => {
  assert.equal(isExternalUrl('HTTP://a'), true);
  assert.equal(isExternalUrl('//a'), true);
  assert.equal(isExternalUrl('mailto:a@b'), false);
  assert.equal(isExternalUrl('/a'), false);
  assert.equal(isExternalUrl('#a'), false);
});

test('renderBlocks / renderInline は直接呼んでも例外を投げない', () => {
  assert.equal(renderBlocks(''), '');
  assert.equal(renderInline(''), '');
  assert.doesNotThrow(() => renderBlocks('> '.repeat(100) + 'x', { depth: 0 }));
  assert.doesNotThrow(() => renderInline('*'.repeat(1000)));
});

test('リンクテキストの中のリンク記法で <a> が入れ子にならない',
  () => {
    const html = render('[a [b](c) d](e)');
    assert.equal((html.match(/<a\b/g) ?? []).length, 1, html);
  });

test('リンクのラベル内でも画像は使える', () => {
  const html = render('[a ![i](/x.png) b](/e)');
  assert.equal((html.match(/<a\b/g) ?? []).length, 1, html);
  assert.match(html, /<img /);
});

test('自動リンク: 対応の取れた末尾の ) は残し、余分な ) は削る', () => {
  assert.match(render('https://en.wikipedia.org/wiki/Foo_(bar)'), /href="https:\/\/en\.wikipedia\.org\/wiki\/Foo_\(bar\)"/);
  assert.match(render('(see https://example.com/a)'), /href="https:\/\/example\.com\/a"/);
  assert.match(render('https://example.com/a_(b)).'), /href="https:\/\/example\.com\/a_\(b\)"/);
});

test('自動リンク: Unicode 空白で終端する', () => {
  for (const sp of ['\u00a0', '\u3000', '\u2003']) {
    const html = render(`https://example.com/a${sp}b`);
    assert.match(html, /href="https:\/\/example\.com\/a"/, html);
  }
});
