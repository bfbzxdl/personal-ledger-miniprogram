// pages/work/detail/detail.js - 当日详情页
const storage = require('../../../utils/storage')
const time = require('../../../utils/time')

Page({
  data: {
    date: '',
    dayRecords: [],   // 当天记录列表
    dayTotal: 0,      // 当天总工时
    editVisible: false,       // 修改弹窗是否显示
    editRecord: null,         // 正在修改的记录
    editStartTime: '',
    editEndTime: '',
    editLunchStart: '00:00',
    editLunchEnd: '00:00',
    editWorkTotal: 0,
    editLunchHours: 0,
    editActualHours: 0,
    editHasRest: false,      // 是否填写休息时段
    editRestText: '无',       // 休息时段展示文案
    timeSlots: time.timeSlots(),  // 半小时粒度数组
    editTimePickerRange: [],
    editTimePickerValue: [0, 0],
    editRestPickerRange: [],  // 休息时段选择器两列
    editRestPickerValue: [0, 0]  // 休息时段选中下标（默认0）
  },

  onLoad(options) {
    const date = options.date || ''
    this.setData({ date })
  },

  onShow() {
    // 首次进入和返回页面时刷新
    this.loadDayRecords()
  },

  // 加载当天记录
  async loadDayRecords() {
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1)
    const date = this.data.date
    const month = date.slice(0, 7)
    let monthRecords = []
    try {
      monthRecords = await storage.getMonthRecords(month)
    } catch (e) {
      if (seq !== this._loadSeq) return
      wx.showToast({ title: '数据加载失败', icon: 'none' })
      return
    }
    if (seq !== this._loadSeq) return
    const records = monthRecords.filter(function (r) {
      return r.date === date
    })
    // 按开始时间升序（先发生的在前）
    records.sort(function (a, b) {
      if (a.startTime === b.startTime) return a.createdAt - b.createdAt
      return a.startTime < b.startTime ? -1 : 1
    })

    let dayTotal = 0
    records.forEach(function (r) { dayTotal += r.workHours })
    dayTotal = Math.round(dayTotal * 10) / 10

    this.setData({ dayRecords: records, dayTotal })
  },

  // 长按记录 → 操作菜单
  onLongPress(e) {
    const record = e.currentTarget.dataset.record
    wx.showActionSheet({
      itemList: ['修改', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.openEdit(record)
        } else if (res.tapIndex === 1) {
          this.confirmDelete(record)
        }
      }
    })
  },

  // 打开修改弹窗，预填原记录
  openEdit(record) {
    const slots = this.data.timeSlots
    const sIdx = slots.indexOf(record.startTime)
    const eIdx = slots.indexOf(record.endTime)
    const noRest = record.lunchStart === record.lunchEnd
    let lsIdx = slots.indexOf(record.lunchStart)
    let leIdx = slots.indexOf(record.lunchEnd)
    if (noRest || lsIdx === -1) lsIdx = 0
    if (noRest || leIdx === -1) leIdx = 0
    this.setData({
      editVisible: true,
      editRecord: record,
      editStartTime: record.startTime,
      editEndTime: record.endTime,
      editHasRest: !noRest,
      editLunchStart: noRest ? '00:00' : record.lunchStart,
      editLunchEnd: noRest ? '00:00' : record.lunchEnd,
      editRestText: noRest ? '无' : record.lunchStart + ' - ' + record.lunchEnd,
      editTimePickerRange: [slots, slots],
      editRestPickerRange: [slots, slots],
      editTimePickerValue: [sIdx, eIdx],
      editRestPickerValue: [lsIdx, leIdx]
    })
    this.recalcEdit()
  },

  // 弹窗内统一计算：工作总时长 / 休息 / 实际工时
  recalcEdit() {
    const d = this.data
    const editWorkTotal = time.calcHours(d.editStartTime, d.editEndTime)
    const editLunchHours = time.calcHours(d.editLunchStart, d.editLunchEnd)
    const editActualHours = Math.round((editWorkTotal - editLunchHours) * 10) / 10
    this.setData({ editWorkTotal, editLunchHours, editActualHours })
  },

  // 工作时段选择器：列滚动联动
  onEditTimeColumnChange(e) {
    const column = e.detail.column
    const value = e.detail.value
    const cur = this.data.editTimePickerValue.slice()
    cur[column] = value
    if (column === 0 && cur[1] <= cur[0]) {
      cur[1] = cur[0] + 1
      if (cur[1] > 47) cur[1] = 47
    }
    this.setData({ editTimePickerValue: cur })
  },

  // 工作时段选择器：确定
  onEditTimeChange(e) {
    const value = e.detail.value
    const startTime = this.data.timeSlots[value[0]]
    const endTime = this.data.timeSlots[value[1]]
    if (!time.isValidRange(startTime, endTime)) {
      wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' })
      return
    }
    this.setData({
      editStartTime: startTime,
      editEndTime: endTime,
      editTimePickerValue: value
    })
    this.recalcEdit()
  },

  // 休息时段开关：开启后可选休息时间，关闭则休息为0
  onEditRestSwitchChange(e) {
    const hasRest = e.detail.value
    if (!hasRest) {
      this.setData({
        editHasRest: false,
        editLunchStart: '00:00',
        editLunchEnd: '00:00',
        editRestText: '无',
        editRestPickerValue: [0, 0]
      })
      this.recalcEdit()
      return
    }
    // 默认：从当前工作开始时间起休息半小时（不超过工作结束时间）
    const slots = this.data.timeSlots
    const sIdx = slots.indexOf(this.data.editStartTime)
    const eIdx = slots.indexOf(this.data.editEndTime)
    let reIdx = sIdx + 1
    if (reIdx > eIdx) reIdx = eIdx
    this.setData({
      editHasRest: true,
      editLunchStart: slots[sIdx],
      editLunchEnd: slots[reIdx],
      editRestText: slots[sIdx] + ' - ' + slots[reIdx],
      editRestPickerValue: [sIdx, reIdx]
    })
    this.recalcEdit()
  },

  // 休息时段选择器：列滚动联动
  onEditRestColumnChange(e) {
    const column = e.detail.column
    const value = e.detail.value
    const cur = this.data.editRestPickerValue.slice()
    cur[column] = value
    if (column === 0 && cur[1] <= cur[0]) {
      cur[1] = cur[0] + 1
      if (cur[1] > 47) cur[1] = 47
    }
    this.setData({ editRestPickerValue: cur })
  },

  // 休息时段选择器：确定
  onEditRestChange(e) {
    const value = e.detail.value
    const lunchStart = this.data.timeSlots[value[0]]
    const lunchEnd = this.data.timeSlots[value[1]]

    if (!time.isValidRange(lunchStart, lunchEnd)) {
      wx.showToast({ title: '休息结束需晚于休息开始', icon: 'none' })
      return
    }

    this.setData({
      editLunchStart: lunchStart,
      editLunchEnd: lunchEnd,
      editRestText: lunchStart + ' - ' + lunchEnd,
      editRestPickerValue: value
    })
    this.recalcEdit()
  },

  // 保存修改
  async onEditSubmit() {
    const d = this.data

    if (!time.isValidRange(d.editStartTime, d.editEndTime)) {
      wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' })
      return
    }
    if (d.editHasRest && d.editLunchStart === '00:00' && d.editLunchEnd === '00:00') {
      wx.showToast({ title: '请选择休息时段', icon: 'none' })
      return
    }
    if (d.editLunchStart !== '00:00' || d.editLunchEnd !== '00:00') {
      if (!time.isValidRange(d.editLunchStart, d.editLunchEnd)) {
        wx.showToast({ title: '休息结束需晚于休息开始', icon: 'none' })
        return
      }
      if (d.editLunchStart < d.editStartTime || d.editLunchEnd > d.editEndTime) {
        wx.showToast({ title: '休息时段需在工作时段内', icon: 'none' })
        return
      }
    }
    if (d.editLunchHours > d.editWorkTotal) {
      wx.showToast({ title: '休息时长不能超过工作时间', icon: 'none' })
      return
    }
    if (d.editActualHours <= 0) {
      wx.showToast({ title: '实际工时不能为0', icon: 'none' })
      return
    }

    // 顺序校验：修改后开始时间不能早于当天其他记录的最后结束时间
    const others = d.dayRecords.filter(function (r) { return r.id !== d.editRecord.id })
    if (others.length > 0) {
      let lastEnd = '00:00'
      others.forEach(function (r) {
        if (r.endTime > lastEnd) lastEnd = r.endTime
      })
      if (d.editStartTime < lastEnd) {
        wx.showToast({ title: '开始时间不能早于 ' + lastEnd, icon: 'none' })
        return
      }
    }

    // 同一天同时段查重（排除自身）
    const duplicate = d.dayRecords.some(function (r) {
      if (r.id === d.editRecord.id) return false
      return r.startTime === d.editStartTime &&
        r.endTime === d.editEndTime &&
        r.lunchStart === d.editLunchStart &&
        r.lunchEnd === d.editLunchEnd
    })
    if (duplicate) {
      wx.showToast({ title: '该时段已记录', icon: 'none' })
      return
    }

    const record = Object.assign({}, d.editRecord, {
      startTime: d.editStartTime,
      endTime: d.editEndTime,
      lunchStart: d.editLunchStart,
      lunchEnd: d.editLunchEnd,
      workTotal: d.editWorkTotal,
      lunchHours: d.editLunchHours,
      workHours: d.editActualHours
    })
    try {
      await storage.updateRecord(record)
    } catch (e) {
      wx.showToast({ title: '修改失败，请重试', icon: 'none' })
      return
    }
    wx.showToast({ title: '修改成功', icon: 'success' })
    this.setData({ editVisible: false, editRecord: null })
    await this.loadDayRecords()
  },

  // 取消修改
  onEditCancel() {
    this.setData({ editVisible: false, editRecord: null })
  },

  // 阻止弹窗内容点击冒泡到遮罩
  noop() {},

  // 删除：二次确认
  confirmDelete(record) {
    wx.showModal({
      title: '删除确认',
      content: '确定删除该记录？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await storage.deleteRecord(record.id, record.date)
          } catch (e) {
            wx.showToast({ title: '删除失败，请重试', icon: 'none' })
            return
          }
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.loadDayRecords()
        }
      }
    })
  }
})
