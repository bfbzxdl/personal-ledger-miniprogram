# 个人台账小程序 — 开发文档 (v1.1)

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.1 (新增首页壁纸、记账本、UI重构) |
| 创建日期 | 2026-08-01 |
| 关联文档 | [PRD](./工时记录功能PRD.md) / [设计文档](./工时记录功能设计文档.md) |
| 技术栈 | 微信原生小程序 + Vant Weapp + TDesign miniprogram + dayjs |

## 0. 已确认决策（需求定稿）
| # | 决策 | 影响 |
|:-|:-----|:------|
| 1 | tabBar 导航：首页 + 工时 + 记账本 三个tab | app.json 增加 tabBar 配置 |
| 2 | 修改记录时日期锁定，只改时间段/午休 | 编辑表单日期只读 |
| 3 | 午休选择时间段（起止时间自动算时长） | lunchBreak 存起止时间 |
| 4 | 日期固定为今天，不可选 | 表单无日期选择器，显示今天 |
| 5 | 12月时自动显示全年汇总 | 月份=12 时展示年度总工时 |
| 6 | 同一天同时间段去重（提示不保存） | 提交前查重 |
| 7 | 绿色主题 | app.wxss 定义主色变量 |
| 8 | **首页增加每日壁纸与鼓励语（本地内置+预留网络扩展）** | 新增 config/wallpapers.js，采用策略模式 |
| 9 | **全局UI采用大卡片式布局（圆角+阴影）** | app.wxss 定义通用 .card 样式 |
| 10 | **新增记账本基础功能（MVP版本）** | 新增 pages/ledger，含记一笔、流水、基础统计 |

### 0.1 补充确认决策（v1.1 细化，2026-08-01）

| # | 决策 | 说明 |
|:-|:-----|:------|
| 11 | **壁纸图片资源**：先用程序生成的**渐变占位图**（monday.jpg ~ sunday.jpg），后续可替换同名文件 | assets/wallpapers/ 目录结构保留，符合文档 |
| 12 | **鼓励语文案库**：补充至 **30句**（储蓄/记账/自律主题），按日期循环 | QUOTES 数组 30 条 |
| 13 | **记账本分类图标**：使用 **emoji** | 分类配置带 icon 字段 |
| 14 | **记账本删除交互**：**长按删除**（与工时详情页一致） | 二次确认后删除 |
| 15 | **记账本月份切换**：顶部**左右箭头**（与工时日历一致） | 联动统计卡片 |
| 16 | **首页内容**：**壁纸卡片为主**，卡片下方附一句引导语 | 大卡片布局 |

## 1. 开发环境
| 项 | 要求 |
| ---|---|
| 微信开发者工具 | 最新稳定版 |
| AppID | wxea7a9124df51b5da |
| 基础库 | ≥ 2.30.0 |
| 项目路径 | C:\Users\86183\Desktop\Projects\personal-ledger-miniprogram |

## 2. 依赖安装
```bash
npm init -y
npm i @vant/weapp@1.11.6 dayjs@1.11.13 tdesign-miniprogram@1.8.0
```
*(安装完成后在微信开发者工具执行：工具 → 构建 npm)*

## 3. 目录结构（最终版 v1.1）
```text
personal-ledger-miniprogram/
 ├── app.js / app.json / app.wxss     # tabBar + 绿色主题 + 全局卡片样式
 ├── assets/
 │   └── wallpapers/                  # 【新增】本地壁纸资源 (monday.jpg ... sunday.jpg)
 ├── pages/
 │   ├── home/                        # 首页tab（每日壁纸卡片+鼓励语）
 │   ├── work/
 │   │   ├── index/                   # 工时记录tab（大卡片UI）
 │   │   └── detail/                  # 当日详情页
 │   └── ledger/                      # 【新增】记账本tab
 │       └── index/                   # 记账本主页（记一笔+流水+统计）
 ├── components/
 │   └── work-calendar/               # 日历组件
 ├── utils/
 │   ├── time.js                      # dayjs封装
 │   ├── storage.js                   # 工时存储封装
 │   └── ledger-storage.js            # 【新增】记账本存储封装
 └── config/
     ├── index.js                     # 常量配置
     ├── wallpapers.js                # 【新增】壁纸与鼓励语数据源（预留扩展）
     └── ledger-categories.js         # 【新增】记账本分类配置
```

## 4. app.json / tabBar 配置
```json
{
   "pages": [
     "pages/home/home",
     "pages/work/index/index",
     "pages/work/detail/detail",
     "pages/ledger/index/index"
   ],
   "tabBar": {
     "color": "#999999",
     "selectedColor": "#07c160",
     "backgroundColor": "#ffffff",
     "list": [
       { "pagePath": "pages/home/home", "text": "首页" },
       { "pagePath": "pages/work/index/index", "text": "工时" },
       { "pagePath": "pages/ledger/index/index", "text": "记账本" }
     ]
   },
   "window": {
     "navigationBarBackgroundColor": "#07c160",
     "navigationBarTitleText": "个人台账",
     "navigationBarTextStyle": "white",
     "backgroundColor": "#f5f5f5"
   }
}
```
*全局卡片样式 (app.wxss)*：
```css
.card {
  background: #ffffff;
  border-radius: 24rpx; /* 大圆角 */
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.06); /* 柔和阴影 */
  padding: 32rpx;
  margin-bottom: 24rpx;
}
```

## 5. 数据模型（定稿）
### 5.1 WorkRecord (工时)
```javascript
interface WorkRecord {
  id: string, date: string, startTime: string, endTime: string,
  lunchStart: string, lunchEnd: string, workTotal: number, 
  lunchHours: number, workHours: number, createdAt: number
}
```
### 5.2 LedgerRecord (记账本) 【新增】
```javascript
interface LedgerRecord {
  id: string;           // `${timestamp}_${random4}`
  date: string;         // YYYY-MM-DD
  type: 'income' | 'expense';  // 收入/支出
  amount: number;       // 金额（元，保留2位小数）
  category: string;     // 分类（如：餐饮、工资）
  note: string;         // 备注
  createdAt: number;    // 时间戳
}
```
*存储 Key*：`ledger_records_YYYYMM` (按月分块)

## 6. 核心模块实现
### 6.1 config/wallpapers.js (壁纸与鼓励语) 【新增】
*设计说明：采用统一接口，当前实现为本地读取。未来若需改为网络API，只需修改此文件内部实现，页面层代码无需改动。*
```javascript
const dayjs = require('dayjs')

const LOCAL_WALLPAPERS = [
  '/assets/wallpapers/monday.jpg', '/assets/wallpapers/tuesday.jpg', 
  '/assets/wallpapers/wednesday.jpg', '/assets/wallpapers/thursday.jpg',
  '/assets/wallpapers/friday.jpg', '/assets/wallpapers/saturday.jpg', 
  '/assets/wallpapers/sunday.jpg'
]

const QUOTES = [
  '每天节省一点点，退休别墅靠大海',
  '时间就是金钱，记录创造价值',
  // ... 预留30句
]

// 统一接口：获取今日壁纸
function getTodayWallpaper() {
  // 未来扩展点：这里可以改成 wx.request 获取网络图片
  const dayIndex = dayjs().day() === 0 ? 6 : dayjs().day() - 1; 
  return LOCAL_WALLPAPERS[dayIndex]
}

// 统一接口：获取今日鼓励语
function getTodayQuote() {
  // 未来扩展点：这里可以改成调用 "一言" 等网络API
  const dateIndex = dayjs().date() - 1;
  return QUOTES[dateIndex % QUOTES.length]
}

module.exports = { getTodayWallpaper, getTodayQuote }
```

### 6.2 config/ledger-categories.js 【新增】
```javascript
module.exports = {
  income: ['工资', '奖金', '兼职', '理财', '其他收入'],
  expense: ['餐饮', '交通', '购物', '娱乐', '住房', '医疗', '教育', '其他支出']
}
```

## 7. 页面实现
### 7.1 pages/home (首页tab) 【重构】
**UI布局 (大卡片式)**：卡片背景为每日壁纸，中央悬浮鼓励语（白色文字+阴影）。
### 7.2 pages/work/index (工时tab) 【重构UI】
**UI布局 (大卡片式)**：将原有的平铺表单、汇总、日历分别包裹进独立的 `.card` 容器中。
### 7.3 pages/ledger/index (记账本tab) 【新增】
**核心功能 (MVP)**：顶部统计卡片（本月收支结余） + 记一笔表单卡片 + 流水列表卡片。

## 8. 开发顺序（M0-M5）
| 阶段 | 任务 | 验收 |
|---|---|---|
| M0 | 依赖安装 + 构建npm + tabBar(3个) + 全局卡片样式 | 三个tab可切换，卡片阴影圆角生效 |
| M1 | 工时表单：时间/午休选择 + 联动计算 + 保存/编辑 | 保存后 storage 可查、去重生效 |
| M2 | 日历组件 + 详情页 + 汇总统计 | 日历正确、修改删除正常、汇总正确 |
| M3 | **首页重构**：接入壁纸与鼓励语配置，渲染大卡片 | 每天自动切换壁纸和文案，UI美观 |
| M4 | **工时页面UI重构**：将表单、汇总、日历包裹进大卡片 | 视觉层级清晰，符合大卡片设计规范 |
| M5 | **记账本基础功能**：记一笔表单 + 流水列表 + 月度统计 | 能记账、能看流水、收支统计正确 |