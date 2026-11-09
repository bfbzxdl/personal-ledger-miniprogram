// cloudfunctions/news/lib/cluster.js
// T-05 事件聚类（R-05）：标题归一化 + 字符 bigram Jaccard。
const { C } = require('./const');
const { dayOf } = require('./time');

/** R-05.2 / §3.1：去来源前缀 → 全角转半角 → 去标点空白 → 小写 */
function normalizeTitle(title) {
  let s = String(title || '');
  s = s.replace(/^(【[^】]{1,10}】|\[[^\]]{1,10}\])\s*/, '');
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/[\s\p{P}]/gu, '');
  return s.toLowerCase();
}

/** 字符 bigram 集合；单字符标题退化为单字符集合 */
function bigrams(text) {
  const chars = Array.from(String(text || ''));
  const set = new Set();
  if (chars.length === 0) return set;
  if (chars.length === 1) {
    set.add(chars[0]);
    return set;
  }
  for (let i = 0; i < chars.length - 1; i += 1) set.add(chars[i] + chars[i + 1]);
  return set;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function similarity(titleA, titleB) {
  return jaccard(bigrams(normalizeTitle(titleA)), bigrams(normalizeTitle(titleB)));
}

function msOf(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return 0;
}

/**
 * 仅当日、非 trend 条目参与聚类（R-05.1）。
 * @returns {Array<{key:string, day:string, title:string, summary:string, category:string,
 *   sourceCount:number, members:Array, newsKeys:string[], firstSeenAt:number, cover:string}>}
 */
function clusterItems(items, options) {
  const opts = options || {};
  const threshold = opts.threshold === undefined ? C.CLUSTER_THRESHOLD : opts.threshold;
  const now = opts.now === undefined ? Date.now() : opts.now;
  const day = opts.day || dayOf(now);

  const pool = (items || [])
    .filter((it) => !it.is_trend && (it.day || dayOf(msOf(it.published_at) || now)) === day)
    .sort((a, b) => {
      const fa = msOf(a.fetched_at);
      const fb = msOf(b.fetched_at);
      if (fa !== fb) return fa - fb;
      return msOf(a.published_at) - msOf(b.published_at);
    });

  const clusters = [];
  for (const item of pool) {
    const grams = bigrams(normalizeTitle(item.title));
    let target = null;
    for (const c of clusters) {
      for (const memberGrams of c.grams) {
        if (jaccard(grams, memberGrams) >= threshold) {
          target = c;
          break;
        }
      }
      if (target) break;
    }
    if (!target) {
      target = { members: [], grams: [] };
      clusters.push(target);
    }
    target.members.push(item);
    target.grams.push(grams);
  }

  return clusters.map((c) => {
    const members = c.members;
    const earliest = members[0];
    const best = members.reduce((a, b) => ((b.source_weight || 0) > (a.source_weight || 0) ? b : a), members[0]);
    const key = earliest.url_hash || ('k' + msOf(earliest.fetched_at));
    for (const m of members) m.event_key = key;

    return {
      key: key,
      day: earliest.day || day,
      title: best.title,
      summary: best.summary,
      category: best.category,
      sourceCount: new Set(members.map((m) => m.source_id)).size,
      members: members,
      newsKeys: members.map((m) => m.url_hash),
      firstSeenAt: msOf(earliest.fetched_at) || now,
      cover: members.find((m) => m.cover) ? members.find((m) => m.cover).cover : ''
    };
  });
}

module.exports = { normalizeTitle, bigrams, jaccard, similarity, clusterItems };
