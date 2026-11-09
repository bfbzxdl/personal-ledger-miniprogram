// cloudfunctions/news/lib/query.js
// T-08 起的查询动作：列表 / 热搜（后续 T-09~T-12 在此追加 getHot / search / getNews / getCalendar）。
const { C, CATEGORIES, ERR } = require('./const');
const { dayOf } = require('./time');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function paramError(message) {
  const err = new Error(message);
  err.code = ERR.PARAM;
  return err;
}

function msOf(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

/** 文档 → API §3.2 NewsItem（时间统一毫秒） */
function toNewsItem(doc) {
  const item = {
    id: doc._id,
    title: doc.title,
    sourceName: doc.source_name,
    category: doc.category,
    publishedAt: msOf(doc.published_at),
    summary: doc.summary || '',
    tags: doc.tags || [],
    sourceCount: doc.source_count || 1,
    hotScore: doc.hot_score || 0
  };
  if (doc.cover) item.cover = doc.cover;
  if (doc.issuer) item.issuer = doc.issuer;
  if (doc.doc_no) item.docNo = doc.doc_no;
  return item;
}

function normalizeDay(day) {
  if (day === undefined || day === null || day === '') return dayOf(Date.now());
  const value = String(day);
  if (!DAY_RE.test(value)) throw paramError('day must be YYYY-MM-DD');
  return value;
}

function normalizePage(value, fallback, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return max ? Math.min(n, max) : n;
}

/** 单日列表查询（R-08）；listNews 在其上做 R-18 的昨日兜底 */
async function listForDay(db, day, page, pageSize, category, tag) {
  // D-16：只出「事件代表条目」，同一事件在列表里只出现一次
  const where = { day: day, is_trend: false, is_primary: true };
  if (category) where.category = category;
  if (tag) where.tags = db.command.all([String(tag)]);

  const col = db.collection('news');
  const counted = await col.where(where).count();
  const total = counted.total || 0;

  let query = col.where(where);
  // R-08.3：全部分类按热度；指定分类按时间
  query = category
    ? query.orderBy('published_at', 'desc')
    : query.orderBy('hot_score', 'desc').orderBy('published_at', 'desc');

  const res = await query
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  let updatedAt = 0;
  try {
    const latest = await col.where({ day: day }).orderBy('fetched_at', 'desc').limit(1).get();
    if (latest.data && latest.data[0]) updatedAt = msOf(latest.data[0].fetched_at);
  } catch (err) {
    updatedAt = 0;
  }

  return {
    items: (res.data || []).map(toNewsItem),
    total: total,
    hasMore: page * pageSize < total,
    day: day,
    updatedAt: updatedAt,
    page: page,
    pageSize: pageSize
  };
}

/**
 * R-08 首页列表。
 * R-18 兜底：仅当请求的是「今天」且今天无数据、且 fallback=true 时，回退到最近 3 天内有数据的一天。
 */
async function listNews(db, params) {
  const p = params || {};
  const day = normalizeDay(p.day);
  const page = normalizePage(p.page, 1);
  const pageSize = Math.min(C.PAGE_SIZE_MAX, normalizePage(p.pageSize, C.PAGE_SIZE));

  let category = p.category;
  if (category === undefined || category === null || category === '') category = null;
  if (category && CATEGORIES.indexOf(category) === -1) throw paramError('unknown category');
  const tag = p.tag ? String(p.tag) : '';

  const first = await listForDay(db, day, page, pageSize, category, tag);
  if (first.total > 0 || p.fallback !== true || day !== dayOf(Date.now())) {
    first.fallback = false;
    return first;
  }

  for (let back = 1; back <= 3; back += 1) {
    const prev = dayOf(Date.now() - back * 86400000);
    const candidate = await listForDay(db, prev, page, pageSize, category, tag);
    if (candidate.total > 0) {
      candidate.fallback = true;
      candidate.requestedDay = day;
      return candidate;
    }
  }

  first.fallback = false;
  return first;
}

/** R-09 热搜：按 rank 升序取前 TREND_SHOW_N 条 */
async function getTrends(db, params) {
  const p = params || {};
  const day = normalizeDay(p.day);
  const res = await db
    .collection('news')
    .where({ day: day, is_trend: true })
    .orderBy('rank', 'asc')
    .limit(C.TREND_SHOW_N)
    .get();

  return {
    day: day,
    items: (res.data || []).map((doc) => {
      const item = {
        rank: doc.rank,
        title: doc.title,
        url: doc.url
      };
      if (typeof doc.hot_value === 'number') item.hotValue = doc.hot_value;
      return item;
    })
  };
}

/** R-07 热榜：读当日快照 daily_hot，join news 后返回 HotItem */
async function getHot(db, params) {
  const p = params || {};
  const day = normalizeDay(p.day);

  const rows = await db
    .collection('daily_hot')
    .where({ date: day })
    .orderBy('rank', 'asc')
    .limit(C.TOP_N)
    .get();

  const list = rows.data || [];
  if (!list.length) return { day: day, items: [] };

  const ids = list.map((row) => row.news_id).filter(Boolean);
  const newsMap = new Map();
  if (ids.length) {
    const res = await db
      .collection('news')
      .where({ _id: db.command.in(ids) })
      .get();
    for (const doc of res.data || []) newsMap.set(doc._id, doc);
  }

  const items = [];
  for (const row of list) {
    const doc = newsMap.get(row.news_id);
    if (!doc) continue;
    const item = toNewsItem(doc);
    item.rank = row.rank;
    item.change = row.change || 'new';
    item.delta = typeof row.delta === 'number' ? row.delta : 0;
    item.hotScore = typeof row.hot_score === 'number' ? row.hot_score : item.hotScore;
    items.push(item);
  }

  return { day: day, items: items };
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const RANGES = { '7d': 7, '30d': 30, all: 0 };

/** R-11 搜索：标题或摘要包含关键词，按发布时间倒序分页 */
async function searchNews(db, params) {
  const p = params || {};
  const keyword = String(p.keyword === undefined || p.keyword === null ? '' : p.keyword).trim();
  if (!keyword) throw paramError('keyword is required');

  const range = RANGES[p.range] === undefined ? '30d' : p.range;
  const page = normalizePage(p.page, 1);
  const pageSize = Math.min(C.PAGE_SIZE_MAX, normalizePage(p.pageSize, C.PAGE_SIZE));
  const days = range === 'all' ? C.RETENTION_DAYS : RANGES[range];
  const since = new Date(Date.now() - days * 86400000);

  const _ = db.command;
  const pattern = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' });
  const cond = _.and([
    { is_trend: false },
    { published_at: _.gte(since) },
    _.or([{ title: pattern }, { summary: pattern }])
  ]);

  const col = db.collection('news');
  const counted = await col.where(cond).count();
  const total = counted.total || 0;
  const res = await col
    .where(cond)
    .orderBy('published_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return {
    items: (res.data || []).map(toNewsItem),
    total: total,
    hasMore: page * pageSize < total,
    keyword: keyword,
    range: range,
    page: page,
    pageSize: pageSize
  };
}

/** R-10 详情：news + 同事件的其他报道（按源权重降序，最多 RELATED_MAX 条） */
async function getNews(db, params) {
  const p = params || {};
  const id = String(p.id === undefined || p.id === null ? '' : p.id).trim();
  if (!id) throw paramError('id is required');

  const res = await db.collection('news').where({ _id: id }).limit(1).get();
  const doc = res.data && res.data[0];
  if (!doc) {
    const err = new Error('news not found');
    err.code = ERR.NOT_FOUND;
    throw err;
  }

  const detail = Object.assign({}, toNewsItem(doc), {
    url: doc.url,
    contentHtml: doc.content_html || '',
    eventId: doc.event_id || '',
    fetchedAt: msOf(doc.fetched_at)
  });

  let related = [];
  if (doc.event_id) {
    const rel = await db
      .collection('news')
      .where({ event_id: doc.event_id, _id: db.command.neq(id) })
      .orderBy('source_weight', 'desc')
      .limit(C.RELATED_MAX)
      .get();
    related = (rel.data || []).map(toNewsItem);
  }

  return { news: detail, related: related };
}

const MONTH_RE = /^\d{4}-\d{2}$/;

/** R-12 归档月历：某月有数据的日期与每日条数，窗口 RETENTION_DAYS */
async function getCalendar(db, params) {
  const p = params || {};
  const now = Date.now();
  const today = dayOf(now);
  let month = p.month === undefined || p.month === null || p.month === '' ? today.slice(0, 7) : String(p.month);
  if (!MONTH_RE.test(month)) throw paramError('month must be YYYY-MM');

  const from = month + '-01';
  const nextMonth = new Date(Date.parse(from + 'T00:00:00+08:00'));
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const to = dayOf(nextMonth.getTime());

  const minDay = dayOf(now - C.RETENTION_DAYS * 86400000);
  const $ = db.command.aggregate;
  const res = await db
    .collection('news')
    .aggregate()
    .match({ day: db.command.gte(from), is_trend: false, is_primary: true })
    .group({ _id: '$day', count: $.sum(1) })
    .end();

  const counts = {};
  for (const row of (res && res.list) || []) {
    if (!row || !row._id) continue;
    const day = String(row._id);
    if (day < from || day >= to) continue;
    if (day < minDay) continue;
    counts[day] = row.count || 0;
  }

  const days = Object.keys(counts).sort();
  return {
    month: month,
    days: days,
    counts: counts,
    minDay: minDay,
    maxDay: today
  };
}

/** R-17 埋点：写 events_log（失败由客户端吞掉，不影响主流程） */
async function trackEvent(db, params) {
  const p = params || {};
  const event = String(p.event === undefined || p.event === null ? '' : p.event).trim();
  if (!event) throw paramError('event is required');

  const payload = p.payload && typeof p.payload === 'object' ? p.payload : {};
  await db.collection('events_log').add({
    data: {
      event: event.slice(0, 64),
      page: String(p.page || '').slice(0, 64),
      payload: payload,
      ts: new Date(),
      openid: String(p.openid || '')
    }
  });
  return { event: event, logged: 1 };
}

module.exports = {
  DAY_RE,
  MONTH_RE,
  RANGES,
  paramError,
  msOf,
  toNewsItem,
  normalizeDay,
  escapeRegExp,
  listForDay,
  listNews,
  getTrends,
  getHot,
  searchNews,
  getNews,
  getCalendar,
  trackEvent
};
