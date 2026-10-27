import { createEditor } from './editor.js';
import { createPreview } from './preview.js';
import { createSidebar } from './sidebar.js';
import { createIo } from './io.js';

const RECOVERED_MESSAGE = '保存データを読み込めなかったため退避し、空の状態で起動しました';
const UNAVAILABLE_MESSAGE = '保存領域を使えません。書き出しで退避してください。';
const STATUS_TEXT = { saved: '保存済み', dirty: '編集中…', error: '保存に失敗しました' };

/**
 * @typedef {Object} AppState
 * @property {object[]} notes
 * @property {{tag: string, count: number}[]} tags
 * @property {string|null} selectedId
 * @property {string} draft
 * @property {string} query
 * @property {string|null} tag
 * @property {'edit'|'preview'} view
 * @property {'saved'|'dirty'|'error'} saveStatus
 * @property {{code: string, message: string}|null} error
 * @property {boolean} recovered  起動時の復旧を知らせるバナーを出すか (ユーザーが閉じるまで残る)
 * @property {string|null} statusMessage  保存状態の代わりに出す一時メッセージ (次の saveStatus 変更まで)
 */

/** @returns {AppState} */
export function createInitialState() {
  return {
    notes: [],
    tags: [],
    selectedId: null,
    draft: '',
    query: '',
    tag: null,
    view: 'edit',
    saveStatus: 'saved',
    error: null,
    recovered: false,
    statusMessage: null,
  };
}

/**
 * store が投げた例外を、UI に出す {code, message} に変換する。
 * @param {unknown} err
 * @returns {{code: string, message: string}}
 */
export function toUiError(err) {
  const code = err && err.name === 'StoreError' && typeof err.code === 'string' ? err.code : 'UNKNOWN';
  switch (code) {
    case 'QUOTA_EXCEEDED':
      return {
        code,
        message: '保存できませんでした。ブラウザの保存容量がいっぱいです。『書き出し』でバックアップし、不要なメモを削除してください。',
      };
    case 'VALIDATION': {
      const details = Array.isArray(err.details) ? err.details.slice(0, 3) : [];
      return { code, message: [err.message, ...details].join(' ') };
    }
    case 'NOT_FOUND':
      return { code, message: 'メモが見つかりません。' };
    case 'STORAGE_UNAVAILABLE':
      return { code, message: UNAVAILABLE_MESSAGE };
    default:
      return { code: 'UNKNOWN', message: '予期しないエラーが発生しました。' };
  }
}

/**
 * アプリを起動する。
 * @param {{
 *   document: Document,
 *   store: object,
 *   render: (src: string) => string,
 *   confirm?: (message: string) => boolean,
 *   now?: () => number
 * }} deps
 * @returns {{getState: () => AppState, destroy: () => void}}
 */
export function startApp(deps) {
  const { document: doc, store, render: renderMarkdown } = deps;
  const confirmFn = deps.confirm ?? ((m) => globalThis.confirm(m));
  const now = deps.now ?? Date.now;
  const byId = (id) => doc.getElementById(id);

  const els = {
    app: byId('app'),
    btnNew: byId('btn-new'),
    btnDelete: byId('btn-delete'),
    saveStatus: byId('save-status'),
    liveRegion: byId('live-region'),
    importDialog: byId('import-dialog'),
    errorBanner: byId('error-banner'),
    errorText: byId('error-text'),
    errorClose: byId('error-close'),
    tabs: byId('tabs'),
    tabEdit: byId('tab-edit'),
    tabPreview: byId('tab-preview'),
  };

  let state = createInitialState();
  let recoveredMessage = RECOVERED_MESSAGE;

  const editor = createEditor({
    el: byId('editor'),
    doc,
    onInput: (body) => setState({ draft: body, saveStatus: 'dirty' }),
    onSave: (body) => saveNow(body),
    onShortcut: (name) => {
      if (els.importDialog.open) return;
      if (name === 'new') newNote();
      else sidebar.focusSearch();
    },
  });
  const preview = createPreview({ el: byId('preview'), render: renderMarkdown });
  const sidebar = createSidebar({
    searchEl: byId('search'),
    tagEl: byId('tag-filter'),
    listEl: byId('note-list'),
    emptyEl: byId('empty-message'),
    doc,
    onSelect: (id) => selectNote(id),
    onSearch: (query) => {
      setState({ query });
      refreshList();
    },
    onTag: (tag) => {
      setState({ tag });
      refreshList();
    },
  });
  const io = createIo({
    exportBtn: byId('btn-export'),
    importBtn: byId('btn-import'),
    fileInput: byId('import-file'),
    dialog: byId('import-dialog'),
    summaryEl: byId('import-summary'),
    mergeBtn: byId('import-merge'),
    replaceBtn: byId('import-replace'),
    cancelBtn: byId('import-cancel'),
    exportAll: () => store.exportAll(),
    importAll: (json, opts) => {
      if (!commitEdits()) throw Object.assign(new Error('save failed'), { aborted: true });
      return store.importAll(json, opts);
    },
    getNoteCount: () => store.list().length,
    onImported: (result) => onImported(result),
    onError: (err) => {
      if (err && err.aborted) return; // 保存失敗のエラーが既に表示されている
      setState({ error: toUiError(err) });
    },
    now,
  });

  function setState(patch) {
    const prev = state;
    state = { ...state, ...patch };
    if (patch.saveStatus !== undefined && patch.saveStatus !== prev.saveStatus && patch.statusMessage === undefined) {
      state.statusMessage = null;
    }
    renderView(prev, state);
  }

  function renderView(prev, next) {
    if (
      prev.notes !== next.notes || prev.tags !== next.tags || prev.selectedId !== next.selectedId ||
      prev.query !== next.query || prev.tag !== next.tag
    ) {
      sidebar.update(next);
    }
    if (prev.draft !== next.draft) preview.update(next.draft);
    if (prev.saveStatus !== next.saveStatus || prev.statusMessage !== next.statusMessage) {
      els.saveStatus.textContent = next.statusMessage ?? STATUS_TEXT[next.saveStatus];
      // 読み上げるのは失敗と読み込み結果だけ (自動保存のたびには読まない)
      els.liveRegion.textContent = next.statusMessage ?? (next.saveStatus === 'error' ? STATUS_TEXT.error : '');
    }
    if (prev.error !== next.error || prev.recovered !== next.recovered) {
      const text = next.error ? next.error.message : next.recovered ? recoveredMessage : '';
      els.errorBanner.hidden = text === '';
      els.errorText.textContent = text;
    }
    if (prev.view !== next.view) {
      els.app.dataset.view = next.view;
      for (const [tab, name] of [[els.tabEdit, 'edit'], [els.tabPreview, 'preview']]) {
        tab.setAttribute('aria-selected', String(next.view === name));
        tab.setAttribute('tabindex', next.view === name ? '0' : '-1');
      }
    }
  }

  /** store 呼び出しを包み、失敗したら error 状態にして undefined を返す。 */
  function guard(fn) {
    try {
      return fn();
    } catch (err) {
      setState({ error: toUiError(err) });
      return undefined;
    }
  }

  /** 一覧・タグを取り直す。選択中のタグがもう無ければ絞り込みを解除する。 */
  function listPatch() {
    const tags = store.listTags();
    const tag = state.tag !== null && tags.some((t) => t.tag === state.tag) ? state.tag : null;
    return { notes: store.list({ query: state.query, tag }), tags, tag };
  }

  function refreshList() {
    guard(() => setState(listPatch()));
  }

  /** 保存して成否を返す。選択中のメモが無い (起動時の作成に失敗した) ときは、その本文で作成を試みる。 */
  function saveNow(body) {
    try {
      if (state.selectedId === null) {
        const note = store.create({ body });
        setState({ selectedId: note.id, saveStatus: 'saved', error: null, ...listPatch() });
      } else {
        store.update(state.selectedId, { body });
        setState({ saveStatus: 'saved', error: null, ...listPatch() });
      }
      return true;
    } catch (err) {
      setState({ saveStatus: 'error', error: toUiError(err) });
      return false;
    }
  }

  /**
   * 保留中の編集を保存する。保存できていない編集が残るなら false (呼び出し側は切り替えを中断する)。
   */
  function commitEdits() {
    editor.flush();
    return state.saveStatus !== 'error';
  }

  function showNote(note) {
    setState({ selectedId: note.id, draft: note.body, saveStatus: 'saved' });
    editor.setValue(note.body);
    preview.flush();
  }

  function selectNote(id) {
    if (!commitEdits()) return;
    guard(() => {
      const note = store.get(id);
      if (note === null) {
        setState({ error: toUiError({ name: 'StoreError', code: 'NOT_FOUND' }), ...listPatch() });
        return;
      }
      showNote(note);
    });
  }

  function newNote() {
    if (!commitEdits()) return;
    if (state.selectedId !== null && state.draft === '') {
      // 空のメモが既にあるので、増やさずそこへ戻る
      setState({ view: 'edit' });
      editor.focus();
      return;
    }
    guard(() => {
      const note = store.create({ body: '' });
      setState({ selectedId: note.id, draft: '', saveStatus: 'saved', view: 'edit', ...listPatch() });
      editor.setValue('');
      preview.flush();
      editor.focus();
    });
  }

  /** 一覧の先頭 (絞り込み中で空なら全体の先頭) を選び、無ければ空メモを作る。 */
  function selectFirstOrCreate() {
    if (state.notes.length === 0 && (state.query !== '' || state.tag !== null)) {
      // 絞り込み結果が空なら、一覧に出ていないメモを選ばないよう絞り込みを解除する
      setState({ query: '', tag: null });
      setState(listPatch());
    }
    const first = state.notes[0] ?? store.create({ body: '' });
    showNote(first);
    setState(listPatch());
  }

  function deleteNote() {
    if (state.selectedId === null) return;
    if (!confirmFn('このメモを削除しますか?')) return;
    guard(() => {
      store.remove(state.selectedId);
      editor.cancelSave(); // 削除したメモへの保留中の自動保存を破棄する
      setState({ selectedId: null, ...listPatch() });
      selectFirstOrCreate();
    });
  }

  function onImported(result) {
    guard(() => {
      setState(listPatch());
      if (state.selectedId === null || store.get(state.selectedId) === null) selectFirstOrCreate();
      else {
        // 選択中のメモが置き換わった可能性があるので本文を読み直す
        showNote(store.get(state.selectedId));
      }
      setState({ statusMessage: `${result.added + result.updated} 件を読み込みました` });
    });
  }

  function setView(view) {
    if (view === 'preview') preview.flush();
    setState({ view });
  }

  const onTabsKey = (e) => {
    let view;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') view = state.view === 'edit' ? 'preview' : 'edit';
    else if (e.key === 'Home') view = 'edit';
    else if (e.key === 'End') view = 'preview';
    else return;
    e.preventDefault();
    setView(view);
    (view === 'edit' ? els.tabEdit : els.tabPreview).focus();
  };
  const onEditTab = () => setView('edit');
  const onPreviewTab = () => setView('preview');
  const onErrorClose = () => setState({ error: null, recovered: false });

  els.btnNew.addEventListener('click', newNote);
  els.btnDelete.addEventListener('click', deleteNote);
  els.tabs.addEventListener('keydown', onTabsKey);
  els.tabEdit.addEventListener('click', onEditTab);
  els.tabPreview.addEventListener('click', onPreviewTab);
  els.errorClose.addEventListener('click', onErrorClose);

  // 起動
  els.saveStatus.textContent = STATUS_TEXT.saved;
  try {
    const info = store.getLoadInfo();
    const patch = listPatch();
    setState(patch);
    if (info && info.recovered) {
      recoveredMessage = info.reason === 'unavailable' ? UNAVAILABLE_MESSAGE : RECOVERED_MESSAGE;
      setState({ recovered: true });
    }
    if (patch.notes.length === 0) {
      showNote(store.create({ body: '' }));
      setState(listPatch());
    } else {
      showNote(patch.notes[0]);
    }
  } catch (err) {
    // メモを作れないまま入力が捨てられないよう、保存できない状態を明示する
    setState({ error: toUiError(err), saveStatus: 'error' });
  }

  return {
    getState: () => state,
    destroy() {
      editor.destroy();
      preview.destroy();
      io.destroy();
      els.btnNew.removeEventListener('click', newNote);
      els.btnDelete.removeEventListener('click', deleteNote);
      els.tabs.removeEventListener('keydown', onTabsKey);
      els.tabEdit.removeEventListener('click', onEditTab);
      els.tabPreview.removeEventListener('click', onPreviewTab);
      els.errorClose.removeEventListener('click', onErrorClose);
    },
  };
}
