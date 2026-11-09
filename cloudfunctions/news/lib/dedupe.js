// cloudfunctions/news/lib/dedupe.js
// T-05 去重（R-04）：URL 规范化 + sha1；同日同标题保留权重最高的源。
const crypto = require('crypto');

// 常见跟踪参数（R-04.1：utm_* / spm / from / ref）
const TRACKING_PARAMS = new Set(['spm', 'from', 'ref', 'referer', 'source', 'share_token', 'share']);

function normalizeUrl(input) {
  const raw = String(input === undefined || input === null ? '' : input).trim();
  if (!raw) return '';
  let u;
  try {
    u = new URL(raw);
  } catch (err) {
    return raw;
  }

  u.hash = '';
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
    u.port = '';
  }

  const kept = new URLSearchParams();
  for (const [k, v] of u.searchParams) {
    const key = k.toLowerCase();
    if (key.startsWith('utm_') || TRACKING_PARAMS.has(key)) continue;
    kept.append(k, v);
  }
  const qs = kept.toString();
  u.search = qs ? '?' + qs : '';

  // 去末尾 /（只处理 path，避免影响 query）
  u.pathname = u.pathname.replace(/\/+$/, '');

  return u.toString();
}

function urlHash(url) {
  return crypto.createHash('sha1').update(normalizeUrl(url)).digest('hex');
}

function titleKey(title) {
  return String(title || '').replace(/\s+/g, '');
}

/**
 * 去重：先按 URL（保留 weight 最高者），再按「同一天 + 完全一致的标题」
 * 去重（trend 条目不参与标题去重，R-04.4）。返回新数组并补 url_hash。
 */
function dedupeItems(items) {
  const urlWinners = new Map();
  for (const item of items || []) {
    const key = normalizeUrl(item.url);
    if (!key) continue;
    const prev = urlWinners.get(key);
    if (!prev || (item.source_weight || 0) > (prev.source_weight || 0)) {
      urlWinners.set(key, item);
    }
  }

  const titleWinners = new Map();
  for (const item of urlWinners.values()) {
    if (item.is_trend) continue;
    const key = (item.day || '') + '|' + titleKey(item.title);
    const prev = titleWinners.get(key);
    if (!prev || (item.source_weight || 0) > (prev.source_weight || 0)) {
      titleWinners.set(key, item);
    }
  }

  const out = [];
  for (const [url, item] of urlWinners) {
    item.url_hash = urlHash(url);
    if (!item.is_trend) {
      const key = (item.day || '') + '|' + titleKey(item.title);
      if (titleWinners.get(key) !== item) continue;
    }
    out.push(item);
  }
  return out;
}

module.exports = { normalizeUrl, urlHash, titleKey, dedupeItems, TRACKING_PARAMS };
