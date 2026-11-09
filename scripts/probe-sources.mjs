// scripts/probe-sources.mjs — 逐个实测源可用性，输出 JSON 报告
// 用法: node scripts/probe-sources.mjs [--rsshub URL] [--out path]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const RSSHUB = arg('--rsshub', process.env.RSSHUB_BASE || 'https://rsshub.app');
const OUT = arg('--out', 'out/source-probe.json');
const TIMEOUT = 8000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sources = [
  { id: 'jiemian', name: '界面新闻', category: 'finance', adapter: 'rss', url: 'https://a.jiemian.com/index.php?m=article&a=rss' },
  { id: 'yicai', name: '第一财经', category: 'finance', adapter: 'rsshub', path: '/firstory' },
  { id: 'caixin', name: '财新', category: 'finance', adapter: 'rss', url: null },
  { id: 'wallstreetcn', name: '华尔街见闻', category: 'finance', adapter: 'rsshub', path: '/wallstreetcn/news/global' },
  { id: 'gov_cn', name: '中国政府网·政策', category: 'policy', adapter: 'html', url: 'https://www.gov.cn/zhengce/' },
  { id: 'pbc', name: '中国人民银行', category: 'policy', adapter: 'html', url: 'http://www.pbc.gov.cn/' },
  { id: 'mof', name: '财政部', category: 'policy', adapter: 'html', url: 'https://www.mof.gov.cn/' },
  { id: 'csrc', name: '中国证监会', category: 'policy', adapter: 'html', url: 'http://www.csrc.gov.cn/' },
  { id: 'bbc_zh', name: 'BBC 中文', category: 'world', adapter: 'rss', url: 'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml' },
  { id: 'nyt_zh', name: '纽约时报中文网', category: 'world', adapter: 'rss', url: 'https://cn.nytimes.com/rss/' },
  { id: 'zaobao', name: '联合早报', category: 'world', adapter: 'rss', url: null },
  { id: 'weibo_hot', name: '微博热搜', category: 'general', adapter: 'rsshub', path: '/weibo/search/hot' },
  { id: 'zhihu_hot', name: '知乎热榜', category: 'general', adapter: 'rsshub', path: '/zhihu/hotlist' },
  { id: 'thepaper', name: '澎湃新闻', category: 'general', adapter: 'rsshub', path: '/thepaper/featured' },
  { id: 'chinanews', name: '中国新闻网', category: 'general', adapter: 'rss', url: null },
  { id: 'hz_publish', name: '杭州发布', category: 'hangzhou', adapter: 'rsshub', path: '/wechat/hzfb' },
  { id: 'hz_gov', name: '杭州市政府门户', category: 'hangzhou', adapter: 'html', url: 'https://www.hangzhou.gov.cn/' },
  { id: 'hz_daily', name: '杭州日报', category: 'hangzhou', adapter: 'html', url: 'https://hzdaily.hangzhou.com.cn/' },
  { id: 'dskb', name: '都市快报', category: 'hangzhou', adapter: 'html', url: 'https://hzdaily.hangzhou.com.cn/dskb/' },
];

function decode(buf, contentType = '') {
  const head = Buffer.from(buf).subarray(0, 2048).toString('latin1');
  let charset = (contentType.match(/charset=([\w-]+)/i) || [])[1]
    || (head.match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  charset = charset.toLowerCase();
  try { return new TextDecoder(charset).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

function strip(s = '') {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = strip((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    let link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1]
      || strip((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
    const date = strip((b.match(/<(pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2] || '');
    if (title) items.push({ title, link, date });
  }
  return items;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow' });
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, text: decode(buf, res.headers.get('content-type') || ''), bytes: buf.length };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: e.name === 'AbortError' ? 'timeout' : e.message, text: '' };
  } finally { clearTimeout(timer); }
}

async function probe(src) {
  const url = src.adapter === 'rsshub' ? RSSHUB + src.path : src.url;
  if (!url) return { ...src, url, status: 'todo', reason: 'URL 未确定' };
  const r = await fetchText(url);
  if (!r.ok) return { ...src, url, status: 'fail', http: r.status, ms: r.ms, reason: r.error || `HTTP ${r.status}` };
  if (src.adapter === 'html') {
    const title = strip((r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const anchors = (r.text.match(/<a\s[^>]*href=/gi) || []).length;
    return { ...src, url, status: 'ok', http: r.status, ms: r.ms, bytes: r.bytes, pageTitle: title, anchors };
  }
  const items = parseFeed(r.text);
  return { ...src, url, status: items.length ? 'ok' : 'empty', http: r.status, ms: r.ms, bytes: r.bytes, count: items.length, sample: items.slice(0, 5) };
}

const results = [];
for (const s of sources) {
  const r = await probe(s);
  results.push(r);
  const flag = r.status === 'ok' ? 'OK  ' : r.status.toUpperCase();
  console.log(`${flag} ${r.category.padEnd(9)} ${r.name.padEnd(14)} ${String(r.count ?? r.anchors ?? '').padStart(3)}  ${r.ms ?? ''}ms ${r.reason || ''}`);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ rsshub: RSSHUB, at: new Date().toISOString(), results }, null, 2), 'utf8');
console.log(`\n报告: ${OUT}`);
const ok = results.filter(r => r.status === 'ok').length;
console.log(`可用 ${ok}/${results.length}`);
