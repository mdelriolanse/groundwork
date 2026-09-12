const $ = (id) => document.getElementById(id);
let selected = "RPP1";
let lastFocus = "";
let busy = false;

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function row(grid, label, value) {
  grid.append(node("dt", label));
  grid.append(node("dd", value ?? "—"));
}
function citeHref(cite) {
  if (cite.type === "manual") return `/api/artifacts/manual/${encodeURIComponent(cite.doc)}?page=${cite.page}#page=${cite.page}`;
  if (cite.type === "history") return `/api/artifacts/history/${encodeURIComponent(cite.wo_id)}`;
  if (cite.type === "signal") return `/api/artifacts/signal/${encodeURIComponent(String(cite.source).replace(/^cwru:/, ""))}`;
  return "#";
}
function citeLabel(cite) {
  if (cite.type === "manual") return `${cite.doc} · p${cite.page}`;
  if (cite.type === "history") return `${cite.wo_id} · CMMS row`;
  if (cite.type === "signal") return `${cite.source} · ${cite.window || "sensor window"}`;
  return "local artifact";
}
function renderCitations(parent, citations = []) {
  const list = node("div", undefined, "citations");
  for (const cite of citations) {
    const a = node("a", undefined, "citation");
    a.href = citeHref(cite); a.target = "_blank"; a.rel = "noopener";
    a.append(node("span", citeLabel(cite))); a.append(node("span", "OPEN ↗"));
    list.append(a);
  }
  parent.append(list);
}
function renderDossier(data) {
  const root = $("dossier"); root.replaceChildren();
  const wo = data.work_order;
  if (!wo) {
    root.append(node("span", "ASSET", "eyebrow"));
    root.append(node("h1", data.selection.asset_id || "Hinge assembly"));
    root.append(node("p", "Local agent watches the selected station. No cited repair is open yet.", "lead"));
    const asset = data.fleet.find((x) => x.asset_id === data.selection.asset_id);
    const grid = node("dl", undefined, "data-grid");
    row(grid, "part", asset?.part); row(grid, "source", asset?.source); row(grid, "last rms", asset?.rms == null ? "—" : `${asset.rms} g`); row(grid, "rpm", asset?.rpm);
    root.append(grid); $("question-block").hidden = true; return;
  }
  const brow = node("span", undefined, "eyebrow"); brow.append("WORK ORDER · ", node("strong", wo.wo_id)); root.append(brow);
  root.append(node("h1", wo.fault.replaceAll("_", " ")));
  root.append(node("p", `${wo.asset_id} · ${wo.evidence.part}. ${wo.action.replaceAll("_", " ").replace(/[.]+$/, "")}.`, "lead"));
  const grid = node("dl", undefined, "data-grid");
  row(grid, "asset", wo.asset_id); row(grid, "part", wo.evidence.part); row(grid, "source", wo.evidence.source); row(grid, "window", wo.evidence.window); row(grid, "speed", `${wo.evidence.rpm} rpm`); row(grid, "severity", wo.severity); row(grid, "parts", wo.parts.join(", "));
  root.append(grid);
  const features = node("ul", undefined, "features"); for (const item of wo.evidence.features) features.append(node("li", item)); root.append(features);
  root.append(node("p", "2 hp << 15 kW ISO floor — context only.", "eyebrow"));
  renderCitations(root, wo.citations);
  $("question-block").hidden = false;
  renderAnswer(data.answer);
}
function renderAnswer(answer) {
  const root = $("answer"); root.replaceChildren(); if (!answer) return;
  const box = node("div", undefined, "answer"); box.append(node("span", answer.out_of_scope ? "OUT OF SCOPE" : "CITED GUIDANCE", "eyebrow")); box.append(node("p", answer.answer)); renderCitations(box, answer.citations); root.append(box);
}
function renderRoster(data) {
  const root = $("roster"); root.replaceChildren();
  for (const asset of data.fleet) {
    const button = node("button", undefined, `asset-row${asset.asset_id === selected ? " selected" : ""}`); button.type = "button";
    const left = node("span"); left.append(node("strong", asset.asset_id)); left.append(node("small", ` · ${asset.part}`));
    const right = node("span", asset.flag ? `${asset.flag} · ${asset.wo_id || "agent"}` : `${asset.rms ?? "—"} g · clear`); if (asset.flag) right.className = "flag";
    button.append(left, right); button.addEventListener("click", () => choose(asset.asset_id, asset.part, asset.source)); root.append(button);
  }
}
function renderLedger(data) {
  const list = $("ledger"); list.replaceChildren(); const run = data.runs?.[0];
  $("run-state").textContent = busy ? "RUNNING" : (run?.state || "IDLE").toUpperCase();
  if (!run) { const li = node("li", "Awaiting condition flag"); li.append(node("small", "No model call while clean")); list.append(li); return; }
  for (const event of run.events || []) {
    const li = node("li", event.label, event.kind === "error" ? "error" : "");
    const detail = typeof event.detail === "string" ? event.detail : JSON.stringify(event.detail);
    if (detail && detail !== "{}") li.append(node("small", detail.length > 140 ? `${detail.slice(0, 137)}…` : detail)); list.append(li);
  }
}
function updateTwin(data) {
  const asset = data.fleet.find((x) => x.asset_id === selected) || data.fleet[0]; if (!asset) return;
  $("focus-name").textContent = `${asset.asset_id} · ${asset.part}`;
  const key = `${asset.asset_id}:${asset.flag || "clear"}:${data.work_order?.evidence?.part || asset.part}`;
  if (window.__twin && key !== lastFocus) { window.__twin.focusAsset(asset.asset_id); if (asset.flag) window.__twin.lightPart(asset.asset_id, data.work_order?.evidence?.part || asset.part); lastFocus = key; }
}
async function refresh() {
  try {
    const response = await fetch(`/api/board?asset=${encodeURIComponent(selected)}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error);
    $("containment").textContent = data.containment.state || "—"; $("containment").className = data.containment.state === "CONTAINED" ? "mark" : "flag";
    $("deny-line").textContent = data.containment.last_deny || "egress · deny"; $("fpr").textContent = `${data.fpr.n_false ?? "—"} / ${data.fpr.n_normal ?? "—"}`;
    renderDossier(data); renderRoster(data); renderLedger(data); updateTwin(data);
  } catch (error) { $("run-state").textContent = "OFFLINE"; }
}
function choose(assetId, part, source) { selected = assetId; lastFocus = ""; window.__twin?.focusAsset(assetId); $("focus-name").textContent = `${assetId} · ${part}`; refresh(); }
window.addEventListener("twinselect", (event) => { const d = event.detail; if (d?.asset_id && d.asset_id !== "—") choose(d.asset_id, d.part, d.source); });
window.addEventListener("twinready", () => { lastFocus = ""; refresh(); });
$("question-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (busy) return; const question = $("question").value.trim(); if (!question) return;
  busy = true; $("question-form").querySelector("button").disabled = true; window.__twin?.setFrozen(true); $("run-state").textContent = "RUNNING";
  try { const response = await fetch("/api/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); $("question").value = ""; }
  catch (error) { renderAnswer({ answer: error.message, out_of_scope: true, citations: [] }); }
  finally { busy = false; $("question-form").querySelector("button").disabled = false; window.__twin?.setFrozen(false); refresh(); }
});
$("deny").addEventListener("click", async () => { $("deny").disabled = true; try { await fetch("/api/containment/attempt", { method: "POST" }); } finally { $("deny").disabled = false; refresh(); } });
setInterval(() => { $("clock").textContent = new Date().toLocaleTimeString([], { hour12: false }); }, 1000);
setInterval(refresh, 1000); refresh();
