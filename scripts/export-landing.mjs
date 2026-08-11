// Bundle the landing page into a standalone static site folder (site-dist/):
// landing.html becomes index.html and only the assets it references come along.
// Drag the folder into Cloudflare Pages / Netlify, or serve it from any host.
import fs from 'node:fs';
import path from 'node:path';

const src = 'dist/ui';
const out = 'site-dist';
const html = fs.readFileSync(path.join(src, 'landing.html'), 'utf8');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

const assets = [...html.matchAll(/(?:src|href)="\.?\/(assets\/[^"]+)"/g)].map((m) => m[1]);
// fonts are loaded by the landing entry css, which itself references more assets
const queue = [...new Set(assets)];
const copied = new Set();
while (queue.length) {
  const rel = queue.shift();
  if (copied.has(rel)) continue;
  copied.add(rel);
  const file = path.join(src, rel);
  fs.copyFileSync(file, path.join(out, rel));
  if (rel.endsWith('.css') || rel.endsWith('.js')) {
    const body = fs.readFileSync(file, 'utf8');
    for (const m of body.matchAll(/url\(([^)]+\.woff2)\)|["'](\.\/)?(assets\/[^"']+)["']/g)) {
      const hit = (m[1] ?? m[3])?.replace(/^["'.\/]+/, '');
      if (hit?.startsWith('assets/')) queue.push(hit);
      else if (hit?.endsWith('.woff2')) queue.push(path.posix.join('assets', path.posix.basename(hit)));
    }
  }
}
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log(`site-dist/ ready: index.html + ${copied.size} assets`);
