// 結合テスト用の偽 DOM。startApp が使う分だけを実装する。
import { fakeTarget } from '../ui/fakes.js';

export function fakeElement(tagName = 'div', doc = null) {
  const el = fakeTarget({
    tagName: tagName.toUpperCase(),
    ownerDocument: doc,
    className: '',
    dataset: {},
    attrs: {},
    children: [],
    parent: null,
    hidden: false,
    value: '',
    textContent: '',
    innerHTML: '',
    focused: 0,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    replaceChildren(...cs) {
      for (const c of this.children) c.parent = null;
      this.children = [];
      for (const c of cs) this.appendChild(c);
    },
    contains(n) {
      for (let x = n; x; x = x.parent) if (x === this) return true;
      return false;
    },
    closest(sel) {
      const [tag, cls] = sel.split('.');
      for (let x = this; x; x = x.parent) {
        if (x.tagName === tag.toUpperCase() && (!cls || x.className.split(' ').includes(cls))) return x;
      }
      return null;
    },
    querySelectorAll(sel) {
      const [tag, cls] = sel.split('.');
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (c.tagName === tag.toUpperCase() && c.className.split(' ').includes(cls)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    },
    focus() { this.focused++; if (this.ownerDocument) this.ownerDocument.activeElement = this; },
    select() {},
    click() { this.dispatch('click', { target: this }); },
  });
  return el;
}

const IDS = [
  'app', 'btn-new', 'btn-delete', 'save-status', 'live-region', 'error-banner', 'error-text', 'error-close',
  'tabs', 'tab-edit', 'tab-preview', 'editor', 'preview', 'search', 'tag-filter', 'note-list',
  'empty-message', 'btn-export', 'btn-import', 'import-file', 'import-dialog', 'import-summary',
  'import-merge', 'import-replace', 'import-cancel',
];

export function createFakeDocument() {
  const win = fakeTarget();
  const doc = fakeTarget({ defaultView: win, visibilityState: 'visible', activeElement: null });
  const els = {};
  const tagOf = { 'note-list': 'ul', editor: 'textarea', search: 'input', 'import-file': 'input' };
  for (const id of IDS) els[id] = fakeElement(tagOf[id] ?? 'div', doc);
  els['error-banner'].hidden = true;
  els['import-file'].files = [];
  const dlg = els['import-dialog'];
  dlg.returnValue = '';
  dlg.showModal = () => { dlg.open = true; };
  dlg.close = (v) => { dlg.open = false; dlg.returnValue = v; dlg.dispatch('close'); };
  doc.getElementById = (id) => els[id] ?? null;
  doc.createElement = (name) => fakeElement(name, doc);
  return { doc, win, els };
}

export function press(doc, key, mods = {}) {
  const e = { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods, prevented: false };
  e.preventDefault = () => { e.prevented = true; };
  doc.dispatch('keydown', e);
  return e;
}

export function typeInto(els, text) {
  els.editor.value = text;
  els.editor.dispatch('input');
}

export function itemTitles(els) {
  return els['note-list'].children.map((li) => li.children[0].children[0].textContent);
}

export function clickItem(els, index) {
  const btn = els['note-list'].children[index].children[0];
  els['note-list'].dispatch('click', { target: btn });
}

export function clickTag(els, tag) {
  const btn = els['tag-filter'].children.find((b) => b.dataset.tag === tag);
  els['tag-filter'].dispatch('click', { target: btn });
}
