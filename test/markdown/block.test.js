import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBlocks, MAX_BLOCK_DEPTH } from '../../src/markdown/block.js';

const b = (s, o) => renderBlocks(s, o);

test('空入力・空行', () => {
  assert.equal(b(''), '');
  assert.equal(b('\n\n  \n'), '');
});

test('見出し', () => {
  assert.equal(b('# A'), '<h1>A</h1>');
  assert.equal(b('###### F'), '<h6>F</h6>');
  assert.equal(b('## A ##'), '<h2>A</h2>');
  assert.equal(b('## A #b'), '<h2>A #b</h2>');
  assert.equal(b('#'), '<h1></h1>');
  assert.equal(b('# *x* <b>'), '<h1><em>x</em> &lt;b&gt;</h1>');
  assert.equal(b('#tag'), '<p>#tag</p>');
  assert.equal(b('####### 7'), '<p>####### 7</p>');
  assert.equal(b('    # code-ish'), '<p># code-ish</p>');
});

test('段落', () => {
  assert.equal(b('a\nb\n\nc'), '<p>a\nb</p>\n<p>c</p>');
  assert.equal(b('a  \nb'), '<p>a<br>\nb</p>');
  assert.equal(b('a\n# h\nb'), '<p>a</p>\n<h1>h</h1>\n<p>b</p>');
  assert.equal(b('a\n---\nb'), '<p>a</p>\n<hr>\n<p>b</p>');
  assert.equal(b('a\n> q'), '<p>a</p>\n<blockquote>\n<p>q</p>\n</blockquote>');
});

test('水平線', () => {
  for (const s of ['---', '***', '___', '- - -', '  ***', '-----']) assert.equal(b(s), '<hr>', s);
  assert.equal(b('--'), '<p>--</p>');
  assert.equal(b('-*-'), '<p>-*-</p>');
});

test('コードブロック', () => {
  assert.equal(b('```\n<b>&\n```'), '<pre><code>&lt;b&gt;&amp;</code></pre>');
  assert.equal(b('```js\nlet a = 1;\n```'), '<pre><code class="language-js">let a = 1;</code></pre>');
  assert.equal(b('```JS title\nx\n```'), '<pre><code class="language-js">x</code></pre>');
  assert.equal(b('```"><script>\nx\n```'), '<pre><code>x</code></pre>');
  assert.equal(b('```' + 'a'.repeat(33) + '\nx\n```'), '<pre><code>x</code></pre>');
  assert.equal(b('```\n# not heading\n*x*\n```'), '<pre><code># not heading\n*x*</code></pre>');
  assert.equal(b('````\n```\n````'), '<pre><code>```</code></pre>');
  assert.equal(b('```\n```'), '<pre><code></code></pre>');
});

test('閉じないコードブロックは最後まで', () => {
  assert.equal(b('```\na\n\n# b'), '<pre><code>a\n\n# b</code></pre>');
});

test('引用と入れ子', () => {
  assert.equal(b('> a\n> b'), '<blockquote>\n<p>a\nb</p>\n</blockquote>');
  assert.equal(b('> a\n> > b'), '<blockquote>\n<p>a</p>\n<blockquote>\n<p>b</p>\n</blockquote>\n</blockquote>');
  assert.equal(b('>'), '<blockquote>\n</blockquote>');
  assert.equal(b('> a\nlazy'), '<blockquote>\n<p>a</p>\n</blockquote>\n<p>lazy</p>');
  assert.equal(b('> # h\n> - x'), '<blockquote>\n<h1>h</h1>\n<ul>\n<li>x</li>\n</ul>\n</blockquote>');
});

test('引用の入れ子上限', () => {
  const html = b('>'.repeat(30) + ' x');
  assert.equal((html.match(/<blockquote>/g) || []).length, MAX_BLOCK_DEPTH);
  assert.ok(html.includes('&gt;'));
  assert.ok(!html.includes('<script'));
  assert.equal(b('> x', { depth: MAX_BLOCK_DEPTH }), '<p>&gt; x</p>');
  assert.equal(b('- x', { depth: MAX_BLOCK_DEPTH }), '<p>- x</p>');
});

test('リスト', () => {
  assert.equal(b('- A\n- B'), '<ul>\n<li>A</li>\n<li>B</li>\n</ul>');
  assert.equal(b('* A\n+ B\n- C'), '<ul>\n<li>A</li>\n<li>B</li>\n<li>C</li>\n</ul>');
  assert.equal(b('- A\n- B\n  - C'), '<ul>\n<li>A</li>\n<li>B\n<ul>\n<li>C</li>\n</ul></li>\n</ul>');
  assert.equal(b('1. a\n2. b'), '<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  assert.equal(b('3. a\n4. b'), '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
  assert.equal(b('0. a'), '<ol start="0">\n<li>a</li>\n</ol>');
  assert.equal(b('- a\n\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.equal(b('- a\n  cont\n- b'), '<ul>\n<li>a\ncont</li>\n<li>b</li>\n</ul>');
  assert.equal(b('-a'), '<p>-a</p>');
  assert.equal(b('1234567890. a'), '<p>1234567890. a</p>');
});

test('リスト: 種類が変わると新しいリスト、その後の段落', () => {
  assert.equal(b('- a\n1. b'), '<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>');
  assert.equal(b('- a\nb'), '<ul>\n<li>a</li>\n</ul>\n<p>b</p>');
  assert.equal(b('- a\n\nb'), '<ul>\n<li>a</li>\n</ul>\n<p>b</p>');
  assert.equal(b('1. a\n   - b\n2. c'), '<ol>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n<li>c</li>\n</ol>');
});

test('チェックリスト', () => {
  assert.equal(
    b('- [ ] a\n- [x] b\n- [X] *c*'),
    '<ul>\n<li class="task"><input type="checkbox" disabled> a</li>\n' +
      '<li class="task"><input type="checkbox" disabled checked> b</li>\n' +
      '<li class="task"><input type="checkbox" disabled checked> <em>c</em></li>\n</ul>',
  );
  assert.equal(b('1. [x] a'), '<ol>\n<li class="task"><input type="checkbox" disabled checked> a</li>\n</ol>');
  assert.equal(b('- [x]a'), '<ul>\n<li>[x]a</li>\n</ul>');
});

test('リストの入れ子上限', () => {
  let s = '';
  for (let i = 0; i < 30; i++) s += `${'  '.repeat(i)}- n${i}\n`;
  const html = b(s);
  assert.equal((html.match(/<ul>/g) || []).length, MAX_BLOCK_DEPTH);
  assert.ok(html.includes('n29'));
});

test('表と揃え', () => {
  const html = b('| h1 | h2 | h3 | h4 |\n|:--|:-:|--:|---|\n| a | b | c | d |\n| 1 | 2 |');
  assert.equal(
    html,
    '<table>\n<thead>\n<tr><th class="align-left">h1</th><th class="align-center">h2</th>' +
      '<th class="align-right">h3</th><th>h4</th></tr>\n</thead>\n<tbody>\n' +
      '<tr><td class="align-left">a</td><td class="align-center">b</td><td class="align-right">c</td><td>d</td></tr>\n' +
      '<tr><td class="align-left">1</td><td class="align-center">2</td><td class="align-right"></td><td></td></tr>\n' +
      '</tbody>\n</table>',
  );
});

test('表: 省略形・余分なセル・\\| ・tbody なし・終端', () => {
  assert.equal(
    b('a | b\n--|--\nx | y | z\n\npara'),
    '<table>\n<thead>\n<tr><th>a</th><th>b</th></tr>\n</thead>\n<tbody>\n<tr><td>x</td><td>y</td></tr>\n</tbody>\n</table>\n<p>para</p>',
  );
  assert.equal(b('|a|\n|-|'), '<table>\n<thead>\n<tr><th>a</th></tr>\n</thead>\n</table>');
  assert.ok(b('|a|b|\n|-|-|\n|x\\|y|z|').includes('<td>x|y</td><td>z</td>'));
  assert.ok(b('|<b>|b|\n|-|-|').includes('<th>&lt;b&gt;</th>'));
  assert.equal(b('|a|b|\n|-|'), '<p>|a|b|\n|-|</p>');
  assert.equal(b('|a|\n|-|\nx|y\nno pipe'), '<table>\n<thead>\n<tr><th>a</th></tr>\n</thead>\n<tbody>\n<tr><td>x</td></tr>\n</tbody>\n</table>\n<p>no pipe</p>');
});
