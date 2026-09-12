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
  function pagesFor(doc) {
    if (!doc.pagesPath) return [];
    const p = path.resolve(root, doc.pagesPath);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")).pages : [];
  }
  function assertDoc(doc, assetId) {
    if (!doc || !doc.allowed || !doc.assets.includes(assetId)) throw new Error("citation outside corpus");
    if (!fs.existsSync(docPath(doc))) throw new Error(`citation file missing: ${doc?.file || "unknown"}`);
  }

  return {
    manifest,
    pin(fault, assetId = "RPP1") {
      const pin = manifest.pins[fault];
      if (!pin) throw new Error(`no citation pin for ${fault}`);
      const doc = docs.get(pin.doc); assertDoc(doc, assetId);
      const pages = pagesFor(doc);
      if (!pages.find((p) => p.page === pin.page)) throw new Error(`unverified page ${pin.page}`);
      return { type: "manual", doc: pin.doc, page: pin.page };
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
        const file = path.basename(cite.source || "");
        const p = path.join(root, "runtime/corpus/cwru", file.replace(/^cwru:/, ""));
        if (!fs.existsSync(p)) throw new Error("signal citation missing");
        return true;
      }
      throw new Error("unsupported citation type");
    },
    artifact(cite) {
      if (cite.type === "manual") return docs.get(cite.doc) ? docPath(docs.get(cite.doc)) : null;
      if (cite.type === "history") {
        const doc = manifest.documents.find((d) => d.kind === "history"); return doc ? docPath(doc) : null;
      }
      if (cite.type === "signal") return path.join(root, "runtime/corpus/cwru", path.basename(cite.source).replace(/^cwru:/, ""));
      return null;
    }
  };
}
