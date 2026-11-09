// cloudfunctions/news/test/cluster.test.js
// T-05 验收：R-05 事件聚类。
const test = require('node:test');
const assert = require('node:assert');

const { normalizeTitle, bigrams, jaccard, similarity, clusterItems } = require('../lib/cluster');
const { C } = require('../lib/const');

const NOW = Date.parse('2026-11-08T12:00:00+08:00');
const DAY = '2026-11-08';

function item(over) {
  return Object.assign(
    {
      title: '国务院办公厅关于2027年部分节假日安排的通知',
      summary: '摘要',
      url: 'https://a.com/1',
      url_hash: 'h1',
      day: DAY,
      source_id: 'gov_cn',
      source_weight: 1,
      category: 'policy',
      is_trend: false,
      fetched_at: new Date(NOW - 3600000),
      published_at: new Date(NOW - 7200000)
    },
    over
  );
}

test('§3.1 标题归一化：去来源前缀、全角转半角、去标点空白、小写', () => {
  assert.strictEqual(normalizeTitle('【财联社】ＡＢＣ 公司：业绩预增！'), 'abc公司业绩预增');
  assert.strictEqual(normalizeTitle('[澎湃] 杭州文博会开幕'), '杭州文博会开幕');
});

test('bigram 与 Jaccard 基本性质', () => {
  assert.strictEqual(bigrams('杭州').size, 1);
  assert.strictEqual(bigrams('杭州文博').size, 3);
  assert.strictEqual(jaccard(bigrams('杭州文博'), bigrams('杭州文博')), 1);
  assert.strictEqual(jaccard(bigrams('杭州'), bigrams('上海')), 0);
});

test('相似度 0.7 的两条合并为同一事件，0.4 的不合并', () => {
  const a = '国务院办公厅关于2027年部分节假日安排的通知';
  const b = '国务院办公厅关于2027年部分节假日安排的通知正式发布';
  const sim = similarity(a, b);
  assert.ok(sim >= 0.6 && sim < 1, `构造的相似度应 ≥0.6 且 <1，实际 ${sim.toFixed(3)}`);

  const merged = clusterItems([item({}), item({ url: 'https://b.com/2', url_hash: 'h2', title: b, source_id: 'xinhua' })], {
    now: NOW
  });
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].members.length, 2);
  assert.strictEqual(merged[0].sourceCount, 2);

  const apart = clusterItems(
    [item({}), item({ url: 'https://c.com/3', url_hash: 'h3', title: '胖东来回应洗发水产地造假' })],
    { now: NOW }
  );
  assert.strictEqual(apart.length, 2);
});

test('事件标题/摘要取权重最高的成员，event key 取最早入库成员', () => {
  const first = item({ source_id: 'low', source_weight: 0.5, title: '央行上调外汇存款准备金率', url_hash: 'first' });
  const second = item({
    source_id: 'high',
    source_weight: 1,
    title: '央行上调外汇存款准备金率 0.5 个百分点',
    url: 'https://b.com/2',
    url_hash: 'second',
    fetched_at: new Date(NOW - 1800000),
    summary: '高权重摘要'
  });
  const clusters = clusterItems([first, second], { now: NOW });
  assert.strictEqual(clusters.length, 1);
  assert.strictEqual(clusters[0].key, 'first', 'event_id 取最早入库条目');
  assert.strictEqual(clusters[0].title, second.title);
  assert.strictEqual(clusters[0].summary, '高权重摘要');
  assert.deepStrictEqual(clusters[0].newsKeys.sort(), ['first', 'second']);
});

test('trend 条目不参与聚类（R-05.1）', () => {
  const clusters = clusterItems([item({}), item({ url: 'https://baidu.com/s?wd=x', url_hash: 'h9', title: '胖东来回应洗发水产地造假', is_trend: true })], {
    now: NOW
  });
  assert.strictEqual(clusters.length, 1);
  assert.strictEqual(clusters[0].members.length, 1);
});

test('跨天条目不参与当日聚类（R-05.6）', () => {
  const clusters = clusterItems([item({}), item({ url: 'https://b.com/2', url_hash: 'h2', day: '2026-11-07', fetched_at: new Date(NOW - 86400000) })], {
    now: NOW,
    day: DAY
  });
  assert.strictEqual(clusters.length, 1);
});

test('阈值可配置：把阈值调到 1.0 后只有完全一致的标题合并', () => {
  const a = item({});
  const b = item({ url: 'https://b.com/2', url_hash: 'h2', title: '国务院办公厅关于2027年部分节假日安排的通知正式发布' });
  const strict = clusterItems([a, b], { now: NOW, threshold: 1 });
  assert.strictEqual(strict.length, 2);
  assert.strictEqual(C.CLUSTER_THRESHOLD, 0.6);
});

test('链式相似会合并到同一事件', () => {
  const base = '杭州地铁四期规划获批线路总长超过一百公里';
  const mid = '杭州地铁四期规划获批线路总长超过一百公里将开工';
  const clusters = clusterItems(
    [
      item({ title: base, url_hash: 'k1', url: 'https://a.com/1' }),
      item({ title: mid, url_hash: 'k2', url: 'https://b.com/2', fetched_at: new Date(NOW - 1000) })
    ],
    { now: NOW }
  );
  assert.strictEqual(clusters.length, 1);
  assert.strictEqual(clusters[0].members.length, 2);
});
