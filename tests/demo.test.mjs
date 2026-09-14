import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createDemo } from '../web/prototype/demo.mjs';
const feed = JSON.parse(fs.readFileSync('web/prototype/feed.json'));
const seed = JSON.parse(fs.readFileSync('data/demo/seed-incidents.json'));

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

test('public output excludes backend, unsafe artifacts and mutation calls', () => {
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
});
