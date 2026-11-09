// pages/news/archive/index.js - 归档页（月历 + 当日列表）
const api = require('../../../utils/news-api')
const date = require('../../../utils/date')

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

Page({
  data: {
    month: '',
    monthText: '',
    weekNames: WEEK,
    cells: [],
    selectedDay: '',
    selectedText: '',
    items: [],
    listTotal: 0,
    loading: true,
    listLoading: false,
    error: '',
    minDay: '',
    maxDay: '',
    canPrev: false,
    canNext: false
  },

  onLoad(options) {
    const today = date.formatDay()
    const selected = (options && options.date) || today
    const month = /^\d{4}-\d{2}$/.test(String(selected).slice(0, 7)) ? String(selected).slice(0, 7) : today.slice(0, 7)
    this.setData({ selectedDay: selected, month: month })
    this.loadCalendar(month)
  },

  async loadCalendar(month) {
    this.setData({ loading: true, error: '' })
    const res = await api.getCalendar(month)
    if (!res.ok) {
      this.setData({ loading: false, error: res.error.message })
      return
    }
    const data = res.data || {}
    const minDay = data.minDay || ''
    const maxDay = data.maxDay || date.formatDay()
    const cells = this.buildCells(month, data.counts || {}, minDay, maxDay, this.data.selectedDay)
    this.setData({
      month: month,
      monthText: month.replace('-', ' 年 ') + ' 月',
      cells: cells,
      minDay: minDay,
      maxDay: maxDay,
      canPrev: month > minDay.slice(0, 7),
      canNext: month < maxDay.slice(0, 7),
      loading: false,
      selectedText: date.formatDayText(this.data.selectedDay)
    })
    this.loadList(this.data.selectedDay)
  },

  buildCells(month, counts, minDay, maxDay, selected) {
    const parts = month.split('-')
    const year = Number(parts[0])
    const mon = Number(parts[1])
    const firstWeekday = new Date(year, mon - 1, 1).getDay()
    const daysInMonth = new Date(year, mon, 0).getDate()
    const cells = []

    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push({ key: 'pad-' + i, day: '', label: '', empty: true, disabled: true, hasData: false, count: 0 })
    }

    for (let d = 1; d <= daysInMonth; d += 1) {
      const day = year + '-' + pad2(mon) + '-' + pad2(d)
      const count = counts[day] || 0
      cells.push({
        key: day,
        day: day,
        label: String(d),
        empty: false,
        count: count,
        hasData: count > 0,
        disabled: (minDay && day < minDay) || day > maxDay,
        isToday: day === maxDay,
        isSelected: day === selected
      })
    }
    return cells
  },

  async loadList(day) {
    if (!day) return
    this.setData({ listLoading: true })
    const res = await api.listNews({ day: day, pageSize: 50 })
    if (!res.ok) {
      this.setData({ listLoading: false, items: [], error: res.error.message })
      return
    }
    this.setData({
      listLoading: false,
      items: (res.data && res.data.items) || [],
      listTotal: (res.data && res.data.total) || 0
    })
  },

  onDayTap(e) {
    const day = e.currentTarget.dataset.day
    const cell = this.data.cells.find((c) => c.day === day)
    if (!cell || cell.empty) return
    if (cell.disabled) {
      wx.showToast({ title: '该日期超出可回看范围', icon: 'none' })
      return
    }
    if (!cell.hasData) {
      wx.showToast({ title: '这一天没有记录', icon: 'none' })
    }
    const cells = this.data.cells.map((c) =>
      Object.assign({}, c, { isSelected: c.day === day })
    )
    this.setData({ cells: cells, selectedDay: day, selectedText: date.formatDayText(day) })
    this.loadList(day)
  },

  changeMonth(delta) {
    const parts = this.data.month.split('-')
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1)
    const month = d.getFullYear() + '-' + pad2(d.getMonth() + 1)
    if (month < this.data.minDay.slice(0, 7)) return
    if (month > this.data.maxDay.slice(0, 7)) return
    const selected = month === this.data.maxDay.slice(0, 7) ? this.data.maxDay : month + '-01'
    this.setData({ selectedDay: selected, month: month })
    this.loadCalendar(month)
  },

  onPrevMonth() {
    this.changeMonth(-1)
  },

  onNextMonth() {
    this.changeMonth(1)
  },

  onCardTap(e) {
    const id = e.detail && e.detail.id
    if (!id) return
    wx.navigateTo({ url: '/pages/news/detail/index?id=' + id })
  },

  onRetry() {
    this.loadCalendar(this.data.month)
  }
})

