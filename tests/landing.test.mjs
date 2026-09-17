import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("web/landing/index.html", "utf8");
const css = fs.readFileSync("web/landing/styles.css", "utf8");
const server = fs.readFileSync("app/server.mjs", "utf8");

const REQUIRED = [
  "Catches equipment failures before they happen. Proves it never left the plant.",
  "Sensors detect the anomaly. Then someone still has to figure it out.",
  "Always on. Two layers. One cited work order.",
  "We didn't rebuild diagnosis. We built the proof around it.",
];

const FORBIDDEN = [
  /Mateo/,
  /Jimmy/,
  /hackathon/i,
  /Cornell/,
  /NJIT/,
  /groundwork-pitch/,
  /TAM/,
  /ticket/i,
  /Contact me/,
  /Works/,
];

test("landing copy contract is present and pitch furniture is absent", () => {
  for (const line of REQUIRED) assert.match(html, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, />Demo Now</g);
  assert.equal([...html.matchAll(/>Demo Now</g)].length, 2);
  for (const re of FORBIDDEN) assert.doesNotMatch(html, re);
});

test("top disclosure keeps demo and sources only", () => {
  const board = fs.readFileSync("web/prototype/app.js", "utf8");
  const landingBar = html.match(/class="landing-disclosure"[^>]*>([\s\S]*?)<\/div>/)[1];
  const boardBar = board.match(/class="demo-disclosure"[^>]*>([\s\S]*?)<\/div>/)[1];
  for (const bar of [landingBar, boardBar]) {
    assert.match(bar, /interactive demo/i);
    assert.match(bar, /credits\.html">Sources/);
    assert.doesNotMatch(bar, /simulated telemetry/);
    assert.doesNotMatch(bar, /prepared answers/);
  }
});

test("landing has no top bar and every Demo Now opens the Board", () => {
  assert.doesNotMatch(html, /<header\b[^>]*class="[^"]*\bbar\b/);
  const demos = [...html.matchAll(/<a\b[^>]*class="[^"]*\bdemo-now\b[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.equal(demos.length, 2);
  for (const tag of demos) assert.match(tag, /href="\/prototype\/#\/floor"/);
  assert.match(html, /aria-label="Open the Board"/);
  assert.match(html, /src="\/landing\/demo-now.js"/);
  const demo = fs.readFileSync("web/landing/demo-now.js", "utf8");
  assert.doesNotMatch(demo, /\/api\//);
  assert.match(server, /pathname==="\/api\/demo\/seed"/);
  assert.match(server, /server\.listen\([\s\S]*startSeedReplay\(\)/);
  assert.match(server, /mockHop\(/);
  const proto = fs.readFileSync("web/prototype/app.js", "utf8");
  assert.doesNotMatch(proto, /\/api\//);
});

test("hero is type only and concepts are three mute isolated assets", () => {
  const hero = html.match(/<section\b[^>]*class="[^"]*\bhero\b[^"]*"[^>]*>[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(hero, /data-concept|canvas|<iframe/i);
  const mounts = [...html.matchAll(/data-concept="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(mounts, ["PP1", "RPP1", "T1"]);
  for (const mount of html.matchAll(/<div[^>]*data-concept="[^"]+"[^>]*>/g)) assert.match(mount[0], /aria-hidden="true"/);
  assert.doesNotMatch(html, /Siemens|MTR07-CAD|WAREHOUSE/);
});

test("landing uses Workshop industrial tokens with a black accent and no brand green", () => {
  assert.match(css, /--surface-app:\s*#f8fafc/i);
  assert.match(css, /--primary:\s*#000000/i);
  assert.match(css, /--radius:\s*0/);
  assert.doesNotMatch(css, /#0c1713|#9ebbad|#b1c9bd|#3ecf8e|#1e40af|#ff5900/i);
});

test("hero is a Gorskikh-scale italic serif manifesto without a 3D object", () => {
  assert.match(css, /--font-serif:\s*"Instrument Serif"/);
  assert.match(css, /\.hero h1[\s\S]*font-style:\s*italic/);
  assert.match(css, /\.hero[\s\S]*min-height:\s*100dvh/);
  assert.match(html, /<section class="hero"/);
  assert.doesNotMatch(html.match(/<section class="hero"[\s\S]*?<\/section>/)[0], /data-concept|canvas|<iframe/i);
});

test("Landing publishes the mark as the site thumbnail", () => {
  const og = fs.readFileSync("web/landing/og.png");
  const icon = fs.readFileSync("web/landing/apple-touch-icon.png");
  assert.equal(og[0], 0x89);
  assert.equal(icon[0], 0x89);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /get-groundwork\.vercel\.app\/landing\/og\.png/);
  assert.match(fs.readFileSync("scripts/build-demo.mjs", "utf8"), /og\.png/);
  const ogSvg = fs.readFileSync("web/landing/og.svg", "utf8");
  assert.match(ogSvg, /font-family="Geist"/);
  assert.doesNotMatch(ogSvg, /system-ui|ui-sans-serif/);
});

test("Board nav uses the Landing mark file", () => {
  const mark = fs.readFileSync("web/landing/groundwork-mark.svg", "utf8");
  const board = fs.readFileSync("web/prototype/groundwork-mark.svg", "utf8");
  const app = fs.readFileSync("web/prototype/app.js", "utf8");
  assert.equal(board, mark);
  assert.match(app, /class="mark"/);
  assert.match(app, /src="\/landing\/groundwork-mark.svg"/);
  assert.doesNotMatch(mark, /#3ecf8e|#0f2318|#eafff3/);
});

test("root and /landing/ serve the Landing", () => {
  assert.match(server, /pathname==="\/"/);
  assert.match(server, /web\/landing/);
  assert.match(server, /\/landing\//);
  assert.match(html, /href="\/landing\/styles.css\?v=/);
  assert.match(html, /src="\/landing\/orbit-view.js"/);
});


test("product previews and fonts ship locally with honest report labels", () => {
  assert.match(html, /L1 REPORT/);
  assert.match(html, /L2 REPORT/);
  assert.match(html, /Recorded flag/);
  assert.match(html, /Report structure preview/);
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/);
  const fonts = fs.readFileSync("web/landing/fonts/fonts.css", "utf8");
  assert.match(html, /rel="preload"[^>]*instrument-serif-400\.ttf[^>]*as="font"/);
  assert.match(html, /rel="preload"[^>]*geist-400\.ttf[^>]*as="font"/);
  assert.match(html, /rel="preload"[^>]*geist-mono-400\.ttf[^>]*as="font"/);
  assert.match(fonts, /font-display:\s*block/);
  assert.doesNotMatch(fonts, /font-display:\s*swap/);
  const assets = [...html.matchAll(/(?:src|href)="(\/landing\/(?:images|fonts)\/[^"]+)"/g), ...fonts.matchAll(/url\((\/landing\/fonts\/[^)]+)\)/g)];
  assert.ok(assets.length >= 6);
  for (const [, asset] of assets) assert.ok(fs.statSync(`web${asset.replace(/\?.*$/, "")}`).size > 0, asset);
});


test("scroll diagnostic stays bound to the recorded RPP1 flag", () => {
  const flag = JSON.parse(fs.readFileSync("web/prototype/feed.json", "utf8")).flag;
  for (const value of [flag.asset_id, flag.part, flag.source, flag.window, String(flag.rms_g)]) assert.ok(html.includes(value), value);
  assert.equal([...html.matchAll(/class="[^"]*scroll-diagnostic/g)].length, 1);
});


test("hero names Groundwork and rises a gray-white bloom on the compositor", () => {
  assert.match(html, /class="hero-brand"[^>]*>[\s\S]*groundwork-mark\.svg[\s\S]*?Groundwork<\/p>/);
  assert.doesNotMatch(html, /brand-squares/);
  assert.match(css, /\.hero h1[\s\S]*max-width:\s*32ch/);
  assert.doesNotMatch(html, /hero-blocks|title-reveal|scroll-reveal/);
  assert.doesNotMatch(css, /title-reveal|hero-blocks|--cover|--block-pulse|#004067|#F7F4EC/);
  assert.match(css, /background-color:\s*#F7F8FA/);
  assert.match(css, /@keyframes hero-rise[\s\S]*translate3d\(0,\s*26vh,\s*0\)/);
  const rise = css.match(/@keyframes hero-rise[\s\S]+?(?=\.hero h1)/)[0];
  assert.doesNotMatch(rise, /\b(?:rotate|scale|filter|background-position)\s*[:(]/);
  assert.match(html, /class="hero-more"[^>]*href="#content"/);
  assert.match(css, /html\s*\{\s*scroll-behavior:\s*smooth/);
});
