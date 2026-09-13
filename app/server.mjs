import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./lib/store.mjs";
import { createRag } from "./lib/rag.mjs";
import { GatewayClient, gatewayCredential } from "./lib/gateway-client.mjs";
import { loadAgents } from "./lib/agents.mjs";
import { RunManager } from "./lib/runs.mjs";
import { askAssist } from "./lib/assist.mjs";
import { containmentEvidence, attemptExfil } from "./lib/openshell.mjs";
import { boardCorsHeaders } from "./lib/board-cors.mjs";

const ALLOWED_CORS = new Set(["/api/board", "/api/detect", "/api/incidents", "/api/hops/latest", "/api/demo/inject", "/api/questions"]);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const PORT=Number(process.env.PORT||8765), HOST=process.env.HOST||"0.0.0.0";
const store=createStore(path.join(ROOT,"data/plant-floor.db")); store.seed();
const rag=createRag(ROOT), agents=loadAgents(ROOT);
let gateway;
try { gateway=new GatewayClient({credential:gatewayCredential()}); } catch(error) { console.error("gateway credential unavailable:",error.message); }
const runs=gateway?new RunManager({store,rag,gateway,agents}):null;
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".glb":"model/gltf-binary",".woff2":"font/woff2",".png":"image/png",".svg":"image/svg+xml"};
const json=(res,status,body,headers={})=>{res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers});res.end(JSON.stringify(body));};
const safeBase=(value)=>path.basename(decodeURIComponent(value||""));
async function body(req,max=8192){let text="";for await(const chunk of req){text+=chunk;if(text.length>max)throw new Error("request too large");}return text?JSON.parse(text):{};}
function staticFile(res,file){if(!fs.existsSync(file)||!fs.statSync(file).isFile())return false;res.writeHead(200,{"content-type":MIME[path.extname(file)]||"application/octet-stream","cache-control":path.extname(file)===".glb"?"public, max-age=3600":"no-cache",...(path.extname(file)===".json"?{"access-control-allow-origin":"*"}:{})});fs.createReadStream(file).pipe(res);return true;}
// Containment evidence comes from the OpenShell gateway, never from a seed.
let containmentRefresh=null;
function refreshContainment(){
  if(containmentRefresh)return containmentRefresh;
  containmentRefresh=containmentEvidence().then((evidence)=>{const merged={...evidence,last_attempt:store.containment().last_attempt??null};store.setContainment(merged);return merged;})
    .catch((error)=>{const evidence={...store.containment(),errors:[error.message],fetched_at:new Date().toISOString()};store.setContainment(evidence);return evidence;})
    .finally(()=>{containmentRefresh=null;});
  return containmentRefresh;
}
async function denyAttempt(){
  const attempt=await attemptExfil();
  let evidence,audit=null;
  for(let i=0;i<5&&!audit;i++){ // gateway log relay lags a few hundred ms
    await new Promise((r)=>setTimeout(r,600));
    evidence=await refreshContainment();
    audit=evidence.denies.find((d)=>d.ts&&d.ts>=attempt.started)||null;
  }
  // "denied" is only true when the gateway's own audit line proves it, not on curl's exit code alone.
  return {...attempt,curl_failed:attempt.denied,denied:attempt.denied&&Boolean(audit),audit,evidence};
}
const CONTAINMENT_REFRESH_MS=Number(process.env.CONTAINMENT_REFRESH_MS||30000);
refreshContainment(); setInterval(refreshContainment,CONTAINMENT_REFRESH_MS).unref();

const INJECT_CATALOG = {
  clear: { file: "97.mat", channel: "X097_DE_time", fs_hz: 48000, rpm: 1797, expected_fault: null },
  ir: { file: "105.mat", channel: "X105_DE_time", fs_hz: 12000, rpm: 1797, expected_fault: "inner_race" },
  or: { file: "130.mat", channel: "X130_DE_time", fs_hz: 12000, rpm: 1797, expected_fault: "outer_race" },
  ball: { file: "118.mat", channel: "X118_DE_time", fs_hz: 12000, rpm: 1797, expected_fault: "ball" },
};
const INJECT_ALIASES = { "97": "clear", "105": "ir", "118": "ball", "130": "or", "cwru:97.mat": "clear", "cwru:105.mat": "ir", "cwru:118.mat": "ball", "cwru:130.mat": "or" };

function resolveInject(source) {
  const raw = String(source || "ir").trim().toLowerCase();
  const key = INJECT_ALIASES[raw] || (raw.endsWith(".mat") ? INJECT_ALIASES[`cwru:${raw}`] : raw) || raw;
  const entry = INJECT_CATALOG[key];
  if (!entry) throw new Error(`unknown inject source ${source}; allow ir|or|ball|clear`);
  return { key, ...entry };
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
  try {
    if(req.method==="OPTIONS"&&ALLOWED_CORS.has(url.pathname)) {
      const cors=boardCorsHeaders({method:req.method,pathname:url.pathname,host:req.headers.host,origin:req.headers.origin});
      if(!cors["Access-Control-Allow-Origin"])return json(res,403,{error:"cors denied"});
      res.writeHead(204,cors);return res.end();
    }
    if(req.method==="GET"&&url.pathname==="/api/health") return json(res,200,{ok:true,gateway:Boolean(gateway),agent:"maintenance",model:"Qwen3.6-35B-A3B",inference:"http://127.0.0.1:8000",hop_override:store.hopOverride(),latest_hop:Boolean(store.latestHop())});
    if(req.method==="GET"&&url.pathname==="/api/board") {const asset=url.searchParams.get("asset")||"RPP1";const part=asset==="RPP1"?"URjoint1":asset==="MTR07-CAD"?"1LE1003-1EB23-4JA4":asset==="T1"?"T_Machine_Static":null;const cors=boardCorsHeaders({method:req.method,pathname:url.pathname,host:req.headers.host,origin:req.headers.origin});return json(res,200,store.board({asset_id:asset,part,kind:"asset"}),cors);}
    if(req.method==="GET"&&url.pathname==="/api/incidents") {
      const cors=boardCorsHeaders({method:req.method,pathname:url.pathname,host:req.headers.host,origin:req.headers.origin});
      return json(res,200,{incidents:store.listIncidents({status:url.searchParams.get("status")||undefined})},cors);
    }
    if(req.method==="GET"&&url.pathname==="/api/hops/latest") {
      const cors=boardCorsHeaders({method:req.method,pathname:url.pathname,host:req.headers.host,origin:req.headers.origin});
      const limit=Math.min(60, Math.max(1, Number(url.searchParams.get("limit")||20)));
      return json(res,200,store.hopsLatest(limit),cors);
    }
    if(req.method==="POST"&&url.pathname==="/api/demo/inject") {
      const cors=boardCorsHeaders({method:req.method,pathname:url.pathname,host:req.headers.host,origin:req.headers.origin});
      const input=await body(req);
      const hops=Math.min(300, Math.max(1, Number(input.hops||30)));
      const resolved=resolveInject(input.source||input.key||"ir");
      if(resolved.key==="clear"){
        store.setHopOverride(null);
        return json(res,200,{cleared:true,hop_override:null},cors);
      }
      const override={
        file:resolved.file,
        channel:resolved.channel,
        fs_hz:resolved.fs_hz,
        rpm:resolved.rpm,
        expected_fault:resolved.expected_fault,
        hops_remaining:hops,
        injected_at:new Date().toISOString(),
        source:`cwru:${resolved.file}`,
      };
      store.setHopOverride(override);
      return json(res,200,{ok:true,hop_override:override},cors);
    }
    if(req.method==="POST"&&url.pathname==="/api/detect") {
      const cors=boardCorsHeaders({method:req.method,pathname:url.pathname,host:req.headers.host,origin:req.headers.origin});
      const input=await body(req);
      const result=store.detect(input);
      return json(res,result.inserted?201:200,result,cors);
    }
    if(req.method==="GET"&&url.pathname==="/api/events") {
      const runId=url.searchParams.get("run"),after=Number(url.searchParams.get("after")||0);if(!runId)return json(res,400,{error:"run required"});
      res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-store","connection":"keep-alive"});
      for(const e of store.events(runId,after))res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
      const send=(e)=>res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);runs?.on(`run:${runId}`,send);const ping=setInterval(()=>res.write(": ping\n\n"),15000);req.on("close",()=>{clearInterval(ping);runs?.off(`run:${runId}`,send);});return;
    }
    if(req.method==="POST"&&url.pathname==="/api/questions") {
      const cors=boardCorsHeaders({method:req.method,pathname:url.pathname,host:req.headers.host,origin:req.headers.origin});
      const input=await body(req);
      try {
        const result=await askAssist({store,question:input.question,asset_id:input.asset_id});
        return json(res,200,result,cors);
      } catch(error) {
        const status=/unsupported|required|3-500|characters/.test(error.message)?400:/timeout|unavailable|inference/.test(error.message)?503:422;
        return json(res,status,{error:error.message},cors);
      }
    }
    if(req.method==="GET"&&url.pathname==="/api/containment") {const fresh=url.searchParams.get("refresh")==="1";return json(res,200,fresh?await refreshContainment():store.containment());}
    if(req.method==="POST"&&url.pathname==="/api/containment/attempt") {
      const result=await denyAttempt();
      if(!result.denied)store.setContainment({...result.evidence,state:result.curl_failed?"UNPROVEN":"UNSAFE",last_attempt:result});
      else store.setContainment({...result.evidence,last_attempt:{started:result.started,url:result.url,exit:result.exit,audit:result.audit}});
      return json(res,result.denied?200:500,result);
    }
    if(req.method==="GET"&&url.pathname.startsWith("/api/artifacts/manual/")) {const file=safeBase(url.pathname.split("/").pop());const cite={type:"manual",doc:file,page:Number(url.searchParams.get("page"))};rag.validateCitation(cite,"RPP1");res.writeHead(200,{"content-type":"application/pdf","content-disposition":`inline; filename="${file}"`});return fs.createReadStream(rag.artifact(cite)).pipe(res);}
    if(req.method==="GET"&&url.pathname.startsWith("/api/artifacts/history/")) {const id=safeBase(url.pathname.split("/").pop());const row=rag.history("RPP1").find(x=>x.wo_id===id);if(!row)return json(res,404,{error:"history row missing"});return json(res,200,row);}
    if(req.method==="GET"&&url.pathname.startsWith("/api/artifacts/signal/")) {const segs=url.pathname.slice("/api/artifacts/signal/".length).split("/");const prefix=safeBase(segs[0]);const file=safeBase(segs[1]||"");const cite={type:"signal",source:`${prefix}:${file}`};rag.validateCitation(cite,"RPP1");res.writeHead(200,{"content-type":"application/octet-stream","content-disposition":`attachment; filename="${file}"`});return fs.createReadStream(rag.artifact(cite)).pipe(res);}
    let file;
    if(url.pathname==="/"||url.pathname==="/landing"||url.pathname==="/landing/")file=path.join(ROOT,"web/landing/index.html");
    else if(url.pathname.startsWith("/landing/"))file=path.join(ROOT,"web/landing",url.pathname.slice(9));
    else if(url.pathname.startsWith("/board/"))file=path.join(ROOT,"web/board",url.pathname.slice(7));
    else if(url.pathname==="/twin/")file=path.join(ROOT,"web/twin/index.html");
    else if(url.pathname.startsWith("/twin/"))file=path.join(ROOT,"web/twin",url.pathname.slice(6));
    else if(url.pathname==="/prototype"||url.pathname==="/prototype/")file=path.join(ROOT,"web/prototype/index.html");
    else if(url.pathname.startsWith("/prototype/"))file=path.join(ROOT,"web/prototype",url.pathname.slice(11));
    if(file&&path.resolve(file).startsWith(ROOT)&&staticFile(res,file))return;
    json(res,404,{error:"not found"});
  } catch(error){console.error(req.method,url.pathname,error.message);json(res,error.message.includes("required")||error.message.includes("characters")?400:422,{error:error.message});}
});

let watching=false;
setInterval(async()=>{if(watching||!runs)return;watching=true;try{for(const flag of store.pendingFlags())await runs.processFlag(flag);}catch(error){console.error("automatic run failed:",error.message);}finally{watching=false;}},1000).unref();
server.listen(PORT,HOST,()=>console.log(`plant-floor board http://${HOST}:${PORT}`));
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>server.close(()=>{gateway?.close();store.close();process.exit(0);}));
