import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../src/markdown/index.js';

// perf.test.js に無いパターン。各 100KB が 1 秒以内。
const SIZE = 100 * 1024;
const rep = (unit) => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);
const lines = (f) => {
  const out = [];
  let len = 0;
  for (let i = 0; len < SIZE; i++) {
    const l = f(i);
    out.push(l);
    len += l.length + 1;
  }
  return out.join('\n');
};

const cases = {
  '表: 1 行に大量の列': `${'|a'.repeat(SIZE / 4)}|\n${'|-'.repeat(SIZE / 4)}|\n${'|b'.repeat(SIZE / 4)}|`,
  '表: ヘッダだけ大量列で区切り行が合わない': `${'|a'.repeat(SIZE / 2)}|\n|-|`,
  '表: 多数の行と列': lines((i) => (i === 1 ? '|-|-|-|-|-|-|-|-|' : '|a|b|c|d|e|f|g|h|')),
  '表: 区切り行が繰り返される': rep('|a|b|\n|-|-|\n'),
  '表: セルに強調・リンク': lines((i) => (i === 1 ? '|-|-|' : '|**a**|[l](/x)|')),
  '表: エスケープされた | の反復': `|a|\n|-|\n${rep('\\|')}`,
  '表: 区切りのない | 行': rep('a|b\n'),
  '長い 1 行のリンク記法の反復': rep('[a](http://example.com/x) '),
  '長い 1 行の閉じないリンクの反復': rep('[a](http://example.com/x '),
  '長い 1 行の画像記法の反復': rep('![a](x.png) '),
  'リンクテキストが長く閉じない': `[${'a'.repeat(SIZE)}`,
  'リンクの URL が長く閉じない': `[a](${'b('.repeat(SIZE / 2)}`,
  'リンクの URL が括弧だらけ': `[a](${'(x)'.repeat(SIZE / 3)})`,
  '] と ( の反復': rep('](['),
  '[[ と ]] の混在': rep('[[a]]['),
  '自動リンクの反復': rep('http://a.com/x '),
  '自動リンクに ) が続く': `http://a.com/${')'.repeat(SIZE)}`,
  '~~ と ** の交互': rep('~~a**b'),
  '~~ と ** と * の交互': rep('~~**a*'),
  '~~ ** の閉じの無い交互': rep('**~~'),
  '**a~~b**c~~ の反復': rep('**a~~b**c~~'),
  '* ** *** の増加列': rep(Array.from({ length: 28 }, (_, k) => '*'.repeat(k % 7 + 1) + 'a').join(' ') + ' '),
  '強調とコードスパンの混在': rep('**`a*`b** '),
  'コードスパンの開閉が不揃い': rep('`a``b```c'),
  '行ごとに増えるバッククォート': Array.from({ length: 300 }, (_, k) => '`'.repeat(k + 1) + 'x').join('\n').repeat(3).slice(0, SIZE),
  '深い入れ子: 引用+リスト+強調': lines((i) => `${'> '.repeat(i % 12)}${'  '.repeat(i % 5)}- **a *b ~~c~~***`),
  '深い入れ子: リストと引用の交互': lines((i) => `${'> - '.repeat((i % 8) + 1)}x`),
  '深い入れ子: 字下げが増減するリスト': lines((i) => `${' '.repeat((i * 7) % 40)}- item ${i}`),
  '深い入れ子: 番号リストと箇条書き': lines((i) => `${' '.repeat((i % 6) * 2)}${i % 2 ? '-' : `${i}.`} a`),
  '深い入れ子: 表を含む引用': rep('> |a|b|\n> |-|-|\n> |1|2|\n>\n'),
  '深い入れ子: 見出し・引用・コードの混合': rep('# h\n> q\n```\nc\n```\n- l\n\n'),
  '混合: 全記法を詰めた行': rep('# **a** [b](/c) `d` ~~e~~ ![f](g.png) http://h.com\n'),
  '混合: 表・リスト・引用が交互': rep('|a|\n|-|\n|1|\n- x\n> y\n'),
  'フェンスの開閉が不揃い': rep('```\n````\n`````\n'),
  '長い info 文字列のフェンス': `\`\`\`${'a'.repeat(SIZE)}\nx\n\`\`\``,
  '水平線の反復': rep('- - -\n'),
  '水平線に近い行': rep('- - x\n'),
  'チェックリストの反復': rep('- [ ] a\n- [x] b\n'),
  '段落の長い 1 行': 'word '.repeat(SIZE / 5),
  '段落の超多数行': rep('a\n'),
  '空行だらけ': rep('\n'),
  'CRLF だらけ': rep('a\r\n'),
  '行末 2 スペースの反復': rep('a  \n'),
  'バックスラッシュと記号': rep('\\*\\[\\`'),
  '全角文字': rep('あいうえお**かきくけこ**'),
  'サロゲートペア': rep('😀**😀**'),
  'タブの反復': rep('\t- a\n'),
  '& < > の反復': rep('&<>"\''),
};

for (const [name, input] of Object.entries(cases)) {
  test(`100KB の入力が 1 秒以内: ${name}`, () => {
    assert.ok(input.length >= SIZE - 1000, `入力サイズ ${input.length}`);
    const t0 = performance.now();
    const html = render(input);
    const ms = performance.now() - t0;
    assert.equal(typeof html, 'string');
    assert.ok(ms < 1000, `${ms.toFixed(0)}ms`);
  });
}
