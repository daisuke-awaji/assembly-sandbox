import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTags, deriveTitle, normalizeTag } from '../../src/store/tags.js';

test('extractTags: 基本・小文字化・重複・出現順', () => {
  assert.deepEqual(extractTags('#Foo bar #baz\n#foo #日本語_1-x'), ['foo', 'baz', '日本語_1-x']);
});

test('extractTags: 見出しはタグではない', () => {
  assert.deepEqual(extractTags('# 見出し\n## もう一つ\n#tag'), ['tag']);
  assert.deepEqual(extractTags('##foo'), []);
});

test('extractTags: 語中の # は無視', () => {
  assert.deepEqual(extractTags('a#b http://x/#frag'), []);
});

test('extractTags: フェンスとインラインコードの中は無視', () => {
  assert.deepEqual(extractTags('```\n#in\n```\n#out'), ['out']);
  assert.deepEqual(extractTags('`#a` #b ``x ` #c`` #d'), ['b', 'd']);
  assert.deepEqual(extractTags('```\n#unclosed'), []);
  assert.deepEqual(extractTags('`unclosed #a'), ['a']);
});

test('extractTags: 50 文字は可、51 文字は無視', () => {
  assert.deepEqual(extractTags('#' + 'a'.repeat(50)), ['a'.repeat(50)]);
  assert.deepEqual(extractTags('#' + 'a'.repeat(51) + ' #ok'), ['ok']);
});

test('extractTags: 最大 50 個', () => {
  const body = Array.from({ length: 80 }, (_, i) => `#t${i}`).join(' ');
  const tags = extractTags(body);
  assert.equal(tags.length, 50);
  assert.equal(tags[49], 't49');
});

test('deriveTitle: 見出し優先', () => {
  assert.equal(deriveTitle('前置き\n## タイトル ##\n本文'), 'タイトル');
  assert.equal(deriveTitle('   ### 付き  \n'), '付き');
});

test('deriveTitle: 空の見出しは次の候補へ', () => {
  assert.equal(deriveTitle('# \n# #\n# 次'), '次');
  assert.equal(deriveTitle('#\n本文'), '#');
});

test('deriveTitle: 見出しがなければ最初の非空行', () => {
  assert.equal(deriveTitle('\n  \n  hello  \nworld'), 'hello');
  assert.equal(deriveTitle('#tag だけ'), '#tag だけ');
});

test('deriveTitle: 空は 無題', () => {
  assert.equal(deriveTitle(''), '無題');
  assert.equal(deriveTitle(' \n\t\n'), '無題');
});

test('deriveTitle: 200 文字に切り詰め', () => {
  assert.equal(deriveTitle('a'.repeat(300)).length, 200);
  assert.equal(deriveTitle('# ' + 'b'.repeat(300)), 'b'.repeat(200));
});

test('deriveTitle: コードブロック内の # は見出しではない', () => {
  assert.equal(deriveTitle('```\n# in\n```\n# out'), 'out');
});

test('deriveTitle: 4 空白以上のインデントや 7 個以上の # は見出しでない', () => {
  assert.equal(deriveTitle('    # code\n# real'), 'real');
  assert.equal(deriveTitle('####### x'), '####### x');
});

test('deriveTitle: 閉じ # の扱い', () => {
  assert.equal(deriveTitle('# C# language'), 'C# language');
  assert.equal(deriveTitle('# foo #'), 'foo');
});

test('normalizeTag', () => {
  assert.equal(normalizeTag('#Foo'), 'foo');
  assert.equal(normalizeTag('##X '), '#x');
  assert.equal(normalizeTag('  #X'), '#x');
  assert.equal(normalizeTag('ABC'), 'abc');
});
