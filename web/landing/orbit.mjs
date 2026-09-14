export const CONCEPT_ASSETS = Object.freeze(["PP1", "RPP1", "T1"]);

export function placementFor(scene, assetId) {
  if (!CONCEPT_ASSETS.includes(assetId)) return null;
  const placement = scene?.placements?.find((row) => row.asset_id === assetId && row.kind === "station");
  if (!placement?.file) return null;
  return { asset_id: placement.asset_id, file: placement.file };
}

export function isolateFiles(scene, assetId) {
  const placement = placementFor(scene, assetId);
  return placement ? [placement.file] : [];
}

export function shouldAutoOrbit(reducedMotion) {
  return reducedMotion !== true;
}

// Negative top means the scroll stage has passed its starting position.
export function focusProgress(top, travel, reducedMotion) {
  return reducedMotion ? 1 : Math.max(0, Math.min(1, -top / Math.max(travel, 1)));
}
