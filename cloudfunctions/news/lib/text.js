// cloudfunctions/news/lib/text.js
// 文本工具：去标签/实体、按字符与按 UTF-8 字节截断、URL 绝对化。
// parse.js 与 clean.js 共用，避免清洗规则两处实现。

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&mdash;': '—',
  '&middot;': '·'
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => (ENTITIES[m.toLowerCase()] !== undefined ? ENTITIES[m.toLowerCase()] : m));
}

/** 去 CDATA / 标签 / 实体，压缩空白 */
function cleanText(input) {
  let s = String(input === undefined || input === null ? '' : input);
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/\s+/g, ' ').trim();
}

/** 按字符（而非 UTF-16 码元）截断，避免破坏代理对 */
function truncate(s, max) {
  const arr = Array.from(String(s || ''));
  return arr.length <= max ? arr.join('') : arr.slice(0, max).join('');
}

/** 按 UTF-8 字节截断，且不切断多字节字符（R-03.6） */
function truncateUtf8(s, maxBytes) {
  const str = String(s || '');
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString('utf8');
}

function absolutize(base, href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, base).href;
  } catch (err) {
    return raw;
  }
}

module.exports = { decodeEntities, cleanText, truncate, truncateUtf8, absolutize };
