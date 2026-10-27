// 保存データ・書き出しファイルの検証と正規化。

import { deriveTitle, extractTags } from './tags.js';

const MAX_TIME = 8.64e15; // Date が表現できる上限

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'mdmemo:v1:notes';
export const CORRUPT_KEY = 'mdmemo:v1:corrupt';

export const LIMITS = Object.freeze({
  MAX_TITLE: 200,
  MAX_BODY: 1048576,
  MAX_NOTES: 5000,
  MAX_TAGS_PER_NOTE: 50,
  MAX_TAG_LENGTH: 50,
  MAX_ID_LENGTH: 100,
  MAX_IMPORT_CHARS: 20000000,
});

export const ERROR_CODES = Object.freeze({
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
});

const MAX_DETAILS = 20;
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export class StoreError extends Error {
  /**
   * @param {keyof typeof ERROR_CODES} code
   * @param {string} message
   * @param {{details?: string[], cause?: unknown}} [opts]
   */
  constructor(code, message, opts) {
    super(message, opts && opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'StoreError';
    this.code = code;
    this.details = ((opts && opts.details) || []).slice(0, MAX_DETAILS);
  }
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 値のどの階層にも禁止キーが own property として無いか (反復で走査。循環にも耐える)。
 * @param {unknown} root
 * @param {string} [skipKey]  root 直下でこのキーの中身は調べない
 * @returns {boolean} 禁止キーがあれば true
 */
function hasForbiddenKey(root, skipKey) {
  const stack = [root];
  const seen = new Set();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (typeof cur !== 'object' || cur === null || seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    for (const k of FORBIDDEN_KEYS) if (Object.hasOwn(cur, k)) return true;
    for (const k of Object.keys(cur)) if (cur !== root || k !== skipKey) stack.push(cur[k]);
  }
  return false;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} key
 */
function own(obj, key) {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/**
 * validateNote の本体。エラーは errors に積み、検証できたら Note を返す。
 * @param {unknown} value
 * @param {string} path
 * @param {string[]} errors
 * @returns {object|null}
 */
function checkNote(value, path, errors) {
  if (!isObject(value)) {
    errors.push(`${path}: オブジェクトではありません`);
    return null;
  }
  const before = errors.length;
  if (hasForbiddenKey(value)) {
    errors.push(`${path}: 使用できないキーが含まれています`);
    return null;
  }
  const id = own(value, 'id');
  const title = own(value, 'title');
  const body = own(value, 'body');
  const tags = own(value, 'tags');
  const createdAt = own(value, 'createdAt');
  const updatedAt = own(value, 'updatedAt');

  if (typeof id !== 'string') errors.push(`${path}.id: 文字列ではありません`);
  else if (!ID_RE.test(id)) errors.push(`${path}.id: 使用できない文字、または 1〜${LIMITS.MAX_ID_LENGTH} 文字の範囲外です`);

  if (typeof title !== 'string') errors.push(`${path}.title: 文字列ではありません`);
  else if (title.length > LIMITS.MAX_TITLE) errors.push(`${path}.title: ${LIMITS.MAX_TITLE} 文字を超えています`);

  if (typeof body !== 'string') errors.push(`${path}.body: 文字列ではありません`);
  else if (body.length > LIMITS.MAX_BODY) errors.push(`${path}.body: ${LIMITS.MAX_BODY} 文字を超えています`);

  if (!Array.isArray(tags)) {
    errors.push(`${path}.tags: 配列ではありません`);
  } else if (tags.length > LIMITS.MAX_TAGS_PER_NOTE) {
    errors.push(`${path}.tags: ${LIMITS.MAX_TAGS_PER_NOTE} 個を超えています`);
  } else {
    for (let i = 0; i < tags.length; i++) {
      if (typeof tags[i] !== 'string') errors.push(`${path}.tags[${i}]: 文字列ではありません`);
      else if (tags[i].length > LIMITS.MAX_TAG_LENGTH) errors.push(`${path}.tags[${i}]: ${LIMITS.MAX_TAG_LENGTH} 文字を超えています`);
    }
  }

  for (const [name, v] of [['createdAt', createdAt], ['updatedAt', updatedAt]]) {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > MAX_TIME) {
      errors.push(`${path}.${name}: 0 以上 ${MAX_TIME} 以下の整数ではありません`);
    }
  }

  if (errors.length > before) return null;
  return {
    id,
    title: deriveTitle(body),
    body,
    tags: extractTags(body),
    createdAt: createdAt + 0,
    updatedAt: updatedAt + 0,
  };
}

/**
 * 1 件のメモを検証して正規化する。
 * @param {unknown} value
 * @param {string} [path='note']
 * @returns {object} Note
 * @throws {StoreError} VALIDATION
 */
export function validateNote(value, path = 'note') {
  const errors = [];
  const note = checkNote(value, path, errors);
  if (!note) throw new StoreError(ERROR_CODES.VALIDATION, 'メモのデータが不正です', { details: errors });
  return note;
}

/**
 * ExportFile を検証して正規化する。
 * @param {unknown} value
 * @returns {{version: 1, notes: object[]}}
 * @throws {StoreError} VALIDATION
 */
export function validateExportFile(value) {
  const fail = (details) => new StoreError(ERROR_CODES.VALIDATION, '読み込みデータの形式が不正です', { details });
  if (!isObject(value)) throw fail(['(最上位): オブジェクトではありません']);
  if (hasForbiddenKey(value, 'notes')) throw fail(['(最上位): 使用できないキーが含まれています']);
  if (own(value, 'version') !== SCHEMA_VERSION) {
    throw fail([`version: ${SCHEMA_VERSION} のみ対応しています`]);
  }
  const notes = own(value, 'notes');
  if (!Array.isArray(notes)) throw fail(['notes: 配列ではありません']);
  if (notes.length > LIMITS.MAX_NOTES) {
    throw fail([`notes: ${LIMITS.MAX_NOTES} 件を超えています (${notes.length} 件)`]);
  }
  const errors = [];
  const out = [];
  for (let i = 0; i < notes.length; i++) {
    const n = checkNote(notes[i], `notes[${i}]`, errors);
    if (n) out.push(n);
    if (errors.length >= MAX_DETAILS) break;
  }
  if (errors.length > 0) throw fail(errors);
  return { version: SCHEMA_VERSION, notes: out };
}

/**
 * JSON 文字列 → ExportFile。
 * @param {string} text
 * @returns {{version: 1, notes: object[]}}
 * @throws {StoreError} VALIDATION
 */
export function parseExportFile(text) {
  if (typeof text !== 'string') {
    throw new StoreError(ERROR_CODES.VALIDATION, '読み込みデータが文字列ではありません', { details: [] });
  }
  if (text.length > LIMITS.MAX_IMPORT_CHARS) {
    throw new StoreError(ERROR_CODES.VALIDATION, 'ファイルが大きすぎます', {
      details: [`${LIMITS.MAX_IMPORT_CHARS} 文字を超えています`],
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new StoreError(ERROR_CODES.VALIDATION, 'JSON として読み込めません', { cause: err });
  }
  return validateExportFile(parsed);
}
