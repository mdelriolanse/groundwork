import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

function messageText(message) {
  if (!message) return "";
  if (typeof message === "string") return message;
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) return message.content.map((x)=>typeof x==="string"?x:(x?.text||"")).join("");
  return "";
}
function redact(value) {
  if (!value || typeof value !== "object") return value;
  const out=Array.isArray(value)?[]:{};
  for (const [k,v] of Object.entries(value)) out[k]=/(token|secret|password|key|credential|auth)/i.test(k)?"<redacted>":(typeof v==="object"?redact(v):v);
  return out;
}

export function gatewayCredential() {
  return execFileSync("/home/dell/.local/bin/nemoclaw",["plant-floor","gateway-token","--quiet"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();
}

export function toolCallsFromHistory(history) {
  const found=[];
  const visit=(value)=>{
    if (!value || typeof value!=="object") return;
    if (value.type==="toolCall") { const args=value.arguments||value.args||value.input||{}; const id=args.id||value.name||"tool"; found.push({name:String(id).split(":").pop().replace(/^predictive-maintenance__/,""),args:args.args||args}); }
    for (const child of Object.values(value)) if (typeof child==="object") visit(child);
  };
  visit(history); return found;
}

export function retrievalPassagesFromHistory(history) {
  const found=[];
  const visit=(value)=>{
    if (!value) return;
    if (typeof value==="string" && value.includes("structuredContent:")) {
      const start=value.indexOf("{",value.indexOf("structuredContent:"));
      const marker=value.indexOf("\n\ncontent:",start);
      const end=marker>start?marker:value.lastIndexOf("}")+1;
      if(start>=0&&end>start){try{visit(JSON.parse(value.slice(start,end)));}catch{}}
      return;
    }
    if (typeof value!=="object") return;
    if (Array.isArray(value.results)) for(const item of value.results) if(item&&typeof item.text==="string"&&typeof item.source==="string") found.push({text:item.text,source:item.source,score:item.score});
    for(const child of Object.values(value)) if(typeof child==="object"||typeof child==="string") visit(child);
  };
  visit(history); return found;
}

export class GatewayClient {
  constructor({url="ws://127.0.0.1:18789",credential,WebSocketImpl=globalThis.WebSocket}={}) {
    this.url=url; this.credential=credential; this.WebSocketImpl=WebSocketImpl;
    this.socket=null; this.pending=new Map(); this.runs=new Map(); this.early=[];
  }
  async connect() {
    if (this.socket?.readyState===1) return;
    const ws=this.socket=new this.WebSocketImpl(this.url);
    ws.onmessage=(event)=>this.#frame(String(event.data));
    await new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error("gateway open timeout")),10000); ws.onopen=()=>{clearTimeout(timer);resolve();}; ws.onerror=()=>{clearTimeout(timer);reject(new Error("gateway unavailable"));}; });
    await this.request("connect",{minProtocol:4,maxProtocol:4,client:{id:"gateway-client",displayName:"Plant floor board",version:"1",platform:process.platform,mode:"backend",instanceId:randomUUID()},caps:["tool-events","session-scoped-events"],scopes:["operator.read","operator.write"],auth:{token:this.credential}});
  }
  request(method,params={}) {
    if (!this.socket || this.socket.readyState!==1) return Promise.reject(new Error("gateway not connected"));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{ const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} timeout`));},15000); this.pending.set(id,{resolve,reject,timer}); this.socket.send(JSON.stringify({type:"req",id,method,params})); });
  }
  async run({sessionKey,message,idempotencyKey=randomUUID(),onEvent=()=>{},timeoutMs=180000}) {
    await this.connect();
    const sent=await this.request("chat.send",{sessionKey,message,deliver:false,timeoutMs,idempotencyKey});
    const runId=sent.runId;
    if (!runId) throw new Error("gateway returned no runId");
    const result = await new Promise((resolve,reject)=>{
      const state={runId,sessionKey,text:"",onEvent,resolve,reject,timer:setTimeout(()=>{this.runs.delete(runId);reject(new Error("agent run timeout"));},timeoutMs)};
      this.runs.set(runId,state); onEvent({kind:"agent",label:"Agent accepted run",detail:{runId}});
      for (const frame of this.early.splice(0)) this.#event(frame);
    });
    try { result.history=await this.request("chat.history",{sessionKey,limit:20}); } catch {}
    return result;
  }
  #frame(raw) {
    let frame; try { frame=JSON.parse(raw); } catch { return; }
    if (frame.type==="res" && this.pending.has(frame.id)) { const p=this.pending.get(frame.id); this.pending.delete(frame.id); clearTimeout(p.timer); frame.ok===false?p.reject(new Error(frame.error?.message||"gateway request failed")):p.resolve(frame.payload??frame.result??frame); return; }
    if (frame.type==="event") this.#event(frame);
  }
  #event(frame) {
    const payload=frame.payload||{};
    const runId=payload.runId||payload.run_id;
    const state=runId&&this.runs.get(runId);
    if (!state) { if (runId && this.early.length<100) this.early.push(frame); return; }
    if (frame.event==="chat") {
      if (payload.state==="delta") state.text=payload.replace?String(payload.deltaText||""):state.text+String(payload.deltaText||"");
      const snapshot=messageText(payload.message); if (snapshot) state.text=snapshot;
      if (payload.state==="final") { clearTimeout(state.timer); this.runs.delete(runId); state.onEvent({kind:"agent",label:"Agent completed",detail:{runId}}); state.resolve({runId,text:state.text}); }
      else if (payload.state==="error"||payload.state==="aborted") { clearTimeout(state.timer); this.runs.delete(runId); state.reject(new Error(payload.errorMessage||"agent failed")); }
      return;
    }
    const kind=String(frame.event||payload.type||"event");
    const tool=payload.toolName||payload.tool_name||payload.name||payload.tool?.name;
    if (/tool/i.test(kind)||tool) state.onEvent({kind:"tool",label:tool||kind,detail:redact({state:payload.state||payload.status||"event",summary:payload.summary||payload.message||""})});
  }
  close() { this.socket?.close(); this.socket=null; }
}
