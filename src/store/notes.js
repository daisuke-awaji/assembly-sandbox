// メモの store。メモリ上の配列を正とし、変更のたびに全体を保存する。

import {
  CORRUPT_KEY,
  ERROR_CODES,
  LIMITS,
  SCHEMA_VERSION,
  STORAGE_KEY,
  StoreError,
  parseExportFile,
  validateExportFile,
  validateNote,
} from './schema.js';
import { deriveTitle, extractTags, normalizeTag } from './tags.js';

const copyNote = (n) => ({ ...n, tags: [...n.tags] });

const byRecent = (a, b) =>
  b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * @param {unknown} err
 * @returns {StoreError}
 */
function toStorageError(err) {
  const e = /** @type {any} */ (err);
  if (e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014)) {
    return new StoreError(ERROR_CODES.QUOTA_EXCEEDED, '保存容量がいっぱいで保存できませんでした', { cause: err });
  }
  return new StoreError(ERROR_CODES.STORAGE_UNAVAILABLE, 'ブラウザの保存領域に書き込めませんでした', { cause: err });
}

/**
 * @param {unknown} body
 * @returns {string}
 */
function checkBody(body) {
  if (typeof body !== 'string') throw new StoreError(ERROR_CODES.VALIDATION, '本文が文字列ではありません');
  if (body.length > LIMITS.MAX_BODY) {
    throw new StoreError(ERROR_CODES.VALIDATION, '本文が長すぎます', { details: [`body: ${LIMITS.MAX_BODY} 文字を超えています`] });
  }
  return body;
}

/**
 * @param {{getItem: Function, setItem: Function, removeItem: Function}} storage
 * @param {{now?: () => number, genId?: () => string}} [deps]
 */
export function createNotesStore(storage, deps = {}) {
  const now = deps.now ?? Date.now;
  const genId = deps.genId ?? (() => crypto.randomUUID());

  /** @type {object[]} */
  let notes = [];
  let loadInfo = { recovered: false, reason: null };

  function load() {
    let raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      loadInfo = { recovered: true, reason: 'unavailable' };
      return;
    }
    if (raw === null || raw === undefined) return;
    let reason = null;
    try {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        reason = 'invalid-json';
        throw new Error(reason);
      }
      try {
        notes = dedupe(validateExportFile(parsed).notes).list;
      } catch {
        reason = 'invalid-schema';
        throw new Error(reason);
      }
    } catch {
      notes = [];
      try { storage.setItem(CORRUPT_KEY, raw); } catch { /* 退避に失敗しても続行 */ }
      try { storage.removeItem(STORAGE_KEY); } catch { /* 同上 */ }
      loadInfo = { recovered: true, reason };
    }
  }

  /**
   * id 重複を解決する (updatedAt が新しいほうを残す。同値なら先に出たほう)。
   * @param {object[]} list
   */
  function dedupe(list) {
    const map = new Map();
    let dropped = 0;
    for (const n of list) {
      const cur = map.get(n.id);
      if (!cur) map.set(n.id, n);
      else {
        dropped++;
        if (n.updatedAt > cur.updatedAt) map.set(n.id, n);
      }
    }
    return { list: [...map.values()], dropped };
  }

  /** @param {object[]} next */
  function persist(next) {
    const text = JSON.stringify({ version: SCHEMA_VERSION, notes: next });
    try {
      storage.setItem(STORAGE_KEY, text);
    } catch (err) {
      throw toStorageError(err);
    }
  }

  /** 保存に成功したときだけ内部状態を差し替える。 */
  function commit(next) {
    persist(next);
    notes = next;
  }

  load();

  return {
    list(opts) {
      const q = (opts?.query ?? '').trim().toLowerCase();
      const tag = opts?.tag ? normalizeTag(opts.tag) : '';
      return notes
        .filter((n) => !tag || n.tags.includes(tag))
        .filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
        .sort(byRecent)
        .map(copyNote);
    },

    get(id) {
      const n = notes.find((x) => x.id === id);
      return n ? copyNote(n) : null;
    },

    create(partial) {
      const body = checkBody(partial?.body ?? '');
      if (notes.length >= LIMITS.MAX_NOTES) {
        throw new StoreError(ERROR_CODES.VALIDATION, `メモは ${LIMITS.MAX_NOTES} 件までです`, {
          details: [`notes: ${LIMITS.MAX_NOTES} 件を超えます`],
        });
      }
      const t = now();
      const note = validateNote({ id: genId(), title: '', body, tags: [], createdAt: t, updatedAt: t });
      if (notes.some((n) => n.id === note.id)) {
        throw new StoreError(ERROR_CODES.VALIDATION, 'id が重複しています', { details: [`id: ${note.id}`] });
      }
      commit([...notes, note]);
      return copyNote(note);
    },

    update(id, patch) {
      const body = checkBody(patch?.body);
      const cur = notes.find((n) => n.id === id);
      if (!cur) throw new StoreError(ERROR_CODES.NOT_FOUND, 'メモが見つかりません');
      if (body === cur.body) return copyNote(cur);
      const t = now();
      const next = {
        ...cur,
        body,
        title: deriveTitle(body),
        tags: extractTags(body),
        updatedAt: Number.isSafeInteger(t) && t > cur.updatedAt ? t : cur.updatedAt + 1,
      };
      commit(notes.map((n) => (n === cur ? next : n)));
      return copyNote(next);
    },

    remove(id) {
      if (!notes.some((n) => n.id === id)) return false;
      commit(notes.filter((n) => n.id !== id));
      return true;
    },

    listTags() {
      const counts = new Map();
      for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
      return [...counts].map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
    },

    exportAll() {
      return { version: SCHEMA_VERSION, notes: [...notes].sort(byRecent).map(copyNote) };
    },

    importAll(json, opts) {
      const mode = opts?.mode;
      if (mode !== 'merge' && mode !== 'replace') {
        throw new StoreError(ERROR_CODES.VALIDATION, "mode は 'merge' か 'replace' を指定してください");
      }
      const { list: incoming, dropped } = dedupe(parseExportFile(json).notes);
      let next;
      let added = 0;
      let updated = 0;
      let skipped = dropped;
      if (mode === 'replace') {
        next = incoming;
        added = incoming.length;
      } else {
        const map = new Map(notes.map((n) => [n.id, n]));
        for (const n of incoming) {
          const cur = map.get(n.id);
          if (!cur) {
            map.set(n.id, n);
            added++;
          } else if (n.updatedAt > cur.updatedAt) {
            map.set(n.id, n);
            updated++;
          } else {
            skipped++;
          }
        }
        next = [...map.values()];
      }
      if (next.length > LIMITS.MAX_NOTES) {
        throw new StoreError(ERROR_CODES.VALIDATION, `メモは ${LIMITS.MAX_NOTES} 件までです`, {
          details: [`取り込み後に ${next.length} 件になり、上限 ${LIMITS.MAX_NOTES} 件を超えます`],
        });
      }
      commit(next);
      return { mode, added, updated, skipped, total: next.length };
    },

    getLoadInfo() {
      return { ...loadInfo };
    },
  };
}
