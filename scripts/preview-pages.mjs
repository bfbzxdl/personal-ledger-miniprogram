// scripts/preview-pages.mjs
// 用途：本机没有微信开发者工具时，用项目真实 WXSS + 真实抓取数据生成静态 HTML 预览，
//       便于检查布局与内容（非小程序运行时，样式按 390px 视口换算 rpx → px）。
// 用法：node scripts/preview-pages.mjs
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { runFetch } = require('../cloudfunctions/news/lib/pipeline.js');
const query = require('../cloudfunctions/news/lib/query.js');
const { createFakeDB } = require('../cloudfunctions/news/test/helpers/fake-db.js');
const dateUtil = require('../utils/date.js');
const { dayOf } = require('../cloudfunctions/news/lib/time.js');

const VIEWPORT = 390;
const RPX = VIEWPORT / 750; // 1rpx ≈ 0.52px

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wxss(file) {
  const raw = readFileSync(join(ROOT, file), 'utf8');
  return raw
    .replace(/(-?\d*\.?\d+)rpx/g, (m, n) => `${Math.round(Number(n) * RPX * 100) / 100}px`)
    .replace(/^page\s*\{/m, '.phone-page {');
}

const BASE_CSS = `
* { box-sizing: border-box; }
body {
  margin: 0; background: #e9ecef; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  display: flex; justify-content: center; padding: 16px 0 40px;
}
.preview-note {
  position: fixed; left: 8px; top: 8px; z-index: 10; font-size: 11px; color: #666;
  background: #fff8e1; border: 1px solid #f0d58c; border-radius: 6px; padding: 4px 8px;
}
.phone {
  width: ${VIEWPORT}px; background: #f5f5f5; position: relative; overflow: hidden;
  box-shadow: 0 8px 30px rgba(0,0,0,.12); border-radius: 18px; padding-bottom: 56px;
}
.phone-page { background: #f5f5f5; font-size: 14.56px; color: #333; }
.nav-bar {
  height: 44px; background: #07c160; color: #fff; display: flex; align-items: center;
  justify-content: center; font-size: 16px; font-weight: 600;
}
.tab-bar {
  position: absolute; bottom: 0; left: 0; right: 0; display: flex; background: #fff;
  border-top: 1px solid #e5e5e5; z-index: 9;
}
.tab-item { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 7px 0 5px; }
.tab-icon { font-size: 22.88px; line-height: 1.2; }
.tab-text { font-size: 15.6px; color: #999; margin-top: 3px; line-height: 1.2; }
.tab-item.active .tab-text { color: #07c160; font-weight: 700; }
`;

function phoneFrame(title, body, tabIndex) {
  const tabs = [
    ['🏠', '首页'],
    ['⏱️', '工时'],
    ['💰', '账簿'],
    ['🔥', '热点']
  ];
  const tabBar = `<div class="tab-bar">${tabs
    .map(
      ([icon, text], i) =>
        `<div class="tab-item ${i === tabIndex ? 'active' : ''}"><span class="tab-icon">${icon}</span><span class="tab-text">${text}</span></div>`
    )
    .join('')}</div>`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>预览 · ${esc(title)}</title>
<style>${BASE_CSS}</style>
</head>
<body>
<div class="preview-note">静态预览 · 非小程序运行时</div>
<div class="phone">
  <div class="nav-bar">${esc(title)}</div>
  <div class="phone-page">
    ${body}
  </div>
  ${tabBar}
</div>
</body></html>`;
}

function card(item, opts) {
  const o = opts || {};
  const rank = o.rank || 0;
  const tags = (item.tags || []).map((t) => `<span class="card-tag">${esc(t)}</span>`).join('');
  const cover = item.cover ? `<img class="card-cover" src="${esc(item.cover)}" alt="">` : '';
  return `<div class="news-card">
    ${rank > 0 ? `<div class="rank-badge ${rank <= 3 ? 'rank-top' : ''}">${rank}</div>` : ''}
    ${o.changeText ? `<span class="card-change change-${esc(o.changeType || '')}">${esc(o.changeText)}</span>` : ''}
    <div class="card-body">
      <div class="card-title">${esc(item.title)}</div>
      ${tags ? `<div class="card-tags">${tags}</div>` : ''}
      ${o.showSummary === false || !item.summary ? '' : `<div class="card-summary">${esc(item.summary)}</div>`}
      <div class="card-meta">
        <span class="meta-source">${esc(item.sourceName)}</span>
        ${item.publishedAt ? `<span class="meta-dot">·</span><span class="meta-time">${dateUtil.formatTimeAgo(item.publishedAt)}</span>` : ''}
        ${item.sourceCount > 1 ? `<span class="meta-hot">${item.sourceCount} 家媒体报道</span>` : ''}
      </div>
    </div>
    ${cover}
  </div>`;
}

function trendStrip(items) {
  const rows = items
    .map(
      (it) => `<div class="trend-item">
        <span class="trend-rank ${it.rank <= 3 ? 'trend-rank-top' : ''}">${it.rank}</span>
        <span class="trend-word">${esc(it.title)}</span>
      </div>`
    )
    .join('');
  return `<div class="trend">
    <div class="trend-head"><span class="trend-title">热搜榜</span><span class="trend-sub">百度实时</span></div>
    <div class="trend-list">${rows}</div>
  </div>`;
}

function segmentBar(active) {
  const segs = [
    ['today', '今日'],
    ['hot', '热榜'],
    ['search', '搜索']
  ];
  return `<div class="segment-bar">${segs
    .map(([k, label]) => `<div class="segment ${k === active ? 'segment-active' : ''}">${label}</div>`)
    .join('')}</div>`;
}

function homePage(list, trends, hot) {
  const cats = [
    ['', '热点'],
    ['finance', '财经'],
    ['policy', '政策'],
    ['world', '国际'],
    ['hangzhou', '杭州']
  ];
  return `${segmentBar('today')}
  <div class="day-bar"><span class="day-text">${dateUtil.formatDayText(dayOf(Date.now()))}</span><span class="day-more">往期 ›</span></div>
  ${trendStrip(trends.items)}
  <div class="cat-bar">${cats
    .map(([k, label]) => `<div class="cat ${k === '' ? 'cat-active' : ''}">${label}</div>`)
    .join('')}</div>
  <div class="list-head"><span class="list-total">${list.total} 条</span><span class="list-updated">${list.updatedAt ? '更新于 ' + dateUtil.formatClock(list.updatedAt) : ''}</span></div>
  ${list.items.slice(0, 8).map((it) => card(it)).join('')}
  <div class="list-footer">上拉加载更多</div>`;
}

function hotPage(hot) {
  const items = hot.items.map((it) => {
    const delta = it.delta || 0;
    const changeText =
      it.change === 'up' ? `↑${Math.abs(delta)}` : it.change === 'down' ? `↓${Math.abs(delta)}` : it.change === 'new' ? '新' : '';
    return card(it, { rank: it.rank, changeText: changeText, changeType: it.change });
  });
  return `${segmentBar('hot')}
  <div class="hot-head"><span class="hot-title">今日热榜</span><span class="hot-sub">按热度排序 · 每天 06:30 更新</span></div>
  ${items.join('')}
  <div class="list-footer">榜单来自当日全部事件的热度排序</div>`;
}

function detailPage(detail) {
  const n = detail.news;
  const tags = (n.tags || []).map((t) => `<span class="article-tag">${esc(t)}</span>`).join('');
  const policy = n.category === 'policy';
  const body = n.contentHtml
    ? `<div class="article-content">${n.contentHtml}</div>`
    : policy || n.summary
      ? `<div class="article-summary">${esc(n.summary || '该政策未提供正文，点击下方「复制原文链接」查看原文')}</div>`
      : `<div class="article-empty">该报道未提供正文，点击下方「复制原文链接」查看原文</div>`;
  const related = detail.related.slice(0, 3).map((it) => card(it, { showSummary: false })).join('');
  return `<div class="article">
    <div class="article-title">${esc(n.title)}</div>
    <div class="article-meta">
      <span class="meta-source">${esc(n.sourceName)}</span><span class="meta-dot">·</span>
      <span class="meta-time">${dateUtil.formatDateTime(n.publishedAt)}</span>
      ${n.sourceCount > 1 ? `<span class="meta-count">${n.sourceCount} 家媒体报道</span>` : ''}
    </div>
    ${tags ? `<div class="article-tags">${tags}</div>` : ''}
    ${policy && (n.issuer || n.docNo) ? `<div class="policy-box">
      ${n.issuer ? `<div class="policy-row"><span class="policy-label">发文机关</span><span class="policy-value">${esc(n.issuer)}</span></div>` : ''}
      ${n.docNo ? `<div class="policy-row"><span class="policy-label">文号</span><span class="policy-value">${esc(n.docNo)}</span></div>` : ''}
    </div>` : ''}
    ${body}
    <div class="article-actions"><div class="action-btn">复制原文链接</div></div>
  </div>
  ${related ? `<div class="related-head">同一事件的其他报道</div>${related}` : ''}`;
}

function archivePage(cal, list, day) {
  const parts = cal.month.split('-');
  const year = Number(parts[0]);
  const mon = Number(parts[1]);
  const firstWeekday = new Date(year, mon - 1, 1).getDay();
  const daysInMonth = new Date(year, mon, 0).getDate();
  let cells = '';
  for (let i = 0; i < firstWeekday; i += 1) cells += '<div class="day-cell day-empty"></div>';
  for (let d = 1; d <= daysInMonth; d += 1) {
    const dayStr = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = cal.counts[dayStr] || 0;
    const disabled = (cal.minDay && dayStr < cal.minDay) || dayStr > cal.maxDay;
    const selected = dayStr === day;
    const today = dayStr === cal.maxDay;
    cells += `<div class="day-cell ${disabled ? 'day-disabled' : ''} ${selected ? 'day-selected' : ''} ${today ? 'day-today' : ''}">
      <span class="day-label">${d}</span>
      ${count ? `<span class="day-count">${count}</span>` : '<span class="day-dot"></span>'}
    </div>`;
  }
  const week = ['日', '一', '二', '三', '四', '五', '六'].map((w) => `<span class="week-cell">${w}</span>`).join('');
  return `<div class="month-bar"><div class="month-nav">‹</div><span class="month-text">${year} 年 ${mon} 月</span><div class="month-nav month-nav-disabled">›</div></div>
  <div class="week-row">${week}</div>
  <div class="day-grid">${cells}</div>
  <div class="list-head"><span class="list-total">${dateUtil.formatDayText(day)} · ${list.total} 条</span><span class="list-hint">只读回看</span></div>
  ${list.items.slice(0, 4).map((it) => card(it)).join('')}`;
}

const db = createFakeDB();
console.log('抓取中（19 源，约 15s）…');
const t0 = Date.now();
const run = await runFetch(db, { now: Date.now() });
const day = dayOf(Date.now());
const list = await query.listNews(db, { day });
const trends = await query.getTrends(db, { day });
const hot = await query.getHot(db, { day });
const firstId = list.items[0] && list.items[0].id;
const detail = firstId ? await query.getNews(db, { id: firstId }) : { news: {}, related: [] };
const cal = await query.getCalendar(db, { month: day.slice(0, 7) });
const dayList = await query.listNews(db, { day });

const css = [
  wxss('app.wxss'),
  wxss('pages/news/home/index.wxss'),
  wxss('pages/news/detail/index.wxss'),
  wxss('pages/news/archive/index.wxss'),
  wxss('components/news-card/index.wxss'),
  wxss('components/trend-strip/index.wxss')
].join('\n');

const pages = [
  { name: 'home', title: '热点', body: homePage(list, trends, hot) },
  { name: 'hot', title: '热点', body: hotPage(hot) },
  { name: 'detail', title: '详情', body: detailPage(detail) },
  { name: 'archive', title: '归档', body: archivePage(cal, dayList, day) }
];

const outDir = join(ROOT, 'out', 'preview');
mkdirSync(outDir, { recursive: true });
for (const p of pages) {
  const html = phoneFrame(p.title, p.body, 3).replace('</style>', `${css}</style>`);
  writeFileSync(join(outDir, `${p.name}.html`), html, 'utf8');
}

// 供真机/开发者工具注入使用：与云函数返回结构一致的数据快照
const dump = {
  generatedAt: new Date().toISOString(),
  day,
  list,
  trends,
  hot,
  detail,
  archive: { calendar: cal, items: dayList.items, total: dayList.total }
};
writeFileSync(join(outDir, 'data.json'), JSON.stringify(dump, null, 2), 'utf8');

console.log(`抓取完成：${run.added} 条 / ${run.clusters} 事件 / ${Date.now() - t0}ms`);
console.log(`列表 ${list.total} 条，热搜 ${trends.items.length} 条，热榜 ${hot.items.length} 条，详情 ${detail.news ? detail.news.title.slice(0, 20) : '无'}`);
console.log(`预览已生成：${outDir}`);
