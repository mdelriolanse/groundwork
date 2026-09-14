import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const out = 'dist';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const files = [
  ...['index.html','styles.css','groundwork-mark.svg','orbit-view.js','orbit.mjs','line-view.js','line-state.mjs','demo-now.js'].map(f => `landing/${f}`),
  ...['index.html','styles.css','overrides.css','app.js','demo.mjs','groundwork-mark.svg'].map(f => `prototype/${f}`),
  ...['index.html','viewer.js','scene.json','asset-map.json'].map(f => `twin/${f}`),
];
function copy(source, target) {
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Symlink forbidden: ${source}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
for (const file of files) copy(`web/${file}`, `${out}/${file}`);
for (const dir of ['landing/fonts','landing/images','twin/vendor','licenses']) {
  for (const file of fs.readdirSync(`web/${dir}`, { recursive: true })) {
    const source = `web/${dir}/${file}`;
    if (fs.statSync(source).isFile()) copy(source, `${out}/${dir}/${file}`);
  }
}
const scene = JSON.parse(fs.readFileSync('web/twin/scene.json'));
for (const file of new Set(scene.placements.map(p => p.file))) {
  if (!/^[\w.-]+\.glb$/.test(file)) throw new Error(`Invalid scene asset: ${file}`);
  copy(`web/twin/glb/${file}`, `${out}/twin/glb/${file}`);
}
const feed = JSON.parse(fs.readFileSync('web/prototype/feed.json'));
// Only healthy RPP1 tape is replayed; seeded faults are the complete catalog.
feed.hops = feed.hops.filter(h => h.i <= 9);
delete feed.flag;
if (feed.manifest) delete feed.manifest.flag_hop;
const seeds = JSON.parse(fs.readFileSync('data/demo/seed-incidents.json'));
function sanitize(value) {
  if (typeof value === 'string') return value.replace(/\/(?:home|media|tmp|Users)\/[^\s"<>]+/g, '[local artifact]').replace(/https?:\/\/(?:127\.0\.0\.1|localhost|10\.[\d.]+|100\.[\d.]+)(?::\d+)?[^\s]*/g, '[local service]');
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([k]) => k !== '__proto__' && k !== 'prototype' && k !== 'constructor')
      .map(([k, v]) => [k, sanitize(v)]));
  }
  return value;
}
fs.writeFileSync(`${out}/prototype/feed.json`, JSON.stringify(sanitize(feed)));
fs.writeFileSync(`${out}/prototype/incidents.json`, JSON.stringify(sanitize({ incidents: seeds.incidents })));
copy('web/credits.html', `${out}/credits.html`);
fs.writeFileSync(`${out}/404.html`, '<!doctype html><html lang="en"><title>Not found</title><h1>Not found</h1><a href="/">Return to Groundwork</a></html>');
const hashes = new Set();
for (const file of files.filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(`${out}/${file}`, 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(attrs)) hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
}
const csp = `default-src 'self'; script-src 'self' ${[...hashes].join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'`;
const headers = {
  'Content-Security-Policy': csp,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'SAMEORIGIN',
};
// Top-level documents cannot be framed; the twin must allow same-origin frames.
const topHeaders = { ...headers, 'Content-Security-Policy': csp.replace("frame-ancestors 'self'", "frame-ancestors 'none'"), 'X-Frame-Options': 'DENY' };
const routes = [
  { src: '/(.*)', headers, continue: true },
  { src: '/(?:|landing(?:/.*)?|prototype(?:/.*)?|credits.html)', headers: topHeaders, continue: true },
  { src: '/', dest: '/landing/index.html' },
  ...['landing','prototype','twin'].map(dir => ({ src: `/${dir}/?`, dest: `/${dir}/index.html` })),
  { handle: 'filesystem' },
  { src: '/.*', dest: '/404.html', status: 404 },
];
fs.mkdirSync('.vercel/output', { recursive: true });
fs.writeFileSync('.vercel/output/config.json', JSON.stringify({ version: 3, routes }, null, 2));
fs.rmSync('.vercel/output/static', { recursive: true, force: true });
fs.cpSync(out, '.vercel/output/static', { recursive: true });
console.log(`Static demo built; ${files.length} entry assets, fixed ${seeds.incidents.length} incidents, no functions.`);
