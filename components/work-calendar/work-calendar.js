// components/work-calendar/work-calendar.js
const time = require('../../utils/time')

Component({
  properties: {
    year: { type: Number, value: 2026 },
    month: { type: Number, value: 1 },
    records: { type: Array, value: [] },
    selectedDate: { type: String, value: '' }
  },

  data: {
    cells: []
  },

  observers: {
    'year, month, records, selectedDate': function () {
      this.buildCells()
    }
  },

  methods: {
    // 生成日历网格
    buildCells() {
      const cells = time.buildMonthGrid(this.data.year, this.data.month, this.data.records, this.data.selectedDate)
      this.setData({ cells })
    },

    // 点击某天
    onTap(e) {
      const { date, has } = e.currentTarget.dataset
      this.triggerEvent('daytap', { dateStr: date, hasRecord: !!has })
    },

    // 长按某天（打开详情）
    onLongPress(e) {
      const { date } = e.currentTarget.dataset
      this.triggerEvent('daylongpress', { dateStr: date })
    },

    // 上个月
    onPrev() {
      this.triggerEvent('prevmonth', {})
    },

    // 下个月
    onNext() {
      this.triggerEvent('nextmonth', {})
    },

    // 长按月份名（切换年份）
    onYearLongPress() {
      this.triggerEvent('yearlongpress', {})
    }
  }
})
