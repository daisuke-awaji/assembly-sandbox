// xss.test.js に無いペイロードを、より厳しい判定 (タグ・属性の完全な許可リスト) で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../src/markdown/index.js';
import { sanitizeUrl, escapeHtml } from '../../src/markdown/escape.js';

const ATTRS = {
  p: {}, strong: {}, em: {}, del: {}, pre: {}, hr: {}, br: {}, blockquote: {}, ul: {},
  table: {}, thead: {}, tbody: {}, tr: {}, h1: {}, h2: {}, h3: {}, h4: {}, h5: {}, h6: {},
  a: { href: /^.*$/s, target: /^_blank$/, rel: /^noopener noreferrer$/ },
  img: { src: /^.*$/s, alt: /^.*$/s, loading: /^lazy$/, referrerpolicy: /^no-referrer$/ },
  input: { type: /^checkbox$/, disabled: null, checked: null },
  ol: { start: /^\d{1,9}$/ },
  li: { class: /^task$/ },
  th: { class: /^align-(left|center|right)$/ },
  td: { class: /^align-(left|center|right)$/ },
  code: { class: /^language-[a-z0-9-]{1,32}$/ },
};
const SAFE_SCHEMES = { href: ['http', 'https', 'mailto'], src: ['http', 'https'] };

/** 出力を字句解析し、許可リスト外の要素・属性・文字が 1 つでもあれば失敗させる。 */
function strictCheck(html, where) {
  const tagRe = /<(\/?)([a-z0-9]+)((?: [a-z-]+(?:="[^"<>]*")?)*)>/g;
  let last = 0;
  let m;
  const stack = [];
  const VOID = new Set(['hr', 'br', 'img', 'input']);
  while ((m = tagRe.exec(html)) !== null) {
    const text = html.slice(last, m.index);
    assert.ok(!/[<>]/.test(text), `テキストに生の < か >: ${JSON.stringify(text)} (${where})`);
    last = tagRe.lastIndex;
    const [, closing, name, attrs] = m;
    assert.ok(Object.hasOwn(ATTRS, name), `許可されない要素 <${name}> (${where})`);
    if (closing) {
      assert.equal(attrs, '', `閉じタグに属性 (${where})`);
      assert.equal(stack.pop(), name, `タグの対応が崩れている </${name}> (${where})`);
      continue;
    }
    if (!VOID.has(name)) stack.push(name);
    const seen = new Set();
    for (const a of attrs.matchAll(/ ([a-z-]+)(?:="([^"]*)")?/g)) {
      const [, an, av] = a;
      assert.ok(!seen.has(an), `属性の重複 ${an} (${where})`);
      seen.add(an);
      assert.ok(Object.hasOwn(ATTRS[name], an), `<${name}> に許可されない属性 ${an} (${where})`);
      const rule = ATTRS[name][an];
      if (rule === null) assert.equal(av, undefined, `${an} は値なし (${where})`);
      else assert.match(av ?? '', rule, `${name}.${an} の値が不正: ${av} (${where})`);
      if (av !== undefined) {
        // 属性値の中に生の引用符・山括弧・バッククォート相当の脱出手段が無い
        assert.ok(!/["'<>]/.test(av), `属性値に生の記号: ${av} (${where})`);
        // & は必ずエンティティの一部 (&amp; &#39; など。ここでは &amp; のみ出る)
        assert.ok(!/&(?!amp;|quot;|#39;|lt;|gt;)/.test(av), `属性値に生の &: ${av} (${where})`);
      }
    }
    if (name === 'a' && seen.has('target')) assert.ok(seen.has('rel'), `target に rel が無い (${where})`);
    if (name === 'a' && /\shref="(?:https?:)?\/\//i.test(m[0])) {
      assert.ok(seen.has('target') && seen.has('rel'), `外部リンクに rel/target が無い: ${m[0]} (${where})`);
    }
  }
  const tail = html.slice(last);
  assert.ok(!/[<>]/.test(tail), `末尾に生の < か >: ${JSON.stringify(tail)} (${where})`);
  assert.deepEqual(stack, [], `閉じられていない要素 (${where})`);

  // URL: エンティティを再帰的に復号し、制御文字・空白を取り除いても危険なスキームにならない
  for (const u of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
    let v = u[2];
    for (let i = 0; i < 5; i++) {
      v = v
        .replace(/&amp;/g, '&')
        .replace(/&(?:#(\d+)|#x([0-9a-f]+));?/gi, (_, d, h) => String.fromCodePoint(Number.parseInt(d ?? h, d ? 10 : 16)))
        .replace(/&colon;|&Tab;|&NewLine;/gi, (e) => ({ '&colon;': ':', '&tab;': '\t', '&newline;': '\n' })[e.toLowerCase()]);
    }
    const probe = v.replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff]/g, '').toLowerCase();
    const sch = /^([a-z][a-z0-9+.-]*):/.exec(probe);
    if (sch) assert.ok(SAFE_SCHEMES[u[1]].includes(sch[1]), `危険なスキーム ${sch[1]}: ${u[2]} (${where})`);
    assert.ok(!/[\u0000-\u0020\u007f-\u009f\\]/.test(u[2]), `URL に空白・制御文字・\\: ${JSON.stringify(u[2])} (${where})`);
    assert.ok(!/^(?:data|javascript|vbscript|blob|file):/i.test(probe), `${probe} (${where})`);
  }
}

// 各ペイロードは「攻撃として成立する形」のまま 1 件 (既存の xss.test.js と重複しないもの)
const PAYLOADS = [
  // --- URL の難読化 ---
  '[x](javascript&#58alert(1))',
  '[x](javascript&#x3a;alert(1))',
  '[x](&Tab;javascript:alert(1))',
  '[x](JAVASCRIPT&COLON;alert(1))',
  '[x](jav&#x0A;ascript:alert(1))',
  '[x](&#x00000000000006a;avascript:alert(1))',
  '[x](&#106avascript:alert(1))',
  '[x](ja&shy;vascript:alert(1))',
  '[x](java\u00adscript:alert(1))',
  '[x](java\u2060script:alert(1))',
  '[x](\u180ejavascript:alert(1))',
  '[x](\u0085javascript:alert(1))',
  '[x](\u200bjavascript:alert(1))',
  '[x](\u3000javascript:alert(1))',
  '[x](\u00a0javascript:alert(1))',
  '[x](&#x2060;javascript:alert(1))',
  '[x](&#8203;javascript:alert(1))',
  '[x](&#x110000;javascript:alert(1))',
  '[x](&#xD800;javascript:alert(1))',
  '[x](java\u000bscript:alert(1))',
  '[x](java\u000cscript:alert(1))',
  '[x](java\rscript:alert(1))',
  '[x](vbscript&colon;msgbox(1))',
  '[x](DATA:text/html,<script>alert(1)</script>)',
  '[x](data&colon;text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[x](blob:https://a.example/uuid)',
  '[x](filesystem:https://a.example/temporary/x)',
  '[x](jar:https://a.example/x.jar!/)',
  '[x](view-source:https://a.example/)',
  '[x](ms-its:x.chm::/x.htm)',
  '[x](tel:+81000)',
  '[x](sms:+81000)',
  '[x](ftp://a.example/x)',
  '[x](x:y)',
  '[x](:alert(1))',
  '![x](vbscript:msgbox(1))',
  '![x](DATA:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)',
  '![x](&#100;ata:image/svg+xml,<svg onload=alert(1)>)',
  '![x](blob:https://a.example/uuid)',
  '![x](java\tscript:alert(1))',
  '![x](&#x6A;avascript:alert(1))',
  // --- 属性・引用符からの脱出 ---
  '[x](https://a.example/?q=&quot;onmouseover=&quot;alert(1))',
  '[x](/a&#34;onmouseover=&#34;alert(1))',
  '[x](/a&#x22; onfocus=&#x22;alert(1) autofocus=)',
  '[x](/a\u0060 onmouseover=\u0060alert(1))',
  '[x](/a%22%20onmouseover=%22alert(1))',
  '[x](/a"\nonmouseover="alert(1))',
  '[x](/a"\tonmouseover="alert(1))',
  '[x](/a"/onmouseover="alert(1))',
  '[x](/a"style="x:expression(alert(1)))',
  '![x](/a.png"onerror="alert(1))',
  '![x](/a.png"\nonerror="alert(1))',
  '![x\u0060 onerror=\u0060alert(1)](/a.png)',
  '![x&quot; onerror=&quot;alert(1)](/a.png)',
  '![x\'onerror=\'alert(1)](/a.png)',
  '![x\n" onerror="alert(1)](/a.png)',
  '![x](/a.png "t" onerror="alert(1)")',
  '[x](/a "t" onclick="alert(1)")',
  '[x](/a.png \'t\' onclick=\'alert(1)\')',
  '[x](<https://a.example/"onclick="alert(1)>)',
  'https://a.example/&quot;onclick=&quot;alert(1)',
  'https://a.example/\u0060onclick=\u0060alert(1)',
  'https://a.example/%22onclick=%22alert(1)',
  'https://a.example/"><svg/onload=alert(1)>',
  'https://a.example/\'><img src=x onerror=alert(1)>',
  'https://a.example/\u3000"onclick="alert(1)',
  'HTTPS://A.EXAMPLE/"onclick="alert(1)',
  // --- 自動リンクの境界 ---
  'https://a.example/)](javascript:alert(1))',
  '(https://a.example/"onclick="alert(1))',
  '<https://a.example/"onclick="alert(1)>',
  'https://https://a.example/"><script>',
  'http://\u0000javascript:alert(1)',
  'https://a.example/\u0000"onclick="alert(1)',
  'https://a.example/\u2028<script>alert(1)</script>',
  'https://a.example/\u00a0<script>alert(1)</script>',
  'xhttps://a.example/<script>alert(1)</script>',
  'https://<script>alert(1)</script>',
  'https://[::1]/<script>alert(1)</script>',
  '[https://a.example/](javascript:alert(1))',
  '[javascript:alert(1)](https://a.example/)',
  '[https://a.example/"onclick="alert(1)](https://b.example/)',
  '[[x](https://a.example)](javascript:alert(1))',
  '[[x](javascript:alert(1))](https://a.example)',
  '[x](https://a.example)[y](https://b.example/"onclick="alert(1))',
  // --- バックスラッシュとの組み合わせ ---
  '\\[x](javascript:alert(1))',
  '[x\\](javascript:alert(1))',
  '[x]\\(javascript:alert(1))',
  '[x](javascript\\:alert(1))',
  '[x](java\\script:alert(1))',
  '[x](\\<script\\>alert(1)\\</script\\>)',
  '[x](/a\\"onmouseover=\\"alert(1))',
  '\\\\<script>alert(1)</script>',
  '\\\\\\<script>alert(1)</script>',
  '\\&lt;script&gt;alert(1)\\&lt;/script&gt;',
  '\\&#60;script\\&#62;alert(1)',
  '`\\`<script>alert(1)</script>`',
  '\\`<script>alert(1)</script>\\`',
  '**\\**<script>alert(1)</script>**',
  '![\\](/a.png" onerror="alert(1)](/b.png)',
  // --- コードスパン・コードブロック ---
  '``<script>alert(1)</script>``',
  '`` ` <script>alert(1)</script> ` ``',
  '`a`<script>alert(1)</script>`b`',
  '```\n```<script>alert(1)</script>',
  '````\n```\n<script>alert(1)</script>\n```\n````',
  '```js\n</code></pre><script>alert(1)</script>\n```',
  '```js\n</code></pre><script>alert(1)</script>',
  '```JS"onclick="alert(1)\nx\n```',
  '```js\u0000"onclick="alert(1)\nx\n```',
  '```js\t"onclick=alert(1)\nx\n```',
  '```a b"><script>alert(1)</script>\nx\n```',
  '```language-js" onclick="alert(1)\nx\n```',
  '```\u00e9\u0301"><script>alert(1)</script>\nx\n```',
  '```a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s-t-u-v-w-x-y-z-0-1-2-3-4-5-6-7-8-9"><script>alert(1)</script>\nx\n```',
  '```{.js onclick=alert(1)}\nx\n```',
  '```\u202ejs\nx\n```',
  '   ```js"><script>alert(1)</script>\n   x\n   ```',
  '- ```js"><script>alert(1)</script>\n  x\n  ```',
  '> ```js"><script>alert(1)</script>\n> x\n> ```',
  '~~~js"><script>alert(1)</script>\nx\n~~~',
  // --- 表 ---
  '|a|\n|:--"onclick="alert(1)|\n|x|',
  '|a|\n|---|\n|<script>alert(1)</script>|',
  '|<img src=x onerror=alert(1)>|\n|---|\n|x|',
  '|a|b|\n|---|---|\n|x\\|<script>alert(1)</script>|y|',
  '|a|b|\n|---|---|\n|`|<script>alert(1)</script>`|y|',
  '|a|b|\n|---|---|\n|[x](javascript:alert(1))|![y](javascript:alert(1))|',
  '|a|b|\n|---|---|\n|[x](/a"onclick="alert(1))|https://a.example/"onclick="alert(1)|',
  '|a|b|\n|:-:|-:|\n|<td onclick=alert(1)>|</table><script>alert(1)</script>|',
  '|a|\n|---|\n|x|y|z|<script>alert(1)</script>|',
  '| a | b |\n|---|---|\n| </td></tr></table><script>alert(1)</script> |',
  // --- 画像の alt / title ---
  '![<script>alert(1)</script>](/a.png)',
  '![</script><script>alert(1)</script>](/a.png)',
  '![*<b onmouseover=alert(1)>*](/a.png)',
  '![`"><script>alert(1)</script>`](/a.png)',
  '![[x](javascript:alert(1))](/a.png)',
  '![![x](javascript:alert(1))](/a.png)',
  '![](/a.png)<script>alert(1)</script>',
  '![x](/a.png)](javascript:alert(1))',
  '[![x](/a.png)](javascript:alert(1))',
  '[![x"onerror="alert(1)](/a.png)](https://a.example/"onclick="alert(1))',
  // --- 強調・ネスト・上限 ---
  '*'.repeat(40) + '<script>alert(1)</script>' + '*'.repeat(40),
  '**a '.repeat(15) + '<script>alert(1)</script>' + ' b**'.repeat(15),
  '~~a '.repeat(15) + '<script>alert(1)</script>' + ' b~~'.repeat(15),
  '*a **b ~~c '.repeat(8) + '<script>alert(1)</script>' + ' c~~ b** a*'.repeat(8),
  '['.repeat(30) + '<script>alert(1)</script>' + '](javascript:alert(1))'.repeat(5),
  '[a]('.repeat(30) + 'javascript:alert(1)' + ')'.repeat(30),
  '[**[**[**x](javascript:alert(1))**](javascript:alert(1))**](javascript:alert(1))',
  '>'.repeat(15) + '<script>alert(1)</script>',
  '> '.repeat(15) + '[x](javascript:alert(1))',
  '- a\n'.repeat(1) + Array.from({ length: 15 }, (_, i) => `${'  '.repeat(i + 1)}- ${i}`).join('\n') + '\n' + '  '.repeat(16) + '- <script>alert(1)</script>',
  Array.from({ length: 15 }, (_, i) => `${'  '.repeat(i)}1. [x](javascript:alert(1)) <img src=x onerror=alert(1)>`).join('\n'),
  '- > - > - > <script>alert(1)</script>',
  '> - [ ] > <script>alert(1)</script>',
  '- [x] [y](javascript:alert(1))\n- [ ] <img src=x onerror=alert(1)>',
  '- [x]<script>alert(1)</script>',
  // --- HTML の別表現・文字種 ---
  '<script\u0000>alert(1)</script>',
  '<scr\u0000ipt>alert(1)</scr\u0000ipt>',
  '<SCRIPT/XSS SRC="http://evil.example/x.js"></SCRIPT>',
  '<img/src=x/onerror=alert(1)>',
  '<img src="x"onerror="alert(1)">',
  '<svg/onload=alert(1)>',
  '<svg><animate onbegin=alert(1) attributeName=x dur=1s>',
  '<svg><use href="data:image/svg+xml,<svg id=x xmlns=http://www.w3.org/2000/svg><script>alert(1)</script></svg>#x">',
  '<math><maction actiontype="statusline#" xlink:href="javascript:alert(1)">x</maction></math>',
  '<base href="javascript:alert(1)//">',
  '<a href="&#x6A;avascript:alert(1)">x</a>',
  '<a href=\u0060javascript:alert(1)\u0060>x</a>',
  '<video><source onerror=alert(1)>',
  '<audio src onloadstart=alert(1) autoplay>',
  '<marquee onstart=alert(1)>',
  '<isindex type=image src=1 onerror=alert(1)>',
  '<xmp><script>alert(1)</script></xmp>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<textarea></textarea><script>alert(1)</script>',
  '<template><script>alert(1)</script></template>',
  '<table><tr><td onclick=alert(1)>x',
  '<?xml version="1.0"?><script>alert(1)</script>',
  '<!DOCTYPE html><script>alert(1)</script>',
  '<![endif]--><script>alert(1)</script>',
  '--!><script>alert(1)</script>',
  '<!--><script>alert(1)</script>-->',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;',
  '&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;',
  '&#0000060;script&#0000062;alert(1)',
  '&lt;img src=x onerror=alert(1)&gt;',
  '\uff1cscript\uff1ealert(1)\uff1c/script\uff1e',
  '\u2329script\u232aalert(1)\u2329/script\u232a',
  '\ufe64script\ufe65alert(1)\ufe64/script\ufe65',
  '<\u200bscript>alert(1)</script>',
  '\u202e<script>alert(1)</script>',
  '\ufeff<script>alert(1)</script>',
  '\r<script>alert(1)</script>\r',
  '\r\n<script>alert(1)</script>\r\n',
  '\u2028<script>alert(1)</script>\u2029',
  '\u0085<script>alert(1)</script>',
  '\u000b<script>alert(1)</script>',
  '\u000c<img src=x onerror=alert(1)>',
  '\t<script>alert(1)</script>',
  '\t\t\t\t<script>alert(1)</script>',
  '    <script>alert(1)</script>',
  '# <img src=x onerror=alert(1)>\n===',
  '<script>alert(1)</script>\n===',
  '<script>alert(1)</script>\n---',
  '---\n<script>alert(1)</script>\n---',
  '***\n<script>alert(1)</script>',
  '* * *<script>alert(1)</script>',
  '#<script>alert(1)</script>',
  '###### <script>alert(1)</script> ######',
  '# a #<script>alert(1)</script>#',
  '1. a\n999999999999. <script>alert(1)</script>',
  '12345678901234567890. <script>alert(1)</script>',
  '- <script>alert(1)</script>\n\n\n  <script>alert(1)</script>',
  '\u0000'.repeat(20) + '<script>alert(1)</script>',
  'a  \n<script>alert(1)</script>  \n<img src=x onerror=alert(1)>',
  '#tag<script>alert(1)</script>',
  '#"><script>alert(1)</script>',
  '@"><script>alert(1)</script>',
  '[ref]: javascript:alert(1)\n[x][ref]',
  '[x][ref]\n\n[ref]: <script>alert(1)</script>',
  '[x]: javascript:alert(1)\n[x]',
  '<javascript:alert(1)>',
  'javascript:alert(1)',
  'JAVASCRIPT:alert(1)',
  'mailto:"><script>alert(1)</script>',
  '[x](mailto:a@b.c"onclick="alert(1))',
  '[x](mailto:a@b.c?subject=<script>alert(1)</script>)',
  '[x](mailto:a@b.c?body=%22%3E%3Cscript%3E)',
];

test('追加ペイロードは 30 件以上 (重複なし)', () => {
  assert.ok(PAYLOADS.length >= 30, String(PAYLOADS.length));
  assert.equal(new Set(PAYLOADS).size, PAYLOADS.length, 'ペイロードに重複');
});

const WRAPPERS = [
  ['単独', (p) => p],
  ['段落内', (p) => `text ${p} **b** more`],
  ['見出し', (p) => `## ${p}`],
  ['引用', (p) => `> ${p}`],
  ['リスト', (p) => `- ${p}\n  - ${p}`],
  ['番号付き', (p) => `1. ${p}`],
  ['強調の中', (p) => `**${p}**`],
  ['リンクラベル', (p) => `[${p}](https://ok.example/)`],
  ['表のセル', (p) => `|a|b|\n|---|---|\n|${p.replace(/\n/g, ' ')}|${p.replace(/\n/g, ' ')}|`],
];

for (const [k, payload] of PAYLOADS.entries()) {
  test(`XSS-extra ${String(k + 1).padStart(3, '0')}: ${JSON.stringify(payload).slice(0, 70)}`, () => {
    for (const [label, wrap] of WRAPPERS) {
      const src = wrap(payload);
      let html;
      assert.doesNotThrow(() => { html = render(src); }, `${label}: 例外`);
      strictCheck(html, `${label}: ${JSON.stringify(src).slice(0, 80)}`);
    }
  });
}

// ---- 個別の期待値 (出力そのものを固定する) ----

test('危険なスキームのリンクは <a> にならず、文字として残る', () => {
  const bad = [
    'javascript&#58alert(1)', 'java\u00adscript:alert(1)', '\u0085javascript:alert(1)', 'DATA:text/html,x',
    'vbscript&colon;x', 'blob:https://a.example/u', 'x:y', ':alert(1)', 'tel:+81000', 'ftp://a.example/',
  ];
  for (const u of bad) {
    const html = render(`[x](${u})`);
    assert.ok(!html.includes('<a'), `${JSON.stringify(u)} → ${html}`);
    assert.ok(!html.includes('href'), html);
    const img = render(`![x](${u})`);
    assert.ok(!img.includes('<img'), `${JSON.stringify(u)} → ${img}`);
  }
});

test('相対パス・アンカー・クエリ・mailto は許可され、外部扱いにならない', () => {
  assert.equal(render('[x](/a/b?c=d:e#f:g)'), '<p><a href="/a/b?c=d:e#f:g">x</a></p>');
  assert.equal(render('[x](a/b:c)'), '<p><a href="a/b:c">x</a></p>');
  assert.equal(render('[x](#top)'), '<p><a href="#top">x</a></p>');
  assert.equal(render('[x](?q=1)'), '<p><a href="?q=1">x</a></p>');
  assert.equal(render('[x](mailto:a@b.c)'), '<p><a href="mailto:a@b.c">x</a></p>');
});

test('プロトコル相対 URL (//host) は外部リンクとして rel/target が付く', () => {
  assert.equal(
    render('[x](//evil.example/x)'),
    '<p><a href="//evil.example/x" target="_blank" rel="noopener noreferrer">x</a></p>',
  );
});

test('エンティティで書いた記号は復号されずにそのまま属性へ入り、& は &amp; になる', () => {
  assert.equal(
    render('[x](https://a.example/?a=1&b=2&quot;)'),
    '<p><a href="https://a.example/?a=1&amp;b=2&amp;quot;" target="_blank" rel="noopener noreferrer">x</a></p>',
  );
});

test('クォートを含む URL / alt / コード言語名は、属性の外へ出ない', () => {
  assert.equal(
    render('![a"b\'c](/x.png)'),
    '<p><img src="/x.png" alt="a&quot;b&#39;c" loading="lazy" referrerpolicy="no-referrer"></p>',
  );
  assert.equal(
    render('[x](/a"b)'),
    '<p><a href="/a&quot;b">x</a></p>',
  );
  assert.equal(render('```js"><b>\nx\n```'), '<pre><code>x</code></pre>');
});

test('コードブロックの言語名は ASCII の [a-z0-9-] だけ (小文字化後)、それ以外は class 無し', () => {
  assert.equal(render('```JS\nx\n```'), '<pre><code class="language-js">x</code></pre>');
  assert.equal(render('```c++\nx\n```'), '<pre><code>x</code></pre>');
  assert.equal(render('```js_x\nx\n```'), '<pre><code>x</code></pre>');
  assert.equal(render('```\u0130\nx\n```'), '<pre><code>x</code></pre>'); // İ は小文字化で非 ASCII を含む
  // KELVIN SIGN は小文字化で ASCII の k になる。出力に残るのは ASCII の class 名だけで無害
  assert.equal(render('```\u212a\nx\n```'), '<pre><code class="language-k">x</code></pre>');
  assert.equal(render('```' + 'a'.repeat(33) + '\nx\n```'), '<pre><code>x</code></pre>');
  assert.equal(render('```' + 'a'.repeat(32) + '\nx\n```'), `<pre><code class="language-${'a'.repeat(32)}">x</code></pre>`);
});

test('コードブロック内の </code></pre> は閉じタグとして働かない', () => {
  const html = render('```\n</code></pre><script>alert(1)</script>\n```');
  assert.equal(html, '<pre><code>&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>');
});

test('エスケープ済みに見える入力 (&lt; など) は二重にエスケープされ、復号されて < に戻らない', () => {
  assert.equal(render('&lt;script&gt;'), '<p>&amp;lt;script&amp;gt;</p>');
  assert.equal(render('&#60;b&#62;'), '<p>&amp;#60;b&amp;#62;</p>');
});

test('表のセルのスクリプトとバックスラッシュ付きの | は、セルを増やさずエスケープされる', () => {
  const html = render('|a|b|\n|---|---|\n|x\\|<script>|y|');
  assert.ok(!html.includes('<script'));
  assert.equal((html.match(/<td/g) || []).length, 2);
});

test('ネストの上限: 深い入れ子でも例外を投げず、出力の <blockquote>/<ul> は 11 段を超えない', () => {
  const bq = render('> '.repeat(50) + 'x');
  assert.ok((bq.match(/<blockquote>/g) || []).length <= 11, 'blockquote の段数');
  assert.ok(bq.includes('x'));
  const ul = render(Array.from({ length: 50 }, (_, i) => `${'  '.repeat(i)}- n${i}`).join('\n'));
  assert.ok((ul.match(/<ul>/g) || []).length <= 11, 'ul の段数');
  const em = render('*a '.repeat(50) + 'x' + ' a*'.repeat(50));
  assert.ok((em.match(/<em>/g) || []).length <= 11, 'em の段数');
});

test('NUL を挟んだ入力は NUL が取り除かれ、<script> にはならずエスケープされる', () => {
  const html = render('<scr\u0000ipt>alert(1)</scr\u0000ipt>');
  assert.equal(html, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('sanitizeUrl: 許可は http/https/mailto/相対/# だけ。null か、元の文字列から空白・制御文字を除いたものを返す', () => {
  const ok = ['https://a.example/', 'HTTP://A.EXAMPLE', 'mailto:a@b.c', '/x', './x', '../x', '#a', '?a=b', 'x/y:z', '//a.example/'];
  for (const u of ok) assert.equal(sanitizeUrl(u), u, u);
  const ng = [
    'javascript:1', 'JaVaScRiPt:1', ' javascript:1', 'java\nscript:1', 'java\u0000script:1', '&#106;avascript:1',
    '&#x6a;avascript&colon;1', '&amp;#106;avascript:1', 'data:text/plain,x', 'vbscript:1', 'file:///x', 'about:blank',
    '', '   ', '\\\\evil\\x', '/\\evil', 'x:y', 'javascript&#0000058;1',
  ];
  for (const u of ng) assert.equal(sanitizeUrl(u), null, JSON.stringify(u));
  assert.equal(sanitizeUrl('mailto:a@b.c', 'image'), null);
  assert.equal(sanitizeUrl(null), null);
  assert.equal(sanitizeUrl(undefined), null);
  assert.equal(sanitizeUrl({ toString: () => 'javascript:1' }), null);
});

test('escapeHtml: 5 文字を必ず変換し、NUL や非文字列でも例外を投げない', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml('\u0000<'), '\u0000&lt;');
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml({ toString: () => '<b>' }), '&lt;b&gt;');
});

test('render: 文字列以外は TypeError (UI は try/catch で textContent にフォールバックする)', () => {
  for (const v of [null, undefined, 1, {}, ['<script>']]) assert.throws(() => render(v), TypeError);
});

test('100KB の悪意ある入力でも 1 秒以内 (ReDoS / 二乗時間の確認、追加パターン)', () => {
  const N = 100_000;
  const inputs = {
    '[': '['.repeat(N),
    '[a](': '[a]('.repeat(N / 4),
    '![a](': '![a]('.repeat(N / 5),
    '*a ': '*a '.repeat(N / 3),
    '**a *b ': '**a *b '.repeat(N / 7),
    '~~a ': '~~a '.repeat(N / 4),
    '`a``': '`a``'.repeat(N / 4),
    '&#': '&#'.repeat(N / 2),
    '&#x': '&#x'.repeat(N / 3),
    'http://': 'http://'.repeat(N / 7),
    'https://a ': 'https://a'.repeat(N / 9),
    '\\': '\\'.repeat(N),
    '<': '<'.repeat(N),
    '表': '|a'.repeat(N / 2) + '\n' + '|-'.repeat(N / 2) + '\n' + '|x'.repeat(N / 2),
    '表の行数': '|a|b|\n|-|-|\n' + '|x|y|\n'.repeat(N / 6),
    '- ': '- a\n'.repeat(N / 4),
    '入れ子リスト': Array.from({ length: 3000 }, (_, i) => `${' '.repeat(i * 2)}- a`).join('\n'),
    '> ': '> '.repeat(N / 2) + 'x',
    '空白': 'a' + ' '.repeat(N) + '\nb',
    '#': '#'.repeat(N),
    '1. ': '1. '.repeat(N / 3),
    '```': '```\n'.repeat(N / 4),
    '*[': '[*'.repeat(N / 2) + '](x)',
    '[a]': '[a] '.repeat(N / 4),
    '[a](b)': '[a](b) '.repeat(N / 7),
    '*': '*'.repeat(N / 2) + 'a' + '*'.repeat(N / 2),
    '|': '|'.repeat(N),
    '\\* ': '\\*'.repeat(N / 2),
  };
  for (const [name, src] of Object.entries(inputs)) {
    const t0 = performance.now();
    const html = render(src);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `${name}: ${ms.toFixed(0)}ms`);
    assert.equal(typeof html, 'string');
    assert.ok(!/<script/i.test(html));
  }
});
