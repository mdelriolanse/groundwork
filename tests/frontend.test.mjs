import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("board contains five surfaces and scoped question control",()=>{const html=fs.readFileSync("web/board/index.html","utf8");for(const id of ["mast","dossier","c","roster","deny-line"])assert.match(html,new RegExp(id));assert.match(html,/Ask local agent/);assert.doesNotMatch(html,/chat bubble|general-purpose/i);});
test("Acaysia motif remains ink cream square and full bleed",()=>{const css=fs.readFileSync("web/board/styles.css","utf8");assert.match(css,/--ink:#0c0c0c/);assert.match(css,/--cream:#f0ede6/);assert.match(css,/border-radius:0/);assert.match(css,/\.twin-field/);});
test("Twin exports focus, part lighting, and frozen controls",()=>{const js=fs.readFileSync("web/twin/viewer.js","utf8");assert.match(js,/focusAsset/);assert.match(js,/lightPart/);assert.match(js,/setFrozen/);assert.match(js,/0xe6dcc8/);});
