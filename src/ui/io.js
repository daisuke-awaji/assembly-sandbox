const MAX_FILE_SIZE = 20000000;

const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * 書き出しファイル名。UTC の日時を使う。
 * @param {number} nowMs
 * @returns {string}  例 "mdmemo-20261027-153045.json"
 */
export function exportFileName(nowMs) {
  const d = new Date(nowMs);
  const date = `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `mdmemo-${date}-${time}.json`;
}

function defaultDownload(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 書き出し・読み込み。
 * @param {object} opts  design.md §5.3 の io.js を参照
 * @returns {{destroy(): void}}
 */
export function createIo(opts) {
  const {
    exportBtn, importBtn, fileInput, dialog, summaryEl, mergeBtn, replaceBtn, cancelBtn,
    exportAll, importAll, getNoteCount, onImported, onError,
  } = opts;
  const now = opts.now ?? Date.now;
  const download = opts.download ?? defaultDownload;

  let pendingText = null;

  const handleExport = () => {
    try {
      download(exportFileName(now()), JSON.stringify(exportAll(), null, 2));
    } catch (err) {
      onError(err);
    }
  };

  const handleImportClick = () => fileInput.click();

  const handleChange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      fileInput.value = '';
      onError({ name: 'StoreError', code: 'VALIDATION', message: 'ファイルが大きすぎます', details: [] });
      return;
    }
    try {
      pendingText = await file.text();
    } catch (err) {
      fileInput.value = '';
      onError(err);
      return;
    }
    summaryEl.textContent =
      `${file.name} (${formatSize(file.size)})。現在のメモ ${getNoteCount()} 件。` +
      '『統合』は同じ id の新しいほうを残して追加、『上書き』は現在のメモを全て削除します。';
    dialog.returnValue = '';
    dialog.showModal();
  };

  const handleClose = () => {
    const text = pendingText;
    const value = dialog.returnValue;
    pendingText = null;
    fileInput.value = '';
    if (text === null || (value !== 'merge' && value !== 'replace')) return;
    let result;
    try {
      result = importAll(text, { mode: value });
    } catch (err) {
      onError(err);
      return;
    }
    onImported(result);
  };

  const closeWith = (value) => () => dialog.close(value);
  const onMerge = closeWith('merge');
  const onReplace = closeWith('replace');
  const onCancel = closeWith('cancel');

  exportBtn.addEventListener('click', handleExport);
  importBtn.addEventListener('click', handleImportClick);
  fileInput.addEventListener('change', handleChange);
  dialog.addEventListener('close', handleClose);
  mergeBtn.addEventListener('click', onMerge);
  replaceBtn.addEventListener('click', onReplace);
  cancelBtn.addEventListener('click', onCancel);

  return {
    destroy() {
      exportBtn.removeEventListener('click', handleExport);
      importBtn.removeEventListener('click', handleImportClick);
      fileInput.removeEventListener('change', handleChange);
      dialog.removeEventListener('close', handleClose);
      mergeBtn.removeEventListener('click', onMerge);
      replaceBtn.removeEventListener('click', onReplace);
      cancelBtn.removeEventListener('click', onCancel);
    },
  };
}
