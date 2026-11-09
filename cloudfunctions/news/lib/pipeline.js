// cloudfunctions/news/lib/pipeline.js
// T-06 抓取编排（R-01 / R-13）：
//   抓取 → 清洗 → 去重 → 标签 → 入库 → 聚类 → 热度 → events/daily_hot → fetch_logs → 清理
const { C, SOURCE_STATUS } = require('./const');
const { dayOf, startOfDay } = require('./time');
const { fetchSource } = require('./fetch');
const { parseSource } = require('./parse');
const { cleanItems } = require('./clean');
const { dedupeItems } = require('./dedupe');
const { clusterItems } = require('./cluster');
const { scoreCluster } = require('./hot');
const { matchTags } = require('./tags');
const { seedSourceList } = require('./seed');
const SEED_DATA = require('./seed-sources');

const TAG_RULES = (SEED_DATA && SEED_DATA.tagRules) || [];

function msOf(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Date.parse(v);
  return 0;
}

function errorText(err) {
  if (!err) return '';
  const msg = String((err && err.message) || err);
  return msg.slice(0, 200);
}

/**
 * 并发抓取 + 解析：批大小 FETCH_BATCH，整轮预算 FETCH_MAX_MS。
 * 单源失败只记状态，不抛出（R-01.3）。
 */
async function runSources(sources, options) {
  const opts = options || {};
  const now = opts.now === undefined ? Date.now() : opts.now;
  const budgetMs =
    opts.deadline === undefined ? C.FETCH_MAX_MS : Math.max(0, opts.deadline - now);
  const fetchImpl = opts.fetchSource || fetchSource;
  const parseImpl = opts.parseSource || parseSource;
  const pool = opts.batch || C.FETCH_BATCH;
  const wallStart = Date.now();

  const results = new Array(sources.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= sources.length) return;
      const source = sources[index];
      const startedAt = Date.now();

      // 整轮预算按真实耗时计算，与注入的 now 无关
      if (startedAt - wallStart >= budgetMs) {
        results[index] = {
          source: source,
          status: 'timeout',
          http: 0,
          itemCount: 0,
          durationMs: 0,
          error: '整轮预算耗尽',
          items: []
        };
        continue;
      }

      try {
        const res = await fetchImpl(source, { deadline: now + budgetMs });
        const parsed = parseImpl(source, res.text, { now: now });
        const items = parsed.items || [];
        let status = 'ok';
        if (!items.length) {
          status = source.adapter === 'html' || source.adapter === 'trend' ? 'structure_changed' : 'fail';
        }
        results[index] = {
          source: source,
          status: status,
          http: res.status,
          itemCount: items.length,
          durationMs: Date.now() - startedAt,
          error: '',
          items: items
        };
      } catch (err) {
        results[index] = {
          source: source,
          status: err && err.timeout ? 'timeout' : 'fail',
          http: 0,
          itemCount: 0,
          durationMs: Date.now() - startedAt,
          error: errorText(err),
          items: []
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(pool, sources.length) }, () => worker()));
  return results;
}

/**
 * 相关性过滤（D-15）：
 *   命中 anyKeywords → 保留（本地相关）
 *   未命中但命中 excludeKeywords → 丢弃（外地/全国）
 *   否则标题或摘要命中惠民标签词 → 保留，其余丢弃
 */
function matchesRelevance(item, source, tagRules) {
  const filter = source && source.filter;
  if (!filter || !Array.isArray(filter.anyKeywords) || !filter.anyKeywords.length) return true;
  const text = (item.title || '') + ' ' + (item.summary || '');

  if (filter.anyKeywords.some((kw) => kw && text.includes(kw))) return true;
  if ((filter.excludeKeywords || []).some((kw) => kw && text.includes(kw))) return false;
  return matchTags(item.title, item.summary, tagRules || TAG_RULES).length > 0;
}

/** 清洗 + 相关性过滤 + 去重 + 打标（R-14 仅杭州） */
function buildDocs(results, now, tagRules) {
  const rules = tagRules || TAG_RULES;
  let docs = [];
  for (const r of results) {
    if (!r.items || !r.items.length) continue;
    const kept = r.items.filter((it) => matchesRelevance(it, r.source, rules));
    docs = docs.concat(cleanItems(kept, r.source, { now: now }));
  }
  docs = dedupeItems(docs);
  for (const doc of docs) {
    if (doc.category !== 'hangzhou') continue;
    doc.tags = matchTags(doc.title, doc.summary, rules);
  }
  return docs;
}

/** 增量模式：只保留最近 hours 小时发布的条目（R-13.1） */
function filterIncremental(docs, hours, now) {
  const since = now - hours * 3600000;
  return docs.filter((doc) => {
    const t = msOf(doc.published_at);
    return !t || t >= since;
  });
}

/** 并发受限的批量执行（云数据库单条写延迟高，串行会顶满函数超时） */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function persistNews(db, docs, now) {
  const col = db.collection('news');
  const ids = new Map(); // url_hash -> _id
  let added = 0;
  let updated = 0;
  let skipped = 0;

  const outcomes = await mapLimit(docs, 10, async (doc) => {
    const found = await col.where({ url_hash: doc.url_hash }).limit(1).get();
    const existing = (found.data && found.data[0]) || null;
    const record = Object.assign({}, doc);
    delete record.stale;
    record.fetched_at = new Date(now);
    // D-16：trend 条目自身即代表条目；普通条目由聚类阶段选出唯一代表
    record.is_primary = Boolean(doc.is_trend);

    let id;
    let created = false;
    if (existing) {
      id = existing._id;
      if (doc.is_trend) record.event_id = id;
      await col.doc(id).update({ data: record });
    } else {
      const res = await col.add({ data: record });
      id = res._id;
      created = true;
      if (doc.is_trend) await col.doc(id).update({ data: { event_id: id } });
    }
    return { hash: doc.url_hash, id: id, created: created, skipped: !doc.url_hash };
  });

  for (const o of outcomes) {
    if (o.hash) ids.set(o.hash, o.id);
    if (o.created) added += 1;
    else updated += 1;
    if (o.skipped) skipped += 1;
  }

  return { added: added, updated: updated, skipped: skipped, ids: ids };
}

async function persistEvents(db, clusters, ids, now) {
  const col = db.collection('events');
  const newsCol = db.collection('news');

  await mapLimit(clusters, 5, async (cluster) => {
    const memberIds = cluster.newsKeys.map((k) => ids.get(k)).filter(Boolean);
    if (!memberIds.length) return;

    const eventId = ids.get(cluster.key) || memberIds[0];
    const hot = scoreCluster(cluster, now);
    cluster.eventId = eventId;
    cluster.hotScore = hot;

    // D-16：每个事件只有一个「代表条目」进入列表，优先权重最高的源，其次最早入库
    const primary = cluster.members.reduce(
      (best, m) => ((m.source_weight || 0) > (best.source_weight || 0) ? m : best),
      cluster.members[0]
    );
    const primaryId = ids.get(primary.url_hash) || memberIds[0];

    const record = {
      day: cluster.day,
      title: cluster.title,
      category: cluster.category,
      source_count: cluster.sourceCount,
      hot_score: hot,
      news_ids: memberIds,
      first_seen_at: new Date(cluster.firstSeenAt),
      cover: cluster.cover || ''
    };

    try {
      await col.add({ data: Object.assign({ _id: eventId }, record) });
    } catch (err) {
      await col.doc(eventId).update({ data: record });
    }

    await mapLimit(memberIds, 5, (id) =>
      newsCol.doc(id).update({
        data: {
          event_id: eventId,
          hot_score: hot,
          source_count: cluster.sourceCount,
          is_primary: id === primaryId
        }
      })
    );
  });

  return clusters;
}

/** 热榜排序：hot_score desc，同分 published_at 新者在前（R-07.2） */
function rankClusters(clusters) {
  return clusters.slice().sort((a, b) => {
    if (b.hotScore !== a.hotScore) return b.hotScore - a.hotScore;
    return msOf(b.members[0].published_at) - msOf(a.members[0].published_at);
  });
}

function changeOf(rank, prevRank) {
  if (!prevRank) return { prev_rank: null, change: 'new', delta: 0 };
  if (rank === prevRank) return { prev_rank: prevRank, change: 'same', delta: 0 };
  if (rank < prevRank) return { prev_rank: prevRank, change: 'up', delta: rank - prevRank };
  return { prev_rank: prevRank, change: 'down', delta: rank - prevRank };
}

async function persistDailyHot(db, day, ranked, ids, now) {
  const col = db.collection('daily_hot');
  const prevDay = dayOf(startOfDay(day) - 1);
  const prevRes = await col.where({ date: prevDay }).get();
  const prevRanks = new Map();
  for (const row of prevRes.data || []) {
    prevRanks.set(row.event_id, row.rank);
  }

  const top = ranked.slice(0, C.TOP_N);
  for (let i = 0; i < top.length; i += 1) {
    const cluster = top[i];
    const rank = i + 1;
    const change = changeOf(rank, prevRanks.get(cluster.eventId));
    const record = {
      date: day,
      rank: rank,
      news_id: ids.get(cluster.members[0].url_hash) || '',
      event_id: cluster.eventId,
      hot_score: cluster.hotScore,
      prev_rank: change.prev_rank,
      change: change.change,
      delta: change.delta
    };

    const found = await col.where({ date: day, rank: rank }).limit(1).get();
    if (found.data && found.data.length) {
      await col.doc(found.data[0]._id).update({ data: record });
    } else {
      await col.add({ data: record });
    }
  }

  return top.map((c, i) => ({
    rank: i + 1,
    event_id: c.eventId,
    hot_score: c.hotScore,
    change: changeOf(i + 1, prevRanks.get(c.eventId)).change
  }));
}

async function writeFetchLogs(db, runAt, mode, results) {
  const col = db.collection('fetch_logs');
  await mapLimit(results, 10, (r) =>
    col.add({
      data: {
        run_at: new Date(runAt),
        mode: mode,
        source_id: r.source.id,
        status: SOURCE_STATUS.includes(r.status) ? r.status : 'fail',
        item_count: r.itemCount,
        duration_ms: r.durationMs,
        error: r.error || ''
      }
    })
  );
  // 更新源运行期统计
  const sourcesCol = db.collection('sources');
  await mapLimit(results, 10, async (r) => {
    const found = await sourcesCol.where({ id: r.source.id }).limit(1).get();
    const doc = found.data && found.data[0];
    if (!doc) return;
    const failed = r.status !== 'ok';
    const patch = {
      last_fetch_at: new Date(runAt),
      fail_count: failed ? (doc.fail_count || 0) + 1 : 0
    };
    if (r.status === 'structure_changed') patch.disabled_reason = '结构变化';
    if (r.status === 'ok') patch.disabled_reason = '';
    await sourcesCol.doc(doc._id).update({ data: patch });
  });
  return results.length;
}

/** 90 天清理（R-01 配套，CLEAN_CRON 触发） */
async function cleanup(db, options) {
  const opts = options || {};
  const now = opts.now === undefined ? Date.now() : opts.now;
  const days = opts.days || C.RETENTION_DAYS;
  const cutoffDay = dayOf(now - days * 86400000);
  const _ = db.command;
  const removed = {};

  const news = await db.collection('news').where({ day: _.lt(cutoffDay) }).remove();
  removed.news = (news.stats && news.stats.removed) || 0;

  const events = await db.collection('events').where({ day: _.lt(cutoffDay) }).remove();
  removed.events = (events.stats && events.stats.removed) || 0;

  const hot = await db.collection('daily_hot').where({ date: _.lt(cutoffDay) }).remove();
  removed.daily_hot = (hot.stats && hot.stats.removed) || 0;

  const logs = await db.collection('fetch_logs').where({ run_at: _.lt(new Date(now - days * 86400000)) }).remove();
  removed.fetch_logs = (logs.stats && logs.stats.removed) || 0;

  return removed;
}

/**
 * 跑一轮抓取（定时 full / 手动 incr）。
 * @returns {{added, updated, skipped, failed:string[], clusters:number, hot:number, durationMs:number}}
 */
async function runFetch(db, options) {
  const opts = options || {};
  const wallStart = Date.now();
  const startedAt = opts.now === undefined ? wallStart : opts.now;
  const mode = opts.mode === 'incr' ? 'incr' : 'full';
  const day = dayOf(startedAt);
  const allSources = opts.sources || seedSourceList().filter((s) => s.enabled);
  const sources = allSources.slice(0, opts.limit || allSources.length);

  const results = await runSources(sources, {
    now: startedAt,
    deadline: startedAt + C.FETCH_MAX_MS,
    batch: opts.batch,
    fetchSource: opts.fetchSource,
    parseSource: opts.parseSource
  });

  let docs = buildDocs(results, startedAt, opts.tagRules);
  if (mode === 'incr') docs = filterIncremental(docs, opts.hours || 24, startedAt);

  const persisted = await persistNews(db, docs, startedAt);
  const clusters = clusterItems(docs, { now: startedAt, day: day });
  await persistEvents(db, clusters, persisted.ids, startedAt);

  const ranked = rankClusters(clusters);
  const hot = await persistDailyHot(db, day, ranked, persisted.ids, startedAt);
  await writeFetchLogs(db, startedAt, mode, results);

  const failed = results.filter((r) => r.status !== 'ok').map((r) => r.source.id);

  return {
    added: persisted.added,
    updated: persisted.updated,
    skipped: persisted.skipped,
    failed: failed,
    clusters: clusters.length,
    hot: hot.length,
    mode: mode,
    day: day,
    durationMs: Date.now() - wallStart,
    sources: results.length
  };
}

module.exports = {
  TAG_RULES,
  runSources,
  buildDocs,
  filterIncremental,
  persistNews,
  persistEvents,
  rankClusters,
  changeOf,
  persistDailyHot,
  writeFetchLogs,
  cleanup,
  runFetch
};
