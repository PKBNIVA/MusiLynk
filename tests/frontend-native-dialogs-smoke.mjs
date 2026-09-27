import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Native window.prompt/confirm/alert are hard to use with a screen reader, cannot be validated
// or styled, and are blocked in some in-app browsers. Use the in-app dialogs instead
// (components/ReportDialog, components/booking/BookingDialogs useConfirm/FormDialog).
const native = /\bwindow\.(prompt|confirm|alert)\s*\(|(^|[^.\w])(prompt|confirm|alert)\s*\(/;
const root = new URL('../src/', import.meta.url).pathname;
const offenders = [];
for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(tsx?|jsx?)$/.test(entry.name)) continue;
  const file = join(entry.parentPath ?? entry.path, entry.name);
  (await readFile(file, 'utf8')).split('\n').forEach((line, index) => {
    if (native.test(line.replace(/\/\/.*$/, ''))) offenders.push(`${file.slice(root.length)}:${index + 1}`);
  });
}
assert.deepEqual(offenders, [], `Native browser dialogs found:\n${offenders.join('\n')}`);

// The pattern itself still catches the calls it is meant to catch.
for (const sample of ["window.prompt('x')", "if(!window.confirm(`Delete?`))return", "alert('hi')", ";confirm('sure?')"]) {
  assert.match(sample, native, sample);
}
for (const sample of ['confirm.ask({title})', 'const confirm = useConfirm()']) {
  assert.doesNotMatch(sample, native, sample);
}
console.log('native dialog smoke passed');
