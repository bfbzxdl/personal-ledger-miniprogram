// pages/work/index/index.js - 工时记录主页面
const time = require('../../../utils/time')
const storage = require('../../../utils/storage')
const config = require('../../../config/index')

Page({
  data: {
    nowText: '',            // 顶部当前时间
    today: '',              // 今天（用于限制日期选择）
    date: '',               // 所选日期（默认今天，可自由选择过去日期）
    startTime: config.DEFAULT_START,
    endTime: config.DEFAULT_END,
    lunchStart: '00:00',    // 休息开始（00:00-00:00 表示无休息）
    lunchEnd: '00:00',      // 休息结束
    workTotal: 4,           // 工作总时长（联动）
    lunchHours: 0,          // 休息时长（联动）
    actualHours: 4,         // 实际工时（联动）
    viewYear: 0,            // 日历显示年份
    viewMonth: 0,           // 日历显示月份
    monthRecords: [],       // 当前月份记录
    monthTotal: 0,          // 月度总工时
    yearTotal: 0,           // 年度总工时
    showYearSummary: false, // 月份=12时 true
    timeSlots: time.timeSlots(),  // 半小时粒度数组
    timePickerRange: [],    // 工作时段选择器两列
    timePickerValue: [16, 24],  // 工作时段选中下标 [开始, 结束]（默认08:00-12:00）
    hasRest: false,         // 是否填写休息时段
    restText: '无',          // 休息时段展示文案
    restPickerRange: [],    // 休息时段选择器两列
    restPickerValue: [0, 0],  // 休息时段选中下标（默认0）
    startIndex: 16,         // 08:00 下标
    endIndex: 24            // 12:00 下标
  },

  onLoad() {
    const now = new Date()
    const today = time.formatNow().split(' ')[0]
    this.setData({
      nowText: time.formatNow(),
      today: today,
      date: today,
      viewYear: now.getFullYear(),
      viewMonth: now.getMonth() + 1,
      timePickerRange: [this.data.timeSlots, this.data.timeSlots],
      restPickerRange: [this.data.timeSlots, this.data.timeSlots]
    })
    this.recalc()
  },

  // 点击日历某天 → 切换所选日期（重置表单后按该日记录衔接）
  async onDayTap(e) {
    const dateStr = e.detail.dateStr
    if (dateStr > this.data.today) {
      wx.showToast({ title: '不能选择未来日期', icon: 'none' })
      return
    }
    // 更新所选日期及对应月份
    const d = new Date(dateStr)
    this.setData({
      date: dateStr,
      viewYear: d.getFullYear(),
      viewMonth: d.getMonth() + 1
    })
    await this.loadMonthData()
    // 重置工作时段 + 休息时段（默认无），再按所选日期记录衔接起始点
    this.resetForm()
  },

  // 长按日历某天 → 打开详情记录页
  onDayLongPress(e) {
    const dateStr = e.detail.dateStr
    wx.navigateTo({
      url: '/pages/work/detail/detail?date=' + dateStr
    })
  },

  async onShow() {
    // 同步底部tab选中状态
    if (this.getTabBar) {
      this.getTabBar().setData({ selected: 1 })
    }
    // 从详情页返回时刷新（删除后同步日历和汇总）
    await this.loadMonthData()
    // 根据当天最新记录衔接表单默认时间段
    this.updateFormDefaultFromRecords()
  },

  // 根据所选日期已有记录，更新表单默认时间段（开始=最后记录结束时间，跨度4小时）
  updateFormDefaultFromRecords() {
    const date = this.data.date
    const records = this.data.monthRecords.filter(function (r) { return r.date === date })
    if (records.length === 0) return

    // 开始时间 = 所选日期最后一条记录的结束时间
    let lastEnd = '00:00'
    records.forEach(function (r) {
      if (r.endTime > lastEnd) lastEnd = r.endTime
    })

    const slots = this.data.timeSlots
    let sIdx = slots.indexOf(lastEnd)
    if (sIdx === -1) sIdx = 0
    // 结束默认 +4 小时（半小时粒度 +8）
    let eIdx = sIdx + 8
    if (eIdx > 47) eIdx = 47

    this.setData({
      startTime: slots[sIdx],
      endTime: slots[eIdx],
      startIndex: sIdx,
      endIndex: eIdx,
      timePickerValue: [sIdx, eIdx]
    })
    this.recalc()
  },

  // 统一计算：workTotal / lunchHours / actualHours
  recalc() {
    const d = this.data
    const workTotal = time.calcHours(d.startTime, d.endTime)
    const lunchHours = time.calcHours(d.lunchStart, d.lunchEnd)
    const actualHours = Math.round((workTotal - lunchHours) * 10) / 10
    this.setData({ workTotal, lunchHours, actualHours })
  },

  // 时间段选择器：列滚动联动（开始列变化时，结束列自动调整为之后）
  onTimeColumnChange(e) {
    const column = e.detail.column
    const value = e.detail.value
    const cur = this.data.timePickerValue.slice()
    cur[column] = value
    // 开始列变化：若结束 <= 开始，结束列自动跳到下一个半小时
    if (column === 0 && cur[1] <= cur[0]) {
      cur[1] = cur[0] + 1
      if (cur[1] > 47) cur[1] = 47
    }
    this.setData({ timePickerValue: cur })
  },

  // 时间段选择器：确定（一次选择开始+结束）
  onTimeChange(e) {
    const value = e.detail.value
    const startIdx = value[0]
    const endIdx = value[1]
    const startTime = this.data.timeSlots[startIdx]
    const endTime = this.data.timeSlots[endIdx]

    // 校验结束时间晚于开始时间
    if (!time.isValidRange(startTime, endTime)) {
      wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' })
      return
    }

    this.setData({
      startTime,
      endTime,
      startIndex: startIdx,
      endIndex: endIdx,
      timePickerValue: [startIdx, endIdx]
    })
    this.recalc()
  },

  // 休息时段开关：开启后可选休息时间，关闭则休息为0
  onRestSwitchChange(e) {
    const hasRest = e.detail.value
    if (!hasRest) {
      this.setData({
        hasRest: false,
        lunchStart: '00:00',
        lunchEnd: '00:00',
        restText: '无',
        restPickerValue: [0, 0]
      })
      this.recalc()
      return
    }
    // 默认：从当前工作开始时间起休息半小时（不超过工作结束时间）
    const slots = this.data.timeSlots
    const sIdx = slots.indexOf(this.data.startTime)
    const eIdx = slots.indexOf(this.data.endTime)
    let reIdx = sIdx + 1
    if (reIdx > eIdx) reIdx = eIdx
    this.setData({
      hasRest: true,
      lunchStart: slots[sIdx],
      lunchEnd: slots[reIdx],
      restText: slots[sIdx] + ' - ' + slots[reIdx],
      restPickerValue: [sIdx, reIdx]
    })
    this.recalc()
  },

  // 休息时段选择器：列滚动联动
  onRestColumnChange(e) {
    const column = e.detail.column
    const value = e.detail.value
    const cur = this.data.restPickerValue.slice()
    cur[column] = value
    // 开始列变化：若结束 <= 开始，结束列自动跳到下一个半小时
    if (column === 0 && cur[1] <= cur[0]) {
      cur[1] = cur[0] + 1
      if (cur[1] > 47) cur[1] = 47
    }
    this.setData({ restPickerValue: cur })
  },

  // 休息时段选择器：确定
  onRestChange(e) {
    const value = e.detail.value
    const lunchStart = this.data.timeSlots[value[0]]
    const lunchEnd = this.data.timeSlots[value[1]]

    if (!time.isValidRange(lunchStart, lunchEnd)) {
      wx.showToast({ title: '休息结束需晚于休息开始', icon: 'none' })
      return
    }

    this.setData({
      lunchStart,
      lunchEnd,
      restText: lunchStart + ' - ' + lunchEnd,
      restPickerValue: value
    })
    this.recalc()
  },

  // 提交保存
  async onSubmit() {
    const d = this.data

    // ① 校验结束时间晚于开始时间
    if (!time.isValidRange(d.startTime, d.endTime)) {
      wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' })
      return
    }

    // ③ 开启了休息但未选择时段时提示选择
    if (d.hasRest && d.lunchStart === '00:00' && d.lunchEnd === '00:00') {
      wx.showToast({ title: '请选择休息时段', icon: 'none' })
      return
    }

    // ③ 填写了休息时段时，结束需晚于开始
    if (d.lunchStart !== '00:00' || d.lunchEnd !== '00:00') {
      if (!time.isValidRange(d.lunchStart, d.lunchEnd)) {
        wx.showToast({ title: '休息结束需晚于休息开始', icon: 'none' })
        return
      }
      // ③.5 休息时段必须落在工作时段内
      if (d.lunchStart < d.startTime || d.lunchEnd > d.endTime) {
        wx.showToast({ title: '休息时段需在工作时段内', icon: 'none' })
        return
      }
    }

    // ③.6 校验休息时长不能超过工作时间
    if (d.lunchHours > d.workTotal) {
      wx.showToast({ title: '休息时长不能超过工作时间', icon: 'none' })
      return
    }

    // ② 校验实际工时 > 0
    if (d.actualHours <= 0) {
      wx.showToast({ title: '实际工时不能为0', icon: 'none' })
      return
    }

    // ③ 顺序校验：新记录开始时间不能早于当天最后一条记录的结束时间
    const sameDayRecords = d.monthRecords.filter(function (r) {
      return r.date === d.date
    })
    if (sameDayRecords.length > 0) {
      let lastEnd = '00:00'
      sameDayRecords.forEach(function (r) {
        if (r.endTime > lastEnd) lastEnd = r.endTime
      })
      if (d.startTime < lastEnd) {
        wx.showToast({ title: '开始时间不能早于 ' + lastEnd, icon: 'none' })
        return
      }
    }

    // ⑥ 同一天同时间段查重
    const monthRecords = this.data.monthRecords
    const duplicate = monthRecords.some(function (r) {
      return r.date === d.date &&
        r.startTime === d.startTime &&
        r.endTime === d.endTime &&
        r.lunchStart === d.lunchStart &&
        r.lunchEnd === d.lunchEnd
    })
    if (duplicate) {
      wx.showToast({ title: '该时段已记录', icon: 'none' })
      return
    }

    // 构建记录
    const record = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      date: d.date,
      startTime: d.startTime,
      endTime: d.endTime,
      lunchStart: d.lunchStart,
      lunchEnd: d.lunchEnd,
      workTotal: d.workTotal,
      lunchHours: d.lunchHours,
      workHours: d.actualHours,
      createdAt: Date.now()
    }

    // ④ 保存
    try {
      await storage.saveRecord(record)
    } catch (e) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      return
    }

    wx.showToast({ title: '记录成功', icon: 'success' })

    // 先刷新数据，再重置表单（重置后默认值衔接最新记录）
    await this.loadMonthData()
    // ⑤ 重置表单
    this.resetForm()
  },

  // 重置表单为默认值
  resetForm() {
    const slots = this.data.timeSlots
    const sIdx = slots.indexOf(config.DEFAULT_START)
    const eIdx = slots.indexOf(config.DEFAULT_END)
    this.setData({
      hasRest: false,
      startTime: config.DEFAULT_START,
      endTime: config.DEFAULT_END,
      lunchStart: '00:00',
      lunchEnd: '00:00',
      restText: '无',
      startIndex: sIdx,
      endIndex: eIdx,
      timePickerValue: [sIdx, eIdx],
      restPickerValue: [0, 0]
    })
    this.recalc()
    // 根据当天最新记录衔接默认时间段（保存后方便连续添加）
    this.updateFormDefaultFromRecords()
  },

  // 加载当前查看月份的数据 + 汇总
  async loadMonthData() {
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1)
    const ym = this.data.viewYear + '-' + String(this.data.viewMonth).padStart(2, '0')
    let records = []
    let yearRecords = []
    try {
      records = await storage.getMonthRecords(ym)
      if (this.data.viewMonth === 12) {
        yearRecords = await storage.getAllRecordsOfYear(this.data.viewYear)
      }
    } catch (e) {
      if (seq !== this._loadSeq) return
      wx.showToast({ title: '数据加载失败', icon: 'none' })
      return
    }
    if (seq !== this._loadSeq) return

    // 月度汇总
    let monthTotal = 0
    records.forEach(function (r) { monthTotal += r.workHours })
    monthTotal = Math.round(monthTotal * 10) / 10

    // 年度汇总：仅查看12月时展示
    const showYearSummary = this.data.viewMonth === 12
    let yearTotal = 0
    yearRecords.forEach(function (r) { yearTotal += r.workHours })
    yearTotal = Math.round(yearTotal * 10) / 10

    this.setData({
      monthRecords: records,
      monthTotal,
      yearTotal,
      showYearSummary
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
  },

  // 长按月份名 → 年份选择（近5年）
  onYearLongPress() {
    const currentYear = new Date().getFullYear()
    const years = []
    for (let i = currentYear - 4; i <= currentYear; i++) {
      years.push(i + '年')
    }
    wx.showActionSheet({
      itemList: years,
      success: (res) => {
        const year = currentYear - 4 + res.tapIndex
        this.setData({ viewYear: year })
        this.loadMonthData()
      }
    })
  }
})
