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
  assert.equal([...html.matchAll(/>Demo Now</g)].length, 3);
  for (const re of FORBIDDEN) assert.doesNotMatch(html, re);
});

test("landing chrome is mark plus Demo Now and every CTA opens the Board", () => {
  assert.match(html, /<header\b[^>]*class="[^"]*\bbar\b/);
  assert.match(html, /<header[\s\S]*?Demo Now[\s\S]*?<\/header>/);
  assert.doesNotMatch(html.match(/<header[\s\S]*?<\/header>/)[0], /Works|Contact|LinkedIn/i);
  const demos = [...html.matchAll(/<a\b[^>]*class="[^"]*\bdemo-now\b[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.equal(demos.length, 3);
  for (const tag of demos) assert.match(tag, /href="\/prototype\/"/);
  assert.match(html, /aria-label="Open the Board"/);
});

test("hero is type only and concepts are three mute isolated assets", () => {
  const hero = html.match(/<section\b[^>]*class="[^"]*\bhero\b[^"]*"[^>]*>[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(hero, /data-concept|canvas|<iframe/i);
  const mounts = [...html.matchAll(/data-concept="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(mounts, ["PP1", "RPP1", "T1"]);
  assert.match(html, /class="[^"]*\bconcepts\b[^"]*"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /Siemens|MTR07-CAD|WAREHOUSE/);
});

test("landing uses Workshop industrial tokens with a black accent and no brand green", () => {
  assert.match(css, /--surface-app:\s*#f8fafc/i);
  assert.match(css, /--primary:\s*#000000/i);
  assert.match(css, /--radius:\s*0/);
  assert.doesNotMatch(css, /#0c1713|#9ebbad|#b1c9bd|#3ecf8e|#1e40af|#ff5900/i);
  assert.match(css, /position:\s*sticky/);
});

test("root and /landing/ serve the Landing", () => {
  assert.match(server, /pathname==="\/"/);
  assert.match(server, /web\/landing/);
  assert.match(server, /\/landing\//);
  assert.match(html, /href="\/landing\/styles.css"/);
  assert.match(html, /src="\/landing\/orbit-view.js"/);
});
