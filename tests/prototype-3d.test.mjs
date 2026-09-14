import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const prototype = fs.readFileSync("web/prototype/app.js", "utf8");
const twin = fs.readFileSync("web/twin/viewer.js", "utf8");
const incidentStart = prototype.indexOf("function incidentDetailPage");
const incidentEnd = prototype.indexOf("function floorTree", incidentStart);
const incidentDetail = prototype.slice(incidentStart, incidentEnd);

test("twin importmap is registered before any modulepreload", () => {
  const html = fs.readFileSync("web/twin/index.html", "utf8");
  const map = html.indexOf("type=\"importmap\"");
  const preload = html.search(/rel=["']modulepreload["']/);
  assert.ok(map >= 0, "twin page must declare an import map");
  assert.ok(preload < 0 || map < preload, "import map must precede modulepreload or Firefox ignores it");
});

test("plan twin paints the grid immediately and fetches station GLBs concurrently", () => {
  const html = fs.readFileSync("web/twin/index.html", "utf8");
  assert.match(html, /classList\.add\(["']plan["']\)/, "plan backdrop class must apply before viewer.js");
  assert.match(html, /html\.plan/, "plan CSS must not wait on the module");
  assert.match(html, /html\.plan\s+#hud/, "HUD hide must key off html.plan, not wait for body.plan");
  assert.match(html, /#hud\s*\{[^}]*display\s*:\s*none/, "HUD is hidden until inspection; plan/part never flash the panel");
  assert.match(html, /html:not\(\.plan\)\s+#hud/, "inspection HUD must still show without viewer.js");
  assert.match(html, /html\.plan\s+#c/, "plan canvas CSS background must apply before WebGL");
  assert.match(html, /three\.core\.js/, "three.core.js must be modulepreloaded; three.module.js imports it");
  assert.match(twin, /function mapPool\s*\(/, "unique station GLBs must load through a bounded pool");
  assert.match(twin, /function kickFirstPaint\s*\(/, "WebGL must clear to the plan backdrop before GLBs arrive");
  assert.match(twin, /function startLoop\s*\(/, "the render loop must start without waiting on the line");
  assert.match(twin, /renderer\.clear\s*\(\s*\)/, "the canvas must be cleared as soon as the renderer exists");
  assert.match(
    twin,
    /setClearColor\([^;]+;\s*renderer\.setSize\([\s\S]{0,120}?false\);\s*renderer\.clear\s*\(\s*\)/,
    "WebGL buffer must be sized and cleared before the first default 300×150 paint",
  );
  assert.doesNotMatch(
    twin,
    /for\s*\(\s*const p of sceneSpec\.placements\s*\)\s*\{[\s\S]{0,400}?await mountPlacement/,
    "plan boot must not await each station GLB in scene order",
  );
  assert.match(prototype, /prefetchFloorLine|prefetchUrls/, "parent must prefetch the line GLBs for the floor iframe");
  assert.match(prototype, /three\.core\.js/, "parent prefetch must include three.core.js");
  assert.match(prototype, /fetchpriority=["']high["']/, "floor iframe is the LCP surface");
});

test("incident detail embeds an accessible Three.js inspection panel with load states", () => {
  assert.match(twin, /new\s+THREE\.WebGLRenderer\s*\(/, "existing twin must remain a real Three.js renderer");
  assert.ok(
    /<section\b[^>]*aria-labelledby=["']([^"']+)["'][^>]*>[\s\S]*?<h2\b[^>]*id=["']\1["'][^>]*>[^<]*3D inspection/i.test(prototype),
    "incident detail must expose a semantically labelled 3D inspection panel",
  );

  assert.match(incidentDetail, /data-part-mount/, "3D inspection panel must mount the shared part twin");
  assert.match(incidentDetail, /partPanel\(/, "incident inspection must reuse the Asset 360 part facts panel");
  assert.match(incidentDetail, /inspection-body/, "issue geometry and part facts must sit in one inspection body");
  assert.match(prototype, /type === ["']twin:ready["'][\s\S]{0,800}syncPart\(/, "twin:ready must send issues/light without waiting for a click");
  assert.match(prototype, /partRequest[\s\S]{0,400}\/incidents\//, "incident routes must request the part twin");
  assert.match(prototype, /view:\s*["']part["']/, "part twin must load in part mode");
  assert.match(prototype, /twinOrigin.*\/twin\//, "part frame must use the twin origin route");

  assert.match(prototype, /<[^>]+\brole=["']status["'][^>]+\baria-live=["'](?:polite|assertive)["'][^>]*>/i, "twin state must be announced accessibly");
  assert.match(prototype, /loading[^\n]{0,80}3D|3D[^\n]{0,80}loading|Loading…/i, "loading state must be visible");
  assert.match(prototype, /(?:failed|unable|unavailable)[^\n]{0,80}(?:3D|geometry)|(?:3D|geometry)[^\n]{0,80}(?:failed|unable|unavailable)/i, "failure state must be visible");
});


test("3D inspection derives named issue target from board data and hides unmapped markers", () => {
  assert.match(prototype, /demo\.snapshot\(\)/, "board data comes from fixed browser fixtures");
  assert.match(prototype, /selection\s*(?:\?\.|\.)\s*asset_id/, "target asset must use board.selection.asset_id");
  assert.match(
    prototype,
    /work_order\s*(?:\?\.|\.)\s*evidence\s*(?:\?\.|\.)\s*(?:part|component|named_part)/,
    "target component must use the work order named-part evidence",
  );
  assert.match(prototype, /location unavailable|no mapped geometry/i, "unmapped board data needs an explicit honest fallback");

  assert.ok(incidentStart >= 0 && incidentEnd > incidentStart, "incident-detail inspection source must be discoverable");
  const inspection = incidentDetail;
  assert.doesNotMatch(
    inspection,
    /\bvoxel(?:s|_id)?\b|\bcoordinates?\b|[?&](?:x|y|z|position)=|\b(?:x|y|z)\s*:\s*-?\d/i,
    "inspection targeting must not fabricate xyz, position, or voxel coordinates",
  );
  assert.match(
    inspection,
    /(?:issue-marker|data-issue-marker|\.lightPart\s*\()[\s\S]{0,500}(?:location unavailable|no mapped geometry)|(?:location unavailable|no mapped geometry)[\s\S]{0,500}(?:issue-marker|data-issue-marker|\.lightPart\s*\()/i,
    "mapped marker and marker-free fallback must share the named-geometry decision",
  );
});


test("3D inspection uses a near-white scene backdrop and non-pickable ground grid", () => {
  const backdrop = twin.match(
    /scene\.background\s*=\s*new\s+THREE\.Color\s*\(([^;]+)\);/i,
  );
  assert.ok(backdrop, "inspection backdrop must be assigned through the Three.js scene");

  const colors = [...backdrop[1].matchAll(/0x([0-9a-f]{6})/gi)].map((match) => Number.parseInt(match[1], 16));
  assert.ok(colors.length > 0, "inspection backdrop must define a concrete near-white color");
  assert.ok(
    colors.every((rgb) => [rgb >> 16 & 0xff, rgb >> 8 & 0xff, rgb & 0xff].every((channel) => channel >= 0xe0)),
    "inspection backdrop must be white or near-white",
  );

  const grid = twin.match(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+THREE\.GridHelper\s*\(/,
  );
  assert.ok(grid, "inspection floor must use Three.js GridHelper geometry");
  const gridName = grid[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    twin,
    new RegExp(`scene\\.add\\s*\\(\\s*${gridName}\\s*\\)`),
    "ground grid must be added to the Three.js scene",
  );
  assert.doesNotMatch(
    twin,
    new RegExp(`pickRoots\\.push\\s*\\(\\s*${gridName}\\s*\\)`),
    "ground grid must stay outside issue-target pick roots",
  );
  assert.match(
    twin,
    /raycaster\.intersectObjects\s*\(\s*pickRoots\s*,\s*true\s*\)/,
    "asset interaction must continue raycasting only against pick roots",
  );
});


test("3D inspection expansion and mapped issue controls are accessible by mouse and keyboard", () => {
  const styles = fs.readFileSync("web/prototype/styles.css", "utf8");
  assert.ok(incidentStart >= 0 && incidentEnd > incidentStart, "incident-detail inspection source must be discoverable");
  const inspection = incidentDetail;

  const expandButton = inspection.match(
    /<button\b(?=[^>]*\bdata-action=["'][^"']+["'])(?=[^>]*\baria-expanded=["'][^"']+["'])(?=[^>]*\baria-controls=["'][^"']+["'])[^>]*>/i,
  )?.[0];
  assert.ok(expandButton, "inspection needs a native expand/collapse button exposing aria-expanded and aria-controls");
  assert.match(
    inspection,
    /(?:expand[\s\S]{0,240}collapse|collapse[\s\S]{0,240}expand)[^<]{0,80}(?:3D\s+)?inspection/i,
    "the same visible control must identify both expand and collapse actions",
  );

  const expandAction = expandButton.match(/\bdata-action=["']([^"']+)["']/i)?.[1];
  assert.ok(expandAction, "expand control must expose an action for mouse activation");
  const escapedExpandAction = expandAction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    prototype,
    new RegExp(`action\\s*===\\s*["']${escapedExpandAction}["'][\\s\\S]{0,1200}(?:classList|updateRoute|setAttribute|showModal|requestFullscreen)`),
    "activating the expansion button must change the inspection's expanded state",
  );
  assert.match(
    prototype,
    /event\.key\s*===\s*["']Escape["'][\s\S]{0,900}(?:inspection|twin)[\s\S]{0,500}(?:collapse|close|classList|updateRoute|setAttribute)/i,
    "Escape must collapse an expanded inspection",
  );
  assert.match(
    prototype,
    new RegExp(`(?:${escapedExpandAction}[\\s\\S]{0,1400}(?:focusRestoreId|\\.focus\\s*\\()|(?:focusRestoreId|\\.focus\\s*\\()[\\s\\S]{0,1400}${escapedExpandAction})`),
    "expansion and collapse must explicitly manage focus",
  );

  const expandedRule = styles.match(/[^{}]*(?:twin|inspection)[^{}]*(?:expanded|fullscreen)[^{}]*\{[^}]*\}/i)?.[0] ?? "";
  assert.match(
    expandedRule,
    /(?:position\s*:\s*fixed|inset\s*:|width\s*:\s*(?:100%|100vw)|height\s*:\s*(?:100%|100vh))/i,
    "expanded inspection must become a substantially larger focused view",
  );

  const targetChoice = inspection.match(
    /const\s+inspectionNotice\s*=\s*mappedGeometry\s*\?\s*`([\s\S]*?)`\s*:\s*`([\s\S]*?)`\s*;/,
  );
  assert.ok(targetChoice, "mapped and unavailable issue-location states must remain explicit");
  const mappedTarget = targetChoice[1];
  const unavailableTarget = targetChoice[2];
  const targetButton = mappedTarget.match(/<button\b(?=[^>]*\bdata-action=["'][^"']+["'])[^>]*>[\s\S]*?<\/button>/i)?.[0];
  assert.ok(targetButton, "mapped named issue location must be a native clickable button");
  assert.ok(
    !/<button\b/i.test(unavailableTarget) || /<button\b[^>]*\bdisabled\b/i.test(unavailableTarget),
    "unmapped issue-location control must be absent or disabled",
  );

  const targetAction = targetButton.match(/\bdata-action=["']([^"']+)["']/i)?.[1];
  assert.ok(targetAction, "mapped issue-location button must expose an action");
  const escapedTargetAction = targetAction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    prototype,
    new RegExp(`action\\s*===\\s*["']${escapedTargetAction}["'][\\s\\S]{0,1400}(?:twin:light|postMessage).*part`),
    "activating the named-location button must tell the embedded real twin to light the mapped named component",
  );
  assert.doesNotMatch(
    inspection,
    /\bvoxel(?:s|_id)?\b|\bcoordinates?\b|[?&](?:x|y|z|position)=|\b(?:x|y|z)\s*:\s*-?\d/i,
    "inspection controls must not invent coordinates",
  );
});

test("same-origin twin embed uses app origin and a validated focus/light/ready message bridge", () => {
  assert.ok(incidentStart >= 0 && incidentEnd > incidentStart, "incident-detail inspection source must be discoverable");

  assert.ok(
    /const twinOrigin = location\.origin/.test(prototype),
    "twin URL must use the serving origin",
  );
  assert.match(prototype, /\$\{twinOrigin\}\/twin\/\?/, "part frame must use the cross-origin twin URL");
  assert.doesNotMatch(prototype, /frame\.src\s*=\s*["'][^"']*(?:127\.0\.0\.1|localhost)/i, "iframe hostname must not be hard-coded");
  assert.match(prototype, /demo\.snapshot\(\)/, "board data comes from fixed browser fixtures");

  assert.doesNotMatch(prototype, /contentWindow\s*(?:\?\.|\.)\s*__twin/, "parent must not access cross-origin iframe properties");
  assert.match(prototype, /addEventListener\s*\(\s*["']message["']/, "parent must receive twin messages");
  assert.match(prototype, /partFrameWindow\(\)|floorFrameWindow\(\)/, "parent must scope messages to known twin frames");
  assert.match(prototype, /\.origin\s*!==?\s*[A-Za-z_$][\w$]*(?:Origin|ORIGIN)/, "parent must reject messages from other origins");
  assert.match(prototype, /["']twin:ready["']/, "parent must recognize an explicit twin-ready message");
  assert.doesNotMatch(
    prototype,
    /addEventListener\s*\(\s*["']load["'][\s\S]{0,240}setTwinStatus\s*\([^)]*["']ready["']/,
    "iframe load alone must not claim that the twin is ready",
  );

  assert.match(prototype, /["']twin:light["']/, "parent must send light through the message protocol");
  assert.match(prototype, /["']twin:issues["']/, "parent must send issues through the message protocol");
  assert.match(prototype, /postMessage\s*\(/, "parent must send commands with postMessage");
  assert.match(twin, /addEventListener\s*\(\s*["']message["']/, "twin must receive parent commands");
  assert.match(twin, /\.source\s*!==?\s*(?:window\.)?parent/, "twin must reject commands from other windows");
  assert.match(twin, /\.origin\s*!==?\s*[A-Za-z_$][\w$]*(?:Origin|ORIGIN)/, "twin must reject commands from other origins");
  assert.match(twin, /typeof\s+[^\n;]*(?:asset|assetId)[^\n;]*===\s*["']string["']/i, "twin must validate focus/light asset IDs");
  assert.match(twin, /typeof\s+[^\n;]*(?:part|component)[^\n;]*===\s*["']string["']/i, "twin must validate light part names");
  assert.match(twin, /postMessage\s*\(\s*\{[^}]*["']?type["']?\s*:\s*["']twin:ready["'][^}]*\}/, "ready must be emitted by the initialized twin");

  for (const source of [prototype, twin]) {
    assert.doesNotMatch(source, /postMessage\s*\([\s\S]{0,300},\s*["']\*["']\s*\)/, "message target origin must never be a wildcard");
  }
});


test("public board uses fixtures and legacy board CORS remains restricted", async () => {
  assert.match(
    prototype,
    /demo\.snapshot\(\)/,
    "board data comes from fixed browser fixtures",
  );
  assert.match(prototype, /demo\.answer\(/, "Assist uses prepared contextual answers");

  const server = fs.readFileSync("app/server.mjs", "utf8");
  const corsModuleUrl = new URL("../app/lib/board-cors.mjs", import.meta.url);
  assert.ok(fs.existsSync(corsModuleUrl), "board CORS policy must be isolated for runtime verification");
  const { boardCorsHeaders } = await import(corsModuleUrl);
  assert.equal(typeof boardCorsHeaders, "function", "board CORS helper must export boardCorsHeaders");
  assert.match(server, /\bboardCorsHeaders\b/, "Node API must apply the verified board CORS policy");

  const headersFor = (request) => Object.fromEntries(
    Object.entries(boardCorsHeaders(request) ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const request = { method: "GET", pathname: "/api/board", host: "spark.local:8765" };
  const allowedOrigin = "http://spark.local:4173";
  const allowed = headersFor({ ...request, origin: allowedOrigin });
  assert.equal(allowed["access-control-allow-origin"], allowedOrigin);
  assert.notEqual(allowed["access-control-allow-origin"], "*");
  assert.match(allowed.vary ?? "", /(?:^|,\s*)Origin(?:\s*,|$)/i);

  for (const candidate of [
    { ...request, origin: "http://attacker.example:4173" },
    { ...request, origin: "http://spark.local:3000" },
    { ...request, method: "POST", origin: allowedOrigin },
    { ...request, pathname: "/api/health", origin: allowedOrigin },
    { ...request, origin: undefined },
  ]) {
    assert.equal(
      headersFor(candidate)["access-control-allow-origin"],
      undefined,
      "unrelated, non-read-only, and originless clients must not receive a CORS grant",
    );
  }

  const detectAllowed = headersFor({
    method: "POST",
    pathname: "/api/detect",
    host: "spark.local:8765",
    origin: allowedOrigin,
  });
  assert.equal(detectAllowed["access-control-allow-origin"], allowedOrigin, "same-host prototype may POST detect");
  assert.equal(
    headersFor({ method: "POST", pathname: "/api/detect", host: "spark.local:8765", origin: "http://attacker.example:4173" })["access-control-allow-origin"],
    undefined,
  );
  const questionsAllowed = headersFor({
    method: "POST",
    pathname: "/api/questions",
    host: "spark.local:8765",
    origin: allowedOrigin,
  });
  assert.equal(questionsAllowed["access-control-allow-origin"], allowedOrigin, "same-host prototype may POST questions");
  assert.equal(
    headersFor({ method: "POST", pathname: "/api/questions", host: "spark.local:8765", origin: "http://attacker.example:4173" })["access-control-allow-origin"],
    undefined,
  );
});

test("parent posts twin:issues from board and twin keeps issues across part:clear", () => {
  assert.match(prototype, /["']twin:issues["']/, "parent must send sqlite issues through the message protocol");
  assert.doesNotMatch(prototype, /postDetectOnce|\/api\/detect/, "public replay never creates incidents");
  assert.match(twin, /["']twin:issues["']/, "twin must listen for twin:issues");
  assert.match(twin, /issueCriticalMat|issueWarningMat|issueMat/, "twin must have a distinct issue material");
  assert.match(twin, /sensorMat/, "sensor-bound parts get a distinct neutral material");
  assert.match(twin, /sensorPartNode|rec\?\.part/, "sensor paint comes from asset-map part");
  assert.match(twin, /setIssues|issueNodes/, "twin must track issue nodes separately from selection");
  const clearIdx = twin.indexOf('type === "twin:part:clear"');
  assert.ok(clearIdx >= 0, "twin must handle twin:part:clear");
  const clearBlock = twin.slice(clearIdx, clearIdx + 120);
  assert.match(clearBlock, /highlightPart\s*\(\s*null\s*\)/, "part:clear clears selection");
  assert.doesNotMatch(clearBlock, /issueNodes\s*=\s*\[\]|setIssues\s*\(/, "part:clear must not wipe issue nodes");
  const aqIdx = twin.indexOf("function applyQueryComponent");
  assert.ok(aqIdx >= 0, "applyQueryComponent must exist");
  const aqEnd = twin.indexOf("\nfunction ", aqIdx + 1);
  const aqBlock = twin.slice(aqIdx, aqEnd > aqIdx ? aqEnd : aqIdx + 400);
  assert.match(aqBlock, /lightPart\s*\(/, "boot ?component= selects via lightPart");
  assert.doesNotMatch(aqBlock, /setIssues\s*\(/, "boot ?component= must not invent an issue");
});

test("asset 360 opens the 3D render by default", () => {
  assert.match(prototype, /function assetRenderOpen/);
  assert.match(prototype, /params\.get\(["']render["']\) !== ["']off["']/);
  assert.match(prototype, /assetRenderOpen\(getRoute\(\)\) \? ["']off["'] : null/);
  assert.match(prototype, /const renderOpen = assetRenderOpen\(route\)/);
});

test("asset 360 render stays neutral gray until the technician picks a part", () => {
  const req = prototype.split("function partRequest")[1].split("function postPartIssues")[0];
  const sync = prototype.split("function syncPart")[1].split("function handlePartMessage")[0];
  assert.doesNotMatch(req, /fleet\?\.part/, "Asset 360 must not pre-light the catalog part");
  assert.doesNotMatch(sync, /fleet\?\.part/, "sync must not fall back to the catalog part as a selection");
  assert.match(twin, /function studioMat\(/, "plan and part share a Standard gray material");
  assert.doesNotMatch(twin, /0x111111/, "v0 black is not the default or selection fill");
});

test("part twin stays on one iframe and swaps stations through twin:asset", () => {
  assert.match(prototype, /["']twin:asset["']/, "parent must swap stations without remounting the iframe");
  assert.match(twin, /["']twin:asset["']/, "twin must handle an in-place station swap");
  assert.match(twin, /function showAsset|async function showAsset/, "twin must load the requested station graph in place");
  assert.match(prototype, /partSrcKey\s*=\s*["']part["']/, "part iframe src is assigned once");
  assert.match(prototype, /prefetchTwinAssets|rel\s*=\s*["']prefetch["']/, "station GLB and Three.js must be prefetched");
});

test("3D inspection iframe targets the twin HTML document route with asset and component query", () => {
  assert.match(prototype, /function partRequest/, "part request helper must exist");
  assert.match(
    prototype,
    /new URLSearchParams\(\{\s*view:\s*["']part["'],\s*asset:\s*wanted/,
    "part frame must load twin part mode with the selected asset",
  );
  assert.match(
    prototype,
    /wantComponent[\s\S]{0,120}q\.set\(\s*["']component["']/,
    "part frame must retain the selected component query when present",
  );
  assert.match(prototype, /\$\{twinOrigin\}\/twin\/\?\$\{q\}/, "part frame must use the twin document route");
});


test("3D inspection rejects stale board geometry for a different incident target", () => {
  assert.ok(incidentStart >= 0 && incidentEnd > incidentStart, "incident-detail inspection source must be discoverable");
  const inspection = incidentDetail;
  const mappingStart = inspection.indexOf("const mappedGeometry");
  const mappingEnd = inspection.indexOf("const inspectionExpanded", mappingStart);
  assert.ok(mappingStart >= 0 && mappingEnd > mappingStart, "mapped geometry decision must be discoverable");
  const mapping = inspection.slice(mappingStart, mappingEnd);

  assert.match(
    mapping,
    /(?:inspectionAsset\s*===\s*item\.asset|item\.asset\s*===\s*inspectionAsset)/,
    "SQLite-backed target asset must exactly match the selected incident asset",
  );
  assert.match(
    mapping,
    /(?:inspectionComponent\s*===\s*item\.component|item\.component\s*===\s*inspectionComponent)/,
    "SQLite-backed named component must exactly match the selected incident component",
  );
  assert.match(
    inspection,
    /inspectionNotice\s*=\s*mappedGeometry\s*\?[\s\S]*?(?:location unavailable|no mapped geometry)/i,
    "a stale board target must render the honest unavailable state without an issue marker",
  );

  assert.match(inspection, /issue-marker/, "mapped geometry exposes an issue-marker control");
  assert.match(
    inspection,
    /mappedGeometry\s*\?\s*`[^`]*issue-marker[^`]*`\s*:\s*`[^`]*(?:location unavailable|no mapped geometry)/i,
    "unavailable geometry must not render the issue-marker control",
  );

  const actionStart = prototype.indexOf('if (action === "focus-inspection-target")');
  const actionEnd = prototype.indexOf('if (action === "view-floor")', actionStart);
  const targetAction = prototype.slice(actionStart, actionEnd);
  assert.match(
    targetAction,
    /req\?\.asset\s*&&\s*req\.component/,
    "focus-inspection-target must require a mapped asset and component",
  );
  assert.match(targetAction, /twin:light|postPartIssues/, "mapped focus must light/issue the named part");
});
