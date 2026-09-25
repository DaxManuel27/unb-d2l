import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../unb-now/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let body, type;
    if (pathname === '/__preview.js') {
      body = await readFile(new URL('./unb-preview.js', import.meta.url)); type = 'text/javascript';
    } else {
      const path = resolve(root, `.${pathname === '/' ? '/panel/panel.html' : pathname}`);
      if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403).end(); return; }
      body = await readFile(path); type = types[extname(path)] ?? 'application/octet-stream';
      if (extname(path) === '.html') body = body.toString().replace('<head>', '<head><script type="module" src="/__preview.js"></script>').replace('<body>', '<body><aside style="padding:10px;text-align:center;font:13px system-ui;background:#fff5c4;color:#1f2440">Fictional UNB preview · no account access</aside>');
    }
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'" });
    response.end(body);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(4174, '127.0.0.1', () => process.stdout.write('UNB Now fictional preview: http://127.0.0.1:4174/panel/panel.html\n'));
