// utils/date.js - 时间展示（客户端本地时区）
function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

// 毫秒时间戳 -> "刚刚 / 12 分钟前 / 3 小时前 / 昨天 09:30 / 11-06 18:20 / 2025-11-06"
function formatTimeAgo(ms, now) {
  if (!ms) return ''
  const t = typeof ms === 'number' ? ms : Date.parse(ms)
  if (!t || Number.isNaN(t)) return ''
  const current = now || Date.now()
  const diff = current - t
  if (diff < 0) return '刚刚'
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前'

  const d = new Date(t)
  const clock = pad(d.getHours()) + ':' + pad(d.getMinutes())
  const dayStart = new Date(current)
  dayStart.setHours(0, 0, 0, 0)
  if (t >= dayStart.getTime() - 24 * 3600000) return '昨天 ' + clock
  if (d.getFullYear() === new Date(current).getFullYear()) {
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + clock
  }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

// 毫秒时间戳 -> "YYYY-MM-DD"（本地日期）
function formatDay(ms) {
  const d = ms ? new Date(ms) : new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

// 毫秒时间戳 -> "MM-DD HH:mm"
function formatDateTime(ms) {
  const d = new Date(ms)
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

// 毫秒时间戳 -> "HH:mm"
function formatClock(ms) {
  const d = new Date(ms)
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

// YYYY-MM-DD -> "11 月 8 日"
function formatDayText(day) {
  const parts = String(day || '').split('-')
  if (parts.length !== 3) return day || ''
  return Number(parts[1]) + ' 月 ' + Number(parts[2]) + ' 日'
}

module.exports = { formatTimeAgo, formatDay, formatDateTime, formatClock, formatDayText }
