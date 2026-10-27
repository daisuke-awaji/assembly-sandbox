import { debounce } from '../util/debounce.js';

/**
 * プレビュー表示。render の結果 (安全な HTML 文字列) を el に流し込む。
 * @param {{
 *   el: HTMLElement,
 *   render: (src: string) => string,
 *   wait?: number,
 *   maxWait?: number,
 *   timers?: {setTimeout: Function, clearTimeout: Function}
 * }} opts
 * @returns {{update(src: string): void, flush(): void, destroy(): void}}
 */
export function createPreview(opts) {
  const { el, render, wait = 150, maxWait = 150, timers } = opts;
  let latest = '';

  const draw = () => {
    let html;
    try {
      html = render(latest);
    } catch {
      el.textContent = 'プレビューを表示できません';
      return;
    }
    el.innerHTML = html; // lint-allow: innerHTML
  };
  // 入力が wait 未満の間隔で続いても、maxWait ごとには更新する
  const schedule = debounce(draw, wait, timers, { maxWait });

  return {
    update(src) {
      latest = src;
      schedule();
    },
    flush() {
      schedule.cancel();
      draw();
    },
    destroy() {
      schedule.cancel();
    },
  };
}
