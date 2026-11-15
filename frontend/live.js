// Counter Check live prototype. Branch view (default) and BSO view (?role=bso).
// With ?stack=free, OCR runs in this browser with Tesseract.js, so photos never leave the device and only the lines of text do.
// By default the photos go to the AWS backend (S3, Textract and Bedrock). ?stack=free reads them in the browser and uses Gemini. Synthetic documents only.
'use strict';

const params = new URLSearchParams(location.search);
const role = params.get('role') === 'bso' ? 'bso' : 'bm';
const stack = params.get('stack') === 'free' ? 'free' : 'aws';
const stackQuery = stack === 'free' ? '&stack=free' : '';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  ok: '<svg viewBox="0 0 24 24" class="ok" aria-hidden="true"><path d="M5 12l5 5 9-11"/></svg>',
  bad: '<svg viewBox="0 0 24 24" class="bad" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  warn: '<svg viewBox="0 0 24 24" class="warn" aria-hidden="true"><path d="M12 8v5M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6"/></svg>',
};
const DOC_LABELS = { '': 'Auto', application_form: 'Application form', gov_id: 'Government ID', spouse_id: 'Spouse ID', registration: 'DTI or SEC registration', business_permit: "Mayor's permit", itr: 'Income tax return', financials: 'Financial statements', audited_fs: 'Audited FS', bank_statements: 'Bank statement', articles: 'Articles', bylaws: 'By-laws', gis: 'GIS', collateral: 'Collateral' };
const statusClass = (s) => (s === 'Missing requirements' || s === 'Returned by BSO' ? 'missing' : s === 'Ready for BSO review' ? 'ready' : s === 'With BSO' ? 'with' : s === 'Endorsed to Credit' ? 'ready' : '');

// ---- demo key: optional, a caller with the key is not rate limited ----
const demoKey = params.get('key') || (() => { try { return localStorage.getItem('cc-key') || ''; } catch { return ''; } })();
if (params.get('key')) { try { localStorage.setItem('cc-key', demoKey); } catch { /* private mode */ } }
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-demo-key': demoKey }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// ---- role switch ----
const caseId = () => (role === 'bm' ? $('f-id').value.trim() : $('b-id').value.trim());
function navLinks() {
  const id = encodeURIComponent(caseId() || 'RF-2026-042');
  $('nav-bm').href = `?id=${id}${stackQuery}`; $('nav-bso').href = `?role=bso&id=${id}${stackQuery}`;
  $(role === 'bm' ? 'nav-bm' : 'nav-bso').setAttribute('aria-current', 'page');
}
for (const id of role === 'bm' ? ['bm-left', 'bm-right'] : ['bso-left', 'bso-right']) $(id).classList.remove('hidden');
// a branch link without a case number gets its own random one, so visitors do not share a case
const freshCase = role === 'bm' && !params.get('id');
const randomId = () => `RF-2026-${300 + Math.floor(Math.random() * 500)}`;
if (freshCase) { params.set('id', randomId()); history.replaceState(null, '', `?${params}`); }
if (params.get('id')) { $('f-id').value = params.get('id'); $('b-id').value = params.get('id'); }
navLinks();

function checklistHtml(rows) {
  return rows.map((r) => `<li>${ICON.doc}<span>${esc(r.title)}${r.reason ? ` <span class="src">(because: ${esc(r.reason)})</span>` : ''}<br>${r.sourceUrl
    ? `<a class="chip" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Source: BPI public page</a>`
    : r.source === 'J1' ? `<span class="chip" title="${esc(r.sourceTitle)}">Source: BSO checklist</span>`
    : '<span class="chip assumed">Team assumption, BSO confirms</span>'}</span><span></span></li>`).join('');
}
// a button shows a spinner and its own label while its request runs, and comes back as it was
function busy(btn, label) {
  const html = btn.innerHTML, was = btn.disabled;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(label)}`;
  return () => { btn.innerHTML = html; btn.removeAttribute('aria-busy'); btn.disabled = was; };
}
const skelLines = (n) => Array.from({ length: n }, (_, i) => `<li><span></span><span><span class="skel ${['w80', 'w60', 'w40'][i % 3]}"></span></span><span></span></li>`).join('');
const headsUpScope = (l) => (l.industry ? `${l.type}, ${l.industry}` : l.type || 'All cases');

// ================= Branch view =================
if (role === 'bm') {
  const pages = []; // { file, url, lines, conf, status, label }
  let lastView = null;

  const referral = () => ({
    id: $('f-id').value.trim(), business: $('f-business').value, name: $('f-name').value, type: $('f-type').value,
    industry: $('f-industry').value, amount: Number(String($('f-amount').value).replace(/[^\d.]/g, '')),
    civilStatus: $('f-civil').value, spouseName: $('f-civil').value === 'married' ? $('f-spouse').value : '', secured: $('f-secured').checked,
    bpiAccount: $('f-bpi').checked, channel: $('f-channel').value,
  });
  $('f-civil').onchange = () => { $('f-spouse').disabled = $('f-civil').value !== 'married'; };

  async function saveCase() {
    const done = busy($('save-case'), 'Saving');
    try {
      const v = await api('POST', '/api/case', { referral: referral() });
      lastView = v; navLinks(); loadCases();
      renderChecklist(v);
      done(); toast(`Case saved. The checklist has ${v.rules.rows.length} papers.`);
      $('run-check').disabled = pages.length === 0 || pages.some((x) => !x.lines);
    } catch (e) { done(); alertInline(e.message); }
  }
  function renderChecklist(v) {
    $('checklist').innerHTML = checklistHtml(v.rules.rows);
    $('req-count').textContent = `${v.rules.rows.length} papers`;
    $('rules-note').textContent = `Rules version ${v.rules.version}. Rows marked BSO checklist are what the BSO expects from the branch at referral. The other rows come from BPI's public page, which BPI calls indicative.`;
    $('headsup-box').classList.toggle('hidden', !v.headsUp.length);
    $('headsup').innerHTML = v.headsUp.map((l) => `<li>${ICON.warn}<span>${esc(l.text)}</span><span></span></li>`).join('');
  }
  $('save-case').onclick = saveCase;

  // ---- note intake: the AI fills the form and the branch confirms it ----
  const INTAKE = { business: ['f-business', 'business name'], name: ['f-name', 'owner'], type: ['f-type', 'business structure'], industry: ['f-industry', 'industry'], amount: ['f-amount', 'loan amount'], civilStatus: ['f-civil', 'civil status'], spouseName: ['f-spouse', 'spouse name'], secured: ['f-secured', 'collateral'], bpiAccount: ['f-bpi', 'BPI account'] };
  for (const [id] of Object.values(INTAKE)) $(id).addEventListener('input', (e) => e.target.classList.remove('ai'));
  // ---- assistant: fill the form from a note, or ask about the saved case ----
  let mode = 'fill';
  const SAMPLE = $('chat-in').value;
  const HINT = {
    fill: 'Tell it what the client said. It fills the form below, and you check it before you save.',
    ask: 'Ask about the saved case, for example what is still missing or why the BSO sent it back.',
  };
  const say = (who, text) => { const b = document.createElement('div'); b.className = `bubble ${who}`; b.textContent = text; $('chat-log').append(b); $('chat-log').scrollTop = $('chat-log').scrollHeight; return b; };
  const setMode = (m) => {
    mode = m;
    $('mode-fill').setAttribute('aria-pressed', m === 'fill'); $('mode-ask').setAttribute('aria-pressed', m === 'ask');
    $('chat-hint').textContent = HINT[m];
    const v = $('chat-in').value;
    if (m === 'ask' && (!v.trim() || v === SAMPLE)) $('chat-in').value = 'Ano pa ang kulang?';
    if (m === 'fill' && v === 'Ano pa ang kulang?') $('chat-in').value = '';
    $('chat-in').focus();
  };
  $('mode-fill').onclick = () => setMode('fill');
  $('mode-ask').onclick = () => setMode('ask');
  async function fill(text, wait) {
    const { fields, model } = await api('POST', '/api/intake', { text, stack });
    if (fields.name || fields.business) { for (const id of ['f-business', 'f-name', 'f-spouse', 'f-amount']) $(id).value = ''; for (const id of ['f-secured', 'f-bpi']) $(id).checked = false; } // a new client clears the last one's values, a correction keeps them
    for (const [k, [id]] of Object.entries(INTAKE)) {
      const el = $(id); el.classList.toggle('ai', k in fields);
      if (k in fields) { if (el.type === 'checkbox') el.checked = fields[k]; else el.value = fields[k]; }
    }
    $('f-civil').onchange();
    const missing = Object.entries(INTAKE).filter(([k, [id]]) => !(k in fields) && $(id).type !== 'checkbox' && !$(id).value).map(([, [, label]]) => label);
    const n = Object.keys(fields).length;
    wait.textContent = `I filled ${n} field${n === 1 ? '' : 's'} from your note (${/claude/i.test(model) ? 'Claude Haiku' : /gemini/i.test(model) ? 'Gemini' : model}). Check the highlighted ones, then save the case.${missing.length ? ` I did not fill ${missing.join(', ')}.` : ''}`;
  }
  async function ask(question, wait) {
    const v = await api('POST', '/api/ask', { id: caseId(), question, stack });
    wait.textContent = v.answer + (v.handoff ? '\n\nI handed this to a person.' : '');
  }
  async function send() {
    const text = $('chat-in').value.trim(); if (!text) return;
    say('me', text); $('chat-in').value = ''; $('chat-send').disabled = true;
    const wait = say('bot wait dots', mode === 'fill' ? 'Reading your note' : 'Checking the case');
    try { await (mode === 'fill' ? fill(text, wait) : ask(text, wait)); } catch (e) { wait.textContent = e.message === 'unknown referral' ? 'Save the case first, then ask about it.' : e.message; }
    wait.classList.remove('wait', 'dots'); $('chat-send').disabled = false;
  }
  $('chat-send').onclick = send;
  $('chat-in').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  if (stack === 'free') $('photo-note').textContent = 'Photos stay on this device. Only the text read from them is sent.';
  const switchLink = () => `?id=${encodeURIComponent(caseId() || 'RF-2026-042')}${stack === 'aws' ? '&stack=free' : ''}`;
  $('stack-switch').innerHTML = stack === 'aws'
    ? `Reading with Amazon Textract and Claude on Amazon Bedrock. <a href="${switchLink()}">Switch to the browser reader</a>`
    : `Reading in this browser, with Gemini for IDs and permits. <a href="${switchLink()}">Switch to Textract and Bedrock on AWS</a>`;

  // ---- photos and OCR ----
  let worker = null;
  async function getWorker() {
    if (!worker) worker = await Tesseract.createWorker('eng', 1, { logger: (m) => { if (m.status === 'recognizing text' && current) setBar(current, m.progress); } });
    return worker;
  }
  let current = null;
  function setBar(p, x) { const el = document.querySelector(`[data-page="${p.n}"] .bar i`); if (el) el.style.transform = `scaleX(${x})`; }
  async function downscale(file, max = 1800) {
    const img = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  let counter = 0;
  const markStale = (text = 'These results are from the last check. The photos changed since then, so press Check documents again.') => { if ($('result').classList.contains('hidden')) return; $('stale').textContent = text; $('stale').classList.remove('hidden'); };
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
  let pdfLib;
  async function pdfPages(file) { // each PDF page becomes a JPEG, the same as a photo
    if (!pdfLib) {
      await new Promise((ok, no) => { const el = document.createElement('script'); el.src = PDFJS + 'pdf.min.js'; el.onload = ok; el.onerror = no; document.head.append(el); });
      pdfLib = window.pdfjsLib; pdfLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    }
    const doc = await pdfLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    for (let i = 1; i <= Math.min(doc.numPages, 20); i++) {
      const page = await doc.getPage(i), vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      if (blob) out.push(new File([blob], `${file.name}-page-${i}.jpg`, { type: 'image/jpeg' }));
    }
    if (doc.numPages > 20) alertInline(`Only the first 20 pages of ${file.name} were added.`);
    return out;
  }
  async function addFiles(chosen) {
    markStale();
    const files = [];
    for (const f of chosen) {
      if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { files.push(f); continue; }
      try { files.push(...(await pdfPages(f))); } catch { alertInline(`Could not open ${f.name}. Take a photo of the page instead.`); }
    }
    for (const file of files) {
      const p = { n: ++counter, file, url: URL.createObjectURL(file), lines: null, status: 'Reading', label: '' };
      pages.push(p); renderPages();
    }
    if (stack === 'aws') { for (const p of pages.filter((x) => !x.lines)) { p.lines = []; p.status = 'Ready to upload'; } renderPages(); } // Textract reads the photo, so there is no OCR here
    for (const p of pages.filter((x) => !x.lines)) {
      current = p;
      try {
        const w = await getWorker();
        const { data } = await w.recognize(await downscale(p.file));
        p.lines = (data.lines || []).map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim().slice(0, 300), conf: Math.max(0, Math.min(1, (l.confidence || 0) / 100)) })).filter((l) => l.text).slice(0, 300);
        p.status = `${p.lines.length} lines read`;
      } catch (e) { p.lines = []; p.status = 'Could not read'; }
      renderPages();
    }
    current = null;
    $('run-check').disabled = !lastView || !pages.length || pages.some((x) => !x.lines);
  }
  let queue = Promise.resolve(); // one batch of photos at a time
  const add = (files, clear) => (queue = queue.then(() => { if (clear) clearPages(); return addFiles(files); }));
  $('files').onchange = (e) => { add([...e.target.files]); e.target.value = ''; };
  // the synthetic specimens, as the branch would photograph them on each visit
  const PAPERS = ['02-owner-id-front', '03-owner-id-back', '04-spouse-id-front', '05-dti-page-1', '08-bank-statement', '09-bir-cor', '10-mayors-permit', '11-client-authorization-letter'];
  const SAMPLES = { 1: ['01-application-form-first-visit', ...PAPERS], 2: ['01b-application-form-corrected', ...PAPERS, '05b-dti-page-2'] };
  for (const v of [1, 2]) $(`sample-${v}`).onclick = async () => {
    const done = busy($(`sample-${v}`), 'Loading papers');
    try {
      const files = await Promise.all(SAMPLES[v].map(async (f) => new File([await (await fetch(`specimens/${f}.png`)).blob()], `${f}.png`, { type: 'image/png' })));
      done(); add(files, true);
    } catch { done(); alertInline('The sample papers could not load. Check the connection and try again.'); }
  };
  // drop images or PDFs on the Documents section
  const dropZone = $('pages-empty').closest('section');
  dropZone.addEventListener('dragover', (e) => { if ($('files').disabled) return; e.preventDefault(); dropZone.classList.add('drop'); });
  dropZone.addEventListener('dragleave', (e) => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drop'); });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('drop'); if ($('files').disabled) return;
    const files = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type) || f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (files.length) add(files); else alertInline('Drop photos or PDFs of the papers.');
  });
  let checking = false;
  function clearPages() { pages.forEach((p) => URL.revokeObjectURL(p.url)); pages.splice(0); counter = 0; renderPages(); $('run-check').disabled = true; markStale(); }
  $('clear-pages').onclick = () => add([], true);
  function renderPages() {
    $('pages').innerHTML = pages.map((p) => `<div class="page" data-page="${p.n}"><img src="${p.url}" alt="Page ${p.n}">
      <div class="row" style="margin-top:4px"><strong>Page ${p.n}</strong><span class="soft">${esc(p.status)}</span></div>
      ${p.lines ? '' : '<div class="bar"><i></i></div>'}
      <select aria-label="Label for page ${p.n}" data-label="${p.n}" ${stack === 'aws' ? 'disabled title="Page labels are not used on the AWS reader yet"' : ''}>${Object.entries(DOC_LABELS).map(([k, v]) => `<option value="${k}" ${p.label === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`).join('');
    document.querySelectorAll('[data-label]').forEach((s) => { s.onchange = () => { pages.find((x) => x.n === +s.dataset.label).label = s.value; }; });
    $('clear-pages').disabled = pages.length === 0 || checking;
    $('pages-empty').classList.toggle('hidden', pages.length > 0);
  }

  // ---- check ----
  // AWS reader: a resized JPEG goes straight to S3 with a presigned POST. The size cap and the file type are in the signed policy.
  async function uploadPage(id, p) {
    if (p.key && p.key.startsWith(`uploads/${id}/`)) return p.key;
    const c = await downscale(p.file, 2400);
    const blob = await new Promise((done) => c.toBlob(done, 'image/jpeg', 0.85));
    const u = await api('POST', '/api/upload-url', { id, name: `page-${p.n}-${Date.now()}.jpg` });
    const form = new FormData();
    for (const [k, v] of Object.entries(u.fields)) form.append(k, v);
    form.append('file', blob, 'page.jpg'); // the file goes last
    const r = await fetch(u.url, { method: 'POST', body: form });
    if (r.status !== 204) throw new Error(`Page ${p.n} could not be uploaded (${r.status}).`);
    p.key = u.key; p.status = 'Uploaded'; renderPages();
    return p.key;
  }
  // progress while a check runs: the upload count is real, the reading step shows the time so far
  function startProgress(n) {
    const t0 = Date.now(), steps = [stack === 'aws' ? `Upload ${n} ${n === 1 ? 'page' : 'pages'}` : `Send the text of ${n} ${n === 1 ? 'page' : 'pages'}`, stack === 'aws' ? 'Read them with Textract, check them against the rules and draft the message' : 'Check them against the rules and draft the message'];
    let step = 0, sent = 0;
    const draw = () => {
      const sec = Math.round((Date.now() - t0) / 1000);
      $('progress-steps').innerHTML = steps.map((t, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}">${esc(t)}${i === 0 && step === 0 && stack === 'aws' ? ` (${sent} of ${n})` : ''}</li>`).join('');
      $('progress-time').textContent = `${sec} s, usually 15 to 30`;
      const up = stack === 'aws' ? 0.3 * (sent / n) : 0.1;
      $('progress-bar').style.transform = `scaleX(${step === 0 ? up : Math.min(0.92, 0.3 + 0.62 * (1 - Math.exp(-(sec - 2) / 14)))})`;
    };
    $('progress').classList.remove('hidden'); $('result').setAttribute('aria-busy', 'true'); $('result').classList.add('dim');
    draw(); const timer = setInterval(draw, 500);
    return { sent: () => { sent++; draw(); }, read: () => { step = 1; draw(); }, end: () => { clearInterval(timer); $('progress-bar').style.transform = 'scaleX(1)'; setTimeout(() => $('progress').classList.add('hidden'), 250); $('result').removeAttribute('aria-busy'); $('result').classList.remove('dim'); } };
  }
  $('run-check').onclick = async () => {
    const lock = (on) => { for (const b of ['sample-1', 'sample-2', 'files', 'clear-pages']) $(b).disabled = on; };
    const done = busy($('run-check'), 'Checking'); lock(true); checking = true;
    const prog = startProgress(pages.length);
    let ok = false;
    try {
      const id = caseId();
      const body = stack === 'aws' ? { id, pageKeys: await Promise.all(pages.map((p) => uploadPage(id, p).then((k) => { prog.sent(); return k; }))) }
        : { id, pages: pages.map((p) => ({ lines: p.lines, ...(p.label ? { docType: p.label } : {}) })) };
      prog.read();
      renderResult(await api('POST', '/api/check', body)); ok = true;
    } catch (e) { alertInline(`The check did not finish. ${e.message} Your photos are still here, so press Check documents to try again.`); }
    checking = false; prog.end(); done(); lock(false); $('clear-pages').disabled = !pages.length;
    $('run-check').disabled = !lastView || !pages.length || pages.some((x) => !x.lines);
    if (ok) $('result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  function renderResult(v) {
    $('stale').classList.add('hidden');
    loadCases();
    lastView = v;
    renderChecklist(v);
    $('result').classList.remove('hidden');
    const o = v.open;
    const open = o.defects.length + o.needsReview.length;
    const back = v.status === 'Returned by BSO' && v.events.filter((e) => e.type === 'returned').pop();
    const endorsed = v.status === 'Endorsed to Credit';
    $('verdict').textContent = endorsed ? 'Endorsed to Credit' : back ? 'Returned by BSO' : open ? `${open} ${open === 1 ? 'thing' : 'things'} to fix before the BSO` : 'Ready for BSO review';
    $('status').textContent = v.status; $('status').className = `status ${statusClass(v.status)}`;
    if (endorsed) $('recline').textContent = 'The BSO endorsed this case to Credit. Credit decides the loan.';
    else if (back) $('recline').textContent = `The BSO returned this case and wrote "${back.reason}". Fix it with the client, then check the documents again.`;
    else if (v.reconcile) $('recline').textContent = `Compared with the last check: ${v.reconcile.resolved} fixed, ${v.reconcile.stillMissing} still open, ${v.reconcile.newIssues} new.`;
    $('defects').innerHTML = o.defects.length ? o.defects.map((d) => `<li>${ICON.bad}<span>${esc(d.message)}</span><span></span></li>`).join('') : `<li>${ICON.ok}<span>None found by the rules.</span><span></span></li>`;
    $('reviews').innerHTML = o.needsReview.length ? o.needsReview.map((d) => `<li>${ICON.warn}<span>${esc(d.message)}</span><button class="small secondary" data-clear="${esc(d.key)}">Clear</button>
      <form class="clearform hidden" data-form="${esc(d.key)}"><input required placeholder="Value on the paper" aria-label="Value on the paper"><input required placeholder="Reason" aria-label="Reason"><button class="small">Save</button></form></li>`).join('') : `<li>${ICON.ok}<span>Nothing for a person to check.</span><span></span></li>`;
    document.querySelectorAll('[data-clear]').forEach((b) => { b.onclick = () => document.querySelector(`[data-form="${CSS.escape(b.dataset.clear)}"]`).classList.toggle('hidden'); });
    document.querySelectorAll('[data-form]').forEach((f) => { f.onsubmit = async (e) => {
      e.preventDefault();
      const [value, reason] = [...f.querySelectorAll('input')].map((i) => i.value.trim());
      try { const nv = await api('POST', '/api/event', { id: caseId(), type: 'cleared', by: 'BM', key: f.dataset.form, value, reason }); renderResult({ ...v, ...nv, reconcile: v.reconcile }); } catch (err) { alertInline(err.message); }
    }; });
    if (v.message !== undefined || v.lastMessage) { $('message').textContent = v.message || v.lastMessage; }
    if (v.drafted) $('drafted').textContent = v.drafted === 'model' ? `Drafted by ${v.model}, checked for approval words. A person sends it.` : 'Written from a template.';
    $('handoff').disabled = v.status !== 'Ready for BSO review';
    if (v.trace) {
      const VERDICT = { found: (t) => `found on page ${t.page}`, missing: () => 'not found, Send to BSO stays locked', unsure: () => 'not sure, sent to a person', none: () => 'no answer, sent to a person' };
      $('trace').innerHTML = v.trace.map((t) => t.bsoRequest ? `<tr><td></td><td></td><td>BSO's note</td><td>${esc(v.model)}</td><td>${esc((VERDICT[t.verdict] || VERDICT.none)(t))}</td></tr>` : `<tr><td>${t.page}</td><td>${t.lines}</td><td>${esc(DOC_LABELS[t.docType] || (t.label ? `${DOC_LABELS[t.label]} (labeled)` : 'Not placed'))}</td><td>${t.model ? esc(v.model) : 'Rules only'}</td><td>${t.grounded ? Object.entries(t.grounded).map(([k, ok]) => `${k.replace('_', ' ')}: ${ok ? 'found' : 'not found, sent to a person'}`).join('<br>') : ''}</td></tr>`).join('');
      $('trace-note').textContent = v.stack === 'aws'
        ? 'Textract reads every page. The model reads ID, registration and permit pages. On the form it only tells an empty field from one that has marks in it. Rules decide what is missing.'
        : 'The model sees only ID, registration and permit pages, as text with ID numbers masked. Bank statements and forms are read by rules.';
    }
  }
  $('handoff').onclick = async () => {
    const done = busy($('handoff'), 'Sending');
    try { const nv = await api('POST', '/api/event', { id: caseId(), type: 'handed_off', by: 'BM' }); done(); renderResult({ ...lastView, ...nv }); toast('Sent to the BSO. You can follow it in Referrals below.'); } catch (e) { done(); alertInline(e.message); }
  };

  // load an existing case if there is one
  (async () => {
    if (freshCase) { // pick another number if this one is taken
      for (let i = 0; i < 5; i++) {
        const r = await fetch(`/api/case?id=${caseId()}&exists=1`, { headers: { 'x-demo-key': demoKey } }).then((x) => x.json()).catch(() => null);
        if (!r || !r.exists) return;
        params.set('id', randomId()); history.replaceState(null, '', `?${params}`); $('f-id').value = $('b-id').value = params.get('id'); navLinks();
      }
      return;
    }
    const empty = $('checklist').innerHTML; $('checklist').innerHTML = skelLines(4);
    try { const v = await api('GET', `/api/case?id=${encodeURIComponent(caseId())}`); fillForm(v.referral); renderChecklist(v); lastView = v; if (v.open.checked) { renderResult(v); markStale('These results are from the last saved check. Photos are not kept after a refresh, so add them again and press Check documents to update.'); } } catch { $('checklist').innerHTML = empty; } })();
  function fillForm(r) { $('f-business').value = r.business; $('f-name').value = r.name; $('f-type').value = r.type; $('f-industry').value = r.industry; $('f-amount').value = r.amount; $('f-civil').value = r.civilStatus; $('f-spouse').value = r.spouseName || ''; $('f-secured').checked = !!r.secured; $('f-bpi').checked = r.bpiAccount !== false; $('f-channel').value = r.channel || 'Branch walk-in'; }
}

// ---- case list: on top of the BSO view, below the branch form ----
let casesLoaded = false;
async function loadCases(btn) {
  if (!casesLoaded) $('cases').innerHTML = Array.from({ length: 4 }, () => `<tr>${'<td><span class="skel w80"></span></td>'.repeat(7)}</tr>`).join('');
  const done = btn ? busy(btn, 'Refreshing') : null;
  try {
    const { cases } = await api('GET', '/api/cases');
    const counts = {};
    for (const c of cases) counts[c.status] = (counts[c.status] || 0) + 1;
    $('cases-count').innerHTML = Object.entries(counts).map(([s, n]) => `<span class="status ${statusClass(s)}">${n} ${esc(s)}</span>`).join(' ');
    const n = (k) => cases.filter((c) => c.firstHandoff === k).length, ok = n('complete'), acted = ok + n('returned'), waiting = cases.filter((c) => c.firstHandoff === 'pending' && c.status === 'With BSO').length;
    $('cases-metric').textContent = acted ? `${ok} of ${acted} ${acted === 1 ? 'case' : 'cases'} the BSO acted on ${acted === 1 ? 'was' : 'were'} endorsed to Credit without a return${waiting ? `, and ${waiting} ${waiting === 1 ? 'is' : 'are'} still with the BSO` : ''}.` : waiting ? `${waiting} ${waiting === 1 ? 'case is' : 'cases are'} with the BSO.` : '';
    $('cases').innerHTML = cases.map((c) => `<tr data-id="${esc(c.id)}" tabindex="0"${c.id === caseId() ? ' aria-current="true"' : ''}><td class="mono">${esc(c.id)}</td><td>${esc(c.business)}<br><span class="soft">${esc(c.channel)}</span></td><td><span class="status ${statusClass(c.status)}">${esc(c.status)}</span></td><td>${c.open ?? ''}</td><td>${c.updated ? new Date(c.updated).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' }) : ''}</td><td>PHP ${Number(c.amount).toLocaleString('en-PH')}</td><td>${esc(c.type)}, ${esc(c.industry)}</td></tr>`).join('')
      || `<tr><td colspan="7"><div class="empty"><strong>No ${role === 'bm' ? 'referrals' : 'cases'} yet</strong>${role === 'bm' ? 'Save a case and it shows up here.' : 'Cases show up here once a branch saves one.'}</div></td></tr>`;
    casesLoaded = true;
  } catch (e) {
    if (casesLoaded) alertInline(`The list could not refresh. ${e.message}`);
    else $('cases').innerHTML = `<tr><td colspan="7" class="soft">The list could not load. <button class="small secondary retry" data-retry>Try again</button></td></tr>`;
  }
  if (done) done();
}
const pick = (e) => {
  if (e.target.closest('[data-retry]')) { loadCases(); return; }
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  if (role === 'bm') { location.search = `?id=${encodeURIComponent(tr.dataset.id)}${stackQuery}`; return; }
  $('b-id').value = tr.dataset.id; history.replaceState(null, '', `?role=bso&id=${encodeURIComponent(tr.dataset.id)}${stackQuery}`); $('b-open').onclick();
};
$('cases').onclick = pick;
$('cases').onkeydown = (e) => { if (e.key === 'Enter') pick(e); };
$('cases-refresh').onclick = () => loadCases($('cases-refresh'));
if (role === 'bm') { $('cases-title').textContent = 'Referrals'; $('bm-right').append($('cases-box')); loadCases(); }

// ================= BSO view =================
if (role === 'bso') {
  let timer = null, lastAt = '', shownDrafts = null, shownId = null;
  async function load() {
    if (caseId() !== shownId) { // a new case shows skeletons until it arrives
      $('b-summary').innerHTML = '<span class="skel h"></span><span class="skel w80"></span>';
      $('b-events').innerHTML = $('b-open-items').innerHTML = skelLines(3);
    }
    try {
      const v = await api('GET', `/api/case?id=${encodeURIComponent(caseId())}`);
      const r = v.referral;
      $('b-summary').innerHTML = `<h3>${esc(r.business)}</h3><p class="soft">${esc(r.name)}, ${esc(r.type)}, ${esc(r.industry)}, PHP ${Number(r.amount).toLocaleString('en-PH')}, ${esc(r.civilStatus)}</p>`;
      $('b-status').textContent = v.status; $('b-status').className = `status ${statusClass(v.status)}`;
      $('b-events').innerHTML = v.events.slice().reverse().map((e) => `<li><time>${new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' })}</time><span>${esc(e.by || '')} ${esc(e.type.replace(/_/g, ' '))}${e.value ? `: ${esc(e.value)}` : ''}${e.reason ? ` (${esc(e.reason)})` : ''}${e.pages ? `, ${e.pages} pages` : ''}</span></li>`).join('');
      const o = v.open;
      $('b-open-items').innerHTML = !o.checked ? '<li><span></span><span class="soft">Not checked yet.</span><span></span></li>'
        : [...o.defects.map((d) => `<li>${ICON.bad}<span>${esc(d.message)}</span><button class="small secondary" data-waive="${esc(d.key)}">Waive</button></li>`), ...o.needsReview.map((d) => `<li>${ICON.warn}<span>${esc(d.message)}</span><span></span></li>`)].join('') || `<li>${ICON.ok}<span>Nothing open.</span><span></span></li>`;
      document.querySelectorAll('[data-waive]').forEach((b) => { b.onclick = async () => {
        const reason = prompt('Reason for waiving this item');
        if (!reason) return;
        try { await api('POST', '/api/event', { id: caseId(), type: 'waived', by: 'BSO', key: b.dataset.waive, reason }); load(); } catch (e) { alertInline(e.message); }
      }; });
      $('b-return-btn').disabled = v.status !== 'With BSO';
      $('b-endorse').disabled = v.status !== 'With BSO' || !o.checked || o.defects.length + o.needsReview.length > 0;
      const ids = v.lessonDrafts.map((l) => l.id).join();
      if (ids !== shownDrafts) { // redraw only when the drafts change, so the 4 second poll does not wipe an edit
        shownDrafts = ids;
        $('b-drafts').innerHTML = v.lessonDrafts.map((l) => `<form data-lesson="${esc(l.id)}">
          <p class="soft">${l.drafted === 'model' ? 'Drafted by the AI from your reason' : 'Your reason, word for word'}. Take out anything that names the client.</p>
          <textarea rows="3" maxlength="240" required aria-label="Heads-up text">${esc(l.text)}</textarea>
          <select aria-label="Who sees this heads-up"><option value="industry">${esc(l.type)} cases in ${esc(l.industry)}</option><option value="type">All ${esc(l.type)} cases</option><option value="all">All cases</option></select>
          <div class="actions"><button>Publish heads-up</button><button type="button" class="secondary" data-discard="${esc(l.id)}">Discard</button></div></form>`).join('');
      }
      $('b-headsup').innerHTML = v.headsUp.map((l) => `<li>${ICON.warn}<span>${esc(l.text)}<br><span class="soft">Shown on ${esc(headsUpScope(l))}</span></span><button class="small secondary" data-retire="${esc(l.id)}">Retire</button></li>`).join('')
        || (v.lessonDrafts.length ? '' : '<li><span></span><span class="soft">There is no heads-up for cases like this one yet.</span><span></span></li>');
      $('b-message').textContent = v.lastMessage || 'No check yet.';
      $('b-approve').disabled = !v.lastMessage || v.events.some((e) => e.type === 'draft_approved' && e.at > (v.events.filter((x) => x.type.startsWith('check')).pop() || {}).at);
      const newest = (v.events[v.events.length - 1] || {}).at || '';
      if (lastAt && newest !== lastAt) document.title = 'Updated: Counter Check';
      lastAt = newest; shownId = caseId();
    } catch (e) {
      if (shownId === caseId()) return; // a failed poll keeps what is on screen
      const id = esc(caseId());
      $('b-summary').innerHTML = `<div class="empty"><strong>${e.message === 'unknown referral' ? `There is no case ${id} yet` : 'This case could not load'}</strong>${e.message === 'unknown referral' ? 'Pick a case from All cases above, or check the number.' : `${esc(e.message)}. It tries again in a few seconds.`}</div>`;
      $('b-events').innerHTML = $('b-open-items').innerHTML = '';
      $('b-endorse').disabled = $('b-return-btn').disabled = true;
    }
  }
  $('b-q').value = `Ano pa ang kulang sa ${caseId()}?`;
  $('b-open').onclick = () => { loadCases(); navLinks(); $('b-q').value = `Ano pa ang kulang sa ${caseId()}?`; load(); if (!timer) { let tick = 0; timer = setInterval(() => { if (!document.hidden || ++tick % 5 === 0) load(); }, 4000); } }; // every 20 seconds in a hidden tab
  // a BSO action shows its own busy state, then the case reloads
  const act = async (btn, label, body, note) => {
    const done = busy(btn, label);
    try { await api('POST', '/api/event', { id: caseId(), by: 'BSO', ...body }); done(); if (note) toast(note); await load(); loadCases(); } catch (e) { done(); alertInline(e.message); }
  };
  $('b-approve').onclick = () => act($('b-approve'), 'Approving', { type: 'draft_approved' }, 'Message approved.');
  $('b-id').addEventListener('input', () => { $('b-endorse').disabled = $('b-return-btn').disabled = true; });
  $('b-endorse').onclick = () => act($('b-endorse'), 'Endorsing', { type: 'endorsed' }, 'Endorsed to Credit. Credit decides the loan.');
  $('b-return').onsubmit = async (e) => {
    e.preventDefault();
    const reason = $('b-return-reason').value;
    await act($('b-return-btn'), 'Returning', { type: 'returned', reason }, 'Returned to the branch. The AI is drafting a heads-up for you to review.');
    if ($('b-return-reason').value === reason) $('b-return-reason').value = '';
  };
  const lesson = async (btn, label, body, note) => {
    const done = busy(btn, label);
    try { await api('POST', '/api/lesson', { by: 'BSO', ...body }); done(); toast(note); shownDrafts = null; load(); } catch (e) { done(); alertInline(e.message); }
  };
  $('b-drafts').onsubmit = (e) => { e.preventDefault(); const f = e.target; lesson(f.querySelector('button:not([data-discard])'), 'Publishing', { lessonId: f.dataset.lesson, action: 'publish', text: f.querySelector('textarea').value, scope: f.querySelector('select').value }, 'Heads-up published.'); };
  $('b-drafts').onclick = (e) => { if (e.target.dataset.discard) lesson(e.target, 'Discarding', { lessonId: e.target.dataset.discard, action: 'retire' }, 'Draft discarded.'); };
  $('b-headsup').onclick = (e) => { if (e.target.dataset.retire) lesson(e.target, 'Retiring', { lessonId: e.target.dataset.retire, action: 'retire' }, 'Heads-up retired.'); };
  window.addEventListener('focus', () => { document.title = 'Counter Check'; });
  // without a case number, open the newest case that is with the BSO
  if (params.get('id')) $('b-open').onclick();
  else { const start = $('b-id').value; api('GET', '/api/cases').then(({ cases }) => { const c = cases.find((x) => x.status === 'With BSO') || cases[0]; if (c && $('b-id').value === start) { $('b-id').value = c.id; history.replaceState(null, '', `?role=bso&id=${c.id}${stackQuery}`); } }).catch(() => {}).finally(() => $('b-open').onclick()); }
}

$('b-ask').onclick = async () => {
  if (!$('b-q').value.trim()) { $('b-q').focus(); return; }
  const done = busy($('b-ask'), 'Asking');
  $('b-answer').innerHTML = '<div class="message" aria-busy="true"><span class="skel w80"></span><span class="skel w60"></span></div>';
  try {
    const v = await api('POST', '/api/ask', { id: caseId(), question: $('b-q').value, stack });
    $('b-answer').innerHTML = `<div class="message">${esc(v.answer)}</div>${v.handoff ? '<p class="note">The assistant handed this to a person.</p>' : ''}`;
    $('b-trace-box').classList.remove('hidden');
    $('b-trace').textContent = (v.trace || []).map((t) => (t.rule ? `rule: ${t.rule} (the model was not asked)` : `tool: ${t.tool}\n${JSON.stringify(t.result, null, 1)}`)).join('\n\n') + (v.model ? `\n\nmodel: ${v.model}` : '');
  } catch (e) { $('b-answer').innerHTML = `<p class="note">${esc(e.message)}</p>`; }
  done();
};
$('b-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('b-ask').click(); });

function toast(msg, kind = '') {
  let el = $('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.className = `toast ${kind}`; el.textContent = msg; void el.offsetWidth; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 7000 : 4000);
}
function alertInline(msg) { toast(msg, 'error'); }
