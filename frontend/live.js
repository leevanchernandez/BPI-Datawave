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
const statusClass = (s) => (s === 'Missing requirements' || s === 'Returned by BSO' ? 'missing' : s === 'Ready for BSO review' ? 'ready' : s === 'With BSO' ? 'with' : '');

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
if (params.get('id')) { $('f-id').value = params.get('id'); $('b-id').value = params.get('id'); }
navLinks();

function checklistHtml(rows) {
  return rows.map((r) => `<li>${ICON.doc}<span>${esc(r.title)}${r.reason ? ` <span class="src">(because: ${esc(r.reason)})</span>` : ''}<br>${r.sourceUrl
    ? `<a class="chip" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Source: BPI public page</a>`
    : r.source === 'J1' ? `<span class="chip" title="${esc(r.sourceTitle)}">Source: BSO checklist</span>`
    : '<span class="chip assumed">Team assumption, BSO confirms</span>'}</span><span></span></li>`).join('');
}
const headsUpScope = (l) => (l.industry ? `${l.type}, ${l.industry}` : l.type || 'All cases');

// ================= Branch view =================
if (role === 'bm') {
  const pages = []; // { file, url, lines, conf, status, label }
  let lastView = null;

  const referral = () => ({
    id: $('f-id').value.trim(), business: $('f-business').value, name: $('f-name').value, type: $('f-type').value,
    industry: $('f-industry').value, amount: Number(String($('f-amount').value).replace(/[^\d.]/g, '')),
    civilStatus: $('f-civil').value, spouseName: $('f-civil').value === 'married' ? $('f-spouse').value : '', secured: $('f-secured').checked,
    bpiAccount: $('f-bpi').checked,
  });
  $('f-civil').onchange = () => { $('f-spouse').disabled = $('f-civil').value !== 'married'; };

  async function saveCase() {
    try {
      const v = await api('POST', '/api/case', { referral: referral() });
      lastView = v; navLinks(); loadCases();
      renderChecklist(v);
      $('run-check').disabled = pages.length === 0;
    } catch (e) { alertInline(e.message); }
  }
  function renderChecklist(v) {
    $('checklist').innerHTML = checklistHtml(v.rules.rows);
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
    if (fields.name || fields.business) for (const id of ['f-business', 'f-name', 'f-spouse', 'f-amount']) $(id).value = ''; // a new client clears the last one's values, a correction keeps them
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
    const wait = say('bot wait', mode === 'fill' ? 'Reading your note.' : 'Checking the case.');
    try { await (mode === 'fill' ? fill(text, wait) : ask(text, wait)); } catch (e) { wait.textContent = e.message === 'unknown referral' ? 'Save the case first, then ask about it.' : e.message; }
    wait.classList.remove('wait'); $('chat-send').disabled = false;
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
  async function addFiles(files) {
    markStale();
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
    $('run-check').disabled = !lastView || pages.some((x) => !x.lines);
  }
  $('files').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  $('clear-pages').onclick = () => { pages.forEach((p) => URL.revokeObjectURL(p.url)); pages.splice(0); counter = 0; renderPages(); $('run-check').disabled = true; markStale(); };
  function renderPages() {
    $('pages').innerHTML = pages.map((p) => `<div class="page" data-page="${p.n}"><img src="${p.url}" alt="Page ${p.n}">
      <div class="row" style="margin-top:4px"><strong>Page ${p.n}</strong><span class="soft">${esc(p.status)}</span></div>
      ${p.lines ? '' : '<div class="bar"><i></i></div>'}
      <select aria-label="Label for page ${p.n}" data-label="${p.n}" ${stack === 'aws' ? 'disabled title="Page labels are not used on the AWS reader yet"' : ''}>${Object.entries(DOC_LABELS).map(([k, v]) => `<option value="${k}" ${p.label === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`).join('');
    document.querySelectorAll('[data-label]').forEach((s) => { s.onchange = () => { pages.find((x) => x.n === +s.dataset.label).label = s.value; }; });
    $('clear-pages').disabled = pages.length === 0;
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
  $('run-check').onclick = async () => {
    $('run-check').disabled = true; $('run-check').textContent = 'Checking';
    try {
      const id = caseId();
      const body = stack === 'aws' ? { id, pageKeys: await Promise.all(pages.map((p) => uploadPage(id, p))) }
        : { id, pages: pages.map((p) => ({ lines: p.lines, ...(p.label ? { docType: p.label } : {}) })) };
      renderResult(await api('POST', '/api/check', body));
    } catch (e) { alertInline(e.message); }
    $('run-check').disabled = false; $('run-check').textContent = 'Check documents';
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
    $('verdict').textContent = back ? 'Returned by BSO' : open ? `${open} ${open === 1 ? 'thing' : 'things'} to fix before the BSO` : 'Ready for BSO review';
    $('status').textContent = v.status; $('status').className = `status ${statusClass(v.status)}`;
    if (back) $('recline').textContent = `The BSO returned this case and wrote "${back.reason}". Fix it with the client, then check the documents again.`;
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
      $('trace').innerHTML = v.trace.map((t) => `<tr><td>${t.page}</td><td>${t.lines}</td><td>${esc(DOC_LABELS[t.docType] || (t.label ? `${DOC_LABELS[t.label]} (labeled)` : 'Not placed'))}</td><td>${t.model ? esc(v.model) : 'Rules only'}</td><td>${t.grounded ? Object.entries(t.grounded).map(([k, ok]) => `${k.replace('_', ' ')}: ${ok ? 'found' : 'not found, sent to a person'}`).join('<br>') : ''}</td></tr>`).join('');
      $('trace-note').textContent = v.stack === 'aws'
        ? 'Textract reads every page. The model reads ID, registration and permit pages. On the form it only tells an empty field from one that has marks in it. Rules decide what is missing.'
        : 'The model sees only ID, registration and permit pages, as text with ID numbers masked. Bank statements and forms are read by rules.';
    }
  }
  $('handoff').onclick = async () => { try { const nv = await api('POST', '/api/event', { id: caseId(), type: 'handed_off', by: 'BM' }); renderResult({ ...lastView, ...nv }); } catch (e) { alertInline(e.message); } };

  // load an existing case if there is one
  (async () => { try { const v = await api('GET', `/api/case?id=${encodeURIComponent(caseId())}`); fillForm(v.referral); renderChecklist(v); lastView = v; if (v.open.checked) { renderResult(v); markStale('These results are from the last saved check. Photos are not kept after a refresh, so add them again and press Check documents to update.'); } } catch { /* new case */ } })();
  function fillForm(r) { $('f-business').value = r.business; $('f-name').value = r.name; $('f-type').value = r.type; $('f-industry').value = r.industry; $('f-amount').value = r.amount; $('f-civil').value = r.civilStatus; $('f-spouse').value = r.spouseName || ''; $('f-secured').checked = !!r.secured; $('f-bpi').checked = r.bpiAccount !== false; }
}

// ---- case list: on top of the BSO view, below the branch form ----
async function loadCases() {
  try {
    const { cases } = await api('GET', '/api/cases');
    const counts = {};
    for (const c of cases) counts[c.status] = (counts[c.status] || 0) + 1;
    $('cases-count').innerHTML = Object.entries(counts).map(([s, n]) => `<span class="status ${statusClass(s)}">${n} ${esc(s)}</span>`).join(' ');
    const sent = cases.filter((c) => c.firstHandoff), ok = sent.filter((c) => c.firstHandoff === 'complete').length;
    $('cases-metric').textContent = sent.length ? `${ok} of ${sent.length} ${sent.length === 1 ? 'case' : 'cases'} sent to the BSO ${sent.length === 1 ? 'was' : 'were'} complete the first time (never returned).` : '';
    $('cases').innerHTML = cases.map((c) => `<tr data-id="${esc(c.id)}" tabindex="0"${c.id === caseId() ? ' aria-current="true"' : ''}><td class="mono">${esc(c.id)}</td><td>${esc(c.business)}</td><td><span class="status ${statusClass(c.status)}">${esc(c.status)}</span></td><td>${c.open ?? ''}</td><td>${c.updated ? new Date(c.updated).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' }) : ''}</td><td>PHP ${Number(c.amount).toLocaleString('en-PH')}</td><td>${esc(c.type)}, ${esc(c.industry)}</td></tr>`).join('')
      || '<tr><td colspan="7" class="soft">No cases yet.</td></tr>';
  } catch (e) { $('cases').innerHTML = `<tr><td colspan="7" class="soft">${esc(e.message)}</td></tr>`; }
}
const pick = (e) => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  if (role === 'bm') { location.search = `?id=${encodeURIComponent(tr.dataset.id)}${stackQuery}`; return; }
  $('b-id').value = tr.dataset.id; history.replaceState(null, '', `?role=bso&id=${encodeURIComponent(tr.dataset.id)}${stackQuery}`); $('b-open').onclick();
};
$('cases').onclick = pick;
$('cases').onkeydown = (e) => { if (e.key === 'Enter') pick(e); };
$('cases-refresh').onclick = loadCases;
if (role === 'bm') { $('cases-title').textContent = 'Referrals'; $('bm-right').append($('cases-box')); loadCases(); }

// ================= BSO view =================
if (role === 'bso') {
  let timer = null, lastAt = '', shownDrafts = null;
  async function load() {
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
      lastAt = newest;
    } catch (e) { $('b-summary').innerHTML = `<p class="soft">${esc(e.message)}</p>`; }
  }
  $('b-q').value = `Ano pa ang kulang sa ${caseId()}?`;
  $('b-open').onclick = () => { loadCases(); navLinks(); $('b-q').value = `Ano pa ang kulang sa ${caseId()}?`; load(); if (!timer) timer = setInterval(load, 4000); };
  $('b-approve').onclick = async () => { try { await api('POST', '/api/event', { id: caseId(), type: 'draft_approved', by: 'BSO' }); load(); } catch (e) { alertInline(e.message); } };
  $('b-return').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/event', { id: caseId(), type: 'returned', by: 'BSO', reason: $('b-return-reason').value }); $('b-return-reason').value = ''; load(); } catch (err) { alertInline(err.message); }
  };
  const lesson = async (body) => { try { await api('POST', '/api/lesson', { by: 'BSO', ...body }); load(); } catch (e) { alertInline(e.message); } };
  $('b-drafts').onsubmit = (e) => { e.preventDefault(); const f = e.target; lesson({ lessonId: f.dataset.lesson, action: 'publish', text: f.querySelector('textarea').value, scope: f.querySelector('select').value }); };
  $('b-drafts').onclick = (e) => { if (e.target.dataset.discard) lesson({ lessonId: e.target.dataset.discard, action: 'retire' }); };
  $('b-headsup').onclick = (e) => { if (e.target.dataset.retire) lesson({ lessonId: e.target.dataset.retire, action: 'retire' }); };
  window.addEventListener('focus', () => { document.title = 'Counter Check'; });
  $('b-open').onclick();
}

$('b-ask').onclick = async () => {
  $('b-answer').textContent = 'Asking';
  try {
    const v = await api('POST', '/api/ask', { id: caseId(), question: $('b-q').value, stack });
    $('b-answer').innerHTML = `<div class="message">${esc(v.answer)}</div>${v.handoff ? '<p class="note">The assistant handed this to a person.</p>' : ''}`;
    $('b-trace-box').classList.remove('hidden');
    $('b-trace').textContent = (v.trace || []).map((t) => (t.rule ? `rule: ${t.rule} (the model was not asked)` : `tool: ${t.tool}\n${JSON.stringify(t.result, null, 1)}`)).join('\n\n') + (v.model ? `\n\nmodel: ${v.model}` : '');
  } catch (e) { $('b-answer').textContent = e.message; }
};

function alertInline(msg) {
  let el = document.getElementById('flash');
  if (!el) { el = document.createElement('p'); el.id = 'flash'; el.className = 'note full'; el.setAttribute('role', 'status'); $('main').prepend(el); }
  el.textContent = msg; clearTimeout(alertInline.t); alertInline.t = setTimeout(() => el.remove(), 6000);
}
