// cloudfunctions/news/lib/parse.js
// T-04：四种源适配器（rss / json / html / trend），输出统一的内部条目结构。
// 内部结构（T-05/T-06 再映射为 NewsItem）：
//   { title, url, publishedAt:number|null, summary, rank?:number, hotValue?:number, isTrend:boolean, stale:boolean }
const { C } = require('./const');
const { isBeforeToday } = require('./time');
const { cleanText, truncate, absolutize } = require('./text');
const { XMLParser } = require('fast-xml-parser');
const cheerio = require('cheerio');

const xmlParser = new XMLParser({ ignoreAttributes: false, trimValues: true });

/** 取 XML 节点的原始文本（保留标签，供后续清洗正文） */
function nodeRaw(node) {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeRaw).join(' ');
  if (typeof node === 'object' && node['#text'] !== undefined) return String(node['#text']);
  return '';
}

/** 取 XML 节点的纯文本（兼容 {#text} / 对象 / 数组） */
function nodeText(node) {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(' ');
  if (typeof node === 'object') {
    if (node['#text'] !== undefined) return String(node['#text']);
    if (node._ !== undefined) return String(node._);
    if (node.href !== undefined) return String(node.href);
  }
  return '';
}

/** 从 URL 里的日期片段猜发布时间（仅用于 stale 判定） */
function guessDateFromUrl(url) {
  const s = String(url || '');
  let m = s.match(/\/(20\d{2})[-_/]?(\d{2})[-_/]?(\d{2})\//);
  if (!m) m = s.match(/[?&](?:date|time)=?(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const ms = Date.parse(`${y}-${pad(mo)}-${pad(d)}T00:00:00+08:00`);
  return Number.isNaN(ms) ? null : ms;
}

function toMs(value) {
  if (!value) return null;
  if (typeof value === 'number') {
    // 10 位按秒处理
    return value < 1e12 ? value * 1000 : value;
  }
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : ms;
}

/** 统一收尾：清洗标题/摘要、补链接、判定 stale、按源上限截断 */
function normalize(raw, source, now) {
  const title = truncate(cleanText(raw.title), C.TITLE_MAX);
  if (!title) return null;

  const url = absolutize(source.url, raw.url);
  if (!url) return null;

  const publishedAt = toMs(raw.publishedAt) || guessDateFromUrl(url) || null;
  const isTrend = source.kind === 'trend' || source.adapter === 'trend';

  return {
    title,
    url,
    publishedAt,
    summary: truncate(cleanText(raw.summary), C.SUMMARY_MAX),
    contentHtml: String(raw.contentHtml || ''),
    rank: typeof raw.rank === 'number' ? raw.rank : undefined,
    hotValue: typeof raw.hotValue === 'number' ? raw.hotValue : undefined,
    isTrend,
    stale: isTrend ? false : isBeforeToday(publishedAt, now)
  };
}

/** 递归找出所有 item / entry 节点（兼容 RSS 2.0 / Atom / RDF；单条时也是对象） */
function collectXmlItems(node, out) {
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'item' || k === 'entry') {
      if (Array.isArray(v)) out.push(...v);
      else if (v && typeof v === 'object') out.push(v);
    } else if (v && typeof v === 'object') {
      collectXmlItems(v, out);
    }
  }
  return out;
}

function parseRss(text, source, now) {
  const data = xmlParser.parse(text);
  const nodes = collectXmlItems(data, []);
  return nodes
    .map((it) => {
      const link =
        nodeText(it.link) ||
        (it.link && it.link['@_href']) ||
        nodeText(it.guid) ||
        '';
      const desc = it.description || it.summary || it['content:encoded'] || '';
      return normalize(
        {
          title: nodeText(it.title),
          url: link,
          publishedAt: it.pubDate || it.published || it.updated || it['dc:date'] || it.date || null,
          summary: nodeText(desc),
          contentHtml: nodeRaw(desc)
        },
        source,
        now
      );
    })
    .filter(Boolean);
}

function parseJson(text, source, now) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    const e = new Error('invalid json');
    e.code = 'E_SOURCE';
    throw e;
  }
  const list =
    (json && json.data && (json.data.items || json.data.list)) ||
    (json && (json.items || json.list)) ||
    [];

  return list
    .map((it) => {
      const uri = it.uri || it.url || (it.id ? 'https://wallstreetcn.com/livenews/' + it.id : '');
      const body = it.content_text || it.content || '';
      return normalize(
        {
          title: it.title || it.name || '',
          url: uri,
          publishedAt: it.display_time || it.published_at || it.time || null,
          summary: body || it.summary || '',
          contentHtml: body
        },
        source,
        now
      );
    })
    .filter(Boolean);
}

function parseHtml(text, source, now) {
  const $ = cheerio.load(text);
  const out = [];
  const seenUrl = new Set();
  const seenTitle = new Set();

  $('a').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return;
    if (source.linkMatch && !href.includes(source.linkMatch)) return;

    // 部分站点的标题带「3 分钟前」之类的时间后缀
    const title = cleanText($a.text()).replace(/\s*\d+\s*(分钟|小时|天)前\s*$/, '').trim();
    if (title.length < 8 || title.length > 80) return;

    const url = absolutize(source.url, href);
    if (seenUrl.has(url) || seenTitle.has(title)) return;
    seenUrl.add(url);
    seenTitle.add(title);

    const item = normalize({ title, url, publishedAt: null, summary: '' }, source, now);
    if (item) out.push(item);
  });

  return out;
}

function parseTrend(text, source, now) {
  const $ = cheerio.load(text);
  const out = [];
  const seen = new Set();
  let rank = 0;

  const pick = (selector) => {
    $(selector).each((_, el) => {
      const $a = $(el);
      const title = cleanText($a.text())
        .replace(/\s*(热|新|沸|荐)\s*$/, '')
        .trim();
      if (!title || title.length < 4) return;
      if (/查看更多|更多$|^更多/.test(title)) return;
      if (seen.has(title)) return;
      seen.add(title);
      rank += 1;
      const item = normalize(
        {
          title,
          url: absolutize('https://www.baidu.com', $a.attr('href') || ''),
          publishedAt: null,
          summary: '',
          rank
        },
        source,
        now
      );
      if (item) out.push(item);
    });
  };

  pick('a[href*="baidu.com/s?wd="]');
  if (out.length === 0) pick('a[href*="wd="]');
  return out;
}

const ADAPTERS = { rss: parseRss, json: parseJson, html: parseHtml, trend: parseTrend };

/**
 * 解析单个源。
 * @returns {{items:Array, adapter:string}} items 已清洗、去重、截断到 MAX_ITEMS_PER_SOURCE
 */
function parseSource(source, text, options) {
  const opts = options || {};
  const now = opts.now === undefined ? Date.now() : opts.now;
  const adapter = ADAPTERS[source.adapter] || parseHtml;
  const items = adapter(String(text || ''), source, now);

  const deduped = [];
  const seen = new Set();
  for (const it of items) {
    const key = it.url;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
    if (deduped.length >= C.MAX_ITEMS_PER_SOURCE) break;
  }

  return { items: deduped, adapter: source.adapter };
}

module.exports = {
  ADAPTERS,
  cleanText,
  truncate,
  absolutize,
  guessDateFromUrl,
  toMs,
  normalize,
  parseSource,
  parseRss,
  parseJson,
  parseHtml,
  parseTrend
};
