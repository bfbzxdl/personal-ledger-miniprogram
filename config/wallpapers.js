// config/wallpapers.js - 壁纸与鼓励语数据源（预留网络扩展）
const dayjs = require('dayjs')

// 本地壁纸（周一至周日，与 assets/wallpapers/ 目录对应）
const LOCAL_WALLPAPERS = [
  '/assets/wallpapers/monday.jpg',
  '/assets/wallpapers/tuesday.jpg',
  '/assets/wallpapers/wednesday.jpg',
  '/assets/wallpapers/thursday.jpg',
  '/assets/wallpapers/friday.jpg',
  '/assets/wallpapers/saturday.jpg',
  '/assets/wallpapers/sunday.jpg'
]

// 鼓励语文案库（30句，按日期循环）
const QUOTES = [
  '每天节省一点点，退休别墅靠大海',
  '时间就是金钱，记录创造价值',
  '记账不是限制，而是看清生活的开始',
  '钱花在哪儿，人生就往哪儿走',
  '今天的每一笔记录，都是明天的底气',
  '自律给我自由，记录给我方向',
  '攒钱最好的时间是十年前，其次是现在',
  '小钱不记，大钱不来',
  '把日子过清楚，把账记明白',
  '每一次记录，都是对生活的一次复盘',
  '财富自由的第一步，是知道钱去哪儿了',
  '节俭不是抠门，是聪明的选择',
  '用心记账，用爱生活',
  '收支有数，心里不慌',
  '一杯奶茶的钱，一年也能攒出一趟旅行',
  '记录让消费变得清醒',
  '钱要花在刀刃上，账要记在心底里',
  '真正的富有，是清楚的知道自己拥有什么',
  '每天进步一点点，账户余额多一点',
  '记账的人，运气不会太差',
  '省下的每一分钱，都是未来的加分项',
  '生活需要仪式感，财务需要掌控感',
  '把目标写下来，把账记下来，日子会越来越好',
  '消费降级不是委屈，是给未来让路',
  '理财第一步：先搞清楚钱花在哪',
  '坚持记账第N天，离目标又近一点',
  '钱不是省出来的，但一定是从记录中理出来的',
  '看得见的数字，才有看不见的底气',
  '记录当下的每一笔，成就未来的每一步',
  '慢慢来，比较快；慢慢攒，比较富'
]

// 统一接口：获取今日壁纸
function getTodayWallpaper() {
  // 未来扩展点：这里可以改成 wx.request 获取网络图片
  const dayIndex = dayjs().day() === 0 ? 6 : dayjs().day() - 1
  return LOCAL_WALLPAPERS[dayIndex]
}

// 统一接口：获取今日鼓励语
function getTodayQuote() {
  // 未来扩展点：这里可以改成调用 "一言" 等网络API
  const dateIndex = dayjs().date() - 1
  return QUOTES[dateIndex % QUOTES.length]
}

// 远程接口：从云函数获取每日壁纸（云存储 fileID）与鼓励语，失败返回 null
async function fetchDailyContent() {
  if (!wx.cloud) return null
  try {
    const res = await wx.cloud.callFunction({
      name: 'daily-content',
      data: { action: 'get' }
    })
    const result = res.result || {}
    if (result.code !== 0 || !result.data) return null
    return {
      wallpaper: result.data.wallpaper,
      quote: result.data.quote
    }
  } catch (e) {
    return null
  }
}

module.exports = { getTodayWallpaper, getTodayQuote, fetchDailyContent }
