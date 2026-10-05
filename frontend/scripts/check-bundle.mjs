// `npm run build && npm run verify:bundle` — answer key bundle me nahi hona chahiye.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = ['correctAnswer', 'answerKey'];
const hits = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/[\\/]assets[\\/]instructor-[^\\/]*\.js$/.test(p)) { /* lazy instructor chunk: sirf instructors load karte hain */ }
    else if (/\.(js|html|css)$/.test(f)) {
      const txt = readFileSync(p, 'utf8');
      FORBIDDEN.forEach((w) => { if (txt.includes(w)) hits.push(`${p}: ${w}`); });
    } else if (f.endsWith('.map')) hits.push(`${p}: source map present`);
  }
};
walk('dist');
if (hits.length) { console.error('Bundle check FAILED\n' + hits.join('\n')); process.exit(1); }
console.log('Bundle check OK');
