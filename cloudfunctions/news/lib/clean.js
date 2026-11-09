// cloudfunctions/news/lib/clean.js
// T-05 清洗（R-03）+ NewsItem 组装 + 政策元信息（R-15）。
const { C } = require('./const');
const { dayOf } = require('./time');
const { cleanText, truncate, truncateUtf8 } = require('./text');
const cheerio = require('cheerio');

// R-03.1 HTML 白名单
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'b', 'i', 'blockquote', 'ul', 'ol', 'li', 'h2', 'h3', 'img', 'a'
]);
// 连同内容一起删除的标签
const DROP_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'noscript', 'svg', 'video', 'audio', 'link', 'meta', 'textarea', 'select'
];

const DOC_NO_PATTERNS = [/〔\d{4}〕\d+号/, /第\d+号/];

// 列表页常带的形态前缀（人社局等站点）：图片 | 标题 / 动态 | 标题
const TITLE_PREFIX_RE = /^(图片|动态|视频|图集|专题)\s*[|｜]\s*/;
// 标题尾部日期：… 2026-11-03
const TITLE_DATE_SUFFIX_RE = /\s*\d{4}-\d{2}-\d{2}\s*$/;

/** 标题展示清洗：去列表页形态前缀、尾部日期与「N 评」等站点噪声 */
function normalizeTitleText(title) {
  return String(title || '')
    .replace(TITLE_PREFIX_RE, '')
    .replace(TITLE_DATE_SUFFIX_RE, '')
    // 凤凰财经等站点会在标题尾部拼「11-09 19:40 0评」
    .replace(/\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}.*$/, '')
    .replace(/(?<![\d-])\s*\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}.*$/, '')
    .replace(/\s*\d+\s*评\s*$/, '')
    .trim();
}

/** 源级前缀清洗（如澎湃列表的「推荐」）：只在剩余标题足够长时剥离，避免误伤正常词 */
function stripSourcePrefix(title, prefixes) {
  let text = String(title || '');
  for (const prefix of prefixes || []) {
    const p = String(prefix || '');
    if (p && text.startsWith(p) && Array.from(text).length > Array.from(p).length + 6) {
      text = text.slice(p.length).trim();
    }
  }
  return text;
}

/** R-15.2：从标题提取文号，失败返回空串 */
function extractDocNo(title) {
  const s = String(title || '');
  for (const re of DOC_NO_PATTERNS) {
    const m = s.match(re);
    if (m) return m[0];
  }
  return '';
}

/** R-03：HTML 白名单清洗（去脚本/事件/样式/非法链接） */
function sanitizeHtml(html) {
  const src = String(html === undefined || html === null ? '' : html);
  if (!src.trim()) return '';

  const $ = cheerio.load(src, null, false);
  $(DROP_TAGS.join(',')).remove();

  // 非白名单标签：保留子节点、去掉标签本身
  const unwrap = [];
  $('*').each((_, el) => {
    if (!ALLOWED_TAGS.has(el.tagName)) unwrap.push(el);
  });
  for (const el of unwrap) {
    $(el).replaceWith($(el).contents());
  }

  // 属性白名单：a 只留 href/title，img 只留 src/alt/title，其余全删
  const nodes = $('*').toArray();
  for (const el of nodes) {
    const tag = el.tagName;
    const attrs = Object.keys(el.attribs || {});
    for (const name of attrs) {
      const allowed =
        (tag === 'a' && (name === 'href' || name === 'title')) ||
        (tag === 'img' && (name === 'src' || name === 'alt' || name === 'title'));
      if (!allowed) {
        $(el).removeAttr(name);
        continue;
      }
      const value = String(el.attribs[name] || '');
      if (name === 'href' && /^\s*javascript:/i.test(value)) {
        $(el).removeAttr('href');
      } else if (name === 'src' && !/^https?:\/\//i.test(value)) {
        // R-03.3：非 http(s) 图片整条删除
        $(el).remove();
        break;
      }
    }
  }

  return $.html();
}

/** R-03.4/5/6：组装入库文档（字段见 docs/API.md §2.1） */
function buildNewsItem(raw, source, options) {
  const opts = options || {};
  const now = opts.now === undefined ? Date.now() : opts.now;
  const title = truncate(
    stripSourcePrefix(normalizeTitleText(cleanText(raw.title)), source.titleStrip),
    C.TITLE_MAX
  );
  if (!title) return null;

  const isTrend = Boolean(raw.isTrend) || source.kind === 'trend';
  const isPolicy = source.category === 'policy';
  const rawHtml = raw.contentHtml || raw.content_html || '';
  const contentHtml = truncateUtf8(sanitizeHtml(rawHtml), C.CONTENT_MAX_BYTES);
  const summary = truncate(raw.summary || cleanText(rawHtml), C.SUMMARY_MAX);

  const publishedAt = raw.publishedAt ? new Date(raw.publishedAt) : new Date(now);

  return {
    title: title,
    url: String(raw.url || ''),
    source_id: source.id,
    source_name: source.name || '',
    category: source.category,
    published_at: publishedAt,
    fetched_at: new Date(now),
    day: dayOf(now),
    summary: summary,
    // D-03：政策类不抓详情正文
    content_html: isPolicy ? '' : contentHtml,
    cover: raw.cover || '',
    event_id: '',
    hot_score: 0,
    is_trend: isTrend,
    rank: typeof raw.rank === 'number' ? raw.rank : undefined,
    hot_value: typeof raw.hotValue === 'number' ? raw.hotValue : undefined,
    tags: [],
    issuer: isPolicy ? source.issuer || '' : '',
    doc_no: isPolicy ? extractDocNo(title) : '',
    // 以下为内部字段，不入库（pipeline 负责剔除）
    stale: Boolean(raw.stale),
    source_weight: typeof source.weight === 'number' ? source.weight : 1
  };
}

/** 批量清洗；空标题条目丢弃 */
function cleanItems(items, source, options) {
  const out = [];
  for (const it of items || []) {
    const doc = buildNewsItem(it, source, options);
    if (doc) out.push(doc);
  }
  return out;
}

module.exports = {
  ALLOWED_TAGS,
  DROP_TAGS,
  extractDocNo,
  normalizeTitleText,
  stripSourcePrefix,
  sanitizeHtml,
  buildNewsItem,
  cleanItems
};
