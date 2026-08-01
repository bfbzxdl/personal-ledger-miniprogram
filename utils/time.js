// utils/time.js - dayjs 封装
const dayjs = require('dayjs')

// 补零
function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

// 半小时粒度时间数组: ['00:00','00:30',...,'23:30']
function timeSlots() {
  const slots = []
  for (let h = 0; h < 24; h++) {
    slots.push(pad(h) + ':00', pad(h) + ':30')
  }
  return slots
}

// 字符串时间转分钟
function toMinutes(t) {
  const parts = String(t).split(':')
  return parseInt(parts[0]) * 60 + parseInt(parts[1])
}

// 计算时长(小时, 保留1位)
function calcHours(start, end) {
  return Math.round((toMinutes(end) - toMinutes(start)) / 6) / 10
}

// 校验结束时间晚于开始时间
function isValidRange(start, end) {
  return toMinutes(end) > toMinutes(start)
}

// 格式化当前时间: "2026-08-01 星期六 17:30"
function formatNow() {
  const d = dayjs()
  const weeks = ['日', '一', '二', '三', '四', '五', '六']
  return d.format('YYYY-MM-DD') + ' 星期' + weeks[d.day()] + ' ' + d.format('HH:mm')
}

// 格式化工时: 4.5 → "4.5h" / 5 → "5h"
function formatHours(h) {
  if (h === 0) return ''
  return h % 1 === 0 ? h + 'h' : h.toFixed(1) + 'h'
}

// 生成日历格子数据（42格，6行7列，周日起始，含前后月补位）
function buildMonthGrid(year, month, records, selectedDate) {
  // 当月每天的工时合计
  const dailyHours = {}
  ;(records || []).forEach(function (r) {
    const key = r.date
    dailyHours[key] = (dailyHours[key] || 0) + r.workHours
  })

  // 当月第一天
  const firstDay = dayjs(year + '-' + pad(month) + '-01')
  const startWeekday = firstDay.day()      // 0=周日
  const daysInMonth = firstDay.daysInMonth()
  const prevMonthEnd = firstDay.subtract(1, 'day').date()
  const todayStr = dayjs().format('YYYY-MM-DD')

  function makeCell(d, dateStr, isCurrentMonth) {
    return {
      day: d,
      dateStr: dateStr,
      isCurrentMonth: isCurrentMonth,
      isToday: dateStr === todayStr,
      isSelected: !!selectedDate && dateStr === selectedDate,
      totalHours: dailyHours[dateStr] || 0,
      hasRecord: !!dailyHours[dateStr],
      hoursText: formatHours(dailyHours[dateStr] || 0)
    }
  }

  const cells = []

  // 前月补位
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = prevMonthEnd - i
    const prevDate = firstDay.subtract(1, 'month')
    const dateStr = prevDate.format('YYYY-MM') + '-' + pad(d)
    cells.push(makeCell(d, dateStr, false))
  }

  // 当月
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = year + '-' + pad(month) + '-' + pad(d)
    cells.push(makeCell(d, dateStr, true))
  }

  // 后月补位（补到42格）
  const nextDate = firstDay.add(1, 'month')
  let nd = 1
  while (cells.length < 42) {
    const dateStr = nextDate.format('YYYY-MM') + '-' + pad(nd)
    cells.push(makeCell(nd, dateStr, false))
    nd++
  }

  return cells
}

module.exports = { timeSlots, toMinutes, calcHours, isValidRange, formatNow, formatHours, buildMonthGrid }
