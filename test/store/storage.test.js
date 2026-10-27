import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStorage, createMemoryStorage } from '../../src/store/storage.js';

test('メモリ実装: get/set/remove/dump', () => {
  const s = createMemoryStorage({ a: '1' });
  assert.equal(s.getItem('a'), '1');
  assert.equal(s.getItem('none'), null);
  s.setItem('b', '2');
  s.removeItem('a');
  assert.deepEqual(s.dump(), { b: '2' });
  s.dump().b = 'x';
  assert.equal(s.getItem('b'), '2');
  assert.equal(s.getItem('__proto__'), null);
});

test('メモリ実装: quota 超過は QuotaExceededError で内容は不変', () => {
  const s = createMemoryStorage({}, { quotaChars: 5 });
  s.setItem('a', '123');
  assert.throws(() => s.setItem('b', '123'), { name: 'QuotaExceededError' });
  assert.deepEqual(s.dump(), { a: '123' });
  s.setItem('a', '12345');
  assert.equal(s.getItem('a'), '12345');
  assert.throws(() => s.setItem('a', '123456'), { name: 'QuotaExceededError' });
  assert.equal(s.getItem('a'), '12345');
});

test('createLocalStorage: 偽 backend に委譲し、例外をそのまま伝える', () => {
  const calls = [];
  const boom = new Error('boom');
  const ls = createLocalStorage({
    getItem: (k) => (calls.push(['get', k]), 'v'),
    setItem: (k, v) => { calls.push(['set', k, v]); throw boom; },
    removeItem: (k) => calls.push(['rm', k]),
  });
  assert.equal(ls.getItem('k'), 'v');
  assert.throws(() => ls.setItem('k', 'x'), (e) => e === boom);
  ls.removeItem('k');
  assert.deepEqual(calls, [['get', 'k'], ['set', 'k', 'x'], ['rm', 'k']]);
});

test('createLocalStorage: 利用できない環境でも生成時に投げず、使用時に投げる', () => {
  const ls = createLocalStorage();
  assert.equal(typeof ls.getItem, 'function');
  const ls2 = createLocalStorage(null);
  assert.throws(() => ls2.getItem('a'));
});
