import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, STORAGE_KEY, CORRUPT_KEY, SCHEMA_VERSION, ERROR_CODES, StoreError,
  validateNote, validateExportFile, parseExportFile,
} from '../../src/store/schema.js';

const good = (over = {}) => ({ id: 'a1', title: 't', body: '# hi #x', tags: [], createdAt: 1, updatedAt: 2, ...over });
const isValidation = (e) => e instanceof StoreError && e.code === 'VALIDATION';

test('定数', () => {
  assert.equal(STORAGE_KEY, 'mdmemo:v1:notes');
  assert.equal(CORRUPT_KEY, 'mdmemo:v1:corrupt');
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(LIMITS.MAX_BODY, 1048576);
  assert.ok(Object.isFrozen(LIMITS));
  assert.equal(ERROR_CODES.NOT_FOUND, 'NOT_FOUND');
});

test('StoreError の形', () => {
  const cause = new Error('c');
  const e = new StoreError('QUOTA_EXCEEDED', 'm', { cause });
  assert.equal(e.name, 'StoreError');
  assert.equal(e.code, 'QUOTA_EXCEEDED');
  assert.deepEqual(e.details, []);
  assert.equal(e.cause, cause);
  assert.ok(e instanceof Error);
  assert.equal(new StoreError('VALIDATION', 'm', { details: Array(30).fill('x') }).details.length, 20);
});

test('validateNote: 正常系は title/tags を再計算し、新しいオブジェクトを返す', () => {
  const input = good({ title: 'evil', tags: ['zzz'] });
  const n = validateNote(input);
  assert.deepEqual(n, { id: 'a1', title: 'hi #x', body: '# hi #x', tags: ['x'], createdAt: 1, updatedAt: 2 });
  assert.notEqual(n, input);
});

test('validateNote: 知らないキーは捨てる', () => {
  const n = validateNote(good({ extra: 1, nested: { a: 1 } }));
  assert.deepEqual(Object.keys(n), ['id', 'title', 'body', 'tags', 'createdAt', 'updatedAt']);
});

for (const key of ['id', 'title', 'body', 'tags', 'createdAt', 'updatedAt']) {
  test(`validateNote: 必須キー ${key} 欠落`, () => {
    const v = good();
    delete v[key];
    assert.throws(() => validateNote(v), isValidation);
  });
}

test('validateNote: 型違反', () => {
  const bad = [
    null, 'x', 1, [], undefined,
    good({ id: 1 }), good({ title: 1 }), good({ body: null }), good({ tags: 'a' }),
    good({ tags: [1] }), good({ createdAt: '1' }), good({ updatedAt: 1.5 }),
    good({ createdAt: -1 }), good({ updatedAt: NaN }), good({ updatedAt: Infinity }),
    good({ createdAt: Number.MAX_SAFE_INTEGER + 1 }),
  ];
  for (const v of bad) assert.throws(() => validateNote(v), isValidation, JSON.stringify(v));
});

test('validateNote: id の形式', () => {
  for (const id of ['', 'a b', 'a/b', '日本', 'x'.repeat(101), '<s>']) {
    assert.throws(() => validateNote(good({ id })), isValidation, id);
  }
  validateNote(good({ id: 'x'.repeat(100) }));
  validateNote(good({ id: 'A-b_9' }));
});

test('validateNote: title の上限は 200 (境界)、超過はエラー', () => {
  validateNote(good({ title: 'a'.repeat(200) }));
  assert.throws(() => validateNote(good({ title: 'a'.repeat(201) })), isValidation);
});

test('validateNote: body の上限は 1,048,576 (境界)', () => {
  validateNote(good({ body: 'a'.repeat(1048576) }));
  assert.throws(() => validateNote(good({ body: 'a'.repeat(1048577) })), isValidation);
  validateNote(good({ body: '' }));
});

test('validateNote: tags の個数・長さ', () => {
  validateNote(good({ tags: Array(50).fill('a') }));
  assert.throws(() => validateNote(good({ tags: Array(51).fill('a') })), isValidation);
  validateNote(good({ tags: ['a'.repeat(50)] }));
  assert.throws(() => validateNote(good({ tags: ['a'.repeat(51)] })), isValidation);
});

test('validateNote: 禁止キーは JSON.parse 経由でも拒否 (どの階層でも)', () => {
  const texts = [
    '{"id":"a","title":"t","body":"b","tags":[],"createdAt":1,"updatedAt":1,"__proto__":{"x":1}}',
    '{"id":"a","title":"t","body":"b","tags":[],"createdAt":1,"updatedAt":1,"constructor":1}',
    '{"id":"a","title":"t","body":"b","tags":[],"createdAt":1,"updatedAt":1,"prototype":1}',
    '{"id":"a","title":"t","body":"b","tags":[],"createdAt":1,"updatedAt":1,"x":{"y":[{"__proto__":1}]}}',
  ];
  for (const t of texts) assert.throws(() => validateNote(JSON.parse(t)), isValidation, t);
  assert.equal(({}).polluted, undefined);
});

test('validateNote: path が details に入る', () => {
  try {
    validateNote(good({ title: 'a'.repeat(201) }), 'notes[3]');
    assert.fail();
  } catch (e) {
    assert.deepEqual(e.details, ['notes[3].title: 200 文字を超えています']);
  }
});

test('validateNote: 継承されたプロパティは値として使わない', () => {
  const proto = good();
  const v = Object.create(proto);
  assert.throws(() => validateNote(v), isValidation);
});

test('validateExportFile: 正常系', () => {
  const f = validateExportFile({ version: 1, notes: [good(), good({ id: 'a1' })], junk: 1 });
  assert.deepEqual(Object.keys(f), ['version', 'notes']);
  assert.equal(f.notes.length, 2);
});

test('validateExportFile: 最上位の不正', () => {
  for (const v of [null, [], 'x', {}, { version: 2, notes: [] }, { version: '1', notes: [] },
    { version: 1 }, { version: 1, notes: {} }]) {
    assert.throws(() => validateExportFile(v), isValidation, JSON.stringify(v));
  }
  assert.throws(() => validateExportFile(JSON.parse('{"version":1,"notes":[],"__proto__":{}}')), isValidation);
  assert.throws(() => validateExportFile(JSON.parse('{"version":1,"notes":[],"a":{"constructor":1}}')), isValidation);
});

test('validateExportFile: 5,000 件は可、5,001 件は不可', () => {
  const mk = (n) => ({ version: 1, notes: Array.from({ length: n }, (_, i) => good({ id: `n${i}` })) });
  assert.equal(validateExportFile(mk(5000)).notes.length, 5000);
  assert.throws(() => validateExportFile(mk(5001)), isValidation);
});

test('validateExportFile: id の重複は検査しない', () => {
  assert.equal(validateExportFile({ version: 1, notes: [good(), good()] }).notes.length, 2);
});

test('validateExportFile: details は "notes[i].field: ..." 形式で最大 20 件', () => {
  const notes = Array.from({ length: 50 }, () => good({ title: 'a'.repeat(201) }));
  try {
    validateExportFile({ version: 1, notes });
    assert.fail();
  } catch (e) {
    assert.equal(e.name, 'StoreError');
    assert.equal(e.details.length, 20);
    assert.equal(e.details[0], 'notes[0].title: 200 文字を超えています');
    assert.equal(e.details[19], 'notes[19].title: 200 文字を超えています');
  }
  try {
    validateExportFile({ version: 1, notes: [good(), good({ createdAt: 'x' })] });
    assert.fail();
  } catch (e) {
    assert.match(e.details[0], /^notes\[1\]\.createdAt: /);
  }
});

test('parseExportFile: 正常・不正 JSON・長さ超過・非文字列', () => {
  assert.equal(parseExportFile(JSON.stringify({ version: 1, notes: [good()] })).notes[0].id, 'a1');
  assert.throws(() => parseExportFile('{bad'), isValidation);
  assert.throws(() => parseExportFile(''), isValidation);
  assert.throws(() => parseExportFile('"' + 'a'.repeat(LIMITS.MAX_IMPORT_CHARS) + '"'), isValidation);
  assert.throws(() => parseExportFile(null), isValidation);
  assert.throws(() => parseExportFile('['.repeat(200000)), isValidation);
});

test('parseExportFile: 汚染を起こさない', () => {
  const text = '{"version":1,"notes":[{"id":"a","title":"t","body":"b","tags":[],"createdAt":1,"updatedAt":1,"__proto__":{"polluted":true}}]}';
  assert.throws(() => parseExportFile(text), isValidation);
  assert.equal(({}).polluted, undefined);
});
