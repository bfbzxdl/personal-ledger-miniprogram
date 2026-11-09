// components/trend-strip/index.js - 热搜区（两列榜单）
Component({
  properties: {
    items: {
      type: Array,
      value: []
    }
  },

  methods: {
    onTap(e) {
      const item = this.data.items[e.currentTarget.dataset.index]
      if (!item) return
      this.triggerEvent('trendtap', { keyword: item.title, rank: item.rank })
    }
  }
})
