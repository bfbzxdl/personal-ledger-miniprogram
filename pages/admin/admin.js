// pages/admin/admin.js - 管理员数据管理页
Page({
  data: {
    loading: false,
    resultText: ''
  },

  onLoad() {
    // 进入管理页再次校验，防止通过路径直接访问
    wx.cloud.callFunction({
      name: 'admin',
      data: { action: 'check' }
    }).then((res) => {
      const result = res.result || {}
      if (!(result.code === 0 && result.data && result.data.isAdmin)) {
        wx.showToast({ title: '无管理员权限', icon: 'none' })
        setTimeout(function () { wx.navigateBack() }, 600)
      }
    }).catch(() => {
      wx.showToast({ title: '校验失败', icon: 'none' })
      setTimeout(function () { wx.navigateBack() }, 600)
    })
  },

  call(action, data) {
    this.setData({ loading: true, resultText: '' })
    wx.cloud.callFunction({
      name: 'admin',
      data: Object.assign({ action: action }, data || {})
    }).then((res) => {
      const result = res.result || {}
      this.setData({ loading: false })
      if (result.code !== 0) {
        wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
        return
      }
      this.handleResult(action, result)
    }).catch(() => {
      this.setData({ loading: false })
      wx.showToast({ title: '调用失败，请确认云函数已部署', icon: 'none' })
    })
  },

  handleResult(action, result) {
    if (action === 'whoami') {
      this.setData({ resultText: '你的OpenID：' + result.data.openid })
    } else if (action === 'stats') {
      this.setData({
        resultText: '工时记录：' + result.data.workRecords + ' 条\n账簿记录：' + result.data.ledgerRecords + ' 条'
      })
    } else if (action === 'list') {
      const list = result.data || []
      if (list.length === 0) {
        this.setData({ resultText: '暂无数据' })
        return
      }
      const lines = list.map(function (r) {
        if (r.type) {
          return r.date + ' ' + r.type + ' ' + r.amount + ' ' + r.category + ' (' + r._openid + ')'
        }
        return r.date + ' ' + r.startTime + '-' + r.endTime + ' ' + r.workHours + 'h (' + r._openid + ')'
      })
      this.setData({ resultText: '共显示 ' + list.length + ' 条：\n' + lines.join('\n') })
    } else if (action === 'clear') {
      this.setData({ resultText: '已清空 ' + result.data.removed + ' 条记录' })
    }
  },

  onWhoami() {
    this.call('whoami')
  },

  onStats() {
    this.call('stats')
  },

  onListWork() {
    this.call('list', { collection: 'work_records', limit: 100 })
  },

  onListLedger() {
    this.call('list', { collection: 'ledger_records', limit: 100 })
  },

  onClearWork() {
    this.confirmClear('work_records')
  },

  onClearLedger() {
    this.confirmClear('ledger_records')
  },

  confirmClear(collection) {
    const names = { work_records: '工时表', ledger_records: '账簿表' }
    wx.showModal({
      title: '清空确认',
      content: '确定清空' + names[collection] + '？此操作不可恢复',
      confirmText: '继续',
      success: (res) => {
        if (!res.confirm) return
        wx.showModal({
          title: '二次确认',
          content: '再次确认清空' + names[collection] + '？',
          confirmText: '确认清空',
          success: (res2) => {
            if (res2.confirm) this.call('clear', { collection: collection })
          }
        })
      }
    })
  }
})
