// scripts/fetch-digest.mjs — 实测并抓取当前可用源，输出可阅读的新闻摘要
// 用法: node scripts/fetch-digest.mjs [--limit 40]
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT = 9000;
const LIMIT = 12; // 每源条数

const sources = [
  // ---- 财经 ----
  { id: 'jiemian', name: '界面新闻', category: 'finance', adapter: 'rss', url: 'https://a.jiemian.com/index.php?m=article&a=rss' },
  { id: 'cls', name: '财联社', category: 'finance', adapter: 'html', url: 'https://www.cls.cn/', linkMatch: '/detail/' },
  { id: 'ifeng', name: '凤凰财经', category: 'finance', adapter: 'html', url: 'https://finance.ifeng.com/', linkMatch: '/c/' },
  { id: 'wallstreetcn', name: '华尔街见闻', category: 'finance', adapter: 'json', url: 'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=20' },
  // ---- 政策 ----
  { id: 'gov', name: '中国政府网', category: 'policy', adapter: 'html', url: 'https://www.gov.cn/zhengce/', linkMatch: 'content_', issuer: '国务院' },
  { id: 'pbc', name: '中国人民银行', category: 'policy', adapter: 'html', url: 'http://www.pbc.gov.cn/', linkMatch: '/goutongjiaoliu/', issuer: '中国人民银行' },
  { id: 'mof', name: '财政部', category: 'policy', adapter: 'html', url: 'https://www.mof.gov.cn/zhengwuxinxi/zhengcefabu/', linkMatch: '/zhengcefabu/', issuer: '财政部' },
  { id: 'csrc', name: '中国证监会', category: 'policy', adapter: 'html', url: 'http://www.csrc.gov.cn/', linkMatch: '/csrc/c', issuer: '中国证监会' },
  // ---- 国际 ----
  { id: 'xinhua_world', name: '新华网国际', category: 'world', adapter: 'html', url: 'http://www.news.cn/world/', linkMatch: '/world/' },
  { id: 'thepaper_world', name: '澎湃国际', category: 'world', adapter: 'html', url: 'https://www.thepaper.cn/channel_25951', linkMatch: 'newsDetail_forward' },
  { id: 'bbc', name: '中新网国际', category: 'world', adapter: 'rss', url: 'https://www.chinanews.com.cn/rss/world.xml' },
  // ---- 热点 ----
  { id: 'baidu', name: '百度热搜', category: 'general', adapter: 'trend', url: 'https://top.baidu.com/board?tab=realtime' },
  { id: 'chinanews', name: '中国新闻网', category: 'general', adapter: 'rss', url: 'https://www.chinanews.com.cn/rss/scroll-news.xml' },
  { id: 'thepaper', name: '澎湃新闻', category: 'general', adapter: 'html', url: 'https://www.thepaper.cn/', linkMatch: 'newsDetail_forward' },
  // ---- 杭州 ----
  { id: 'hzgov', name: '杭州市政府门户', category: 'hangzhou', adapter: 'html', url: 'https://www.hangzhou.gov.cn/', linkMatch: '/art/', issuer: '杭州市人民政府' },
  { id: 'hznews', name: '杭州网', category: 'hangzhou', adapter: 'html', url: 'https://news.hangzhou.com.cn/', linkMatch: 'content_' },
  { id: 'zjol', name: '浙江在线', category: 'hangzhou', adapter: 'html', url: 'https://zjnews.zjol.com.cn/', linkMatch: 'zjnews.zjol.com.cn/zjnews' },
];

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function decode(buf, ct = '') {
  const head = Buffer.from(buf).subarray(0, 2048).toString('latin1');
  let cs = (ct.match(/charset=([\w-]+)/i) || [])[1] || (head.match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  try { return new TextDecoder(cs.toLowerCase()).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}
const clean = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

async function get(url) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), TIMEOUT); const start = Date.now();
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ms: Date.now() - start, text: decode(buf, r.headers.get('content-type') || '') };
  } catch (e) {
    return { status: 0, ms: Date.now() - start, text: '', error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally { clearTimeout(t); }
}

function findItems(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    if ((k === 'item' || k === 'entry') && Array.isArray(v)) out.push(...v);
    else if (typeof v === 'object') findItems(v, out);
  }
  return out;
}

function parseRss(xml) {
  const data = parser.parse(xml);
  const items = findItems(data);
  return items.map(it => {
    const title = clean(it.title?.['#text'] ?? it.title);
    let link = it.link?.href ?? it.link?.['#text'] ?? it.link ?? it.guid?.['#text'] ?? it.guid ?? '';
    if (typeof link === 'object') link = link['#text'] || '';
    const date = it.pubDate || it.published || it.updated || it['dc:date'] || '';
    return { title, link: String(link).trim(), date: String(clean(date)), summary: clean(it.description || it.summary || '') };
  }).filter(x => x.title && x.link);
}

const cleanTitle = t => t.replace(/\s*\d+\s*(分钟|小时|天)前\s*$/, '').replace(/\s+/g, ' ').trim();

function absUrl(base, href) {
  try { return new URL(href, base).href; } catch { return href; }
}

function parseHtml(src, html) {
  const $ = cheerio.load(html);
  const out = []; const seen = new Set();
  $('a').each((_, el) => {
    const title = cleanTitle(clean($(el).text()));
    const href = $(el).attr('href') || '';
    if (!title || title.length < 8 || title.length > 80) return;
    if (!href || href.startsWith('javascript') || href.startsWith('#')) return;
    if (src.linkMatch && !href.includes(src.linkMatch)) return;
    const url = absUrl(src.url, href);
    if (seen.has(url) || out.some(x => x.title === title)) return;
    seen.add(url);
    out.push({ title, link: url, date: '', summary: '' });
  });
  return out;
}

function parseTrend(src, html) {
  const $ = cheerio.load(html);
  const out = []; const seen = new Set();
  $('a[href*="baidu.com/s?wd="]').each((_, el) => {
    let title = clean($(el).text()).replace(/\s*(热|新|沸|荐)$/, '');
    const href = $(el).attr('href') || '';
    if (!title || title.length < 4) return;
    const u = new URL(href, 'https://www.baidu.com');
    const url = u.href;
    if (seen.has(title)) return;
    seen.add(title);
    out.push({ title, link: url, date: '', summary: `百度热搜第 ${out.length + 1} 位` });
  });
  return out;
}

const results = [];
for (const src of sources) {
  const r = await get(src.url);
  let items = [];
  if (r.status && r.status < 400) {
    if (src.adapter === 'rss') items = parseRss(r.text);
    else if (src.adapter === 'json') {
      try {
        const j = JSON.parse(r.text);
        items = (j.data?.items || []).map(it => ({
          title: clean(it.title || it.content_text || '').slice(0, 80),
          link: it.uri || `https://wallstreetcn.com/livenews/${it.id}`,
          date: it.display_time ? new Date(it.display_time * 1000).toISOString() : '',
          summary: clean(it.content_text || '').slice(0, 120),
        })).filter(x => x.title);
      } catch (e) { r.error = 'json parse: ' + e.message; }
    } else if (src.adapter === 'trend') items = parseTrend(src, r.text);
    else items = parseHtml(src, r.text);
  }
  items = items.slice(0, LIMIT);
  const status = items.length ? 'ok' : (r.status && r.status < 400 ? 'empty' : 'fail');
  results.push({ ...src, status, http: r.status, ms: r.ms, items, error: r.error });
  console.log(`${status.toUpperCase().padEnd(5)} ${src.category.padEnd(9)} ${src.name.padEnd(12)} ${String(items.length).padStart(3)} 条 ${r.ms}ms ${r.error || ''}`);
}

const catName = { finance: '财经', policy: '政策', world: '国际', general: '热点', hangzhou: '杭州' };
const order = ['finance', 'policy', 'world', 'general', 'hangzhou'];
const now = new Date();
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now) + ' ' + new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(now);

let md = `# 热点抓取实测 · ${day}\n\n| 分类 | 源 | 状态 | 条数 | 耗时 |\n| --- | --- | --- | --- | --- |\n`;
for (const r of results) md += `| ${catName[r.category]} | ${r.name} | ${r.status} | ${r.items.length} | ${r.ms}ms |\n`;
md += '\n';
for (const c of order) {
  const list = results.filter(r => r.category === c);
  if (!list.length) continue;
  md += `## ${catName[c]}\n\n`;
  for (const r of list) {
    md += `**${r.name}**（${r.status}，${r.items.length} 条）\n\n`;
    r.items.forEach((it, i) => {
      md += `${i + 1}. [${it.title}](${it.link})${it.date ? ' · ' + it.date.slice(0, 16).replace('T', ' ') : ''}\n`;
    });
    md += '\n';
  }
}
mkdirSync('out', { recursive: true });
const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
writeFileSync(`out/digest-${stamp}.md`, md, 'utf8');
writeFileSync(`out/digest-${stamp}.json`, JSON.stringify({ at: now.toISOString(), results }, null, 2), 'utf8');
console.log(`\n输出: out/digest-${stamp}.md`);
const total = results.reduce((n, r) => n + r.items.length, 0);
console.log(`总计 ${total} 条，可用源 ${results.filter(r => r.status === 'ok').length}/${results.length}`);
