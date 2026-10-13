import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The site is hosted as plain static files on Cloudflare Pages: free and unlimited.
// Server code (Pages Functions / Workers) is billed per request, so it must never sneak in.
test('no server code: the site stays purely static', () => {
  for (const p of ['functions', 'public/_worker.js', 'public/functions', 'wrangler.toml', 'wrangler.json'])
    assert.ok(!fs.existsSync(p), `${p} would add billable server code; keep the site static (see docs/HOSTING.md)`);
  // A Workers static-assets deploy is allowed: asset requests are free as long as no script runs ("main").
  if (fs.existsSync('wrangler.jsonc')) {
    const config = fs.readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/"main"\s*:/.test(config), 'wrangler.jsonc must stay assets-only (no "main" script)');
    assert.match(config, /"assets"\s*:/);
  }
});

// Free-plan limits: 20,000 files per site and 25 MiB per file. Keep a safety margin.
test('static output stays inside free hosting limits', () => {
  let files = 0, largest = {size: 0, file: ''};
  const walk = dir => { for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else { files++; const {size} = fs.statSync(p); if (size > largest.size) largest = {size, file: p}; }
  } };
  walk('public');
  assert.ok(files < 18000, `public/ has ${files} files; move city data to object storage before 20,000 (docs/HOSTING.md)`);
  assert.ok(largest.size < 24 * 1024 * 1024, `${largest.file} is ${(largest.size / 1048576).toFixed(1)} MB; files must stay under 25 MiB`);
});
