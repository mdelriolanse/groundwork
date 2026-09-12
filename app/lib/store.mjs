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
    CREATE TABLE IF NOT EXISTS incidents(
      incident_id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      fault TEXT NOT NULL,
      status TEXT NOT NULL,
      previous_incident_id INTEGER REFERENCES incidents(incident_id),
      part TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_incident ON incidents(asset_id, fault) WHERE status != 'resolved';
    CREATE TABLE IF NOT EXISTS incident_detections(
      detection_id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL REFERENCES incidents(incident_id),
      detected_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS incident_status_history(
      transition_id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL REFERENCES incidents(incident_id),
      status TEXT NOT NULL,
      transitioned_at TEXT NOT NULL
    );
  `);
  // Existing DBs created before part existed need the column; CREATE TABLE IF NOT EXISTS skips ALTER.
  const incidentCols = db.prepare("PRAGMA table_info(incidents)").all().map((c) => c.name);
  if (!incidentCols.includes("part")) db.exec("ALTER TABLE incidents ADD COLUMN part TEXT");
  if (!incidentCols.includes("priority")) db.exec("ALTER TABLE incidents ADD COLUMN priority TEXT DEFAULT 'high'");

  const PART_FALLBACK = { RPP1: "URjoint1", T1: "T_Machine_Static", "MTR07-CAD": "1LE1003-1EB23-4JA4" };
  const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  const titleCase = (s) => (s || "").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const statusLabel = { new: "New", acknowledged: "Acknowledged", in_progress: "In progress", resolved: "Resolved" };
  const priorityLabel = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
  const resolvePart = (assetId, part) => {
    const named = typeof part === "string" && part.trim() ? part.trim() : null;
    return named || PART_FALLBACK[assetId] || null;
  };

  const now = () => new Date().toISOString();
  const getState = (key, fallback) => {
    const row = db.prepare("SELECT value FROM state WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : fallback;
  };
  const setState = (key, value) => db.prepare("INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
  const getIncident = (incidentId) => {
    const incident = db.prepare("SELECT incident_id,asset_id,fault,status,previous_incident_id,part,priority FROM incidents WHERE incident_id=?").get(incidentId);
    if (!incident) return null;
    const detections = db.prepare("SELECT detected_at FROM incident_detections WHERE incident_id=? ORDER BY detection_id").all(incidentId);
    const status_history = db.prepare("SELECT status,transitioned_at FROM incident_status_history WHERE incident_id=? ORDER BY transition_id").all(incidentId);
    const flag = db.prepare("SELECT source,window,rpm,rms,ts FROM flags WHERE asset_id=? AND fault=? ORDER BY id DESC LIMIT 1").get(incident.asset_id, incident.fault);
    const wo = db.prepare("SELECT wo_id,json FROM work_orders WHERE asset_id=? AND fault=? AND status='open' ORDER BY opened DESC LIMIT 1").get(incident.asset_id, incident.fault);
    const first = detections[0]?.detected_at || null;
    const last = detections[detections.length - 1]?.detected_at || null;
    const ageMs = last ? Math.max(0, Date.now() - Date.parse(last)) : 0;
    return {
      ...incident,
      priority: incident.priority || "high",
      detections,
      status_history,
      detection_count: detections.length,
      first_seen: first,
      last_seen: last,
      source: flag?.source || null,
      window: flag?.window || null,
      rpm: flag?.rpm ?? null,
      rms: flag?.rms ?? null,
      work_order: wo ? JSON.parse(wo.json) : null,
      wo_id: wo?.wo_id || null,
      title: `${titleCase(incident.fault)} on ${incident.part || resolvePart(incident.asset_id, incident.part) || incident.asset_id}`,
      age_ms: ageMs,
    };
  };
  const collectIssues = () => {
    const issues = [];
    const seen = new Set();
    const open = db.prepare("SELECT incident_id,asset_id,fault,status,part,priority FROM incidents WHERE status!='resolved' ORDER BY incident_id").all();
    for (const row of open) {
      const part = resolvePart(row.asset_id, row.part);
      if (!part) continue;
      const key = `${row.asset_id}\0${part}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pri = row.priority || "high";
      issues.push({ asset_id: row.asset_id, part, fault: row.fault, status: row.status, priority: pri, severity: pri === "critical" ? "critical" : pri === "medium" || pri === "low" ? "warning" : "critical", incident_id: row.incident_id });
    }
    const pending = db.prepare("SELECT id,asset_id,part,fault,status FROM flags WHERE status='pending' AND part IS NOT NULL AND part!='' ORDER BY id").all();
    for (const row of pending) {
      const part = resolvePart(row.asset_id, row.part);
      if (!part) continue;
      const key = `${row.asset_id}\0${part}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ asset_id: row.asset_id, part, fault: row.fault, status: "pending", severity: "warning", incident_id: null, flag_id: row.id });
    }
    return issues;
  };
  return {
    db,
    close: () => db.close(),
    seed() {
      if (!db.prepare("SELECT 1 FROM historian LIMIT 1").get()) {
        const ins=db.prepare("INSERT INTO historian VALUES(?,?,?,?,?,?)");
        const root=path.resolve(path.dirname(filename), "..");
        const candidates=[
          path.join(root,"tapes","slice20","l1","historian.csv"),
          path.join(root,"tapes","l1","historian.csv"),
          path.resolve("data/tapes/slice20/l1/historian.csv"),
          path.resolve("data/tapes/l1/historian.csv"),
        ];
        const csvPath=candidates.find((p)=>fs.existsSync(p));
        if (csvPath) {
          const text=fs.readFileSync(csvPath,"utf8").trim().split(/\r?\n/);
          const header=text.shift();
          // ts,asset_id,part,tag,value,unit,quality,source
          for (const line of text) {
            if (!line) continue;
            const cols=line.split(",");
            if (cols.length < 8) continue;
            const [ts,asset_id,,tag,value,unit,,source]=cols;
            ins.run(asset_id,tag,ts,Number(value),unit,source);
          }
        } else {
          ins.run("RPP1","rms",now(),0.082,"g","cwru:97.mat");
          ins.run("RPP1","rpm",now(),1797,"rpm","cwru:97.mat");
          ins.run("T1","cycle_s",now(),2.0,"s","vlft:process");
          ins.run("T1","busy",now(),0,"bool","vlft:process");
        }
      }
      // Containment is never seeded. app/lib/openshell.mjs fills it from the gateway's own audit log; until then it is UNPROVEN.
      if (!db.prepare("SELECT 1 FROM state WHERE key='containment'").get()) setState("containment",{state:"UNPROVEN",last_deny:null,denies:[],deny_count:0,policy:null,inference:"inference.local",errors:["not yet read from openshell"]});
      if (!db.prepare("SELECT 1 FROM state WHERE key='fpr'").get()) setState("fpr",{n_false:0,n_normal:4});
      this.seedDemoIncidents();
    },
    seedDemoIncidents() {
      if (db.prepare("SELECT 1 FROM state WHERE key='demo_seeded'").get()) return;
      const fixturesPath = path.resolve(path.dirname(filename), "demo/seed-incidents.json");
      const alt = path.resolve("data/demo/seed-incidents.json");
      const fixtureFile = [fixturesPath, alt].find((p) => fs.existsSync(p));
      if (!fixtureFile) return;
      const fixtures = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
      for (const fix of fixtures.incidents || []) {
        const part = resolvePart(fix.asset_id, fix.part);
        const existing = db.prepare("SELECT incident_id FROM incidents WHERE asset_id=? AND fault=? AND status!='resolved'").get(fix.asset_id, fix.fault);
        if (existing) continue;
        const inserted = db.prepare("INSERT INTO incidents(asset_id,fault,status,previous_incident_id,part,priority) VALUES(?,?,?,?,?,?)")
          .run(fix.asset_id, fix.fault, "new", null, part, fix.priority || "high");
        const incidentId = Number(inserted.lastInsertRowid);
        const detectedAt = fix.detected_at || now();
        db.prepare("INSERT INTO incident_status_history(incident_id,status,transitioned_at) VALUES(?,?,?)").run(incidentId, "new", detectedAt);
        if (fix.status && fix.status !== "new") {
          db.prepare("UPDATE incidents SET status=? WHERE incident_id=?").run(fix.status, incidentId);
          db.prepare("INSERT INTO incident_status_history(incident_id,status,transitioned_at) VALUES(?,?,?)").run(incidentId, fix.status, fix.acknowledged_at || detectedAt);
        }
        for (const ts of fix.detections || [detectedAt]) {
          db.prepare("INSERT INTO incident_detections(incident_id,detected_at) VALUES(?,?)").run(incidentId, ts);
        }
        const flagStatus = fix.flag_status || "processed";
        db.prepare("INSERT INTO flags(asset_id,part,fault,source,window,rpm,rms,status,ts) VALUES(?,?,?,?,?,?,?,?,?)")
          .run(fix.asset_id, part, fix.fault, fix.source || null, fix.window || null, fix.rpm ?? null, fix.rms ?? null, flagStatus, detectedAt);
        if (fix.work_order) {
          const wo = fix.work_order;
          db.prepare("INSERT INTO work_orders VALUES(?,?,?,?,?,?)").run(wo.wo_id, wo.asset_id, wo.fault, "open", wo.opened, JSON.stringify(wo));
        }
      }
      setState("demo_seeded", { at: now(), file: fixtureFile });
    },
    hopOverride() { return getState("hop_override", null); },
    setHopOverride(value) {
      if (!value) {
        db.prepare("DELETE FROM state WHERE key='hop_override'").run();
        return null;
      }
      setState("hop_override", value);
      return value;
    },
    latestHop() { return getState("latest_hop", null); },
    listIncidents({ status } = {}) {
      const rows = status === "resolved"
        ? db.prepare("SELECT incident_id FROM incidents WHERE status='resolved' ORDER BY incident_id DESC").all()
        : db.prepare("SELECT incident_id FROM incidents WHERE status!='resolved' ORDER BY incident_id").all();
      const items = rows.map((r) => getIncident(r.incident_id)).filter(Boolean);
      items.sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority] ?? 9;
        const pb = PRIORITY_RANK[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        return Date.parse(a.last_seen || 0) - Date.parse(b.last_seen || 0);
      });
      return items.map((inc) => ({
        id: `INC-${inc.incident_id}`,
        incident_id: inc.incident_id,
        priority: priorityLabel[inc.priority] || titleCase(inc.priority),
        priority_key: inc.priority,
        title: inc.title,
        asset: inc.asset_id,
        component: inc.part || resolvePart(inc.asset_id, inc.part),
        area: "VFLab · hinge assembly",
        line: "—",
        cell: "VFLab · hinge assembly",
        status: statusLabel[inc.status] || titleCase(inc.status),
        status_key: inc.status,
        ai: inc.work_order ? "Ready" : "L1",
        last: inc.last_seen,
        first: inc.first_seen,
        age_ms: inc.age_ms,
        ageMin: Math.floor((inc.age_ms || 0) / 60000),
        detections: inc.detection_count,
        signal: inc.fault === "process_drop" ? "Process" : (inc.rms != null && inc.rms > 0.15 ? "Elevated" : "Normal"),
        fault: inc.fault,
        source: inc.source,
        window: inc.window,
        rpm: inc.rpm,
        rms: inc.rms,
        wo_id: inc.wo_id,
        work_order: inc.work_order,
      }));
    },
    historianSeries(assetId, tag, limit = 20) {
      return db.prepare("SELECT ts,value,unit,source FROM historian WHERE asset_id=? AND tag=? ORDER BY ts DESC LIMIT ?")
        .all(assetId, tag, limit)
        .reverse();
    },
    hopsLatest(limit = 20) {
      const latest = this.latestHop();
      const rms = this.historianSeries("RPP1", "rms", limit);
      const processAssets = {};
      const mapPaths = [
        path.resolve("data/asset-map.json"),
        path.resolve(path.dirname(filename), "../asset-map.json"),
      ];
      const mapPath = mapPaths.find((p) => fs.existsSync(p));
      let assetIds = ["T1", "MTR07-CAD"];
      if (mapPath) {
        try {
          assetIds = (JSON.parse(fs.readFileSync(mapPath, "utf8")).assets || []).map((a) => a.asset_id).filter((id) => id !== "RPP1");
        } catch {}
      }
      for (const assetId of assetIds.slice(0, 24)) {
        const tags = {};
        const rows = db.prepare("SELECT tag,value,unit,source,ts FROM historian WHERE asset_id=? AND ts=(SELECT MAX(ts) FROM historian WHERE asset_id=?)").all(assetId, assetId);
        if (!rows.length) continue;
        let source = rows[0].source;
        let part = resolvePart(assetId, null);
        for (const row of rows) {
          tags[row.tag] = row.tag === "busy" || row.tag === "bowl_on" ? Number(row.value) : row.value;
          source = row.source || source;
        }
        processAssets[assetId] = { part, source, tags, busy: tags.busy, ...tags };
      }
      return {
        live: Boolean(latest),
        latest,
        rms,
        assets: processAssets,
        hop_override: this.hopOverride(),
      };
    },
    incident(incidentId) { return getIncident(incidentId); },
    recordIncidentDetection(data) {
      const detectedAt=data.detected_at||now();
      const part=resolvePart(data.asset_id,data.part);
      const priority = data.priority || (data.asset_id === "RPP1" ? "critical" : "high");
      db.exec("BEGIN IMMEDIATE");
      try {
        let incident=db.prepare("SELECT incident_id,part FROM incidents WHERE asset_id=? AND fault=? AND status!='resolved' ORDER BY incident_id DESC LIMIT 1").get(data.asset_id,data.fault);
        if (!incident) {
          const previous=db.prepare("SELECT incident_id FROM incidents WHERE asset_id=? AND fault=? AND status='resolved' ORDER BY incident_id DESC LIMIT 1").get(data.asset_id,data.fault);
          const inserted=db.prepare("INSERT INTO incidents(asset_id,fault,status,previous_incident_id,part,priority) VALUES(?,?,'new',?,?,?)").run(data.asset_id,data.fault,previous?.incident_id??null,part,priority);
          incident={incident_id:Number(inserted.lastInsertRowid)};
          db.prepare("INSERT INTO incident_status_history(incident_id,status,transitioned_at) VALUES(?,'new',?)").run(incident.incident_id,detectedAt);
        } else if (part && !incident.part) {
          db.prepare("UPDATE incidents SET part=? WHERE incident_id=?").run(part,incident.incident_id);
        }
        db.prepare("INSERT INTO incident_detections(incident_id,detected_at) VALUES(?,?)").run(incident.incident_id,detectedAt);
        db.exec("COMMIT");
        return getIncident(incident.incident_id);
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    transitionIncident(incidentId, status, transitionedAt=now()) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result=db.prepare("UPDATE incidents SET status=? WHERE incident_id=?").run(status,incidentId);
        if (result.changes===0) throw new Error(`incident ${incidentId} not found`);
        db.prepare("INSERT INTO incident_status_history(incident_id,status,transitioned_at) VALUES(?,?,?)").run(incidentId,status,transitionedAt);
        db.exec("COMMIT");
        return getIncident(incidentId);
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
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
    containment() { return getState("containment",{state:"UNPROVEN",last_deny:null,denies:[],deny_count:0,policy:null,inference:"inference.local",errors:[]}); },
    /** Idempotent detect: write flag + coalesce open incident. Twin lights from board().issues. */
    detect(data) {
      if (!data?.asset_id || !data?.fault) throw new Error("asset_id and fault required");
      const part = resolvePart(data.asset_id, data.part);
      if (!part) throw new Error("part required for detect");
      const existing = db.prepare("SELECT incident_id FROM incidents WHERE asset_id=? AND fault=? AND status!='resolved' LIMIT 1").get(data.asset_id, data.fault);
      let flagId = null;
      if (!existing) {
        flagId = this.flag({
          asset_id: data.asset_id,
          part,
          fault: data.fault,
          source: data.source || null,
          window: data.window || null,
          rpm: data.rpm ?? null,
          rms: data.rms ?? null,
          ts: data.ts || now(),
        });
      }
      const incident = this.recordIncidentDetection({
        asset_id: data.asset_id,
        fault: data.fault,
        part,
        detected_at: data.ts || data.detected_at || now(),
        priority: data.priority || (data.asset_id === "RPP1" ? "critical" : undefined),
      });
      return { inserted: !existing, flag_id: flagId, incident, issues: collectIssues() };
    },
    board(selection={asset_id:"RPP1",part:"URjoint1",kind:"asset"}) {
      const mapPaths=[
        path.resolve("data/asset-map.json"),
        path.resolve(path.dirname(filename),"../asset-map.json"),
        path.resolve("web/twin/asset-map.json"),
      ];
      let assets=[{asset_id:"RPP1",role:"hero",part:"URjoint1",source:"cwru:105.mat"},{asset_id:"T1",role:"process",part:"T_Machine_Static",source:"vlft:process"}];
      const mapPath=mapPaths.find((p)=>fs.existsSync(p));
      if (mapPath) {
        try {
          const amap=JSON.parse(fs.readFileSync(mapPath,"utf8"));
          assets=(amap.assets||[]).map((a)=>({asset_id:a.asset_id,role:a.role,part:a.part,source:a.source,name:a.name||a.asset_id}));
        } catch {}
      }
      const latest=db.prepare("SELECT value,unit,ts,source FROM historian WHERE asset_id=? AND tag=? ORDER BY ts DESC LIMIT 1");
      const open=db.prepare("SELECT wo_id,fault FROM work_orders WHERE asset_id=? AND status='open' ORDER BY opened DESC LIMIT 1");
      const flag=db.prepare("SELECT fault,ts FROM flags WHERE asset_id=? ORDER BY id DESC LIMIT 1");
      const fleet=assets.map((a)=>{
        const rms=latest.get(a.asset_id,"rms"), rpm=latest.get(a.asset_id,"rpm"), wo=open.get(a.asset_id), fl=flag.get(a.asset_id);
        return {...a,rms:rms?.value??null,rpm:rpm?.value??null,ts:rms?.ts??null,flag:fl?.fault??null,wo_id:wo?.wo_id??null};
      });
      const selected=selection.asset_id||"RPP1";
      const runs=db.prepare("SELECT * FROM agent_runs WHERE asset_id=? ORDER BY started DESC LIMIT 8").all(selected).map((r)=>({...r,events:this.events(r.id)}));
      return {cell:{name:"VFLab · hinge assembly",cite:"https://github.com/difactory/repository",license:"CC BY-NC 4.0"},containment:getState("containment",{}),fpr:getState("fpr",{}),honesty:{iso_floor_kw:15,claim:"context_only"},selection,fleet,issues:collectIssues(),work_order:this.openWorkOrder(selected),answer:this.latestAnswer(selected),runs};
    }
  };
}
