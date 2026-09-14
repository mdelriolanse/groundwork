export function lineStatus(hops, board, recordedHop, recordedFlag) {
  const live = hops?.live === true && Boolean(hops.latest);
  const assets = live ? hops.assets : recordedHop?.assets;
  const flags = live ? (board?.fleet || []).filter(asset => asset.flag).map(asset => asset.asset_id) : [recordedFlag?.asset_id].filter(Boolean);
  return {
    running: Object.entries(assets || {}).filter(([, asset]) => asset.busy === true || asset.busy === 1).map(([id]) => id),
    flagged: flags,
  };
}
