import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { analysisPrompt, questionPrompt } from "./agents.mjs";
import { validateWorkOrder, validateQuestion, validateAnswer, parseAgentJson } from "./contracts.mjs";
import { toolCallsFromHistory, retrievalPassagesFromHistory } from "./gateway-client.mjs";

export class RunManager extends EventEmitter {
  constructor({store,rag,gateway,agents}) { super(); Object.assign(this,{store,rag,gateway,agents}); this.active=new Set(); }
  publish(runId,kind,label,detail="") { const event=this.store.event(runId,kind,label,detail); this.emit(`run:${runId}`,event); return event; }
  async processFlag(flag) {
    const key=`flag:${flag.id}`; if (this.active.has(key)) return null; this.active.add(key);
    const runId=randomUUID(); this.store.createRun({id:runId,workflow:"maintenance-analysis",asset_id:flag.asset_id,state:"running"});
    this.publish(runId,"trigger","BPFI flag changed",{asset_id:flag.asset_id,part:flag.part,source:flag.source});
    try {
      const pin=this.rag.pin(flag.fault,flag.asset_id); this.publish(runId,"retrieve","Verified manual page pin",pin);
      const history=this.rag.history(flag.asset_id,flag.fault); this.publish(runId,"retrieve",`Matched ${history.length} CMMS row`,history.map((x)=>x.wo_id));
      const cfg=this.agents["maintenance-analysis"];
      const result=await this.gateway.run({sessionKey:`agent:maintenance:auto-${flag.id}`,message:analysisPrompt(flag,pin,history),idempotencyKey:`plant-floor-flag-${flag.id}`,onEvent:(e)=>this.publish(runId,e.kind,e.label,e.detail)});
      for (const tool of toolCallsFromHistory(result.history)) this.publish(runId,"tool",tool.name,tool.args);
      const raw=parseAgentJson(result.text);
      raw.citations=[{type:"signal",source:"cwru:105.mat",window:flag.window},pin,{type:"history",wo_id:"WO-1410"}];
      raw.asset_id="RPP1"; raw.evidence={...raw.evidence,source:"cwru:105.mat",window:flag.window,rpm:flag.rpm,part:"URjoint1"}; raw.severity="iso_context_only";
      const wo=validateWorkOrder(raw,{validateCitation:(c,a)=>this.rag.validateCitation(c,a)});
      const saved=this.store.saveWorkOrder(wo); this.store.markFlag(flag.id,"processed"); this.store.setRun(runId,"completed");
      this.publish(runId,"persist",saved.inserted?"Cited work order opened":"Existing open work order retained",{wo_id:saved.work_order.wo_id});
      return {runId,...saved};
    } catch (error) {
      this.store.markFlag(flag.id,"failed"); this.store.setRun(runId,"failed",error.message); this.publish(runId,"error","Run rejected",error.message); throw error;
    } finally { this.active.delete(key); }
  }
  async ask(question) {
    const q=validateQuestion(question); const board=this.store.board();
    if (!board.work_order) throw new Error("no open work order selected");
    const runId=randomUUID(), answerId=randomUUID(); this.store.createRun({id:runId,workflow:"maintenance-question",asset_id:"RPP1",state:"running"});
    this.publish(runId,"question","Scoped maintenance question",q);
    try {
      const cfg=this.agents["maintenance-question"];
      const result=await this.gateway.run({sessionKey:`agent:maintenance:q-${answerId}`,message:questionPrompt(q,board),idempotencyKey:`plant-floor-question-${answerId}`,onEvent:(e)=>this.publish(runId,e.kind,e.label,e.detail)});
      for (const tool of toolCallsFromHistory(result.history)) this.publish(runId,"tool",tool.name,tool.args);
      const raw=parseAgentJson(result.text);
      if (!raw.out_of_scope) { const passage=retrievalPassagesFromHistory(result.history)[0]; const proposed=raw.citations?.find((c)=>c?.quote); if(passage)raw.citations=[this.rag.resolvePassage(passage.source,passage.text,"RPP1")]; else if(proposed)raw.citations=[this.rag.resolvePassage(proposed.doc,proposed.quote,"RPP1")]; else throw new Error("PMMCP returned no page-resolvable evidence"); }
      const body=validateAnswer(raw,{validateCitation:(c,a)=>this.rag.validateCitation(c,a)});
      this.store.saveAnswer({id:answerId,run_id:runId,asset_id:"RPP1",question:q,body}); this.store.setRun(runId,"completed"); this.publish(runId,"persist","Cited answer attached",{answer_id:answerId});
      return {id:answerId,run_id:runId,...body};
    } catch(error) { this.store.setRun(runId,"failed",error.message); this.publish(runId,"error","Question rejected",error.message); throw error; }
  }
}
