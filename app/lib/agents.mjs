import fs from "node:fs";
import path from "node:path";

export function loadAgents(root=process.cwd()) { return JSON.parse(fs.readFileSync(path.join(root,"config/agents.json"),"utf8")); }

export function analysisPrompt(flag,pin,history) {
  return `You are running the automatic plant-floor-maintenance workflow. This is not chat.\n
Use tool_search to find load_signal, then call it with exactly {"filepath":"/sandbox/plant-floor-data/corpus/cwru/105.mat","signal_id":"rpp1_fault","sampling_rate":12000,"signal_unit":"g","overwrite":true}. The filepath field must be a singular string: never use file_path and never wrap it in an array. After that succeeds, call diagnose_vibration with signal_id=rpp1_fault, rpm=${flag.rpm}, bearing_id=6205, machine_group=2, support_type=rigid. Do not repeat an MCP diagnosis supplied by a tool with your own guessed diagnosis.\n
Canonical inputs (copy exactly): asset_id=RPP1, part=URjoint1, source=cwru:105.mat, window=${flag.window}. Verified manual pin: ${pin.doc} page ${pin.page}. Matching CMMS history: ${JSON.stringify(history)}.\n
Return only JSON with exactly this shape: {"wo_id":"WO-RPP1-<4 digits>","asset_id":"RPP1","opened":"<ISO timestamp>","fault":"inner_race","severity":"iso_context_only","evidence":{"source":"cwru:105.mat","window":"${flag.window}","rpm":${flag.rpm},"features":["<PMMCP evidence line>","<PMMCP evidence line>"],"part":"URjoint1"},"citations":[{"type":"signal","source":"cwru:105.mat","window":"${flag.window}"},{"type":"manual","doc":"${pin.doc}","page":${pin.page}},{"type":"history","wo_id":"WO-1410"}],"action":"<short action grounded by local evidence>","parts":["6205-2RS"],"priority":"high"}. No markdown.`;
}

export function questionPrompt(question,board) {
  return `You are running one scoped follow-up for RPP1. Question: ${JSON.stringify(question)}\nCurrent work order: ${JSON.stringify(board.work_order)}\n
If unrelated to this asset, fault, evidence, repair, bearing, or manual, call no tools and return {"answer":"That question is outside this work order.","out_of_scope":true,"citations":[],"tools":[]}.\n
If in scope, use tool_search to find search_documentation, then make exactly ONE PMMCP tool call with top_k=1 and query="Inspect bearing raceways cage rolling elements for spalls marks scratches streaks discolouration mirror-like areas radial internal clearance". Do not retry and do not call any other tool. Then answer from that result. Answer only from the returned passage; the backend derives the citation directly from the tool result.\n
Return only JSON: {"answer":"<concise answer grounded in result>","out_of_scope":false,"citations":[{"type":"manual","doc":"skf-bearing-damage-analysis.pdf","page":214,"quote":"<exact sentence>"}],"tools":["search_documentation"]}. No markdown.`;
}
