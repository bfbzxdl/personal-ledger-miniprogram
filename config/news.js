// config/news.js - 热点页展示配置（分类与惠民标签）
// 分类枚举见 docs/REQ.md §0；标签枚举见 docs/REQ.md R-14.3（8 类，来自 SOURCES.yaml）
const CATEGORIES = [
  { key: '', label: '热点' },
  { key: 'finance', label: '财经' },
  { key: 'policy', label: '政策' },
  { key: 'world', label: '国际' },
  { key: 'hangzhou', label: '杭州' }
]

const HANGZHOU_TAGS = ['社保医保', '公积金', '住房', '补贴消费券', '教育', '医疗', '交通出行', '政务办事']

// 正文展示上限（与 docs/REQ.md §1 CONTENT_MAX_CHARS 一致）
const CONTENT_MAX_CHARS = 5000

module.exports = { CATEGORIES, HANGZHOU_TAGS, CONTENT_MAX_CHARS }
