const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// Question prompt ke liye safe mini-markdown: **bold** aur `code`. HTML kabhi nahi; React nodes me text hi jata hai.
export function parseInlineMarkdown(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  const src = String(text ?? '');
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ type: 'text', value: src.slice(last, m.index) });
    const tok = m[0];
    out.push(tok.startsWith('**') ? { type: 'strong', value: tok.slice(2, -2) } : { type: 'code', value: tok.slice(1, -1) });
    last = m.index + tok.length;
  }
  if (last < src.length) out.push({ type: 'text', value: src.slice(last) });
  return out;
}
