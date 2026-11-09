// cloudfunctions/news/test/hot.test.js
// T-05 验收：R-06 热度（公式见 REQ §2 R-06，示例见 §3.2）。
const test = require('node:test');
const assert = require('node:assert');

const { hotScore, scoreCluster, coverScore, freshness } = require('../lib/hot');
const { C } = require('../lib/const');

const NOW = Date.parse('2026-11-08T12:00:00+08:00');
const HOUR = 3600000;

test('§3.2 示例：3 源、2 小时前、权重 0.9 → 84', () => {
  const score = hotScore({ sourceCount: 3, publishedAt: NOW - 2 * HOUR, weights: [0.9, 0.9, 0.9], now: NOW });
  assert.strictEqual(score, 84);
});

test('R-06 验收：5 源、1 小时前、权重 1.0 → 99±1', () => {
  const score = hotScore({
    sourceCount: 5,
    publishedAt: NOW - HOUR,
    weights: [1, 1, 1, 1, 1],
    now: NOW
  });
  assert.ok(Math.abs(score - 99) <= 1, `实际 ${score}`);
});

test('R-06 验收：单源、24 小时前、权重 0.8 → 48±1', () => {
  const score = hotScore({ sourceCount: 1, publishedAt: NOW - 24 * HOUR, weights: [0.8], now: NOW });
  assert.ok(Math.abs(score - 48) <= 1, `实际 ${score}`);
});

test('覆盖项封顶 1：6 源与 20 源得分相同', () => {
  assert.strictEqual(coverScore(6), 1);
  assert.strictEqual(coverScore(20), 1);
  const a = hotScore({ sourceCount: 6, publishedAt: NOW, weights: [1, 1, 1, 1, 1, 1], now: NOW });
  const b = hotScore({ sourceCount: 20, publishedAt: NOW, weights: new Array(20).fill(1), now: NOW });
  assert.strictEqual(a, b);
});

test('新鲜度按 24 小时衰减一半', () => {
  assert.ok(Math.abs(freshness(NOW, NOW) - 1) < 1e-9);
  assert.ok(Math.abs(freshness(NOW - 24 * HOUR, NOW) - 0.5) < 1e-9);
  assert.ok(Math.abs(freshness(NOW - 48 * HOUR, NOW) - 0.25) < 1e-9);
});

test('未来时间按 0 小时计（负数按 0）', () => {
  assert.strictEqual(hotScore({ sourceCount: 1, publishedAt: NOW + 5 * HOUR, weights: [1], now: NOW }),
    hotScore({ sourceCount: 1, publishedAt: NOW, weights: [1], now: NOW }));
});

test('结果始终是 0–100 的整数', () => {
  for (const n of [0, 1, 3, 9, 30]) {
    const score = hotScore({ sourceCount: n, publishedAt: NOW - 100 * HOUR, weights: [0, 0.5, 1], now: NOW });
    assert.ok(Number.isInteger(score));
    assert.ok(score >= 0 && score <= 100);
  }
});

test('scoreCluster：sourceCount 取不同源数，权重取各源首条', () => {
  const members = [
    { source_id: 'a', source_weight: 1, published_at: new Date(NOW - 2 * HOUR) },
    { source_id: 'b', source_weight: 0.5, published_at: new Date(NOW - 2 * HOUR) },
    { source_id: 'a', source_weight: 1, published_at: new Date(NOW - 2 * HOUR) }
  ];
  const score = scoreCluster({ members }, NOW);
  const expected = hotScore({ sourceCount: 2, publishedAt: NOW - 2 * HOUR, weights: [1, 0.5], now: NOW });
  assert.strictEqual(score, expected);
});

test('D-14：带惠民标签的事件加 HOT_TAG_BONUS(6) 分', () => {
  const base = { sourceCount: 1, publishedAt: NOW - 24 * HOUR, weights: [0.8], now: NOW };
  const plain = hotScore(base);
  const tagged = hotScore(Object.assign({}, base, { tagged: true }));
  assert.strictEqual(tagged - plain, C.HOT_TAG_BONUS);
  assert.strictEqual(C.HOT_TAG_BONUS, 6);
});

test('D-14：加成后仍封顶 100', () => {
  const nearMax = hotScore({
    sourceCount: 6,
    publishedAt: NOW,
    weights: [1, 1, 1, 1, 1, 1],
    tagged: true,
    now: NOW
  });
  assert.strictEqual(nearMax, 100);
});

test('scoreCluster：簇内任一成员带标签即提权，trend 不含标签', () => {
  const nowMembers = [
    { source_id: 'hz', source_weight: 0.8, published_at: new Date(NOW - 2 * HOUR), tags: [] }
  ];
  const before = scoreCluster({ members: nowMembers }, NOW);

  const taggedMembers = [
    { source_id: 'hz', source_weight: 0.8, published_at: new Date(NOW - 2 * HOUR), tags: ['公积金'] }
  ];
  const after = scoreCluster({ members: taggedMembers }, NOW);
  assert.strictEqual(after - before, C.HOT_TAG_BONUS);

  // 多成员时只要一个带标签就提权
  const mixed = scoreCluster(
    {
      members: [
        { source_id: 'a', source_weight: 0.8, published_at: new Date(NOW - 2 * HOUR), tags: [] },
        { source_id: 'b', source_weight: 0.8, published_at: new Date(NOW - 2 * HOUR), tags: ['教育'] }
      ]
    },
    NOW
  );
  const sameNoTag = scoreCluster(
    {
      members: [
        { source_id: 'a', source_weight: 0.8, published_at: new Date(NOW - 2 * HOUR), tags: [] },
        { source_id: 'b', source_weight: 0.8, published_at: new Date(NOW - 2 * HOUR), tags: [] }
      ]
    },
    NOW
  );
  assert.strictEqual(mixed - sameNoTag, C.HOT_TAG_BONUS);
});
