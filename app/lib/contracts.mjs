const REQUIRED_WO = ["wo_id", "asset_id", "opened", "fault", "severity", "evidence", "citations", "action", "parts", "priority"];

export function parseAgentJson(value) {
  if (typeof value !== "string") return value;
  let text = value.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1];
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("agent did not return JSON");
}

function cleanString(value, field, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`invalid ${field}`);
  return value.trim();
}

export function validateWorkOrder(input, { validateCitation } = {}) {
  const wo = parseAgentJson(input);
  if (!wo || typeof wo !== "object" || Array.isArray(wo)) throw new Error("work order must be an object");
  for (const key of REQUIRED_WO) if (!(key in wo)) throw new Error(`missing ${key}`);
  if (wo.asset_id !== "RPP1") throw new Error("unsupported asset_id");
  if (!wo.evidence || wo.evidence.part !== "URjoint1") throw new Error("unsupported evidence.part");
  if (!/^WO-[A-Z0-9-]{4,24}$/.test(wo.wo_id)) throw new Error("invalid wo_id");
  wo.fault = cleanString(wo.fault, "fault", 80);
  wo.action = cleanString(wo.action, "action", 240);
  wo.opened = cleanString(wo.opened, "opened", 80);
  wo.priority = cleanString(wo.priority, "priority", 20);
  wo.severity = cleanString(wo.severity, "severity", 80);
  wo.evidence.source = cleanString(wo.evidence.source, "evidence.source", 120);
  wo.evidence.window = cleanString(wo.evidence.window, "evidence.window", 120);
  if (!Array.isArray(wo.evidence.features) || wo.evidence.features.length < 1) throw new Error("evidence.features required");
  if (!Array.isArray(wo.parts) || wo.parts.length < 1) throw new Error("parts required");
  if (!Array.isArray(wo.citations) || wo.citations.length < 1) throw new Error("citations required");
  if (validateCitation) for (const cite of wo.citations) validateCitation(cite, wo.asset_id);
  return structuredClone(wo);
}

export function validateQuestion(question) {
  if (typeof question !== "string") throw new Error("question required");
  const q = question.trim();
  if (q.length < 3 || q.length > 500) throw new Error("question must be 3-500 characters");
  return q;
}

export function validateAnswer(input, { validateCitation } = {}) {
  const answer = parseAgentJson(input);
  if (!answer || typeof answer !== "object") throw new Error("answer must be an object");
  if (typeof answer.out_of_scope !== "boolean") throw new Error("out_of_scope required");
  answer.answer = cleanString(answer.answer, "answer", 3000);
  if (!Array.isArray(answer.citations)) throw new Error("answer citations required");
  if (!answer.out_of_scope && answer.citations.length === 0) throw new Error("in-scope answer needs citations");
  if (validateCitation) for (const cite of answer.citations) validateCitation(cite, "RPP1");
  return structuredClone(answer);
}
