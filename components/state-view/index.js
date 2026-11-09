// components/state-view/index.js - 统一的空态/错误态（R-18）
Component({
  properties: {
    text: { type: String, value: '' },
    sub: { type: String, value: '' },
    // 主按钮文案，点击触发 action
    actionText: { type: String, value: '' },
    // 次按钮文案，点击触发 plainaction
    plainActionText: { type: String, value: '' }
  },

  methods: {
    onAction() {
      this.triggerEvent('action')
    },
    onPlain() {
      this.triggerEvent('plainaction')
    }
  }
})
