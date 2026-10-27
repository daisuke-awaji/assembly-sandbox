import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotesStore } from '../../src/store/notes.js';
import { createMemoryStorage, createLocalStorage } from '../../src/store/storage.js';
import { extractTags, deriveTitle, normalizeTag } from '../../src/store/tags.js';
import { LIMITS, STORAGE_KEY, CORRUPT_KEY, validateNote, validateExportFile, parseExportFile } from '../../src/store/schema.js';

function mk(opts = {}, storage = createMemoryStorage({}, opts)) {
  let t = 1000;
  let n = 0;
  const store = createNotesStore(storage, { now: () => (t += 10), genId: () => `id${++n}` });
  return { store, storage };
}

const raw = (id, body = 'b', over = {}) => ({ id, title: 't', body, tags: [], createdAt: 1, updatedAt: 1, ...over });
const file = (notes, version = 1) => JSON.stringify({ version, notes });
const codeOf = (fn) => { try { fn(); } catch (e) { return e.code ?? e.name; } return null; };

// ---- 本文・件数の上限 ----
test('本文は MAX_BODY ちょうどで保存でき、1 文字超で VALIDATION', () => {
  const { store } = mk();
  const n = store.create({ body: 'a'.repeat(LIMITS.MAX_BODY) });
  assert.equal(store.get(n.id).body.length, LIMITS.MAX_BODY);
  assert.equal(codeOf(() => store.create({ body: 'a'.repeat(LIMITS.MAX_BODY + 1) })), 'VALIDATION');
  assert.equal(codeOf(() => store.update(n.id, { body: 'a'.repeat(LIMITS.MAX_BODY + 1) })), 'VALIDATION');
  assert.equal(store.get(n.id).body.length, LIMITS.MAX_BODY);
});

test('body が文字列でなければ VALIDATION', () => {
  const { store } = mk();
  const n = store.create({});
  for (const body of [null, 1, {}, [], undefined]) {
    assert.equal(codeOf(() => store.update(n.id, { body })), 'VALIDATION', String(body));
  }
  assert.equal(codeOf(() => store.update(n.id)), 'VALIDATION');
  assert.equal(codeOf(() => store.create({ body: 5 })), 'VALIDATION');
});

test('メモ 5000 件ちょうどまで作れ、5001 件目は VALIDATION で状態は変わらない', () => {
  const { store, storage } = mk();
  for (let i = 0; i < LIMITS.MAX_NOTES; i++) store.create({ body: '' });
  assert.equal(store.list().length, LIMITS.MAX_NOTES);
  const before = storage.getItem(STORAGE_KEY);
  assert.equal(codeOf(() => store.create({ body: 'x' })), 'VALIDATION');
  assert.equal(store.list().length, LIMITS.MAX_NOTES);
  assert.equal(storage.getItem(STORAGE_KEY), before);
});

test('存在しない id: update は NOT_FOUND、remove は false、get は null', () => {
  const { store } = mk();
  assert.equal(codeOf(() => store.update('nope', { body: 'x' })), 'NOT_FOUND');
  assert.equal(store.remove('nope'), false);
  assert.equal(store.get('nope'), null);
  assert.equal(store.get(undefined), null);
});

test('同じ本文での update は保存も updatedAt 更新もしない', () => {
  const { store, storage } = mk();
  const n = store.create({ body: 'x' });
  let writes = 0;
  const orig = storage.setItem.bind(storage);
  storage.setItem = (...a) => { writes++; return orig(...a); };
  const r = store.update(n.id, { body: 'x' });
  assert.equal(writes, 0);
  assert.equal(r.updatedAt, n.updatedAt);
});

test('updatedAt は時計が戻っても単調増加する', () => {
  const storage = createMemoryStorage();
  const store = createNotesStore(storage, { now: () => 500, genId: () => 'a' });
  const n = store.create({ body: '1' });
  const u1 = store.update('a', { body: '2' });
  const u2 = store.update('a', { body: '3' });
  assert.equal(n.updatedAt, 500);
  assert.equal(u1.updatedAt, 501);
  assert.equal(u2.updatedAt, 502);
});

test('返したメモを書き換えても store には影響しない', () => {
  const { store } = mk();
  const n = store.create({ body: '#a' });
  n.tags.push('hack');
  n.body = 'changed';
  const g = store.get(n.id);
  g.tags.length = 0;
  assert.deepEqual(store.get(n.id).tags, ['a']);
  assert.equal(store.get(n.id).body, '#a');
  store.list()[0].tags.push('z');
  assert.deepEqual(store.get(n.id).tags, ['a']);
  const ex = store.exportAll();
  ex.notes[0].tags.push('q');
  assert.deepEqual(store.get(n.id).tags, ['a']);
});

// ---- 保存容量 ----
test('容量ちょうどなら保存でき、1 文字超えると QUOTA_EXCEEDED で状態が巻き戻る', () => {
  // 保存サイズを測る
  const probe = createMemoryStorage();
  const p = createNotesStore(probe, { now: () => 1, genId: () => 'a' });
  p.create({ body: 'x'.repeat(100) });
  const size = probe.getItem(STORAGE_KEY).length;

  const exact = createMemoryStorage({}, { quotaChars: size });
  const s1 = createNotesStore(exact, { now: () => 1, genId: () => 'a' });
  assert.doesNotThrow(() => s1.create({ body: 'x'.repeat(100) }));

  const tight = createMemoryStorage({}, { quotaChars: size });
  const s2 = createNotesStore(tight, { now: () => 1, genId: () => 'a' });
  s2.create({ body: 'x'.repeat(100) });
  assert.equal(codeOf(() => s2.update('a', { body: 'x'.repeat(101) })), 'QUOTA_EXCEEDED');
  assert.equal(s2.get('a').body.length, 100);
  assert.equal(JSON.parse(tight.getItem(STORAGE_KEY)).notes[0].body.length, 100);
  assert.equal(s2.list().length, 1);
});

test('容量超過で remove / import も失敗し、状態は変わらない', () => {
  const storage = createMemoryStorage();
  const { store } = mk({}, storage);
  const n = store.create({ body: 'a' });
  storage.setItem = () => { throw Object.assign(new Error('q'), { name: 'QuotaExceededError' }); };
  assert.equal(codeOf(() => store.remove(n.id)), 'QUOTA_EXCEEDED');
  assert.equal(store.list().length, 1);
  assert.equal(codeOf(() => store.importAll(file([raw('z')]), { mode: 'merge' })), 'QUOTA_EXCEEDED');
  assert.equal(store.get('z'), null);
});

test('各ブラウザの容量超過の表現を QUOTA_EXCEEDED にする', () => {
  for (const err of [{ name: 'QuotaExceededError' }, { name: 'NS_ERROR_DOM_QUOTA_REACHED' }, { code: 22 }, { code: 1014 }]) {
    const storage = createMemoryStorage();
    const { store } = mk({}, storage);
    storage.setItem = () => { throw Object.assign(new Error('x'), err); };
    assert.equal(codeOf(() => store.create({ body: '' })), 'QUOTA_EXCEEDED', JSON.stringify(err));
  }
});

test('容量以外の書き込み失敗は STORAGE_UNAVAILABLE', () => {
  const storage = createMemoryStorage();
  const { store } = mk({}, storage);
  storage.setItem = () => { throw Object.assign(new Error('x'), { name: 'SecurityError' }); };
  assert.equal(codeOf(() => store.create({ body: '' })), 'STORAGE_UNAVAILABLE');
});

test('localStorage が使えない環境でも createLocalStorage は例外を投げず、使うと SecurityError', () => {
  const ls = createLocalStorage(null);
  assert.throws(() => ls.getItem('a'));
  const store = createNotesStore(ls);
  assert.deepEqual(store.getLoadInfo(), { recovered: true, reason: 'unavailable' });
  assert.equal(codeOf(() => store.create({ body: '' })), 'STORAGE_UNAVAILABLE');
});

// ---- 壊れた保存データ ----
test('壊れた保存データは種類ごとに reason が付き、生データは退避される', () => {
  const cases = [
    ['{', 'invalid-json'],
    ['', 'invalid-json'],
    ['null', 'invalid-schema'],
    ['[]', 'invalid-schema'],
    [JSON.stringify({ version: 2, notes: [] }), 'invalid-schema'],
    [JSON.stringify({ version: 1, notes: {} }), 'invalid-schema'],
    [JSON.stringify({ version: 1, notes: [raw('a/b')] }), 'invalid-schema'],
    [JSON.stringify({ version: 1, notes: [raw('a', 1)] }), 'invalid-schema'],
  ];
  for (const [data, reason] of cases) {
    const storage = createMemoryStorage({ [STORAGE_KEY]: data });
    const store = createNotesStore(storage);
    assert.deepEqual(store.getLoadInfo(), { recovered: true, reason }, data);
    assert.equal(storage.getItem(CORRUPT_KEY), data);
    assert.equal(storage.getItem(STORAGE_KEY), null);
    assert.deepEqual(store.list(), []);
  }
});

test('退避は新しい破損で上書きされる。退避に失敗しても起動できる', () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: '{', [CORRUPT_KEY]: 'old' });
  createNotesStore(storage);
  assert.equal(storage.getItem(CORRUPT_KEY), '{');

  const bad = createMemoryStorage({ [STORAGE_KEY]: '{' });
  bad.setItem = () => { throw new Error('full'); };
  const store = createNotesStore(bad);
  assert.equal(store.getLoadInfo().recovered, true);
  assert.deepEqual(store.list(), []);
});

test('保存データの id 重複は updatedAt が新しいほうが残る', () => {
  const data = JSON.stringify({ version: 1, notes: [raw('a', 'old', { updatedAt: 1 }), raw('a', 'new', { updatedAt: 9 }), raw('b')] });
  const store = createNotesStore(createMemoryStorage({ [STORAGE_KEY]: data }));
  assert.equal(store.list().length, 2);
  assert.equal(store.get('a').body, 'new');
  assert.equal(store.getLoadInfo().recovered, false);
});

test('保存データのタイトル・タグは本文から再導出される (改ざんされた title を信用しない)', () => {
  const data = JSON.stringify({ version: 1, notes: [raw('a', '# Real #tag', { title: 'Fake', tags: ['fake'] })] });
  const store = createNotesStore(createMemoryStorage({ [STORAGE_KEY]: data }));
  assert.equal(store.get('a').title, 'Real #tag');
  assert.deepEqual(store.get('a').tags, ['tag']);
});

// ---- 検索 ----
test('検索: 大文字小文字・全角英字・前後の空白・タイトルと本文の両方', () => {
  const { store } = mk();
  store.create({ body: '# Hello World' });
  store.create({ body: 'plain TEXT with Ünïcode' });
  store.create({ body: 'ＡＢＣ' });
  const q = (query) => store.list({ query }).length;
  assert.equal(q('hello'), 1);
  assert.equal(q('HELLO'), 1);
  assert.equal(q('  hello  '), 1);
  assert.equal(q('text'), 1);
  assert.equal(q('ünïcode'), 1);
  assert.equal(q('ÜNÏCODE'), 1);
  assert.equal(q('ａｂｃ'), 1);
  assert.equal(q(''), 3);
  assert.equal(q('   '), 3);
  assert.equal(q('nomatch'), 0);
  assert.equal(store.list().length, 3);
  assert.equal(store.list({ query: undefined }).length, 3);
});

test('検索: 正規表現の特殊文字はそのまま文字として検索される', () => {
  const { store } = mk();
  store.create({ body: 'a.c (x) [y] *z* $^' });
  store.create({ body: 'abc' });
  for (const [query, expected] of [['a.c', 1], ['(x)', 1], ['[y]', 1], ['*z*', 1], ['$^', 1], ['\\', 0]]) {
    assert.equal(store.list({ query }).length, expected, query);
  }
});

test('タグ絞り込み: # の有無・大文字小文字・空白に関係なく同じ、未知タグは 0 件', () => {
  const { store } = mk();
  store.create({ body: 'x #Work' });
  store.create({ body: 'y #home' });
  for (const tag of ['work', '#work', 'WORK', '#Work', '# work']) assert.equal(store.list({ tag }).length, 1, tag);
  assert.equal(store.list({ tag: 'none' }).length, 0);
  assert.equal(store.list({ tag: '' }).length, 2);
  assert.equal(store.list({ tag: null }).length, 2);
  assert.equal(store.list({ tag: 'work', query: 'y' }).length, 0);
  assert.equal(store.list({ tag: 'work', query: 'X' }).length, 1);
});

test('list の並びは updatedAt 降順 → createdAt 降順 → id 昇順', () => {
  const storage = createMemoryStorage({
    [STORAGE_KEY]: JSON.stringify({ version: 1, notes: [
      raw('c', 'c', { updatedAt: 5, createdAt: 1 }),
      raw('b', 'b', { updatedAt: 5, createdAt: 1 }),
      raw('a', 'a', { updatedAt: 5, createdAt: 2 }),
      raw('d', 'd', { updatedAt: 9, createdAt: 0 }),
    ] }),
  });
  const store = createNotesStore(storage);
  assert.deepEqual(store.list().map((n) => n.id), ['d', 'a', 'b', 'c']);
});

test('listTags: 件数降順 → 名前昇順。メモの削除・更新に追随する', () => {
  const { store } = mk();
  const a = store.create({ body: '#b #a' });
  store.create({ body: '#b #c' });
  assert.deepEqual(store.listTags(), [{ tag: 'b', count: 2 }, { tag: 'a', count: 1 }, { tag: 'c', count: 1 }]);
  store.update(a.id, { body: '#z' });
  assert.deepEqual(store.listTags(), [{ tag: 'b', count: 1 }, { tag: 'c', count: 1 }, { tag: 'z', count: 1 }]);
  store.remove(a.id);
  assert.deepEqual(store.listTags(), [{ tag: 'b', count: 1 }, { tag: 'c', count: 1 }]);
});

// ---- import 異常系 ----
test('import: mode が不正 / 欠落なら VALIDATION', () => {
  const { store } = mk();
  for (const opts of [undefined, {}, { mode: 'x' }, { mode: 'MERGE' }, { mode: null }]) {
    assert.equal(codeOf(() => store.importAll(file([]), opts)), 'VALIDATION', JSON.stringify(opts));
  }
});

test('import: JSON として読めない / 型が違う / 最上位が違う', () => {
  const { store } = mk();
  for (const text of ['', '{', 'null', '1', '"s"', '[]', 'true', '{"version":1}', '{"notes":[]}', '{"version":"1","notes":[]}', '{"version":1,"notes":null}', '{"version":1.5,"notes":[]}']) {
    assert.equal(codeOf(() => store.importAll(text, { mode: 'merge' })), 'VALIDATION', text);
  }
  for (const v of [undefined, null, 1, {}, []]) assert.equal(codeOf(() => store.importAll(v, { mode: 'merge' })), 'VALIDATION');
});

test('import: 失敗したら既存データは一切変わらない (replace でも)', () => {
  const { store, storage } = mk();
  store.create({ body: 'keep' });
  const before = storage.getItem(STORAGE_KEY);
  const bad = file([raw('ok'), raw('bad id!')]);
  assert.equal(codeOf(() => store.importAll(bad, { mode: 'replace' })), 'VALIDATION');
  assert.equal(storage.getItem(STORAGE_KEY), before);
  assert.equal(store.list().length, 1);
});

test('import: 禁止キー (__proto__ / constructor / prototype) は拒否', () => {
  const { store } = mk();
  const texts = [
    '{"version":1,"notes":[],"__proto__":{"x":1}}',
    '{"version":1,"notes":[{"id":"a","title":"","body":"","tags":[],"createdAt":1,"updatedAt":1,"__proto__":{"x":1}}]}',
    '{"version":1,"notes":[{"id":"a","title":"","body":"","tags":[],"createdAt":1,"updatedAt":1,"constructor":{}}]}',
    '{"version":1,"notes":[{"id":"a","title":"","body":"","tags":[],"createdAt":1,"updatedAt":1,"x":{"prototype":1}}]}',
  ];
  for (const t of texts) assert.equal(codeOf(() => store.importAll(t, { mode: 'merge' })), 'VALIDATION', t);
  assert.equal({}.x, undefined);
});

test('import: 未知のキーは捨てられる', () => {
  const { store } = mk();
  store.importAll(file([{ ...raw('a'), extra: 'x', evil: { a: 1 } }]), { mode: 'merge' });
  assert.deepEqual(Object.keys(store.get('a')).sort(), ['body', 'createdAt', 'id', 'tags', 'title', 'updatedAt']);
});

test('import: 各フィールドの境界 (id 長さ・文字種、時刻、タグ数・長さ、本文長)', () => {
  const ok = (n) => validateNote(n);
  const ng = (n) => assert.equal(codeOf(() => validateNote(n)), 'VALIDATION', JSON.stringify(n).slice(0, 80));
  ok(raw('a'.repeat(100)));
  ng(raw('a'.repeat(101)));
  ng(raw(''));
  ng(raw('a b'));
  ng(raw('日本'));
  ng(raw('a.b'));
  ok(raw('A_b-9'));
  ng(raw(1));
  ok(raw('a', 'b', { createdAt: 0, updatedAt: 0 }));
  ng(raw('a', 'b', { createdAt: -1 }));
  ng(raw('a', 'b', { updatedAt: 1.5 }));
  ng(raw('a', 'b', { updatedAt: NaN }));
  ng(raw('a', 'b', { updatedAt: Number.MAX_SAFE_INTEGER + 1 }));
  ng(raw('a', 'b', { updatedAt: '1' }));
  ng(raw('a', 'b', { updatedAt: Number.MAX_SAFE_INTEGER }));
  ng(raw('a', 'b', { createdAt: 8.64e15 + 2 }));
  ok(raw('a', 'b', { updatedAt: 8.64e15 }));
  ok(raw('a', 'b', { title: 'x'.repeat(200) }));
  ng(raw('a', 'b', { title: 'x'.repeat(201) }));
  ok(raw('a', 'x'.repeat(LIMITS.MAX_BODY)));
  ng(raw('a', 'x'.repeat(LIMITS.MAX_BODY + 1)));
  ok(raw('a', 'b', { tags: Array.from({ length: 50 }, (_, i) => `t${i}`) }));
  ng(raw('a', 'b', { tags: Array.from({ length: 51 }, (_, i) => `t${i}`) }));
  ok(raw('a', 'b', { tags: ['x'.repeat(50)] }));
  ng(raw('a', 'b', { tags: ['x'.repeat(51)] }));
  ng(raw('a', 'b', { tags: [1] }));
  ng(raw('a', 'b', { tags: 'x' }));
  ng(null);
  ng([]);
  ng('s');
  assert.equal(codeOf(() => validateNote(undefined)), 'VALIDATION');
});

test('import: 検証エラーの details は最大 20 件で、パスを含む', () => {
  const notes = Array.from({ length: 50 }, (_, i) => raw(`id${i}`, 'b', { updatedAt: -1 }));
  try {
    validateExportFile({ version: 1, notes });
    assert.fail('should throw');
  } catch (e) {
    assert.equal(e.code, 'VALIDATION');
    assert.ok(e.details.length <= 20 && e.details.length > 0);
    assert.match(e.details[0], /notes\[0\]\.updatedAt/);
  }
});

test('import: 件数は 5000 件ちょうどまで、5001 件は VALIDATION', () => {
  const mkNotes = (n) => Array.from({ length: n }, (_, i) => raw(`n${i}`, '', { updatedAt: i }));
  const { store } = mk();
  const r = store.importAll(file(mkNotes(LIMITS.MAX_NOTES)), { mode: 'replace' });
  assert.equal(r.total, LIMITS.MAX_NOTES);
  assert.equal(codeOf(() => parseExportFile(file(mkNotes(LIMITS.MAX_NOTES + 1)))), 'VALIDATION');
});

test('import: merge で既存と合わせて 5001 件になるなら VALIDATION で何も変えない', () => {
  const { store } = mk();
  const base = Array.from({ length: LIMITS.MAX_NOTES }, (_, i) => raw(`n${i}`, '', { updatedAt: i }));
  store.importAll(file(base), { mode: 'replace' });
  assert.equal(codeOf(() => store.importAll(file([raw('extra')]), { mode: 'merge' })), 'VALIDATION');
  assert.equal(store.list().length, LIMITS.MAX_NOTES);
  assert.equal(store.get('extra'), null);
  // 既存 id の更新だけなら上限ちょうどでも通る
  const r = store.importAll(file([raw('n0', 'new', { updatedAt: 99999 })]), { mode: 'merge' });
  assert.equal(r.total, LIMITS.MAX_NOTES);
  assert.equal(r.updated, 1);
});

test('import: 文字数上限 20,000,000 ちょうどは検証に進み、超えると大きすぎる', () => {
  const pad = ' '.repeat(LIMITS.MAX_IMPORT_CHARS - file([]).length);
  const exact = file([]) + pad;
  assert.equal(exact.length, LIMITS.MAX_IMPORT_CHARS);
  assert.deepEqual(parseExportFile(exact), { version: 1, notes: [] });
  assert.throws(() => parseExportFile(exact + ' '), (e) => e.code === 'VALIDATION' && /大きすぎ/.test(e.message));
});

test('import merge: updatedAt が同じなら既存を残し skipped、新しければ updated', () => {
  const { store } = mk();
  store.importAll(file([raw('a', 'v1', { updatedAt: 10 })]), { mode: 'merge' });
  let r = store.importAll(file([raw('a', 'same', { updatedAt: 10 })]), { mode: 'merge' });
  assert.deepEqual(r, { mode: 'merge', added: 0, updated: 0, skipped: 1, total: 1 });
  assert.equal(store.get('a').body, 'v1');
  r = store.importAll(file([raw('a', 'older', { updatedAt: 9 })]), { mode: 'merge' });
  assert.equal(r.skipped, 1);
  r = store.importAll(file([raw('a', 'v2', { updatedAt: 11 })]), { mode: 'merge' });
  assert.deepEqual(r, { mode: 'merge', added: 0, updated: 1, skipped: 0, total: 1 });
  assert.equal(store.get('a').body, 'v2');
});

test('import: ファイル内の id 重複は新しいほうが残り、捨てた分は skipped に数える', () => {
  const { store } = mk();
  const r = store.importAll(file([raw('a', 'old', { updatedAt: 1 }), raw('a', 'new', { updatedAt: 2 }), raw('a', 'older', { updatedAt: 0 })]), { mode: 'replace' });
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 2);
  assert.equal(store.get('a').body, 'new');
});

test('import replace: 空配列で全削除でき、書き出し→読み込みで往復できる', () => {
  const { store } = mk();
  store.create({ body: '# A #x' });
  store.create({ body: '# B' });
  const exported = JSON.stringify(store.exportAll());
  store.importAll(file([]), { mode: 'replace' });
  assert.equal(store.list().length, 0);
  const r = store.importAll(exported, { mode: 'merge' });
  assert.equal(r.added, 2);
  assert.deepEqual(store.listTags(), [{ tag: 'x', count: 1 }]);
  assert.deepEqual(JSON.parse(exported), store.exportAll());
});

test('import: 取り込んだメモの title / tags は本文から導出し直される', () => {
  const { store } = mk();
  store.importAll(file([raw('a', '# T #real', { title: 'Fake', tags: ['fake'] })]), { mode: 'merge' });
  assert.equal(store.get('a').title, 'T #real');
  assert.deepEqual(store.get('a').tags, ['real']);
});

// ---- tags.js 境界 ----
test('extractTags: 開始位置の条件', () => {
  assert.deepEqual(extractTags('#a'), ['a']);
  assert.deepEqual(extractTags('x #a'), ['a']);
  assert.deepEqual(extractTags('x\t#a'), ['a']);
  assert.deepEqual(extractTags('x#a'), []);
  assert.deepEqual(extractTags('# a'), []);
  assert.deepEqual(extractTags('#'), []);
  assert.deepEqual(extractTags('##a'), []);
  assert.deepEqual(extractTags('(#a)'), []);
  assert.deepEqual(extractTags('line1\n#a'), ['a']);
  assert.deepEqual(extractTags('a\r\n#b\r#c'), ['b', 'c']);
});

test('extractTags: 文字種・大文字小文字・重複・順序', () => {
  assert.deepEqual(extractTags('#日本語 #Ünï #a_b #a-b #1 #_'), ['日本語', 'ünï', 'a_b', 'a-b', '1', '_']);
  assert.deepEqual(extractTags('#A #a #A'), ['a']);
  assert.deepEqual(extractTags('#b #a'), ['b', 'a']);
  assert.deepEqual(extractTags('#a,#b #c.d'), ['a', 'c']);
  assert.deepEqual(extractTags('#a!'), ['a']);
  assert.deepEqual(extractTags('#😀'), []);
});

test('extractTags: 長さは 50 文字ちょうどまで。51 文字以上は丸ごと無視', () => {
  assert.deepEqual(extractTags('#' + 'a'.repeat(50)), ['a'.repeat(50)]);
  assert.deepEqual(extractTags('#' + 'a'.repeat(51)), []);
  assert.deepEqual(extractTags('#' + 'a'.repeat(51) + ' #ok'), ['ok']);
});

test('extractTags: 最大 50 個で打ち切る', () => {
  const body = Array.from({ length: 80 }, (_, i) => `#t${i}`).join(' ');
  const tags = extractTags(body);
  assert.equal(tags.length, 50);
  assert.equal(tags[0], 't0');
  assert.equal(tags[49], 't49');
  const dup = Array.from({ length: 80 }, () => '#same').join(' ');
  assert.deepEqual(extractTags(dup), ['same']);
});

test('extractTags: コードブロックとインラインコードの中は無視', () => {
  assert.deepEqual(extractTags('```\n#a\n```\n#b'), ['b']);
  assert.deepEqual(extractTags('```\n#a'), []);
  assert.deepEqual(extractTags('````\n```\n#a\n````\n#b'), ['b']);
  assert.deepEqual(extractTags('```js\n#a\n```\n#b'), ['b']);
  assert.deepEqual(extractTags('`#a` #b'), ['b']);
  assert.deepEqual(extractTags('``#a`b`` #c'), ['c']);
  assert.deepEqual(extractTags('`#a #b'), ['b']); // 閉じのない ` は文字。直前が空白でない #a はタグでない
  assert.deepEqual(extractTags('`a` #b `c`'), ['b']);
  assert.deepEqual(extractTags('   ```\n#a\n   ```\n#b'), ['b']);
  assert.deepEqual(extractTags('    ```\n#a'), ['a']);
});

test('extractTags: 空・巨大入力でも例外なし', () => {
  assert.deepEqual(extractTags(''), []);
  const t0 = performance.now();
  extractTags('`'.repeat(100000));
  extractTags('# '.repeat(50000));
  extractTags('#a '.repeat(50000));
  assert.ok(performance.now() - t0 < 1000);
});

test('deriveTitle: 見出し優先・コードブロック内は無視・200 文字で切り詰め・無題', () => {
  assert.equal(deriveTitle(''), '無題');
  assert.equal(deriveTitle('   \n\t\n'), '無題');
  assert.equal(deriveTitle('plain\n# H'), 'H');
  assert.equal(deriveTitle('  plain  '), 'plain');
  assert.equal(deriveTitle('```\n# in\n```\n# out'), 'out');
  assert.equal(deriveTitle('```\n# in\n```\ntext'), 'text');
  assert.equal(deriveTitle('# ' + 'a'.repeat(300)).length, 200);
  assert.equal(deriveTitle('a'.repeat(300)).length, 200);
  assert.equal(deriveTitle('# T ##'), 'T');
  assert.equal(deriveTitle('# T#'), 'T#');
  assert.equal(deriveTitle('###### six'), 'six');
  assert.equal(deriveTitle('####### seven'), '####### seven');
  assert.equal(deriveTitle('#tag'), '#tag');
  assert.equal(deriveTitle('    # indented\nnext'), '# indented');
  assert.equal(deriveTitle('# \nsecond'), '#'); // 中身が空の見出しは候補から外れ、最初の非空行 (trim 済み)
  assert.equal(deriveTitle('#\t tab'), 'tab');
});

test('normalizeTag', () => {
  assert.equal(normalizeTag('#Tag'), 'tag');
  assert.equal(normalizeTag('Tag  '), 'tag');
  assert.equal(normalizeTag('  #Tag  '), '#tag'); // 先頭の # を外すのが trim より先 (仕様の順序)
  assert.equal(normalizeTag('##a'), '#a');
  assert.equal(normalizeTag(''), '');
  assert.equal(normalizeTag('# a'), 'a');
});

// ---- storage.js ----
test('createMemoryStorage: 容量は全キーの値の合計で数える。上書きは差分のみ', () => {
  const s = createMemoryStorage({}, { quotaChars: 10 });
  s.setItem('a', '12345');
  s.setItem('b', '12345');
  assert.throws(() => s.setItem('c', '1'));
  s.setItem('a', '1');
  s.setItem('c', '1234');
  assert.equal(s.getItem('a'), '1');
  s.removeItem('zzz');
  assert.equal(s.getItem('zzz'), null);
  assert.deepEqual(s.dump(), { a: '1', b: '12345', c: '1234' });
});

test('deriveTitle: 見出しが無いときの最初の行はフェンスを飛ばし、リスト・引用・チェックボックス記号を除く', () => {
  assert.equal(deriveTitle('```js\ncode\n```\nplain'), 'plain');
  assert.equal(deriveTitle('```js\nonly code'), '無題');
  assert.equal(deriveTitle('- item'), 'item');
  assert.equal(deriveTitle('* item'), 'item');
  assert.equal(deriveTitle('+ item'), 'item');
  assert.equal(deriveTitle('1. item'), 'item');
  assert.equal(deriveTitle('> quote'), 'quote');
  assert.equal(deriveTitle('- [ ] task'), 'task');
  assert.equal(deriveTitle('- [x] done'), 'done');
  assert.equal(deriveTitle('[ ] task'), 'task');
  assert.equal(deriveTitle('-\n- [ ]\n> \nreal'), 'real');
  assert.equal(deriveTitle('-\n>'), '無題');
});

test('validateNote: 日時は 0 以上 8.64e15 以下の整数のみ', () => {
  const mk = (t) => ({ id: 'a', title: 'x', body: 'x', tags: [], createdAt: t, updatedAt: t });
  assert.equal(validateNote(mk(8.64e15)).updatedAt, 8.64e15);
  for (const t of [8.64e15 + 2, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => validateNote(mk(t)), { code: 'VALIDATION' });
  }
});
