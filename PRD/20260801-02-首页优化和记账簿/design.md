# 个人台账小程序 — 技术设计文档 (v1.1)

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.1 (新增首页壁纸、记账本、UI重构) |
| 技术栈 | 微信原生小程序 + Vant Weapp + TDesign miniprogram + dayjs |

## 1. 技术架构
```text
┌─────────────────────────────────────────────────────┐
│                    微信小程序（原生）                  │
│                                                     │
│  pages/home ──────── 首页 (壁纸卡片 + 鼓励语)         │
│  pages/work ──────── 工时 (大卡片UI: 表单/日历/详情)   │
│  pages/ledger ────── 记账 (大卡片UI: 统计/记账/流水)   │
│                                                     │
│  config/                                            │
│    ├── wallpapers.js (数据源接口，预留网络扩展)        │
│    └── ledger-categories.js (记账分类)               │
│                                                     │
│  utils/                                             │
│    ├── time.js / storage.js (工时)                   │
│    └── ledger-storage.js (记账本存储)                │
└─────────────────────────────────────────────────────┘
```

## 2. 目录结构
*(同开发文档 v1.1，新增 `assets/wallpapers`, `pages/ledger`, `config/wallpapers.js`, `utils/ledger-storage.js`)*

## 3. 数据结构设计
### 3.1 记账记录 LedgerRecord 【新增】
```typescript
interface LedgerRecord {
  id: string;           
  date: string;         // YYYY-MM-DD
  type: 'income' | 'expense';  
  amount: number;       
  category: string;     
  note: string;         
  createdAt: number;    
}
```

## 4. 核心模块设计
### 4.1 全局UI规范 (大卡片式) 【新增】
在 `app.wxss` 中定义全局卡片类，所有页面模块统一调用：
```css
/* 大卡片基础样式 */
.card {
  background: #ffffff;
  border-radius: 24rpx; /* 大圆角 */
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.06); /* 柔和阴影 */
  padding: 32rpx;
  margin: 0 24rpx 24rpx 24rpx; /* 左右留白，底部间距 */
}
/* 首页壁纸卡片特殊处理 */
.card-wallpaper {
  position: relative;
  height: 400rpx;
  overflow: hidden;
  padding: 0;
}
.card-wallpaper .bg-img { width: 100%; height: 100%; }
.card-wallpaper .quote-text {
  position: absolute; bottom: 40rpx; left: 32rpx; right: 32rpx;
  color: #fff; font-size: 32rpx; font-weight: bold;
  text-shadow: 0 2rpx 8rpx rgba(0,0,0,0.5); /* 保证文字在图片上可读 */
}
```

### 4.2 config/wallpapers.js (壁纸数据源) 【新增】
*设计亮点：采用**策略模式/接口隔离**。页面只调用 `getTodayWallpaper()`，不关心数据来自本地还是网络。*
```javascript
// 当前实现：本地读取
function getTodayWallpaper() {
  const dayIndex = dayjs().day() === 0 ? 6 : dayjs().day() - 1;
  return LOCAL_WALLPAPERS[dayIndex];
}
// 未来扩展：只需将此函数内部改为 wx.request 获取网络URL，并配合 wx.getImageInfo 缓存即可。
```

### 4.3 utils/ledger-storage.js (记账本存储) 【新增】
```javascript
function ledgerMonthKey(date) { return `ledger_records_${date.slice(0, 7).replace('-', '')}` }

function getLedgerMonthRecords(monthStr) { /* 读取逻辑 */ }
function saveLedgerRecord(record) { /* 保存逻辑 */ }
function deleteLedgerRecord(id, date) { /* 删除逻辑 */ }

// 计算月度统计
function calcMonthSummary(monthStr) {
  const records = getLedgerMonthRecords(monthStr)
  let income = 0, expense = 0
  records.forEach(r => {
    if (r.type === 'income') income += r.amount
    else expense += r.amount
  })
  return { income, expense, balance: income - expense }
}
```

### 4.4 主页面 pages/ledger/index 设计 【新增】
**data 结构**：
```javascript
data: {
  viewYear: 2026, viewMonth: 8,
  summary: { income: 0, expense: 0, balance: 0 },
  records: [],          // 当月流水（按日期分组后）
  form: { type: 'expense', amount: '', category: '餐饮', note: '' },
  categories: []        // 从 config 读取
}
```
**核心方法**：
- `onLoad`: 初始化分类，加载当月数据和统计。
- `onSubmit`: 校验金额 -> `saveLedgerRecord` -> 刷新列表和统计。
- `onDelete`: 二次确认 -> `deleteLedgerRecord` -> 刷新。
- `onPrevMonth / onNextMonth`: 左右箭头切换月份，联动统计与列表。

**补充细化**：
- 分类配置带 `icon` 字段（emoji）。
- 删除交互采用长按（与工时详情页一致）。
- 壁纸资源使用渐变占位图，鼓励语 30 句。

## 7. 关键风险与对策
| 风险 | 对策 |
|---|---|
| **壁纸未来扩展性** | `config/wallpapers.js` 采用统一接口封装，页面层不硬编码本地路径，未来改网络请求无需改页面代码。 |
| **图片加载白屏** | 首页壁纸使用 `wx.getImageInfo` 预加载，或在 `image` 组件上设置 `lazy-load` 和默认占位图。 |
| **记账本数据量增长** | 与工时一样采用按月分块存储（`ledger_records_YYYYMM`），避免单次读取数据过大导致卡顿。 |
| **大卡片UI在深色模式下的表现** | 阴影颜色使用 `rgba(0,0,0,0.06)`，背景色使用系统变量或固定白色，确保在浅色主题下视觉最佳。 |