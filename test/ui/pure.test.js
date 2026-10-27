import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, toUiError } from '../../src/ui/app.js';
import { exportFileName } from '../../src/ui/io.js';
import { createMockStore, mockRender } from './mocks.js';

test('exportFileName は UTC の日時を使う', () => {
  assert.equal(exportFileName(Date.UTC(2026, 9, 27, 15, 30, 45)), 'mdmemo-20261027-153045.json');
  assert.equal(exportFileName(Date.UTC(2026, 0, 2, 3, 4, 5)), 'mdmemo-20260102-030405.json');
});

test('createInitialState', () => {
  assert.deepEqual(createInitialState(), {
    notes: [], tags: [], selectedId: null, draft: '', query: '', tag: null,
    view: 'edit', saveStatus: 'saved', error: null, recovered: false, statusMessage: null,
  });
});

test('toUiError は code ごとの文言にする', () => {
  const e = (code, extra) => Object.assign(new Error('msg'), { name: 'StoreError', code, details: [], ...extra });
  assert.match(toUiError(e('QUOTA_EXCEEDED')).message, /保存容量がいっぱい/);
  assert.equal(toUiError(e('NOT_FOUND')).message, 'メモが見つかりません。');
  assert.match(toUiError(e('STORAGE_UNAVAILABLE')).message, /保存領域を使えません/);
  assert.equal(toUiError(e('VALIDATION', { details: ['a', 'b', 'c', 'd'] })).message, 'msg a b c');
  assert.equal(toUiError(new Error('x')).message, '予期しないエラーが発生しました。');
  assert.equal(toUiError(null).code, 'UNKNOWN');
});

test('mockRender は escape して p で包む', () => {
  assert.equal(mockRender('<b>&"\''), '<p>&lt;b&gt;&amp;&quot;&#39;</p>');
});

test('createMockStore は NotesStore の形を満たす', () => {
  let t = 1000;
  let n = 0;
  const s = createMockStore([], { now: () => t, genId: () => `id${++n}` });
  const a = s.create({ body: '# 見出し\n#Tag #tag' });
  assert.equal(a.title, '見出し');
  assert.deepEqual(a.tags, ['tag']);
  a.body = 'mutated';
  assert.equal(s.get(a.id).body, '# 見出し\n#Tag #tag');
  t = 2000;
  const b = s.create({ body: 'second #x' });
  assert.deepEqual(s.list().map((x) => x.id), [b.id, a.id]);
  assert.deepEqual(s.list({ query: 'SECOND' }).map((x) => x.id), [b.id]);
  assert.deepEqual(s.list({ tag: '#TAG' }).map((x) => x.id), [a.id]);
  assert.deepEqual(s.list({ query: 'second', tag: 'tag' }), []);
  assert.deepEqual(s.listTags(), [{ tag: 'tag', count: 1 }, { tag: 'x', count: 1 }]);
  assert.equal(s.get('nope'), null);

  const same = s.update(a.id, { body: a.body === 'mutated' ? '# 見出し\n#Tag #tag' : '' });
  assert.equal(same.updatedAt, 1000);
  const upd = s.update(a.id, { body: 'changed' });
  assert.equal(upd.updatedAt, 2000);
  assert.equal(s.update(a.id, { body: 'again' }).updatedAt, 2001);
  assert.throws(() => s.update('nope', { body: '' }), { name: 'StoreError', code: 'NOT_FOUND' });
  assert.throws(() => s.create({ body: 1 }), { code: 'VALIDATION' });

  const exported = s.exportAll();
  assert.equal(exported.version, 1);
  assert.equal(exported.notes.length, 2);
  const s2 = createMockStore();
  const r = s2.importAll(JSON.stringify(exported), { mode: 'merge' });
  assert.deepEqual(r, { mode: 'merge', added: 2, updated: 0, skipped: 0, total: 2 });
  assert.deepEqual(s2.importAll(JSON.stringify(exported), { mode: 'merge' }).skipped, 2);
  assert.throws(() => s2.importAll('{', { mode: 'merge' }), { code: 'VALIDATION' });
  assert.throws(() => s2.importAll('{}', { mode: 'bad' }), { code: 'VALIDATION' });

  assert.equal(s.remove(a.id), true);
  assert.equal(s.remove(a.id), false);
  assert.deepEqual(s.getLoadInfo(), { recovered: false, reason: null });
});
