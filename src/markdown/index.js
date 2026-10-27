import { renderBlocks } from './block.js';
import { escapeHtml } from './escape.js';

/**
 * Markdown を安全な HTML 文字列に変換する。この関数が markdown モジュールの唯一の公開 API。
 * @param {string} src
 * @returns {string}
 */
export function render(src) {
  if (typeof src !== 'string') throw new TypeError('render: src must be a string');
  const normalized = src.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  try {
    return renderBlocks(normalized);
  } catch {
    // 想定外の失敗でも生の入力は出さない
    return `<p>${escapeHtml(normalized)}</p>`;
  }
}
