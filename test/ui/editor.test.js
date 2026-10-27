import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../../src/ui/editor.js';
import { fakeTimers, fakeTarget, keyEvent } from './fakes.js';

function setup() {
  const timers = fakeTimers();
  const win = fakeTarget();
  const doc = fakeTarget({ defaultView: win, visibilityState: 'visible' });
  const el = fakeTarget({ value: '', focus() { this.focused = true; } });
  const log = { input: [], save: [], shortcut: [] };
  const editor = createEditor({
    el, doc, timers,
    onInput: (b) => log.input.push(b),
    onSave: (b) => log.save.push(b),
    onShortcut: (n) => log.shortcut.push(n),
  });
  return { timers, win, doc, el, log, editor };
}

test('input は即時に通知し、保存は遅延して 1 回', () => {
  const { el, timers, log } = setup();
  el.value = 'a'; el.dispatch('input');
  el.value = 'ab'; el.dispatch('input');
  assert.deepEqual(log.input, ['a', 'ab']);
  assert.deepEqual(log.save, []);
  timers.fireAll();
  assert.deepEqual(log.save, ['ab']);
});

test('setValue は保留中の保存を破棄し onInput も呼ばない', () => {
  const { el, timers, log, editor } = setup();
  el.value = 'x'; el.dispatch('input');
  editor.setValue('new');
  timers.fireAll();
  assert.equal(el.value, 'new');
  assert.equal(editor.getValue(), 'new');
  assert.deepEqual(log.save, []);
  assert.deepEqual(log.input, ['x']);
});

test('flush は保留中の保存を即実行する', () => {
  const { el, log, editor } = setup();
  el.value = 'z'; el.dispatch('input');
  editor.flush();
  assert.deepEqual(log.save, ['z']);
});

test('Ctrl/Cmd+S は保留が無くても onSave を呼ぶ', () => {
  const { el, doc, log } = setup();
  el.value = 'body';
  const e1 = keyEvent('s', { ctrlKey: true });
  doc.dispatch('keydown', e1);
  const e2 = keyEvent('S', { metaKey: true });
  doc.dispatch('keydown', e2);
  assert.deepEqual(log.save, ['body', 'body']);
  assert.ok(e1.prevented && e2.prevented);
});

test('Ctrl+S は保留中なら 1 回だけ保存する', () => {
  const { el, doc, timers, log } = setup();
  el.value = 'q'; el.dispatch('input');
  doc.dispatch('keydown', keyEvent('s', { ctrlKey: true }));
  timers.fireAll();
  assert.deepEqual(log.save, ['q']);
});

test('Ctrl+N / Ctrl+K はショートカットを通知する', () => {
  const { doc, log } = setup();
  const n = keyEvent('n', { ctrlKey: true });
  const k = keyEvent('k', { metaKey: true });
  doc.dispatch('keydown', n);
  doc.dispatch('keydown', k);
  assert.deepEqual(log.shortcut, ['new', 'search']);
  assert.ok(n.prevented && k.prevented);
});

test('修飾キー無し・Shift/Alt 付きは無視する', () => {
  const { doc, log } = setup();
  for (const e of [keyEvent('s'), keyEvent('n', { ctrlKey: true, shiftKey: true }), keyEvent('k', { ctrlKey: true, altKey: true }), keyEvent('x', { ctrlKey: true })]) {
    doc.dispatch('keydown', e);
    assert.equal(e.prevented, false);
  }
  assert.deepEqual(log.shortcut, []);
  assert.deepEqual(log.save, []);
});

test('pagehide と visibilitychange(hidden) で flush する', () => {
  const { el, doc, win, log } = setup();
  el.value = 'p'; el.dispatch('input');
  win.dispatch('pagehide');
  assert.deepEqual(log.save, ['p']);
  el.value = 'q'; el.dispatch('input');
  doc.visibilityState = 'visible';
  doc.dispatch('visibilitychange');
  assert.deepEqual(log.save, ['p']);
  doc.visibilityState = 'hidden';
  doc.dispatch('visibilitychange');
  assert.deepEqual(log.save, ['p', 'q']);
});

test('destroy でリスナーを外す', () => {
  const { el, doc, win, editor } = setup();
  editor.destroy();
  assert.equal(el.listenerCount('input'), 0);
  assert.equal(doc.listenerCount('keydown'), 0);
  assert.equal(win.listenerCount('pagehide'), 0);
});

test('cancelSave は保留中の保存だけを破棄し、本文は変えない', () => {
  const { el, timers, log, editor } = setup();
  el.value = 'x'; el.dispatch('input');
  editor.cancelSave();
  timers.fireAll();
  assert.equal(el.value, 'x');
  assert.deepEqual(log.save, []);
});
