import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createDemo } from '../web/prototype/demo.mjs';
const feed = JSON.parse(fs.readFileSync('web/prototype/feed.json'));
const seed = JSON.parse(fs.readFileSync('data/demo/seed-incidents.json'));
const prototype = fs.readFileSync('web/prototype/app.js', 'utf8');

test('replay starts at zero, retains fixed faults and bounded history, isolates visitors', () => {
  const a = createDemo(feed, seed), b = createDemo(feed, seed);
  assert.equal(a.snapshot().hops.latest.hop, 0);
  const initial = a.snapshot().incidents;
  for (let i = 0; i < 3600; i++) a.tick();
  const result = a.snapshot();
  assert.equal(result.hops.latest.hop, 3600);
  assert.equal(result.hops.rms.length, 60);
  assert.equal(result.hops.latest.rpp1.fault, null);
  assert.equal(result.hops.latest.assets.PP5.fault, 'inner_race');
  assert.deepEqual(result.incidents, initial);
  assert.equal(initial.length, seed.incidents.length);
  result.incidents.splice(0);
  assert.deepEqual(a.snapshot().incidents, initial);
  assert.equal(b.snapshot().hops.latest.hop, 0);
  assert.deepEqual(Object.keys(a).sort(), ['answer','snapshot','tick']);
  assert.equal(createDemo(feed, seed).snapshot().hops.latest.hop, 0);
});

test('prepared answers bind selected asset evidence and reject arbitrary text', () => {
  const demo = createDemo(feed, seed);
  const pp5 = demo.answer('What is the work order?', 'PP5');
  assert.match(pp5.answer, /WO-PP5-IR/);
  assert.ok(pp5.citations.length);
  assert.match(demo.answer('What is the cited fault?', 'PP5', 'INC-2').answer, /vac loss/);
  assert.match(demo.answer('What is the work order?', 'RPP1').answer, /No work order/);
  assert.match(demo.answer('<script>alert(1)</script>', 'PP5').answer, /suggested questions/);
  assert.equal(demo.answer('What is the work order?', '__proto__').out_of_scope, true);
  assert.equal(demo.answer('inject an outer race fault', 'PP5').out_of_scope, true);
});

test('seed asset_id __proto__ or constructor cannot pollute Object.prototype or enter the catalog', () => {
  const poisoned = structuredClone(seed);
  for (const asset_id of ['__proto__', 'constructor', 'prototype']) {
    poisoned.incidents.push({
      asset_id, part: 'x', fault: 'inner_race', priority: 'critical', status: 'new',
      detected_at: '2026-09-12T18:05:27+00:00', detections: ['2026-09-12T18:05:27+00:00'],
      source: 'x', window: '0.00..1.00', rms: 9.99, rpm: 1,
    });
  }
  const demo = createDemo(feed, poisoned);
  for (let i = 0; i < 5; i++) demo.tick();
  assert.equal(Object.hasOwn(Object.prototype, 'rms'), false);
  assert.equal(Object.hasOwn(Object.prototype, 'fault'), false);
  assert.equal(demo.snapshot().incidents.length, seed.incidents.length);
  assert.ok(!demo.snapshot().incidents.some(row => ['__proto__', 'constructor', 'prototype'].includes(row.asset)));
});

test('INC-4 is the T1 cycle-stall case and detail copy is not hard-wired to RPP1', () => {
  const inc4 = createDemo(feed, seed).snapshot().incidents.find(row => row.id === 'INC-4');
  assert.equal(inc4.asset, 'T1');
  assert.equal(inc4.fault, 'cycle_stall');
  assert.doesNotMatch(prototype, /item\.id === ["']INC-4["']/);
  assert.match(prototype, /Cited window and RMS come from the pre-populated fixture/);
});

test('seeded incident age is derived from detected_at, not a zero placeholder', () => {
  const demo = createDemo(feed, seed, () => '2026-09-12T21:05:27+00:00');
  assert.equal(demo.snapshot().incidents[0].ageMin, 180);
  assert.ok(demo.snapshot().incidents.every(row => row.ageMin > 0));
});

test('PP5 asset binding prefers the critical inner-race case over later vac_loss', () => {
  assert.match(prototype, /rank\[incident\.priority\]/);
});

test('public output excludes backend, unsafe artifacts and mutation calls', () => {
  const built = spawnSync(process.execPath, ['scripts/build-demo.mjs'], { stdio: 'inherit' });
  assert.equal(built.status, 0);
  const files = fs.readdirSync('dist', { recursive: true });
  assert.ok(!files.some(f => /(^|\/)(app|api|runtime|data|node_modules|\.git)(\/|$)|\.(db|mat|pdf|pem|key)$/.test(f)));
  for (const file of ['prototype/app.js','landing/line-view.js','landing/demo-now.js']) {
    const source = fs.readFileSync(`dist/${file}`, 'utf8');
    assert.doesNotMatch(source, /\/api\/|injectFault|postDetectOnce|127\.0\.0\.1|:8080/);
  }
  const cfg = JSON.parse(fs.readFileSync('.vercel/output/config.json'));
  assert.match(cfg.routes[0].headers['Content-Security-Policy'], /connect-src 'self'/);
  assert.match(cfg.routes[1].headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(cfg.routes.at(-1).status, 404);
  assert.ok(!fs.existsSync('.vercel/output/functions'));
  const vercel = JSON.parse(fs.readFileSync('vercel.json'));
  assert.ok(vercel.headers?.length);
  assert.match(JSON.stringify(vercel.headers), /connect-src 'self'/);
  assert.match(JSON.stringify(vercel.headers), /frame-ancestors 'none'/);
  assert.match(JSON.stringify(vercel.headers), /X-Frame-Options.{0,40}DENY/);
  const hashes = new Set();
  for (const file of ['web/landing/index.html', 'web/prototype/index.html', 'web/twin/index.html', 'web/credits.html']) {
    const html = fs.readFileSync(file, 'utf8');
    for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc\s*=/.test(attrs)) hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
    }
  }
  const csp = vercel.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  for (const hash of hashes) assert.match(csp, new RegExp(hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
