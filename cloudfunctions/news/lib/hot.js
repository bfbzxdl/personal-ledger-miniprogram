// cloudfunctions/news/lib/hot.js
// T-05 热度（R-06）：hot_score = round(100 * (0.55C + 0.30T + 0.15W))
//   C = min(1, ln(1 + source_count) / ln(6))
//   T = 0.5 ^ (age_hours / 24)
//   W = mean(source.weight of event members)
const { C } = require('./const');
const { ageHours } = require('./time');

function coverScore(sourceCount) {
  const n = Math.max(0, Number(sourceCount) || 0);
  return Math.min(1, Math.log(1 + n) / Math.log(6));
}

function freshness(publishedAt, now) {
  return Math.pow(0.5, ageHours(publishedAt, now) / 24);
}

function meanWeight(weights) {
  const list = (weights || []).filter((w) => typeof w === 'number' && !Number.isNaN(w));
  if (!list.length) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {{sourceCount:number, publishedAt:number|Date, weights:number[], tagged?:boolean, now?:number}} input
 *   tagged=true 时加 HOT_TAG_BONUS（惠民标签提权，D-14）
 * @returns {number} 0–100 的整数
 */
function hotScore(input) {
  const sourceCount = input.sourceCount || 0;
  const ages = input.publishedAt;
  const publishedMs = ages instanceof Date ? ages.getTime() : ages;
  const now = input.now === undefined ? Date.now() : input.now;

  const cover = coverScore(sourceCount);
  const fresh = freshness(publishedMs, now);
  const weight = meanWeight(input.weights);

  const raw = C.HOT_W_COVER * cover + C.HOT_W_FRESH * fresh + C.HOT_W_SOURCE * weight;
  const tagBonus = input.tagged ? C.HOT_TAG_BONUS : 0;
  return clamp(Math.round(raw * 100) + tagBonus, 0, 100);
}

/** 用聚类结果算热度：sourceCount 取不同 source_id 数，W 取成员权重均值 */
function scoreCluster(cluster, now) {
  const members = cluster.members || [];
  const sourceIds = new Set(members.map((m) => m.source_id));
  const weights = [];
  for (const id of sourceIds) {
    const one = members.find((m) => m.source_id === id);
    weights.push(typeof one.source_weight === 'number' ? one.source_weight : 1);
  }
  const published = members.reduce((min, m) => {
    const t = m.published_at instanceof Date ? m.published_at.getTime() : m.published_at;
    return !min || t < min ? t : min;
  }, 0);

  // 惠民标签提权（D-14）：簇内任一成员带标签即加 HOT_TAG_BONUS
  const tagged = members.some((m) => Array.isArray(m.tags) && m.tags.length > 0);

  return hotScore({
    sourceCount: sourceIds.size,
    publishedAt: published,
    weights: weights,
    tagged: tagged,
    now: now
  });
}

module.exports = { coverScore, freshness, meanWeight, hotScore, scoreCluster };
