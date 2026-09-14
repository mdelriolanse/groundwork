// Browser-only replay: fixed fixture incidents, no detection or injection API.
export function createDemo(feed, seed, now = () => new Date().toISOString()) {
  const tape = feed.hops.filter(h => h.i <= 9);
  if (!tape.length || !Array.isArray(seed.incidents)) throw new Error('Demo fixtures unavailable');
  const title = value => value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
  const incidents = seed.incidents.map((row, index) => ({
    id: `INC-${index + 1}`, incident_id: index + 1,
    asset: row.asset_id, component: row.part,
    title: `${title(row.fault)} on ${row.part}`, fault: row.fault,
    priority: title(row.priority), priority_key: row.priority,
    status: title(row.status), status_key: row.status,
    first: row.detected_at, last: row.detections?.at(-1) || row.detected_at,
    detections: row.detections?.length || 1, ageMin: 0,
    source: row.source, window: row.window, rms: row.rms ?? null, rpm: row.rpm ?? null,
    signal: row.rms == null ? 'Process' : 'Elevated',
    work_order: structuredClone(row.work_order || null), wo_id: row.work_order?.wo_id || null,
    ai: row.work_order ? 'Ready' : 'L1', area: feed.cell.name, cell: feed.cell.name,
  }));
  let count = 0;
  const history = [];
  function record() {
    const raw = structuredClone(tape[count % tape.length]);
    const latest = { ...raw, hop: count, ts: now(), seeded: true };
    for (const incident of incidents) {
      if (incident.rms == null || !latest.assets?.[incident.asset]) continue;
      Object.assign(latest.assets[incident.asset], {
        rms: incident.rms, fault: incident.fault, source: incident.source,
        window: incident.window, rpm: incident.rpm,
        vibration: { ...latest.assets[incident.asset].vibration, rms: incident.rms, fault: incident.fault, source: incident.source, window: incident.window },
      });
    }
    history.push(latest);
    if (history.length > 60) history.shift();
  }
  record();
  function snapshot() {
    const latest = history.at(-1);
    const series = id => history.map(h => ({ ts: h.ts, value: id === 'RPP1' ? h.rpp1.rms : h.assets?.[id]?.rms, source: id === 'RPP1' ? h.rpp1.source : h.assets?.[id]?.source })).filter(r => r.value != null);
    return structuredClone({
      incidents,
      hops: { live: true, latest, rms: series('RPP1'), assets: latest.assets, vibration: Object.fromEntries(['RPP1','PP5','B1','B2','B3','B4'].map(id => [id, series(id)])) },
      board: {
        cell: feed.cell, honesty: { iso_floor_kw: 15, claim: 'context_only' },
        containment: { state: 'UNPROVEN', denies: [], deny_count: 0 },
        fleet: feed.fleet.map(a => ({ ...a, flag: incidents.find(i => i.asset === a.asset_id)?.fault || null })),
        issues: incidents.map(i => ({ asset_id: i.asset, part: i.component, fault: i.fault, priority: i.priority_key, severity: i.priority_key, status: i.status_key, incident_id: i.incident_id })),
        work_order: null, answer: null, runs: [],
      },
    });
  }
  function answer(question, assetId, incidentId) {
    const q = String(question).trim().slice(0, 500);
    const incident = incidents.find(i => i.asset === assetId && i.id === incidentId) || incidents.find(i => i.asset === assetId);
    const wo = incident?.work_order;
    const latest = history.at(-1);
    const slot = assetId === 'RPP1' ? latest.rpp1 : Object.hasOwn(latest.assets || {}, assetId) ? latest.assets[assetId] : null;
    const source = incident?.source || slot?.source;
    const window = incident?.window || slot?.window;
    const tags = Object.entries(slot?.tags || {}).map(([k, v]) => `${k}: ${v}`).join('; ');
    const answers = {
      'What is the work order?': wo ? `${wo.wo_id}: ${wo.action}. Priority: ${wo.priority}. Prepared draft; human review required.` : 'No work order is attached to this asset.',
      "What's in the L2 report?": wo?.evidence?.features?.join(' ') || 'No L2 report is attached to this asset.',
      'What is the cited fault?': incident ? `${assetId}: ${incident.fault.replaceAll('_', ' ')}. Source: ${source}; window: ${window || 'not retained'}.` : 'No fault is pre-populated for this asset.',
      'Show the exact evidence window.': `${source || 'Source unavailable'}; window: ${window || 'not retained'}. Raw signal downloads are not included in this demo.`,
      'What L1 features are on this hop?': slot ? `${assetId}: RMS ${slot.rms ?? 'unavailable'} g; speed ${slot.rpm ?? 'unavailable'} rpm. Source: ${source || 'unavailable'}.` : 'No L1 features available.',
      'Has the flag fired?': incident ? `A pre-populated ${incident.fault.replaceAll('_', ' ')} incident exists for ${assetId}; this demo does not run detection.` : 'No pre-populated fault for this asset; this demo does not run detection.',
      'What L1 tags are on this hop?': tags || 'No process tags available for this asset.',
      'Is this station busy?': slot?.busy == null ? 'Busy state is unavailable.' : `${assetId} is ${slot.busy ? 'busy' : 'idle'} in this replay hop.`,
      'What is the cite for these tags?': source || 'No source locator available.',
    };
    const supported = Boolean(slot) && Object.hasOwn(answers, q);
    return { question: q, asset_id: assetId, incident_id: incident?.id || null, answer: supported ? answers[q] : 'This demo supports the suggested questions below.', model: 'Prepared demo answer', out_of_scope: !supported, citations: supported ? structuredClone(wo?.citations || []) : [] };
  }
  return { snapshot, tick() { count += 1; record(); return snapshot(); }, answer };
}
