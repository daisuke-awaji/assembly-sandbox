// テスト・開発用のモック。本物の store / markdown の代わりに ui だけを動かすために使う。

const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => s.replace(/[&<>"']/g, (c) => escapeMap[c]);

const storeError = (code, message) =>
  Object.assign(new Error(message), { name: 'StoreError', code, details: [] });

function deriveTitle(body) {
  for (const line of body.split('\n')) {
    const t = line.replace(/^ {0,3}#{1,6}[ \t]+/, '').trim();
    if (t) return t.slice(0, 200);
  }
  return '無題';
}

function extractTags(body) {
  const tags = [];
  for (const m of body.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{1,50})(?![\p{L}\p{N}_-])/gu)) {
    const t = m[1].toLowerCase();
    if (!tags.includes(t)) tags.push(t);
  }
  return tags;
}

/**
 * NotesStore (§3.4) の簡易メモリ版。
 * @param {object[]} [initialNotes]
 * @param {{now?: () => number, genId?: () => string}} [deps]
 */
export function createMockStore(initialNotes = [], deps = {}) {
  const now = deps.now ?? Date.now;
  let seq = 0;
  const genId = deps.genId ?? (() => `mock-${++seq}`);
  let notes = initialNotes.map((n) => ({ ...n, tags: [...(n.tags ?? [])] }));

  const copy = (n) => ({ ...n, tags: [...n.tags] });
  const sorted = (arr) =>
    [...arr].sort((a, b) =>
      b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const checkBody = (body) => {
    if (typeof body !== 'string' || body.length > 1048576) throw storeError('VALIDATION', '本文が不正です');
  };

  return {
    list({ query, tag } = {}) {
      const q = (query ?? '').trim().toLowerCase();
      const t = tag ? tag.replace(/^#/, '').trim().toLowerCase() : '';
      return sorted(notes)
        .filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
        .filter((n) => !t || n.tags.includes(t))
        .map(copy);
    },
    get(id) {
      const n = notes.find((x) => x.id === id);
      return n ? copy(n) : null;
    },
    create(partial = {}) {
      const body = partial.body ?? '';
      checkBody(body);
      const t = now();
      const note = { id: genId(), title: deriveTitle(body), body, tags: extractTags(body), createdAt: t, updatedAt: t };
      notes = [...notes, note];
      return copy(note);
    },
    update(id, patch) {
      checkBody(patch?.body);
      const i = notes.findIndex((x) => x.id === id);
      if (i < 0) throw storeError('NOT_FOUND', 'メモが見つかりません');
      const old = notes[i];
      if (old.body === patch.body) return copy(old);
      const updatedAt = Math.max(now(), old.updatedAt + 1);
      const note = { ...old, body: patch.body, title: deriveTitle(patch.body), tags: extractTags(patch.body), updatedAt };
      notes = notes.map((x, j) => (j === i ? note : x));
      return copy(note);
    },
    remove(id) {
      const before = notes.length;
      notes = notes.filter((x) => x.id !== id);
      return notes.length !== before;
    },
    listTags() {
      const counts = new Map();
      for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
      return [...counts].map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
    },
    exportAll() {
      return { version: 1, notes: sorted(notes).map(copy) };
    },
    importAll(json, { mode } = {}) {
      if (mode !== 'merge' && mode !== 'replace') throw storeError('VALIDATION', 'mode が不正です');
      let data;
      try {
        data = JSON.parse(json);
      } catch {
        throw storeError('VALIDATION', 'JSON として読み込めません');
      }
      if (!data || data.version !== 1 || !Array.isArray(data.notes)) {
        throw storeError('VALIDATION', '書き出しファイルの形式が正しくありません');
      }
      const incoming = data.notes.map((n) => ({
        ...n, title: deriveTitle(n.body), tags: extractTags(n.body),
      }));
      let added = 0, updated = 0, skipped = 0;
      if (mode === 'replace') {
        notes = incoming;
        added = incoming.length;
      } else {
        for (const n of incoming) {
          const i = notes.findIndex((x) => x.id === n.id);
          if (i < 0) { notes = [...notes, n]; added++; }
          else if (n.updatedAt > notes[i].updatedAt) { notes = notes.map((x, j) => (j === i ? n : x)); updated++; }
          else skipped++;
        }
      }
      return { mode, added, updated, skipped, total: notes.length };
    },
    getLoadInfo() {
      return { recovered: false, reason: null };
    },
  };
}

/** escapeHtml 相当だけを行い p で包む。 */
export function mockRender(src) {
  return `<p>${esc(String(src))}</p>`;
}
