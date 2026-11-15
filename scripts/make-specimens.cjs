// Draws the synthetic sample papers in the layout of the real documents and saves them as PNG files.
// The people and the business are made up, every page carries a SPECIMEN mark, and no official seal or logo is drawn.
// Usage: PW=<playwright dir> CHROME=<chrome binary> node scripts/make-specimens.cjs <out folder>
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const path = require('path');

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/make-specimens.cjs <out folder>'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });

const BIZ = 'ELENA ARTISAN BAKERY', OWNER = 'ELENA REYES SANTOS', SPOUSE = 'RAMON DIZON SANTOS';
const ADDR = '12 Rizal Street, Batong Malake, Los Baños, Laguna 4030', TIN = '123-456-789-000';

// ponytail: a small fixed generator so every run draws the same pages
let seed = 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const peso = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CSS = `
*{box-sizing:border-box} html,body{margin:0}
body{font-family:'Liberation Sans',Arial,sans-serif;color:#1b1b1b}
.page{width:1240px;height:1754px;position:relative;background:#fdfcf8;overflow:hidden;padding:84px 96px}
.card{width:1012px;height:638px;position:relative;overflow:hidden;
  background:repeating-linear-gradient(118deg,rgba(40,70,140,.035) 0 2px,transparent 2px 9px),linear-gradient(105deg,#e9f0fb 0%,#fbf8ea 52%,#fbecec 100%)}
.wm{position:absolute;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font:800 150px 'Liberation Sans';letter-spacing:.08em;color:rgba(200,40,40,.11);white-space:nowrap;pointer-events:none}
.foot{position:absolute;left:96px;right:96px;bottom:64px;display:flex;justify-content:space-between;font-size:15px;color:#6b6b6b}
.serif{font-family:'Liberation Serif','Times New Roman',serif}
.typed{font-family:'Liberation Mono','Courier 10 Pitch',monospace;font-size:21px;color:#141a3a}
.sig{font-family:'Z003',cursive;font-style:italic;font-size:46px;color:#1b2a8a;display:inline-block;transform:rotate(-5deg);line-height:1}
.stamp{position:absolute;border:4px double rgba(84,44,150,.72);color:rgba(84,44,150,.78);font:700 20px 'Liberation Sans';padding:10px 16px;text-align:center;line-height:1.35;letter-spacing:.04em}
.c{text-align:center}
table{border-collapse:collapse;width:100%}
`;

const sig = (name, style = '') => `<span class="sig" style="${style}">${name}</span>`;
const foot = (pageText = '') => `<div class="foot"><span>SPECIMEN, synthetic test document. The person and the business are made up.</span><span>${pageText}</span></div>`;
// zoomed() enlarges a page's own content to fill the sheet
const zoomed = (z, inner) => `<div style="zoom:${z};width:${(1048 / z).toFixed(1)}px">${inner}</div>`;
const doc = (body, cls = 'page') => `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="${cls}">${body}</div>`;

// a block that looks like a QR code and decodes to nothing
function codeBlock(size, n = 33) {
  const c = size / n, cells = [];
  const finder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let on = rnd() < 0.48;
    if (finder(x, y)) { const fx = x >= n - 7 ? x - (n - 7) : x, fy = y >= n - 7 ? y - (n - 7) : y; on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4); }
    if (on) cells.push(`<rect x="${(x * c).toFixed(2)}" y="${(y * c).toFixed(2)}" width="${(c + 0.3).toFixed(2)}" height="${(c + 0.3).toFixed(2)}"/>`);
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="background:#fff" fill="#111">${cells.join('')}</svg>`;
}

const face = (w, h, fade = 1) => `<svg width="${w}" height="${h}" viewBox="0 0 100 124" style="background:#dfe5ee;opacity:${fade}"><circle cx="50" cy="44" r="23" fill="#9aa5b6"/><path d="M8 124c0-30 18-46 42-46s42 16 42 46z" fill="#9aa5b6"/></svg>`;

// National ID, drawn after the layout of the PhilID card. It prints no validity date.
function idFront(last, given, middle, born, pcn) {
  const f = (label, value, size = 30) => `<div style="margin-bottom:11px"><div style="font-size:14px;color:#3c4a66">${label}</div><div style="font:700 ${size}px 'Liberation Sans';letter-spacing:.01em">${value}</div></div>`;
  return doc(`
  <div class="c" style="padding-top:20px;line-height:1.22">
    <div style="font:700 25px 'Liberation Sans';letter-spacing:.05em">REPUBLIKA NG PILIPINAS</div>
    <div style="font-size:16px">Republic of the Philippines</div>
    <div style="font:700 23px 'Liberation Sans';letter-spacing:.04em;margin-top:5px">PAMBANSANG PAGKAKAKILANLAN</div>
    <div style="font-size:16px">Philippine Identification Card</div>
  </div>
  <div style="position:absolute;left:44px;top:176px;font:700 22px 'Liberation Mono'">${pcn}</div>
  <div style="position:absolute;left:44px;top:214px;border:1px solid #8b96a8">${face(250, 310)}</div>
  <div style="position:absolute;left:338px;top:172px;width:520px">
    ${f('Apelyido/Last Name', last)}${f('Mga Pangalan/Given Names', given)}${f('Gitnang Apelyido/Middle Name', middle)}
    ${f('Petsa ng Kapanganakan/Date of Birth', born)}
    ${f('Tirahan/Address', '12 RIZAL STREET, BATONG MALAKE,<br>LOS BAÑOS, LAGUNA, 4030', 20)}
  </div>
  <div style="position:absolute;right:44px;top:330px;border:1px solid #b9c1ce">${face(112, 139, 0.55)}</div>
  <div style="position:absolute;left:44px;bottom:26px;font:700 15px 'Liberation Sans';color:#b02a2a">SPECIMEN, not a real ID</div>
  <div class="wm" style="top:62%;font-size:112px;color:rgba(200,40,40,.09)">SPECIMEN</div>`, 'card');
}

function idBack() {
  const f = (label, value) => `<div style="margin-bottom:15px"><div style="font-size:14px;color:#3c4a66">${label}</div><div style="font:700 25px 'Liberation Sans'">${value}</div></div>`;
  return doc(`
  <div style="position:absolute;left:44px;top:48px;width:520px">
    ${f('Araw ng pagkakaloob/Date of issue', '18 AUGUST 2022')}${f('Kasarian/Sex', 'FEMALE')}${f('Uri ng Dugo/Blood Type', 'O+')}
    ${f('Kalagayang Sibil/Marital Status', 'MARRIED')}${f('Lugar ng Kapanganakan/Place of Birth', 'CALAMBA CITY, LAGUNA')}
  </div>
  <div style="position:absolute;right:52px;top:52px;border:10px solid #fff">${codeBlock(330)}</div>
  <div style="position:absolute;left:44px;right:44px;bottom:24px;display:flex;justify-content:space-between;align-items:flex-end;font-size:15px">
    <span>If found, please return to the nearest PSA Office.<br>www.psa.gov.ph</span><span style="font-weight:700;color:#b02a2a">SPECIMEN, not a real ID</span>
  </div>
  <div class="wm" style="top:60%;font-size:112px;color:rgba(200,40,40,.08)">SPECIMEN</div>`, 'card');
}

const frame = (inner) => `<div style="position:absolute;inset:40px;border:3px solid #24406e"></div><div style="position:absolute;inset:50px;border:1px solid #24406e"></div>${inner}`;
const dtiHead = `
  <div class="c serif" style="line-height:1.3;margin-top:28px">
    <div style="font-size:21px">Republic of the Philippines</div>
    <div style="font:700 31px 'Liberation Serif';letter-spacing:.04em;color:#1c3464">DEPARTMENT OF TRADE AND INDUSTRY</div>
    <div style="font:italic 60px 'Z003';color:#1c3464;margin-top:26px">Certificate of Business Name Registration</div>
  </div>`;

function dti1() {
  return doc(frame(`${dtiHead}
  <div class="c serif" style="font-size:24px;line-height:1.6;margin-top:44px;padding:0 30px">
    <div>This certifies that</div>
    <div style="font:700 50px 'Liberation Serif';margin:20px 0 4px">${BIZ}</div>
    <div style="font-size:20px">(MUNICIPALITY OF LOS BAÑOS, LAGUNA)</div>
    <p style="margin:34px 0 0">is a business name registered in this office pursuant to the provisions of Act 3883, as amended by Act 4147 and Republic Act No. 863, and in compliance with the applicable rules and regulations prescribed by the Department of Trade and Industry. This certificate issued to</p>
    <div style="font:700 38px 'Liberation Serif';margin:24px 0">${OWNER}</div>
    <p style="margin:0">is valid from May 14, 2025 to May 14, 2030, subject to continuing compliance with the above-mentioned laws and all applicable laws of the Philippines.</p>
    <p style="margin:30px 0 0">In testimony whereof, I hereby sign this Certificate of Business Name Registration and issue the same on May 14, 2025 in the Philippines.</p>
  </div>
  <div class="c" style="margin-top:44px">${sig('M. Villareal')}
    <div class="serif" style="font:700 23px 'Liberation Serif';margin-top:2px">MA. LOURDES A. VILLAREAL</div><div class="serif" style="font-size:20px">Secretary</div></div>
  <div style="position:absolute;left:112px;bottom:112px;font-size:18px;line-height:1.6">
    <div>Business Name No. 4517862</div><div>Certificate ID No. BN-20250514-0093</div><div>Official Receipt No. 20718844, PHP 530.00</div>
    <div style="margin-top:8px;font-size:15px;color:#555">This certificate is not a license to engage in any kind of business and is valid only at the scope indicated herein.</div></div>
  <div style="position:absolute;right:116px;bottom:112px;border:1px solid #999;padding:6px">${codeBlock(150, 29)}</div>
  <div class="wm" style="top:67%">SPECIMEN</div>`) + foot('Page 1 of 2'));
}

function dti2() {
  const terms = [
    'The registered name shall be used only by the owner named in the certificate and only within the territorial scope stated on page 1.',
    'The registration is valid for five (5) years from the date of issue and may be renewed within the period set by the Department.',
    'The owner shall display the certificate in a conspicuous place in the establishment at all times.',
    'Any change in the owner\'s address, the location of the establishment or the nature of the trade shall be reported to the Department within thirty (30) days.',
    'The registration does not grant the owner the right to operate without the licenses and clearances that other government offices require.',
    'The Department may cancel the registration when the name was obtained through false statements, or when the owner violates the terms stated here.',
    'A cancelled or expired name may be registered by another applicant after the period set by the Department.',
  ];
  return doc(frame(`${dtiHead}
  <div class="serif" style="font-size:23px;line-height:1.55;margin-top:50px;padding:0 44px">
    <div class="c" style="font:700 25px 'Liberation Serif';letter-spacing:.06em">TERMS AND CONDITIONS OF REGISTRATION</div>
    <ol style="margin:26px 0 0;padding-left:34px">${terms.map((t) => `<li style="margin-bottom:16px">${t}</li>`).join('')}</ol>
    <p style="margin-top:34px">Business Name No. 4517862 &nbsp; Certificate ID No. BN-20250514-0093</p>
    <p>The owner received this certificate and agrees to the terms above.</p>
    <div style="margin-top:30px">${sig('Elena R. Santos')}<div style="border-top:1px solid #333;width:420px;font-size:19px;padding-top:4px">Signature of the owner over printed name</div></div>
  </div>
  <div class="wm" style="top:70%">SPECIMEN</div>`) + foot('Page 2 of 2'));
}

function bir() {
  const cell = 'border:1.5px solid #222;padding:8px 12px;vertical-align:top';
  const lab = (t) => `<div style="font-size:13px;color:#333;letter-spacing:.03em">${t}</div>`;
  const val = (t) => `<div class="typed" style="font-size:22px;font-weight:700;margin-top:3px">${t}</div>`;
  const taxes = [['INCOME TAX', '1701Q / 1701', 'Quarterly / Annually', '01/02/2019'], ['PERCENTAGE TAX', '2551Q', 'Quarterly', '01/02/2019'], ['REGISTRATION FEE', '0605', 'Annually', '01/02/2019']];
  return doc(zoomed(1.14, `
  <div style="display:flex;justify-content:space-between;font-size:15px"><div>BIR Form No. 2303<br>Revised January 2018</div><div style="text-align:right">OCN 2RC0000917442<br>Serial No. 0558213</div></div>
  <div class="c" style="line-height:1.3;margin-top:6px">
    <div style="font-size:18px">REPUBLIKA NG PILIPINAS</div><div style="font-size:18px">KAGAWARAN NG PANANALAPI</div>
    <div style="font:700 22px 'Liberation Sans'">KAWANIHAN NG RENTAS INTERNAS</div>
    <div style="font:700 36px 'Liberation Sans';letter-spacing:.05em;margin-top:18px">CERTIFICATE OF REGISTRATION</div>
  </div>
  <table style="margin-top:26px">
    <tr><td style="${cell};width:50%">${lab('TIN')}${val(TIN)}</td><td style="${cell}">${lab('REGISTERING OFFICE')}${val('RDO 055, SAN PABLO CITY')}</td></tr>
    <tr><td style="${cell}" colspan="2">${lab('NAME OF TAXPAYER')}${val('SANTOS, ELENA REYES')}</td></tr>
    <tr><td style="${cell}" colspan="2">${lab('TRADE NAME')}${val(BIZ)}</td></tr>
    <tr><td style="${cell}" colspan="2">${lab('REGISTERED ADDRESS')}${val('12 RIZAL STREET, BATONG MALAKE, LOS BAÑOS, LAGUNA 4030')}</td></tr>
    <tr><td style="${cell}">${lab('DATE OF REGISTRATION')}${val('JANUARY 2, 2019')}</td><td style="${cell}">${lab('TAXPAYER TYPE')}${val('SINGLE PROPRIETOR')}</td></tr>
    <tr><td style="${cell}" colspan="2">${lab('LINE OF BUSINESS')}${val('1071 MANUFACTURE OF BAKERY PRODUCTS')}</td></tr>
  </table>
  <table style="margin-top:22px;font-size:17px">
    <tr style="background:#e6e6e6;font-weight:700">${['TAX TYPE', 'FORM TYPE', 'FILING FREQUENCY', 'START DATE'].map((h) => `<td style="${cell}">${h}</td>`).join('')}</tr>
    ${taxes.map((r) => `<tr>${r.map((x) => `<td style="${cell}" class="typed">${x}</td>`).join('')}</tr>`).join('')}
  </table>
  <p style="font-size:17px;line-height:1.5;margin-top:24px">This certifies that the above taxpayer is registered in this office pursuant to the provisions of the National Internal Revenue Code, as amended. The taxpayer shall file the returns and pay the taxes listed above on or before the dates set by law.</p>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:40px">
    <div style="font-size:17px;line-height:1.6">Date issued<br><span class="typed" style="font-weight:700">JANUARY 2, 2019</span></div>
    <div class="c">${sig('R. Manalastas')}<div style="font:700 19px 'Liberation Sans'">ROMULO T. MANALASTAS</div><div style="font-size:16px">Revenue District Officer</div></div>
  </div>`) + `
  <div class="c" style="position:absolute;left:96px;right:96px;bottom:108px;border:2px solid #222;padding:12px;font:700 21px 'Liberation Sans';letter-spacing:.03em">POST THIS CERTIFICATE CONSPICUOUSLY IN YOUR PLACE OF BUSINESS</div>
  <div class="stamp" style="left:130px;bottom:250px;transform:rotate(-7deg)">RECEIVED<br>RDO 055<br>JAN 02 2019</div>
  <div class="wm" style="top:60%">SPECIMEN</div>` + foot());
}

function permit() {
  const row = (l, v) => `<tr><td style="padding:9px 0;width:300px;font-size:19px;color:#333">${l}</td><td style="padding:9px 0;border-bottom:1px solid #777" class="typed"><b>${v}</b></td></tr>`;
  const fee = 'border:1px solid #444;padding:7px 12px;font-size:17px';
  const fees = [['Mayor\'s permit fee', 1500], ['Business tax', 6240], ['Garbage fee', 600], ['Fire safety inspection fee', 624], ['Business plate and sticker', 350]];
  return doc(frame(`
  <div class="c" style="line-height:1.3;margin-top:22px">
    <div style="font-size:19px">Republic of the Philippines</div><div style="font-size:19px">Province of Laguna</div>
    <div style="font:700 27px 'Liberation Sans';letter-spacing:.03em">MUNICIPALITY OF LOS BAÑOS</div>
    <div style="font-size:19px">Business Permits and Licensing Office</div>
    <div style="font:800 62px 'Liberation Sans';letter-spacing:.05em;color:#7a1515;margin-top:20px">BUSINESS PERMIT</div>
    <div style="font:700 44px 'Liberation Sans';color:#7a1515">2026</div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:19px;margin:26px 34px 0"><div>Permit No. <b class="typed">2026-001482</b></div><div>Business Plate No. <b class="typed">LB-04417</b></div></div>
  <p style="font-size:20px;line-height:1.5;margin:22px 34px 8px">Pursuant to the Revenue Code of the Municipality, and after payment of the taxes, fees and charges listed below, this permit is granted to</p>
  <table style="margin:0 34px;width:auto;min-width:980px">
    ${row('Business name', BIZ)}${row('Owner', OWNER)}${row('Business address', ADDR.toUpperCase())}
    ${row('Line of business', 'BAKERY (RETAIL AND WHOLESALE)')}${row('Kind of ownership', 'SINGLE PROPRIETORSHIP')}${row('Date issued', 'January 15, 2026')}
  </table>
  <div class="c" style="margin:26px 34px 0;border:2px solid #7a1515;padding:12px;font:700 25px 'Liberation Sans';color:#7a1515">Valid until December 31, 2026</div>
  <table style="margin:26px 34px 0;width:560px">
    <tr style="background:#e9e4e4;font-weight:700"><td style="${fee}">Taxes, fees and charges</td><td style="${fee};text-align:right">Amount (PHP)</td></tr>
    ${fees.map(([l, a]) => `<tr><td style="${fee}">${l}</td><td style="${fee};text-align:right" class="typed">${peso(a)}</td></tr>`).join('')}
    <tr style="font-weight:700"><td style="${fee}">Total paid, O.R. No. 4821993</td><td style="${fee};text-align:right" class="typed">${peso(fees.reduce((s, x) => s + x[1], 0))}</td></tr>
  </table>
  <div class="c" style="position:absolute;right:120px;bottom:214px">${sig('R. Alcantara')}<div style="font:700 21px 'Liberation Sans'">HON. ROBERTO M. ALCANTARA</div><div style="font-size:18px">Municipal Mayor</div></div>
  <div class="stamp" style="right:150px;bottom:420px;transform:rotate(6deg)">PAID<br>JAN 15 2026<br>MUNICIPAL TREASURER</div>
  <div class="c" style="position:absolute;left:96px;right:96px;bottom:104px;font-size:16px;color:#333">This permit shall be posted in a conspicuous place in the establishment and is not valid without the official receipt. It is renewed on or before January 20 of each year.</div>
  <div class="wm" style="top:58%">SPECIMEN</div>`) + foot());
}

function bank() {
  const days = [];
  for (const [m, name, len] of [[8, 'Aug', 31], [9, 'Sep', 30], [10, 'Oct', 31]]) {
    const picks = new Set(); while (picks.size < 10) picks.add(1 + Math.floor(rnd() * len));
    for (const d of [...picks].sort((a, b) => a - b)) days.push(`${name} ${String(d).padStart(2, '0')}`);
  }
  const kinds = [['CASH DEPOSIT', 1, 18000, 52000], ['POS SETTLEMENT', 1, 9000, 31000], ['INSTAPAY TRANSFER IN', 1, 4000, 22000], ['CHECK ISSUED, FLOUR SUPPLIER', -1, 21000, 46000], ['ELECTRIC BILL PAYMENT', -1, 7800, 12400], ['PAYROLL TRANSFER OUT', -1, 24000, 30000], ['ATM WITHDRAWAL', -1, 5000, 20000], ['RENT PAYMENT', -1, 18000, 18000]];
  const tx = days.map((d) => { const k = kinds[Math.floor(rnd() * kinds.length)]; return { d, text: k[0], amt: k[1] * Math.round((k[2] + rnd() * (k[3] - k[2])) / 50) * 50 }; });
  const net = tx.reduce((s, t) => s + t.amt, 0), end = 210400, start = end - net;
  let bal = start;
  const td = 'padding:6px 10px;border-bottom:1px solid #d5d5d5';
  const rows = tx.map((t, i) => { bal += t.amt; return `<tr><td style="${td}">${t.d}</td><td style="${td}">${t.text}</td><td style="${td}">${String(500214 + i * 37)}</td><td style="${td};text-align:right">${t.amt < 0 ? peso(-t.amt) : ''}</td><td style="${td};text-align:right">${t.amt > 0 ? peso(t.amt) : ''}</td><td style="${td};text-align:right">${peso(bal)}</td></tr>`; }).join('');
  const sum = (l, v) => `<td style="border:1px solid #9aa;padding:9px 12px"><div style="font-size:13px;color:#445">${l}</div><div style="font:700 19px 'Liberation Mono'">${v}</div></td>`;
  return doc(`
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:4px solid #1d4b3a;padding-bottom:14px">
    <div><div style="font:800 31px 'Liberation Sans';color:#1d4b3a;letter-spacing:.02em">LAKESHORE SAVINGS BANK</div><div style="font-size:15px;color:#444;margin-top:3px">Los Baños Branch, National Highway, Los Baños, Laguna</div></div>
    <div style="text-align:right"><div style="font:700 25px 'Liberation Sans'">STATEMENT OF ACCOUNT</div><div style="font-size:15px;color:#444;margin-top:3px">Business checking account</div></div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:20px;font-size:18px;line-height:1.55">
    <div><b>${OWNER}</b><br>${BIZ}<br>12 Rizal Street, Batong Malake<br>Los Baños, Laguna 4030</div>
    <div style="text-align:right">Account number: XXXX-XXXX-42<br>Statement period: August 1, 2026 to October 31, 2026<br>Date printed: November 3, 2026<br>Currency: PHP</div>
  </div>
  <table style="margin-top:18px"><tr>${sum('Beginning balance', peso(start))}${sum('Total credits', peso(tx.filter((t) => t.amt > 0).reduce((s, t) => s + t.amt, 0)))}${sum('Total debits', peso(-tx.filter((t) => t.amt < 0).reduce((s, t) => s + t.amt, 0)))}${sum('Ending balance', `PHP ${peso(end)}`)}</tr></table>
  <table style="margin-top:20px;font:15.5px 'Liberation Mono'">
    <tr style="background:#1d4b3a;color:#fff;font:700 15px 'Liberation Sans'"><td style="padding:8px 10px">Date</td><td style="padding:8px 10px">Description</td><td style="padding:8px 10px">Reference</td><td style="padding:8px 10px;text-align:right">Debit</td><td style="padding:8px 10px;text-align:right">Credit</td><td style="padding:8px 10px;text-align:right">Balance</td></tr>
    <tr><td style="${td}">Aug 01</td><td style="${td}">BALANCE FORWARDED</td><td style="${td}"></td><td style="${td}"></td><td style="${td}"></td><td style="${td};text-align:right">${peso(start)}</td></tr>
    ${rows}
  </table>
  <p style="font-size:14px;color:#444;line-height:1.5;margin-top:16px">Please examine this statement at once. If no error is reported within thirty (30) days from the date printed, the account will be considered correct. Deposits are insured by the PDIC up to the amount set by law.</p>
  <div class="wm" style="top:63%">SPECIMEN</div>` + foot('Page 1 of 1'));
}

function cal() {
  const sign = (s, name, role) => `<div style="width:440px"><div style="height:64px;padding-left:30px">${sig(s)}</div><div style="border-top:1.5px solid #222;padding-top:6px;font:700 19px 'Liberation Sans'">${name}</div><div style="font-size:16px">${role}</div><div style="font-size:16px;margin-top:4px">Date signed: November 5, 2026</div></div>`;
  return doc(zoomed(1.16, `
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #7a1515;padding-bottom:12px">
    <div style="font:800 33px 'Liberation Sans';letter-spacing:.03em">CLIENT AUTHORIZATION LETTER</div><div style="font-size:15px;color:#444;text-align:right">Business Banking<br>Form CAL-01</div>
  </div>
  <div style="font-size:19.5px;line-height:1.62;margin-top:26px">
    <p>Date: November 5, 2026</p>
    <p>To the Bank,</p>
    <p>I/We, the undersigned, in connection with my/our application for a business loan in the name of <b>${BIZ}</b>, hereby authorize the Bank, its officers and its authorized representatives to do the following.</p>
    <ol style="padding-left:30px">
      <li style="margin-bottom:10px">To verify with any person, bank, credit bureau, government agency or other entity any information that I/we have given, including my/our deposit accounts, loans and other credit accommodations.</li>
      <li style="margin-bottom:10px">To obtain my/our basic credit data from the Credit Information Corporation, and to submit the same to it, as required by Republic Act No. 9510.</li>
      <li style="margin-bottom:10px">To collect, use, store and share my/our personal data for credit evaluation and for the administration of the loan, in line with Republic Act No. 10173, the Data Privacy Act of 2012.</li>
      <li style="margin-bottom:10px">To keep the documents that I/we submitted, whether or not the application is approved.</li>
    </ol>
    <p>I/We certify that all information and documents that I/we submitted are true, correct and complete. This authorization stays in force until the loan is fully paid or the application is withdrawn in writing.</p>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:34px">${sign('Elena R. Santos', OWNER, 'Borrower, signature over printed name')}${sign('Ramon D. Santos', SPOUSE, 'Spouse, signature over printed name')}</div>
  <div style="margin-top:34px;border:1px solid #888;padding:12px 16px;font-size:15px;color:#333;line-height:1.5">Signed by hand before the branch officer. ID presented by both signatories: National ID. Envelope ID 7C41-90AE-22D5.</div>`) + `
  <div class="wm" style="top:60%">SPECIMEN</div>` + foot('Page 1 of 1'));
}

// The form keeps one "Label: value" per line, because both readers pair a label with the value on the same line.
function form(tin, civil) {
  const band = (t) => `<div style="background:#7a1515;color:#fff;font:700 17px 'Liberation Sans';letter-spacing:.05em;padding:7px 12px;margin-top:20px">${t}</div>`;
  const row = (l, v) => `<div style="display:flex;align-items:flex-end;margin-top:15px"><div style="font-size:19px;white-space:nowrap">${l}:</div><div class="typed" style="flex:1;margin-left:12px;border-bottom:1px solid #b5b5b5;min-height:30px;padding:0 6px 5px;font-size:22px">${v}</div></div>`;
  return doc(zoomed(1.2, `
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #7a1515;padding-bottom:10px">
    <div><div style="font:800 34px 'Liberation Sans';letter-spacing:.03em">LOAN APPLICATION FORM</div><div style="font-size:16px;color:#444;margin-top:2px">Business loan for micro, small and medium enterprises</div></div>
    <div style="font-size:15px;color:#444;text-align:right">Form BL-01<br>Page 1 of 1</div>
  </div>
  <div style="font-size:15px;color:#444;margin-top:8px">Please type or print in block letters. Fill in every line. Write N/A where a line does not apply.</div>
  ${band('A. BUSINESS')}
  ${row('Business name', 'Elena Artisan Bakery')}${row('Address', '12 Rizal Street, Los Banos, Laguna')}${row('TIN', tin)}
  ${row('Nature of business', 'Bakery, retail and wholesale')}${row('Years in operation', '7')}
  ${band('B. APPLICANT')}
  ${row('Name of applicant', 'Elena Reyes Santos')}${row('Contact number', '0917 555 0142')}${row('Email', 'elena@example.com')}
  ${row('Civil status', civil)}${row('Name of spouse', 'Ramon Dizon Santos')}
  ${band('C. LOAN REQUEST')}
  ${row('Loan amount', 'PHP 750,000')}${row('Purpose', 'Oven and stock')}${row('Term', '36 months')}${row('Collateral', 'None')}
  ${band('D. CERTIFICATION')}
  <p style="font-size:16.5px;line-height:1.5;margin:14px 0 0">I certify that the information given in this form is true and correct. I authorize the Bank to verify it and to obtain information about my business and my credit standing from any source it considers appropriate. I understand that the Bank may ask for more documents and that this application does not bind the Bank to grant the loan.</p>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:26px">
    <div style="width:500px"><div style="height:58px;padding-left:40px">${sig('Elena R. Santos')}</div><div style="border-top:1.5px solid #222;padding-top:5px;font-size:16px">Signature over printed name of applicant</div></div>
    <div style="width:330px"><div class="typed" style="height:34px">November 5, 2026</div><div style="border-top:1.5px solid #222;padding-top:5px;font-size:16px">Date signed</div></div>
  </div>
  <div style="margin-top:26px;border:1.5px solid #555;padding:12px 16px;font-size:15px;color:#333"><b>FOR BANK USE ONLY</b><div style="display:flex;gap:40px;margin-top:10px"><span>Received by ________________</span><span>Branch code ________</span><span>Date received ______________</span></div></div>`) + `
  <div class="wm" style="top:86%;font-size:110px">SPECIMEN</div>` + foot());
}

const PAGES = {
  '01-application-form-first-visit': () => form('', 'Kasal'),
  '01b-application-form-corrected': () => form(TIN, 'Married'),
  '02-owner-id-front': () => idFront('SANTOS', 'ELENA', 'REYES', 'MARCH 14, 1985', '4318-7205-9164-3827'),
  '03-owner-id-back': idBack,
  '04-spouse-id-front': () => idFront('SANTOS', 'RAMON', 'DIZON', 'JULY 02, 1983', '6092-1548-3370-2916'),
  '05-dti-page-1': dti1,
  '05b-dti-page-2': dti2,
  '08-bank-statement': bank,
  '09-bir-cor': bir,
  '10-mayors-permit': permit,
  '11-client-authorization-letter': cal,
};

(async () => {
  const only = process.argv[3];
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [name, make] of Object.entries(PAGES)) {
    if (only && !name.includes(only)) { make(); continue; } // still drawn, so the generator stays in step
    const card = name.includes('-id-');
    const page = await browser.newPage({ viewport: card ? { width: 1012, height: 638 } : { width: 1240, height: 1754 } });
    await page.setContent(make());
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    await page.close();
    console.log(`${name}.png`);
  }
  await browser.close();
})();
