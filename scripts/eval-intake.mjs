// Fills the case form from 20 synthetic branch notes on the deployed Worker and scores each field.
// The notes and the expected fields were written by the team. A field the note leaves unclear is not scored.
// Run: BASE=https://counter-check.h-847.workers.dev DEMO_KEY=... STACK=aws node scripts/eval-intake.mjs   (STACK=free for Gemini)
const BASE = process.env.BASE || 'https://counter-check.h-847.workers.dev', STACK = process.env.STACK || 'aws';
const SP = 'Sole proprietorship', PA = 'Partnership', CO = 'Corporation', FB = 'Food & beverage', SV = 'Services', WR = 'Wholesale & retail', MF = 'Manufacturing', CN = 'Construction';
const CASES = [
  ["Si Elena Santos, may-ari ng Elena's Artisan Bakery, sole prop, food business. 750k ang loan. Married kay Ramon Santos, may BPI account.", { business: "Elena's Artisan Bakery", name: 'Elena Santos', type: SP, industry: FB, amount: 750000, civilStatus: 'married', spouseName: 'Ramon Santos', bpiAccount: true }],
  ['Walk-in po, Mang Tonyo Reyes ng Reyes Auto Repair. Single, sole proprietor. Gusto niya 300k para sa bagong lift. Wala pa siyang account sa BPI.', { business: 'Reyes Auto Repair', name: 'Tonyo Reyes', type: SP, industry: SV, amount: 300000, civilStatus: 'single', bpiAccount: false }],
  ['Corporation, Pacific Steel Fabricators Inc. Signatory si Engr. Carlo Mendoza. 5M term loan, may titulo ng lupa as collateral. Manufacturing.', { business: 'Pacific Steel Fabricators Inc', name: 'Carlo Mendoza', type: CO, industry: MF, amount: 5000000, secured: true }],
  ['partnership po, sina Ana at Ben Cruz, Cruz Siblings Trading, bigasan sa palengke. 1.2M. kasal si Ana kay Jun Villanueva. may account sa BPI', { business: 'Cruz Siblings Trading', type: PA, industry: WR, amount: 1200000, civilStatus: 'married', spouseName: 'Jun Villanueva', bpiAccount: true }],
  ['Si Maria Lopez, biyuda, may carinderia, Lopez Eatery. sole prop. 200 thousand lang kailangan.', { business: 'Lopez Eatery', name: 'Maria Lopez', type: SP, industry: FB, amount: 200000, civilStatus: 'widowed' }],
  ['Construction yung client, JDG Builders Corp. Si Joseph Dela Rosa yung president. 8.5 million, secured by property. BPI depositor na sila.', { business: 'JDG Builders Corp', name: 'Joseph Dela Rosa', type: CO, industry: CN, amount: 8500000, secured: true, bpiAccount: true }],
  ['hiwalay po sa asawa si Grace Tan, owner ng Tan Printing Services, sole prop. 450k pang bili ng printer. walang collateral.', { business: 'Tan Printing Services', name: 'Grace Tan', type: SP, industry: SV, amount: 450000, civilStatus: 'separated', secured: false }],
  ["Kim's Laundry Hub, sole proprietor si Kim Navarro, single. P650,000 loan. clean loan lang, no collateral. may payroll account sa BPI.", { business: "Kim's Laundry Hub", name: 'Kim Navarro', type: SP, industry: SV, amount: 650000, civilStatus: 'single', secured: false, bpiAccount: true }],
  ['Mag-asawang Luis at Carmen Bautista, Bautista Bakeshop. Si Luis yung owner, sole prop. Kailangan nila 900k. Walang BPI account.', { business: 'Bautista Bakeshop', name: 'Luis Bautista', type: SP, industry: FB, amount: 900000, civilStatus: 'married', spouseName: 'Carmen Bautista', bpiAccount: false }],
  ['Golden Harvest Agri Supply, partnership. Managing partner si Ramon Aquino, married to Liza Aquino. 2.5M working capital. Retail ng fertilizer.', { business: 'Golden Harvest Agri Supply', name: 'Ramon Aquino', type: PA, industry: WR, amount: 2500000, civilStatus: 'married', spouseName: 'Liza Aquino' }],
  ['Sir, si Dennis Uy po, single, sole prop ng Uy Hardware. 1M po. May collateral na condo unit. BPI account holder.', { business: 'Uy Hardware', name: 'Dennis Uy', type: SP, industry: WR, amount: 1000000, civilStatus: 'single', secured: true, bpiAccount: true }],
  ["Ms. Joy Ramos, owner of Joy's Salon and Spa, sole proprietor. Married to Mark Ramos. Loan amount PHP 350,000. No BPI account yet.", { business: "Joy's Salon and Spa", name: 'Joy Ramos', type: SP, industry: SV, amount: 350000, civilStatus: 'married', spouseName: 'Mark Ramos', bpiAccount: false }],
  ['Fresh Catch Seafoods Corporation, food processing. Authorized signatory Teresa Lim. 12 million pesos, may real estate mortgage.', { business: 'Fresh Catch Seafoods Corporation', name: 'Teresa Lim', type: CO, amount: 12000000, secured: true }],
  ['Si Pedro Santiago, sole prop, Santiago Hollow Blocks, gumagawa ng hollow blocks. 600k. Single siya.', { business: 'Santiago Hollow Blocks', name: 'Pedro Santiago', type: SP, industry: MF, amount: 600000, civilStatus: 'single' }],
  ['Corporation, Sunrise Logistics Inc. Pres. si Albert Go. 4M. May BPI corporate account. Services.', { business: 'Sunrise Logistics Inc', name: 'Albert Go', type: CO, industry: SV, amount: 4000000, bpiAccount: true }],
  ["si aling Rosa Garcia, sari-sari store, Rosa's Store, sole prop, kasal kay Pedro Garcia, 150k", { business: "Rosa's Store", name: 'Rosa Garcia', type: SP, industry: WR, amount: 150000, civilStatus: 'married', spouseName: 'Pedro Garcia' }],
  ['Partnership po, M&J Catering Services, partners sina Mike Santos at Jen Reyes. 800k. Si Mike yung kausap, single siya.', { business: 'M&J Catering Services', name: 'Mike Santos', type: PA, amount: 800000, civilStatus: 'single' }],
  ['Bagong client: Carlos Dizon ng Dizon Furniture Manufacturing, sole proprietorship, 1.5 milyon, widower', { business: 'Dizon Furniture Manufacturing', name: 'Carlos Dizon', type: SP, industry: MF, amount: 1500000, civilStatus: 'widowed' }],
  ['Owner si Liza Fernandez, Fernandez Construction Supply, sole prop, 3M, may titulo as collateral, kasal kay Noel Fernandez, may BPI account', { business: 'Fernandez Construction Supply', name: 'Liza Fernandez', type: SP, amount: 3000000, civilStatus: 'married', spouseName: 'Noel Fernandez', secured: true, bpiAccount: true }],
  ['Si Ramon dela Cruz, single, sole prop ng RDC Water Refilling Station. 250k.', { business: 'RDC Water Refilling Station', name: 'Ramon dela Cruz', type: SP, amount: 250000, civilStatus: 'single' }],
];
const norm = (v) => (typeof v === 'string' ? v.toLowerCase().replace(/[.\s]+$/g, '').replace(/\s+/g, ' ').trim() : v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tally = {}, wrong = [];
let failed = 0;
for (const [i, [text, want]] of CASES.entries()) {
  const r = await fetch(`${BASE}/api/intake`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-key': process.env.DEMO_KEY || '' }, body: JSON.stringify({ text, stack: STACK }) });
  const b = await r.json().catch(() => ({}));
  if (r.status !== 200) { failed++; console.log(`note ${i + 1}: HTTP ${r.status} ${b.error || ''}`); continue; }
  const got = b.fields || {};
  for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) {
    const t = (tally[k] ||= { correct: 0, wrong: 0, missed: 0, extra: 0 });
    if (!(k in want)) { t.extra++; wrong.push(`note ${i + 1} ${k}: filled ${JSON.stringify(got[k])}, not scored`); continue; }
    if (!(k in got)) { t.missed++; continue; }
    if (norm(got[k]) === norm(want[k])) t.correct++; else { t.wrong++; wrong.push(`note ${i + 1} ${k}: got ${JSON.stringify(got[k])}, expected ${JSON.stringify(want[k])}`); }
  }
  if (STACK === 'free') await sleep(7000); // Gemini's free tier allows about 10 calls a minute
}
const sum = Object.values(tally).reduce((a, t) => ({ correct: a.correct + t.correct, wrong: a.wrong + t.wrong, missed: a.missed + t.missed, extra: a.extra + t.extra }), { correct: 0, wrong: 0, missed: 0, extra: 0 });
console.log(`stack ${STACK}, ${CASES.length} notes, ${failed} failed calls`);
for (const [k, t] of Object.entries(tally)) console.log(`${k.padEnd(12)} correct ${t.correct}  wrong ${t.wrong}  missed ${t.missed}  extra ${t.extra}`);
console.log(`all fields   correct ${sum.correct}  wrong ${sum.wrong}  missed ${sum.missed}  extra ${sum.extra}`);
for (const w of wrong) console.log('  ' + w);
