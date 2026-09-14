import { randomUUID } from "node:crypto";
import { parseAgentJson, validateAnswer, validateQuestion } from "./contracts.mjs";
import { localChat } from "./local-infer.mjs";

const TAG_SKIP = new Set(["part", "source", "tags"]);

function tagEntries(slot) {
  if (!slot) return [];
  const tags = slot.tags && Object.keys(slot.tags).length
    ? slot.tags
    : Object.fromEntries(Object.entries(slot).filter(([key]) => !TAG_SKIP.has(key)));
  return Object.entries(tags).filter(([, value]) => value !== undefined && value !== null && value !== "");
}

function asList(value) {
  return Array.isArray(value) ? value.filter((item) => item != null && item !== "") : [];
}

function workOrderContext(wo, incident) {
  const row = wo || incident?.work_order || null;
  if (!row && !incident?.wo_id) return null;
  return {
    wo_id: row?.wo_id || incident?.wo_id || null,
    asset_id: row?.asset_id || incident?.asset || null,
    opened: row?.opened || null,
    fault: row?.fault || incident?.fault || null,
    severity: row?.severity || null,
    action: row?.action || null,
    parts: asList(row?.parts),
    priority: row?.priority || incident?.priority || null,
    evidence: row?.evidence
      ? {
          source: row.evidence.source || null,
          window: row.evidence.window || null,
          rpm: row.evidence.rpm ?? null,
          part: row.evidence.part || null,
          features: asList(row.evidence.features),
        }
      : null,
    citations: asList(row?.citations),
  };
}

function l2ReportContext(wo, incident) {
  const row = wo || incident?.work_order || null;
  if (!row) return null;
  const order = workOrderContext(wo, incident);
  return {
    wo_id: order.wo_id,
    fault: order.fault,
    action: order.action,
    parts: order.parts,
    priority: order.priority,
    severity: order.severity,
    features: order.evidence?.features || [],
    evidence: order.evidence,
    citations: order.citations,
  };
}

function citedContexts(wo, incident) {
  return {
    work_order: workOrderContext(wo, incident),
    l2_report: l2ReportContext(wo, incident),
  };
}

function snapshotPacket({ id, incident, wo, latest }) {
  const source = incident.source || wo?.evidence?.source || null;
  const window = incident.window || wo?.evidence?.window || null;
  return {
    asset_id: id,
    role: "diagnosed",
    part: incident.component || wo?.evidence?.part || id,
    source,
    hop: latest?.hop ?? null,
    ts: latest?.ts ?? incident.last ?? incident.first ?? null,
    snapshot: {
      window,
      rpm: incident.rpm ?? wo?.evidence?.rpm ?? null,
      rms: incident.rms ?? null,
      fault: incident.fault || wo?.fault || null,
    },
    ...citedContexts(wo, incident),
    incident: { id: incident.id, status: incident.status, fault: incident.fault },
    honesty: { iso_floor_kw: 15, claim: "context_only", diagnosed: true },
  };
}

export function buildAssistPacket({ hops, board, incidents = [], assetId }) {
  const id = String(assetId || "RPP1").trim() || "RPP1";
  const latest = hops?.latest || null;
  const incident = incidents.find((row) => row.asset === id) || null;
  const wo = board?.work_order && board.work_order.asset_id === id
    ? board.work_order
    : incident?.work_order || null;

  if (id === "RPP1") {
    const rpp1 = latest?.rpp1;
    if (rpp1?.rms != null) {
      return {
        asset_id: "RPP1",
        role: "hero",
        part: rpp1.part || "URjoint1",
        source: rpp1.source,
        hop: latest.hop ?? null,
        ts: latest.ts ?? null,
        rpp1: {
          file: rpp1.file || null,
          channel: rpp1.channel || null,
          window: rpp1.window || null,
          rpm: rpp1.rpm ?? null,
          rms: rpp1.rms,
          fault: rpp1.fault ?? null,
          engine: rpp1.engine || null,
          bpfi: rpp1.bpfi || null,
          bpfo: rpp1.bpfo || null,
          injected: Boolean(rpp1.injected),
        },
        ...citedContexts(wo, incident),
        incident: incident ? { id: incident.id, status: incident.status, fault: incident.fault } : null,
        honesty: { iso_floor_kw: 15, claim: "context_only", diagnosed: true },
      };
    }
    if (incident?.source || incident?.rms != null) return snapshotPacket({ id, incident, wo, latest });
    throw new Error("no hop evidence for RPP1");
  }

  if (incident?.source || incident?.rms != null) return snapshotPacket({ id, incident, wo, latest });

  const slot = hops?.assets?.[id] || latest?.assets?.[id] || null;
  const tags = Object.fromEntries(tagEntries(slot));
  if (!slot || !Object.keys(tags).length) throw new Error(`unsupported asset ${id}`);
  return {
    asset_id: id,
    role: "process",
    part: slot.part || id,
    source: slot.source || null,
    hop: latest?.hop ?? null,
    ts: latest?.ts ?? slot.ts ?? null,
    tags,
    work_order: null,
    l2_report: null,
    incident: null,
    honesty: { iso_floor_kw: 15, claim: "context_only", diagnosed: false },
  };
}

function pushCite(cites, cite) {
  const key = citationKey(cite);
  if (!key || cites.some((row) => citationKey(row) === key)) return;
  cites.push(cite);
}

export function packetCitations(packet) {
  if (packet.role === "hero" || packet.role === "diagnosed") {
    const cites = [];
    pushCite(cites, {
      type: "signal",
      source: packet.source,
      window: packet.rpp1?.window || packet.snapshot?.window || packet.l2_report?.evidence?.window || null,
    });
    for (const cite of packet.l2_report?.citations || packet.work_order?.citations || []) {
      if (cite?.type === "signal") pushCite(cites, { type: "signal", source: cite.source, window: cite.window || null });
      if (cite?.type === "manual") pushCite(cites, { type: "manual", doc: cite.doc, page: cite.page ?? null });
      if (cite?.type === "history") pushCite(cites, { type: "history", wo_id: cite.wo_id });
    }
    if (packet.work_order?.wo_id) pushCite(cites, { type: "history", wo_id: packet.work_order.wo_id });
    return cites;
  }
  return [{ type: "process", source: packet.source, hop: packet.hop }];
}

function citationKey(cite) {
  if (!cite || typeof cite !== "object") return "";
  if (cite.type === "signal") return `signal:${cite.source || ""}`;
  if (cite.type === "history") return `history:${cite.wo_id || ""}`;
  if (cite.type === "manual") return `manual:${cite.doc || ""}:${cite.page ?? ""}`;
  if (cite.type === "process") return `process:${cite.source || ""}`;
  return "";
}

export function bindCitations(packet, proposed = []) {
  const allowed = new Map(packetCitations(packet).map((cite) => [citationKey(cite), cite]));
  const bound = [];
  for (const cite of proposed) {
    const hit = allowed.get(citationKey(cite));
    if (hit && !bound.some((row) => citationKey(row) === citationKey(hit))) bound.push(hit);
  }
  return bound;
}

function stripThink(text) {
  return String(text).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function assistRules(packet) {
  const bound = packet.work_order || packet.l2_report
    ? "work_order and l2_report are already loaded — use their action, parts, features, and citations. Do not invent a different draft."
    : "work_order and l2_report are null. Say so if asked; do not invent a work order or L2 report.";
  if (packet.role === "hero") {
    return `RPP1 is the only diagnosed asset. Use only packet numbers. Do not invent ISO 20816 zones or manual pages. ${bound}`;
  }
  if (packet.role === "diagnosed") {
    return `${packet.asset_id} has a cited incident snapshot. Use only packet numbers. Do not invent ISO 20816 zones or manual pages. ${bound}`;
  }
  return `${packet.asset_id} has process/electrical tags only — not diagnosed. Do not invent a fault, ISO zone, work order, or L2 report.`;
}

export function assistPrompt(question, packet) {
  return [
    {
      role: "system",
      content: `You are Maintenance Assist, a coworker on the plant floor. Talk with the technician — do not dump fields.

How to answer:
- 2-4 complete sentences. Lead with the answer, then one cited fact from the hop packet (prefer work_order / l2_report when present), then offer one next step they can ask (evidence window, work order, L2 features, RMS, or action) if that item is actually in the packet.
- Never reply with only a code, label, field value, or fragment. Bad: "inner_race". Good: "The cited fault is an inner-race bearing fault (inner_race) on URjoint1. It is pinned to the 0.00–2.00 s window on this hop. Want the evidence window or the open work order next?"
- Translate machine identifiers into readable language — for example, describe inner_race as an inner-race bearing fault — while keeping the exact code in parentheses.
- Answer only from the hop packet. ${assistRules(packet)} Unrelated question → out_of_scope=true.

JSON only: {"answer":"<natural-language answer that ends with a follow-up offer>","out_of_scope":false,"citations":[]}. No markdown.`,
    },
    {
      role: "user",
      content: `Question: "What's the cited fault?"\nHop packet: {"asset_id":"PP5","role":"diagnosed","part":"AC motor","source":"mendeley:0Nm_BPFI_10__ch0.mat","snapshot":{"window":"0.00..2.00","fault":"inner_race"},"work_order":{"wo_id":"WO-PP5-IR","fault":"inner_race","action":"Inspect inner race; schedule bearing replace","parts":["6205-2RS"],"priority":"critical"},"l2_report":{"wo_id":"WO-PP5-IR","action":"Inspect inner race; schedule bearing replace","parts":["6205-2RS"],"features":["Mendeley BPFI inner-race label; RMS 1.352 g"]}}`,
    },
    {
      role: "assistant",
      content: `{"answer":"The cited fault is an inner-race bearing fault (inner_race) on the PP5 AC motor. L2 already drafted WO-PP5-IR to inspect the inner race and schedule a 6205-2RS replace, pinned to the 0.00–2.00 s window. Want the L2 features or the work-order action next?","out_of_scope":false,"citations":[]}`,
    },
    {
      role: "user",
      content: `Question: ${JSON.stringify(question)}\nHop packet: ${JSON.stringify(packet)}`,
    },
  ];
}

export async function askAssist({ store, question, asset_id, infer = localChat }) {
  const q = validateQuestion(question);
  const assetId = String(asset_id || "RPP1").trim() || "RPP1";
  const latest = store.latestHop();
  const hops = { live: Boolean(latest), latest, assets: latest?.assets || {} };
  const board = store.board({ asset_id: assetId, kind: "asset" });
  const packet = buildAssistPacket({ hops, board, incidents: store.listIncidents(), assetId });
  const runId = randomUUID();
  const answerId = randomUUID();
  store.createRun({ id: runId, workflow: "maintenance-question", asset_id: assetId, state: "running" });
  try {
    const result = await infer({ messages: assistPrompt(q, packet) });
    const raw = parseAgentJson(stripThink(result.text));
    if (typeof raw.out_of_scope !== "boolean") raw.out_of_scope = false;
    if (!Array.isArray(raw.citations)) raw.citations = [];
    raw.citations = bindCitations(packet, raw.citations);
    if (!raw.out_of_scope && raw.citations.length === 0) raw.citations = packetCitations(packet);
    const body = validateAnswer(raw);
    store.saveAnswer({ id: answerId, run_id: runId, asset_id: assetId, question: q, body });
    store.setRun(runId, "completed");
    return { id: answerId, run_id: runId, asset_id: assetId, question: q, model: result.model, ...body };
  } catch (error) {
    store.setRun(runId, "failed", error.message);
    throw error;
  }
}
