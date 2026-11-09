// pages/news/home/index.js - 热点页（今日分段）
const api = require('../../../utils/news-api')
const date = require('../../../utils/date')
const { CATEGORIES, HANGZHOU_TAGS } = require('../../../config/news')

const PAGE_SIZE = 20
const HISTORY_KEY = 'news:search-history'
const HISTORY_MAX = 10
const SEGMENTS = [
  { key: 'today', label: '今日' },
  { key: 'hot', label: '热榜' },
  { key: 'search', label: '搜索' }
]
const RANGES = [
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: 'all', label: '全部' }
]

Page({
  data: {
    segments: SEGMENTS,
    segment: 'today',
    categories: CATEGORIES,
    hzTags: HANGZHOU_TAGS,
    category: '',
    tag: '',
    day: '',
    dayText: '',
    items: [],
    page: 1,
    total: 0,
    hasMore: false,
    trends: [],
    hotItems: [],
    hotLoading: false,
    hotError: '',
    hotLoaded: false,
    skeleton: true,
    loadingMore: false,
    refreshing: false,
    error: '',
    emptyText: '',
    noticeText: '',
    updatedText: '',
    // 搜索
    searchKeyword: '',
    searchRange: '30d',
    ranges: RANGES,
    searchItems: [],
    searchTotal: 0,
    searchHasMore: false,
    searchPage: 1,
    searchLoading: false,
    searchError: '',
    searchSubmitted: false,
    searchHistory: []
  },

  onLoad() {
    const day = date.formatDay()
    this.setData({ day: day, dayText: date.formatDayText(day), searchHistory: this.loadHistory() })
    this.loadTrends()
    this.fetchList(true)
  },

  onShow() {
    if (this.getTabBar) {
      this.getTabBar().setData({ selected: 3 })
    }
    // 跨天自动刷新
    const day = date.formatDay()
    if (this.data.day && day !== this.data.day) {
      this.setData({ day: day, dayText: date.formatDayText(day), items: [], page: 1 })
      this.loadTrends()
      this.fetchList(true)
    }
    api.track('home_view', { segment: this.data.segment })
  },

  onPullDownRefresh() {
    this.onRefresh()
  },

  onReachBottom() {
    if (this.data.segment === 'search') {
      if (this.data.searchHasMore && !this.data.searchLoading) this.doSearch(false)
      return
    }
    if (this.data.segment !== 'today') return
    if (!this.data.hasMore || this.data.loadingMore) return
    this.fetchList(false)
  },

  // 列表：reset=true 时回到第一页
  async fetchList(reset) {
    const page = reset ? 1 : this.data.page + 1
    if (reset) {
      this.setData({ skeleton: this.data.items.length === 0, error: '' })
    } else {
      this.setData({ loadingMore: true })
    }

    const res = await api.listNews(
      {
        day: this.data.day,
        category: this.data.category || undefined,
        tag: this.data.tag || undefined,
        page: page,
        // R-18：今天无数据时由服务端回退到最近的昨日数据
        fallback: true
      },
      { noCache: reset && this.data.refreshing === true }
    )

    if (!res.ok) {
      this.setData({
        skeleton: false,
        loadingMore: false,
        error: res.error.message
      })
      return
    }

    const data = res.data || {}
    const items = reset ? data.items || [] : this.data.items.concat(data.items || [])

    this.setData({
      items: items,
      page: data.page || page,
      total: data.total || 0,
      hasMore: Boolean(data.hasMore),
      skeleton: false,
      loadingMore: false,
      error: '',
      updatedText: data.updatedAt ? '更新于 ' + date.formatClock(data.updatedAt) : '',
      // R-18：抓取失败回退到昨日数据时的黄色提示
      noticeText:
        data.fallback && data.updatedAt
          ? '数据更新于' + (data.day === date.formatDay(Date.now() - 86400000) ? '昨天' : data.day) + ' ' + date.formatClock(data.updatedAt)
          : '',
      emptyText: items.length ? '' : this.emptyTextFor()
    })
  },

  emptyTextFor() {
    if (this.data.tag) return '暂无「' + this.data.tag + '」相关惠民信息'
    if (this.data.category) return '这个分类今天暂时没有内容'
    return '今日数据还没准备好'
  },

  async loadTrends() {
    const res = await api.getTrends({ day: this.data.day })
    if (res.ok && res.data && res.data.items) {
      this.setData({ trends: res.data.items })
    }
  },

  // 热榜 Top10（R-07）
  async loadHot() {
    this.setData({ hotLoading: true, hotError: '' })
    const res = await api.getHot({ day: this.data.day })
    if (!res.ok) {
      this.setData({ hotLoading: false, hotError: res.error.message })
      return
    }
    const items = ((res.data && res.data.items) || []).map((item) => {
      const delta = item.delta || 0
      const text = item.change === 'up' ? '↑' + Math.abs(delta) : item.change === 'down' ? '↓' + Math.abs(delta) : item.change === 'new' ? '新' : ''
      return Object.assign({}, item, { changeText: text, changeType: item.change || '' })
    })
    this.setData({ hotLoading: false, hotItems: items, hotLoaded: true })
  },

  onHotRetry() {
    this.loadHot()
  },

  // 下拉刷新：服务端 10 分钟限频（R-13）
  async onRefresh() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    const res = await api.refresh()
    this.setData({ refreshing: false })
    if (wx.stopPullDownRefresh) wx.stopPullDownRefresh()

    if (!res.ok) {
      if (res.error.code === 'E_RATE_LIMIT' && res.error.nextAllowedAt) {
        const leftMin = Math.max(1, Math.ceil((res.error.nextAllowedAt - Date.now()) / 60000))
        wx.showToast({ title: '刚更新过，' + leftMin + ' 分钟后再试', icon: 'none' })
      } else {
        wx.showToast({ title: res.error.message, icon: 'none' })
      }
      return
    }

    const added = (res.data && res.data.added) || 0
    wx.showToast({ title: added > 0 ? '已更新 ' + added + ' 条' : '暂无新内容', icon: 'none' })
    api.track('refresh', { added: added })
    this.loadTrends()
    if (this.data.hotLoaded) this.loadHot()
    this.fetchList(true)
  },

  onSegmentTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.segment) return
    this.setData({ segment: key })
    if (key === 'hot' && !this.data.hotLoaded) this.loadHot()
    api.track('home_view', { segment: key })
  },

  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.category) return
    this.setData({ category: key, tag: '', items: [], page: 1, skeleton: true, error: '' })
    this.fetchList(true)
  },

  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag
    const next = tag === this.data.tag ? '' : tag
    this.setData({ tag: next, items: [], page: 1, skeleton: true, error: '' })
    this.fetchList(true)
  },

  onCardTap(e) {
    const id = e.detail && e.detail.id
    if (!id) return
    api.track('card_click', { id: id })
    wx.navigateTo({ url: '/pages/news/detail/index?id=' + id })
  },

  // 热搜点击 → 搜索分段并自动搜索（R-09.3）
  onTrendTap(e) {
    const keyword = (e.detail && e.detail.keyword) || ''
    if (!keyword) return
    this.setData({ segment: 'search', searchKeyword: keyword })
    this.saveHistory(keyword)
    api.track('search_submit', { keyword: keyword, from: 'trend' })
    this.doSearch(true)
  },

  onArchiveTap() {
    wx.navigateTo({ url: '/pages/news/archive/index?date=' + this.data.day })
  },

  // ---------------- 搜索（R-11） ----------------

  loadHistory() {
    try {
      const list = wx.getStorageSync(HISTORY_KEY)
      return Array.isArray(list) ? list.slice(0, HISTORY_MAX) : []
    } catch (err) {
      return []
    }
  },

  saveHistory(keyword) {
    const list = [keyword].concat(this.data.searchHistory.filter((k) => k !== keyword)).slice(0, HISTORY_MAX)
    this.setData({ searchHistory: list })
    try {
      wx.setStorageSync(HISTORY_KEY, list)
    } catch (err) {
      /* 存储失败忽略 */
    }
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value })
  },

  onSearchSubmit() {
    const keyword = String(this.data.searchKeyword || '').trim()
    if (!keyword) {
      wx.showToast({ title: '请输入关键词', icon: 'none' })
      return
    }
    this.setData({ searchKeyword: keyword, segment: 'search' })
    this.saveHistory(keyword)
    api.track('search_submit', { keyword: keyword })
    this.doSearch(true)
  },

  onRangeTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.searchRange) return
    this.setData({ searchRange: key })
    if (this.data.searchSubmitted) this.doSearch(true)
  },

  onHistoryTap(e) {
    const keyword = e.currentTarget.dataset.keyword
    this.setData({ searchKeyword: keyword, segment: 'search' })
    this.saveHistory(keyword)
    this.doSearch(true)
  },

  onClearHistory() {
    this.setData({ searchHistory: [] })
    try {
      wx.removeStorageSync(HISTORY_KEY)
    } catch (err) {
      /* ignore */
    }
  },

  // 搜索列表：reset=true 回到第一页
  async doSearch(reset) {
    const keyword = String(this.data.searchKeyword || '').trim()
    if (!keyword) return
    const page = reset ? 1 : this.data.searchPage + 1
    this.setData(reset ? { searchLoading: true, searchError: '' } : { searchLoading: true })

    const res = await api.search({
      keyword: keyword,
      range: this.data.searchRange,
      page: page
    })

    if (!res.ok) {
      this.setData({ searchLoading: false, searchError: res.error.message })
      return
    }

    const data = res.data || {}
    const items = reset ? data.items || [] : this.data.searchItems.concat(data.items || [])
    this.setData({
      searchItems: items,
      searchTotal: data.total || 0,
      searchHasMore: Boolean(data.hasMore),
      searchPage: data.page || page,
      searchLoading: false,
      searchError: '',
      searchSubmitted: true
    })
  },

  // R-09.4：无结果时可复制关键词
  onCopyKeyword() {
    const keyword = this.data.searchKeyword
    if (!keyword) return
    wx.setClipboardData({
      data: keyword,
      success: () => wx.showToast({ title: '已复制关键词', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    })
  },

  onSearchRetry() {
    this.doSearch(true)
  },

  onRetry() {
    if (this.data.error) {
      this.fetchList(true)
      this.loadTrends()
      return
    }
    this.fetchList(true)
  },

  // 空态次按钮：回到「热点」分类
  onBackToHot() {
    this.setData({ category: '', tag: '', items: [], page: 1, skeleton: true, error: '' })
    this.fetchList(true)
  }
})
