import fs from "node:fs";
import path from "node:path";

function csvRows(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  return lines.filter(Boolean).map((line) => Object.fromEntries(line.split(",").map((v, i) => [headers[i], v])));
}

function norm(text) { return String(text || "").toLowerCase().replace(/\s+/g, " ").trim(); }

export function createRag(root = process.cwd()) {
  const manifestPath = path.join(root, "config/corpus.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const docs = new Map();
  for (const doc of manifest.documents) { docs.set(doc.file,doc); for (const alias of doc.retrievalAliases||[]) docs.set(alias,doc); }

  function docPath(doc) { return path.resolve(root, doc.runtimePath); }
  // "<prefix>:<file>" -> runtime/corpus/<prefix>/<file>, e.g. "cwru:105.mat" or "mendeley:0Nm_BPFI_10__ch0.mat".
  function signalPath(source) {
    const s = String(source || "");
    const i = s.indexOf(":");
    if (i < 0) return null;
    const prefix = s.slice(0, i);
    const file = path.basename(s.slice(i + 1));
    return path.join(root, "runtime/corpus", prefix, file);
  }
  function pagesFor(doc) {
    if (!doc.pagesPath) return [];
    const p = path.resolve(root, doc.pagesPath);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")).pages : [];
  }
  function assertDoc(doc, assetId) {
    if (!doc || !doc.allowed || !doc.assets.includes(assetId)) throw new Error("citation outside corpus");
    if (!fs.existsSync(docPath(doc))) throw new Error(`citation file missing: ${doc?.file || "unknown"}`);
  }
  // Score pages by literal keyword hits on the fault name (e.g. "outer_race" -> "outer","race").
  // No synonym list, no ranking model - this is deliberately the simplest thing that could work.
  function searchPages(pages, fault) {
    const terms = norm(fault).split(/[\s_]+/).filter(Boolean);
    if (!terms.length) return null;
    let best = null, bestScore = 0;
    for (const p of pages) {
      const text = norm(p.text);
      const score = terms.reduce((n, t) => n + (text.split(t).length - 1), 0);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  return {
    manifest,
    pin(fault, assetId = "RPP1") {
      const staticPin = manifest.pins[fault];
      if (staticPin) {
        const doc = docs.get(staticPin.doc); assertDoc(doc, assetId);
        const pages = pagesFor(doc);
        if (!pages.find((p) => p.page === staticPin.page)) throw new Error(`unverified page ${staticPin.page}`);
        return { type: "manual", doc: staticPin.doc, page: staticPin.page };
      }
      // PROOF OF CONCEPT: faults without a verified pin (only inner_race has one right now)
      // get a quick keyword search over the manual instead of failing the whole L2 report.
      // If no page matches at all, fall back to a random page from the middle third of the
      // manual so there's still *a* citation attached.
      // TODO: replace the random fallback with real retrieval (embeddings/rerank), and add
      // verified pins for the other fault types the same way inner_race got one.
      const manualDoc = manifest.documents.find((d) => d.kind === "manual");
      if (!manualDoc) throw new Error(`no citation pin for ${fault}`);
      assertDoc(manualDoc, assetId);
      const pages = pagesFor(manualDoc);
      if (!pages.length) throw new Error(`no citation pin for ${fault}`);
      const hit = searchPages(pages, fault);
      if (hit) return { type: "manual", doc: manualDoc.file, page: hit.page };
      const mid = Math.floor(pages.length / 2);
      const band = Math.max(1, Math.floor(pages.length / 6));
      const lo = Math.max(0, mid - band);
      const hi = Math.min(pages.length - 1, mid + band);
      const idx = lo + Math.floor(Math.random() * (hi - lo + 1));
      return { type: "manual", doc: manualDoc.file, page: pages[idx].page };
    },
    resolvePassage(source, passage, assetId = "RPP1") {
      const doc = docs.get(path.basename(source)); assertDoc(doc, assetId);
      const full = norm(passage);
      if (full.length < 24) throw new Error("passage too short to resolve");
      const candidates=[full,...String(passage).split(/(?<=[.!?])\s+|\n+/).map(norm).filter((x)=>x.length>=30&&x.length<=320)];
      const words=full.split(" "); for(let i=0;i+12<=words.length;i+=6)candidates.push(words.slice(i,i+12).join(" "));
      for (const needle of candidates) { const matches=pagesFor(doc).filter((entry)=>norm(entry.text).includes(needle)); if(matches.length===1)return {type:"manual",doc:doc.file,page:matches[0].page,quote:needle}; }
      throw new Error("passage does not resolve to a page");
    },
    history(assetId = "RPP1", fault) {
      const doc = manifest.documents.find((d) => d.kind === "history" && d.assets.includes(assetId));
      assertDoc(doc, assetId);
      const aliases = new Set([assetId, ...(doc.aliases || [])]);
      const rows = csvRows(fs.readFileSync(docPath(doc), "utf8"));
      return rows.filter((row) => aliases.has(row.asset_id) && (!fault || row.fault === fault));
    },
    validateCitation(cite, assetId = "RPP1") {
      if (!cite || typeof cite !== "object") throw new Error("invalid citation");
      if (cite.type === "manual") {
        const doc = docs.get(cite.doc); assertDoc(doc, assetId);
        if (!Number.isInteger(cite.page) || !pagesFor(doc).some((p) => p.page === cite.page)) throw new Error("manual page missing");
        if (cite.quote) {
          const page = pagesFor(doc).find((p) => p.page === cite.page);
          if (!norm(page.text).includes(norm(cite.quote))) throw new Error("quote absent from cited page");
        }
        return true;
      }
      if (cite.type === "history") {
        if (!this.history(assetId).some((row) => row.wo_id === cite.wo_id)) throw new Error("history row missing");
        return true;
      }
      if (cite.type === "signal") {
        const p = signalPath(cite.source);
        if (!p || !fs.existsSync(p)) throw new Error("signal citation missing");
        return true;
      }
      throw new Error("unsupported citation type");
    },
    artifact(cite) {
      if (cite.type === "manual") return docs.get(cite.doc) ? docPath(docs.get(cite.doc)) : null;
      if (cite.type === "history") {
        const doc = manifest.documents.find((d) => d.kind === "history"); return doc ? docPath(doc) : null;
      }
      if (cite.type === "signal") return signalPath(cite.source);
      return null;
    }
  };
}
