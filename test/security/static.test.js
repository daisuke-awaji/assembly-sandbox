import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));

const PATTERNS = [
  ['innerHTML', /\binnerHTML\b/],
  ['outerHTML', /\bouterHTML\b/],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['document.write', /\bdocument\s*\.\s*write(ln)?\b/],
  ['eval', /\beval\s*\(/],
  ['new Function', /\bnew\s+Function\b/],
  ['Function(', /\bFunction\s*\(/],
  ['動的 import', /\bimport\s*\(/],
  ['外部リソース (from URL)', /from\s+['"]https?:/],
  ['外部リソース (fetch)', /\bfetch\s*\(/],
  ['外部リソース (XMLHttpRequest)', /\bXMLHttpRequest\b/],
  ['外部リソース (WebSocket)', /\bWebSocket\b/],
  ['外部リソース (sendBeacon)', /\bsendBeacon\b/],
  ['文字列のタイマー', /\bset(Timeout|Interval)\s*\(\s*['"`]/],
];

const ALLOW_MARK = 'lint-allow: innerHTML';
const ALLOW_FILE = path.join('src', 'ui', 'preview.js');

async function sourceFiles() {
  const entries = await readdir(path.join(root, 'src'), { recursive: true });
  return entries.filter((f) => f.endsWith('.js')).sort().map((f) => path.join('src', f));
}

/** 行ごとに検査し、違反を "ファイル:行番号: パターン名" で返す。 */
export function scan(file, text) {
  const violations = [];
  const allowed = [];
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      if (!re.test(line)) continue;
      if (name === 'innerHTML' && file === ALLOW_FILE && line.includes(ALLOW_MARK)) {
        allowed.push({ file, line: i + 1, text: line });
        continue;
      }
      violations.push(`${file}:${i + 1}: ${name}`);
    }
  });
  return { violations, allowed };
}

test('src/ に禁止 API が無い (innerHTML は preview.js の 1 行のみ許可)', async () => {
  const files = await sourceFiles();
  assert.ok(files.length > 0, 'src/ に .js が見つからない');
  const violations = [];
  const allowed = [];
  for (const f of files) {
    const r = scan(f, await readFile(path.join(root, f), 'utf8'));
    violations.push(...r.violations);
    allowed.push(...r.allowed);
  }
  assert.equal(violations.length, 0, `禁止パターンの違反:\n${violations.join('\n')}`);
  assert.equal(allowed.length, 1, `免除行はちょうど 1 行であること (現在 ${allowed.length} 行)`);
  assert.match(allowed[0].text, /\.innerHTML\s*=/, '免除行は .innerHTML = の代入であること');
});

test('scan: 免除は preview.js の免除マーク付き行だけ', () => {
  const line = 'el.innerHTML = html; // lint-allow: innerHTML';
  assert.equal(scan(ALLOW_FILE, line).violations.length, 0);
  assert.equal(scan(path.join('src', 'ui', 'app.js'), line).violations.length, 1);
  assert.equal(scan(ALLOW_FILE, 'el.innerHTML = html;').violations.length, 1);
  assert.equal(scan(ALLOW_FILE, 'el.outerHTML = html; // lint-allow: innerHTML').violations.length, 1);
  assert.equal(scan('src/x.js', '// eval(x)').violations.length, 1);
  assert.equal(scan('src/x.js', 'setTimeout("a", 1)').violations.length, 1);
  assert.equal(scan('src/x.js', 'setTimeout(fn, 1)').violations.length, 0);
});

test('index.html: インライン実行・style・CSP', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const problems = [];
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\bsrc\s*=/.test(m[0])) problems.push(`インライン script: ${m[0]}`);
  }
  if (/style\s*=\s*["']/i.test(html)) problems.push('style 属性');
  if (/\son\w+\s*=/i.test(html)) problems.push('イベントハンドラ属性');
  if (/<style\b/i.test(html)) problems.push('<style> 要素');
  assert.deepEqual(problems, []);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; form-action 'none'">/);
  assert.match(html, /<script type="module" src="src\/ui\/main\.js"><\/script>/);
  await access(path.join(root, 'src/ui/main.js'));
  await access(path.join(root, 'assets/style.css'));
});

test('package.json: 依存が空', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
  assert.deepEqual(Object.keys(pkg.devDependencies ?? {}), []);
});

test('assets/style.css: 外部読み込みが無い', async () => {
  const css = await readFile(path.join(root, 'assets/style.css'), 'utf8');
  assert.doesNotMatch(css, /@import/);
  assert.doesNotMatch(css, /url\(\s*['"]?http/i);
});

test('src/ui にテスト専用モックが無い', async () => {
  await assert.rejects(access(path.join(root, 'src/ui/mocks.js')));
});

test('assets/style.css: 入力欄・ボタンの枠線は背景に対し 3:1 以上 (WCAG 1.4.11)', async () => {
  const css = await readFile(path.join(root, 'assets/style.css'), 'utf8');
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const blocks = [css.match(/:root \{([^}]*)\}/)[1], css.match(/dark\) \{\s*:root \{([^}]*)\}/)[1]];
  const v = (b, n) => b.match(new RegExp(`--${n}: (#[0-9a-f]{6})`))[1];
  for (const b of blocks) {
    for (const bg of ['bg', 'panel']) assert.ok(ratio(v(b, 'control-border'), v(b, bg)) >= 3, bg);
  }
  assert.match(css, /button, input, textarea \{[^}]*border: 1px solid var\(--control-border\)/);
  assert.equal((css.match(/#error-banner\[hidden\]/g) ?? []).length, 0);
});
