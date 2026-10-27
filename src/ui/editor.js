import { debounce } from '../util/debounce.js';

/**
 * Markdown 入力欄。入力の通知、自動保存のデバウンス、ショートカットを担当する。
 * @param {{
 *   el: HTMLTextAreaElement,
 *   doc?: Document,
 *   onInput: (body: string) => void,
 *   onSave: (body: string) => void,
 *   onShortcut: (name: 'new'|'search') => void,
 *   wait?: number,
 *   timers?: {setTimeout: Function, clearTimeout: Function}
 * }} opts
 * @returns {{setValue(body: string): void, getValue(): string, focus(): void, flush(): void, cancelSave(): void, destroy(): void}}
 */
export function createEditor(opts) {
  const { el, onInput, onSave, onShortcut, wait = 500, timers } = opts;
  const doc = opts.doc ?? el.ownerDocument;

  const save = debounce(() => onSave(el.value), wait, timers);

  const handleInput = () => {
    onInput(el.value);
    save();
  };

  const handleKeydown = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (typeof e.key !== 'string') return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      if (save.pending()) save.flush();
      else onSave(el.value);
    } else if (key === 'n') {
      e.preventDefault();
      onShortcut('new');
    } else if (key === 'k') {
      e.preventDefault();
      onShortcut('search');
    }
  };

  const handlePageHide = () => save.flush();
  const handleVisibility = () => {
    if (doc.visibilityState === 'hidden') save.flush();
  };

  el.addEventListener('input', handleInput);
  doc.addEventListener('keydown', handleKeydown);
  doc.addEventListener('visibilitychange', handleVisibility);
  const win = doc.defaultView;
  if (win) win.addEventListener('pagehide', handlePageHide);

  return {
    setValue(body) {
      save.cancel();
      el.value = body;
    },
    getValue() {
      return el.value;
    },
    focus() {
      el.focus();
    },
    flush() {
      save.flush();
    },
    cancelSave() {
      save.cancel();
    },
    destroy() {
      save.cancel();
      el.removeEventListener('input', handleInput);
      doc.removeEventListener('keydown', handleKeydown);
      doc.removeEventListener('visibilitychange', handleVisibility);
      if (win) win.removeEventListener('pagehide', handlePageHide);
    },
  };
}
