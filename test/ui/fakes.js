// テスト用の最小の偽 DOM とタイマー。
export function fakeTimers() {
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimeout(fn, ms) { const id = nextId++; tasks.set(id, { fn, ms }); return id; },
    clearTimeout(id) { tasks.delete(id); },
    fireAll() { for (const [id, t] of [...tasks]) { if (!tasks.has(id)) continue; tasks.delete(id); t.fn(); } },
    count: () => tasks.size,
  };
}

export function fakeTarget(extra = {}) {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, event = {}) { for (const fn of [...(listeners.get(type) ?? [])]) fn(event); },
    listenerCount(type) { return listeners.get(type)?.size ?? 0; },
    ...extra,
  };
}

export function keyEvent(key, mods = {}) {
  const e = { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods, prevented: false };
  e.preventDefault = () => { e.prevented = true; };
  return e;
}
