import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
const config = JSON.parse(fs.readFileSync('.vercel/output/config.json'));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ttf':'font/ttf', '.woff2':'font/woff2', '.glb':'model/gltf-binary', '.txt':'text/plain' };
http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  const headers = { ...config.routes[0].headers, 'Cache-Control': 'no-store' };
  if (!url.startsWith('/twin/')) Object.assign(headers, config.routes[1].headers);
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, headers).end(); return; }
  if (url === '/') url = '/landing/index.html';
  else if (/^\/(landing|prototype|twin)\/?$/.test(url)) url = url.replace(/\/$/, '') + '/index.html';
  let file = path.resolve(root, '.' + url), status = 200;
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { file = path.join(root, '404.html'); status = 404; }
  res.writeHead(status, { ...headers, 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT || 8678), '127.0.0.1', () => console.log('Static demo preview ready'));
