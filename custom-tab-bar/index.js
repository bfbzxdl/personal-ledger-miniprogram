// custom-tab-bar/index.js
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home', text: '首页', icon: '🏠' },
      { pagePath: '/pages/work/index/index', text: '工时', icon: '⏱️' },
      { pagePath: '/pages/ledger/index/index', text: '账簿', icon: '💰' },
      { pagePath: '/pages/news/home/index', text: '热点', icon: '🔥' }
    ]
  },
  methods: {
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset
      if (index === this.data.selected) return
      wx.switchTab({ url: path })
    }
  }
})
