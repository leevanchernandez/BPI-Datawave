// Counter Check live prototype. Branch view (default) and BSO view (?role=bso).
// OCR runs in this browser with Tesseract.js: photos never leave the device, only the lines of text do.
'use strict';

const params = new URLSearchParams(location.search);
const role = params.get('role') === 'bso' ? 'bso' : 'bm';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  ok: '<svg viewBox="0 0 24 24" class="ok" aria-hidden="true"><path d="M5 12l5 5 9-11"/></svg>',
  bad: '<svg viewBox="0 0 24 24" class="bad" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  warn: '<svg viewBox="0 0 24 24" class="warn" aria-hidden="true"><path d="M12 8v5M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6"/></svg>',
};
const DOC_LABELS = { '': 'Auto', application_form: 'Application form', gov_id: 'Government ID', spouse_id: 'Spouse ID', registration: 'DTI or SEC registration', business_permit: "Mayor's permit", itr: 'Income tax return', financials: 'Financial statements', audited_fs: 'Audited FS', bank_statements: 'Bank statement', articles: 'Articles', bylaws: 'By-laws', gis: 'GIS', collateral: 'Collateral' };
const statusClass = (s) => (s === 'Missing requirements' ? 'missing' : s === 'Ready for BSO review' ? 'ready' : s === 'With BSO' ? 'with' : '');

// ---- demo key ----
let demoKey = params.get('key') || (() => { try { return localStorage.getItem('cc-key') || ''; } catch { return ''; } })();
if (params.get('key')) { try { localStorage.setItem('cc-key', demoKey); } catch { /* private mode */ } }
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-demo-key': demoKey }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { $('keybox').hidden = false; throw new Error('Enter the demo key first.'); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
$('savekey').onclick = () => { demoKey = $('demokey').value.trim(); try { localStorage.setItem('cc-key', demoKey); } catch { /* ignore */ } $('keybox').hidden = true; };
if (!demoKey) $('keybox').hidden = false;

// ---- role switch ----
const caseId = () => (role === 'bm' ? $('f-id').value.trim() : $('b-id').value.trim());
function navLinks() {
  const id = encodeURIComponent(caseId() || 'RF-2026-042');
  $('nav-bm').href = `?id=${id}`; $('nav-bso').href = `?role=bso&id=${id}`;
  $(role === 'bm' ? 'nav-bm' : 'nav-bso').setAttribute('aria-current', 'page');
}
for (const id of role === 'bm' ? ['bm-left', 'bm-right'] : ['bso-left', 'bso-right']) $(id).classList.remove('hidden');
if (params.get('id')) { $('f-id').value = params.get('id'); $('b-id').value = params.get('id'); }
navLinks();

function checklistHtml(rows) {
  return rows.map((r) => `<li>${ICON.doc}<span>${esc(r.title)}${r.reason ? ` <span class="src">(because: ${esc(r.reason)})</span>` : ''}<br>${r.sourceUrl
    ? `<a class="chip" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Source: BPI public page</a>`
    : '<span class="chip assumed">Team assumption, BSO confirms</span>'}</span><span></span></li>`).join('');
}

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
      lastView = v; navLinks();
      $('checklist').innerHTML = checklistHtml(v.rules.rows);
      $('rules-note').textContent = `Rules version ${v.rules.version}. Seeded from BPI's public pages, which BPI calls indicative and non-exhaustive.`;
      $('run-check').disabled = pages.length === 0;
    } catch (e) { alertInline(e.message); }
  }
  $('save-case').onclick = saveCase;

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
  async function addFiles(files) {
    for (const file of files) {
      const p = { n: ++counter, file, url: URL.createObjectURL(file), lines: null, status: 'Reading', label: '' };
      pages.push(p); renderPages();
    }
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
  $('clear-pages').onclick = () => { pages.forEach((p) => URL.revokeObjectURL(p.url)); pages.splice(0); counter = 0; renderPages(); $('run-check').disabled = true; };
  function renderPages() {
    $('pages').innerHTML = pages.map((p) => `<div class="page" data-page="${p.n}"><img src="${p.url}" alt="Page ${p.n}">
      <div class="row" style="margin-top:4px"><strong>Page ${p.n}</strong><span class="soft">${esc(p.status)}</span></div>
      ${p.lines ? '' : '<div class="bar"><i></i></div>'}
      <select aria-label="Label for page ${p.n}" data-label="${p.n}">${Object.entries(DOC_LABELS).map(([k, v]) => `<option value="${k}" ${p.label === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`).join('');
    document.querySelectorAll('[data-label]').forEach((s) => { s.onchange = () => { pages.find((x) => x.n === +s.dataset.label).label = s.value; }; });
    $('clear-pages').disabled = pages.length === 0;
  }

  // ---- check ----
  $('run-check').onclick = async () => {
    $('run-check').disabled = true; $('run-check').textContent = 'Checking';
    try {
      const v = await api('POST', '/api/check', { id: caseId(), pages: pages.map((p) => ({ lines: p.lines, ...(p.label ? { docType: p.label } : {}) })) });
      renderResult(v);
    } catch (e) { alertInline(e.message); }
    $('run-check').disabled = false; $('run-check').textContent = 'Check documents';
  };

  function renderResult(v) {
    lastView = v;
    $('result').classList.remove('hidden');
    const o = v.open;
    const open = o.defects.length + o.needsReview.length;
    $('verdict').textContent = open ? `${open} ${open === 1 ? 'thing' : 'things'} to fix before the BSO` : 'Ready for BSO review';
    $('status').textContent = v.status; $('status').className = `status ${statusClass(v.status)}`;
    if (v.reconcile) $('recline').textContent = `Compared with the last check: ${v.reconcile.resolved} fixed, ${v.reconcile.stillMissing} still open, ${v.reconcile.newIssues} new.`;
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
      $('trace-note').textContent = 'The model sees only ID, registration and permit pages, as text with ID numbers masked. Bank statements and forms are read by rules.';
    }
  }
  $('handoff').onclick = async () => { try { const nv = await api('POST', '/api/event', { id: caseId(), type: 'handed_off', by: 'BM' }); renderResult({ ...lastView, ...nv }); } catch (e) { alertInline(e.message); } };

  // load an existing case if there is one
  (async () => { try { const v = await api('GET', `/api/case?id=${encodeURIComponent(caseId())}`); fillForm(v.referral); $('checklist').innerHTML = checklistHtml(v.rules.rows); lastView = v; if (v.open.checked) renderResult(v); } catch { /* new case */ } })();
  function fillForm(r) { $('f-business').value = r.business; $('f-name').value = r.name; $('f-type').value = r.type; $('f-industry').value = r.industry; $('f-amount').value = r.amount; $('f-civil').value = r.civilStatus; $('f-spouse').value = r.spouseName || ''; $('f-secured').checked = !!r.secured; $('f-bpi').checked = r.bpiAccount !== false; }
}

// ================= BSO view =================
if (role === 'bso') {
  let timer = null, lastAt = '';
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
      $('b-message').textContent = v.lastMessage || 'No check yet.';
      $('b-approve').disabled = !v.lastMessage || v.events.some((e) => e.type === 'draft_approved' && e.at > (v.events.filter((x) => x.type.startsWith('check')).pop() || {}).at);
      const newest = (v.events[v.events.length - 1] || {}).at || '';
      if (lastAt && newest !== lastAt) document.title = 'Updated: Counter Check';
      lastAt = newest;
    } catch (e) { $('b-summary').innerHTML = `<p class="soft">${esc(e.message)}</p>`; }
  }
  $('b-q').value = `Ano pa ang kulang sa ${caseId()}?`;
  $('b-open').onclick = () => { navLinks(); $('b-q').value = `Ano pa ang kulang sa ${caseId()}?`; load(); if (!timer) timer = setInterval(load, 4000); };
  $('b-approve').onclick = async () => { try { await api('POST', '/api/event', { id: caseId(), type: 'draft_approved', by: 'BSO' }); load(); } catch (e) { alertInline(e.message); } };
  $('b-ask').onclick = async () => {
    $('b-answer').textContent = 'Asking';
    try {
      const v = await api('POST', '/api/ask', { id: caseId(), question: $('b-q').value });
      $('b-answer').innerHTML = `<div class="message">${esc(v.answer)}</div>${v.handoff ? '<p class="note">The assistant handed this to a person.</p>' : ''}`;
      $('b-trace-box').classList.remove('hidden');
      $('b-trace').textContent = (v.trace || []).map((t) => (t.rule ? `rule: ${t.rule} (the model was not asked)` : `tool: ${t.tool}\n${JSON.stringify(t.result, null, 1)}`)).join('\n\n') + (v.model ? `\n\nmodel: ${v.model}` : '');
    } catch (e) { $('b-answer').textContent = e.message; }
  };
  window.addEventListener('focus', () => { document.title = 'Counter Check'; });
  $('b-open').onclick();
}

function alertInline(msg) {
  let el = document.getElementById('flash');
  if (!el) { el = document.createElement('p'); el.id = 'flash'; el.className = 'note full'; el.setAttribute('role', 'status'); $('main').prepend(el); }
  el.textContent = msg; clearTimeout(alertInline.t); alertInline.t = setTimeout(() => el.remove(), 6000);
}
