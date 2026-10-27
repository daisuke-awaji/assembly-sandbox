import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../src/markdown/index.js';

const SIZE = 100 * 1024;
const rep = (unit) => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);

const cases = {
  '* の反復': rep('*'),
  '* と文字の交互': rep('*a '),
  '** の反復': rep('**a '),
  '*a**b': rep('*a**b'),
  '~~ の反復': rep('~~a '),
  'バッククォート': rep('`'),
  '長さの違うバッククォート列': Array.from({ length: 600 }, (_, k) => '`'.repeat(k + 1) + 'a ').join('').repeat(3).slice(0, SIZE),
  '[ の反復': rep('['),
  '[a]( の反復': rep('[a]('),
  '[a](b の反復': rep('[a](b '),
  '![ の反復': rep('!['),
  '( の反復': rep('('),
  '[]( )': rep('[](') + rep(')').slice(0, 1000),
  '> の反復': rep('>'),
  '> の行の反復': rep('> '),
  '> > > の行': rep('> > > > > > > > > > > > > x\n'),
  '- の反復': rep('-'),
  '- 行の反復': rep('- a\n'),
  '"- " の反復': rep('- '),
  '入れ子のリスト': Array.from({ length: 400 }, (_, k) => ' '.repeat(k * 2) + '- x').join('\n'),
  '深い入れ子の引用': Array.from({ length: 330 }, (_, k) => '> '.repeat(k) + 'x').join('\n'),
  '強調の深い入れ子': '**'.repeat(25600) + 'x' + '**'.repeat(25600),
  'リンクの深い入れ子': '['.repeat(17000) + 'x' + '](/u)'.repeat(17000),
  '空白の反復': rep(' '),
  '空白と # の反復': rep('#  ') + 'x',
  '# の反復': rep('#'),
  '表の反復': rep('|a|b|\n|-|-|\n'),
  '| の反復': rep('|'),
  '```の反復': rep('```\n'),
  'http:// の反復': rep('http://a'),
  '\\ の反復': rep('\\'),
  '& の反復': rep('&#106;'),
  '番号リスト': rep('1. a\n'),
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
