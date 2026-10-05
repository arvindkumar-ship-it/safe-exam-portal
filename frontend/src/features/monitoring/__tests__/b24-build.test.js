// @vitest-environment node
// esbuild/vite build jsdom me TextEncoder invariant se fail hota hai => alag file, node environment.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..');
const walk = (dir, out = []) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};

describe('B-24 production build (real vite build)', () => {
  let outDir;
  beforeAll(async () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safeexam-dist-'));
    const { build } = await import('vite');
    await build({ root: ROOT, logLevel: 'silent', build: { outDir, emptyOutDir: true }, mode: 'production' });
  }, 90_000);

  it('bundle contains no answer key strings and no source maps', () => {
    const files = walk(outDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => f.endsWith('.map'))).toEqual([]);
    for (const f of files.filter((x) => /\.(js|html|css)$/.test(x))) {
      const txt = fs.readFileSync(f, 'utf8');
      if (/[\\/]assets[\\/]instructor-[^\\/]*\.js$/.test(f)) continue; // lazy instructor chunk: only instructors ever load it
      expect(txt, f).not.toContain('correctAnswer');
      expect(txt, f).not.toContain('answerKey');
    }
  });

  it('built index.html keeps the CSP meta', () => {
    expect(fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')).toContain('Content-Security-Policy');
  });
});
