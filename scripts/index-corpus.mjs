import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root=path.resolve(new URL("..",import.meta.url).pathname);
const pdf=path.join(root,"runtime/corpus/manuals/skf-bearing-damage-analysis.pdf");
const out=path.join(root,"runtime/corpus/manuals/skf-bearing-damage-analysis.pages.json");
const info=spawnSync("pdfinfo",[pdf],{encoding:"utf8"});
if (info.status!==0) throw new Error(info.stderr||"pdfinfo failed");
const count=Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
if (!count) throw new Error("could not read PDF page count");
const pages=[];
for (let page=1;page<=count;page++) { const r=spawnSync("pdftotext",["-f",String(page),"-l",String(page),"-layout",pdf,"-"],{encoding:"utf8",maxBuffer:4*1024*1024}); if(r.status!==0) throw new Error(r.stderr||`page ${page} failed`); pages.push({page,text:r.stdout.replace(/\f/g,"").trim()}); }
fs.writeFileSync(out,JSON.stringify({file:path.basename(pdf),pages},null,2)+"\n");
const pinned=pages.find((entry)=>entry.page===214);
if (!pinned?.text) throw new Error("verified page 214 has no text");
fs.writeFileSync(path.join(path.dirname(pdf),"skf-bearing-damage-analysis-p214.txt"),`Source: ${path.basename(pdf)}\nPage: 214\n\n${pinned.text}\n`);
console.log(`indexed ${pages.length} pages; extracted page 214`);
