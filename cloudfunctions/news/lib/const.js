// cloudfunctions/news/lib/const.js
// 唯一常量来源：与 docs/REQ.md §1 一一对应。改动必须同批更新 REQ.md §1。
const C = {
  TZ: 'Asia/Shanghai',
  TZ_OFFSET_MIN: 480,
  FETCH_CRON: '0 30 6 * * * *',
  CLEAN_CRON: '0 40 6 * * * *',
  FETCH_TIMEOUT_MS: 8000,
  FETCH_RETRY: 1,
  FETCH_RETRY_DELAY_MS: 3000,
  FETCH_BATCH: 5,
  FETCH_MAX_MS: 40000,
  MAX_ITEMS_PER_SOURCE: 30,
  HTML_REQ_INTERVAL_MS: 1000,
  REFRESH_COOLDOWN_MIN: 10,
  PAGE_SIZE: 20,
  PAGE_SIZE_MAX: 50,
  RETENTION_DAYS: 90,
  TITLE_MAX: 200,
  SUMMARY_MAX: 120,
  CONTENT_MAX_CHARS: 5000,
  CONTENT_MAX_BYTES: 102400,
  CLUSTER_THRESHOLD: 0.6,
  HOT_W_COVER: 0.55,
  HOT_W_FRESH: 0.30,
  HOT_W_SOURCE: 0.15,
  HOT_TAG_BONUS: 6,
  TOP_N: 10,
  TREND_FETCH_N: 20,
  TREND_SHOW_N: 10,
  MAX_TAGS: 3,
  RELATED_MAX: 5
};

// 分类枚举与 Tab 映射（REQ §0）
const CATEGORIES = ['finance', 'policy', 'world', 'hangzhou', 'general'];

// 错误码（docs/API.md §5）
const ERR = {
  PARAM: 'E_PARAM',
  NOT_FOUND: 'E_NOT_FOUND',
  RATE_LIMIT: 'E_RATE_LIMIT',
  SOURCE: 'E_SOURCE',
  INTERNAL: 'E_INTERNAL',
  FORBIDDEN: 'E_FORBIDDEN'
};

// fetch_logs.status 枚举（docs/API.md §2.5）
const SOURCE_STATUS = ['ok', 'fail', 'timeout', 'skipped', 'structure_changed'];

module.exports = { C, CATEGORIES, ERR, SOURCE_STATUS };
