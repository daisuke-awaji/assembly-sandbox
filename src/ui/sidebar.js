import { debounce } from '../util/debounce.js';

const dateFormat = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' });

/**
 * メモ一覧・検索・タグ絞り込み。
 * @param {{
 *   searchEl: HTMLInputElement, tagEl: HTMLElement, listEl: HTMLUListElement, emptyEl: HTMLElement,
 *   onSelect: (id: string) => void,
 *   onSearch: (query: string) => void,
 *   onTag: (tag: string|null) => void,
 *   doc?: Document,
 *   timers?: {setTimeout: Function, clearTimeout: Function}
 * }} opts
 * @returns {{update(state: object): void, focusSearch(): void}}
 */
export function createSidebar(opts) {
  const { searchEl, tagEl, listEl, emptyEl, onSelect, onSearch, onTag, timers } = opts;
  const doc = opts.doc ?? listEl.ownerDocument;
  let currentTag = null;

  const notifySearch = debounce(() => onSearch(searchEl.value), 150, timers);
  searchEl.addEventListener('input', () => notifySearch());

  listEl.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('button.note-item');
    const id = btn?.dataset?.id;
    if (typeof id === 'string') onSelect(id);
  });

  tagEl.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('button.tag-chip');
    if (!btn) return;
    const tag = btn.dataset.tag;
    onTag(tag === currentTag ? null : tag);
  });

  const el = (name, className, text) => {
    const node = doc.createElement(name);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  };

  return {
    update(state) {
      currentTag = state.tag ?? null;
      if (searchEl.value !== state.query) searchEl.value = state.query;

      const active = doc.activeElement;
      const focusedId = active && listEl.contains(active) ? active.dataset?.id : undefined;

      tagEl.replaceChildren(
        ...state.tags.map(({ tag, count }) => {
          const b = el('button', 'tag-chip', `#${tag} (${count})`);
          b.type = 'button';
          b.dataset.tag = tag;
          b.setAttribute('aria-pressed', String(tag === currentTag));
          return b;
        }),
      );

      const items = state.notes.map((note) => {
        const li = doc.createElement('li');
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'note-item';
        b.dataset.id = note.id;
        b.setAttribute('aria-current', String(note.id === state.selectedId));
        b.appendChild(el('span', 'note-title', note.title));
        const updated = new Date(note.updatedAt);
        if (!Number.isNaN(updated.getTime())) {
          const time = el('time', 'note-date', dateFormat.format(updated));
          time.setAttribute('datetime', updated.toISOString());
          b.appendChild(time);
        }
        if (note.tags.length > 0) {
          const tags = doc.createElement('span');
          tags.className = 'note-tags';
          for (const t of note.tags) tags.appendChild(el('span', 'note-tag', `#${t}`));
          b.appendChild(tags);
        }
        li.appendChild(b);
        return li;
      });
      listEl.replaceChildren(...items);
      emptyEl.hidden = state.notes.length > 0;

      if (focusedId !== undefined) {
        for (const b of listEl.querySelectorAll('button.note-item')) {
          if (b.dataset.id === focusedId) {
            b.focus();
            break;
          }
        }
      }
    },
    focusSearch() {
      searchEl.focus();
      searchEl.select?.();
    },
  };
}
