const ALLOWED = new Set(["/api/board", "/api/detect", "/api/incidents", "/api/hops/latest", "/api/demo/inject", "/api/questions"]);

function sameHostPrototype({ host, origin }) {
  if (!host || !origin) return null;
  try {
    const requestHost = new URL(`http://${host}`).hostname;
    const source = new URL(origin);
    const webOrigin = source.protocol === "http:" || source.protocol === "https:";
    if (!webOrigin || source.origin !== origin || source.hostname !== requestHost || source.port !== "4173") return null;
    return origin;
  } catch {
    return null;
  }
}

export function boardCorsHeaders({ method, pathname, host, origin }) {
  if (!ALLOWED.has(pathname)) return {};
  if (method === "OPTIONS") {
    const allowedOrigin = sameHostPrototype({ host, origin });
    if (!allowedOrigin) return {};
    return {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    };
  }
  const allowedOrigin = sameHostPrototype({ host, origin });
  if (!allowedOrigin) return {};
  if (pathname === "/api/board" && method === "GET") return { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" };
  if (pathname === "/api/detect" && method === "POST") return { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" };
  if (pathname === "/api/incidents" && method === "GET") return { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" };
  if (pathname === "/api/hops/latest" && method === "GET") return { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" };
  if (pathname === "/api/demo/inject" && method === "POST") return { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" };
  if (pathname === "/api/questions" && method === "POST") return { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" };
  return {};
}
