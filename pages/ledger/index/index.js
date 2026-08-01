// pages/ledger/index/index.js - 记账本主页
const ledgerStorage = require('../../../utils/ledger-storage')
const categories = require('../../../config/ledger-categories')

// 金额格式化：千分位 + 两位小数（1234.5 → "1,234.50"）
function formatAmount(n) {
  const num = Number(n) || 0
  const fixed = num.toFixed(2)
  const parts = fixed.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

Page({
  data: {
    viewYear: 0,          // 查看年份
    viewMonth: 0,         // 查看月份
    summary: { income: 0, expense: 0, balance: 0 },  // 月度统计
    groups: [],           // 按日期分组的流水
    form: {
      type: 'expense',    // income / expense
      amount: '',         // 金额
      category: '',       // 分类名
      note: ''            // 备注
    },
    categories: [],       // 当前类型的分类列表
    categoryIndex: 0      // 分类选中下标
  },

  onLoad() {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    this.setData({
      viewYear: year,
      viewMonth: month,
      form: {
        type: 'expense',
        amount: '',
        date: this.todayStr(),
        category: categories.expense[0].name,
        note: ''
      },
      categories: categories.expense
    })
    this.loadMonthData()
  },

  onShow() {
    if (this.getTabBar) {
      this.getTabBar().setData({ selected: 2 })
    }
  },

  // 加载当月数据 + 统计
  async loadMonthData() {
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1)
    const ym = this.data.viewYear + '-' + String(this.data.viewMonth).padStart(2, '0')
    let data = { records: [], summary: { income: 0, expense: 0, balance: 0 } }
    try {
      data = await ledgerStorage.getLedgerMonthData(ym)
    } catch (e) {
      if (seq !== this._loadSeq) return
      wx.showToast({ title: '数据加载失败', icon: 'none' })
      return
    }
    if (seq !== this._loadSeq) return
    const summary = data.summary
    const records = data.records
    this.setData({
      summary: {
        income: summary.income,
        expense: summary.expense,
        balance: summary.balance,
        incomeText: formatAmount(summary.income),
        expenseText: formatAmount(summary.expense),
        balanceText: formatAmount(summary.balance)
      },
      groups: this.groupByDate(records)
    })
  },

  // 按日期倒序分组
  groupByDate(records) {
    // 分类名 → emoji 图标映射
    const iconMap = {}
    categories.income.concat(categories.expense).forEach(function (c) {
      iconMap[c.name] = c.icon
    })

    const map = {}
    records.forEach(function (r) {
      r.categoryIcon = iconMap[r.category] || '🧾'
      r.amountText = formatAmount(r.amount)
      if (!map[r.date]) map[r.date] = []
      map[r.date].push(r)
    })
    // 日期倒序
    const dates = Object.keys(map).sort(function (a, b) { return a < b ? 1 : -1 })
    const todayStr = this.todayStr()
    const yesterdayStr = this.yesterdayStr()

    return dates.map(function (date) {
      const list = map[date].sort(function (a, b) { return b.createdAt - a.createdAt })
      let label = date
      if (date === todayStr) label = '今天'
      else if (date === yesterdayStr) label = '昨天'
      return { date, label, list }
    })
  },

  todayStr() {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  },

  yesterdayStr() {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  },

  // 类型切换（支出/收入）
  onTypeChange(e) {
    const type = e.currentTarget.dataset.type
    const cats = type === 'income' ? categories.income : categories.expense
    this.setData({
      'form.type': type,
      'form.category': cats[0].name,
      'form.amount': '',
      categories: cats,
      categoryIndex: 0
    })
  },

  // 金额输入
  onAmountInput(e) {
    this.setData({ 'form.amount': e.detail.value })
  },

  // 分类选择
  onCategoryChange(e) {
    const idx = Number(e.detail.value)
    this.setData({
      categoryIndex: idx,
      'form.category': this.data.categories[idx].name
    })
  },

  // 备注输入
  onNoteInput(e) {
    let note = e.detail.value
    if (note.length > 20) note = note.slice(0, 20)
    this.setData({ 'form.note': note })
  },

  // 日期选择（默认当天，可补录历史）
  onDateChange(e) {
    this.setData({ 'form.date': e.detail.value })
  },

  // 提交保存
  async onSubmit() {
    const form = this.data.form
    const amount = parseFloat(form.amount)

    // 校验金额 > 0
    if (!amount || isNaN(amount) || amount <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' })
      return
    }

    // 构建记录
    const record = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      date: form.date,
      type: form.type,
      amount: Math.round(amount * 100) / 100,
      category: form.category,
      note: form.note || '',
      createdAt: Date.now()
    }

    try {
      await ledgerStorage.saveLedgerRecord(record)
    } catch (e) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      return
    }
    wx.showToast({ title: '已保存', icon: 'success' })

    // 重置表单
    this.setData({
      'form.amount': '',
      'form.note': ''
    })

    // 刷新
    await this.loadMonthData()
  },

  // 点击备注图标 → 弹窗展示备注
  onTapNote(e) {
    const note = e.currentTarget.dataset.note
    if (!note) return
    wx.showModal({
      title: '备注',
      content: note,
      showCancel: false,
      confirmText: '关闭'
    })
  },

  // 长按删除
  onLongPress(e) {
    const record = e.currentTarget.dataset.record
    wx.showActionSheet({
      itemList: ['删除'],
      success: async (res) => {
        if (res.tapIndex === 0) {
          wx.showModal({
            title: '删除确认',
            content: '确定删除这笔记录？',
            success: async (modalRes) => {
              if (modalRes.confirm) {
                try {
                  await ledgerStorage.deleteLedgerRecord(record.id, record.date)
                } catch (e) {
                  wx.showToast({ title: '删除失败，请重试', icon: 'none' })
                  return
                }
                wx.showToast({ title: '已删除', icon: 'success' })
                await this.loadMonthData()
              }
            }
          })
        }
      }
    })
  },

  // 上个月
  onPrevMonth() {
    let y = this.data.viewYear
    let m = this.data.viewMonth - 1
    if (m < 1) { m = 12; y-- }
    this.setData({ viewYear: y, viewMonth: m })
    this.loadMonthData()
  },

  // 下个月
  onNextMonth() {
    let y = this.data.viewYear
    let m = this.data.viewMonth + 1
    if (m > 12) { m = 1; y++ }
    this.setData({ viewYear: y, viewMonth: m })
    this.loadMonthData()
  }
})
