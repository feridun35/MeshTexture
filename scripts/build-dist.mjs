// Builds the production bundle into ./dist — used by CI (deploy.yml) and locally.
//   node scripts/build-dist.mjs              -> plain copy (fast, for local testing)
//   node scripts/build-dist.mjs --obfuscate  -> same output as production
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const OBFUSCATE = process.argv.includes('--obfuscate');

// Performance-critical files are shipped without obfuscation.
const SKIP_OBFUSCATION = new Set([
    'displacement.worker.js',
    'decimation.js',
    'subdivision.js',
    'displacement.js',
    'mapping.js',
    'textureEngine.js',
]);

const OBFUSCATOR_OPTIONS = {
    target: 'browser-no-eval', // keeps the output compatible with a CSP without 'unsafe-eval'
    compact: true,
    selfDefending: true,
    controlFlowFlattening: true,
    deadCodeInjection: true,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    splitStrings: true,
};

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 1. JS + CSS from src/ (flattened into dist/)
const obfuscator = OBFUSCATE ? (await import('javascript-obfuscator')).default : null;
for (const file of readdirSync(SRC)) {
    const from = join(SRC, file);
    const to = join(DIST, file);
    if (file.endsWith('.js') && obfuscator && !SKIP_OBFUSCATION.has(file)) {
        const code = readFileSync(from, 'utf8');
        writeFileSync(to, obfuscator.obfuscate(code, OBFUSCATOR_OPTIONS).getObfuscatedCode());
    } else if (file.endsWith('.js') || file.endsWith('.css')) {
        cpSync(from, to);
    }
}

// 2. Static folders
cpSync(join(ROOT, 'assets'), join(DIST, 'assets'), { recursive: true });
cpSync(join(ROOT, 'vendor'), join(DIST, 'vendor'), { recursive: true });

// 3. index.html with src/ paths rewritten to the flattened layout
const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
    .replaceAll('src="src/', 'src="./')
    .replaceAll('src="./src/', 'src="./')
    .replaceAll('href="src/', 'href="./');
writeFileSync(join(DIST, 'index.html'), html);

// 4. vercel.json with a Content-Security-Policy that allows exactly the inline
//    scripts in index.html (by hash), so editing them never silently breaks the site.
const inlineScriptHashes = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .filter(([, attrs = '']) => !/\ssrc=/.test(attrs) && !/type="application\/ld\+json"/.test(attrs))
    .map(([, , body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);

const csp = [
    "default-src 'self'",
    `script-src 'self' https://cdnjs.buymeacoffee.com ${inlineScriptHashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
].join('; ');

// Only the headers are carried over; build settings stay as configured in the Vercel project.
const { headers } = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
headers.find((h) => h.source === '/(.*)').headers.push({ key: 'Content-Security-Policy', value: csp });
writeFileSync(join(DIST, 'vercel.json'), JSON.stringify({ headers }, null, 2));

console.log(`dist/ ready (${OBFUSCATE ? 'obfuscated' : 'not obfuscated'}, ${inlineScriptHashes.length} inline script hashes in CSP)`);
