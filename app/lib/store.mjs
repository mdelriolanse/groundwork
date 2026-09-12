import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export function createStore(filename = path.resolve("data/plant-floor.db")) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS historian(asset_id TEXT, tag TEXT, ts TEXT, value REAL, unit TEXT, source TEXT);
    CREATE TABLE IF NOT EXISTS flags(id INTEGER PRIMARY KEY, asset_id TEXT, part TEXT, fault TEXT, source TEXT, window TEXT, rpm REAL, rms REAL, status TEXT DEFAULT 'pending', ts TEXT);
    CREATE TABLE IF NOT EXISTS work_orders(wo_id TEXT PRIMARY KEY, asset_id TEXT, fault TEXT, status TEXT, opened TEXT, json TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_fault ON work_orders(asset_id, fault) WHERE status='open';
    CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY, workflow TEXT, asset_id TEXT, state TEXT, started TEXT, finished TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS agent_events(run_id TEXT, seq INTEGER, ts TEXT, kind TEXT, label TEXT, detail TEXT, PRIMARY KEY(run_id, seq));
    CREATE TABLE IF NOT EXISTS answers(id TEXT PRIMARY KEY, run_id TEXT, asset_id TEXT, question TEXT, json TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT);
  `);
  const now = () => new Date().toISOString();
  const getState = (key, fallback) => {
    const row = db.prepare("SELECT value FROM state WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : fallback;
  };
  const setState = (key, value) => db.prepare("INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
  return {
    db,
    close: () => db.close(),
    seed() {
      if (!db.prepare("SELECT 1 FROM historian LIMIT 1").get()) {
        const ins=db.prepare("INSERT INTO historian VALUES(?,?,?,?,?,?)");
        ins.run("RPP1","rms",now(),0.082,"g","cwru:97.mat");
        ins.run("RPP1","rpm",now(),1797,"rpm","cwru:97.mat");
        ins.run("T1","rms",now(),0.041,"g","synthetic:healthy");
        ins.run("T1","rpm",now(),1450,"rpm","synthetic:healthy");
      }
      if (!db.prepare("SELECT 1 FROM state WHERE key='containment'").get()) setState("containment",{state:"CONTAINED",last_deny:"DENY telemetry POST",inference:"inference.local"});
      if (!db.prepare("SELECT 1 FROM state WHERE key='fpr'").get()) setState("fpr",{n_false:0,n_normal:4});
    },
    recordFeature(assetId, tag, value, unit, source, ts=now()) { db.prepare("INSERT INTO historian VALUES(?,?,?,?,?,?)").run(assetId,tag,ts,value,unit,source); },
    flag(data) {
      const result=db.prepare("INSERT INTO flags(asset_id,part,fault,source,window,rpm,rms,status,ts) VALUES(?,?,?,?,?,?,?,?,?)").run(data.asset_id,data.part,data.fault,data.source,data.window,data.rpm,data.rms,"pending",data.ts||now());
      return Number(result.lastInsertRowid);
    },
    pendingFlags() { return db.prepare("SELECT * FROM flags WHERE status='pending' ORDER BY id").all(); },
    markFlag(id,status) { db.prepare("UPDATE flags SET status=? WHERE id=?").run(status,id); },
    createRun(run) { db.prepare("INSERT INTO agent_runs(id,workflow,asset_id,state,started) VALUES(?,?,?,?,?)").run(run.id,run.workflow,run.asset_id,run.state||"queued",run.started||now()); },
    setRun(id,state,error=null) { db.prepare("UPDATE agent_runs SET state=?, finished=CASE WHEN ? IN ('completed','failed','rejected') THEN ? ELSE finished END, error=? WHERE id=?").run(state,state,now(),error,id); },
    event(runId, kind, label, detail="") {
      const seq=(db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS n FROM agent_events WHERE run_id=?").get(runId).n);
      db.prepare("INSERT INTO agent_events VALUES(?,?,?,?,?,?)").run(runId,seq,now(),kind,label,typeof detail==="string"?detail:JSON.stringify(detail));
      return {run_id:runId,seq,ts:now(),kind,label,detail};
    },
    events(runId,after=0) { return db.prepare("SELECT * FROM agent_events WHERE run_id=? AND seq>? ORDER BY seq").all(runId,after); },
    saveWorkOrder(wo) {
      const existing=db.prepare("SELECT json FROM work_orders WHERE asset_id=? AND fault=? AND status='open'").get(wo.asset_id,wo.fault);
      if (existing) return {inserted:false,work_order:JSON.parse(existing.json)};
      db.prepare("INSERT INTO work_orders VALUES(?,?,?,?,?,?)").run(wo.wo_id,wo.asset_id,wo.fault,"open",wo.opened,JSON.stringify(wo));
      return {inserted:true,work_order:wo};
    },
    openWorkOrder(assetId) { const row=db.prepare("SELECT json FROM work_orders WHERE asset_id=? AND status='open' ORDER BY opened DESC LIMIT 1").get(assetId); return row?JSON.parse(row.json):null; },
    saveAnswer(answer) { db.prepare("INSERT INTO answers VALUES(?,?,?,?,?,?)").run(answer.id,answer.run_id,answer.asset_id,answer.question,JSON.stringify(answer.body),now()); },
    latestAnswer(assetId) { const row=db.prepare("SELECT json FROM answers WHERE asset_id=? ORDER BY created DESC LIMIT 1").get(assetId); return row?JSON.parse(row.json):null; },
    setContainment(value) { setState("containment",value); },
    board(selection={asset_id:"RPP1",part:"URjoint1",kind:"asset"}) {
      const assets=[
        {asset_id:"RPP1",role:"hero",part:"URjoint1",source:"cwru:105.mat"},
        {asset_id:"T1",role:"sibling",part:"T_Machine_Static",source:"synthetic:healthy"}
      ];
      const latest=db.prepare("SELECT value,unit,ts,source FROM historian WHERE asset_id=? AND tag=? ORDER BY ts DESC LIMIT 1");
      const open=db.prepare("SELECT wo_id,fault FROM work_orders WHERE asset_id=? AND status='open' ORDER BY opened DESC LIMIT 1");
      const flag=db.prepare("SELECT fault,ts FROM flags WHERE asset_id=? ORDER BY id DESC LIMIT 1");
      const fleet=assets.map((a)=>{
        const rms=latest.get(a.asset_id,"rms"), rpm=latest.get(a.asset_id,"rpm"), wo=open.get(a.asset_id), fl=flag.get(a.asset_id);
        return {...a,rms:rms?.value??null,rpm:rpm?.value??null,ts:rms?.ts??null,flag:fl?.fault??null,wo_id:wo?.wo_id??null};
      });
      const selected=selection.asset_id||"RPP1";
      const runs=db.prepare("SELECT * FROM agent_runs WHERE asset_id=? ORDER BY started DESC LIMIT 8").all(selected).map((r)=>({...r,events:this.events(r.id)}));
      return {cell:{name:"VFLab · hinge assembly",cite:"https://github.com/difactory/repository",license:"CC BY-NC 4.0"},containment:getState("containment",{}),fpr:getState("fpr",{}),honesty:{iso_floor_kw:15,claim:"context_only"},selection,fleet,work_order:this.openWorkOrder(selected),answer:this.latestAnswer(selected),runs};
    }
  };
}
