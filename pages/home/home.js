// pages/home/home.js - 首页（每日壁纸 + 鼓励语）
const wallpapers = require('../../config/wallpapers')
const dayjs = require('dayjs')

Page({
  data: {
    wallpaper: '',   // 今日壁纸
    quote: '',       // 今日鼓励语
    today: '',       // 已加载内容的日期
    tip: '点击下方标签开始使用'
  },

  onLoad() {
    const today = dayjs().format('YYYY-MM-DD')
    this.setData({ today: today })
    this.applyLocal()
    this.refreshDaily()
  },

  onShow() {
    if (this.getTabBar) {
      this.getTabBar().setData({ selected: 0 })
    }
    // 跨天自动刷新
    const today = dayjs().format('YYYY-MM-DD')
    if (today !== this.data.today) {
      this.setData({ today: today })
      this.refreshDaily()
    }
  },

  // 本地兜底：星期壁纸 + 日期鼓励语
  applyLocal() {
    this.setData({
      wallpaper: wallpapers.getTodayWallpaper(),
      quote: wallpapers.getTodayQuote()
    })
  },

  // 远程内容：云函数每日抓取，成功则替换本地兜底
  async refreshDaily() {
    const content = await wallpapers.fetchDailyContent()
    if (content && content.wallpaper) {
      this.setData({
        wallpaper: content.wallpaper,
        quote: content.quote || this.data.quote
      })
    }
  },

  // 远程壁纸加载失败时回退本地
  onImageError() {
    if (String(this.data.wallpaper).indexOf('cloud://') === 0) {
      this.applyLocal()
    }
  },

  // 点击功能图标 → 切换底部菜单
  onGuideTap(e) {
    const path = e.currentTarget.dataset.path
    wx.switchTab({ url: path })
  },

  // 长按标题 → 进入管理员数据管理（云端校验权限）
  onAdminTap() {
    wx.showLoading({ title: '校验中' })
    wx.cloud.callFunction({
      name: 'admin',
      data: { action: 'check' }
    }).then((res) => {
      wx.hideLoading()
      const result = res.result || {}
      if (result.code === 0 && result.data && result.data.isAdmin) {
        wx.navigateTo({
          url: '/pages/admin/admin'
        })
      } else {
        wx.showToast({ title: '无管理员权限', icon: 'none' })
      }
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '校验失败，请确认云函数已部署', icon: 'none' })
    })
  }
})
