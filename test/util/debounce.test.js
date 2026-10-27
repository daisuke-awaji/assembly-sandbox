import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce } from '../../src/util/debounce.js';

function fakeTimers() {
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimeout(fn, ms) { const id = nextId++; tasks.set(id, { fn, ms }); return id; },
    clearTimeout(id) { tasks.delete(id); },
    fireAll() { for (const [id, t] of [...tasks]) { if (!tasks.has(id)) continue; tasks.delete(id); t.fn(); } },
    count: () => tasks.size,
  };
}

test('trailing: 最後の引数で 1 回だけ呼ぶ', () => {
  const t = fakeTimers();
  const calls = [];
  const d = debounce((x) => calls.push(x), 100, t);
  d(1); d(2); d(3);
  assert.equal(t.count(), 1);
  assert.deepEqual(calls, []);
  t.fireAll();
  assert.deepEqual(calls, [3]);
  assert.equal(d.pending(), false);
});

test('待ち時間を渡す', () => {
  let seen;
  const d = debounce(() => {}, 150, { setTimeout: (f, ms) => { seen = ms; return 1; }, clearTimeout() {} });
  d();
  assert.equal(seen, 150);
});

test('cancel は保留を破棄する', () => {
  const t = fakeTimers();
  let n = 0;
  const d = debounce(() => n++, 10, t);
  d();
  assert.equal(d.pending(), true);
  d.cancel();
  assert.equal(d.pending(), false);
  t.fireAll();
  assert.equal(n, 0);
});

test('flush は保留を即実行し、保留が無ければ何もしない', () => {
  const t = fakeTimers();
  const calls = [];
  const d = debounce((x) => calls.push(x), 10, t);
  d.flush();
  assert.deepEqual(calls, []);
  d('a'); d('b');
  d.flush();
  assert.deepEqual(calls, ['b']);
  assert.equal(t.count(), 0);
  d.flush();
  assert.deepEqual(calls, ['b']);
});

test('実行後に再度呼べる', () => {
  const t = fakeTimers();
  let n = 0;
  const d = debounce(() => n++, 10, t);
  d(); t.fireAll(); d(); t.fireAll();
  assert.equal(n, 2);
});

test('既定のタイマー (グローバル) で動く', async () => {
  let n = 0;
  const d = debounce(() => n++, 5);
  d(); d();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n, 1);
});

test('maxWait: 呼び出しが続いても最初の呼び出しから maxWait で 1 回呼ぶ', () => {
  const tasks = [];
  const t = {
    setTimeout(fn, ms) { tasks.push({ fn, ms, live: true }); return tasks.length - 1; },
    clearTimeout(id) { tasks[id].live = false; },
  };
  const calls = [];
  const d = debounce((x) => calls.push(x), 100, t, { maxWait: 150 });
  d(1); d(2); d(3);
  const live = tasks.filter((x) => x.live);
  assert.deepEqual(live.map((x) => x.ms).sort(), [100, 150]);
  live.find((x) => x.ms === 150).fn(); // maxWait の満了
  assert.deepEqual(calls, [3]);
  assert.equal(d.pending(), false);
  assert.equal(tasks.filter((x) => x.live).length, 0);
  d(4);
  assert.equal(tasks.filter((x) => x.live).length, 2);
  d.cancel();
  assert.equal(tasks.filter((x) => x.live).length, 0);
});
