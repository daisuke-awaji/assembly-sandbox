import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotesStore } from '../../src/store/notes.js';
import { createMemoryStorage } from '../../src/store/storage.js';
import { STORAGE_KEY, CORRUPT_KEY, LIMITS } from '../../src/store/schema.js';

function setup({ initial, quotaChars, start = 1000 } = {}) {
  const storage = createMemoryStorage(initial, { quotaChars });
  const clock = { t: start };
  let seq = 0;
  const store = createNotesStore(storage, {
    now: () => clock.t,
    genId: () => `id${++seq}`,
  });
  return { storage, clock, store };
}
const stored = (storage) => JSON.parse(storage.getItem(STORAGE_KEY));
const code = (c) => (e) => e.name === 'StoreError' && e.code === c;
const fileOf = (notes) => JSON.stringify({ version: 1, notes });
const rawNote = (id, body, updatedAt, createdAt = 1) => ({ id, title: 'x', body, tags: [], createdAt, updatedAt });

test('create: 値の導出と保存', () => {
  const { store, storage } = setup();
  const n = store.create({ body: '# 題\n#Tag text', extra: 1 });
  assert.deepEqual(n, { id: 'id1', title: '題', body: '# 題\n#Tag text', tags: ['tag'], createdAt: 1000, updatedAt: 1000 });
  assert.deepEqual(stored(storage).notes, [n]);
  assert.equal(stored(storage).version, 1);
  assert.equal(store.create().body, '');
  assert.equal(store.get('id2').title, '無題');
});

test('create: 検証', () => {
  const { store } = setup();
  assert.throws(() => store.create({ body: 1 }), code('VALIDATION'));
  assert.throws(() => store.create({ body: 'a'.repeat(LIMITS.MAX_BODY + 1) }), code('VALIDATION'));
  store.create({ body: 'a'.repeat(LIMITS.MAX_BODY) });
});

test('戻り値はコピーで、書き換えても内部に影響しない', () => {
  const { store } = setup();
  const n = store.create({ body: '#a' });
  n.body = 'hacked';
  n.tags.push('x');
  assert.equal(store.get('id1').body, '#a');
  assert.deepEqual(store.get('id1').tags, ['a']);
  const l = store.list();
  l[0].tags.push('y');
  assert.deepEqual(store.list()[0].tags, ['a']);
  store.exportAll().notes[0].tags.push('z');
  assert.deepEqual(store.get('id1').tags, ['a']);
});

test('get: 無ければ null', () => {
  assert.equal(setup().store.get('nope'), null);
});

test('update: 再計算と単調増加', () => {
  const { store, clock } = setup();
  store.create({ body: 'a' });
  clock.t = 5000;
  const u = store.update('id1', { body: '# new #t', id: 'zzz', title: 'q', updatedAt: 1 });
  assert.deepEqual(u, { id: 'id1', title: 'new #t', body: '# new #t', tags: ['t'], createdAt: 1000, updatedAt: 5000 });
  clock.t = 5000; // 時計が進まない
  assert.equal(store.update('id1', { body: 'b' }).updatedAt, 5001);
  clock.t = 1; // 時計が戻る
  assert.equal(store.update('id1', { body: 'c' }).updatedAt, 5002);
});

test('update: 同じ body は何も書かない', () => {
  const { store, storage, clock } = setup();
  store.create({ body: 'a' });
  const before = storage.getItem(STORAGE_KEY);
  storage.setItem('probe', 'x');
  clock.t = 9999;
  const n = store.update('id1', { body: 'a' });
  assert.equal(n.updatedAt, 1000);
  assert.equal(storage.getItem(STORAGE_KEY), before);
  // 容量ゼロでも no-op なら成功する
  const s2 = setup({ quotaChars: 1e9 });
  s2.store.create({ body: 'a' });
  assert.doesNotThrow(() => s2.store.update('id1', { body: 'a' }));
});

test('update: NOT_FOUND と検証', () => {
  const { store } = setup();
  store.create({ body: 'a' });
  assert.throws(() => store.update('nope', { body: 'x' }), code('NOT_FOUND'));
  assert.throws(() => store.update('id1', {}), code('VALIDATION'));
  assert.throws(() => store.update('id1', { body: 5 }), code('VALIDATION'));
  assert.throws(() => store.update('id1'), code('VALIDATION'));
});

test('remove', () => {
  const { store, storage } = setup();
  store.create({ body: 'a' });
  assert.equal(store.remove('nope'), false);
  assert.equal(store.remove('id1'), true);
  assert.equal(store.get('id1'), null);
  assert.deepEqual(stored(storage).notes, []);
});

test('list: 並び順 (updatedAt 降順 → createdAt 降順 → id 昇順)', () => {
  const initial = { [STORAGE_KEY]: fileOf([
    rawNote('b', 'x', 10, 5), rawNote('a', 'x', 10, 5), rawNote('c', 'x', 10, 6), rawNote('d', 'x', 20, 1), rawNote('e', 'x', 5, 9),
  ]) };
  const { store } = setup({ initial });
  assert.deepEqual(store.list().map((n) => n.id), ['d', 'c', 'a', 'b', 'e']);
  assert.deepEqual(store.exportAll().notes.map((n) => n.id), ['d', 'c', 'a', 'b', 'e']);
});

test('list: query と tag の絞り込み (AND)', () => {
  const { store, clock } = setup();
  store.create({ body: '# Apple pie\n#fruit #sweet' });
  clock.t++;
  store.create({ body: '# Banana\nApple inside #fruit' });
  clock.t++;
  store.create({ body: '# Carrot\n#veg' });
  assert.deepEqual(store.list({ query: 'APPLE' }).map((n) => n.id), ['id2', 'id1']);
  assert.deepEqual(store.list({ query: '  apple pie ' }).map((n) => n.id), ['id1']);
  assert.deepEqual(store.list({ query: 'apple banana' }).map((n) => n.id), []);
  assert.deepEqual(store.list({ tag: '#Fruit' }).map((n) => n.id), ['id2', 'id1']);
  assert.deepEqual(store.list({ tag: 'fruit', query: 'pie' }).map((n) => n.id), ['id1']);
  assert.deepEqual(store.list({ tag: 'veg', query: 'apple' }), []);
  assert.equal(store.list({ query: '   ', tag: '' }).length, 3);
  assert.equal(store.list({ tag: null }).length, 3);
  assert.equal(store.list(undefined).length, 3);
  assert.deepEqual(store.list({ tag: 'none' }), []);
});

test('listTags: 件数降順 → タグ昇順、絞り込みの影響なし', () => {
  const { store } = setup();
  store.create({ body: '#b #a #c' });
  store.create({ body: '#c #b' });
  store.create({ body: '#c' });
  assert.deepEqual(store.listTags(), [
    { tag: 'c', count: 3 }, { tag: 'b', count: 2 }, { tag: 'a', count: 1 },
  ]);
  assert.deepEqual(setup().store.listTags(), []);
});

test('容量超過: create/update/remove は巻き戻して QUOTA_EXCEEDED', () => {
  const { store, storage } = setup({ quotaChars: 200 });
  const n = store.create({ body: 'small' });
  const snapshot = storage.dump();
  assert.throws(() => store.create({ body: 'x'.repeat(500) }), code('QUOTA_EXCEEDED'));
  assert.equal(store.list().length, 1);
  assert.throws(() => store.update(n.id, { body: 'y'.repeat(500) }), code('QUOTA_EXCEEDED'));
  assert.deepEqual(store.get(n.id), n);
  assert.deepEqual(storage.dump(), snapshot);
  // 容量が足りなくなった状態での remove 失敗も巻き戻す (削除は小さくなるので成功する)
  assert.equal(store.remove(n.id), true);
});

test('容量超過のエラーは cause を持つ', () => {
  const { store } = setup({ quotaChars: 10 });
  try {
    store.create({ body: 'x'.repeat(100) });
    assert.fail();
  } catch (e) {
    assert.equal(e.code, 'QUOTA_EXCEEDED');
    assert.equal(e.cause.name, 'QuotaExceededError');
  }
});

test('書き込み失敗の分類 (名前・code・その他)', () => {
  const mk = (err) => {
    const storage = createMemoryStorage();
    storage.setItem = () => { throw err; };
    return createNotesStore(storage, { now: () => 1, genId: () => 'x' });
  };
  assert.throws(() => mk(Object.assign(new Error(), { name: 'NS_ERROR_DOM_QUOTA_REACHED' })).create(), code('QUOTA_EXCEEDED'));
  assert.throws(() => mk(Object.assign(new Error(), { code: 22 })).create(), code('QUOTA_EXCEEDED'));
  assert.throws(() => mk(Object.assign(new Error(), { code: 1014 })).create(), code('QUOTA_EXCEEDED'));
  assert.throws(() => mk(Object.assign(new Error(), { name: 'SecurityError' })).create(), code('STORAGE_UNAVAILABLE'));
  assert.throws(() => mk('str').create(), code('STORAGE_UNAVAILABLE'));
});

test('書き込み失敗時の remove 巻き戻し', () => {
  const storage = createMemoryStorage();
  const store = createNotesStore(storage, { now: () => 1, genId: () => 'x' });
  store.create({ body: 'a' });
  storage.setItem = () => { throw Object.assign(new Error(), { name: 'SecurityError' }); };
  assert.throws(() => store.remove('x'), code('STORAGE_UNAVAILABLE'));
  assert.equal(store.list().length, 1);
});

test('復元: 保存済みデータを読み込む', () => {
  const a = setup();
  a.store.create({ body: '# one #t' });
  const b = createNotesStore(createMemoryStorage(a.storage.dump()));
  assert.deepEqual(b.list(), a.store.list());
  assert.deepEqual(b.getLoadInfo(), { recovered: false, reason: null });
});

test('起動: 空なら何も書かない', () => {
  const { storage, store } = setup();
  assert.deepEqual(storage.dump(), {});
  assert.deepEqual(store.getLoadInfo(), { recovered: false, reason: null });
  assert.deepEqual(store.list(), []);
});

test('壊れたデータ: JSON が不正 → 退避して空で起動', () => {
  const { storage, store } = setup({ initial: { [STORAGE_KEY]: '{oops' } });
  assert.deepEqual(store.getLoadInfo(), { recovered: true, reason: 'invalid-json' });
  assert.equal(storage.getItem(CORRUPT_KEY), '{oops');
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.deepEqual(store.list(), []);
  store.create({ body: 'ok' });
  assert.equal(storage.getItem(CORRUPT_KEY), '{oops');
});

test('壊れたデータ: スキーマ不正・将来バージョン', () => {
  for (const raw of [
    JSON.stringify({ version: 2, notes: [] }),
    JSON.stringify({ version: 1, notes: [{ id: 'a' }] }),
    JSON.stringify([1, 2]),
    'null',
  ]) {
    const { storage, store } = setup({ initial: { [STORAGE_KEY]: raw } });
    assert.deepEqual(store.getLoadInfo(), { recovered: true, reason: 'invalid-schema' }, raw);
    assert.equal(storage.getItem(CORRUPT_KEY), raw);
    assert.equal(storage.getItem(STORAGE_KEY), null);
  }
});

test('壊れたデータ: 新しい破損で退避キーを上書き', () => {
  const { storage } = setup({ initial: { [STORAGE_KEY]: 'bad2', [CORRUPT_KEY]: 'bad1' } });
  assert.equal(storage.getItem(CORRUPT_KEY), 'bad2');
});

test('壊れたデータ: 退避・削除に失敗しても例外を投げない', () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: '{' });
  storage.setItem = () => { throw new Error('x'); };
  storage.removeItem = () => { throw new Error('y'); };
  const store = createNotesStore(storage);
  assert.equal(store.getLoadInfo().reason, 'invalid-json');
});

test('getItem が例外 → unavailable', () => {
  const storage = createMemoryStorage();
  storage.getItem = () => { throw Object.assign(new Error(), { name: 'SecurityError' }); };
  const store = createNotesStore(storage);
  assert.deepEqual(store.getLoadInfo(), { recovered: true, reason: 'unavailable' });
  assert.deepEqual(store.list(), []);
});

test('起動時の保存データ内の id 重複は新しいほうを残す', () => {
  const { store } = setup({ initial: { [STORAGE_KEY]: fileOf([rawNote('a', 'old', 1), rawNote('a', 'new', 2)]) } });
  assert.equal(store.get('a').body, 'new');
  assert.equal(store.list().length, 1);
});

test('export → import の往復', () => {
  const a = setup();
  a.store.create({ body: '# one #t' });
  a.clock.t++;
  a.store.create({ body: 'two' });
  const json = JSON.stringify(a.store.exportAll());
  const b = setup();
  const r = b.store.importAll(json, { mode: 'replace' });
  assert.deepEqual(r, { mode: 'replace', added: 2, updated: 0, skipped: 0, total: 2 });
  assert.deepEqual(b.store.list(), a.store.list());
  assert.deepEqual(stored(b.storage).notes.length, 2);
  const c = setup();
  assert.deepEqual(c.store.importAll(json, { mode: 'merge' }), { mode: 'merge', added: 2, updated: 0, skipped: 0, total: 2 });
});

test('import: title/tags はファイルの値を使わず再計算', () => {
  const { store } = setup();
  store.importAll(fileOf([{ id: 'a', title: 'evil', body: '# real #x', tags: ['fake'], createdAt: 1, updatedAt: 1, extra: 1 }]), { mode: 'merge' });
  assert.deepEqual(store.get('a'), { id: 'a', title: 'real #x', body: '# real #x', tags: ['x'], createdAt: 1, updatedAt: 1 });
});

test('import merge: 追加・更新(厳密に新しい)・スキップ', () => {
  const { store } = setup({ initial: { [STORAGE_KEY]: fileOf([rawNote('a', 'A0', 10), rawNote('b', 'B0', 10), rawNote('c', 'C0', 10)]) } });
  const r = store.importAll(fileOf([rawNote('a', 'A1', 11), rawNote('b', 'B1', 10), rawNote('c', 'C1', 9), rawNote('d', 'D1', 1)]), { mode: 'merge' });
  assert.deepEqual(r, { mode: 'merge', added: 1, updated: 1, skipped: 2, total: 4 });
  assert.equal(store.get('a').body, 'A1');
  assert.equal(store.get('b').body, 'B0');
  assert.equal(store.get('c').body, 'C0');
  assert.equal(store.get('d').body, 'D1');
});

test('import: ファイル内の id 重複は新しいほう (同値は先)', () => {
  const { store } = setup();
  const r = store.importAll(fileOf([rawNote('a', 'first', 5), rawNote('a', 'newer', 6), rawNote('b', 'x1', 3), rawNote('b', 'x2', 3)]), { mode: 'replace' });
  assert.deepEqual(r, { mode: 'replace', added: 2, updated: 0, skipped: 2, total: 2 });
  assert.equal(store.get('a').body, 'newer');
  assert.equal(store.get('b').body, 'x1');
});

test('import replace: 既存を捨てる。空ファイルなら空になる', () => {
  const { store, storage } = setup();
  store.create({ body: 'old' });
  const r = store.importAll(fileOf([]), { mode: 'replace' });
  assert.deepEqual(r, { mode: 'replace', added: 0, updated: 0, skipped: 0, total: 0 });
  assert.deepEqual(store.list(), []);
  assert.deepEqual(stored(storage).notes, []);
  store.create({ body: 'old' });
  store.importAll(fileOf([rawNote('z', 'new', 1)]), { mode: 'replace' });
  assert.deepEqual(store.list().map((n) => n.id), ['z']);
});

test('import: 不正なら何も変更しない', () => {
  const { store, storage } = setup();
  store.create({ body: 'keep' });
  const snapshot = storage.dump();
  const before = store.list();
  const bads = [
    '{bad',
    JSON.stringify({ version: 2, notes: [] }),
    fileOf([rawNote('ok', 'fine', 1), { id: 'bad id', body: 'x' }]),
    '{"version":1,"notes":[{"id":"a","title":"t","body":"b","tags":[],"createdAt":1,"updatedAt":1,"__proto__":{"polluted":1}}]}',
  ];
  for (const mode of ['merge', 'replace']) {
    for (const bad of bads) {
      assert.throws(() => store.importAll(bad, { mode }), code('VALIDATION'), bad);
      assert.deepEqual(store.list(), before);
      assert.deepEqual(storage.dump(), snapshot);
    }
  }
  assert.equal(({}).polluted, undefined);
});

test('import: mode が不正なら VALIDATION', () => {
  const { store } = setup();
  assert.throws(() => store.importAll(fileOf([]), { mode: 'x' }), code('VALIDATION'));
  assert.throws(() => store.importAll(fileOf([])), code('VALIDATION'));
  assert.throws(() => store.importAll(fileOf([]), { mode: 'MERGE' }), code('VALIDATION'));
});

test('import merge: 合計が 5,000 件を超えたら何も変更しない', () => {
  const mk = (from, n) => Array.from({ length: n }, (_, i) => rawNote(`n${from + i}`, 'x', 1));
  const { store, storage } = setup({ initial: { [STORAGE_KEY]: fileOf(mk(0, 3000)) } });
  const snapshot = storage.dump();
  assert.throws(() => store.importAll(fileOf(mk(3000, 2001)), { mode: 'merge' }), (e) => e.code === 'VALIDATION' && e.details.length > 0);
  assert.deepEqual(storage.dump(), snapshot);
  assert.equal(store.list().length, 3000);
  assert.equal(store.importAll(fileOf(mk(3000, 2000)), { mode: 'merge' }).total, 5000);
  assert.throws(() => store.create({ body: 'one more' }), code('VALIDATION'));
  assert.equal(store.list().length, 5000);
});

test('import: 保存失敗時は巻き戻す', () => {
  const { store, storage } = setup({ quotaChars: 400 });
  store.create({ body: 'a' });
  const snapshot = storage.dump();
  const big = fileOf([rawNote('big', 'x'.repeat(1000), 1)]);
  for (const mode of ['merge', 'replace']) {
    assert.throws(() => store.importAll(big, { mode }), code('QUOTA_EXCEEDED'));
    assert.equal(store.list().length, 1);
    assert.deepEqual(storage.dump(), snapshot);
  }
});

test('プロトタイプ汚染: 保存データ・インポート・本文のいずれでも起きない', () => {
  const evil = '{"version":1,"notes":[],"__proto__":{"polluted":"yes"}}';
  const { store } = setup({ initial: { [STORAGE_KEY]: evil } });
  assert.equal(store.getLoadInfo().reason, 'invalid-schema');
  store.create({ body: '#__proto__ #constructor #prototype' });
  assert.deepEqual(store.get('id1').tags, ['__proto__', 'constructor', 'prototype']);
  assert.deepEqual(store.listTags().map((t) => t.tag).sort(), ['__proto__', 'constructor', 'prototype']);
  const again = createNotesStore(createMemoryStorage(), {});
  assert.throws(() => again.importAll(evil, { mode: 'merge' }), code('VALIDATION'));
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('id が __proto__ のような名前でも動く (id 形式上は許可)', () => {
  const { store } = setup();
  store.importAll(fileOf([rawNote('__proto__', 'x', 1), rawNote('constructor', 'y', 1)]), { mode: 'merge' });
  assert.equal(store.get('__proto__').body, 'x');
  assert.equal(store.get('constructor').body, 'y');
  assert.equal(store.list().length, 2);
});
