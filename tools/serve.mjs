// Локальный статический сервер: нужен только для проверки перед публикацией.
// Никакой логики здесь нет — отдаёт файлы проекта.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootArg = process.argv[2] || '.';
const port = Number(process.argv[3] || 8081);
const root = resolve(here, '..', rootArg);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const full = normalize(join(root, path));
    if (!full.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(full);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: `${url.pathname}/` }).end();
      return;
    }
    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`404: ${req.url}`);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Сервер: http://127.0.0.1:${port}/`);
  console.log(`Корень: ${root}`);
});
