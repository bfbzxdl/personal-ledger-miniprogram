// utils/news-api.js - 云函数 news 的调用封装（错误码映射见 docs/API.md §5）
const cache = require('./cache')

const CLOUD_FN = 'news'

// 列表缓存 5 分钟、热搜 30 分钟（API §6）
const TTL_LIST = 5 * 60 * 1000
const TTL_TREND = 30 * 60 * 1000

const ERROR_MESSAGES = {
  E_PARAM: '参数有误',
  E_NOT_FOUND: '内容已失效',
  E_RATE_LIMIT: '刚更新过，请稍后再试',
  E_SOURCE: '数据源暂时不可用',
  E_INTERNAL: '服务暂时不可用',
  E_FORBIDDEN: '无权限',
  E_SERVICE: '服务未就绪',
  E_NETWORK: '网络不给力，点我重试'
}

// 云函数调用失败时区分「未部署 / 执行崩溃 / 真断网」，避免统一显示成网络错误
function mapCloudFailure(e) {
  const msg = String((e && (e.errMsg || e.message)) || '')
  if (/FUNCTION_NOT_FOUND|-501000/.test(msg)) {
    return { code: 'E_SERVICE', message: '云函数 news 未部署，请在开发者工具中上传部署', raw: msg }
  }
  if (/-504002|functions execute fail/.test(msg)) {
    return { code: 'E_SERVICE', message: '云函数执行失败，请查看云开发控制台日志', raw: msg }
  }
  const error = mapError('E_NETWORK')
  if (msg) error.raw = msg
  return error
}

// 统一错误对象：{ code, message, nextAllowedAt? }
function mapError(code, message, extra) {
  const key = ERROR_MESSAGES[code] ? code : 'E_INTERNAL'
  const error = {
    code: key,
    message: ERROR_MESSAGES[key]
  }
  if (extra && extra.nextAllowedAt) error.nextAllowedAt = extra.nextAllowedAt
  if (!ERROR_MESSAGES[code] && message) error.raw = String(message)
  return error
}

// 调用云函数；永不抛出，统一返回 { ok, data } / { ok:false, error }
async function call(action, data) {
  if (!wx.cloud || !wx.cloud.callFunction) {
    return { ok: false, error: mapError('E_NETWORK') }
  }
  try {
    const res = await wx.cloud.callFunction({
      name: CLOUD_FN,
      data: Object.assign({ action: action }, data || {})
    })
    const result = res && res.result
    if (result && result.ok) {
      return { ok: true, data: result.data || {} }
    }
    const err = (result && result.error) || {}
    return { ok: false, error: mapError(err.code, err.message, err) }
  } catch (e) {
    return { ok: false, error: mapCloudFailure(e) }
  }
}

// 带缓存的读接口：空列表不写缓存（否则数据未就绪时会把「空」缓存 5/30 分钟）
async function cached(name, ttl, fetcher) {
  const hit = cache.read(name, ttl)
  if (hit) return { ok: true, data: hit, fromCache: true }
  const res = await fetcher()
  if (res.ok && !isEmptyPayload(res.data)) cache.write(name, res.data)
  return res
}

function isEmptyPayload(data) {
  if (!data) return true
  if (Array.isArray(data.items) && data.items.length === 0) return true
  return false
}

// R-08 首页列表
function listNews(params, options) {
  const p = params || {}
  const page = p.page || 1
  const name = 'list:' + (p.day || 'today') + ':' + (p.category || 'all') + ':' + (p.tag || 'all') + ':' + page
  const opts = options || {}
  const fetcher = () => call('listNews', { day: p.day, category: p.category, tag: p.tag, page: page, pageSize: p.pageSize })
  if (opts.noCache) return fetcher()
  return cached(name, TTL_LIST, fetcher)
}

// R-09 热搜
function getTrends(params) {
  const p = params || {}
  return cached('trend:' + (p.day || 'today'), TTL_TREND, () => call('getTrends', { day: p.day }))
}

// R-07 热榜
function getHot(params) {
  const p = params || {}
  return cached('hot:' + (p.day || 'today'), TTL_LIST, () => call('getHot', { day: p.day }))
}

// R-10 详情
function getNews(id) {
  return call('getNews', { id: id })
}

// R-11 搜索
function search(params) {
  const p = params || {}
  return call('search', {
    keyword: p.keyword,
    range: p.range || '30d',
    page: p.page || 1,
    pageSize: p.pageSize
  })
}

// R-12 归档月历
function getCalendar(month) {
  return call('getCalendar', { month: month })
}

// R-13 手动刷新（成功后清空列表缓存）
async function refresh() {
  const res = await call('refresh')
  if (res.ok) cache.clearAll()
  return res
}

// R-17 埋点：失败不影响主流程
function track(event, payload) {
  try {
    if (wx.reportEvent) {
      wx.reportEvent(event, payload || {})
      return
    }
    call('track', { event: event, payload: payload || {} })
  } catch (err) {
    /* ignore */
  }
}

module.exports = {
  call,
  mapError,
  mapCloudFailure,
  listNews,
  getTrends,
  getHot,
  getNews,
  search,
  getCalendar,
  refresh,
  track,
  TTL_LIST,
  TTL_TREND,
  ERROR_MESSAGES
}
