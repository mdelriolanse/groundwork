import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const port = Number(process.argv[2] || 4181);
const root = new URL("../web/prototype/", import.meta.url).pathname;
const backend = new URL("http://127.0.0.1:8765");
const mime = {
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function proxy(request, response) {
  const rewriteTwinViewer = request.url?.startsWith("/twin/viewer.js");
  const upstream = http.request({
    hostname: backend.hostname,
    port: backend.port,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: backend.host },
  }, upstreamResponse => {
    if (rewriteTwinViewer) {
      const chunks = [];
      upstreamResponse.on("data", chunk => chunks.push(chunk));
      upstreamResponse.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8").replace(
          "const parentOrigin = `${location.protocol}//${location.hostname}:4173`;",
          "const parentOrigin = location.origin;",
        );
        const headers = { ...upstreamResponse.headers, "content-length": Buffer.byteLength(body) };
        delete headers["content-encoding"];
        response.writeHead(upstreamResponse.statusCode || 502, headers);
        response.end(body);
      });
      return;
    }
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", error => {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: `preview proxy: ${error.message}` }));
  });
  request.pipe(upstream);
}

http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/twin/")) {
    proxy(request, response);
    return;
  }
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const file = normalize(join(root, relative));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": mime[extname(file).toLowerCase()] || "application/octet-stream",
  });
  createReadStream(file).pipe(response);
}).listen(port, "0.0.0.0", () => {
  process.stdout.write(`Incident UI lab listening on http://0.0.0.0:${port}\n`);
});
