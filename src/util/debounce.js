/**
 * trailing 方式のデバウンス。呼び出しが wait ms 途切れたら、最後の引数で fn を 1 回呼ぶ。
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} wait  ミリ秒 (0 以上)
 * @param {{setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout}} [timers]
 * @param {{maxWait?: number}} [options]  maxWait: 呼び出しが続いても、最初の呼び出しから maxWait ms 以内に 1 回は fn を呼ぶ
 * @returns {F & {cancel(): void, flush(): void, pending(): boolean}}
 */
export function debounce(fn, wait, timers, options) {
  const set = timers?.setTimeout ?? ((...a) => globalThis.setTimeout(...a));
  const clear = timers?.clearTimeout ?? ((id) => globalThis.clearTimeout(id));
  const maxWait = options?.maxWait;
  let handle = null;
  let maxHandle = null;
  let waiting = false;
  let lastArgs = [];

  const clearTimers = () => {
    if (handle !== null) clear(handle);
    if (maxHandle !== null) clear(maxHandle);
    handle = null;
    maxHandle = null;
  };

  const run = () => {
    clearTimers();
    waiting = false;
    const args = lastArgs;
    lastArgs = [];
    fn(...args);
  };

  const debounced = (...args) => {
    lastArgs = args;
    if (handle !== null) clear(handle);
    waiting = true;
    handle = set(run, wait);
    if (maxWait !== undefined && maxHandle === null) maxHandle = set(run, maxWait);
  };
  debounced.cancel = () => {
    clearTimers();
    waiting = false;
    lastArgs = [];
  };
  debounced.flush = () => {
    if (!waiting) return;
    run();
  };
  debounced.pending = () => waiting;
  return debounced;
}
