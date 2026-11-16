// Records a short clip of a Ka-Negosyo online referral: note fill, channel, save, then the BSO view of the case.
// Usage: PW=<playwright dir> CHROME=<chrome binary> OUT=<file.webm> node scripts/record-kanegosyo.cjs
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'https://counter-check.stimmie.dev/live';
const NOTE = 'Si Jun Salazar, may-ari ng Salazar Siomai House, sole prop, food business. 400k ang gusto niyang loan. Single, may BPI account, walang collateral. Nag-apply siya online sa Ka-Negosyo.';

(async () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'take-'));
  const b = await chromium.launch({ executablePath: process.env.CHROME, args: process.env.CHROME_ARGS ? [process.env.CHROME_ARGS] : [] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir, size: { width: 1280, height: 800 } } });
  const p = await ctx.newPage();
  const t0 = Date.now();
  const mark = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);

  await p.goto(`${BASE}?v=${Date.now()}#case`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const id = await p.inputValue('#f-id');
  mark(`case ${id}`);

  await p.fill('#chat-in', '');
  await p.locator('#chat-in').pressSequentially(NOTE, { delay: 15 });
  await p.click('#chat-send');
  await p.waitForTimeout(500);
  await p.waitForFunction(() => !document.getElementById('chat-send').disabled, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  mark('note filled');

  await p.locator('#f-channel').scrollIntoViewIfNeeded();
  await p.waitForTimeout(800);
  await p.selectOption('#f-channel', 'Ka-Negosyo online');
  await p.waitForTimeout(2000);
  mark('form: ' + JSON.stringify(await p.evaluate(() => ['f-business','f-name','f-type','f-industry','f-amount','f-civil','f-channel'].map((i) => document.getElementById(i).value))));
  await p.click('#save-case');
  await p.waitForFunction(() => document.getElementById('checklist').children.length > 0, null, { timeout: 30000 });
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await p.waitForTimeout(4000);
  mark(`saved: ${await p.textContent('#ph-meta')}`);

  await p.goto(`${BASE}?id=${id}&role=bso&v=${Date.now()}#case`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(5000);
  mark(`bso: ${await p.textContent('#ph-meta')}`);

  const v = p.video();
  await ctx.close(); await b.close();
  const out = process.env.OUT || 'kanegosyo.webm';
  fs.copyFileSync(await v.path(), out);
  console.log('saved', out);
})();
