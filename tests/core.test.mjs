import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../app/lib/store.mjs";
import { createRag } from "../app/lib/rag.mjs";
import { validateWorkOrder, validateQuestion } from "../app/lib/contracts.mjs";
import { toolCallsFromHistory, retrievalPassagesFromHistory } from "../app/lib/gateway-client.mjs";

const root=path.resolve(new URL("..",import.meta.url).pathname);
const sample={wo_id:"WO-RPP1-TEST",asset_id:"RPP1",opened:new Date().toISOString(),fault:"inner_race",severity:"iso_context_only",evidence:{source:"cwru:105.mat",window:"0..2s",rpm:1797,features:["BPFI at 161.7 Hz"],part:"URjoint1"},citations:[{type:"signal",source:"cwru:105.mat"},{type:"manual",doc:"skf-bearing-damage-analysis.pdf",page:214},{type:"history",wo_id:"WO-1410"}],action:"replace bearing",parts:["6205-2RS"],priority:"high"};

test("citation-gated work order accepts only local RPP1 evidence",()=>{const rag=createRag(root);assert.equal(validateWorkOrder(sample,{validateCitation:(c,a)=>rag.validateCitation(c,a)}).asset_id,"RPP1");assert.throws(()=>validateWorkOrder({...sample,asset_id:"OTHER"}),/unsupported asset/);assert.throws(()=>rag.validateCitation({type:"manual",doc:"skf-bearing-damage-analysis.pdf",page:9999},"RPP1"),/page missing/);});
test("store keeps one open work order per asset and fault",()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),"plant-floor-"));const store=createStore(path.join(dir,"test.db"));store.seed();assert.equal(store.saveWorkOrder(sample).inserted,true);assert.equal(store.saveWorkOrder({...sample,wo_id:"WO-RPP1-OTHER"}).inserted,false);assert.equal(store.board().work_order.wo_id,sample.wo_id);store.close();fs.rmSync(dir,{recursive:true,force:true});});
test("retrieval resolves pin, history alias, and exact page quote",()=>{const rag=createRag(root);assert.equal(rag.pin("inner_race").page,214);assert.equal(rag.history("RPP1","inner_race")[0].wo_id,"WO-1410");const pages=JSON.parse(fs.readFileSync(path.join(root,"runtime/corpus/manuals/skf-bearing-damage-analysis.pages.json"),"utf8")).pages;const text="Inspect the bearing raceways, cage(s) schedule";assert.equal(rag.resolvePassage("skf-bearing-damage-analysis.pdf",text).page,214);});
test("gateway history exposes actual nested MCP calls without credentials",()=>{const calls=toolCallsFromHistory({messages:[{content:[{type:"toolCall",name:"tool_call",arguments:{id:"mcp:bundle:predictive-maintenance__diagnose_vibration",args:{signal_id:"x"}}}]}]});assert.deepEqual(calls,[{name:"diagnose_vibration",args:{signal_id:"x"}}]);assert.equal(JSON.stringify(calls).includes("token"),false);});
test("question scope validates bounded input",()=>{assert.equal(validateQuestion("What should I inspect?"),"What should I inspect?");assert.throws(()=>validateQuestion("x"),/3-500/);assert.throws(()=>validateQuestion("x".repeat(501)),/3-500/);});

test("PMMCP structured result yields a page-resolvable passage",()=>{const payload={result:{content:[{type:"text",text:'structuredContent:\n{"results":[{"source":"skf-bearing-damage-analysis-p214.txt","text":"Inspect the bearing raceways, cage(s) schedule"}]}\n\ncontent:\n...'}]}};const result=retrievalPassagesFromHistory(payload)[0];assert.equal(result.source,"skf-bearing-damage-analysis-p214.txt");assert.equal(createRag(root).resolvePassage(result.source,result.text).page,214);});
