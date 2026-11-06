'use strict';
// Free-stack "forms" pass: read "Label: value" pairs from OCR lines (Tesseract in the browser).
// It only understands one label per line with a colon, which is how our SPECIMEN form is printed.
// Real BPI forms would need their own layout map (a pilot task).

/** lines: [{ text, conf }] -> { 'label': { value, conf } } */
function formFromLines(lines) {
  const kv = {};
  for (const l of lines || []) {
    const m = /^\s*([A-Za-z][A-Za-z ()'/.-]{1,40}?)\s*:\s*(.*)$/.exec(String(l.text || ''));
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].replace(/_{2,}/g, '').trim();
    const val = { value, conf: typeof l.conf === 'number' ? l.conf : 0 };
    if (!kv[key] || (!kv[key].value && val.value)) kv[key] = val; // keep the first non-empty value
  }
  return kv;
}

module.exports = { formFromLines };
