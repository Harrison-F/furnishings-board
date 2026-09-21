#!/usr/bin/env node
/*
 * Rebuild the board from the Obsidian Excalidraw source.
 *
 *   node build/build.mjs [path/to/Drawing.excalidraw.md] [--fragment] [--out DIR]
 *
 * Defaults to ~/Desktop/Hermes/Excalidraw/Furnishings.excalidraw.md and writes
 * index.html + img/ at the repo root. --fragment omits the <!doctype>/<head>
 * wrapper, which is what claude.ai artifacts want (they supply their own).
 *
 * Needs: node, `npm install` in this directory, and ImageMagick (`convert`).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import LZString from 'lz-string';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const FULL_PX = 1400, FULL_Q = 80;   // swapped in when a piece is zoomed past ~400px wide
const THUMB_PX = 440, THUMB_Q = 72;  // inlined as data URIs so the whole board paints at once

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, d) => {const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1];};
const src = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out')
  || path.join(os.homedir(), 'Desktop/Hermes/Excalidraw/Furnishings.excalidraw.md');
const outDir = path.resolve(opt('--out', ROOT));

if (!fs.existsSync(src)) {fail(`no such drawing: ${src}`);}
function fail(m) {console.error('build: ' + m); process.exit(1);}

/* ---- 1. the drawing is lz-string-compressed JSON inside a fenced block ---- */
const md = fs.readFileSync(src, 'utf8');
const fence = md.match(/```compressed-json\n([\s\S]*?)\n```/);
let scene;
if (fence) {
  const json = LZString.decompressFromBase64(fence[1].replace(/\s/g, ''));
  if (!json) fail('could not decompress the compressed-json block');
  scene = JSON.parse(json);
} else {
  const plain = md.match(/```json\n([\s\S]*?)\n```/);   // "Decompress current Excalidraw file"
  if (!plain) fail('no drawing data found (expected a compressed-json or json fence)');
  scene = JSON.parse(plain[1]);
}

/* ---- 2. images are separate vault files, keyed by fileId in ## Embedded Files ---- */
const section = md.split('## Embedded Files')[1]?.split('\n## ')[0] || '';
const names = {};
for (const line of section.split('\n')) {
  const m = line.match(/^([0-9a-f]{40}):\s*\[\[(.+?)\]\]/);
  if (m) names[m[1]] = m[2];
}

const vault = path.resolve(opt('--vault', path.dirname(path.dirname(src))));
const index = new Map();
(function walk(dir, depth) {
  if (depth > 6) return;
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (!index.has(e.name)) index.set(e.name, p);
  }
})(vault, 0);

/* ---- 3. elements ---- */
const els = scene.elements.filter(e => !e.isDeleted && e.type === 'image');
if (!els.length) fail('no image elements in the drawing');
const missing = els.filter(e => !names[e.fileId] || !index.has(names[e.fileId]));
if (missing.length) fail(`${missing.length} image(s) not found under ${vault}, e.g. ${names[missing[0].fileId] || missing[0].fileId}`);

const minx = Math.min(...els.map(e => e.x)), miny = Math.min(...els.map(e => e.y));
const maxx = Math.max(...els.map(e => e.x + e.width)), maxy = Math.max(...els.map(e => e.y + e.height));
const r = n => Math.round(n * 10) / 10;
const items = els.map(e => {
  const o = {f: e.fileId, x: r(e.x - minx), y: r(e.y - miny), w: r(e.width), h: r(e.height)};
  if (e.link) o.l = e.link;
  if (e.crop) o.c = [r(e.crop.x), r(e.crop.y), r(e.crop.width), r(e.crop.height), e.crop.naturalWidth, e.crop.naturalHeight];
  return o;
});

/* ---- 4. two webp tiers, skipped when already current ---- */
const imgDir = path.join(outDir, 'img');
const thumbDir = path.join(HERE, 'thumb-cache');
fs.mkdirSync(imgDir, {recursive: true});
fs.mkdirSync(thumbDir, {recursive: true});
const fresh = (out, srcFile) => fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(srcFile).mtimeMs;
let built = 0;
for (const e of els) {
  const from = index.get(names[e.fileId]);
  const full = path.join(imgDir, e.fileId + '.webp');
  const thumb = path.join(thumbDir, e.fileId + '.webp');
  if (!fresh(full, from)) {
    execFileSync('convert', [from, '-auto-orient', '-resize', `${FULL_PX}x${FULL_PX}>`, '-quality', String(FULL_Q), full]);
    built++;
  }
  if (!fresh(thumb, full)) {
    execFileSync('convert', [full, '-resize', `${THUMB_PX}x${THUMB_PX}>`, '-quality', String(THUMB_Q), thumb]);
  }
}
/* drop renditions for pieces that are no longer on the board */
const keep = new Set(els.map(e => e.fileId + '.webp'));
for (const d of [imgDir, thumbDir]) {
  for (const f of fs.readdirSync(d)) if (f.endsWith('.webp') && !keep.has(f)) fs.unlinkSync(path.join(d, f));
}

/* ---- 5. page ---- */
const thumbs = els.map(e => 'data:image/webp;base64,' + fs.readFileSync(path.join(thumbDir, e.fileId + '.webp')).toString('base64'));
let page = fs.readFileSync(path.join(HERE, 'page.tpl.html'), 'utf8')
  .replace('__DATA__', JSON.stringify({W: r(maxx - minx), H: r(maxy - miny), items}))
  .replace('__THUMBS__', JSON.stringify(thumbs));
if (!flag('--fragment')) page = fs.readFileSync(path.join(HERE, 'head.html'), 'utf8') + page + '</html>\n';

const outFile = path.join(outDir, flag('--fragment') ? 'artifact.html' : 'index.html');
fs.writeFileSync(outFile, page);

const mb = n => (n / 1048576).toFixed(2) + ' MB';
const imgBytes = fs.readdirSync(imgDir).reduce((a, f) => a + fs.statSync(path.join(imgDir, f)).size, 0);
console.log(`${els.length} pieces, ${els.filter(e => e.link).length} linked, board ${Math.round(maxx - minx)} x ${Math.round(maxy - miny)}`);
console.log(`${built} rendition(s) rebuilt; img/ ${mb(imgBytes)}`);
console.log(`wrote ${path.relative(process.cwd(), outFile)} (${mb(page.length)})`);
