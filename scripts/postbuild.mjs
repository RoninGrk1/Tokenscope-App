// Static-host helpers for GitHub Pages:
//  - 404.html = SPA fallback so any deep link (/scan/..., /is/...-safe) boots the app.
//  - Pre-rendered /is/<slug>-safe/ and app routes return HTTP 200 with SEO titles.
//  - sitemap.xml + robots.txt.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const SITE = process.env.SITE_URL ?? 'https://roningrk1.github.io/Tokenscope-App';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const src = readFileSync(new URL('../shared/popular.ts', import.meta.url), 'utf8');
const popular = [...src.matchAll(/slug: '([^']+)', chain: '([^']+)', address: '[^']+', symbol: '([^']+)', name: '([^']+)'/g)].map((m) => ({ slug: m[1], chain: m[2], symbol: m[3], name: m[4] }));

const page = (title, desc) => html
  .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
  .replace(/(<meta name="description" content=")[^"]*/, `$1${desc}`)
  .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`);

function write(route, content) { const dir = join(dist, route); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'index.html'), content); }

writeFileSync(join(dist, '404.html'), html);
const routes = ['/', '/compare', '/launches', '/pricing', '/checkout', '/api', '/terms', '/privacy', '/refunds'];
for (const r of routes.slice(1)) write(r, html);
for (const p of popular) {
  const route = `/is/${p.slug}-safe`;
  write(route, page(`Is ${p.symbol} safe? ${p.name} risk scan · Tokenscope`, `Free automated risk scan for ${p.name} (${p.symbol}) on ${p.chain}: honeypot, tax, owner powers, liquidity and holder concentration.`));
  routes.push(route);
}
writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes.map((r) => `  <url><loc>${SITE}${r === '/' ? '/' : r + '/'}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(dist, '.nojekyll'), '');
console.log(`postbuild: 404.html, ${routes.length} routes, sitemap.xml (${popular.length} token pages)`);
