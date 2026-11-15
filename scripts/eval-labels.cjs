// Side test: read the application form from plain Textract text (line positions) instead of the Forms pass.
// Compares mapped fields from both on the specimen forms at four damage levels. Not used by the live pipeline.
// Run from app/ with AWS_PROFILE set. It makes 8 text and 8 Forms calls (about $0.41), plus 2 calls per form for each of VARIANTS.
const { createRequire } = require('module');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..');
const req = createRequire(path.join(APP, 'backend/package.json'));
const { TextractClient, DetectDocumentTextCommand, AnalyzeDocumentCommand } = req('@aws-sdk/client-textract');
const { analyzeForm } = require(path.join(APP, 'backend/aws/textract.cjs'));
const { mapForm } = require(path.join(APP, 'backend/classify.cjs'));
const c = new TextractClient({ region: process.env.AWS_REGION || 'ap-southeast-1', maxAttempts: 10, retryMode: 'adaptive' });
const OUT = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cc-labels-'));

// labels as printed on the form, in reading order
const LABELS = ['business name', 'name of applicant', 'address', 'tin', 'contact number', 'civil status', 'name of spouse', 'loan amount', 'purpose', 'signature over printed name'];
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function labelsFromWords(blocks) {
  const byId = new Map(blocks.map((b) => [b.Id, b]));
  const box = (b) => { const p = b.Geometry.Polygon; return { tl: p[0], tr: p[1], br: p[2], bl: p[3] }; };
  const lines = blocks.filter((b) => b.BlockType === 'LINE').map((b) => ({ b, g: box(b), words: (b.Relationships || []).filter((r) => r.Type === 'CHILD').flatMap((r) => r.Ids).map((id) => byId.get(id)).filter((w) => w && w.BlockType === 'WORD') }));
  // value words stop at a big horizontal gap (stray watermark pieces sit far to the right)
  const tall = (w, ref) => { const a = box(w), b = box(ref); return (a.bl.Y - a.tl.Y) > 1.6 * (b.bl.Y - b.tl.Y); };
  const take = (ws, ref) => { const out = []; for (const w of ws) { if (out.length && tall(w, ref || out[0])) break; const g = box(w), prev = out[out.length - 1]; if (prev) { const pg = box(prev), h = pg.bl.Y - pg.tl.Y; if (g.tl.X - pg.tr.X > 3 * Math.abs(h || 0.01)) break; } out.push(w); } return out; };
  const kv = {};
  for (const L of lines) {
    const toks = L.words.map((w) => norm(w.Text));
    for (const label of LABELS) {
      const parts = label.split(' ');
      if (toks.slice(0, parts.length).join(' ') !== label) continue;
      let rest = take(L.words.slice(parts.length).filter((w) => !/^[_:]+$/.test(w.Text)), L.words[0]);
      if (!rest.length) { // handwriting often comes back as its own line just to the right
        const h = L.g.bl.Y - L.g.tl.Y, end = L.g.tr;
        const n = lines.filter((M) => M !== L && M.g.tl.X > end.X - 0.01 && M.g.tl.X - end.X < 0.25 && Math.abs((M.g.tl.Y + M.g.bl.Y) / 2 - (end.Y + L.g.br.Y) / 2) < h * 1.2).sort((a, b) => a.g.tl.X - b.g.tl.X)[0];
        if (n) rest = take(n.words.filter((w) => !/^[_:]+$/.test(w.Text)));
      }
      const value = rest.map((w) => w.Text).join(' ').replace(/^:\s*/, '').trim();
      if (!kv[label] || (!kv[label].value && value)) kv[label] = { value, conf: rest.length ? Math.min(...rest.map((w) => w.Confidence / 100)) : L.b.Confidence / 100 };
    }
  }
  return kv;
}

const LEVELS = {
  clean: [],
  light: ['-background', '#cfcfcf', '-rotate', '1.5', '-resize', '80%', '-blur', '0x0.4', '-quality', '70'],
  medium: ['-seed', '42', '-background', '#9a9a9a', '-virtual-pixel', 'background', '-distort', 'Perspective', '0,0 %[fx:w*0.05],%[fx:h*0.03] %[fx:w],0 %[fx:w*0.97],0 0,%[fx:h] 0,%[fx:h] %[fx:w],%[fx:h] %[fx:w*0.93],%[fx:h*0.96]', '-rotate', '-3', '-resize', '65%', '-blur', '0x0.9', '-brightness-contrast', '-8x-10', '-attenuate', '0.3', '+noise', 'Gaussian', '-quality', '50'],
  heavy: ['-seed', '42', '-background', '#777', '-virtual-pixel', 'background', '-distort', 'Perspective', '0,0 %[fx:w*0.05],%[fx:h*0.03] %[fx:w],0 %[fx:w*0.97],0 0,%[fx:h] 0,%[fx:h] %[fx:w],%[fx:h] %[fx:w*0.93],%[fx:h*0.96]', '-rotate', '6', '(', '+clone', '-sparse-color', 'Barycentric', '0,0 white %[fx:w],%[fx:h] gray45', ')', '-compose', 'Multiply', '-composite', '-resize', '50%', '-blur', '0x1.3', '-attenuate', '0.6', '+noise', 'Gaussian', '-quality', '30'],
};
const FORMS = { visit1: '01-application-form-first-visit', corrected: '01b-application-form-corrected' };
const KEYS = ['business_name', 'owner_name', 'address', 'tin', 'contact', 'civil_status', 'spouse_name', 'signature'];

// the values printed on each specimen ('' means the field is left blank)
const BASE = { business_name: 'Elena Artisan Bakery', owner_name: 'Elena Santos', address: '12 Rizal Street, Los Banos, Laguna', contact: '0917 555 0142', spouse_name: 'Ramon Santos', signature: '' };
const TRUTH = { visit1: { ...BASE, tin: '', civil_status: 'Kasal' }, corrected: { ...BASE, tin: '123-456-789-000', civil_status: 'Married' } };
const same = (a, b) => norm(a || '') === norm(b || '');
// VARIANTS=n adds n random phone-photo damages per form (seeded, so a rerun gives the same images)
function randomRecipe(seed) {
  let x = seed * 9301 + 49297; const r = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const k = (a, b) => (a + r() * (b - a)).toFixed(2), corner = () => `%[fx:w*${k(0, 0.07)}],%[fx:h*${k(0, 0.05)}]`;
  return ['-seed', String(seed), '-background', `gray${Math.round(40 + r() * 45)}`, '-virtual-pixel', 'background', '-distort', 'Perspective',
    `0,0 ${corner()} %[fx:w],0 %[fx:w*${k(0.93, 1)}],%[fx:h*${k(0, 0.05)}] 0,%[fx:h] %[fx:w*${k(0, 0.07)}],%[fx:h*${k(0.95, 1)}] %[fx:w],%[fx:h] %[fx:w*${k(0.93, 1)}],%[fx:h*${k(0.95, 1)}]`,
    '-rotate', k(-7, 7), '-resize', `${Math.round(45 + r() * 35)}%`, '-blur', `0x${k(0.3, 1.4)}`, '-brightness-contrast', `${Math.round(-15 + r() * 15)}x${Math.round(-15 + r() * 10)}`,
    '-attenuate', k(0.1, 0.6), '+noise', 'Gaussian', '-quality', String(Math.round(30 + r() * 40))];
}
for (let i = 1; i <= Number(process.env.VARIANTS || 0); i++) LEVELS[`random${i}`] = randomRecipe(i);

(async () => {
  const rows = [], tally = { text: { right: 0, empty: 0, wrong: 0 }, forms: { right: 0, empty: 0, wrong: 0 } };
  const score = (who, got, want) => { const t = tally[who]; if (same(got, want)) t.right++; else if (!norm(got || '')) t.empty++; else t.wrong++; };
  for (const [fname, f] of Object.entries(FORMS)) for (const [level, recipe] of Object.entries(LEVELS)) {
    const img = path.join(OUT, `${fname}-${level}.jpg`);
    execFileSync('magick', [path.join(APP, 'frontend/specimens', `${f}.png`), '-channel', 'R', '-separate', '+channel', ...recipe, img]);
    const bytes = fs.readFileSync(img);
    const det = await c.send(new DetectDocumentTextCommand({ Document: { Bytes: bytes } }));
    const viaText = mapForm(labelsFromWords(det.Blocks || [])).fields;
    const viaForms = mapForm(await analyzeForm(bytes, c)).fields;
    const diff = KEYS.filter((k) => (viaText[k] ?? null) !== (viaForms[k] ?? null)).map((k) => `${k}: text=${JSON.stringify(viaText[k] ?? null)} forms=${JSON.stringify(viaForms[k] ?? null)}`);
    for (const k of KEYS) { score('text', viaText[k], TRUTH[fname][k]); score('forms', viaForms[k], TRUTH[fname][k]); }
    rows.push({ fname, level, same: KEYS.length - diff.length, diff });
    console.log(`${fname} ${level}: ${KEYS.length - diff.length}/${KEYS.length} same${diff.length ? '\n  ' + diff.join('\n  ') : ''}`);
  }
  console.log('\nagainst the printed values (right / left empty / wrong):');
  for (const [who, t] of Object.entries(tally)) console.log(`  ${who}: ${t.right} / ${t.empty} / ${t.wrong}`);
})().catch((e) => { console.error(e); process.exit(1); });
