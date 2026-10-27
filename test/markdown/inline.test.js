import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInline, MAX_INLINE_DEPTH } from '../../src/markdown/inline.js';

const r = (s, o) => renderInline(s, o);

test('通常文字はエスケープされる', () => {
  assert.equal(r('a < b & "c" \'d\''), 'a &lt; b &amp; &quot;c&quot; &#39;d&#39;');
  assert.equal(r('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(r(''), '');
});

test('バックスラッシュエスケープ', () => {
  assert.equal(r('\\*a\\*'), '*a*');
  assert.equal(r('\\<b\\>'), '&lt;b&gt;');
  assert.equal(r('a\\b'), 'a\\b');
  assert.equal(r('end\\'), 'end\\');
});

test('強調・取り消し線', () => {
  assert.equal(r('**x**'), '<strong>x</strong>');
  assert.equal(r('*x*'), '<em>x</em>');
  assert.equal(r('~~x~~'), '<del>x</del>');
  assert.equal(r('a **b *c* d** e'), 'a <strong>b <em>c</em> d</strong> e');
  assert.equal(r('***x***'), '<strong><em>x</em></strong>');
  assert.equal(r('_x_'), '_x_');
});

test('閉じない・空白に接する記法は文字のまま', () => {
  assert.equal(r('**x'), '**x');
  assert.equal(r('*x'), '*x');
  assert.equal(r('~~x'), '~~x');
  assert.equal(r('** x **'), '** x **');
  assert.equal(r('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(r('`x'), '`x');
  assert.equal(r('[x]'), '[x]');
  assert.equal(r('[x](y'), '[x](y');
});

test('コードスパン', () => {
  assert.equal(r('`a<b>`'), '<code>a&lt;b&gt;</code>');
  assert.equal(r('`` a`b ``'), '<code>a`b</code>');
  assert.equal(r('` x `'), '<code>x</code>');
  assert.equal(r('`*not em*`'), '<code>*not em*</code>');
  assert.equal(r('`a``b`'), '<code>a``b</code>');
});

test('リンク', () => {
  assert.equal(r('[a](https://x.com)'), '<a href="https://x.com" target="_blank" rel="noopener noreferrer">a</a>');
  assert.equal(r('[a](/x)'), '<a href="/x">a</a>');
  assert.equal(r('[a](#h)'), '<a href="#h">a</a>');
  assert.equal(r('[a](mailto:a@b.c)'), '<a href="mailto:a@b.c">a</a>');
  assert.equal(r('[**a**](/x)'), '<a href="/x"><strong>a</strong></a>');
  assert.equal(r('[a](https://x.com/a_(b))'), '<a href="https://x.com/a_(b)" target="_blank" rel="noopener noreferrer">a</a>');
  assert.equal(r('[a [b]](/x)'), '<a href="/x">a [b]</a>');
  assert.equal(r('[a](/x?a=1&b=2)'), '<a href="/x?a=1&amp;b=2">a</a>');
  assert.equal(r('[a](/x"onclick="y)'), '<a href="/x&quot;onclick=&quot;y">a</a>');
});

test('危険・不正なリンクは文字として出る', () => {
  assert.equal(r('[a](javascript:alert(1))'), '[a](javascript:alert(1))');
  assert.equal(r('[a](/x "title")'), '[a](/x &quot;title&quot;)');
  assert.equal(r('[a]()'), '[a]()');
  assert.equal(r('[a](data:text/html,x)'), '[a](data:text/html,x)');
});

test('画像', () => {
  assert.equal(
    r('![alt *x*](/a.png)'),
    '<img src="/a.png" alt="alt *x*" loading="lazy" referrerpolicy="no-referrer">',
  );
  assert.equal(
    r('![a"b](https://x.com/a.png)'),
    '<img src="https://x.com/a.png" alt="a&quot;b" loading="lazy" referrerpolicy="no-referrer">',
  );
  assert.equal(r('![a](mailto:x@y.z)'), '![a](mailto:x@y.z)');
  assert.equal(r('![a](javascript:1)'), '![a](javascript:1)');
});

test('自動リンク', () => {
  const a = (u, t = u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  assert.equal(r('see https://x.com/a.'), `see ${a('https://x.com/a')}.`);
  assert.equal(r('(https://x.com)'), `(${a('https://x.com')})`);
  assert.equal(r('https://x.com/a?b=1&c=2,'), `${a('https://x.com/a?b=1&amp;c=2')},`);
  assert.equal(r('http://x.com'), a('http://x.com'));
  assert.equal(r('xhttps://x.com'), 'xhttps://x.com');
  assert.equal(r('https://'), 'https://');
  assert.equal(r('https://x.com<b>'), `${a('https://x.com')}&lt;b&gt;`);
  assert.equal(r('[https://x.com](/y)'), '<a href="/y">https://x.com</a>');
});

test('改行', () => {
  assert.equal(r('a\nb'), 'a\nb');
  assert.equal(r('a  \nb'), 'a<br>\nb');
  assert.equal(r('a     \nb'), 'a<br>\nb');
  assert.equal(r('a \nb'), 'a \nb');
});

test('入れ子の上限', () => {
  let s = 'x';
  for (let i = 0; i < 30; i++) s = `[${s}](/u)`;
  const html = r(s);
  assert.ok((html.match(/<a /g) || []).length <= MAX_INLINE_DEPTH);
  assert.equal(r('**a**', { depth: MAX_INLINE_DEPTH }), '**a**');
  assert.equal(r('<b>', { depth: MAX_INLINE_DEPTH }), '&lt;b&gt;');
  let e = 'x';
  for (let i = 0; i < 40; i++) e = `**${e}**`;
  assert.ok((r(e).match(/<strong>/g) || []).length <= MAX_INLINE_DEPTH);
});

test('例外を投げない', () => {
  assert.equal(r(undefined), '');
  assert.doesNotThrow(() => r('[](' + ')'.repeat(5)));
});
