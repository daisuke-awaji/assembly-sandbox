// JSON 読み込み・localStorage 経由の攻撃 (XSS、プロトタイプ汚染、巨大入力、壊れたデータ)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotesStore } from '../../src/store/notes.js';
import { createMemoryStorage } from '../../src/store/storage.js';
import {
  CORRUPT_KEY, LIMITS, STORAGE_KEY, StoreError, parseExportFile, validateExportFile, validateNote,
} from '../../src/store/schema.js';
import { render } from '../../src/markdown/index.js';

const note = (over = {}) => ({
  id: 'n1', title: 't', body: 'b', tags: [], createdAt: 1, updatedAt: 2, ...over,
});
const file = (notes) => JSON.stringify({ version: 1, notes });
const newStore = (initial) => {
  let n = 0;
  return createNotesStore(createMemoryStorage(initial), { now: () => 1000, genId: () => `gen${n++}` });
};
const clean = () => {
  assert.equal(Object.prototype.polluted, undefined, 'Object.prototype が汚染された');
  assert.equal(({}).polluted, undefined);
  assert.equal(Array.prototype.polluted, undefined);
  assert.equal(Object.prototype.isAdmin, undefined);
  assert.equal(({}).toString, Object.prototype.toString);
};
const rejects = (text) => assert.throws(() => parseExportFile(text), (e) => e instanceof StoreError && e.code === 'VALIDATION');

test('プロトタイプ汚染: 最上位の __proto__ / constructor / prototype キーは拒否', () => {
  rejects('{"__proto__":{"polluted":1},"version":1,"notes":[]}');
  rejects('{"constructor":{"prototype":{"polluted":1}},"version":1,"notes":[]}');
  rejects('{"prototype":{"polluted":1},"version":1,"notes":[]}');
  clean();
});

test('プロトタイプ汚染: メモ内・tags 内・深い階層の禁止キーは拒否', () => {
  rejects(`{"version":1,"notes":[{"id":"a","title":"t","body":"b","tags":[],"createdAt":1,"updatedAt":2,"__proto__":{"polluted":1}}]}`);
  rejects(`{"version":1,"notes":[{"id":"a","title":"t","body":"b","tags":[{"__proto__":{"polluted":1}}],"createdAt":1,"updatedAt":2}]}`);
  rejects(`{"version":1,"notes":[{"id":"a","title":"t","body":"b","tags":[],"createdAt":1,"updatedAt":2,"x":{"y":[{"constructor":{"prototype":{"polluted":1}}}]}}]}`);
  rejects(`{"version":1,"notes":[{"id":"a","title":"t","body":"b","tags":[],"createdAt":1,"updatedAt":2,"constructor":1}]}`);
  clean();
});

test('プロトタイプ汚染: 取り込んだ結果のオブジェクトの prototype は Object.prototype のまま', () => {
  const store = newStore();
  store.importAll(file([note({ extra: { a: 1 } })]), { mode: 'merge' });
  const out = store.get('n1');
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(Object.keys(out).sort(), ['body', 'createdAt', 'id', 'tags', 'title', 'updatedAt']);
  clean();
});

test('プロトタイプ汚染: JSON.parse が作る own の "__proto__" を validateNote に直接渡しても拒否', () => {
  const evil = JSON.parse('{"id":"a","title":"t","body":"b","tags":[],"createdAt":1,"updatedAt":2,"__proto__":{"isAdmin":true}}');
  assert.throws(() => validateNote(evil), StoreError);
  clean();
});

test('継承プロパティ (prototype 側) の値は読まない: id / body が prototype にあるだけのオブジェクトは不正', () => {
  const proto = { id: 'a', title: 't', body: 'b', tags: [], createdAt: 1, updatedAt: 2 };
  const obj = Object.create(proto);
  assert.throws(() => validateNote(obj), StoreError);
  assert.throws(() => validateExportFile(Object.create({ version: 1, notes: [] })), StoreError);
});

test('id が "__proto__" / "constructor" / "toString" でも、汚染や取り違えは起きない', () => {
  const store = newStore();
  const ids = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  store.importAll(file(ids.map((id, i) => note({ id, body: `body ${i}`, updatedAt: 2 + i }))), { mode: 'replace' });
  for (const [i, id] of ids.entries()) assert.equal(store.get(id)?.body, `body ${i}`, id);
  assert.equal(store.list().length, ids.length);
  assert.equal(store.get('nonexistent'), null);
  assert.equal(store.remove('toString'), true);
  assert.equal(store.get('toString'), null);
  clean();
});

test('XSS: title / tags に入れたスクリプトは無視され、body から作り直される', () => {
  const store = newStore();
  store.importAll(
    file([note({ title: '<script>alert(1)</script>', body: 'plain', tags: ['<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>'] })]),
    { mode: 'replace' },
  );
  const n = store.get('n1');
  assert.equal(n.title, 'plain');
  assert.deepEqual(n.tags, []);
  assert.ok(!JSON.stringify(store.exportAll()).includes('<script'));
});

test('XSS: body から取り出したタグ・タイトルは、タグの文字種に制限される (UI は textContent で表示)', () => {
  const store = newStore();
  store.importAll(
    file([note({ body: '# <img src=x onerror=alert(1)>\n#tag<script>alert(1)</script> #ok #"><svg> #a-b_c' })]),
    { mode: 'replace' },
  );
  for (const t of store.get('n1').tags) assert.match(t, /^[\p{L}\p{N}_-]+$/u, t);
});

test('XSS: 取り込んだ body を render しても安全 (title / body の保存値はそのまま、出力側でエスケープ)', () => {
  const store = newStore();
  const body = '<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![x](data:text/html,x)';
  store.importAll(file([note({ body })]), { mode: 'replace' });
  const html = render(store.get('n1').body);
  assert.ok(!/<script|href="javascript|<img/i.test(html), html);
});

test('id に HTML・引用符・空白・パス・制御文字・長すぎる値・空文字を含むメモは拒否 (dataset.id などに入るため)', () => {
  const bad = [
    '"><script>alert(1)</script>', 'a b', 'a"b', "a'b", 'a<b', 'a/b', 'a.b', '../x', '', 'a\u0000b', 'a\nb', '\u00e9',
    'a'.repeat(LIMITS.MAX_ID_LENGTH + 1), '\u202e',
  ];
  for (const id of bad) rejects(file([note({ id })]));
  parseExportFile(file([note({ id: 'a'.repeat(LIMITS.MAX_ID_LENGTH) })]));
});

test('型の不一致 (null / 配列 / 数値 / 文字列 / 真偽値 / 関数風オブジェクト) は拒否', () => {
  for (const top of ['null', '[]', '1', '"x"', 'true', '{}', '{"version":1}', '{"version":"1","notes":[]}', '{"version":2,"notes":[]}',
    '{"version":1,"notes":{}}', '{"version":1,"notes":"x"}', '{"version":1,"notes":null}', '{"version":1.0000001,"notes":[]}']) {
    rejects(top);
  }
  const fields = {
    id: [1, null, [], {}, true],
    title: [1, null, [], {}, true],
    body: [1, null, [], {}, true, ['a']],
    tags: [null, 'a', {}, 1, [1], [null], [{}], [['a']]],
    createdAt: ['1', null, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2, [], {}, true],
    updatedAt: ['1', null, -1, 1.5, Infinity, 1e300, [], {}, true],
  };
  for (const [key, values] of Object.entries(fields)) {
    for (const v of values) {
      const text = `{"version":1,"notes":[${JSON.stringify({ ...note(), [key]: v })}]}`;
      // NaN / Infinity は JSON で null になるので、型エラーとして拒否される
      rejects(text);
    }
  }
  for (const entry of ['null', '1', '"x"', '[]', 'true']) rejects(`{"version":1,"notes":[${entry}]}`);
});

test('欠けたキー (id / body / tags / createdAt / updatedAt) は拒否', () => {
  for (const key of ['id', 'body', 'tags', 'createdAt', 'updatedAt']) {
    const n = note();
    delete n[key];
    rejects(file([n]));
  }
});

test('上限: 本文 1MB、タイトル 200 文字、タグ数・タグ長、メモ件数 5,000', () => {
  parseExportFile(file([note({ body: 'a'.repeat(LIMITS.MAX_BODY) })]));
  rejects(file([note({ body: 'a'.repeat(LIMITS.MAX_BODY + 1) })]));
  rejects(file([note({ title: 'a'.repeat(LIMITS.MAX_TITLE + 1) })]));
  rejects(file([note({ tags: Array(LIMITS.MAX_TAGS_PER_NOTE + 1).fill('a') })]));
  rejects(file([note({ tags: ['a'.repeat(LIMITS.MAX_TAG_LENGTH + 1)] })]));
  const many = (n) => file(Array.from({ length: n }, (_, i) => note({ id: `id${i}`, body: '' })));
  parseExportFile(many(LIMITS.MAX_NOTES));
  rejects(many(LIMITS.MAX_NOTES + 1));
});

test('上限: マージで合計が 5,000 件を超える取り込みは、何も変えずに拒否される', () => {
  const storage = createMemoryStorage();
  const store = createNotesStore(storage, { now: () => 1, genId: () => 'g' });
  const many = (from, n) => file(Array.from({ length: n }, (_, i) => note({ id: `id${from + i}`, body: '' })));
  store.importAll(many(0, LIMITS.MAX_NOTES), { mode: 'replace' });
  const before = storage.dump()[STORAGE_KEY];
  assert.throws(() => store.importAll(many(LIMITS.MAX_NOTES, 1), { mode: 'merge' }), StoreError);
  assert.equal(storage.dump()[STORAGE_KEY], before);
  assert.equal(store.list().length, LIMITS.MAX_NOTES);
});

test('巨大入力: 20,000,000 文字を超える文字列は JSON.parse 前に拒否される', () => {
  const t0 = performance.now();
  assert.throws(() => parseExportFile(' '.repeat(LIMITS.MAX_IMPORT_CHARS + 1)), StoreError);
  assert.ok(performance.now() - t0 < 1000);
  for (const v of [null, undefined, 1, {}, []]) assert.throws(() => parseExportFile(v), StoreError);
});

test('巨大入力: 深くネストした JSON でも例外は StoreError (スタックオーバーフローで落ちない)', () => {
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  const nestedObj = '{"a":'.repeat(50000) + '1' + '}'.repeat(50000);
  for (const text of [deep, nestedObj, `{"version":1,"notes":[{"id":"a","title":"","body":"","tags":[${deep}],"createdAt":1,"updatedAt":1}]}`]) {
    assert.throws(() => parseExportFile(text), (e) => e instanceof StoreError, 'StoreError 以外の例外');
  }
});

test('巨大入力: 5,000 件 × 約 200 文字の取り込みが 3 秒以内に終わる', () => {
  const body = 'x'.repeat(200) + '\n# h #t\n[l](javascript:1)\n';
  const text = file(Array.from({ length: LIMITS.MAX_NOTES }, (_, i) => note({ id: `id${i}`, body })));
  const store = newStore();
  const t0 = performance.now();
  store.importAll(text, { mode: 'replace' });
  store.list({ query: 'zzz' });
  store.exportAll();
  assert.ok(performance.now() - t0 < 3000, `${(performance.now() - t0).toFixed(0)}ms`);
});

test('巨大入力: 1MB の悪意ある本文を取り込んで render しても 1 秒以内', () => {
  const body = '[a]('.repeat(LIMITS.MAX_BODY / 4);
  const store = newStore();
  store.importAll(file([note({ body })]), { mode: 'replace' });
  const t0 = performance.now();
  render(store.get('n1').body);
  assert.ok(performance.now() - t0 < 1000);
});

test('重複 id: 同一ファイル内・merge・replace のいずれでも、新しい updatedAt が勝つ', () => {
  const store = newStore();
  store.importAll(file([note({ body: 'old', updatedAt: 5 }), note({ body: 'new', updatedAt: 9 }), note({ body: 'older', updatedAt: 1 })]), { mode: 'replace' });
  assert.equal(store.list().length, 1);
  assert.equal(store.get('n1').body, 'new');
  store.importAll(file([note({ body: 'stale', updatedAt: 3 })]), { mode: 'merge' });
  assert.equal(store.get('n1').body, 'new');
  store.importAll(file([note({ body: 'fresh', updatedAt: 10 })]), { mode: 'merge' });
  assert.equal(store.get('n1').body, 'fresh');
});

test('失敗した取り込みは既存のメモを変更しない (1 件でも不正なら全体を拒否)', () => {
  const storage = createMemoryStorage();
  const store = createNotesStore(storage, { now: () => 1, genId: () => 'g' });
  store.importAll(file([note({ body: 'keep' })]), { mode: 'replace' });
  const before = storage.dump()[STORAGE_KEY];
  for (const mode of ['replace', 'merge']) {
    assert.throws(() => store.importAll(file([note({ id: 'ok2' }), note({ id: '<bad>' })]), { mode }), StoreError);
    assert.throws(() => store.importAll('{broken', { mode }), StoreError);
  }
  assert.throws(() => store.importAll(file([]), { mode: '__proto__' }), StoreError);
  assert.throws(() => store.importAll(file([]), {}), StoreError);
  assert.equal(storage.dump()[STORAGE_KEY], before);
  assert.equal(store.get('n1').body, 'keep');
});

test('エラー情報 (details) は件数が制限され、入力の文字列をそのまま含まない', () => {
  const notes = Array.from({ length: 200 }, (_, i) => note({ id: `<script>${i}` }));
  try {
    parseExportFile(file(notes));
    assert.fail('拒否されるべき');
  } catch (e) {
    assert.ok(e instanceof StoreError);
    assert.ok(e.details.length <= 20, String(e.details.length));
    assert.ok(!e.details.join('\n').includes('<script>'), e.details.join('\n'));
  }
});

// ---- localStorage が壊れている・改ざんされている場合 ----

const brokenValues = {
  '空文字': '',
  '不完全な JSON': '{"version":1,"notes":[',
  'null': 'null',
  '配列': '[]',
  '数値': '123',
  '文字列': '"<script>alert(1)</script>"',
  'version 違い': '{"version":99,"notes":[]}',
  'notes が文字列': '{"version":1,"notes":"x"}',
  'notes が null': '{"version":1,"notes":null}',
  'メモが不正': '{"version":1,"notes":[{"id":1}]}',
  '__proto__ 入り': '{"version":1,"notes":[{"id":"a","title":"","body":"","tags":[],"createdAt":1,"updatedAt":1,"__proto__":{"polluted":1}}]}',
  'id が XSS': '{"version":1,"notes":[{"id":"\\"><script>alert(1)</script>","title":"","body":"","tags":[],"createdAt":1,"updatedAt":1}]}',
  'バイナリ': '\u0000\u0001\u0002\ufffd',
  '巨大': '['.repeat(200000),
};

for (const [name, raw] of Object.entries(brokenValues)) {
  test(`壊れた保存データ (${name}): 起動でき、空の状態になり、元データは退避キーへ移る`, () => {
    const storage = createMemoryStorage({ [STORAGE_KEY]: raw });
    const store = createNotesStore(storage, { now: () => 1, genId: () => 'g' });
    assert.deepEqual(store.list(), []);
    assert.equal(store.getLoadInfo().recovered, true);
    assert.equal(storage.dump()[CORRUPT_KEY], raw);
    assert.equal(storage.getItem(STORAGE_KEY), null);
    store.create({ body: 'after' }); // 復旧後は普通に保存できる
    assert.equal(store.list().length, 1);
    clean();
  });
}

test('壊れた保存データ: 退避に失敗しても (容量不足・例外) 起動できる', () => {
  const backend = {
    getItem: () => '{broken',
    setItem: () => { throw Object.assign(new Error('q'), { name: 'QuotaExceededError' }); },
    removeItem: () => { throw new Error('denied'); },
  };
  const store = createNotesStore(backend);
  assert.deepEqual(store.list(), []);
  assert.equal(store.getLoadInfo().recovered, true);
});

test('localStorage が使えない (getItem が SecurityError) でも起動できる', () => {
  const backend = {
    getItem: () => { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); },
    setItem: () => { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); },
    removeItem: () => {},
  };
  const store = createNotesStore(backend);
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.create({ body: 'x' }), (e) => e instanceof StoreError && e.code === 'STORAGE_UNAVAILABLE');
  assert.deepEqual(store.list(), [], '保存に失敗したら内部状態も変えない');
});

test('保存データの title / tags は信用されず、body から再計算される', () => {
  const raw = file([note({ title: '<script>alert(1)</script>', body: 'safe', tags: ['"><script>'] })]);
  const store = newStore({ [STORAGE_KEY]: raw });
  assert.equal(store.getLoadInfo().recovered, false);
  const n = store.get('n1');
  assert.equal(n.title, 'safe');
  assert.deepEqual(n.tags, []);
});

test('検索: 正規表現として解釈されない (ReDoS・例外にならない)', () => {
  const store = newStore();
  store.importAll(file([note({ body: 'a'.repeat(10000) + '(' })]), { mode: 'replace' });
  for (const q of ['(', '[', '*', '.*.*.*.*.*x', '(a+)+$', '\\', '(?<x>', '$^', '|||']) {
    const t0 = performance.now();
    assert.doesNotThrow(() => store.list({ query: q, tag: q }));
    assert.ok(performance.now() - t0 < 200);
  }
  assert.equal(store.list({ query: '(' }).length, 1);
  assert.equal(store.list({ query: '.' }).length, 0);
});

// ---- 脆弱性 ----

test('取り込んだメモの updatedAt / createdAt は new Date().toISOString() が例外を投げない範囲に限る',
  () => {
    const store = newStore();
    assert.throws(
      () => store.importAll(file([note({ updatedAt: Number.MAX_SAFE_INTEGER, createdAt: Number.MAX_SAFE_INTEGER })]), { mode: 'replace' }),
      { code: 'VALIDATION' },
    );
    store.importAll(file([note({ updatedAt: 8.64e15, createdAt: 8.64e15 })]), { mode: 'replace' });
    for (const n of store.list()) {
      assert.doesNotThrow(() => new Date(n.updatedAt).toISOString(), `updatedAt=${n.updatedAt}`);
      assert.doesNotThrow(() => new Date(n.createdAt).toISOString(), `createdAt=${n.createdAt}`);
    }
  });

test('壊れた日時を持つデータが localStorage にあっても、起動時に退避される (一覧が描画できない状態を残さない)',
  () => {
    const raw = file([note({ updatedAt: 9007199254740991 })]);
    const store = newStore({ [STORAGE_KEY]: raw });
    for (const n of store.list()) assert.doesNotThrow(() => new Date(n.updatedAt).toISOString());
  });
