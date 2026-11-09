// components/news-card/index.js - 热点卡片
const date = require('../../utils/date')

Component({
  properties: {
    item: {
      type: Object,
      value: null,
      observer: 'onItemChange'
    },
    // 热榜名次，>0 时展示
    rank: {
      type: Number,
      value: 0
    },
    // 是否展示摘要（热搜/紧凑列表可关掉）
    showSummary: {
      type: Boolean,
      value: true
    },
    // 热榜排名变化标签，如 "↑2" / "↓1" / "新"
    changeText: {
      type: String,
      value: ''
    },
    // up | down | new
    changeType: {
      type: String,
      value: ''
    }
  },

  data: {
    timeText: '',
    coverOk: true
  },

  methods: {
    onItemChange(item) {
      this.setData({
        timeText: item ? date.formatTimeAgo(item.publishedAt) : '',
        coverOk: true
      })
    },

    onTap() {
      const item = this.data.item
      if (!item || !item.id) return
      this.triggerEvent('cardtap', { id: item.id, item: item })
    },

    onImageError() {
      this.setData({ coverOk: false })
    }
  }
})
