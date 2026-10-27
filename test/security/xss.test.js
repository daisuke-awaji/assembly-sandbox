import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../src/markdown/index.js';

const ALLOWED_TAGS = new Set([
  'p', 'a', 'img', 'strong', 'em', 'del', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'br',
  'blockquote', 'ul', 'ol', 'li', 'input', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC=//evil.example/x.js></SCRIPT>',
  '<img src=x onerror=alert(1)>',
  '<img src="x" onerror="alert(1)">',
  '<svg onload=alert(1)>',
  '<svg><script>alert(1)</script></svg>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<body onload=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<style>@import "http://evil.example/x.css";</style>',
  '<link rel=stylesheet href=http://evil.example/x.css>',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><button>x</button></form>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<details open ontoggle=alert(1)>',
  '<input autofocus onfocus=alert(1)>',
  '<<script>alert(1)//<</script>',
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](  javascript:alert(1))',
  '[x](java\tscript:alert(1))',
  '[x](java\nscript:alert(1))',
  '[x](&#106;avascript:alert(1))',
  '[x](&#x6A;avascript:alert(1))',
  '[x](&#0000106avascript:alert(1))',
  '[x](javascript&colon;alert(1))',
  '[x](java&#x09;script:alert(1))',
  '[x](&amp;#106;avascript:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[x](vbscript:msgbox(1))',
  '[x](file:///etc/passwd)',
  '[x](\\javascript:alert(1))',
  '[x](/a"onmouseover="alert(1))',
  '[x](/a\'onmouseover=\'alert(1))',
  '[x](/a><script>alert(1)</script>)',
  '[x](https://a.com" onclick="alert(1))',
  '[x](https://a.com/?q=<script>)',
  '[<script>alert(1)</script>](/ok)',
  '[a](b)[c](javascript:alert(1))',
  '![x](javascript:alert(1))',
  '![x](data:image/svg+xml,<svg onload=alert(1)>)',
  '![x](mailto:a@b.c)',
  '![x" onerror="alert(1)](/a.png)',
  '![x](/a.png" onerror="alert(1))',
  '![<img src=x onerror=alert(1)>](/a.png)',
  '![x](https://a.com/a.png?"><script>alert(1)</script>)',
  '`<script>alert(1)</script>`',
  '```html\n<script>alert(1)</script>\n```',
  '```"><script>alert(1)</script>\n```',
  '```js onclick=alert(1)\nx\n```',
  '```<img src=x onerror=alert(1)>\nx\n```',
  '# <script>alert(1)</script>',
  '# [x](javascript:alert(1))',
  '> <script>alert(1)</script>',
  '> [x](javascript:alert(1))',
  '- <script>alert(1)</script>',
  '- [ ] <img src=x onerror=alert(1)>',
  '1. [x](javascript:alert(1))',
  '| <script> | b |\n|---|---|\n| <img src=x onerror=alert(1)> | [x](javascript:alert(1)) |',
  '|a|b|\n|:"onclick="alert(1)-|-|\n|x|y|',
  '**<script>alert(1)</script>**',
  '*<img src=x onerror=alert(1)>*',
  '~~<svg onload=alert(1)>~~',
  'https://a.com/<script>alert(1)</script>',
  'https://a.com/"onmouseover="alert(1)',
  'http://a.com/\'onmouseover=\'alert(1)',
  'https://a.com/?a=1&b="><img src=x onerror=alert(1)>',
  '\\<script\\>alert(1)\\</script\\>',
  'java\u0000script:alert(1)',
  '[x](java\u0000script:alert(1))',
  '[x](\u0001javascript:alert(1))',
  '[x](javascript​:alert(1))',
  '[x](﻿javascript:alert(1))',
  '[x](&#x6a;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&colon;alert(1))',
  '[x](&NewLine;javascript:alert(1))',
  '[x](&#10;javascript:alert(1))',
  '[x](//evil.example/x)',
  '<a href=x>[y](z)</a>',
  '[[x](javascript:alert(1))](/ok)',
  '[x]( (javascript:alert(1)) )',
  '[x](((javascript:alert(1))))',
  '[x](<javascript:alert(1)>)',
  '"><script>alert(1)</script>',
  "'><script>alert(1)</script>",
  '<!--<script>alert(1)</script>-->',
  '<![CDATA[<script>alert(1)</script>]]>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<img src=`x`onerror=alert(1)>',
  '<a href="&#x6A;avascript:alert(1)">x</a>',
  '- a\n  - <script>alert(1)</script>',
  '> > > <script>alert(1)</script>',
  '>'.repeat(40) + ' <script>alert(1)</script>',
  '- '.repeat(5) + '<script>alert(1)</script>',
  ' <script>alert(1)</script>',
  '＜script＞alert(1)＜/script＞',
];

function check(payload, html) {
  const where = JSON.stringify(payload);
  // (a) 許可済みタグ名だけ
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)) {
    assert.ok(ALLOWED_TAGS.has(m[1].toLowerCase()), `許可されないタグ <${m[1]}>: ${where} → ${html}`);
  }
  assert.ok(!/<script/i.test(html), where);
  assert.ok(!/<(svg|iframe)/i.test(html), where);
  // (c) すべてのタグは「名前 + ダブルクォートで閉じた属性」だけで構成され、on* 属性が無い
  for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const tag = m[0];
    assert.match(tag, /^<[a-z0-9]+(?: [a-z-]+(?:="[^"]*")?)*>$/, `タグの形が不正: ${tag} (${where})`);
    assert.ok(!/\son\w+\s*=/i.test(tag.replace(/="[^"]*"/g, '=""')), `on* 属性: ${tag} (${where})`);
    assert.ok(!/\sstyle\s*=/i.test(tag), `style 属性: ${tag}`);
  }
  // (b) href / src は http(s) / mailto / 相対 / # だけ
  for (const m of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
    const value = m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
    if (scheme) {
      const s = scheme[1].toLowerCase();
      assert.ok(['http', 'https', 'mailto'].includes(s), `危険なスキーム ${value} (${where})`);
      if (m[1] === 'src') assert.ok(s !== 'mailto', `画像の mailto: ${value}`);
    }
    assert.ok(!/[\u0000- \u007f-\u009f]/.test(value), `空白・制御文字を含む URL: ${JSON.stringify(value)}`);
    assert.ok(!value.includes('\\'), where);
  }
}

test('ペイロードは 50 件以上ある', () => {
  assert.ok(PAYLOADS.length >= 50, String(PAYLOADS.length));
});

for (const [k, payload] of PAYLOADS.entries()) {
  test(`XSS ${String(k + 1).padStart(2, '0')}: ${JSON.stringify(payload).slice(0, 60)}`, () => {
    check(payload, render(payload));
    // 文章に埋め込んでも、前後に別の記法があっても同じ
    check(payload, render(`# t\n\ntext ${payload} **b**\n\n- ${payload}\n\n> ${payload}`));
  });
}

test('生の < は常に &lt; になる (コードブロック・引用・リスト・表)', () => {
  const html = render('```\n<script>\n```\n> <b>\n- <i>\n\n|<u>|x|\n|-|-|\n|<s>|y|');
  assert.ok(!/<(script|b|i|u|s)>/.test(html));
});

test('a/img が出す属性は固定順で、外部リンクは noopener', () => {
  assert.equal(
    render('[x](https://a.com)'),
    '<p><a href="https://a.com" target="_blank" rel="noopener noreferrer">x</a></p>',
  );
  assert.equal(
    render('![x](https://a.com/a.png)'),
    '<p><img src="https://a.com/a.png" alt="x" loading="lazy" referrerpolicy="no-referrer"></p>',
  );
});
