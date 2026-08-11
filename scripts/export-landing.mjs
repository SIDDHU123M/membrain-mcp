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

// ---- SEO furniture ----
const SITE = 'https://membrain.devlune.in';
// social preview image referenced by og:image
fs.copyFileSync('assets/membrain-logo.png', path.join(out, 'og.png'));
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
fs.writeFileSync(
  path.join(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod><changefreq>weekly</changefreq></url>\n</urlset>\n`,
);
// IndexNow ownership key (public by design; ping after deploy tells Bing & friends to recrawl)
const INDEXNOW_KEY = '67a3bda0791c83ecba68e251b67c4135';
fs.writeFileSync(path.join(out, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);

console.log(`site-dist/ ready: index.html + ${copied.size} assets + og/robots/sitemap/indexnow`);
