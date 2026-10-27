import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, sanitizeUrl, isExternalUrl } from '../../src/markdown/escape.js';

test('escapeHtml: 5 文字を置換する', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml('plain 日本語'), 'plain 日本語');
  assert.equal(escapeHtml('&amp;'), '&amp;amp;');
  assert.equal(escapeHtml(''), '');
});

test('sanitizeUrl: 許可されるもの', () => {
  const ok = [
    'http://a.com', 'https://a.com/x?y=1#z', 'HTTPS://A.COM', 'mailto:a@b.c', '/path', 'a/b', './a', '../a',
    '#anchor', '?q=1', '//cdn.example.com/x', 'a.png', 'a/b:c', '/a:b', '?a=b:c', '#a:b',
  ];
  for (const u of ok) assert.equal(sanitizeUrl(u, 'link'), u, u);
});

test('sanitizeUrl: 拒否されるもの', () => {
  const bad = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)',
    '  javascript:alert(1)', '\u0001javascript:alert(1)', '&#106;avascript:alert(1)', '&#x6A;avascript:alert(1)',
    'javascript&colon;alert(1)', 'java&#x09;script:alert(1)', 'java&Tab;script:alert(1)', 'java&#10;script:1',
    '&amp;#106;avascript:1', 'data:text/html,<script>', 'vbscript:msgbox', 'file:///etc/passwd', 'ftp://a.com',
    'foo:bar', ':foo', '', '   ', 'http:\\\\evil.com', '/a\\b', 'java​script:1', 'java­script:1',
    '﻿javascript:1', 'javascript :1',
  ];
  for (const u of bad) assert.equal(sanitizeUrl(u, 'link'), null, JSON.stringify(u));
  assert.equal(sanitizeUrl(null), null);
  assert.equal(sanitizeUrl(42), null);
});

test('sanitizeUrl: image では mailto を拒否する', () => {
  assert.equal(sanitizeUrl('mailto:a@b.c', 'image'), null);
  assert.equal(sanitizeUrl('mailto:a@b.c', 'link'), 'mailto:a@b.c');
  assert.equal(sanitizeUrl('https://a.com/a.png', 'image'), 'https://a.com/a.png');
  assert.equal(sanitizeUrl('a.png', 'image'), 'a.png');
  assert.equal(sanitizeUrl('data:image/png;base64,AAAA', 'image'), null);
});

test('sanitizeUrl: 戻り値は除去対象文字だけを取り除いた元の文字列', () => {
  assert.equal(sanitizeUrl('https://a.com/a b'), 'https://a.com/ab');
  assert.equal(sanitizeUrl('/x?a=&amp;b'), '/x?a=&amp;b');
  assert.equal(sanitizeUrl('HTTP://A.com'), 'HTTP://A.com');
});

test('isExternalUrl', () => {
  assert.equal(isExternalUrl('http://a.com'), true);
  assert.equal(isExternalUrl('HTTPS://a.com'), true);
  assert.equal(isExternalUrl('//a.com'), true);
  assert.equal(isExternalUrl('mailto:a@b.c'), false);
  assert.equal(isExternalUrl('/a'), false);
  assert.equal(isExternalUrl('#a'), false);
  assert.equal(isExternalUrl('a/http://b'), false);
});
