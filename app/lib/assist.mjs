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

export function buildAssistPacket({ hops, board, incidents = [], assetId }) {
  const id = String(assetId || "RPP1").trim() || "RPP1";
  const latest = hops?.latest || null;
  const incident = incidents.find((row) => row.asset === id) || null;
  const wo = board?.work_order && (board.work_order.asset_id === id || id === "RPP1") ? board.work_order : null;

  if (id === "RPP1") {
    const rpp1 = latest?.rpp1;
    if (!rpp1 || rpp1.rms == null) throw new Error("no hop evidence for RPP1");
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
      work_order: wo ? { wo_id: wo.wo_id, fault: wo.fault, action: wo.action, priority: wo.priority } : null,
      incident: incident ? { id: incident.id, status: incident.status, fault: incident.fault } : null,
      honesty: { iso_floor_kw: 15, claim: "context_only", diagnosed: true },
    };
  }

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
    incident: null,
    honesty: { iso_floor_kw: 15, claim: "context_only", diagnosed: false },
  };
}

export function packetCitations(packet) {
  if (packet.role === "hero") {
    const cites = [{ type: "signal", source: packet.source, window: packet.rpp1?.window || null }];
    if (packet.work_order?.wo_id) cites.push({ type: "history", wo_id: packet.work_order.wo_id });
    return cites;
  }
  return [{ type: "process", source: packet.source, hop: packet.hop }];
}

function citationKey(cite) {
  if (!cite || typeof cite !== "object") return "";
  if (cite.type === "signal") return `signal:${cite.source || ""}`;
  if (cite.type === "history") return `history:${cite.wo_id || ""}`;
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

export function assistPrompt(question, packet) {
  const rules = packet.role === "hero"
    ? "RPP1 is the only diagnosed asset. Use only packet numbers. Do not invent ISO 20816 zones, manual pages, or a work order missing from the packet."
    : `${packet.asset_id} has process/electrical tags only — not diagnosed. Do not invent a fault, ISO zone, or work order.`;
  return [
    {
      role: "system",
      content: `You are Maintenance Assist. Answer only from the hop packet. ${rules} Unrelated question → out_of_scope=true. JSON only: {"answer":"<concise>","out_of_scope":false,"citations":[]}. No markdown.`,
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
  const board = store.board({ asset_id: assetId, part: assetId === "RPP1" ? "URjoint1" : null, kind: "asset" });
  const packet = buildAssistPacket({ hops, board, incidents: store.listIncidents(), assetId });
  const runId = randomUUID();
  const answerId = randomUUID();
  store.createRun({ id: runId, workflow: "maintenance-question", asset_id: assetId, state: "running" });
  try {
    const result = await infer({ messages: assistPrompt(q, packet) });
    const raw = parseAgentJson(stripThink(result.text));
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
