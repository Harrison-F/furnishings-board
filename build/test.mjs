#!/usr/bin/env node
/*
 * Behaviour tests for the built board, driven with REAL input events over CDP.
 *
 *   npm install && node build/test.mjs
 *
 * Synthetic events (el.dispatchEvent(new MouseEvent('click'))) do not go through
 * the pointer pipeline, and once hid two real bugs here: pointer capture
 * retargeting the click event, and right-click starting a pan. Always test this
 * page with page.mouse.*, never with dispatchEvent.
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pup from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.resolve(HERE, '..', 'index.html');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const wait = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
const ok = (name, cond) => {if (!cond) failures++; console.log((cond ? 'PASS  ' : 'FAIL  ') + name);};

const browser = await pup.launch({executablePath: CHROME, headless: 'shell', args: ['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width: 1440, height: 900});
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => {if (m.type() === 'error') errs.push(m.text());});
await page.goto(PAGE, {waitUntil: 'load'});
await wait(600);

const state = () => page.evaluate(() => {
  const c = document.getElementById('callout');
  return {open: !c.hidden, href: (c.href || '').slice(8, 34), top: c.style.top, left: c.style.left,
          tx: Math.round(tx), ty: Math.round(ty), stuck: last !== null};
});
const box = i => page.evaluate(i => {
  const r = document.querySelectorAll('a.item')[i].getBoundingClientRect();
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
}, i);

let b = await box(44);
await page.mouse.click(b.x, b.y); await wait(200);
let s = await state();
ok('left click opens the callout', s.open && s.href.length > 0);

await page.keyboard.press('Escape'); await wait(100);
ok('Escape dismisses', !(await state()).open);

const t0 = await state();
await page.mouse.move(b.x, b.y); await page.mouse.down();
for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + i * 15, b.y + i * 8);
await page.mouse.up(); await wait(150);
s = await state();
ok('a drag pans and opens nothing', !s.open && (s.tx !== t0.tx || s.ty !== t0.ty));

b = await box(44);
const t1 = await state();
await page.mouse.move(b.x, b.y);
await page.mouse.down({button: 'right'});
await page.mouse.move(b.x + 140, b.y + 100);
await page.mouse.move(b.x + 200, b.y + 160);
const t2 = await state();
ok('right-press and move does not pan', t1.tx === t2.tx && t1.ty === t2.ty && !t2.stuck);
await page.mouse.up({button: 'right'});

b = await box(44);
await page.keyboard.down('Control'); await page.mouse.click(b.x, b.y); await page.keyboard.up('Control');
await wait(150);
ok('ctrl+click falls through to the browser', !(await state()).open);

await page.mouse.click(b.x, b.y); await wait(150);
const p1 = await state();
await page.mouse.move(700, 600); await page.mouse.down();
await page.mouse.move(600, 540); await page.mouse.move(500, 480); await page.mouse.up();
await wait(150);
ok('dragging the canvas dismisses it', p1.open && !(await state()).open);

b = await box(44);
await page.mouse.click(b.x, b.y); await wait(150);
const z1 = await state();
await page.evaluate(() => {zoomAt(720, 450, 1.6); zoomAt(720, 450, 1.6);});
await wait(150);
const z2 = await state();
ok('zoom re-anchors it to its piece', z1.open && z2.open && (z1.left !== z2.left || z1.top !== z2.top));
await page.keyboard.press('Escape');
await page.evaluate(() => fitBoard());

await page.mouse.click(1200, 800); await wait(150);
ok('clicking empty canvas dismisses', !(await state()).open);

await page.click('#vGrid'); await wait(500);
const g = await page.evaluate(() => {
  const r = document.querySelector('#grid a[href]').getBoundingClientRect();
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
});
await page.mouse.click(g.x, g.y); await wait(200);
ok('grid view opens the callout too', (await state()).open);

await page.click('#vBoard'); await wait(200);
await page.evaluate(() => {for (let i = 0; i < 14; i++) zoomAt(720, 450, 1.3);});
await wait(700);
const upgraded = await page.evaluate(() => recs.filter(r => r.up).length);
ok(`full-res swaps in on zoom (${upgraded} upgraded)`, upgraded > 0);

ok('no JS errors', errs.length === 0);
if (errs.length) console.log(errs.join(' | '));

await browser.close();
process.exit(failures ? 1 : 0);
