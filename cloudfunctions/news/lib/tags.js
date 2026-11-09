// cloudfunctions/news/lib/tags.js
// T-05 惠民标签（R-14）：按 tag_rules 声明顺序匹配 title + summary，最多 MAX_TAGS 个。
const { C } = require('./const');

// 机关名噪声：避免「人力社保局」「人社局」这类单位名把普通时政稿打成社保/医保
const ORG_NOISE = /(人力资源和社会保障局|人力社保局|人社局|社保局|医保局|公积金管理中心)/g;
// 招聘/采购类公告不属于惠民服务，不打标
const NOT_BENEFIT_RE = /(招聘|拟聘用|拟录用|拟聘|招标|中标|成交公告|采购公告|询价)/;

/**
 * @param {string} title
 * @param {string} summary
 * @param {Array<{tag:string, keywords:string[]}>} rules
 * @param {number} [max]
 * @returns {string[]} 命中的标签（去重、按规则顺序）
 */
function matchTags(title, summary, rules, max) {
  const limit = max === undefined ? C.MAX_TAGS : max;
  const rawTitle = String(title || '');
  if (NOT_BENEFIT_RE.test(rawTitle)) return [];
  const text = (rawTitle + ' ' + String(summary || ''))
    .replace(ORG_NOISE, ' ')
    .toLowerCase();
  const out = [];

  for (const rule of rules || []) {
    if (out.length >= limit) break;
    if (!rule || !rule.tag || out.includes(rule.tag)) continue;
    const hit = (rule.keywords || []).some((kw) => kw && text.includes(String(kw).toLowerCase()));
    if (hit) out.push(rule.tag);
  }
  return out;
}

module.exports = { matchTags };
