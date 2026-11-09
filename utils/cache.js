// utils/cache.js - 前端 Storage 缓存（TTL 见 docs/API.md §6）
const PREFIX = 'news:'

function key(name) {
  return PREFIX + name
}

// 读缓存：命中且未过期返回数据，否则 null
function read(name, ttlMs, now) {
  try {
    const raw = wx.getStorageSync(key(name))
    if (!raw || typeof raw !== 'object') return null
    const current = now || Date.now()
    if (!raw.t || current - raw.t > ttlMs) {
      wx.removeStorageSync(key(name))
      return null
    }
    return raw.v
  } catch (err) {
    return null
  }
}

// 写缓存（失败不影响主流程）
function write(name, value, now) {
  try {
    wx.setStorageSync(key(name), { t: now || Date.now(), v: value })
  } catch (err) {
    /* 存储满/隐私模式：忽略 */
  }
}

function remove(name) {
  try {
    wx.removeStorageSync(key(name))
  } catch (err) {
    /* ignore */
  }
}

// 清空所有热点缓存（下拉刷新后使用）
function clearAll() {
  try {
    const info = wx.getStorageInfoSync()
    const keys = (info && info.keys) || []
    for (const k of keys) {
      if (k.indexOf(PREFIX) === 0) wx.removeStorageSync(k)
    }
  } catch (err) {
    /* ignore */
  }
}

module.exports = { read, write, remove, clearAll, PREFIX }
