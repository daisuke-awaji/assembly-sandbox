import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../../src/ui/app.js';
import { render } from '../../src/markdown/index.js';
import { createNotesStore } from '../../src/store/notes.js';
import { createMemoryStorage } from '../../src/store/storage.js';
import { STORAGE_KEY, CORRUPT_KEY } from '../../src/store/schema.js';
import { createFakeDocument, press, typeInto, itemTitles, clickItem, clickTag } from './dom.js';

let apps = [];
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  mock.timers.reset();
});

function setup({ storage = createMemoryStorage(), confirmAnswer = true } = {}) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
  let t = 1_000_000;
  let n = 0;
  const store = createNotesStore(storage, { now: () => (t += 1000), genId: () => `n${++n}` });
  const { doc, win, els } = createFakeDocument();
  const confirms = [];
  const app = startApp({
    document: doc, store, render,
    confirm: (m) => { confirms.push(m); return confirmAnswer; },
    now: () => Date.UTC(2026, 9, 27, 15, 30, 45),
  });
  apps.push(app);
  const tick = (ms) => mock.timers.tick(ms);
  return { storage, store, doc, win, els, app, confirms, tick };
}

const stored = (storage) => JSON.parse(storage.getItem(STORAGE_KEY));

test('起動すると空メモが 1 件でき、保存済みと表示される', () => {
  const { els, app, store } = setup();
  assert.equal(store.list().length, 1);
  assert.equal(app.getState().selectedId, 'n1');
  assert.equal(els['save-status'].textContent, '保存済み');
  assert.equal(els['error-banner'].hidden, true);
});

test('入力 → デバウンス後にプレビュー更新と自動保存', () => {
  const { els, app, tick, storage } = setup();
  typeInto(els, '# Hello\n\n**bold** #tag');
  assert.equal(els['save-status'].textContent, '編集中…');
  assert.equal(app.getState().saveStatus, 'dirty');
  tick(100);
  assert.ok(!els.preview.innerHTML.includes('Hello'));
  tick(60); // preview 150ms
  assert.match(els.preview.innerHTML, /<h1[^>]*>Hello<\/h1>/);
  assert.match(els.preview.innerHTML, /<strong>bold<\/strong>/);
  assert.equal(stored(storage).notes[0].body, '');
  tick(400); // editor 500ms
  assert.equal(stored(storage).notes[0].body, '# Hello\n\n**bold** #tag');
  assert.equal(els['save-status'].textContent, '保存済み');
  assert.deepEqual(itemTitles(els), ['Hello']);
  assert.equal(els['tag-filter'].children.length, 1);
  assert.equal(els['tag-filter'].children[0].textContent, '#tag (1)');
});

test('連続入力は最後の 1 回だけ保存される', () => {
  const { els, tick, storage } = setup();
  const spy = mock.method(storage, 'setItem');
  typeInto(els, 'a');
  tick(300);
  typeInto(els, 'ab');
  tick(300);
  assert.equal(spy.mock.callCount(), 0);
  tick(200);
  assert.equal(spy.mock.callCount(), 1);
  assert.equal(stored(storage).notes[0].body, 'ab');
});

test('入力中の XSS はプレビューに出ない', () => {
  const { els, tick } = setup();
  typeInto(els, '<script>alert(1)</script>\n\n[x](javascript:alert(1))');
  tick(200);
  assert.ok(!els.preview.innerHTML.includes('<script'));
  assert.ok(!els.preview.innerHTML.includes('href='));
});

function seed(ctx) {
  // 3 件: 'Alpha' (#work), 'Beta' (#home), 'gamma' (#work #home)
  const { els, tick } = ctx;
  typeInto(els, '# Alpha\n#work');
  tick(500);
  press(ctx.doc, 'n', { ctrlKey: true });
  typeInto(els, '# Beta\n#home');
  tick(500);
  press(ctx.doc, 'n', { metaKey: true });
  typeInto(els, '# Gamma Note\n#work #home');
  tick(500);
}

test('検索: 大文字小文字を区別せず、デバウンス後に絞り込む', () => {
  const ctx = setup();
  seed(ctx);
  const { els, tick } = ctx;
  assert.deepEqual(itemTitles(els), ['Gamma Note', 'Beta', 'Alpha']);
  els.search.value = 'ALPHA';
  els.search.dispatch('input');
  assert.equal(els['note-list'].children.length, 3);
  tick(150);
  assert.deepEqual(itemTitles(els), ['Alpha']);
  els.search.value = 'zzz';
  els.search.dispatch('input');
  tick(150);
  assert.deepEqual(itemTitles(els), []);
  assert.equal(els['empty-message'].hidden, false);
  els.search.value = '';
  els.search.dispatch('input');
  tick(150);
  assert.equal(els['note-list'].children.length, 3);
  assert.equal(els['empty-message'].hidden, true);
});

test('タグ絞り込み: 選択・再クリックで解除、検索と併用', () => {
  const ctx = setup();
  seed(ctx);
  const { els, tick, app } = ctx;
  const labels = els['tag-filter'].children.map((b) => b.textContent);
  assert.deepEqual(labels, ['#home (2)', '#work (2)']);
  clickTag(els, 'work');
  assert.deepEqual(itemTitles(els), ['Gamma Note', 'Alpha']);
  assert.equal(els['tag-filter'].children.find((b) => b.dataset.tag === 'work').attrs['aria-pressed'], 'true');
  els.search.value = 'gamma';
  els.search.dispatch('input');
  tick(150);
  assert.deepEqual(itemTitles(els), ['Gamma Note']);
  assert.equal(app.getState().tag, 'work');
  clickTag(els, 'work');
  assert.equal(app.getState().tag, null);
  assert.deepEqual(itemTitles(els), ['Gamma Note']);
});

test('一覧クリックでメモを切り替えると本文とプレビューが入れ替わる', () => {
  const ctx = setup();
  seed(ctx);
  const { els, app } = ctx;
  clickItem(els, 2); // Alpha
  assert.equal(els.editor.value, '# Alpha\n#work');
  assert.match(els.preview.innerHTML, /Alpha/);
  assert.equal(app.getState().selectedId, 'n1');
  assert.equal(els['note-list'].children[2].children[0].attrs['aria-current'], 'true');
});

test('切り替え時に保留中の編集が元のメモへ保存される', () => {
  const ctx = setup();
  seed(ctx);
  const { els, storage } = ctx;
  typeInto(els, '# Gamma Edited');
  clickItem(els, 1); // 保存前に別メモへ
  const bodies = Object.fromEntries(stored(storage).notes.map((n) => [n.id, n.body]));
  assert.equal(bodies.n3, '# Gamma Edited');
  assert.equal(els.editor.value, bodies.n2);
});

test('削除: confirm を経て消え、次のメモが選ばれる。最後の 1 件なら空メモができる', () => {
  const ctx = setup();
  seed(ctx);
  const { els, app, confirms, storage } = ctx;
  els['btn-delete'].click();
  assert.equal(confirms.length, 1);
  assert.deepEqual(itemTitles(els), ['Beta', 'Alpha']);
  assert.equal(app.getState().selectedId, 'n2');
  assert.equal(stored(storage).notes.length, 2);
  els['btn-delete'].click();
  els['btn-delete'].click();
  assert.equal(confirms.length, 3);
  const notes = stored(storage).notes;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].body, '');
  assert.equal(els.editor.value, '');
});

test('削除を取り消すと何も変わらない', () => {
  const ctx = setup({ confirmAnswer: false });
  seed(ctx);
  ctx.els['btn-delete'].click();
  assert.equal(ctx.store.list().length, 3);
});

test('削除直前の未保存編集が削除済みメモに書き戻されない', () => {
  const ctx = setup();
  seed(ctx);
  const { els, tick, store } = ctx;
  typeInto(els, '# will be deleted');
  els['btn-delete'].click();
  tick(1000);
  assert.equal(store.list().length, 2);
  assert.equal(store.get('n3'), null);
});

test('Ctrl+S は即時保存、Cmd+N は新規作成、Ctrl+K は検索欄へフォーカス', () => {
  const ctx = setup();
  const { els, doc, storage, app } = ctx;
  typeInto(els, 'quick');
  const e = press(doc, 's', { ctrlKey: true });
  assert.equal(e.prevented, true);
  assert.equal(stored(storage).notes[0].body, 'quick');
  assert.equal(els['save-status'].textContent, '保存済み');

  const e2 = press(doc, 'N', { metaKey: true });
  assert.equal(e2.prevented, true);
  assert.equal(app.getState().notes.length, 2);
  assert.equal(app.getState().selectedId, 'n2');
  assert.equal(els.editor.value, '');
  assert.ok(els.editor.focused > 0);

  const before = els.search.focused;
  const e3 = press(doc, 'k', { ctrlKey: true });
  assert.equal(e3.prevented, true);
  assert.equal(els.search.focused, before + 1);
});

test('修飾キーなし・Shift/Alt 付きではショートカットが働かない', () => {
  const ctx = setup();
  const { doc, app } = ctx;
  for (const mods of [{}, { ctrlKey: true, shiftKey: true }, { metaKey: true, altKey: true }]) {
    assert.equal(press(doc, 'n', mods).prevented, false);
  }
  assert.equal(app.getState().notes.length, 1);
});

test('ページ非表示 (pagehide / visibilitychange) で保留中の編集が保存される', () => {
  const ctx = setup();
  const { els, win, doc, storage } = ctx;
  typeInto(els, 'one');
  win.dispatch('pagehide');
  assert.equal(stored(storage).notes[0].body, 'one');
  typeInto(els, 'two');
  doc.visibilityState = 'hidden';
  doc.dispatch('visibilitychange');
  assert.equal(stored(storage).notes[0].body, 'two');
});

test('タブ切替と矢印キー', () => {
  const { els, app } = setup();
  els['tab-preview'].click();
  assert.equal(els.app.dataset.view, 'preview');
  assert.equal(els['tab-preview'].attrs['aria-selected'], 'true');
  els.tabs.dispatch('keydown', { key: 'ArrowLeft', preventDefault() {} });
  assert.equal(app.getState().view, 'edit');
  assert.equal(els['tab-edit'].attrs['aria-selected'], 'true');
});

test('書き出し: ファイル名は UTC 日時、内容は import で戻せる JSON', async () => {
  const ctx = setup();
  seed(ctx);
  const { store } = ctx;
  const downloads = [];
  // createIo の download は注入できないので、グローバルの DOM 呼び出しを偽装する
  const created = [];
  globalThis.Blob = class { constructor(parts) { this.text = parts.join(''); } };
  globalThis.URL = Object.assign(globalThis.URL, { createObjectURL: (b) => (created.push(b), 'blob:x'), revokeObjectURL() {} });
  const anchors = [];
  const prevDocument = globalThis.document;
  globalThis.document = {
    createElement: () => { const a = { click() { downloads.push(a.download); }, remove() {} }; anchors.push(a); return a; },
    body: { appendChild() {} },
  };
  try {
    ctx.els['btn-export'].click();
  } finally {
    globalThis.document = prevDocument;
  }
  assert.deepEqual(downloads, ['mdmemo-20261027-153045.json']);
  const data = JSON.parse(created[0].text);
  assert.equal(data.version, 1);
  assert.equal(data.notes.length, 3);
  assert.deepEqual(data.notes, store.exportAll().notes);
});

function fileOf(text, name = 'in.json') {
  return { name, size: text.length, text: async () => text };
}

async function importFile(ctx, text, choice) {
  const { els } = ctx;
  els['import-file'].files = [fileOf(text)];
  els['import-file'].dispatch('change');
  await new Promise((r) => setImmediate(r));
  assert.equal(els['import-dialog'].open, true);
  els[`import-${choice}`].click();
}

const noteJson = (id, body, updatedAt) => ({ id, title: '', body, tags: [], createdAt: 1, updatedAt });

test('読み込み (merge): 新しいほうだけ残して追加し、一覧が更新される', async () => {
  const ctx = setup();
  const { els, store, app } = ctx;
  typeInto(els, '# Mine');
  els['btn-new'].click(); // flush で n1 保存
  const mine = store.get('n1');
  const file = JSON.stringify({
    version: 1,
    notes: [noteJson('n1', '# Old', mine.updatedAt - 1), noteJson('x1', '# Imported #in', 5), noteJson('x2', '# Imported2', 6)],
  });
  await importFile(ctx, file, 'merge');
  assert.match(els['import-summary'].textContent, /現在のメモ 2 件/);
  assert.equal(store.get('n1').body, '# Mine');
  assert.equal(store.list().length, 4);
  assert.equal(els['save-status'].textContent, '2 件を読み込みました');
  assert.equal(els['note-list'].children.length, 4);
  assert.ok(app.getState().tags.some((t) => t.tag === 'in'));
});

test('読み込み (replace): 既存メモは全て消え、先頭のメモが選ばれる', async () => {
  const ctx = setup();
  const { els, store, app, storage } = ctx;
  typeInto(els, '# Mine');
  const file = JSON.stringify({ version: 1, notes: [noteJson('x1', '# One', 10), noteJson('x2', '# Two', 20)] });
  await importFile(ctx, file, 'replace');
  assert.deepEqual(store.list().map((n) => n.id), ['x2', 'x1']);
  assert.equal(app.getState().selectedId, 'x2');
  assert.equal(els.editor.value, '# Two');
  assert.deepEqual(itemTitles(els), ['Two', 'One']);
  assert.equal(stored(storage).notes.length, 2);
});

test('読み込みをキャンセルしても何も変わらない', async () => {
  const ctx = setup();
  const file = JSON.stringify({ version: 1, notes: [noteJson('x1', '# One', 10)] });
  await importFile(ctx, file, 'cancel');
  assert.equal(ctx.store.list().length, 1);
  assert.equal(ctx.store.get('x1'), null);
});

test('壊れた読み込みファイルはエラー表示で、既存メモは無傷', async () => {
  const ctx = setup();
  const { els, store } = ctx;
  await importFile(ctx, '{not json', 'replace');
  assert.equal(els['error-banner'].hidden, false);
  assert.match(els['error-text'].textContent, /JSON/);
  assert.equal(store.list().length, 1);
  els['error-close'].click();
  assert.equal(els['error-banner'].hidden, true);
});

test('形式が不正な読み込みは VALIDATION として詳細つきで表示', async () => {
  const ctx = setup();
  await importFile(ctx, JSON.stringify({ version: 2, notes: [] }), 'merge');
  assert.equal(ctx.els['error-banner'].hidden, false);
  assert.match(ctx.els['error-text'].textContent, /version/);
  assert.equal(ctx.store.list().length, 1);
});

test('容量超過: 自動保存が失敗するとエラー表示、容量が空けば回復する', () => {
  const storage = createMemoryStorage({}, { quotaChars: 400 });
  const ctx = setup({ storage });
  const { els, tick, app, doc } = ctx;
  typeInto(els, 'x'.repeat(1000));
  tick(500);
  assert.equal(app.getState().saveStatus, 'error');
  assert.equal(els['save-status'].textContent, '保存に失敗しました');
  assert.equal(els['error-banner'].hidden, false);
  assert.match(els['error-text'].textContent, /容量/);
  assert.equal(app.getState().error.code, 'QUOTA_EXCEEDED');
  // 入力内容は画面に残る
  assert.equal(els.editor.value.length, 1000);
  // 小さくすれば保存でき、エラーが消える
  typeInto(els, 'small');
  press(doc, 's', { ctrlKey: true });
  assert.equal(app.getState().saveStatus, 'saved');
  assert.equal(els['error-banner'].hidden, true);
  assert.equal(stored(storage).notes[0].body, 'small');
});

test('容量超過: 新規作成の失敗でもアプリは落ちずエラーを表示', () => {
  const storage = createMemoryStorage({}, { quotaChars: 200 });
  const ctx = setup({ storage });
  const { els, app, store } = ctx;
  // 1 件目 (空) は入るが、2 件目で溢れるまで作る
  for (let i = 0; i < 5; i++) {
    typeInto(els, `note ${i}`); // 空のメモがあると「新規」は増やさない
    els['btn-new'].click();
  }
  assert.equal(app.getState().error?.code, 'QUOTA_EXCEEDED');
  assert.equal(els['error-banner'].hidden, false);
  assert.ok(store.list().length < 6);
});

test('壊れた保存データ: 退避して空で起動し、復旧メッセージを表示', () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: '{broken' });
  const ctx = setup({ storage });
  const { els, app } = ctx;
  assert.equal(app.getState().recovered, true);
  assert.equal(els['error-banner'].hidden, false);
  assert.match(els['error-text'].textContent, /退避/);
  assert.equal(storage.getItem(CORRUPT_KEY), '{broken');
  assert.equal(app.getState().notes.length, 1);
  assert.equal(app.getState().notes[0].body, '');
});

test('スキーマ違反の保存データも復旧扱いになり、閉じるボタンで消せる', () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 1, notes: [{ id: 1 }] }) });
  const ctx = setup({ storage });
  assert.equal(ctx.store.getLoadInfo().reason, 'invalid-schema');
  assert.equal(ctx.els['error-banner'].hidden, false);
  ctx.els['error-close'].click();
  assert.equal(ctx.els['error-banner'].hidden, true);
});

test('保存済みのデータは再起動後に復元される', () => {
  const storage = createMemoryStorage();
  const a = setup({ storage });
  typeInto(a.els, '# Persist #keep');
  press(a.doc, 's', { ctrlKey: true });
  a.app.destroy();
  apps = [];
  const b = setup({ storage });
  assert.equal(b.els.editor.value, '# Persist #keep');
  assert.deepEqual(itemTitles(b.els), ['Persist #keep']);
  assert.equal(b.els['error-banner'].hidden, true);
});

test('destroy 後はキー入力に反応しない', () => {
  const ctx = setup();
  ctx.app.destroy();
  assert.equal(press(ctx.doc, 'n', { ctrlKey: true }).prevented, false);
  assert.equal(ctx.store.list().length, 1);
});

test('絞り込み中のタグが編集で消えても、絞り込みを解除できる (チップが消えて一覧が空のまま固まらない)',
  () => {
    const { els, tick, app } = setup();
    typeInto(els, '# A #work');
    tick(600);
    clickTag(els, 'work');
    assert.deepEqual(itemTitles(els), ['A #work']);
    typeInto(els, '# A no tag');
    tick(600);
    // 期待: 絞り込みが解除されて 'A no tag' が見える (または解除用の UI が残る)
    // 実際: tag === 'work' のまま、タグチップ 0 個、一覧 0 件
    const recoverable = app.getState().tag === null || els['tag-filter'].children.length > 0;
    assert.ok(recoverable, `tag=${app.getState().tag} chips=${els['tag-filter'].children.length} items=${els['note-list'].children.length}`);
    assert.deepEqual(itemTitles(els), ['A no tag']);
  });

test('絞り込み中のメモを削除して結果が空になっても、一覧に出ているメモが選ばれる', () => {
  const ctx = setup();
  seed(ctx);
  const { els, app, store } = ctx;
  clickTag(els, 'work'); // Gamma Note, Alpha
  clickItem(els, 0);
  els['btn-delete'].click();
  assert.equal(app.getState().selectedId, 'n1'); // Alpha
  els['btn-delete'].click();
  // work の付いたメモが無くなった: 絞り込みは解除され、残りのメモが表示・選択される
  assert.equal(app.getState().tag, null);
  assert.deepEqual(itemTitles(els), ['Beta']);
  assert.equal(app.getState().selectedId, 'n2');
  assert.equal(store.list().length, 1);
});

test('検索結果が空になるメモを削除すると検索を解除して選択する', () => {
  const ctx = setup();
  seed(ctx);
  const { els, app, tick } = ctx;
  els.search.value = 'alpha';
  els.search.dispatch('input');
  tick(150);
  clickItem(els, 0);
  els['btn-delete'].click();
  assert.equal(app.getState().query, '');
  assert.equal(els.search.value, '');
  assert.equal(els['note-list'].children.length, 2);
  const id = app.getState().selectedId;
  assert.ok(app.getState().notes.some((n) => n.id === id));
});

test('自動保存が失敗している間は、切り替え・新規・読み込みで編集中の本文を失わない', async () => {
  const storage = createMemoryStorage({}, { quotaChars: 600 });
  const ctx = setup({ storage });
  const { els, tick, app } = ctx;
  typeInto(els, 'first');
  els['btn-new'].click();
  assert.equal(app.getState().selectedId, 'n2');
  const big = 'x'.repeat(1000);
  typeInto(els, big);
  tick(500);
  assert.equal(app.getState().saveStatus, 'error');
  clickItem(els, 1);
  assert.equal(app.getState().selectedId, 'n2');
  assert.equal(els.editor.value, big);
  els['btn-new'].click();
  assert.equal(app.getState().selectedId, 'n2');
  assert.equal(els.editor.value, big);
  assert.equal(els['error-banner'].hidden, false);
  assert.equal(app.getState().notes.length, 2);
  const file = JSON.stringify({ version: 1, notes: [noteJson('x1', '# One', 10)] });
  await importFile(ctx, file, 'replace');
  assert.equal(ctx.store.get('x1'), null);
  assert.equal(els.editor.value, big);
  assert.equal(els['error-banner'].hidden, false);
  assert.match(els['error-text'].textContent, /容量/);
  // 小さくすれば保存でき、切り替えられる
  typeInto(els, 'ok');
  press(ctx.doc, 's', { ctrlKey: true });
  clickItem(els, 1);
  assert.equal(app.getState().selectedId, 'n1');
});

function unavailableStorage() {
  const err = Object.assign(new Error('denied'), { name: 'SecurityError' });
  return {
    getItem() { throw err; },
    setItem() { throw err; },
    removeItem() { throw err; },
  };
}

test('保存領域を使えない: 起動時に保存不可を明示し、入力しても黙って捨てない', () => {
  const ctx = setup({ storage: unavailableStorage() });
  const { els, app, tick } = ctx;
  assert.equal(app.getState().selectedId, null);
  assert.equal(app.getState().saveStatus, 'error');
  assert.equal(els['save-status'].textContent, '保存に失敗しました');
  assert.equal(els['live-region'].textContent, '保存に失敗しました');
  assert.equal(els['error-banner'].hidden, false);
  assert.match(els['error-text'].textContent, /保存領域を使えません/);
  assert.doesNotMatch(els['error-text'].textContent, /退避した/);
  typeInto(els, 'hello');
  tick(500);
  assert.equal(app.getState().saveStatus, 'error');
  assert.equal(els['error-banner'].hidden, false);
});

test('復旧バナーは最初の保存成功では消えず、閉じるボタンで消える', () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: '{broken' });
  const ctx = setup({ storage });
  const { els, tick } = ctx;
  typeInto(els, 'abc');
  tick(500);
  assert.equal(ctx.app.getState().saveStatus, 'saved');
  assert.equal(els['error-banner'].hidden, false);
  assert.match(els['error-text'].textContent, /退避/);
  els['error-close'].click();
  assert.equal(els['error-banner'].hidden, true);
  assert.equal(ctx.app.getState().recovered, false);
});

test('復旧バナーは保存エラーが解消した後も残る', () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: '{broken' }, { quotaChars: 400 });
  const ctx = setup({ storage });
  const { els, tick, doc } = ctx;
  typeInto(els, 'x'.repeat(1000));
  tick(500);
  assert.match(els['error-text'].textContent, /容量/);
  typeInto(els, 'small');
  press(doc, 's', { ctrlKey: true });
  assert.equal(els['error-banner'].hidden, false);
  assert.match(els['error-text'].textContent, /退避/);
});

test('読み込み結果は statusMessage 経由で表示され、次の保存状態の変化で消える。live region にも出る', async () => {
  const ctx = setup();
  const { els, app } = ctx;
  const file = JSON.stringify({ version: 1, notes: [noteJson('x1', '# One', 10)] });
  await importFile(ctx, file, 'merge');
  assert.equal(app.getState().statusMessage, '1 件を読み込みました');
  assert.equal(els['save-status'].textContent, '1 件を読み込みました');
  assert.equal(els['live-region'].textContent, '1 件を読み込みました');
  typeInto(els, 'more');
  assert.equal(app.getState().statusMessage, null);
  assert.equal(els['save-status'].textContent, '編集中…');
  assert.equal(els['live-region'].textContent, '');
});

test('自動保存の成功では live region に何も出さない', () => {
  const { els, tick } = setup();
  typeInto(els, 'abc');
  tick(500);
  assert.equal(els['save-status'].textContent, '保存済み');
  assert.equal(els['live-region'].textContent, '');
});

test('ダイアログ表示中はショートカットが効かない', async () => {
  const ctx = setup();
  const { els, doc, app } = ctx;
  typeInto(els, 'text');
  els['import-file'].files = [fileOf('{}')];
  els['import-file'].dispatch('change');
  await new Promise((r) => setImmediate(r));
  assert.equal(els['import-dialog'].open, true);
  press(doc, 'n', { ctrlKey: true });
  assert.equal(app.getState().notes.length, 1);
  const before = els.search.focused ?? 0;
  press(doc, 'k', { ctrlKey: true });
  assert.equal(els.search.focused ?? 0, before);
  els['import-cancel'].click();
  press(doc, 'n', { ctrlKey: true });
  assert.equal(app.getState().notes.length, 2);
});

test('現在のメモが空なら「新規」はメモを増やさずエディタへフォーカスする', () => {
  const { els, app, store } = setup();
  els['btn-new'].click();
  els['btn-new'].click();
  assert.equal(store.list().length, 1);
  assert.equal(app.getState().selectedId, 'n1');
  assert.ok(els.editor.focused >= 2);
  typeInto(els, 'x');
  els['btn-new'].click();
  assert.equal(store.list().length, 2);
});

test('削除では保留中の自動保存を editor.cancelSave で破棄する (入力値は変えない)', () => {
  const ctx = setup();
  seed(ctx);
  const { els, tick } = ctx;
  typeInto(els, '# pending');
  els['btn-delete'].click();
  tick(1000);
  assert.equal(ctx.app.getState().error, null);
});

test('タブ: roving tabindex と Home/End、tabpanel', () => {
  const { els, app } = setup();
  assert.equal(els['tab-edit'].attrs.tabindex, undefined); // 初期値は HTML 側
  els['tab-preview'].click();
  assert.equal(els['tab-preview'].attrs.tabindex, '0');
  assert.equal(els['tab-edit'].attrs.tabindex, '-1');
  els.tabs.dispatch('keydown', { key: 'Home', preventDefault() {} });
  assert.equal(app.getState().view, 'edit');
  assert.equal(els['tab-edit'].attrs.tabindex, '0');
  assert.equal(els['tab-edit'].focused, 1);
  els.tabs.dispatch('keydown', { key: 'End', preventDefault() {} });
  assert.equal(app.getState().view, 'preview');
  assert.equal(els['tab-preview'].focused, 1);
});

test('不正な日時のメモでも一覧は描画できる', () => {
  const ctx = setup();
  const { els, store } = ctx;
  const orig = store.list;
  store.list = (...a) => orig(...a).map((n) => ({ ...n, updatedAt: NaN }));
  typeInto(els, 'x');
  ctx.tick(600);
  assert.equal(els['note-list'].children.length, 1);
});
