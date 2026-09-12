export function boardCorsHeaders({ method, pathname, host, origin }) {
  if (method !== "GET" || pathname !== "/api/board" || !host || !origin) return {};

  try {
    const requestHost = new URL(`http://${host}`).hostname;
    const source = new URL(origin);
    const webOrigin = source.protocol === "http:" || source.protocol === "https:";
    if (!webOrigin || source.origin !== origin || source.hostname !== requestHost || source.port !== "4173") return {};
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  } catch {
    return {};
  }
}
