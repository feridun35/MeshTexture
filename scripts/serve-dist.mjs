// Serves ./dist with the same headers Vercel applies from dist/vercel.json,
// so the Content-Security-Policy can be tested locally before deploying.
//   node scripts/serve-dist.mjs  ->  http://127.0.0.1:4173
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = Number(process.env.PORT) || 4173;

if (!existsSync(join(DIST, 'index.html'))) {
    console.error('dist/ not found — run "npm run build:dist" first.');
    process.exit(1);
}

const { headers: headerRules = [] } = JSON.parse(readFileSync(join(DIST, 'vercel.json'), 'utf8'));

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml',
};

createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = normalize(join(DIST, pathname));
    if (!file.startsWith(DIST)) {
        res.writeHead(403).end();
        return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');

    for (const rule of headerRules) {
        if (new RegExp(`^${rule.source}$`).test(pathname)) {
            for (const { key, value } of rule.headers) res.setHeader(key, value);
        }
    }

    if (!existsSync(file)) {
        res.writeHead(404).end('Not found');
        return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => {
    console.log(`Serving dist/ with production headers at http://127.0.0.1:${PORT}`);
});
