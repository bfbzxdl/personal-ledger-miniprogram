// cloudfunctions/news/lib/seed.js
// T-03：把 docs/SOURCES.yaml 生成的种子数据写入 sources 与 config/tag_rules。
// 幂等：按 sources.id 判断新增/更新；config/tag_rules 为单文档覆盖写。
const seed = require('./seed-sources');

// 可配置字段（重跑种子时覆盖这些；运行期统计字段 fail_count 等保持不变）
const CONFIG_FIELDS = [
  'name', 'adapter', 'url', 'linkMatch', 'category', 'kind',
  'weight', 'enabled', 'verified', 'issuer', 'note', 'filter', 'titleStrip'
];

// 相关性过滤（D-15）：sources.id -> { anyKeywords, excludeKeywords }
const RELEVANCE = new Map(
  (seed.relevanceFilters || []).map((r) => [
    r.id,
    {
      anyKeywords: (r.anyKeywords || []).slice(),
      excludeKeywords: (r.excludeKeywords || []).slice()
    }
  ])
);

function sourceValues(src) {
  const filter = RELEVANCE.get(src.id);
  const v = {
    name: src.name || '',
    adapter: src.adapter || 'rss',
    url: src.url || '',
    linkMatch: src.linkMatch || '',
    category: src.category || 'general',
    kind: src.kind || 'news',
    weight: typeof src.weight === 'number' ? src.weight : 1,
    enabled: src.enabled !== false,
    verified: src.verified === true,
    issuer: src.issuer || '',
    note: src.note || '',
    filter: filter && filter.anyKeywords.length ? filter : null,
    titleStrip: Array.isArray(src.titleStrip) ? src.titleStrip.slice() : []
  };
  return v;
}

async function seedSources(db, options) {
  const opts = options || {};
  const now = opts.now || new Date();
  const sources = seed.sources || [];
  const col = db.collection('sources');

  let inserted = 0;
  let updated = 0;

  for (const src of sources) {
    const found = await col.where({ id: src.id }).limit(1).get();
    const existing = (found.data && found.data[0]) || null;
    const values = sourceValues(src);

    if (existing) {
      values.updated_at = now;
      await col.doc(existing._id).update({ data: values });
      updated += 1;
    } else {
      values.id = src.id;
      values.fail_count = 0;
      values.last_fetch_at = null;
      values.disabled_reason = '';
      values.verified_at = src.verified === true ? now : null;
      values.created_at = now;
      values.updated_at = now;
      await col.add({ data: values });
      inserted += 1;
    }
  }

  const rules = (seed.tagRules || []).map((r) => ({
    tag: r.tag,
    keywords: (r.keywords || []).slice()
  }));

  const cfg = db.collection('config');
  const foundCfg = await cfg.where({ _id: 'tag_rules' }).limit(1).get();
  const cfgDoc = (foundCfg.data && foundCfg.data[0]) || null;
  if (cfgDoc) {
    await cfg.doc('tag_rules').update({ data: { rules: rules, updated_at: now } });
  } else {
    await cfg.add({ data: { _id: 'tag_rules', rules: rules, updated_at: now } });
  }

  return {
    inserted: inserted,
    updated: updated,
    total: sources.length,
    tagRules: rules.length,
    verified: sources.filter((s) => s.verified === true).length
  };
}

/** 供 fetch 阶段使用：把种子源转成内存配置（不读写数据库） */
function seedSourceList() {
  return (seed.sources || []).map((src) => Object.assign({ id: src.id }, sourceValues(src)));
}

module.exports = { seedSources, seedSourceList, CONFIG_FIELDS, SEED: seed };
