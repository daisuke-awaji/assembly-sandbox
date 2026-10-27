// ストレージ抽象。localStorage のラッパーとテスト用のメモリ実装。

/**
 * @typedef {Object} Storage
 * @property {(key: string) => string|null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 */

/**
 * localStorage のラッパー。生成時に例外を投げない。
 * 各メソッドは backend の例外をそのまま伝える。
 * @param {Storage} [backend=globalThis.localStorage]
 * @returns {Storage}
 */
export function createLocalStorage(backend) {
  let target = backend;
  let failure = null;
  if (target === undefined) {
    try {
      target = globalThis.localStorage;
    } catch (err) {
      failure = err;
    }
  }
  const get = () => {
    if (target === undefined || target === null) {
      throw failure ?? Object.assign(new Error('storage unavailable'), { name: 'SecurityError' });
    }
    return target;
  };
  return {
    getItem: (key) => get().getItem(key),
    setItem: (key, value) => get().setItem(key, value),
    removeItem: (key) => get().removeItem(key),
  };
}

/**
 * テスト用のメモリ実装。
 * @param {Record<string,string>} [initial={}]
 * @param {{quotaChars?: number}} [opts]
 * @returns {Storage & {dump(): Record<string,string>}}
 */
export function createMemoryStorage(initial = {}, opts = {}) {
  const quota = opts.quotaChars ?? Infinity;
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      const v = String(value);
      let total = v.length;
      for (const [k, cur] of map) if (k !== key) total += cur.length;
      if (total > quota) {
        throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      }
      map.set(key, v);
    },
    removeItem(key) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map);
    },
  };
}
