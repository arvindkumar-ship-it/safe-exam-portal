import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { escapeHtml, parseInlineMarkdown } from '../../../utils/sanitize.js';

const ROOT = path.resolve(__dirname, '../../../..');        // frontend/
const SRC = path.join(ROOT, 'src');
const walk = (dir, out = []) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules' && f !== 'dist') walk(p, out); } else out.push(p);
  }
  return out;
};
const prodSources = () => walk(SRC).filter((f) => /\.(js|jsx)$/.test(f) && !f.includes('__tests__') && !f.includes(`${path.sep}test${path.sep}`) && !/[\\/](testUtils|setupTests)\.jsx?$/.test(f));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); // drop comments
afterEach(() => vi.restoreAllMocks());

describe('B-24 source rules', () => {
  it('no dangerouslySetInnerHTML anywhere in production code', () => {
    const hits = prodSources().filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(strip(fs.readFileSync(f, 'utf8'))));
    expect(hits).toEqual([]);
  });

  it('no console.log/info/debug in production code; console.warn never gets tokens/answers', () => {
    for (const f of prodSources()) {
      const code = strip(fs.readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/console\.(log|info|debug)\s*\(/);
      for (const m of code.matchAll(/console\.(warn|error)\s*\(([^)]*)\)/g)) expect(m[2], f).not.toMatch(/token|answer|password|clipboard|secret/i);
    }
  });

  it('no localStorage anywhere; sessionStorage only for the A-documented refresh token in AuthProvider (tokens/answers never)', () => {
    const files = prodSources();
    const withLocal = files.filter((f) => /\blocalStorage\b/.test(strip(fs.readFileSync(f, 'utf8'))));
    expect(withLocal).toEqual([]);
    const withSession = files.filter((f) => /\bsessionStorage\b/.test(strip(fs.readFileSync(f, 'utf8'))))
      .map((f) => f.replace(/\\/g, '/'));
    expect(withSession.filter((f) => !f.endsWith('/auth/AuthProvider.jsx'))).toEqual([]);
    const auth = fs.readFileSync(files.find((f) => f.replace(/\\/g, '/').endsWith('/auth/AuthProvider.jsx')), 'utf8');
    expect(strip(auth)).not.toMatch(/(?:session|local)Storage\.setItem\([^)]*accessToken/);
  });


  it('no correctAnswer / answerKey in student-facing production sources (instructor UI is a separate lazy chunk)', () => {
    const isInstructor = (f) => /[\\/]features[\\/]instructor[\\/]/.test(f);
    const hits = prodSources().filter((f) => !isInstructor(f) && /correctAnswer|answerKey/.test(fs.readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});

describe('B-24 CSP + headers', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const nginx = fs.readFileSync(path.resolve(ROOT, '../infra/nginx.conf'), 'utf8');
  const REQUIRED = ["default-src 'self'", "connect-src 'self'", 'wss:', "img-src 'self' data:", "frame-ancestors 'none'", "object-src 'none'"];

  it('index.html has the CSP meta with every required directive', () => {
    const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
    expect(meta).not.toBeNull();
    REQUIRED.forEach((d) => expect(meta[1]).toContain(d));
    expect(meta[1]).not.toMatch(/unsafe-eval|unsafe-inline|\*\s*;|http:\/\/\*/);
  });

  it('nginx sends the same CSP as a header (frame-ancestors only works there) + hardening headers', () => {
    const header = nginx.match(/add_header Content-Security-Policy "([^"]+)"/);
    expect(header).not.toBeNull();
    REQUIRED.forEach((d) => expect(header[1]).toContain(d));
    for (const h of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Permissions-Policy']) expect(nginx).toContain(h);
    expect(nginx).toMatch(/\\.map\$\s*\{\s*return 404/);
  });

  it('docs note covers limitations and audit instructions', () => {
    const doc = fs.readFileSync(path.resolve(ROOT, '../docs/PRODUCT_B_LIMITATIONS.md'), 'utf8');
    expect(doc).toMatch(/security boundary/i);
    expect(doc).toMatch(/deterrent/i);
    expect(doc).toMatch(/npm run audit:deps/);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['audit:deps']).toMatch(/npm audit/);
    expect(pkg.scripts['verify:bundle']).toBeTruthy();
  });
});

describe('B-24 runtime: tokens never leak', () => {
  it('login keeps the ACCESS token in memory only: never written to storage, never logged', async () => {
    const SECRET = 'SECRET-ACCESS-TOKEN-xyz-123';
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { user: { id: 1, role: 'STUDENT' }, accessToken: SECRET, refreshToken: 'REFRESH-1', expiresAt: '2099-01-01T00:00:00Z' }, error: null, requestId: 'r' }) }));
    try {
      const { renderHook, act } = await import('@testing-library/react');
      const { useAuth } = await import('../../../auth/useAuth.js');
      const { default: AuthProvider } = await import('../../../auth/AuthProvider.jsx');
      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
      await act(async () => { await result.current.login('a@b.c', 'pw'); });
      expect(result.current.accessToken).toBe(SECRET);
      expect(JSON.stringify(setItem.mock.calls)).not.toContain(SECRET);
      expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(SECRET);
      for (const sp of spies) expect(JSON.stringify(sp.mock.calls)).not.toContain(SECRET);
    } finally { vi.unstubAllGlobals(); }
  });

  it('events never contain clipboard text, tokens or passwords (R5)', async () => {
    const { createEventFactory } = await import('../events/eventFactory.js');
    const e = createEventFactory({ attemptId: 'a' }).create('CLIPBOARD_ATTEMPT', { action: 'paste', text: 'copied secret', token: 'abc', password: 'pw', clipboardData: 'x' });
    expect(JSON.stringify(e)).not.toMatch(/copied secret|abc|"pw"|clipboardData/);
  });

  it('the upload failure path logs nothing sensitive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { EventQueue } = await import('../events/eventQueue.js');
    const { createMemoryStore } = await import('../events/indexedDbEventStore.js');
    const { createEventUploader } = await import('../events/eventUploader.js');
    const q = new EventQueue(createMemoryStore()); await q.init();
    await q.add({ eventType: 'CLIPBOARD_ATTEMPT', source: 'WEB_CLIENT', occurredAt: '2026-10-04T10:00:00.000Z', clientSequence: 1, metadata: { action: 'copy' } });
    const send = vi.fn().mockResolvedValue({ acknowledgedUpTo: 0, rejected: [{ clientSequence: 1, code: 'EVENT_TYPE_UNKNOWN' }] });
    await createEventUploader({ queue: q, attemptId: 'a', sendEvents: send }).flush();
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/copy|token|answer/i);
  });
});

describe('B-24 prompt rendering escapes HTML', () => {
  it('escapeHtml neutralises tags and quotes', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
  });
  it('parseInlineMarkdown only produces text/strong/code nodes (never raw HTML)', () => {
    const nodes = parseInlineMarkdown('<script>alert(1)</script> **bold** and `x<y`');
    expect(nodes.map((n) => n.type).sort()).toEqual(['code', 'strong', 'text', 'text'].sort());
    expect(nodes.find((n) => n.type === 'text').value).toContain('<script>');       // kept as inert text
    const { container } = render(<p>{nodes.map((n, i) => <span key={i}>{n.value}</span>)}</p>);
    expect(container.querySelector('script')).toBeNull();
  });
  it('handles null/undefined/unbalanced markdown safely', () => {
    expect(parseInlineMarkdown(null)).toEqual([]);
    expect(parseInlineMarkdown('**not closed')).toEqual([{ type: 'text', value: '**not closed' }]);
  });
});
