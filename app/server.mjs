import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStore } from "./lib/store.mjs";
import { createRag } from "./lib/rag.mjs";
import { GatewayClient, gatewayCredential } from "./lib/gateway-client.mjs";
import { loadAgents } from "./lib/agents.mjs";
import { RunManager } from "./lib/runs.mjs";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const PORT=Number(process.env.PORT||8765), HOST=process.env.HOST||"0.0.0.0";
const store=createStore(path.join(ROOT,"data/plant-floor.db")); store.seed();
const rag=createRag(ROOT), agents=loadAgents(ROOT);
let gateway;
try { gateway=new GatewayClient({credential:gatewayCredential()}); } catch(error) { console.error("gateway credential unavailable:",error.message); }
const runs=gateway?new RunManager({store,rag,gateway,agents}):null;
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".glb":"model/gltf-binary",".woff2":"font/woff2",".png":"image/png",".svg":"image/svg+xml"};
const json=(res,status,body)=>{res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(body));};
const safeBase=(value)=>path.basename(decodeURIComponent(value||""));
async function body(req,max=8192){let text="";for await(const chunk of req){text+=chunk;if(text.length>max)throw new Error("request too large");}return text?JSON.parse(text):{};}
function staticFile(res,file){if(!fs.existsSync(file)||!fs.statSync(file).isFile())return false;res.writeHead(200,{"content-type":MIME[path.extname(file)]||"application/octet-stream","cache-control":path.extname(file)===".glb"?"public, max-age=3600":"no-cache"});fs.createReadStream(file).pipe(res);return true;}
async function denyAttempt(){return await new Promise((resolve)=>{const child=spawn("/home/dell/.local/bin/openshell",["sandbox","exec","-n","plant-floor","--","/usr/bin/curl","-fsS","-X","POST","--max-time","5","https://example.com/telemetry"],{stdio:["ignore","ignore","pipe"]});let err="";child.stderr.on("data",d=>err+=d);child.on("close",code=>resolve({denied:code!==0,detail:(err.trim().split("\n").pop()||`exit ${code}`).slice(0,240)}));});}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
  try {
    if(req.method==="GET"&&url.pathname==="/api/health") return json(res,200,{ok:true,gateway:Boolean(gateway),agent:"maintenance",model:"gpt-oss-20b",inference:"inference.local"});
    if(req.method==="GET"&&url.pathname==="/api/board") {const asset=url.searchParams.get("asset")||"RPP1";return json(res,200,store.board({asset_id:asset,part:asset==="RPP1"?"URjoint1":"T_Machine_Static",kind:"asset"}));}
    if(req.method==="GET"&&url.pathname==="/api/events") {
      const runId=url.searchParams.get("run"),after=Number(url.searchParams.get("after")||0);if(!runId)return json(res,400,{error:"run required"});
      res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-store","connection":"keep-alive"});
      for(const e of store.events(runId,after))res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
      const send=(e)=>res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);runs?.on(`run:${runId}`,send);const ping=setInterval(()=>res.write(": ping\n\n"),15000);req.on("close",()=>{clearInterval(ping);runs?.off(`run:${runId}`,send);});return;
    }
    if(req.method==="POST"&&url.pathname==="/api/questions") {if(!runs)return json(res,503,{error:"agent unavailable"});const input=await body(req);const result=await runs.ask(input.question);return json(res,200,result);}
    if(req.method==="POST"&&url.pathname==="/api/containment/attempt") {const result=await denyAttempt();store.setContainment({state:result.denied?"CONTAINED":"UNSAFE",last_deny:result.detail,inference:"inference.local"});return json(res,result.denied?200:500,result);}
    if(req.method==="GET"&&url.pathname.startsWith("/api/artifacts/manual/")) {const file=safeBase(url.pathname.split("/").pop());const cite={type:"manual",doc:file,page:Number(url.searchParams.get("page"))};rag.validateCitation(cite,"RPP1");res.writeHead(200,{"content-type":"application/pdf","content-disposition":`inline; filename="${file}"`});return fs.createReadStream(rag.artifact(cite)).pipe(res);}
    if(req.method==="GET"&&url.pathname.startsWith("/api/artifacts/history/")) {const id=safeBase(url.pathname.split("/").pop());const row=rag.history("RPP1").find(x=>x.wo_id===id);if(!row)return json(res,404,{error:"history row missing"});return json(res,200,row);}
    if(req.method==="GET"&&url.pathname.startsWith("/api/artifacts/signal/")) {const file=safeBase(url.pathname.split("/").pop());const cite={type:"signal",source:`cwru:${file}`};rag.validateCitation(cite,"RPP1");res.writeHead(200,{"content-type":"application/octet-stream","content-disposition":`attachment; filename="${file}"`});return fs.createReadStream(rag.artifact(cite)).pipe(res);}
    let file;
    if(url.pathname==="/")file=path.join(ROOT,"web/board/index.html");
    else if(url.pathname.startsWith("/board/"))file=path.join(ROOT,"web/board",url.pathname.slice(7));
    else if(url.pathname.startsWith("/twin/"))file=path.join(ROOT,"web/twin",url.pathname.slice(6));
    if(file&&path.resolve(file).startsWith(ROOT)&&staticFile(res,file))return;
    json(res,404,{error:"not found"});
  } catch(error){console.error(req.method,url.pathname,error.message);json(res,error.message.includes("required")||error.message.includes("characters")?400:422,{error:error.message});}
});

let watching=false;
setInterval(async()=>{if(watching||!runs)return;watching=true;try{for(const flag of store.pendingFlags())await runs.processFlag(flag);}catch(error){console.error("automatic run failed:",error.message);}finally{watching=false;}},1000).unref();
server.listen(PORT,HOST,()=>console.log(`plant-floor board http://${HOST}:${PORT}`));
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>server.close(()=>{gateway?.close();store.close();process.exit(0);}));
