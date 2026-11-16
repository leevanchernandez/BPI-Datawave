// Records the live demo run sheet in docs/demo-script.md as a silent real-time take.
// Usage: PW=<playwright dir> CHROME=<chrome binary> OUT=<file.webm> node scripts/record-demo.cjs
// HD=1 renders at 2x and writes OUT as an H.264 mp4 built from screencast frames.
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'https://counter-check.stimmie.dev/live';
const NOTES = [
  "Elena Santos owns Elena's Artisan Bakery, a sole proprietorship in food and beverage. She wants a 750k loan. She's married to Ramon Santos and has a BPI account. No collateral.",
  "Si Elena Santos, may-ari ng Elena's Artisan Bakery, sole prop siya, food business. Gusto niya mag-loan ng 750k. Kasal kay Ramon Santos, may BPI account na, walang collateral.",
  "musta po!! c elena santos po ung owner ng Elena's Artisan Bakery, sole prop po xa, fud bsnes. gs2 nya po mg loan ng 750k. kSal n po xa ky Ramon Santos, my bpi acct n po, wLa pong collateral. tnx po :)",
];
const RETURN_NOTE = 'Bank statements must cover Sep to Nov 2026.';

(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.FRAMES_DIR || require('os').tmpdir(), 'take-'));
  const b = await chromium.launch({ executablePath: process.env.CHROME, args: process.env.CHROME_ARGS ? [process.env.CHROME_ARGS] : [] });
  const HD = !!process.env.HD;
  const ctx = await b.newContext(HD ? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 }, recordVideo: { dir, size: { width: 1280, height: 800 } } });
  const p = await ctx.newPage();
  const frames = [];
  let cdp;
  if (HD) {
    cdp = await ctx.newCDPSession(p);
    cdp.on('Page.screencastFrame', (f) => {
      const file = path.join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      frames.push({ file, t: f.metadata.timestamp });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    const start = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95 });
    await start();
    p.on('framenavigated', (fr) => { if (fr === p.mainFrame()) start().catch(() => {}); });
  }
  const t0 = Date.now();
  const mark = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
  const idle = () => p.waitForFunction(() => !document.getElementById('chat-send').disabled, null, { timeout: 60000 });
  const checkDone = () => p.waitForFunction(() => !document.getElementById('run-check').disabled && document.getElementById('progress').classList.contains('hidden'), null, { timeout: 120000 });

  await p.goto(`${BASE}?v=${Date.now()}#case`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const id = await p.inputValue('#f-id');
  mark(`case ${id}`);

  for (const note of NOTES) {
    await p.fill('#chat-in', '');
    await p.locator('#chat-in').pressSequentially(note, { delay: 15 });
    await p.click('#chat-send');
    await p.waitForTimeout(500);
    await idle();
    await p.waitForTimeout(2500);
    mark('note filled');
  }

  await p.click('#save-case');
  await p.waitForFunction(() => document.getElementById('checklist').children.length > 0, null, { timeout: 30000 });
  if (await p.$('#req-box summary')) await p.click('#req-box summary');
  await p.waitForTimeout(3000);
  mark('saved');

  await p.click('#sample-1');
  await p.waitForFunction(() => !document.getElementById('run-check').disabled, null, { timeout: 60000 });
  await p.click('#run-check');
  await p.waitForTimeout(1000);
  await checkDone();
  await p.locator('#result').scrollIntoViewIfNeeded();
  await p.waitForTimeout(5000);
  mark(`visit 1: ${await p.textContent('#verdict')}`);

  await p.click('#mode-ask');
  await p.locator('#chat').scrollIntoViewIfNeeded();
  await p.fill('#chat-in', '');
  await p.locator('#chat-in').pressSequentially('ano pa kulang?', { delay: 60 });
  await p.click('#chat-send');
  await p.waitForTimeout(500);
  await idle();
  await p.waitForTimeout(4000);
  mark('asked');

  const visit2 = async () => {
    if (await p.isEnabled('#clear-pages')) await p.click('#clear-pages');
    await p.click('#sample-2');
    await p.waitForFunction(() => !document.getElementById('run-check').disabled, null, { timeout: 60000 });
    await p.click('#run-check');
    await p.waitForTimeout(1000);
    await checkDone();
    await p.locator('#result').scrollIntoViewIfNeeded();
    await p.waitForTimeout(5000);
  };
  await visit2();
  mark(`visit 2: ${await p.textContent('#verdict')}`);
  await p.click('#handoff');
  await p.waitForTimeout(3000);
  mark('handed off');

  await p.goto(`${BASE}?id=${id}&role=bso&v=${Date.now()}`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => !document.getElementById('b-return-btn').disabled || document.getElementById('b-return-reason').value === '', null, { timeout: 30000 });
  await p.waitForTimeout(3000);
  await p.locator('#b-return-reason').scrollIntoViewIfNeeded();
  await p.locator('#b-return-reason').pressSequentially(RETURN_NOTE, { delay: 40 });
  await p.waitForFunction(() => !document.getElementById('b-return-btn').disabled, null, { timeout: 30000 });
  await p.click('#b-return-btn');
  await p.waitForTimeout(3000);
  mark('returned');

  await p.goto(`${BASE}?id=${id}&v=${Date.now()}#case`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  await visit2();
  await p.waitForTimeout(3000);
  mark(`re-check: ${await p.textContent('#verdict')} | ${(await p.textContent('#defects')).slice(0, 160)}`);

  await p.goto(`${BASE}?role=bso&v=${Date.now()}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  await p.locator('#cases-box').scrollIntoViewIfNeeded();
  await p.waitForTimeout(8000);
  mark('case list');

  if (HD) {
    await cdp.send('Page.stopScreencast');
    await ctx.close();
    await b.close();
    const list = frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1] || { t: f.t + 2 }).t - f.t).toFixed(3)}`).join('\n') + `\nfile '${frames[frames.length - 1].file}'\n`;
    fs.writeFileSync(path.join(dir, 'list.txt'), list);
    require('child_process').execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-vf', 'fps=30,scale=2560:1600:flags=lanczos', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', process.env.OUT || 'take.mp4']);
    fs.rmSync(dir, { recursive: true });
    console.log('saved', process.env.OUT || 'take.mp4');
    return;
  }
  const video = await p.video().path();
  await ctx.close();
  await b.close();
  fs.copyFileSync(video, process.env.OUT || 'take.webm');
  fs.rmSync(dir, { recursive: true });
  console.log('saved', process.env.OUT || 'take.webm');
})();
