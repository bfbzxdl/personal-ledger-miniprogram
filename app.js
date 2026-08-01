// app.js
const config = require('./config/index')

App({
  onLaunch() {
    // 云开发初始化（未配置环境ID时跳过，本地开发仍可运行）
    if (wx.cloud && config.CLOUD_ENV) {
      wx.cloud.init({
        env: config.CLOUD_ENV,
        traceUser: true
      })
    } else if (wx.cloud) {
      console.warn('请在 config/index.js 中配置 CLOUD_ENV 后启用云存储')
    }
  },
  globalData: {
    userInfo: null
  }
})
