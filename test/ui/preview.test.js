import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreview } from '../../src/ui/preview.js';
import { fakeTimers } from './fakes.js';

test('初回は空で、update は遅延して最後の src だけ描画する', () => {
  const timers = fakeTimers();
  const el = { innerHTML: '' };
  const seen = [];
  const p = createPreview({ el, timers, render: (s) => { seen.push(s); return `<p>${s}</p>`; } });
  assert.equal(el.innerHTML, '');
  p.update('a'); p.update('b');
  assert.equal(el.innerHTML, '');
  timers.fireAll();
  assert.deepEqual(seen, ['b']);
  assert.equal(el.innerHTML, '<p>b</p>');
});

test('flush は保留が無くても最新の src で描画し、保留をキャンセルする', () => {
  const timers = fakeTimers();
  const el = { innerHTML: '' };
  let n = 0;
  const p = createPreview({ el, timers, render: (s) => { n++; return s; } });
  p.update('x');
  p.flush();
  assert.equal(el.innerHTML, 'x');
  assert.equal(timers.count(), 0);
  p.flush();
  assert.equal(n, 2);
});

test('render が例外を投げたら代替文言を textContent に入れる', () => {
  const timers = fakeTimers();
  const el = { innerHTML: '' };
  const p = createPreview({ el, timers, render: () => { throw new Error('boom'); } });
  p.update('x');
  timers.fireAll();
  assert.equal(el.textContent, 'プレビューを表示できません');
  assert.equal(el.innerHTML, '');
});

test('既定の待ち時間は 150ms', () => {
  let ms;
  const p = createPreview({ el: {}, render: () => '', timers: { setTimeout: (f, w) => { ms = w; return 1; }, clearTimeout() {} } });
  p.update('a');
  assert.equal(ms, 150);
});

test('入力が wait 未満の間隔で続いても maxWait までに一度は描画する', () => {
  const tasks = [];
  const timers = {
    setTimeout(fn, ms) { tasks.push({ fn, ms, live: true }); return tasks.length - 1; },
    clearTimeout(id) { tasks[id].live = false; },
  };
  const el = { innerHTML: '' };
  const p = createPreview({ el, timers, render: (s) => s });
  p.update('a'); p.update('ab'); p.update('abc');
  assert.equal(tasks.filter((x) => x.live).length, 2);
  tasks.filter((x) => x.live)[0].fn();
  assert.equal(el.innerHTML, 'abc');
});
