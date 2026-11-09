// cloudfunctions/news/test/pipeline.test.js
// T-06 验收：R-01 抓取编排 / R-07 热榜快照 / R-13 手动刷新限频 / 90 天清理。
const test = require('node:test');
const assert = require('node:assert');

const pipeline = require('../lib/pipeline');
const { clusterItems } = require('../lib/cluster');
const { scoreCluster } = require('../lib/hot');
const { C } = require('../lib/const');
const { createFakeDB } = require('./helpers/fake-db');
const { seedSourceList } = require('../lib/seed');
const { route, normalizeEvent } = require('../index');

const NOW = Date.parse('2026-11-08T08:00:00+08:00');
const SRC_COUNT = seedSourceList().length;

function makeItem(source, index, now) {
  return {
    title: `${source.name}测试标题${index}`,
    url: `https://example.com/${source.id}/${index}`,
    publishedAt: now - 3600000,
    summary: '测试摘要',
    contentHtml: ''
  };
}

/** 构造注入用 fetch/parse：按 id 制造失败 */
function makeImpl(options) {
  const opts = options || {};
  const failed = new Set(opts.failIds || []);
  const timeoutIds = new Set(opts.timeoutIds || []);
  const perSource = opts.perSource || 2;
  return {
    fetchSource: async (source) => {
      if (timeoutIds.has(source.id)) {
        const err = new Error('timeout');
        err.timeout = true;
        throw err;
      }
      if (failed.has(source.id)) throw new Error('HTTP 500');
      return { status: 200, ms: 5, text: 'stub' };
    },
    parseSource: (source) => ({
      adapter: source.adapter,
      items: Array.from({ length: perSource }, (_, i) => makeItem(source, i, opts.now || NOW))
    })
  };
}

test('runSources：单源超时不阻塞其他源，状态按源返回（R-01.3）', async () => {
  const sources = seedSourceList().slice(0, 3);
  const impl = makeImpl({ timeoutIds: [sources[1].id] });
  const results = await pipeline.runSources(sources, {
    now: NOW,
    deadline: NOW + C.FETCH_MAX_MS,
    fetchSource: impl.fetchSource,
    parseSource: impl.parseSource
  });

  assert.strictEqual(results.length, 3);
  assert.deepStrictEqual(
    results.map((r) => r.status),
    ['ok', 'timeout', 'ok']
  );
  assert.strictEqual(results[1].itemCount, 0);
  assert.ok(results[1].error.includes('timeout'));
});

test('runSources：超出整轮预算的源直接记 timeout，不再发请求', async () => {
  const sources = seedSourceList().slice(0, 2);
  const impl = makeImpl({});
  let calls = 0;
  const wrapped = async (source) => {
    calls += 1;
    return impl.fetchSource(source);
  };
  const results = await pipeline.runSources(sources, {
    now: NOW,
    deadline: NOW - 1, // 已过期
    fetchSource: wrapped,
    parseSource: impl.parseSource,
    batch: 1
  });
  assert.strictEqual(calls, 0);
  assert.deepStrictEqual(results.map((r) => r.status), ['timeout', 'timeout']);
});

test('buildDocs：清洗 + 去重 + 仅杭州打标', async () => {
  const sources = seedSourceList();
  const hz = sources.find((s) => s.category === 'hangzhou');
  const fin = sources.find((s) => s.category === 'finance');
  const results = [
    { source: hz, items: [{ title: '杭州公积金新政发布', url: 'https://a.com/1', summary: '', contentHtml: '' }], status: 'ok' },
    { source: fin, items: [{ title: '央行上调外汇存款准备金率', url: 'https://b.com/2', summary: '', contentHtml: '' }], status: 'ok' },
    { source: fin, items: [{ title: '英伟达货物失踪', url: 'https://b.com/3', summary: '', contentHtml: '' }], status: 'ok' }
  ];
  const docs = pipeline.buildDocs(results, NOW, null);
  assert.strictEqual(docs.length, 3);
  const hzDoc = docs.find((d) => d.category === 'hangzhou');
  assert.deepStrictEqual(hzDoc.tags, ['公积金']);
  const finDoc = docs.find((d) => d.category === 'finance');
  assert.deepStrictEqual(finDoc.tags, [], '非杭州不打标');
});

test('filterIncremental：只保留最近 N 小时发布的条目（R-13.1）', () => {
  const docs = [
    { published_at: new Date(NOW - 3600000) },
    { published_at: new Date(NOW - 25 * 3600000) }
  ];
  const kept = pipeline.filterIncremental(docs, 24, NOW);
  assert.strictEqual(kept.length, 1);
});

test('rankClusters：hot_score 降序，同分 published_at 新者在前', () => {
  const a = { hotScore: 80, members: [{ published_at: new Date(NOW - 7200000) }] };
  const b = { hotScore: 80, members: [{ published_at: new Date(NOW - 3600000) }] };
  const c = { hotScore: 90, members: [{ published_at: new Date(NOW - 7200000) }] };
  const ranked = pipeline.rankClusters([a, b, c]);
  assert.deepStrictEqual(ranked.map((x) => x.hotScore), [90, 80, 80]);
  assert.strictEqual(ranked[1], b);
});

test('D-15：杭州类源按相关性关键词过滤，非杭州条目被丢弃', () => {
  const hz = seedSourceList().find((s) => s.id === 'hz_gov');
  assert.ok(hz.filter && hz.filter.anyKeywords.length, '杭州源应带相关性过滤配置');
  const results = [
    {
      source: hz,
      status: 'ok',
      items: [
        { title: '杭州公积金新政发布', url: 'https://a.com/1', summary: '', contentHtml: '' },
        { title: '浙江医保新政下月实施', url: 'https://a.com/2', summary: '', contentHtml: '' },
        { title: '宁波新添36条惠民路', url: 'https://a.com/3', summary: '', contentHtml: '' }
      ]
    }
  ];
  const docs = pipeline.buildDocs(results, NOW, null);
  assert.deepStrictEqual(docs.map((d) => d.title), ['杭州公积金新政发布', '浙江医保新政下月实施']);
});

test('D-15：未配置过滤的源不受影响', () => {
  const fin = seedSourceList().find((s) => s.id === 'jiemian');
  assert.strictEqual(fin.filter, null);
  const docs = pipeline.buildDocs(
    [{ source: fin, status: 'ok', items: [{ title: '英伟达货物失踪', url: 'https://a.com/x', summary: '', contentHtml: '' }] }],
    NOW,
    null
  );
  assert.strictEqual(docs.length, 1);
});

test('D-15：本地媒体里无「杭州」字样但含惠民词的内容保留，纯时政/外地丢弃', () => {
  const hz = seedSourceList().find((s) => s.id === 'hz_news');
  assert.ok(hz.filter.excludeKeywords.length > 0, '应配置外地/全国排除词');
  const results = [
    {
      source: hz,
      status: 'ok',
      items: [
        { title: '医保新政下月实施 报销比例提高', url: 'https://b.com/1', summary: '', contentHtml: '' },
        { title: '习近平会见外国领导人', url: 'https://b.com/2', summary: '', contentHtml: '' },
        { title: '北京发布新一轮消费券', url: 'https://b.com/3', summary: '', contentHtml: '' }
      ]
    }
  ];
  const docs = pipeline.buildDocs(results, NOW, null);
  assert.deepStrictEqual(docs.map((d) => d.title), ['医保新政下月实施 报销比例提高']);
  assert.deepStrictEqual(docs[0].tags, ['社保医保'], '保留的条目同时完成打标');
});

test('D-14：同热度基础分下，带惠民标签的事件排名更靠前', () => {
  const now = NOW;
  const base = {
    day: '2026-11-08',
    category: 'hangzhou',
    source_id: 'hz_gov',
    source_weight: 0.8,
    is_trend: false,
    summary: '',
    fetched_at: new Date(now),
    published_at: new Date(now - 2 * 3600000)
  };
  const docs = [
    Object.assign({}, base, { title: '杭州公积金新政发布', url: 'https://a.com/1', url_hash: 'h1', tags: ['公积金'] }),
    Object.assign({}, base, { title: '杭州天气转晴适合出游', url: 'https://a.com/2', url_hash: 'h2', tags: [] })
  ];

  const clusters = clusterItems(docs, { now: now, day: '2026-11-08' });
  assert.strictEqual(clusters.length, 2, '两条标题不同，不应聚成一簇');
  for (const c of clusters) c.hotScore = scoreCluster(c, now);

  const ranked = pipeline.rankClusters(clusters);
  assert.deepStrictEqual(ranked[0].members[0].tags, ['公积金']);
  assert.strictEqual(ranked[0].hotScore - ranked[1].hotScore, C.HOT_TAG_BONUS);
});

test('D-16：每个事件只有一个代表条目，且代表来自权重最高的源', async () => {
  const db = createFakeDB();
  const sources = seedSourceList().slice(0, 3);
  const now = NOW;
  // 三个源发同一条新闻：权重 1.0 / 0.9 / 0.8，代表应取权重最高者
  const impl = {
    fetchSource: async () => ({ status: 200, text: 'stub' }),
    parseSource: (source) => ({
      items: [
        {
          title: '央行上调外汇存款准备金率',
          url: 'https://example.com/shared',
          publishedAt: now - 3600000,
          summary: '',
          contentHtml: ''
        }
      ]
    })
  };
  await pipeline.runFetch(db, { now, sources, fetchSource: impl.fetchSource, parseSource: impl.parseSource });

  const news = db.__dump('news');
  const primaries = news.filter((n) => n.is_primary);
  assert.strictEqual(news.length, 1, '同 URL 先去重为 1 条');
  assert.strictEqual(primaries.length, 1);
  assert.strictEqual(primaries[0].source_weight, Math.max.apply(null, sources.map((s) => s.weight)));
});

test('D-16：不同源的同事件新闻按 event_id 只留一个代表', async () => {
  const db = createFakeDB();
  const sources = seedSourceList().slice(0, 2);
  const now = NOW;
  const titles = [
    '杭州地铁四期规划获批线路总长超过一百公里',
    '杭州地铁四期规划获批线路总长超过一百公里将开工'
  ];
  let call = 0;
  const impl = {
    fetchSource: async () => ({ status: 200, text: 'stub' }),
    parseSource: (source) => ({
      items: [
        {
          title: titles[call++ % titles.length],
          url: 'https://example.com/' + source.id,
          publishedAt: now - 3600000,
          summary: '',
          contentHtml: ''
        }
      ]
    })
  };
  await pipeline.runFetch(db, { now, sources, fetchSource: impl.fetchSource, parseSource: impl.parseSource });

  const news = db.__dump('news');
  assert.strictEqual(news.length, 2, '标题不同，两源各入库一条');
  const primaries = news.filter((n) => n.is_primary);
  assert.strictEqual(primaries.length, 1, '同一事件只有一个代表');
  const maxWeight = Math.max.apply(null, sources.map((s) => s.weight));
  assert.strictEqual(primaries[0].source_weight, maxWeight, '代表取权重最高的源');
});

test('changeOf：new / up / down / same 与 delta', () => {  assert.deepStrictEqual(pipeline.changeOf(3, null), { prev_rank: null, change: 'new', delta: 0 });
  assert.deepStrictEqual(pipeline.changeOf(2, 5), { prev_rank: 5, change: 'up', delta: -3 });
  assert.deepStrictEqual(pipeline.changeOf(7, 4), { prev_rank: 4, change: 'down', delta: 3 });
  assert.deepStrictEqual(pipeline.changeOf(4, 4), { prev_rank: 4, change: 'same', delta: 0 });
});

test('runFetch：全量源 → fetch_logs 每源 1 条、daily_hot Top10、news/events 落库', async () => {
  const db = createFakeDB();
  const impl = makeImpl({ perSource: 2 });
  const res = await pipeline.runFetch(db, {
    now: NOW,
    fetchSource: impl.fetchSource,
    parseSource: impl.parseSource
  });

  assert.strictEqual(res.sources, SRC_COUNT);
  assert.strictEqual(res.failed.length, 0);
  assert.strictEqual(db.__size('fetch_logs'), SRC_COUNT, 'R-17：每源每轮 1 条日志');
  assert.strictEqual(db.__size('daily_hot'), C.TOP_N, 'R-07：热榜 10 条');
  assert.strictEqual(db.__size('news'), SRC_COUNT * 2);
  assert.strictEqual(db.__size('events'), res.clusters);
  assert.ok(res.clusters >= C.TOP_N, '事件数应足够生成 Top10');

  const logs = db.__dump('fetch_logs');
  assert.ok(logs.every((l) => l.status === 'ok' && l.mode === 'full'));
  assert.ok(logs.every((l) => l.run_at instanceof Date));

  const hot = db.__dump('daily_hot').sort((a, b) => a.rank - b.rank);
  assert.deepStrictEqual(hot.map((h) => h.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(hot.every((h) => h.change === 'new'), '首次生成全部为 new');

  const news = db.__dump('news');
  assert.ok(news.every((n) => n.event_id && typeof n.hot_score === 'number'));
  assert.ok(news.every((n) => n.url_hash && n.day === '2026-11-08'));
});

test('runFetch：失败源不阻塞，日志如实记录（R-01.3/6）', async () => {
  const db = createFakeDB();
  const sources = seedSourceList();
  const impl = makeImpl({ failIds: [sources[5].id], perSource: 1 });
  const res = await pipeline.runFetch(db, {
    now: NOW,
    sources: sources,
    fetchSource: impl.fetchSource,
    parseSource: impl.parseSource
  });

  assert.deepStrictEqual(res.failed, [sources[5].id]);
  assert.strictEqual(db.__size('fetch_logs'), SRC_COUNT);
  const bad = db.__dump('fetch_logs').find((l) => l.source_id === sources[5].id);
  assert.strictEqual(bad.status, 'fail');
  assert.ok(bad.error.includes('500'));
  assert.strictEqual(db.__size('news'), (SRC_COUNT - 1) * 1, '其余源正常入库');
});

test('runFetch：重复触发不产生重复 news（依赖 url_hash 查询）', async () => {
  const db = createFakeDB();
  const impl = makeImpl({ perSource: 2 });
  await pipeline.runFetch(db, { now: NOW, fetchSource: impl.fetchSource, parseSource: impl.parseSource });
  const second = await pipeline.runFetch(db, { now: NOW + 1000, fetchSource: impl.fetchSource, parseSource: impl.parseSource });
  assert.strictEqual(second.added, 0);
  assert.strictEqual(second.updated, SRC_COUNT * 2);
  assert.strictEqual(db.__size('news'), SRC_COUNT * 2);
  assert.strictEqual(db.__size('daily_hot'), 10, '同一天热榜覆盖写，不重复');
});

test('runFetch：第二轮 change=dame/same 快照对比', async () => {
  const db = createFakeDB();
  const impl = makeImpl({ perSource: 2 });
  await pipeline.runFetch(db, { now: NOW, fetchSource: impl.fetchSource, parseSource: impl.parseSource });
  await pipeline.runFetch(db, { now: NOW + 1000, fetchSource: impl.fetchSource, parseSource: impl.parseSource });
  const hot = db.__dump('daily_hot');
  assert.ok(hot.every((h) => h.change === 'same' || h.change === 'new'));
  assert.ok(hot.every((h) => typeof h.delta === 'number'));
});

test('cleanup：删除 90 天前的 news/events/daily_hot/fetch_logs', async () => {
  const db = createFakeDB();
  await db.collection('news').add({ data: { day: '2026-01-01', title: '旧闻' } });
  await db.collection('news').add({ data: { day: '2026-11-08', title: '今日' } });
  await db.collection('events').add({ data: { day: '2026-01-01' } });
  await db.collection('daily_hot').add({ data: { date: '2026-01-01', rank: 1 } });
  await db.collection('fetch_logs').add({ data: { run_at: new Date(NOW - 100 * 86400000), source_id: 'x' } });
  await db.collection('fetch_logs').add({ data: { run_at: new Date(NOW), source_id: 'y' } });

  const removed = await pipeline.cleanup(db, { now: NOW });
  assert.strictEqual(removed.news, 1);
  assert.strictEqual(removed.events, 1);
  assert.strictEqual(removed.daily_hot, 1);
  assert.strictEqual(removed.fetch_logs, 1);
  assert.strictEqual(db.__size('news'), 1);
  assert.strictEqual(db.__size('fetch_logs'), 1);
});

test('fetch 动作：非定时调用且无 token 返回 E_FORBIDDEN；定时触发可执行（R-01.1）', async () => {
  const db = createFakeDB();
  const stub = { runFetch: async () => ({ added: 1 }) };
  const denied = await route({ action: 'fetch' }, { db, adminToken: 'k', pipeline: stub });
  assert.strictEqual(denied.error.code, 'E_FORBIDDEN');

  const timer = await route({ action: 'fetch', Type: 'Timer' }, { db, adminToken: 'k', pipeline: stub });
  assert.strictEqual(timer.ok, true);
  assert.strictEqual(timer.data.added, 1);
});

test('normalizeEvent：定时触发器名映射到 action（R-01.1）', () => {
  assert.strictEqual(normalizeEvent({ Type: 'Timer', TriggerName: 'fetchDaily' }).action, 'fetch');
  assert.strictEqual(normalizeEvent({ Type: 'Timer', TriggerName: 'cleanupDaily' }).action, 'cleanup');
  assert.strictEqual(normalizeEvent({ Type: 'Timer' }).action, 'fetch');
  assert.strictEqual(normalizeEvent({ action: 'refresh' }).action, 'refresh');
  // 不修改原对象
  const original = { Type: 'Timer', TriggerName: 'fetchDaily' };
  normalizeEvent(original);
  assert.strictEqual(original.action, undefined);
});

test('refresh：冷却期内返回 E_RATE_LIMIT + nextAllowedAt，过期后可刷新并写锁（R-13.2）', async () => {
  const db = createFakeDB();
  const stub = { runFetch: async () => ({ added: 3, updated: 0, skipped: 0 }) };
  const cooldownMs = C.REFRESH_COOLDOWN_MIN * 60000;

  await db.collection('config').add({ data: { _id: 'refresh_lock', last_run_at: new Date(Date.now() - 60000) } });
  const blocked = await route({ action: 'refresh' }, { db, pipeline: stub });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.error.code, 'E_RATE_LIMIT');
  assert.ok(blocked.error.nextAllowedAt > Date.now(), '应给出可再次刷新的时间戳');

  await db.collection('config').doc('refresh_lock').update({ data: { last_run_at: new Date(Date.now() - cooldownMs - 1000) } });
  const allowed = await route({ action: 'refresh' }, { db, pipeline: stub });
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(allowed.data.added, 3);
  assert.ok(allowed.data.nextAllowedAt > Date.now());
  const lock = db.__dump('config').find((c) => c._id === 'refresh_lock');
  assert.ok(Date.now() - new Date(lock.last_run_at).getTime() < 5000, '刷新成功后应写入锁时间');
});


