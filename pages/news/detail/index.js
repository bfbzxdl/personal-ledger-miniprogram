// pages/news/detail/index.js - 详情页
const api = require('../../../utils/news-api')
const date = require('../../../utils/date')
const { CONTENT_MAX_CHARS } = require('../../../config/news')

Page({
  data: {
    id: '',
    loading: true,
    error: '',
    news: null,
    related: [],
    contentHtml: '',
    truncated: false,
    isPolicy: false,
    timeText: ''
  },

  onLoad(options) {
    const id = (options && options.id) || ''
    this.setData({ id: id })
    if (!id) {
      this.setData({ loading: false, error: '内容已失效' })
      return
    }
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    const res = await api.getNews(this.data.id)
    if (!res.ok) {
      this.setData({
        loading: false,
        error: res.error.code === 'E_NOT_FOUND' ? '内容已失效' : res.error.message
      })
      return
    }

    const data = res.data || {}
    const news = data.news || {}
    let html = news.contentHtml || ''
    let truncated = false
    if (html.length > CONTENT_MAX_CHARS) {
      html = html.slice(0, CONTENT_MAX_CHARS)
      truncated = true
    }

    this.setData({
      loading: false,
      news: news,
      related: data.related || [],
      contentHtml: html,
      truncated: truncated,
      isPolicy: news.category === 'policy',
      timeText: date.formatDateTime(news.publishedAt)
    })
    api.track('detail_view', { id: this.data.id, category: news.category })
  },

  // R-10.3：复制原文链接，成功/失败都有 toast
  onCopyLink() {
    const news = this.data.news
    if (!news || !news.url) return
    wx.setClipboardData({
      data: news.url,
      success: () => {
        wx.showToast({ title: '已复制链接', icon: 'none' })
        api.track('copy_link', { id: this.data.id })
      },
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    })
  },

  // 同事件报道：在当前页替换，避免页面栈过深
  onRelatedTap(e) {
    const id = e.detail && e.detail.id
    if (!id || id === this.data.id) return
    wx.redirectTo({ url: '/pages/news/detail/index?id=' + id })
  },

  onRetry() {
    if (this.data.id) this.load()
  },

  // R-16：分享
  onShareAppMessage() {
    const news = this.data.news || {}
    return {
      title: news.title || '每日热点',
      path: '/pages/news/detail/index?id=' + this.data.id
    }
  }
})
