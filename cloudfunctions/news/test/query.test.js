// cloudfunctions/news/test/query.test.js
// T-08 验收：R-08 首页列表、R-09 热搜。
const test = require('node:test');
const assert = require('node:assert');

const query = require('../lib/query');
const { C } = require('../lib/const');
const { dayOf } = require('../lib/time');
const { createFakeDB } = require('./helpers/fake-db');
const { route } = require('../index');

const DAY = dayOf(Date.now());
const HOUR = 3600000;
const NOW = Date.now();

async function seedNews(db) {
  const col = db.collection('news');
  const rows = [
    { title: '财经热点 A', category: 'finance', hot_score: 90, published_at: new Date(NOW - 1 * HOUR), tags: [] },
    { title: '政策热点 B', category: 'policy', hot_score: 80, published_at: new Date(NOW - 2 * HOUR), tags: ['补贴消费券'] },
    { title: '杭州惠民 C', category: 'hangzhou', hot_score: 70, published_at: new Date(NOW - 3 * HOUR), tags: ['公积金', '住房'] },
    { title: '国际热点 D', category: 'world', hot_score: 60, published_at: new Date(NOW - 4 * HOUR), tags: [] },
    { title: '综合热点 E', category: 'general', hot_score: 50, published_at: new Date(NOW - 5 * HOUR), tags: [] }
  ];
  for (const row of rows) {
    await col.add({
      data: Object.assign(
        {
          day: DAY,
          is_trend: false,
          is_primary: true,
          summary: '摘要',
          source_name: '测试源',
          source_count: 1,
          fetched_at: new Date(NOW - 30 * 60000)
        },
        row
      )
    });
  }
  // 热搜 12 条（只取前 10）
  for (let i = 1; i <= 12; i += 1) {
    await col.add({
      data: {
        day: DAY,
        is_trend: true,
        is_primary: true,
        rank: i,
        title: '热搜词 ' + i,
        url: 'https://www.baidu.com/s?wd=' + i,
        hot_value: 1000 - i,
        published_at: new Date(NOW - i * 60000),
        fetched_at: new Date(NOW),
        tags: []
      }
    });
  }
  // 昨日数据，不应出现在默认列表
  await col.add({
    data: {
      day: '2026-01-01',
      is_trend: false,
      title: '历史新闻',
      category: 'general',
      hot_score: 99,
      published_at: new Date('2026-01-01T10:00:00+08:00'),
      tags: []
    }
  });
}

test('R-08：默认只返回当天、非 trend 条目，按热度降序', async () => {
  const db = createFakeDB();
  await seedNews(db);
  const res = await query.listNews(db, {});
  assert.strictEqual(res.day, DAY);
  assert.strictEqual(res.items.length, 5);
  assert.deepStrictEqual(res.items.map((i) => i.title), [
    '财经热点 A', '政策热点 B', '杭州惠民 C', '国际热点 D', '综合热点 E'
  ]);
  assert.ok(res.items.every((i) => i.id));
  assert.ok(res.items.every((i) => typeof i.publishedAt === 'number' && i.publishedAt > 0));
  assert.strictEqual(res.total, 5);
  assert.strictEqual(res.hasMore, false);
  assert.ok(res.updatedAt > 0);
});

test('R-08.2/3：指定分类按发布时间倒序，且只返回该分类', async () => {
  const db = createFakeDB();
  await seedNews(db);
  const res = await query.listNews(db, { category: 'hangzhou' });
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].title, '杭州惠民 C');
  assert.deepStrictEqual(res.items[0].tags, ['公积金', '住房']);
});

test('R-08.4：分页 PAGE_SIZE，返回 total 与 hasMore，页间不重复', async () => {
  const db = createFakeDB();
  await seedNews(db);
  const p1 = await query.listNews(db, { pageSize: 2, page: 1 });
  const p2 = await query.listNews(db, { pageSize: 2, page: 2 });
  assert.strictEqual(p1.items.length, 2);
  assert.strictEqual(p1.hasMore, true);
  assert.strictEqual(p2.hasMore, true);
  const ids = p1.items.concat(p2.items).map((i) => i.id);
  assert.strictEqual(new Set(ids).size, 4, '两页不应有重复条目');

  const p3 = await query.listNews(db, { pageSize: 2, page: 3 });
  assert.strictEqual(p3.items.length, 1);
  assert.strictEqual(p3.hasMore, false);
});

test('pageSize 超过上限时截断到 PAGE_SIZE_MAX', async () => {
  const db = createFakeDB();
  await seedNews(db);
  const res = await query.listNews(db, { pageSize: 999 });
  assert.strictEqual(res.pageSize, C.PAGE_SIZE_MAX);
});

test('标签筛选只返回命中条目（R-14 前端筛选依赖）', async () => {
  const db = createFakeDB();
  await seedNews(db);
  const res = await query.listNews(db, { tag: '公积金' });
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].title, '杭州惠民 C');
});

test('D-16：同一事件只返回代表条目，total 按去重后统计', async () => {
  const db = createFakeDB();
  const base = {
    day: DAY,
    is_trend: false,
    category: 'finance',
    summary: '',
    source_name: '源',
    hot_score: 70,
    published_at: new Date(NOW - 3600000),
    fetched_at: new Date(NOW),
    tags: []
  };
  await db.collection('news').add({
    data: Object.assign({}, base, { title: '同一事件（代表条目）', event_id: 'ev-x', is_primary: true, url_hash: 'p1' })
  });
  await db.collection('news').add({
    data: Object.assign({}, base, { title: '同一事件（其他源）', event_id: 'ev-x', is_primary: false, url_hash: 'p2' })
  });
  await db.collection('news').add({
    data: Object.assign({}, base, { title: '另一个事件', event_id: 'ev-y', is_primary: true, url_hash: 'p3' })
  });

  const res = await query.listNews(db, { day: DAY });
  assert.strictEqual(res.total, 2, '两条事件，而不是三条新闻');
  assert.deepStrictEqual(res.items.map((i) => i.title).sort(), ['另一个事件', '同一事件（代表条目）']);
  assert.ok(!res.items.some((i) => i.title === '同一事件（其他源）'));
});

test('非法 day / category 抛 E_PARAM（R-18 静默回退默认值）', async () => {
  const db = createFakeDB();
  await assert.rejects(() => query.listNews(db, { day: '2026/11/08' }), (err) => err.code === 'E_PARAM');
  await assert.rejects(() => query.listNews(db, { category: 'sports' }), (err) => err.code === 'E_PARAM');
});

test('R-09：热搜按 rank 升序、最多 TREND_SHOW_N 条', async () => {
  const db = createFakeDB();
  await seedNews(db);
  const res = await query.getTrends(db, {});
  assert.strictEqual(res.items.length, C.TREND_SHOW_N);
  assert.deepStrictEqual(res.items.map((i) => i.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.strictEqual(res.items[0].title, '热搜词 1');
  assert.strictEqual(res.items[0].hotValue, 999);
  assert.ok(res.items[0].url.startsWith('https://www.baidu.com/s?wd='));
});

test('无热搜数据时返回空数组（前端整块隐藏）', async () => {
  const db = createFakeDB();
  const res = await query.getTrends(db, {});
  assert.deepStrictEqual(res.items, []);
});

test('route：listNews / getTrends 走统一 ok 包装，参数错误返回 E_PARAM', async () => {
  const db = createFakeDB();
  await seedNews(db);
  const list = await route({ action: 'listNews', pageSize: 2 }, { db });
  assert.strictEqual(list.ok, true);
  assert.strictEqual(list.data.items.length, 2);

  const trends = await route({ action: 'getTrends' }, { db });
  assert.strictEqual(trends.ok, true);
  assert.strictEqual(trends.data.items.length, 10);

  const bad = await route({ action: 'listNews', category: 'nope' }, { db });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error.code, 'E_PARAM');
});

async function seedHot(db) {
  const newsCol = db.collection('news');
  const ids = [];
  for (let i = 1; i <= 12; i += 1) {
    const res = await newsCol.add({
      data: {
        day: DAY,
        is_trend: false,
        is_primary: true,
        title: '热榜条目 ' + i,
        category: 'general',
        summary: '摘要 ' + i,
        source_name: '测试源',
        source_count: i === 1 ? 3 : 1,
        hot_score: 100 - i,
        published_at: new Date(NOW - i * 60000),
        fetched_at: new Date(NOW),
        tags: []
      }
    });
    ids.push(res._id);
  }
  const hotCol = db.collection('daily_hot');
  const changes = ['new', 'up', 'down', 'same'];
  for (let rank = 1; rank <= 12; rank += 1) {
    await hotCol.add({
      data: {
        date: DAY,
        rank: rank,
        news_id: ids[rank - 1],
        event_id: 'ev-' + rank,
        hot_score: 100 - rank,
        prev_rank: rank > 1 ? rank + 1 : null,
        change: changes[(rank - 1) % changes.length],
        delta: rank > 1 ? -1 : 0
      }
    });
  }
  return ids;
}

test('R-07：getHot 按 rank 返回 Top10，带 change/delta/hotScore', async () => {
  const db = createFakeDB();
  await seedHot(db);
  const res = await query.getHot(db, {});
  assert.strictEqual(res.day, DAY);
  assert.strictEqual(res.items.length, C.TOP_N);
  assert.deepStrictEqual(res.items.map((i) => i.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.strictEqual(res.items[0].title, '热榜条目 1');
  assert.strictEqual(res.items[0].change, 'new');
  assert.strictEqual(res.items[0].delta, 0);
  assert.strictEqual(res.items[1].change, 'up');
  assert.strictEqual(res.items[1].delta, -1);
  assert.strictEqual(res.items[0].hotScore, 99);
  assert.strictEqual(res.items[0].sourceCount, 3);
});

test('R-07.4：无当日快照返回空数组', async () => {
  const db = createFakeDB();
  const res = await query.getHot(db, {});
  assert.deepStrictEqual(res.items, []);
  assert.strictEqual(res.day, DAY);
});

test('getHot：快照指向的 news 缺失时跳过该行，不报错', async () => {
  const db = createFakeDB();
  await db.collection('daily_hot').add({
    data: { date: DAY, rank: 1, news_id: 'missing-id', event_id: 'e', hot_score: 90, change: 'new', delta: 0 }
  });
  const res = await query.getHot(db, {});
  assert.deepStrictEqual(res.items, []);
});

test('route：getHot 返回 ok 包装', async () => {
  const db = createFakeDB();
  await seedHot(db);
  const res = await route({ action: 'getHot' }, { db });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.data.items.length, 10);
  assert.strictEqual(res.data.items[2].change, 'down');
  assert.ok(res.data.items[0].publishedAt > 0);
});

async function seedSearch(db) {
  const col = db.collection('news');
  const base = {
    is_trend: false,
    is_primary: true,
    category: 'hangzhou',
    source_name: '测试源',
    fetched_at: new Date(NOW),
    tags: []
  };
  const rows = [
    { title: '杭州公积金新政发布', summary: '租房提取额度上调', published_at: new Date(NOW - 1 * 3600000) },
    { title: '本周财经回顾', summary: '涉及公积金利率的变化', published_at: new Date(NOW - 2 * 3600000) },
    { title: '十天前的公积金消息', summary: '', published_at: new Date(NOW - 10 * 86400000) },
    { title: '一百天前的公积金旧闻', summary: '', published_at: new Date(NOW - 100 * 86400000) },
    { title: 'A.B 公司公告', summary: '无关内容', published_at: new Date(NOW - 3 * 3600000) },
    { title: 'AXB 公司公告', summary: '无关内容', published_at: new Date(NOW - 3 * 3600000) }
  ];
  for (const row of rows) {
    await col.add({ data: Object.assign({}, base, row, { day: dayOf(row.published_at.getTime()) }) });
  }
}

test('R-11：标题或摘要命中关键词，默认 30d 按时间倒序', async () => {
  const db = createFakeDB();
  await seedSearch(db);
  const res = await query.searchNews(db, { keyword: '公积金' });
  assert.deepStrictEqual(res.items.map((i) => i.title), ['杭州公积金新政发布', '本周财经回顾', '十天前的公积金消息']);
  assert.strictEqual(res.total, 3);
  assert.strictEqual(res.range, '30d');
  assert.strictEqual(res.keyword, '公积金');
});

test('R-11.3：7d 比 30d 严格，结果数量单调不减（7d ⊆ 30d ⊆ all）', async () => {
  const db = createFakeDB();
  await seedSearch(db);
  const d7 = await query.searchNews(db, { keyword: '公积金', range: '7d' });
  const d30 = await query.searchNews(db, { keyword: '公积金', range: '30d' });
  const all = await query.searchNews(db, { keyword: '公积金', range: 'all' });
  assert.strictEqual(d7.total, 2);
  assert.strictEqual(d30.total, 3, '30 天内应包含 10 天前的条目');
  assert.strictEqual(all.total, 3, 'all 上限 90 天，100 天前的不返回');
  assert.ok(!all.items.some((i) => i.title.includes('一百天前')));
  assert.ok(d7.total <= d30.total && d30.total <= all.total);
});

test('R-11.2：关键词按字面匹配（正则元字符被转义）', async () => {
  const db = createFakeDB();
  await seedSearch(db);
  const res = await query.searchNews(db, { keyword: 'A.B' });
  assert.strictEqual(res.total, 1);
  assert.strictEqual(res.items[0].title, 'A.B 公司公告');
});

test('R-11.5：空关键词返回 E_PARAM；无结果返回空数组', async () => {
  const db = createFakeDB();
  await seedSearch(db);
  await assert.rejects(() => query.searchNews(db, { keyword: '   ' }), (err) => err.code === 'E_PARAM');
  const empty = await query.searchNews(db, { keyword: '不存在的词' });
  assert.deepStrictEqual(empty.items, []);
  assert.strictEqual(empty.total, 0);
});

test('搜索分页：page 递增不重复，hasMore 正确', async () => {
  const db = createFakeDB();
  await seedSearch(db);
  const p1 = await query.searchNews(db, { keyword: '公积金', pageSize: 2, page: 1 });
  const p2 = await query.searchNews(db, { keyword: '公积金', pageSize: 2, page: 2 });
  assert.strictEqual(p1.items.length, 2);
  assert.strictEqual(p1.hasMore, true);
  const ids = p1.items.concat(p2.items).map((i) => i.id);
  assert.strictEqual(new Set(ids).size, 3);
  assert.strictEqual(p2.items.length, 1);
  assert.strictEqual(p2.hasMore, false);
});

test('route：search 走统一 ok 包装，空关键词 E_PARAM', async () => {
  const db = createFakeDB();
  await seedSearch(db);
  const ok = await route({ action: 'search', keyword: '公积金' }, { db });
  assert.strictEqual(ok.ok, true);
  assert.ok(ok.data.items.length >= 2);

  const bad = await route({ action: 'search', keyword: '' }, { db });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error.code, 'E_PARAM');
});

async function seedDetail(db) {
  const col = db.collection('news');
  const base = {
    day: DAY,
    is_trend: false,
    is_primary: true,
    category: 'finance',
    summary: '摘要',
    fetched_at: new Date(NOW),
    tags: [],
    hot_score: 70,
    content_html: '<p>正文内容</p>'
  };
  const main = await col.add({
    data: Object.assign({}, base, {
      title: '主报道标题',
      url: 'https://example.com/main',
      event_id: 'ev-1',
      source_name: '主源',
      source_weight: 1,
      published_at: new Date(NOW - 3600000)
    })
  });
  const weights = [0.9, 0.7, 0.5, 0.3, 0.2];
  for (let i = 0; i < weights.length; i += 1) {
    await col.add({
      data: Object.assign({}, base, {
        title: '相关报道 ' + (i + 1),
        url: 'https://example.com/rel-' + i,
        event_id: 'ev-1',
        source_name: '源 ' + i,
        source_weight: weights[i],
        published_at: new Date(NOW - (i + 2) * 3600000)
      })
    });
  }
  await col.add({
    data: Object.assign({}, base, {
      title: '无关事件',
      url: 'https://example.com/other',
      event_id: 'ev-2',
      source_name: '其他源',
      source_weight: 0.8,
      published_at: new Date(NOW - 3600000)
    })
  });
  return main._id;
}

test('R-10：详情返回 NewsDetail 字段，related 同事件按权重降序、最多 5 条', async () => {
  const db = createFakeDB();
  const id = await seedDetail(db);
  const res = await query.getNews(db, { id: id });

  assert.strictEqual(res.news.id, id);
  assert.strictEqual(res.news.title, '主报道标题');
  assert.strictEqual(res.news.url, 'https://example.com/main');
  assert.strictEqual(res.news.contentHtml, '<p>正文内容</p>');
  assert.strictEqual(res.news.eventId, 'ev-1');
  assert.ok(res.news.fetchedAt > 0);
  assert.strictEqual(res.news.sourceName, '主源');

  assert.strictEqual(res.related.length, C.RELATED_MAX);
  assert.deepStrictEqual(res.related.map((r) => r.title), ['相关报道 1', '相关报道 2', '相关报道 3', '相关报道 4', '相关报道 5']);
  assert.ok(res.related.every((r) => r.id !== id), 'related 不含自身');
  assert.ok(!res.related.some((r) => r.title === '无关事件'), '不跨事件');
});

test('R-10：不存在返回 E_NOT_FOUND，缺 id 返回 E_PARAM', async () => {
  const db = createFakeDB();
  await assert.rejects(() => query.getNews(db, { id: 'nope' }), (err) => err.code === 'E_NOT_FOUND');
  await assert.rejects(() => query.getNews(db, {}), (err) => err.code === 'E_PARAM');
});

test('R-10/R-15：政策条目正文为空时返回空串，带机关与文号', async () => {
  const db = createFakeDB();
  const added = await db.collection('news').add({
    data: {
      day: DAY,
      is_trend: false,
      category: 'policy',
      title: '关于印发《办法》的通知（国办发〔2026〕12号）',
      url: 'https://www.gov.cn/zhengce/x.htm',
      content_html: '',
      summary: '政策摘要',
      issuer: '国务院',
      doc_no: '〔2026〕12号',
      source_name: '中国政府网',
      published_at: new Date(NOW - 3600000),
      fetched_at: new Date(NOW),
      tags: []
    }
  });
  const res = await query.getNews(db, { id: added._id });
  assert.strictEqual(res.news.contentHtml, '');
  assert.strictEqual(res.news.issuer, '国务院');
  assert.strictEqual(res.news.docNo, '〔2026〕12号');
  assert.strictEqual(res.news.summary, '政策摘要');
  assert.deepStrictEqual(res.related, []);
});

test('route：getNews 返回 ok 包装，缺失条目返回 E_NOT_FOUND', async () => {
  const db = createFakeDB();
  const id = await seedDetail(db);
  const ok = await route({ action: 'getNews', id: id }, { db });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.data.news.id, id);

  const missing = await route({ action: 'getNews', id: 'ghost' }, { db });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.error.code, 'E_NOT_FOUND');
});

function daysAgo(n) {
  return dayOf(Date.now() - n * 86400000);
}

async function seedCalendar(db) {
  const col = db.collection('news');
  const rows = [
    { day: daysAgo(1), is_trend: false, is_primary: true },
    { day: daysAgo(1), is_trend: false, is_primary: true },
    { day: daysAgo(3), is_trend: false, is_primary: true },
    { day: daysAgo(3), is_trend: true, is_primary: true },
    { day: daysAgo(95), is_trend: false, is_primary: true }
  ];
  for (const row of rows) {
    await col.add({
      data: Object.assign({ title: '标题 ' + Math.random(), url: 'https://e.com/' + Math.random() }, row)
    });
  }
}

test('R-12：getCalendar 返回当月有数据的日期与条数，trend 不计数', async () => {
  const db = createFakeDB();
  await seedCalendar(db);
  const month = daysAgo(1).slice(0, 7);
  const res = await query.getCalendar(db, { month: month });

  assert.strictEqual(res.month, month);
  const d1 = daysAgo(1);
  const d3 = daysAgo(3);
  if (d1.slice(0, 7) === month) assert.strictEqual(res.counts[d1], 2);
  if (d3.slice(0, 7) === month) assert.strictEqual(res.counts[d3], 1, 'trend 不计入归档条数');
  assert.ok(res.days.length >= 1);
  assert.deepStrictEqual(res.days, res.days.slice().sort());
  assert.ok(res.minDay < res.maxDay);
});

test('R-12.3：超出 90 天窗口的日期不返回，minDay 为窗口起点', async () => {
  const db = createFakeDB();
  await seedCalendar(db);
  const oldMonth = daysAgo(95).slice(0, 7);
  const res = await query.getCalendar(db, { month: oldMonth });
  assert.deepStrictEqual(res.days, []);
  assert.ok(!res.counts[daysAgo(95)]);
  assert.strictEqual(res.minDay, daysAgo(90));
});

test('getCalendar：非法 month 返回 E_PARAM；缺省取当月', async () => {
  const db = createFakeDB();
  await assert.rejects(() => query.getCalendar(db, { month: '2026/11' }), (err) => err.code === 'E_PARAM');
  const res = await query.getCalendar(db, {});
  assert.strictEqual(res.month, dayOf(Date.now()).slice(0, 7));
});

test('route：getCalendar 返回 ok 包装', async () => {
  const db = createFakeDB();
  await seedCalendar(db);
  const res = await route({ action: 'getCalendar', month: daysAgo(1).slice(0, 7) }, { db });
  assert.strictEqual(res.ok, true);
  assert.ok(Array.isArray(res.data.days));
});

test('R-18：今天无数据且 fallback=true 时回退到昨日，并标记 fallback', async () => {
  const db = createFakeDB();
  const today = dayOf(Date.now());
  const yesterday = daysAgo(1);
  await db.collection('news').add({
    data: {
      day: yesterday,
      is_trend: false,
      is_primary: true,
      title: '昨天的新闻',
      category: 'general',
      summary: '',
      source_name: '源',
      hot_score: 60,
      published_at: new Date(NOW - 30 * 3600000),
      fetched_at: new Date(NOW - 29 * 3600000),
      tags: []
    }
  });

  const strict = await query.listNews(db, { day: today });
  assert.strictEqual(strict.total, 0, '默认不回退（R-08）');
  assert.strictEqual(strict.fallback, false);

  const withFallback = await query.listNews(db, { day: today, fallback: true });
  assert.strictEqual(withFallback.total, 1);
  assert.strictEqual(withFallback.day, yesterday);
  assert.strictEqual(withFallback.fallback, true);
  assert.strictEqual(withFallback.requestedDay, today);
  assert.ok(withFallback.updatedAt > 0);
});

test('R-18：请求历史日期时不回退', async () => {
  const db = createFakeDB();
  const res = await query.listNews(db, { day: daysAgo(5), fallback: true });
  assert.strictEqual(res.total, 0);
  assert.strictEqual(res.fallback, false);
});

test('R-17：track 写入 events_log，缺 event 返回 E_PARAM', async () => {
  const db = createFakeDB();
  const res = await query.trackEvent(db, {
    event: 'home_view',
    page: 'pages/news/home/index',
    payload: { segment: 'today' }
  });
  assert.strictEqual(res.event, 'home_view');
  const rows = db.__dump('events_log');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].event, 'home_view');
  assert.strictEqual(rows[0].page, 'pages/news/home/index');
  assert.deepStrictEqual(rows[0].payload, { segment: 'today' });
  assert.ok(rows[0].ts instanceof Date);

  await assert.rejects(() => query.trackEvent(db, {}), (err) => err.code === 'E_PARAM');
});

test('route：track 走统一 ok 包装', async () => {
  const db = createFakeDB();
  const res = await route({ action: 'track', event: 'card_click', payload: { id: 'n1' } }, { db });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.data.event, 'card_click');
  assert.strictEqual(db.__size('events_log'), 1);
});

