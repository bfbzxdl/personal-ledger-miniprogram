// 云函数：每日抓取壁纸（Bing每日壁纸）与鼓励语（一言），缓存到云存储/云数据库
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLLECTION = 'daily_content'
const WALLPAPER_API = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN'
const QUOTE_API = 'https://v1.hitokoto.cn/?c=d&c=i&c=k&max_length=60'

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function requestJson(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode))
        return
      }
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', function (chunk) { raw += chunk })
      res.on('end', function () {
        try {
          resolve(JSON.parse(raw))
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

function requestBuffer(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode))
        return
      }
      const chunks = []
      res.on('data', function (chunk) { chunks.push(chunk) })
      res.on('end', function () {
        resolve(Buffer.concat(chunks))
      })
    }).on('error', reject)
  })
}

async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION)
  } catch (e) {
    // 集合已存在
  }
}

async function fetchWallpaperFileId() {
  const data = await requestJson(WALLPAPER_API)
  const url = data.images && data.images[0] && data.images[0].url
  if (!url) throw new Error('壁纸接口无数据')
  const full = url.indexOf('http') === 0 ? url : 'https://www.bing.com' + url
  const buffer = await requestBuffer(full)
  const cloudPath = 'wallpapers/' + todayStr() + '.jpg'
  const upload = await cloud.uploadFile({ cloudPath: cloudPath, fileContent: buffer })
  return upload.fileID
}

async function fetchQuote() {
  const data = await requestJson(QUOTE_API)
  return (data && data.hitokoto) || ''
}

async function getTodayDoc() {
  try {
    const res = await db.collection(COLLECTION).doc(todayStr()).get()
    return res.data
  } catch (e) {
    return null
  }
}

async function refresh() {
  const old = await getTodayDoc()
  let wallpaper = (old && old.wallpaper) || ''
  let quote = (old && old.quote) || ''

  try {
    wallpaper = await fetchWallpaperFileId()
  } catch (e) {}
  try {
    quote = await fetchQuote()
  } catch (e) {}

  if (!wallpaper && !quote) {
    return { code: 1, msg: '外部接口获取失败' }
  }

  const doc = {
    date: todayStr(),
    wallpaper: wallpaper,
    quote: quote,
    updatedAt: Date.now()
  }
  await db.collection(COLLECTION).doc(todayStr()).set({ data: doc })
  return { code: 0, data: { wallpaper: doc.wallpaper, quote: doc.quote } }
}

exports.main = async (event) => {
  await ensureCollection()
  const action = event.action || 'get'

  if (action === 'refresh') {
    return refresh()
  }

  if (action === 'get') {
    const doc = await getTodayDoc()
    if (doc && doc.wallpaper) {
      return { code: 0, data: { wallpaper: doc.wallpaper, quote: doc.quote || '' } }
    }
    const refreshed = await refresh()
    if (refreshed.code === 0) return refreshed
    return { code: 1, msg: '暂无今日内容' }
  }

  return { code: 400, msg: '未知操作' }
}
