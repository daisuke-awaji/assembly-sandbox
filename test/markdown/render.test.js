import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../src/markdown/index.js';

test('記法が混ざった入力', () => {
  const src = '# Title\n\nHello **world** and `code`.\n\n- [ ] todo\n- [x] done\n\n> quote\n\n```js\nx<1\n```\n';
  assert.equal(
    render(src),
    '<h1>Title</h1>\n<p>Hello <strong>world</strong> and <code>code</code>.</p>\n<ul>\n' +
      '<li class="task"><input type="checkbox" disabled> todo</li>\n' +
      '<li class="task"><input type="checkbox" disabled checked> done</li>\n</ul>\n' +
      '<blockquote>\n<p>quote</p>\n</blockquote>\n<pre><code class="language-js">x&lt;1</code></pre>',
  );
});

test('CRLF / CR を統一する', () => {
  assert.equal(render('a\r\nb\r\n\r\nc\rd'), '<p>a\nb</p>\n<p>c\nd</p>');
  assert.equal(render('- a\r\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
});

test('NUL を除去する', () => {
  assert.equal(render('a\u0000b'), '<p>ab</p>');
  assert.equal(render('java\u0000script'), '<p>javascript</p>');
});

test('#tag は文字のまま', () => {
  assert.equal(render('#tag と #日本語'), '<p>#tag と #日本語</p>');
  assert.equal(render('text #a #b'), '<p>text #a #b</p>');
});

test('空入力', () => {
  assert.equal(render(''), '');
});

test('string 以外は TypeError', () => {
  for (const v of [undefined, null, 1, {}, [], Symbol('x')]) assert.throws(() => render(v), TypeError);
});

test('生 HTML はエスケープされる', () => {
  assert.equal(render('<b onclick="x">hi</b>'), '<p>&lt;b onclick=&quot;x&quot;&gt;hi&lt;/b&gt;</p>');
});
